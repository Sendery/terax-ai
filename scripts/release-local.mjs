#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  assertReleaseCanStage,
  assertReleaseTargetsCommit,
  assertSigningKeyMatches,
  assertSourceProvenance,
  assertVersionIsNewer,
  buildUpdaterFragment,
  compatibilityAssetName,
  mergeUpdaterFragments,
  parseReleaseArgs,
  platformBuildPlan,
  releaseAssetName,
  REQUIRED_UPDATER_TARGETS,
  selectUpdaterPair,
  validateUpdaterFragment,
} from "./local-release-lib.mjs";

function usage() {
  console.log(`Usage:
  pnpm release:local <version> [--target <rust-target>] [--repo OWNER/REPO] [--dry-run]
  pnpm release:publish <version> [--repo OWNER/REPO] [--allow-partial] [--dry-run]

Stage one signed native build from Linux, Windows, or macOS into a draft GitHub release.
Run the stage command on each required platform. On macOS, run it once natively and
once with --target x86_64-apple-darwin or aarch64-apple-darwin as needed.

The publish command merges uploaded latest.<target>.json fragments into latest.json
and publishes the draft. It requires all supported updater targets unless
--allow-partial is explicitly supplied.

Required environment for builds:
  TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD (only when the key is password protected)

Authentication:
  gh auth login`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function walkFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!entry.endsWith(".app")) files.push(...walkFiles(path));
    } else if (stat.isFile()) files.push(path);
  }
  return files;
}

function isReleaseArtifact(file) {
  return [
    ".AppImage",
    ".AppImage.sig",
    ".app.tar.gz",
    ".app.tar.gz.sig",
    ".deb",
    ".rpm",
    ".dmg",
    ".exe",
    ".exe.sig",
    ".msi",
    ".msi.sig",
  ].some((suffix) => file.endsWith(suffix));
}

function ensureSourceProvenance() {
  const status = run("git", ["status", "--porcelain"], { capture: true });
  const branch = run("git", ["branch", "--show-current"], { capture: true });
  run("git", ["fetch", "origin", "develop"]);
  const head = run("git", ["rev-parse", "HEAD"], { capture: true });
  const remoteHead = run("git", ["rev-parse", "origin/develop"], {
    capture: true,
  });
  assertSourceProvenance({ status, branch, head, remoteHead });
  return head;
}

function latestStableTag(repository) {
  const result = spawnSync(
    "gh",
    ["api", `repos/${repository}/releases/latest`, "--jq", ".tag_name"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status === 0) return result.stdout.trim() || null;
  if (result.stderr.includes("HTTP 404")) return null;
  throw new Error(`Unable to inspect the latest stable release: ${result.stderr.trim()}`);
}

function releaseByTag(tag, repository) {
  const result = spawnSync(
    "gh",
    ["api", `repos/${repository}/releases/tags/${tag}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status === 0) return JSON.parse(result.stdout);
  if (result.stderr.includes("HTTP 404")) return null;
  throw new Error(`Unable to inspect release ${tag}: ${result.stderr.trim()}`);
}

function ensureRelease(tag, repository, commit) {
  const existing = releaseByTag(tag, repository);
  assertReleaseCanStage(existing);
  if (existing) {
    assertReleaseTargetsCommit(existing, commit);
    return existing;
  }
  run("gh", [
    "release",
    "create",
    tag,
    "--repo",
    repository,
    "--target",
    commit,
    "--title",
    `Terax ${tag}`,
    "--generate-notes",
    "--draft",
  ]);
  const created = releaseByTag(tag, repository);
  if (!created) throw new Error(`Draft release ${tag} was not created`);
  assertReleaseCanStage(created);
  assertReleaseTargetsCommit(created, commit);
  return created;
}

function stagePlatformRelease(options) {
  const tag = `v${options.version}`;
  const plan = platformBuildPlan({
    platform: process.platform,
    arch: process.arch,
    target: options.target,
  });
  console.log(
    JSON.stringify(
      {
        action: "stage",
        tag,
        repository: options.repository,
        platform: process.platform,
        architecture: process.arch,
        ...plan,
      },
      null,
      2,
    ),
  );
  if (options.dryRun) return;

  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error("TAURI_SIGNING_PRIVATE_KEY is required to create signed updater artifacts");
  }
  const commit = ensureSourceProvenance();
  run("gh", ["auth", "status"]);
  assertVersionIsNewer(options.version, latestStableTag(options.repository));
  const existingRelease = releaseByTag(tag, options.repository);
  assertReleaseCanStage(existingRelease);
  if (existingRelease) assertReleaseTargetsCommit(existingRelease, commit);
  rmSync(plan.bundleRoot, { recursive: true, force: true });

  const buildArgs = [
    "scripts/build-version.mjs",
    options.version,
    "--",
    "--bundles",
    plan.bundles.join(","),
  ];
  if (plan.rustTarget) buildArgs.push("--target", plan.rustTarget);
  run("node", buildArgs);

  const files = walkFiles(plan.bundleRoot).filter(isReleaseArtifact);
  const updater = selectUpdaterPair(plan.updaterTarget, files);
  const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  assertSigningKeyMatches(
    tauriConfig.plugins.updater.pubkey,
    readFileSync(updater.signature, "utf8"),
  );
  const stageRoot = join(
    ".terax",
    "releases",
    tag,
    plan.updaterTarget,
  );
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });

  const staged = [];
  for (const file of files) {
    const digest = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex")
      .slice(0, 16);
    let assetName = releaseAssetName(
      options.version,
      plan.updaterTarget,
      file,
      digest,
    );
    if (staged.some((entry) => entry.assetName === assetName)) {
      assetName = `${basename(dirname(file))}_${assetName}`;
    }
    const destination = join(stageRoot, assetName);
    cpSync(file, destination);
    staged.push({ source: file, path: destination, assetName });
    const compatibilityName = compatibilityAssetName(
      options.version,
      plan.updaterTarget,
      file,
    );
    if (compatibilityName) {
      const compatibilityPath = join(stageRoot, compatibilityName);
      cpSync(file, compatibilityPath);
      staged.push({
        source: `${file}#compatibility`,
        path: compatibilityPath,
        assetName: compatibilityName,
      });
    }
  }
  const updaterAsset = staged.find((entry) => entry.source === updater.artifact);
  if (!updaterAsset) throw new Error("Updater artifact was not staged");
  const fragment = buildUpdaterFragment({
    version: options.version,
    updaterTarget: plan.updaterTarget,
    assetName: updaterAsset.assetName,
    signature: readFileSync(updater.signature, "utf8"),
    repository: options.repository,
    commit,
  });
  const fragmentPath = join(stageRoot, `latest.${plan.updaterTarget}.json`);
  writeFileSync(fragmentPath, `${JSON.stringify(fragment, null, 2)}\n`);

  ensureRelease(tag, options.repository, commit);
  run("gh", [
    "release",
    "upload",
    tag,
    ...staged.map((entry) => entry.path),
    fragmentPath,
    "--clobber",
    "--repo",
    options.repository,
  ]);
  console.log(`Staged ${plan.updaterTarget} in draft release ${tag}`);
}

function publishRelease(options) {
  const tag = `v${options.version}`;
  console.log(
    JSON.stringify(
      {
        action: "publish",
        tag,
        repository: options.repository,
        requiredUpdaterTargets: options.allowPartial ? "partial explicitly allowed" : REQUIRED_UPDATER_TARGETS,
      },
      null,
      2,
    ),
  );
  if (options.dryRun) return;

  run("gh", ["auth", "status"]);
  const releaseJson = run(
    "gh",
    ["api", `repos/${options.repository}/releases/tags/${tag}`],
    { capture: true },
  );
  const release = JSON.parse(releaseJson);
  if (!release.draft) throw new Error(`${tag} is already published`);
  assertVersionIsNewer(options.version, latestStableTag(options.repository));
  const sourceCommit = release.target_commitish;
  if (!/^[a-f0-9]{40}$/i.test(sourceCommit)) {
    throw new Error("The draft release is not pinned to a full source commit SHA");
  }

  const downloadRoot = mkdtempSync(join(tmpdir(), "terax-local-release-"));
  try {
    run("gh", [
      "release",
      "download",
      tag,
      "--pattern",
      "latest.*.json",
      "--dir",
      downloadRoot,
      "--repo",
      options.repository,
    ]);
    const fragmentPaths = walkFiles(downloadRoot).filter((file) =>
      /^latest\.[^.]+-[^.]+\.json$/.test(basename(file)),
    );
    const fragments = fragmentPaths.map((file) => {
      const expectedTarget = basename(file).slice("latest.".length, -".json".length);
      const fragment = JSON.parse(readFileSync(file, "utf8"));
      validateUpdaterFragment(fragment, {
        expectedTarget,
        version: options.version,
        repository: options.repository,
        assetNames: new Set(release.assets.map((asset) => asset.name)),
        commit: sourceCommit,
      });
      return fragment;
    });
    const targets = new Set(
      fragments.flatMap((fragment) => Object.keys(fragment.platforms ?? {})),
    );
    const missing = REQUIRED_UPDATER_TARGETS.filter((target) => !targets.has(target));
    if (missing.length > 0 && !options.allowPartial) {
      throw new Error(
        `Cannot publish without updater targets: ${missing.join(", ")}. Stage them or pass --allow-partial explicitly`,
      );
    }
    const manifest = mergeUpdaterFragments(fragments, release.body ?? "");
    if (manifest.version !== options.version) {
      throw new Error(`Updater fragments contain ${manifest.version}, expected ${options.version}`);
    }
    const latestPath = join(downloadRoot, "latest.json");
    writeFileSync(latestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    run("gh", [
      "release",
      "upload",
      tag,
      latestPath,
      "--clobber",
      "--repo",
      options.repository,
    ]);
    run("gh", [
      "api",
      "--method",
      "PATCH",
      `repos/${options.repository}/releases/${release.id}`,
      "--field",
      "draft=false",
      "--silent",
    ]);
    console.log(`Published ${tag} with updater targets: ${[...targets].sort().join(", ")}`);
  } finally {
    rmSync(downloadRoot, { recursive: true, force: true });
  }
}

try {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    process.exit(0);
  }
  const options = parseReleaseArgs(process.argv.slice(2));
  if (options.publish) publishRelease(options);
  else stagePlatformRelease(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

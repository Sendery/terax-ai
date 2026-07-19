#!/usr/bin/env node
// Generate the companion Pi extension (`pi-terax-extension`) and upload it as an
// asset on the matching Sendery/terax-ai release (stable or dev prerelease), so
// every published Terax version ships its aligned extension in the same place.
//
// Usage:
//   node scripts/publish-extension.mjs <version> --tag <vX.Y.Z> [--repo OWNER/REPO]
//        [--out-dir <dir>] [--skip-build] [--no-upload] [--dry-run]
//
// The extension is platform-independent, so this runs once per release. Upload
// uses --clobber and is therefore idempotent across per-platform stage passes.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTENSION_PACKAGE_NAME,
  extensionAssetName,
  hardenExtensionManifest,
} from "./pi-extension-lib.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(repoRoot, "packages", "pi-terax");
const DEFAULT_REPOSITORY = "Sendery/terax-ai";

function parseArgs(argv) {
  const options = {
    version: undefined,
    tag: undefined,
    repository: DEFAULT_REPOSITORY,
    outDir: undefined,
    skipBuild: false,
    upload: true,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tag") options.tag = argv[++i];
    else if (arg === "--repo") options.repository = argv[++i];
    else if (arg === "--out-dir") options.outDir = argv[++i];
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--no-upload") options.upload = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!options.version && !arg.startsWith("-")) options.version = arg;
    else throw new Error(`Unknown publish-extension option: ${arg}`);
  }
  if (options.help) return options;
  if (!options.version) throw new Error("A release version is required");
  if (options.upload && !options.dryRun && !options.tag) {
    throw new Error("--tag <release tag> is required to upload the extension asset");
  }
  if (!options.repository.includes("/")) {
    throw new Error("The repository must use OWNER/REPO format");
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result.stdout.trim();
}

function stageExtension(version, stageDir) {
  const manifest = hardenExtensionManifest(
    JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")),
    version,
  );
  mkdirSync(stageDir, { recursive: true });
  for (const entry of manifest.files ?? ["dist"]) {
    const from = join(packageDir, entry);
    if (!existsSync(from)) {
      if (entry === "dist") throw new Error("packages/pi-terax/dist is missing; build first");
      continue;
    }
    cpSync(from, join(stageDir, entry), { recursive: true });
  }
  writeFileSync(
    join(stageDir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function packExtension(stageDir, outDir, version) {
  mkdirSync(outDir, { recursive: true });
  runCapture("npm", ["pack", "--ignore-scripts", "--pack-destination", outDir], {
    cwd: stageDir,
  });
  const packed = readdirSync(outDir).find(
    (name) => name.startsWith(EXTENSION_PACKAGE_NAME) && name.endsWith(".tgz"),
  );
  if (!packed) throw new Error("npm pack did not produce a tarball");
  const assetPath = join(outDir, extensionAssetName(version));
  if (join(outDir, packed) !== assetPath) {
    renameSync(join(outDir, packed), assetPath);
  }
  return assetPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: node scripts/publish-extension.mjs <version> --tag <vX> [--repo OWNER/REPO] [--out-dir <dir>] [--skip-build] [--no-upload] [--dry-run]",
    );
    return;
  }

  if (!options.skipBuild) {
    run("pnpm", ["--dir", packageDir, "build"], { cwd: repoRoot });
  }

  const workRoot = options.outDir
    ? options.outDir
    : mkdtempSync(join(tmpdir(), "pi-terax-extension-"));
  const stageDir = join(workRoot, "stage");
  try {
    const manifest = stageExtension(options.version, stageDir);
    const assetPath = packExtension(stageDir, workRoot, options.version);
    console.log(
      JSON.stringify(
        {
          action: "publish-extension",
          name: manifest.name,
          version: manifest.version,
          asset: extensionAssetName(options.version),
          tag: options.tag ?? null,
          repository: options.repository,
          upload: options.upload && !options.dryRun,
        },
        null,
        2,
      ),
    );

    if (!options.upload || options.dryRun) {
      console.log(`Staged extension asset at ${assetPath}`);
      return;
    }
    run("gh", [
      "release",
      "upload",
      options.tag,
      assetPath,
      "--clobber",
      "--repo",
      options.repository,
    ]);
    console.log(`Uploaded ${extensionAssetName(options.version)} to ${options.tag}`);
  } finally {
    if (!options.outDir) rmSync(workRoot, { recursive: true, force: true });
    else rmSync(stageDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

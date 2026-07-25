#!/usr/bin/env node
/**
 * Build the native installers for one development release and upload them to
 * its existing GitHub release. Development artifacts are deliberately not
 * signed and never generate updater manifests.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { developmentConfigOverride } from "./dev-release-config.mjs";

const DEFAULT_REPOSITORY = "Sendery/terax-ai";
const SEMVER = /^v?(\d+\.\d+\.\d+-[0-9A-Za-z.-]+)$/;

export function parseDevReleaseArgs(args) {
  const options = { repository: DEFAULT_REPOSITORY, upload: true, tag: undefined, version: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--repo") options.repository = args[++index];
    else if (value === "--no-upload") options.upload = false;
    else if (value === "--tag") options.tag = args[++index];
    else if (!options.version) options.version = value;
    else throw new Error(`Unknown release-development option: ${value}`);
  }
  const match = options.version?.match(SEMVER);
  if (!match) throw new Error("Use a development semver such as 0.9.0-dev.4");
  options.version = match[1];
  options.tag ??= `v${options.version}`;
  if (!options.repository?.includes("/")) throw new Error("--repo must use OWNER/REPO format");
  return options;
}

export function nativeBuildPlan(platform = process.platform, arch = process.arch) {
  if (platform === "linux" && arch === "x64") return { bundles: "appimage,deb,rpm", root: "src-tauri/target/release/bundle", label: "Linux x86_64" };
  if (platform === "win32" && arch === "x64") return { bundles: "nsis,msi", root: "src-tauri/target/release/bundle", label: "Windows x86_64" };
  if (platform === "darwin" && arch === "arm64") return { bundles: "app,dmg", target: "aarch64-apple-darwin", root: "src-tauri/target/aarch64-apple-darwin/release/bundle", label: "macOS ARM64" };
  if (platform === "darwin" && arch === "x64") return { bundles: "app,dmg", target: "x86_64-apple-darwin", root: "src-tauri/target/x86_64-apple-darwin/release/bundle", label: "macOS x86_64" };
  throw new Error(`Unsupported native development-release host: ${platform}/${arch}. Use a matching native host; cross-platform packaging is intentionally unsupported.`);
}

function trace(message, details = {}) {
  console.error(`[release-dev] ${message}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function run(command, args, options = {}) {
  trace("running command", { cwd: options.cwd, command, args });
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const output = options.capture ? `${result.stdout}\n${result.stderr}`.trim().slice(-4000) : "see command output above";
    throw new Error(`${command} exited with ${result.status}; ${output}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function filesRecursively(root, found = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) filesRecursively(path, found);
    else if (/\.(AppImage|deb|rpm|dmg|exe|msi)$/i.test(entry.name)) found.push(path);
  }
  return found;
}

export function developmentArtifacts(root) {
  if (!existsSync(root)) return [];
  return filesRecursively(root).filter((file) => !file.endsWith(".sig"));
}

function main() {
  let options;
  let configPath;
  try {
    options = parseDevReleaseArgs(process.argv.slice(2));
    const plan = nativeBuildPlan();
    const cacheRoot = process.env.TERAX_DEV_WORKTREE ?? join(homedir(), ".cache", "terax-dev-releases", options.tag);
    configPath = join(mkdtempSync(join(tmpdir(), "terax-dev-release-")), "tauri.dev-release.json");
    trace("release plan", { ...options, host: `${process.platform}/${process.arch}`, plan, cacheRoot });
    for (const tool of ["git", "gh", "node", "pnpm", "cargo"]) run(tool, ["--version"], { capture: true });
    run("gh", ["auth", "status"]);
    const release = JSON.parse(run("gh", ["release", "view", options.tag, "--repo", options.repository, "--json", "targetCommitish"], { capture: true }));
    if (!/^[0-9a-f]{40}$/i.test(release.targetCommitish ?? "")) throw new Error(`Release ${options.tag} has no immutable 40-character target commit`);
    if (!existsSync(join(cacheRoot, ".git"))) run("git", ["clone", `https://github.com/${options.repository}.git`, cacheRoot]);
    run("git", ["fetch", "origin", "--prune"], { cwd: cacheRoot });
    run("git", ["checkout", "--detach", release.targetCommitish], { cwd: cacheRoot });
    run("git", ["reset", "--hard", release.targetCommitish], { cwd: cacheRoot });
    run("git", ["clean", "-ffd"], { cwd: cacheRoot });
    const baseConfig = JSON.parse(readFileSync(join(cacheRoot, "src-tauri", "tauri.conf.json"), "utf8"));
    writeFileSync(configPath, JSON.stringify(developmentConfigOverride(baseConfig)));
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: cacheRoot });
    rmSync(join(cacheRoot, plan.root), { recursive: true, force: true });
    const buildArgs = ["scripts/build-version.mjs", options.version, "--", "--bundles", plan.bundles, "--no-sign", "--config", configPath];
    if (plan.target) buildArgs.push("--target", plan.target);
    run("node", buildArgs, { cwd: cacheRoot });
    const artifacts = developmentArtifacts(join(cacheRoot, plan.root));
    if (!artifacts.length) throw new Error(`No installers were produced below ${join(cacheRoot, plan.root)}. Check the preceding build trace.`);
    trace("validated artifacts", { artifacts: artifacts.map((file) => basename(file)) });
    if (options.upload) run("gh", ["release", "upload", options.tag, ...artifacts, "--repo", options.repository, "--clobber"]);
    trace("development release completed", { tag: options.tag, uploaded: options.upload, artifacts: artifacts.map((file) => basename(file)) });
  } catch (error) {
    trace("FAILED", { message: error.message, tag: options?.tag, repository: options?.repository, hint: "Keep the trace above; rerun the same command after fixing the reported prerequisite." });
    process.exitCode = 1;
  } finally {
    if (configPath) rmSync(configPath, { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

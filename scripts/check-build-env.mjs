#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const cargoBin = join(homedir(), ".cargo", "bin");
const env = {
  ...process.env,
  PATH: `${cargoBin}${delimiter}${process.env.PATH ?? ""}`,
};

function commandVersion(command, args) {
  const result = spawnSync(command, args, { env, encoding: "utf8" });
  if (result.status !== 0) return null;
  return (result.stdout || result.stderr).trim().split("\n")[0] ?? "";
}

function pnpmVersion() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const match = userAgent.match(/\bpnpm\/([^\s]+)/);
  return match ? match[1] : commandVersion("pnpm", ["--version"]);
}

function pkgExists(name) {
  const result = spawnSync("pkg-config", ["--exists", name], { env });
  return result.status === 0;
}

const tools = [
  ["node", () => commandVersion("node", ["--version"])],
  ["pnpm", pnpmVersion],
  ["cargo", () => commandVersion("cargo", ["--version"])],
  ["rustc", () => commandVersion("rustc", ["--version"])],
  ["tauri", () => commandVersion("pnpm", ["exec", "tauri", "--version"])],
];

let failed = false;
for (const [label, getVersion] of tools) {
  const version = getVersion();
  if (version) {
    console.log(`ok ${label}: ${version}`);
  } else {
    failed = true;
    console.log(`missing ${label}`);
  }
}

const packages = [
  ["dbus-1", "libdbus-1-dev"],
  ["gtk+-3.0", "libgtk-3-dev"],
  ["webkit2gtk-4.1", "libwebkit2gtk-4.1-dev"],
  ["ayatana-appindicator3-0.1", "libayatana-appindicator3-dev"],
  ["librsvg-2.0", "librsvg2-dev"],
  ["xdo", "libxdo-dev"],
  ["openssl", "libssl-dev"],
];

const missingApt = [];
if (process.platform === "linux") {
  for (const [pkg, apt] of packages) {
    if (pkgExists(pkg)) {
      console.log(`ok pkg-config: ${pkg}`);
    } else {
      failed = true;
      missingApt.push(apt);
      console.log(`missing pkg-config: ${pkg} (${apt})`);
    }
  }
}

if (!existsSync("node_modules")) {
  failed = true;
  console.log("missing node_modules: run pnpm install");
}

if (missingApt.length > 0) {
  console.log("");
  console.log("Install missing Ubuntu packages with:");
  console.log(`sudo apt-get update`);
  console.log(`sudo apt-get install -y ${[...new Set(missingApt)].join(" ")}`);
}

process.exit(failed ? 1 : 0);

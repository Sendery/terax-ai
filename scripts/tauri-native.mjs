import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
const withZig = fileURLToPath(new URL("./with-zig.mjs", import.meta.url));
const command = ["dev", "build", "bundle"].includes(args[0])
  ? [withZig, "--native-core", "--", process.execPath, cli, ...args]
  : [cli, ...args];
const result = spawnSync(process.execPath, command, { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

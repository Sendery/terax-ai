// Isolated macOS WebKit capture fixture; never starts or controls Terax.
import { build } from "vite";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const artifacts = ".terax/pi-development/graphx-capture";
mkdirSync(artifacts, { recursive: true });
await build({
  configFile: false,
  resolve: { alias: { "@": `${process.cwd()}/src` } },
  build: {
    outDir: artifacts,
    emptyOutDir: false,
    lib: {
      entry: "src/modules/capture/lib/rasterize.ts",
      name: "TeraxCapture",
      formats: ["iife"],
      fileName: () => "rasterize-fixture.js",
    },
  },
});
const binary = `${artifacts}/check-webkit`;
for (const [command, args] of [
  ["swiftc", ["scripts/check-graphx-webkit.swift", "-o", binary]],
  [binary, ["--composite"]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

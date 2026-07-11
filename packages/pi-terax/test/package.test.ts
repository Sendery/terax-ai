import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readPackageJson(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("Pi package metadata", () => {
  it("uses Pi host packages as peers and bundles the development skill", async () => {
    const manifest = await readPackageJson();
    const pi = manifest.pi as Record<string, unknown>;
    const peers = manifest.peerDependencies as Record<string, unknown>;
    const dependencies = manifest.dependencies as Record<string, unknown> | undefined;

    expect(pi.extensions).toEqual(["./dist/extension.js"]);
    expect(pi.skills).toEqual(["./skills"]);
    expect(manifest.files).toEqual(["dist", "skills", "README.md"]);
    expect(peers).toMatchObject({
      "@earendil-works/pi-coding-agent": "^0.80.3",
      typebox: "^1.1.38",
    });
    expect(dependencies?.["@earendil-works/pi-coding-agent"]).toBeUndefined();
    expect(dependencies?.typebox).toBeUndefined();
    const devDependencies = manifest.devDependencies as Record<string, unknown>;
    expect(devDependencies["@earendil-works/pi-coding-agent"]).toBe("0.80.3");
  });
});

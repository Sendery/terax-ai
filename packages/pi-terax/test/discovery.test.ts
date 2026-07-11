import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverTerax } from "../src/discovery.js";

describe("discoverTerax", () => {
  it("loads and validates the Terax discovery file from cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-terax-"));
    const cacheDir = join(dir, "cache");
    const file = join(cacheDir, "terax-ai", "pi-bridge.json");
    await writeFile(
      file,
      JSON.stringify({ version: 1, pid: 123, port: 40123, token: "tok" }),
      "utf8",
    ).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(cacheDir, "terax-ai"), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({ version: 1, pid: 123, port: 40123, token: "tok" }),
        "utf8",
      );
    });

    await expect(
      discoverTerax({ env: { XDG_CACHE_HOME: cacheDir }, platform: "linux" }),
    ).resolves.toEqual({
      version: 1,
      pid: 123,
      port: 40123,
      token: "tok",
    });
  });

  it("rejects malformed discovery data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-terax-"));
    const cacheDir = join(dir, "cache");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(cacheDir, "terax-ai"), { recursive: true });
    await writeFile(
      join(cacheDir, "terax-ai", "pi-bridge.json"),
      JSON.stringify({ version: 2, port: "bad", token: "" }),
      "utf8",
    );

    await expect(
      discoverTerax({ env: { XDG_CACHE_HOME: cacheDir }, platform: "linux" }),
    ).rejects.toThrow("Invalid Terax discovery file");
  });
});

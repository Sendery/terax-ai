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

  it("bundles the isolated development workflow and learning assets", async () => {
    const skillRoot = join(packageRoot, "skills", "terax-development");
    const [skill, gotchas, journalTemplate] = await Promise.all([
      readFile(join(skillRoot, "SKILL.md"), "utf8"),
      readFile(join(skillRoot, "references", "gotchas.md"), "utf8"),
      readFile(
        join(skillRoot, "templates", "implementation-journal.md"),
        "utf8",
      ),
    ]);

    expect(skill).toContain("## Branch and Worktree Protocol");
    expect(skill).toContain("## Gotcha Learning System");
    expect(skill).toContain("templates/implementation-journal.md");
    expect(gotchas).toContain("## Cross-Layer Change Matrix");
    expect(gotchas).toContain("## Catalog Maintenance");
    expect(journalTemplate).toContain("## Gotcha Candidates");
    expect(journalTemplate).toContain("## Verification Evidence");
  });

  it("bundles a skill for every shipped capability", async () => {
    const skillRoot = join(packageRoot, "skills");
    const [visualQa, tts] = await Promise.all([
      readFile(join(skillRoot, "terax-visual-qa", "SKILL.md"), "utf8"),
      readFile(join(skillRoot, "terax-tts", "SKILL.md"), "utf8"),
    ]);

    expect(visualQa).toContain("name: terax-visual-qa");
    expect(tts).toContain("name: terax-tts");
    expect(tts).toContain("## When to Speak");
    expect(tts).toContain("## Text Formatting per Model");
    expect(tts).toContain("## Install and Start Flow");
    expect(tts).toContain("## Privacy");
    // The three tags the model README documents must stay called out.
    expect(tts).toContain("[laugh]");
    expect(tts).toContain("[cough]");
    expect(tts).toContain("[chuckle]");
  });

  it("bundles the local sidecar gotchas so the constraints travel with the skill", async () => {
    const gotchas = await readFile(
      join(
        packageRoot,
        "skills",
        "terax-development",
        "references",
        "gotchas.md",
      ),
      "utf8",
    );

    expect(gotchas).toContain("## Local Sidecars and Python Runtimes");
  });
});

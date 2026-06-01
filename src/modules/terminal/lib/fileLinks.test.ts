import { describe, expect, it, vi } from "vitest";
import {
  extractPathCandidates,
  resolveCandidatePath,
  resolveTerminalFileLinks,
} from "./fileLinks";

describe("terminal file links", () => {
  it("extracts plain, quoted, escaped, and location-suffixed paths", () => {
    expect(
      extractPathCandidates(
        `README.md "src/app/App.tsx" My\\ File.txt src/main.tsx:12:3`,
      ).map((c) => c.text),
    ).toEqual([
      "README.md",
      "src/app/App.tsx",
      "My\\ File.txt",
      "src/main.tsx",
    ]);
  });

  it("resolves relative paths against the terminal cwd", () => {
    expect(resolveCandidatePath("src/app/App.tsx", "/repo", "/home/me")).toBe(
      "/repo/src/app/App.tsx",
    );
    expect(resolveCandidatePath("./src/main.tsx", "/repo", "/home/me")).toBe(
      "/repo/src/main.tsx",
    );
  });

  it("resolves home and Windows-style paths to the frontend canonical form", () => {
    expect(resolveCandidatePath("~/notes.txt", "/repo", "/home/me")).toBe(
      "/home/me/notes.txt",
    );
    expect(resolveCandidatePath("C:\\Users\\me\\a.txt", "/repo", null)).toBe(
      "C:/Users/me/a.txt",
    );
  });

  it("returns only stat-confirmed files", async () => {
    const stat = vi.fn(async (path: string) => {
      if (path.endsWith("README.md")) return { kind: "file" as const };
      if (path.endsWith("src")) return { kind: "dir" as const };
      return null;
    });

    const links = await resolveTerminalFileLinks({
      line: "README.md src missing.txt",
      cwd: "/repo",
      home: "/home/me",
      stat,
    });

    expect(links).toEqual([
      {
        text: "README.md",
        path: "/repo/README.md",
        start: 0,
        end: 9,
      },
    ]);
    expect(stat).toHaveBeenCalledWith("/repo/README.md");
    expect(stat).toHaveBeenCalledWith("/repo/src");
    expect(stat).toHaveBeenCalledWith("/repo/missing.txt");
  });
});

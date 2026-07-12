import { describe, expect, it } from "vitest";
import {
  createBuildInfo,
  normalizeBranchName,
} from "./build-info.mjs";

describe("build metadata collection", () => {
  it("uses explicit release metadata when the build host provides it", () => {
    const info = createBuildInfo({
      env: {
        TERAX_BUILD_BRANCH: "refs/heads/hardening/local-releases",
        TERAX_BUILD_COMMIT: "902fc9e3c02baf185fbe86b4d2df5aadaeae99a1",
        TERAX_BUILD_DATE: "2026-07-12T13:40:16.000Z",
        TERAX_BUILD_REPOSITORY: "Sendery/terax-ai",
      },
      version: "0.9.0-0",
      git: () => {
        throw new Error("git should not be called when metadata is explicit");
      },
      now: () => "ignored",
    });

    expect(info).toEqual({
      repository: "Sendery/terax-ai",
      branch: "hardening/local-releases",
      commit: "902fc9e3c02baf185fbe86b4d2df5aadaeae99a1",
      builtAt: "2026-07-12T13:40:16.000Z",
      channel: "development",
    });
  });

  it("resolves detached builds to their remote branch and marks stable versions official", () => {
    const commands = new Map([
      ["branch --show-current", ""],
      ["name-rev --name-only --exclude=tags/* HEAD", "remotes/origin/develop"],
      ["rev-parse HEAD", "abcdef1234567890abcdef1234567890abcdef12"],
    ]);
    const info = createBuildInfo({
      env: {},
      version: "0.9.0",
      git: (args) => commands.get(args.join(" ")) ?? "",
      now: () => "2026-07-13T09:30:00.000Z",
    });

    expect(info.branch).toBe("develop");
    expect(info.commit).toBe("abcdef1234567890abcdef1234567890abcdef12");
    expect(info.channel).toBe("official");
  });

  it.each([
    ["refs/heads/feature/about", "feature/about"],
    ["remotes/origin/develop", "develop"],
    ["origin/hardening/local-releases", "hardening/local-releases"],
    ["HEAD", "detached"],
    ["", "unknown"],
  ])("normalizes branch %s", (input, expected) => {
    expect(normalizeBranchName(input)).toBe(expected);
  });
});

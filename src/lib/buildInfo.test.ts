import { describe, expect, it } from "vitest";
import {
  buildChannelLabel,
  buildCommitUrl,
  formatBuildDate,
  shortCommit,
} from "./buildInfo";

describe("About build tracking", () => {
  it("formats development and official channels", () => {
    expect(buildChannelLabel("development")).toBe("Development");
    expect(buildChannelLabel("official")).toBe("Official");
  });

  it("links the exact source commit in the configured repository", () => {
    expect(
      buildCommitUrl(
        "Sendery/terax-ai",
        "902fc9e3c02baf185fbe86b4d2df5aadaeae99a1",
      ),
    ).toBe(
      "https://github.com/Sendery/terax-ai/commit/902fc9e3c02baf185fbe86b4d2df5aadaeae99a1",
    );
    expect(shortCommit("902fc9e3c02baf185fbe86b4d2df5aadaeae99a1")).toBe(
      "902fc9e",
    );
  });

  it("keeps an ISO timestamp available while producing a readable date", () => {
    const result = formatBuildDate("2026-07-12T13:40:16.000Z", "en-GB");
    expect(result).toContain("12 Jul 2026");
    expect(result).toContain("13:40");
  });
});

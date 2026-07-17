import { describe, expect, it } from "vitest";
import {
  githubPrApiUrl,
  githubStatusApiUrl,
  jiraIssueApiUrl,
  jiraOrigin,
  parseGithubCombinedStatus,
  parseGithubPrResponse,
  parseJiraStatusResponse,
} from "./liveStatus";

const ref = { owner: "acme", repo: "widgets", number: 42 };

describe("github api urls", () => {
  it("builds the PR url", () => {
    expect(githubPrApiUrl(ref)).toBe(
      "https://api.github.com/repos/acme/widgets/pulls/42",
    );
  });
  it("builds the combined status url for a sha", () => {
    expect(githubStatusApiUrl(ref, "abc123")).toBe(
      "https://api.github.com/repos/acme/widgets/commits/abc123/status",
    );
  });
});

describe("parseGithubPrResponse", () => {
  it("maps merged", () => {
    expect(
      parseGithubPrResponse({ state: "closed", merged: true, head: { sha: "s" } }),
    ).toEqual({ prState: "merged", headSha: "s" });
  });
  it("maps draft (open + draft)", () => {
    expect(
      parseGithubPrResponse({ state: "open", draft: true, head: { sha: "s" } }),
    ).toEqual({ prState: "draft", headSha: "s" });
  });
  it("maps open and closed", () => {
    expect(parseGithubPrResponse({ state: "open", head: { sha: "a" } })).toEqual({
      prState: "open",
      headSha: "a",
    });
    expect(
      parseGithubPrResponse({ state: "closed", merged: false, head: { sha: "b" } }),
    ).toEqual({ prState: "closed", headSha: "b" });
  });
  it("falls back to unknown for garbage", () => {
    expect(parseGithubPrResponse(null)).toEqual({
      prState: "unknown",
      headSha: null,
    });
    expect(parseGithubPrResponse({})).toEqual({
      prState: "unknown",
      headSha: null,
    });
  });
});

describe("parseGithubCombinedStatus", () => {
  it("maps no checks to none", () => {
    expect(parseGithubCombinedStatus({ state: "pending", total_count: 0 })).toBe(
      "none",
    );
  });
  it("maps states", () => {
    expect(
      parseGithubCombinedStatus({ state: "success", total_count: 3 }),
    ).toBe("success");
    expect(
      parseGithubCombinedStatus({ state: "failure", total_count: 3 }),
    ).toBe("failure");
    expect(
      parseGithubCombinedStatus({ state: "pending", total_count: 1 }),
    ).toBe("pending");
    expect(parseGithubCombinedStatus({ state: "error", total_count: 1 })).toBe(
      "error",
    );
  });
  it("falls back to none on garbage", () => {
    expect(parseGithubCombinedStatus(null)).toBe("none");
    expect(parseGithubCombinedStatus({ state: "weird", total_count: 2 })).toBe(
      "none",
    );
  });
});

describe("jira", () => {
  it("derives the origin from a browse url", () => {
    expect(jiraOrigin("https://acme.atlassian.net/browse/PROJ-9")).toBe(
      "https://acme.atlassian.net",
    );
    expect(jiraOrigin("not a url")).toBeNull();
  });
  it("builds the issue api url", () => {
    expect(
      jiraIssueApiUrl("https://acme.atlassian.net/browse/PROJ-9", "PROJ-9"),
    ).toBe("https://acme.atlassian.net/rest/api/3/issue/PROJ-9?fields=status");
  });
  it("maps status categories", () => {
    const mk = (key: string, name: string) => ({
      fields: { status: { name, statusCategory: { key } } },
    });
    expect(parseJiraStatusResponse(mk("new", "To Do"))).toEqual({
      status: "todo",
      statusName: "To Do",
    });
    expect(parseJiraStatusResponse(mk("indeterminate", "In Progress"))).toEqual({
      status: "in-progress",
      statusName: "In Progress",
    });
    expect(parseJiraStatusResponse(mk("done", "Done"))).toEqual({
      status: "done",
      statusName: "Done",
    });
  });
  it("falls back to unknown on garbage", () => {
    expect(parseJiraStatusResponse(null)).toEqual({
      status: "unknown",
      statusName: null,
    });
  });
});

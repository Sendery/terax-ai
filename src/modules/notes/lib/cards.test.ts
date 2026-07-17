import { describe, expect, it } from "vitest";
import {
  createCardFromUrl,
  createTextCard,
  detectProvider,
  isNoteCard,
  parseGithubPrUrl,
  parseJiraIssueKey,
  type NoteCard,
} from "./cards";

describe("detectProvider", () => {
  it("classifies GitHub pull request URLs", () => {
    expect(
      detectProvider("https://github.com/acme/widgets/pull/42"),
    ).toBe("github-pr");
  });

  it("does not treat a bare GitHub repo URL as a PR", () => {
    expect(detectProvider("https://github.com/acme/widgets")).toBe("generic");
  });

  it("classifies Jira issue URLs", () => {
    expect(
      detectProvider("https://acme.atlassian.net/browse/PROJ-123"),
    ).toBe("jira");
  });

  it("classifies Notion URLs (notion.so and notion.site)", () => {
    expect(detectProvider("https://www.notion.so/acme/Page-abc123")).toBe(
      "notion",
    );
    expect(detectProvider("https://acme.notion.site/Page-abc")).toBe("notion");
  });

  it("classifies Figma URLs", () => {
    expect(
      detectProvider("https://www.figma.com/file/AbC/Design?node-id=1"),
    ).toBe("figma");
  });

  it("classifies Obsidian deep links", () => {
    expect(
      detectProvider("obsidian://open?vault=Notes&file=Todo"),
    ).toBe("obsidian");
  });

  it("falls back to generic for unknown or invalid URLs", () => {
    expect(detectProvider("https://example.com/thing")).toBe("generic");
    expect(detectProvider("not a url")).toBe("generic");
  });
});

describe("parseGithubPrUrl", () => {
  it("extracts owner, repo and number", () => {
    expect(parseGithubPrUrl("https://github.com/acme/widgets/pull/42")).toEqual({
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
  });

  it("returns null for non-PR GitHub URLs", () => {
    expect(parseGithubPrUrl("https://github.com/acme/widgets")).toBeNull();
    expect(
      parseGithubPrUrl("https://github.com/acme/widgets/issues/42"),
    ).toBeNull();
  });
});

describe("parseJiraIssueKey", () => {
  it("extracts the issue key from a browse URL", () => {
    expect(
      parseJiraIssueKey("https://acme.atlassian.net/browse/PROJ-123"),
    ).toBe("PROJ-123");
  });

  it("returns null when there is no key", () => {
    expect(parseJiraIssueKey("https://acme.atlassian.net/jira/software")).toBeNull();
  });
});

describe("createTextCard", () => {
  it("creates a valid text card with body and optional title", () => {
    const card = createTextCard("hello world", "My note");
    expect(card.kind).toBe("text");
    expect(card).toMatchObject({ body: "hello world", title: "My note" });
    expect(typeof card.id).toBe("string");
    expect(card.id.length).toBeGreaterThan(0);
    expect(card.createdAt).toBeGreaterThan(0);
    expect(card.updatedAt).toBeGreaterThanOrEqual(card.createdAt);
    expect(isNoteCard(card)).toBe(true);
  });
});

describe("createCardFromUrl", () => {
  it("builds a github-pr card with parsed reference", () => {
    const card = createCardFromUrl("https://github.com/acme/widgets/pull/42");
    expect(card.kind).toBe("github-pr");
    if (card.kind !== "github-pr") throw new Error("expected github-pr");
    expect(card.url).toBe("https://github.com/acme/widgets/pull/42");
    expect(card.owner).toBe("acme");
    expect(card.repo).toBe("widgets");
    expect(card.number).toBe(42);
    // No live fetch yet -> unknown/none states are the safe defaults.
    expect(card.prState).toBe("unknown");
    expect(card.ciState).toBe("none");
    expect(isNoteCard(card)).toBe(true);
  });

  it("builds a jira card with parsed issue key", () => {
    const card = createCardFromUrl("https://acme.atlassian.net/browse/PROJ-7");
    expect(card.kind).toBe("jira");
    if (card.kind !== "jira") throw new Error("expected jira");
    expect(card.issueKey).toBe("PROJ-7");
    expect(card.status).toBe("unknown");
    expect(isNoteCard(card)).toBe(true);
  });

  it("builds notion/figma/obsidian link cards", () => {
    expect(createCardFromUrl("https://acme.notion.site/x").kind).toBe("notion");
    expect(createCardFromUrl("https://figma.com/file/x").kind).toBe("figma");
    expect(createCardFromUrl("obsidian://open?vault=v&file=f").kind).toBe(
      "obsidian",
    );
  });

  it("builds a generic link card when the provider is unknown", () => {
    const card = createCardFromUrl("https://example.com/x");
    expect(card.kind).toBe("link");
    expect(isNoteCard(card)).toBe(true);
  });
});

describe("isNoteCard", () => {
  it("rejects malformed values", () => {
    expect(isNoteCard(null)).toBe(false);
    expect(isNoteCard(undefined)).toBe(false);
    expect(isNoteCard({})).toBe(false);
    expect(isNoteCard({ kind: "text" })).toBe(false); // missing id/body
    expect(isNoteCard({ kind: "mystery", id: "1", body: "x" })).toBe(false);
    expect(
      isNoteCard({ kind: "github-pr", id: "1" } as unknown),
    ).toBe(false); // missing url
  });

  it("accepts a well-formed link card with an invalid prState coerced away", () => {
    const good: NoteCard = createCardFromUrl(
      "https://github.com/a/b/pull/1",
    );
    expect(isNoteCard(good)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { createCardFromUrl, createTextCard } from "./cards";
import {
  cardAccessibleLabel,
  cardKindLabel,
  cardTitle,
  ciStateLabel,
  jiraStatusLabel,
  prStateLabel,
} from "./presentation";

describe("cardKindLabel", () => {
  it("maps each kind to a human label", () => {
    expect(cardKindLabel(createTextCard("x"))).toBe("Text");
    expect(cardKindLabel(createCardFromUrl("https://example.com"))).toBe("Link");
    expect(
      cardKindLabel(createCardFromUrl("https://github.com/a/b/pull/1")),
    ).toBe("GitHub PR");
    expect(
      cardKindLabel(createCardFromUrl("https://x.atlassian.net/browse/PROJ-1")),
    ).toBe("Jira");
    expect(cardKindLabel(createCardFromUrl("https://x.notion.site/y"))).toBe(
      "Notion",
    );
    expect(cardKindLabel(createCardFromUrl("https://figma.com/file/x"))).toBe(
      "Figma",
    );
    expect(
      cardKindLabel(createCardFromUrl("obsidian://open?vault=v&file=f")),
    ).toBe("Obsidian");
  });
});

describe("cardTitle", () => {
  it("prefers an explicit title", () => {
    expect(cardTitle(createTextCard("body text", "Explicit"))).toBe("Explicit");
  });

  it("derives a text title from the first line of the body", () => {
    expect(cardTitle(createTextCard("line one\nline two"))).toBe("line one");
  });

  it("falls back for an empty text body", () => {
    expect(cardTitle(createTextCard("   "))).toBe("Untitled note");
  });

  it("derives owner/repo#number for a GitHub PR", () => {
    expect(cardTitle(createCardFromUrl("https://github.com/acme/widgets/pull/42"))).toBe(
      "acme/widgets #42",
    );
  });

  it("derives the issue key for Jira", () => {
    expect(cardTitle(createCardFromUrl("https://x.atlassian.net/browse/PROJ-9"))).toBe(
      "PROJ-9",
    );
  });

  it("derives the host for a generic link", () => {
    expect(cardTitle(createCardFromUrl("https://www.notion.so/page"))).toBe(
      "www.notion.so",
    );
  });
});

describe("state labels", () => {
  it("labels PR states", () => {
    expect(prStateLabel("open")).toBe("open");
    expect(prStateLabel("merged")).toBe("merged");
    expect(prStateLabel("unknown")).toBe("status unknown");
  });
  it("labels CI states", () => {
    expect(ciStateLabel("success")).toBe("passing");
    expect(ciStateLabel("failure")).toBe("failing");
    expect(ciStateLabel("none")).toBe("no checks");
  });
  it("labels Jira statuses", () => {
    expect(jiraStatusLabel("in-progress")).toBe("in progress");
    expect(jiraStatusLabel("done")).toBe("done");
  });
});

describe("cardAccessibleLabel", () => {
  it("announces PR state and CI state for a GitHub PR card", () => {
    const card = createCardFromUrl("https://github.com/acme/widgets/pull/42");
    const label = cardAccessibleLabel(card);
    expect(label).toContain("GitHub PR");
    expect(label).toContain("acme/widgets #42");
    expect(label).toContain("status unknown"); // pr state
    expect(label).toContain("no checks"); // ci state
  });

  it("announces the Jira status", () => {
    const card = createCardFromUrl("https://x.atlassian.net/browse/PROJ-9");
    expect(cardAccessibleLabel(card)).toContain("PROJ-9");
    expect(cardAccessibleLabel(card)).toContain("status unknown");
  });

  it("announces a text note", () => {
    expect(cardAccessibleLabel(createTextCard("hello", "Greeting"))).toContain(
      "Greeting",
    );
  });
});

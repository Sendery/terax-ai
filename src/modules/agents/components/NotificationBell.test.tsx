import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TONE_MARK } from "../lib/marks";
import type { AgentNotification } from "../lib/types";
import { NotificationRow } from "./NotificationBell";

const base: AgentNotification = {
  id: "n1",
  source: "terminal",
  leafId: 1,
  tabId: 10,
  agent: "claude",
  kind: "attention",
  tone: "question",
  reason: "question",
  at: Date.now(),
  read: false,
  tabTitle: "terax",
  tabColor: "blue",
  sessionName: "fix dead keys",
  text: "Claude is waiting for your input",
  body: "Merge into develop now?",
  subtitle: "terax · PR #42",
};

function render(over: Partial<AgentNotification> = {}): string {
  return renderToStaticMarkup(
    <NotificationRow
      n={{ ...base, ...over }}
      onClick={() => {}}
      onDismiss={() => {}}
    />,
  );
}

describe("NotificationRow", () => {
  it("shows what the native notification says, not the raw hook text", () => {
    const html = render();
    expect(html).toContain(TONE_MARK.question);
    expect(html).toContain("fix dead keys");
    expect(html).toContain("is asking you");
    expect(html).toContain("Merge into develop now?");
    expect(html).not.toContain("Claude is waiting for your input");
    expect(html).toContain("PR #42");
  });

  it("offers a dismiss button on every row", () => {
    expect(render()).toContain('aria-label="Dismiss notification"');
  });

  it("stops highlighting a row once read", () => {
    expect(render({ read: false })).toContain("bg-accent/40");
    expect(render({ read: true })).not.toContain("bg-accent/40");
  });
});

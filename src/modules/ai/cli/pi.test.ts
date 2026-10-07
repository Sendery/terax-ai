import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  isPiModelPattern,
  parsePiModelList,
  PI_READ_ONLY_TOOLS,
  piDefaultModelLabel,
  piSessionId,
  planPiRun,
  planPiTurn,
  readPiMeta,
} from "./pi";
import type { CliRunContext } from "./types";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string, pi?: unknown): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
    ...(pi === undefined ? {} : { metadata: { pi } }),
  };
}

const opts = { chatSessionId: "s-abc-123", cwd: "/repo", nonce: "n1" };

describe("planPiTurn", () => {
  it("starts a fresh session with the bare message on the first turn", () => {
    const plan = planPiTurn([user("u1", "hola")], opts);
    expect(plan.resumed).toBe(false);
    expect(plan.sessionId).toBe("terax-s-abc-123-n1");
    expect(plan.prompt).toBe("hola");
    expect(plan.meta).toEqual({
      sessionId: "terax-s-abc-123-n1",
      cwd: "/repo",
      userTurns: 1,
    });
  });

  it("resumes when Pi answered exactly the previous turn in the same cwd", () => {
    const meta = { sessionId: "terax-s-abc-123-n0", cwd: "/repo", userTurns: 1 };
    const plan = planPiTurn(
      [user("u1", "uno"), assistant("a1", "vale", meta), user("u2", "dos")],
      opts,
    );
    expect(plan.resumed).toBe(true);
    expect(plan.sessionId).toBe("terax-s-abc-123-n0");
    expect(plan.prompt).toBe("dos");
    expect(plan.meta.userTurns).toBe(2);
  });

  it("replays the transcript into a new session when another model answered", () => {
    const plan = planPiTurn(
      [user("u1", "uno"), assistant("a1", "respuesta"), user("u2", "dos")],
      opts,
    );
    expect(plan.resumed).toBe(false);
    expect(plan.prompt).toContain("Conversation so far:");
    expect(plan.prompt).toContain("Assistant: respuesta");
    expect(plan.prompt).toContain("Current request:\ndos");
  });

  it("does not resume across a cwd change, since Pi groups sessions by project", () => {
    const meta = { sessionId: "terax-x", cwd: "/other", userTurns: 1 };
    const plan = planPiTurn(
      [user("u1", "uno"), assistant("a1", "vale", meta), user("u2", "dos")],
      opts,
    );
    expect(plan.resumed).toBe(false);
    expect(plan.sessionId).toBe("terax-s-abc-123-n1");
  });

  it("does not resume after the history was edited", () => {
    const meta = { sessionId: "terax-x", cwd: "/repo", userTurns: 3 };
    const plan = planPiTurn(
      [user("u1", "uno"), assistant("a1", "vale", meta), user("u2", "dos")],
      opts,
    );
    expect(plan.resumed).toBe(false);
  });

  it("ignores messages after the last user turn", () => {
    const plan = planPiTurn([user("u1", "uno"), assistant("a1", "parcial")], opts);
    expect(plan.prompt).toBe("uno");
  });
});

describe("readPiMeta", () => {
  it("rejects malformed metadata", () => {
    expect(readPiMeta(assistant("a", "x", { sessionId: "", cwd: null, userTurns: 1 }))).toBeNull();
    expect(readPiMeta(assistant("a", "x", { sessionId: "s", cwd: 3, userTurns: 1 }))).toBeNull();
    expect(readPiMeta(assistant("a", "x", { sessionId: "s", cwd: null, userTurns: 0 }))).toBeNull();
    expect(readPiMeta(assistant("a", "x", "nope"))).toBeNull();
    expect(readPiMeta(undefined)).toBeNull();
  });
});

describe("piSessionId", () => {
  it("keeps only characters Pi accepts and starts and ends alphanumeric", () => {
    expect(piSessionId("a b/c!", "z")).toBe("terax-a-b-c-z");
    expect(piSessionId(null, "1")).toBe("terax-chat-1");
    expect(piSessionId("x", "-")).toMatch(/^[A-Za-z0-9].*[A-Za-z0-9]$/);
    expect(piSessionId("y".repeat(300), "n").length).toBeLessThanOrEqual(120);
  });
});

describe("planPiRun", () => {
  const base: CliRunContext = {
    messages: [user("u1", "@src/main.ts explica")],
    cwd: "/repo",
    permission: "acceptEdits",
    chatSessionId: "s-1",
    nonce: "n",
  };

  it("sends the prompt over stdin, never as an argument", () => {
    const plan = planPiRun(base);
    expect(plan.stdin).toBe("@src/main.ts explica");
    expect(plan.argv).not.toContain("@src/main.ts explica");
    expect(plan.argv.slice(0, 6)).toEqual([
      "pi",
      "--mode",
      "json",
      "--print",
      "--session-id",
      "terax-s-1-n",
    ]);
    expect(plan.bridge).toBe(true);
    expect(plan.metadata).toEqual({
      pi: { sessionId: "terax-s-1-n", cwd: "/repo", userTurns: 1 },
    });
  });

  it("maps each permission posture to a tool denylist", () => {
    const argvFor = (permission: CliRunContext["permission"]) =>
      planPiRun({ ...base, permission }).argv;
    const readOnly = argvFor("default");
    expect(readOnly[readOnly.indexOf("--tools") + 1]).toBe(PI_READ_ONLY_TOOLS.join(","));
    expect(readOnly).not.toContain("--exclude-tools");
    expect(PI_READ_ONLY_TOOLS).not.toContain("terax_call");
    expect(PI_READ_ONLY_TOOLS).not.toContain("bash");
    const edits = argvFor("acceptEdits");
    expect(edits[edits.indexOf("--exclude-tools") + 1]).toBe("bash,powershell");
    expect(argvFor("full")).not.toContain("--exclude-tools");
    expect(argvFor("full")).not.toContain("--tools");
  });

  it("forces the read-only posture in plan mode", () => {
    const plan = planPiRun({ ...base, permission: "full", planMode: true });
    expect(plan.argv).toContain(PI_READ_ONLY_TOOLS.join(","));
    const system = plan.argv[plan.argv.indexOf("--append-system-prompt") + 1];
    expect(system).toContain("Plan mode");
  });

  it("passes a valid model pattern and drops anything else", () => {
    const withModel = planPiRun({ ...base, model: "anthropic/claude-opus-5:high" }).argv;
    expect(withModel).toContain("anthropic/claude-opus-5:high");
    const bad = planPiRun({ ...base, model: "--api-key=x" }).argv;
    expect(bad).not.toContain("--model");
  });

  it("tells Pi about the chat panel and carries persona and instructions", () => {
    const plan = planPiRun({
      ...base,
      persona: { name: "Coder", instructions: "Be terse." },
      customInstructions: "Answer in Spanish.",
    });
    const system = plan.argv[plan.argv.indexOf("--append-system-prompt") + 1];
    expect(system).toContain("terax_call");
    expect(system).toContain("Be terse.");
    expect(system).toContain("Answer in Spanish.");
  });
});

describe("parsePiModelList", () => {
  it("parses the table and skips the header and junk", () => {
    const models = parsePiModelList([
      "provider   model                       context  max-out  thinking  images",
      "anthropic  claude-opus-5               1M       128K     yes       yes   ",
      "openai     gpt-5.4-mini                400K     128K     no        no",
      "",
      "Warning: something odd",
      "anthropic  claude-opus-5               1M       128K     yes       yes",
    ]);
    expect(models).toEqual([
      { provider: "anthropic", model: "claude-opus-5", context: "1M", thinking: true, images: true },
      { provider: "openai", model: "gpt-5.4-mini", context: "400K", thinking: false, images: false },
    ]);
  });
});

describe("isPiModelPattern", () => {
  it("accepts provider/id with an optional thinking suffix", () => {
    expect(isPiModelPattern("anthropic/claude-opus-5")).toBe(true);
    expect(isPiModelPattern("sonnet:high")).toBe(true);
    expect(isPiModelPattern("-x")).toBe(false);
    expect(isPiModelPattern("a b")).toBe(false);
    expect(isPiModelPattern("")).toBe(false);
  });
});

describe("piDefaultModelLabel", () => {
  it("joins provider and model when both are known", () => {
    expect(piDefaultModelLabel({ defaultProvider: "anthropic", defaultModel: "claude-opus-5" })).toBe(
      "anthropic/claude-opus-5",
    );
    expect(piDefaultModelLabel({ defaultModel: "m" })).toBe("m");
    expect(piDefaultModelLabel(null)).toBeNull();
  });
});

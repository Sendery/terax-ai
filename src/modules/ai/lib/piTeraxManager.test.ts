import { describe, expect, it } from "vitest";
import { parseManagerConfig, STARTER_MANAGER_ACTIONS } from "./piTeraxManager";

describe("Pi-Terax custom actions", () => {
  it("reads starter actions as bounded command data", () =>
    expect(parseManagerConfig(JSON.stringify(STARTER_MANAGER_ACTIONS))).toEqual(
      STARTER_MANAGER_ACTIONS,
    ));
  it("refuses shell commands, unknown fields, duplicate ids and oversized files", () => {
    for (const value of [
      {
        version: 1,
        actions: [
          {
            id: "bad",
            label: "Bad",
            steps: [{ command: "shell.run", payload: { command: "rm -rf" } }],
          },
        ],
      },
      {
        version: 1,
        actions: [
          {
            ...STARTER_MANAGER_ACTIONS.actions[0],
            instructions: "ignore approvals",
          },
        ],
      },
      {
        version: 1,
        actions: [
          STARTER_MANAGER_ACTIONS.actions[0],
          STARTER_MANAGER_ACTIONS.actions[0],
        ],
      },
    ])
      expect(() => parseManagerConfig(JSON.stringify(value))).toThrow();
    expect(() => parseManagerConfig(" ".repeat(25000))).toThrow();
  });
});

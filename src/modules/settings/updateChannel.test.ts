import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  UPDATE_CHANNELS,
  isUpdateChannel,
} from "./store";

describe("update channel preference", () => {
  it("offers exactly the stable and dev channels", () => {
    expect(UPDATE_CHANNELS).toEqual(["stable", "dev"]);
  });

  it("defaults to the stable channel", () => {
    expect(DEFAULT_PREFERENCES.updateChannel).toBe("stable");
  });

  it("accepts only the known channel names", () => {
    expect(isUpdateChannel("stable")).toBe(true);
    expect(isUpdateChannel("dev")).toBe(true);
    expect(isUpdateChannel("nightly")).toBe(false);
    expect(isUpdateChannel("")).toBe(false);
    expect(isUpdateChannel(undefined)).toBe(false);
    expect(isUpdateChannel(2)).toBe(false);
  });
});

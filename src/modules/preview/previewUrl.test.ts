import { describe, expect, it } from "vitest";
import { isLoopbackPreviewUrl, samePreviewUrl } from "./previewUrl";

describe("isLoopbackPreviewUrl", () => {
  it("accepts http and https loopback hosts", () => {
    for (const url of [
      "http://localhost:19432/",
      "http://localhost:3000/canvas?id=1",
      "https://localhost:8443",
      "http://127.0.0.1:5173",
      "http://0.0.0.0:8080",
      "http://[::1]:5173/",
      "http://app.localhost:4000",
      "HTTP://LOCALHOST:19432/",
    ]) {
      expect(isLoopbackPreviewUrl(url), url).toBe(true);
    }
  });

  it("rejects non-loopback hosts", () => {
    for (const url of [
      "http://example.com",
      "https://localhost.evil.com/",
      "http://127.0.0.1.evil.com/",
      "http://192.168.1.10:8080",
      "http://[fe80::1]/",
    ]) {
      expect(isLoopbackPreviewUrl(url), url).toBe(false);
    }
  });

  it("rejects non-http schemes and malformed values", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "localhost:19432",
      "",
      "   ",
    ]) {
      expect(isLoopbackPreviewUrl(url), url).toBe(false);
    }
  });

  it("rejects non-string values", () => {
    for (const value of [undefined, null, 42, {}, ["http://localhost"]]) {
      expect(isLoopbackPreviewUrl(value)).toBe(false);
    }
  });
});

describe("samePreviewUrl", () => {
  it("matches equivalent loopback URLs", () => {
    expect(
      samePreviewUrl("http://localhost:19432", "http://localhost:19432/"),
    ).toBe(true);
    expect(
      samePreviewUrl(
        "HTTP://LocalHost:19432/canvas",
        "http://localhost:19432/canvas",
      ),
    ).toBe(true);
  });

  it("does not match different resources or invalid input", () => {
    expect(
      samePreviewUrl("http://localhost:19432/", "http://localhost:19433/"),
    ).toBe(false);
    expect(
      samePreviewUrl("http://localhost:19432/a", "http://localhost:19432/b"),
    ).toBe(false);
    expect(samePreviewUrl("http://example.com", "http://example.com")).toBe(
      false,
    );
    expect(samePreviewUrl(undefined, undefined)).toBe(false);
  });
});

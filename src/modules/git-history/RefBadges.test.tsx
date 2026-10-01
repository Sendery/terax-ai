import type { GitRef } from "@/modules/ai/lib/native";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RefBadges } from "./RefBadges";

const ref = (name: string, kind: GitRef["kind"], isHead = false): GitRef => ({
  name,
  kind,
  isHead,
});

describe("RefBadges", () => {
  it("renders nothing for an undecorated commit", () => {
    expect(renderToStaticMarkup(<RefBadges refs={[]} />)).toBe("");
  });

  it("names each ref and what kind it is", () => {
    const html = renderToStaticMarkup(
      <RefBadges
        refs={[
          ref("main", "branch", true),
          ref("v1.0", "tag"),
          ref("origin/main", "remote"),
        ]}
      />,
    );

    expect(html).toContain('title="branch main, checked out"');
    expect(html).toContain('title="tag v1.0"');
    expect(html).toContain('title="remote branch origin/main"');
  });

  it("collapses the extras into a counter that lists them", () => {
    const html = renderToStaticMarkup(
      <RefBadges
        limit={1}
        refs={[
          ref("main", "branch", true),
          ref("v1.0", "tag"),
          ref("origin/main", "remote"),
        ]}
      />,
    );

    expect(html).toContain("+2");
    expect(html).toContain("tag v1.0");
    expect(html).toContain("remote branch origin/main");
  });

  it("keeps the checked-out branch when it has to drop refs", () => {
    const html = renderToStaticMarkup(
      <RefBadges
        limit={1}
        refs={[ref("origin/x", "remote"), ref("x", "branch", true)]}
      />,
    );

    expect(html).toContain('title="branch x, checked out"');
  });

  it("clips inside its column instead of running over the next one", () => {
    // The row lays the badges into a flexible grid track. Without a clip a
    // long branch name overruns the author and changes columns.
    const html = renderToStaticMarkup(
      <RefBadges refs={[ref("feature/a-very-long-branch-name", "branch")]} />,
    );

    expect(html).toContain("overflow-hidden");
    expect(html).toContain("truncate");
  });

  it("lets a name shrink so it ellipsizes rather than overflowing", () => {
    const html = renderToStaticMarkup(
      <RefBadges refs={[ref("feature/a-very-long-branch-name", "branch")]} />,
    );
    const chipClasses = [...html.matchAll(/class="([^"]*)"/g)]
      .map((m) => m[1])
      .find((value) => value.includes("border-sky"));

    expect(chipClasses).toBeDefined();
    expect(chipClasses).toContain("min-w-0");
    // A shrink-0 chip cannot ellipsize; it pushes past the grid track instead.
    expect(chipClasses).not.toContain("shrink-0");
  });
});

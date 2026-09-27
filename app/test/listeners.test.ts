import { describe, expect, it } from "vitest";
import { beginWait, feedPolled, listenerFor } from "@/lib/service/listeners";

describe("who hears a send", () => {
  it("is nobody for a page with no handle and no wait", () => {
    expect(listenerFor({ slug: "quiet", terminalHandle: null })).toBe("none");
  });

  it("is the waiting agent during a wait and just after it", () => {
    const done = beginWait("waited");
    expect(listenerFor({ slug: "waited", terminalHandle: null })).toBe("waiting");
    done();
    expect(listenerFor({ slug: "waited", terminalHandle: null })).toBe("waiting");
    expect(listenerFor({ slug: "waited", terminalHandle: null }, Date.now() + 60_000)).toBe("none");
  });

  it("is the terminal while Orca polls the feed, and says so when it stops", () => {
    const page = { slug: "orca-page", terminalHandle: "term-1" };
    feedPolled();
    expect(listenerFor(page)).toBe("terminal");
    expect(listenerFor(page, Date.now() + 5 * 60_000)).toBe("terminal-offline");
  });
});

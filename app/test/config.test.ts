import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, resetConfigForTesting } from "@/lib/config";

const touched = ["RESEND_API_KEY", "RESEND_API_KEY_FILE", "INDY_EMAIL_FROM", "INDY_EMAIL_FROM_FILE"];
const saved = Object.fromEntries(touched.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of touched) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTesting();
});

function secret(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "indy-secret-")), "value");
  writeFileSync(path, contents);
  return path;
}

describe("settings from files", () => {
  it("reads NAME_FILE when NAME is not set, as Docker secrets are mounted", () => {
    delete process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY_FILE = secret("re_from_file\n");
    process.env.INDY_EMAIL_FROM_FILE = secret("Indy <indy@example.com>");
    resetConfigForTesting();
    expect(config().resendKey).toBe("re_from_file");
    expect(config().emailFrom).toBe("Indy <indy@example.com>");
  });

  it("prefers the variable itself when both are set", () => {
    process.env.RESEND_API_KEY = "re_direct";
    process.env.RESEND_API_KEY_FILE = secret("re_from_file");
    resetConfigForTesting();
    expect(config().resendKey).toBe("re_direct");
  });

  it("names the variable when its file cannot be read", () => {
    delete process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY_FILE = "/run/secrets/does-not-exist";
    resetConfigForTesting();
    expect(() => config()).toThrow(/RESEND_API_KEY_FILE is set to \/run\/secrets\/does-not-exist/);
  });
});

describe("the client address behind proxies", () => {
  it("uses what Indy's own proxy saw when nothing sits in front", async () => {
    const { clientAddress } = await import("@/lib/auth/limits");
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(clientAddress(headers, 0)).toBe("203.0.113.9");
  });

  it("steps back one entry per trusted proxy, and a forged entry does not count", async () => {
    const { clientAddress } = await import("@/lib/auth/limits");
    // The client forged 6.6.6.6; Traefik appended the real 198.51.100.4; Indy's proxy appended Traefik.
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 10.0.1.5" });
    expect(clientAddress(headers, 1)).toBe("198.51.100.4");
    expect(clientAddress(new Headers({ "x-forwarded-for": "10.0.1.5" }), 1)).toBe("10.0.1.5");
    expect(clientAddress(new Headers(), 1)).toBe("direct");
  });

  it("refuses a hop count that is not a small whole number", () => {
    const before = process.env.INDY_PROXY_HOPS;
    process.env.INDY_PROXY_HOPS = "one";
    resetConfigForTesting();
    try {
      expect(() => config()).toThrow(/INDY_PROXY_HOPS/);
    } finally {
      if (before === undefined) delete process.env.INDY_PROXY_HOPS;
      else process.env.INDY_PROXY_HOPS = before;
      resetConfigForTesting();
    }
  });
});

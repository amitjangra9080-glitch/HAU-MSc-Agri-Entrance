import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const endpointFiles = [
  "api/auth/register.mjs",
  "api/auth/login.mjs",
  "api/auth/password-reset.mjs"
];

test("all public authentication endpoints use durable rate limiting", async () => {
  for (const path of endpointFiles) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /consumeAuthRateLimits/);
    assert.match(source, /extractClientIp/);
    assert.match(source, /rateLimitConfigured/);
    assert.match(source, /applyRetryAfterHeader/);
  }
});

test("successful login clears the admission-number failure bucket", async () => {
  const source = await readFile(new URL("api/auth/login.mjs", import.meta.url), "utf8");
  assert.match(source, /clearAuthRateLimit/);
  assert.match(source, /AUTH_RATE_LIMIT_POLICIES\.loginAdmission/);
});

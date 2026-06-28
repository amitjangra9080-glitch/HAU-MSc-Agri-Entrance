import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

await import("./src/atomic-registration.js");
const client = globalThis.HAUAtomicRegistrationClient;

test("client helper is exposed without requiring a browser", () => {
  assert.ok(client);
  assert.equal(typeof client.buildRequestBody, "function");
});

test("request body never sends confirmPassword", () => {
  assert.deepEqual(
    client.buildRequestBody({
      displayName: "Amit",
      email: "test@example.com",
      password: "Example123",
      confirmPassword: "Example123"
    }),
    {
      displayName: "Amit",
      email: "test@example.com",
      password: "Example123"
    }
  );
});

test("legacy signup is used only for the explicit disabled response", () => {
  assert.equal(client.isRegistrationDisabled(503, { error: "registration_disabled" }), true);
  assert.equal(client.isRegistrationDisabled(503, { error: "service_unavailable" }), false);
  assert.equal(client.isRegistrationDisabled(500, { error: "registration_disabled" }), false);
});

test("safe API message is preferred and fallback is retained", () => {
  assert.equal(client.responseMessage({ message: "Duplicate admission number." }, "Fallback"), "Duplicate admission number.");
  assert.equal(client.responseMessage({}, "Fallback"), "Fallback");
});

test("index loads atomic registration after the existing app", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const appPosition = html.indexOf("src/app.js");
  const atomicPosition = html.indexOf("src/atomic-registration.js");
  assert.ok(appPosition >= 0);
  assert.ok(atomicPosition > appPosition);
});

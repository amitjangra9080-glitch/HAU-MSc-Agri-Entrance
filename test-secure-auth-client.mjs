import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

await import("./src/secure-auth.js");
const client = globalThis.HAUSecureAuthClient;

test("secure auth client helper is exposed without a browser", () => {
  assert.ok(client);
  assert.equal(typeof client.buildLoginRequest, "function");
  assert.equal(typeof client.buildPasswordResetRequest, "function");
});

test("login request contains only normalized admission number and password", () => {
  assert.deepEqual(
    client.buildLoginRequest({
      admissionNumber: " 2099a199biv ",
      password: "Example123",
      email: "must-not-be-sent@example.com"
    }),
    {
      admissionNumber: "2099A199BIV",
      password: "Example123"
    }
  );
});

test("password reset request contains no email", () => {
  assert.deepEqual(
    client.buildPasswordResetRequest({
      admissionNumber: " b2025a10biv ",
      email: "must-not-be-sent@example.com"
    }),
    { admissionNumber: "B2025A10BIV" }
  );
});

test("authenticated response requires token and uid", () => {
  assert.equal(client.isAuthenticatedResponse({
    ok: true,
    stage: "authenticated",
    customToken: "token",
    user: { uid: "uid-1" }
  }), true);
  assert.equal(client.isAuthenticatedResponse({
    ok: true,
    stage: "authenticated",
    user: { uid: "uid-1" }
  }), false);
});

test("frontend secure auth never reads admission lookup documents", async () => {
  const source = await readFile(new URL("./src/secure-auth.js", import.meta.url), "utf8");
  assert.equal(source.includes('"admissionNumbers"'), false);
  assert.equal(source.includes("signInWithEmailAndPassword"), false);
  assert.equal(source.includes("sendPasswordResetEmail"), false);
  assert.equal(source.includes("signInWithCustomToken"), true);
});

test("index loads secure auth after the existing app and registration bridge", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const appPosition = html.indexOf("src/app.js");
  const registrationPosition = html.indexOf("src/atomic-registration.js");
  const secureAuthPosition = html.indexOf("src/secure-auth.js");
  assert.ok(appPosition >= 0);
  assert.ok(registrationPosition > appPosition);
  assert.ok(secureAuthPosition > registrationPosition);
});

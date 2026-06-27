import assert from "node:assert/strict";
import test from "node:test";

import {
  credentialFailureReason,
  parseServiceAccountEnv,
  ServerCredentialError
} from "./api/_lib/firebase-admin.mjs";

const TEST_KEY_BODY = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
const TEST_KEY = `-----BEGIN PRIVATE KEY-----\n${TEST_KEY_BODY}\n-----END PRIVATE KEY-----\n`;

function completeSplit(overrides = {}) {
  return {
    FIREBASE_PROJECT_ID: "hau-msc-agri-entrance",
    FIREBASE_CLIENT_EMAIL: "backend@hau-msc-agri-entrance.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: TEST_KEY.replace(/\n/g, "\\n"),
    ...overrides
  };
}

test("parses complete Firebase service-account JSON", () => {
  const credential = parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: "hau-msc-agri-entrance",
      client_email: "backend@hau-msc-agri-entrance.iam.gserviceaccount.com",
      private_key: TEST_KEY
    })
  });

  assert.equal(credential.projectId, "hau-msc-agri-entrance");
  assert.equal(credential.clientEmail, "backend@hau-msc-agri-entrance.iam.gserviceaccount.com");
  assert.equal(credential.privateKey, TEST_KEY);
});

test("supports split Firebase Admin environment variables", () => {
  const credential = parseServiceAccountEnv(completeSplit());
  assert.deepEqual(credential, {
    projectId: "hau-msc-agri-entrance",
    clientEmail: "backend@hau-msc-agri-entrance.iam.gserviceaccount.com",
    privateKey: TEST_KEY
  });
});

test("accepts private key copied with JSON quotes and trailing comma", () => {
  const credential = parseServiceAccountEnv(completeSplit({
    FIREBASE_PRIVATE_KEY: JSON.stringify(TEST_KEY) + ","
  }));
  assert.equal(credential.privateKey, TEST_KEY);
});

test("falls back to split variables when a stale JSON variable is malformed", () => {
  const credential = parseServiceAccountEnv(completeSplit({
    FIREBASE_SERVICE_ACCOUNT_JSON: "{not-json"
  }));
  assert.equal(credential.projectId, "hau-msc-agri-entrance");
});

test("rejects an incomplete credential with a safe reason code", () => {
  assert.throws(
    () => parseServiceAccountEnv({}),
    (error) => error instanceof ServerCredentialError && error.code === "missing_project_id"
  );
});

test("classifies malformed PEM without exposing the key", () => {
  let caught;
  try {
    parseServiceAccountEnv(completeSplit({ FIREBASE_PRIVATE_KEY: "bad-value" }));
  } catch (error) {
    caught = error;
  }
  assert.equal(credentialFailureReason(caught), "invalid_private_key");
});

test("health endpoint fails closed and reports a safe preview reason", async () => {
  const { GET } = await import("./api/auth/health.mjs");
  const saved = {
    json: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
    vercelEnv: process.env.VERCEL_ENV
  };

  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  process.env.VERCEL_ENV = "preview";

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await GET(new Request("https://example.test/api/auth/health"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "service_unavailable",
      reason: "missing_project_id"
    });
  } finally {
    console.error = originalConsoleError;
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("FIREBASE_SERVICE_ACCOUNT_JSON", saved.json);
    restore("FIREBASE_PROJECT_ID", saved.projectId);
    restore("FIREBASE_CLIENT_EMAIL", saved.clientEmail);
    restore("FIREBASE_PRIVATE_KEY", saved.privateKey);
    restore("VERCEL_ENV", saved.vercelEnv);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  ServerCredentialError,
  credentialFailureReason,
  parseServiceAccountEnv
} from "./api/_lib/firebase-credentials.mjs";
import { requireMethod, sendJson } from "./api/_lib/http.mjs";

const VALID_BODY = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
const VALID_KEY = `-----BEGIN PRIVATE KEY-----\n${VALID_BODY}\n-----END PRIVATE KEY-----\n`;
const VALID_KEY_ESCAPED = VALID_KEY.replace(/\n/g, "\\n");

test("parses complete Firebase service-account JSON", () => {
  const credential = parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: "hau-msc-agri-entrance",
      client_email: "backend@example.iam.gserviceaccount.com",
      private_key: VALID_KEY
    })
  });

  assert.equal(credential.projectId, "hau-msc-agri-entrance");
  assert.equal(credential.clientEmail, "backend@example.iam.gserviceaccount.com");
  assert.equal(credential.privateKey, VALID_KEY);
});

test("supports split Firebase Admin environment variables", () => {
  const credential = parseServiceAccountEnv({
    FIREBASE_PROJECT_ID: "hau-msc-agri-entrance",
    FIREBASE_CLIENT_EMAIL: "backend@example.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: VALID_KEY_ESCAPED
  });

  assert.deepEqual(credential, {
    projectId: "hau-msc-agri-entrance",
    clientEmail: "backend@example.iam.gserviceaccount.com",
    privateKey: VALID_KEY
  });
});

test("falls back to complete split variables when stale JSON is malformed", () => {
  const credential = parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_JSON: "{not-json",
    FIREBASE_PROJECT_ID: "hau-msc-agri-entrance",
    FIREBASE_CLIENT_EMAIL: "backend@example.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: VALID_KEY_ESCAPED
  });

  assert.equal(credential.projectId, "hau-msc-agri-entrance");
  assert.equal(credential.privateKey, VALID_KEY);
});

test("accepts an accidentally quoted private key with a trailing comma", () => {
  const credential = parseServiceAccountEnv({
    FIREBASE_PROJECT_ID: "hau-msc-agri-entrance",
    FIREBASE_CLIENT_EMAIL: "backend@example.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: `${JSON.stringify(VALID_KEY_ESCAPED)},`
  });

  assert.equal(credential.privateKey, VALID_KEY);
});

test("rejects an incomplete server credential without exposing a secret", () => {
  assert.throws(
    () => parseServiceAccountEnv({
      FIREBASE_PROJECT_ID: "hau-msc-agri-entrance",
      FIREBASE_CLIENT_EMAIL: "backend@example.iam.gserviceaccount.com"
    }),
    (error) => error instanceof ServerCredentialError
      && error.code === "missing_private_key"
  );
});

test("classifies Firebase Admin package loading failures safely", () => {
  const reason = credentialFailureReason(
    Object.assign(new Error("Cannot find package 'firebase-admin'"), {
      code: "ERR_MODULE_NOT_FOUND"
    })
  );
  assert.equal(reason, "firebase_admin_module_load_failed");
});

test("HTTP helpers return JSON and reject an unsupported method", () => {
  const headers = new Map();
  let statusCode = 0;
  let body = null;
  const response = {
    setHeader(name, value) {
      headers.set(name, value);
    },
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      body = value;
      return value;
    }
  };

  const allowed = requireMethod({ method: "POST" }, response, "GET");
  assert.equal(allowed, false);
  assert.equal(statusCode, 405);
  assert.equal(headers.get("Allow"), "GET");
  assert.equal(headers.get("Cache-Control"), "no-store, max-age=0");
  assert.deepEqual(body, { ok: false, error: "method_not_allowed" });

  sendJson(response, 200, { ok: true });
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { ok: true });
});

test("health endpoint fails closed without crashing when credentials are unavailable", async () => {
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
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "service_unavailable",
      reason: "missing_project_id"
    });
  } finally {
    console.error = originalConsoleError;
    for (const [name, value] of Object.entries({
      FIREBASE_SERVICE_ACCOUNT_JSON: saved.json,
      FIREBASE_PROJECT_ID: saved.projectId,
      FIREBASE_CLIENT_EMAIL: saved.clientEmail,
      FIREBASE_PRIVATE_KEY: saved.privateKey,
      VERCEL_ENV: saved.vercelEnv
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

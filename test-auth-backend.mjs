import assert from "node:assert/strict";
import test from "node:test";

import { parseServiceAccountEnv } from "./api/_lib/firebase-admin.mjs";
import { requireMethod, sendJson } from "./api/_lib/http.mjs";

test("parses complete Firebase service-account JSON", () => {
  const credential = parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: "hau-msc-agri-entrance",
      client_email: "backend@example.iam.gserviceaccount.com",
      private_key: "line-one\\nline-two"
    })
  });

  assert.equal(credential.projectId, "hau-msc-agri-entrance");
  assert.equal(credential.clientEmail, "backend@example.iam.gserviceaccount.com");
  assert.equal(credential.privateKey, "line-one\nline-two");
});

test("supports split Firebase Admin environment variables", () => {
  const credential = parseServiceAccountEnv({
    FIREBASE_PROJECT_ID: "hau-msc-agri-entrance",
    FIREBASE_CLIENT_EMAIL: "backend@example.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "line-one\\nline-two"
  });

  assert.deepEqual(credential, {
    projectId: "hau-msc-agri-entrance",
    clientEmail: "backend@example.iam.gserviceaccount.com",
    privateKey: "line-one\nline-two"
  });
});

test("rejects an incomplete server credential without exposing a secret", () => {
  assert.throws(
    () => parseServiceAccountEnv({
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: "hau-msc-agri-entrance",
        client_email: "backend@example.iam.gserviceaccount.com"
      })
    }),
    /Missing server credential field: private_key/
  );
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

test("health endpoint fails closed when server credentials are unavailable", async () => {
  const { GET } = await import("./api/auth/health.mjs");
  const saved = {
    json: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
  };

  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;

  const originalConsoleError = console.error;
  console.error = () => {};
  let response;
  try {
    response = await GET(new Request("https://example.test/api/auth/health"));
  } finally {
    console.error = originalConsoleError;
    if (saved.json === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = saved.json;
    if (saved.projectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = saved.projectId;
    if (saved.clientEmail === undefined) delete process.env.FIREBASE_CLIENT_EMAIL;
    else process.env.FIREBASE_CLIENT_EMAIL = saved.clientEmail;
    if (saved.privateKey === undefined) delete process.env.FIREBASE_PRIVATE_KEY;
    else process.env.FIREBASE_PRIVATE_KEY = saved.privateKey;
  }

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), { ok: false, error: "service_unavailable" });
});

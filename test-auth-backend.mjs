import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  ServerCredentialError,
  credentialFailureReason,
  parseServiceAccountEnv
} from "./api/_lib/firebase-credentials.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const VALID_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "hau-msc-agri-entrance",
  client_email: "firebase-adminsdk-test@hau-msc-agri-entrance.iam.gserviceaccount.com",
  private_key: VALID_KEY
};
const BASE64 = Buffer.from(JSON.stringify(SERVICE_ACCOUNT), "utf8").toString("base64");

function assertValid(value) {
  assert.equal(value.projectId, "hau-msc-agri-entrance");
  assert.equal(value.clientEmail, SERVICE_ACCOUNT.client_email);
  assert.match(value.privateKey, /^-----BEGIN PRIVATE KEY-----/);
  assert.match(value.privateKey, /-----END PRIVATE KEY-----\n$/);
}

test("parses preferred Base64 service-account JSON", () => {
  assertValid(parseServiceAccountEnv({ FIREBASE_SERVICE_ACCOUNT_BASE64: BASE64 }));
});

test("accepts Base64 with whitespace and data URL prefix", () => {
  const wrapped = BASE64.match(/.{1,73}/g).join("\n");
  assertValid(parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_BASE64: `data:application/json;base64,${wrapped}`
  }));
});

test("supports complete JSON and split legacy credentials", () => {
  assertValid(parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(SERVICE_ACCOUNT)
  }));
  assertValid(parseServiceAccountEnv({
    FIREBASE_PROJECT_ID: SERVICE_ACCOUNT.project_id,
    FIREBASE_CLIENT_EMAIL: SERVICE_ACCOUNT.client_email,
    FIREBASE_PRIVATE_KEY: VALID_KEY.replace(/\n/g, "\\n")
  }));
});

test("falls back when a higher-priority credential is stale", () => {
  assertValid(parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_BASE64: "not-valid-base64",
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(SERVICE_ACCOUNT)
  }));
});

test("rejects a valid key from the wrong project", () => {
  const wrong = { ...SERVICE_ACCOUNT, project_id: "wrong-project" };
  assert.throws(
    () => parseServiceAccountEnv({
      FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify(wrong)).toString("base64")
    }),
    (error) => error instanceof ServerCredentialError && error.code === "wrong_project_id"
  );
});

test("cryptographically rejects corrupted Base64 key material", () => {
  const corrupted = { ...SERVICE_ACCOUNT, private_key: VALID_KEY.replace(/[A-Za-z]/, "!") };
  assert.throws(
    () => parseServiceAccountEnv({
      FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify(corrupted)).toString("base64")
    }),
    (error) => error instanceof ServerCredentialError && error.code === "invalid_private_key"
  );
});

test("classifies OpenSSL and package errors safely", () => {
  assert.equal(
    credentialFailureReason(new Error("error:0680009B:asn1 encoding routines::too long")),
    "invalid_private_key"
  );
  assert.equal(
    credentialFailureReason(Object.assign(new Error("Package subpath './app' is not defined"), {
      code: "ERR_PACKAGE_PATH_NOT_EXPORTED"
    })),
    "firebase_admin_module_load_failed"
  );
});

test("initializes the pinned Firebase Admin SDK and signs a custom token", async () => {
  const saved = {
    base64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
    json: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
  };

  process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = BASE64;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;

  try {
    const { getFirebaseAdmin } = await import("./api/_lib/firebase-admin.mjs");
    const services = await getFirebaseAdmin();
    assert.ok(services.app);
    assert.ok(services.auth);
    assert.ok(services.db);
    const token = await services.auth.createCustomToken("phase2-test-user");
    assert.equal(token.split(".").length, 3);

    const { GET } = await import("./api/auth/health.mjs");
    const response = await GET(new Request("https://example.test/api/auth/health"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "secure-auth-backend"
    });
  } finally {
    const values = {
      FIREBASE_SERVICE_ACCOUNT_BASE64: saved.base64,
      FIREBASE_SERVICE_ACCOUNT_JSON: saved.json,
      FIREBASE_PROJECT_ID: saved.projectId,
      FIREBASE_CLIENT_EMAIL: saved.clientEmail,
      FIREBASE_PRIVATE_KEY: saved.privateKey
    };
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

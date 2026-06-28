import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  credentialFailureReason,
  parseServiceAccountEnv
} from "./api/_lib/firebase-credentials.mjs";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

function serviceAccount(overrides = {}) {
  return {
    project_id: "hau-msc-agri-entrance",
    client_email: "test-admin@hau-msc-agri-entrance.iam.gserviceaccount.com",
    private_key: privateKey,
    ...overrides
  };
}

test("parses a valid Base64 service account", () => {
  const encoded = Buffer.from(JSON.stringify(serviceAccount()), "utf8").toString("base64");
  const parsed = parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_BASE64: encoded
  });

  assert.equal(parsed.projectId, "hau-msc-agri-entrance");
  assert.equal(parsed.clientEmail, serviceAccount().client_email);
  assert.match(parsed.privateKey, /BEGIN PRIVATE KEY/);
});

test("returns an extensible credential object for Firebase Admin", () => {
  const encoded = Buffer.from(JSON.stringify(serviceAccount()), "utf8").toString("base64");
  const parsed = parseServiceAccountEnv({
    FIREBASE_SERVICE_ACCOUNT_BASE64: encoded
  });

  assert.equal(Object.isExtensible(parsed), true);
  parsed.project_id = parsed.projectId;
  parsed.client_email = parsed.clientEmail;
  parsed.private_key = parsed.privateKey;
  assert.equal(parsed.project_id, "hau-msc-agri-entrance");
});

test("supports the split credential migration format", () => {
  const parsed = parseServiceAccountEnv({
    FIREBASE_PROJECT_ID: "hau-msc-agri-entrance",
    FIREBASE_CLIENT_EMAIL: serviceAccount().client_email,
    FIREBASE_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n")
  });

  assert.equal(parsed.projectId, "hau-msc-agri-entrance");
});

test("rejects credentials belonging to another Firebase project", () => {
  const encoded = Buffer.from(
    JSON.stringify(serviceAccount({ project_id: "wrong-project" })),
    "utf8"
  ).toString("base64");

  assert.throws(
    () => parseServiceAccountEnv({ FIREBASE_SERVICE_ACCOUNT_BASE64: encoded }),
    (error) => error?.code === "wrong_project_id"
  );
});

test("rejects missing server credentials", () => {
  assert.throws(
    () => parseServiceAccountEnv({}),
    (error) => error?.code === "missing_service_account"
  );
});

test("classifies common backend initialization failures", () => {
  assert.equal(
    credentialFailureReason(Object.assign(new Error("Cannot find package firebase-admin"), {
      code: "ERR_MODULE_NOT_FOUND"
    })),
    "firebase_admin_module_load_failed"
  );
  assert.equal(
    credentialFailureReason(new Error("PEM private key parse failed")),
    "invalid_private_key"
  );
});

test("admin foundation contains no token creation or embedded credential", async () => {
  const adminSource = await readFile(
    new URL("./api/_lib/firebase-admin.mjs", import.meta.url),
    "utf8"
  );
  const healthSource = await readFile(
    new URL("./api/auth/admin-health.mjs", import.meta.url),
    "utf8"
  );

  assert.ok(!adminSource.includes("createCustomToken("));
  assert.ok(!healthSource.includes("private_key"));
  assert.ok(!healthSource.includes("FIREBASE_SERVICE_ACCOUNT_BASE64="));
});

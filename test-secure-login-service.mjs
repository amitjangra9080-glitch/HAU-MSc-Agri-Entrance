import assert from "node:assert/strict";
import test from "node:test";

import {
  SecureLoginError,
  authenticateAdmissionLogin,
  sendAdmissionPasswordReset
} from "./api/_lib/secure-login-service.mjs";

function snapshot(exists, data = {}) {
  return { exists, data: () => data };
}

function services(options = {}) {
  const admission = Object.prototype.hasOwnProperty.call(options, "admission")
    ? options.admission
    : { uid: "uid-1", email: "student@example.com" };
  const profile = Object.prototype.hasOwnProperty.call(options, "profile")
    ? options.profile
    : { uid: "uid-1", deactivated: false };
  return {
    auth: {
      getUser: async () => ({ uid: "uid-1", emailVerified: options.emailVerified ?? true, disabled: false }),
      createCustomToken: async () => "custom-token"
    },
    db: {
      collection(name) {
        return {
          doc() {
            return {
              async get() {
                if (name === "admissionNumbers") return admission ? snapshot(true, admission) : snapshot(false);
                if (name === "users") return profile ? snapshot(true, profile) : snapshot(false);
                return snapshot(false);
              }
            };
          }
        };
      }
    }
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

test("authenticates admission login without returning email", async () => {
  const result = await authenticateAdmissionLogin(
    { admissionNumber: "2099A199BIV", password: "Example123" },
    services(),
    {
      apiKey: "public-web-api-key",
      fetchImpl: async () => jsonResponse(200, { localId: "uid-1", idToken: "id-token" })
    }
  );

  assert.deepEqual(result, {
    uid: "uid-1",
    customToken: "custom-token",
    emailVerified: true
  });
  assert.equal("email" in result, false);
});

test("maps missing admission to generic invalid credentials", async () => {
  await assert.rejects(
    authenticateAdmissionLogin(
      { admissionNumber: "2099A199BIV", password: "wrong" },
      services({ admission: null }),
      { apiKey: "public-web-api-key", fetchImpl: async () => jsonResponse(400, {}) }
    ),
    (error) => error instanceof SecureLoginError
      && error.code === "invalid_credentials"
      && error.status === 401
  );
});

test("maps Firebase password errors to generic invalid credentials", async () => {
  await assert.rejects(
    authenticateAdmissionLogin(
      { admissionNumber: "2099A199BIV", password: "wrong" },
      services(),
      {
        apiKey: "public-web-api-key",
        fetchImpl: async () => jsonResponse(400, { error: { message: "INVALID_LOGIN_CREDENTIALS" } })
      }
    ),
    (error) => error.code === "invalid_credentials" && !error.message.includes("email")
  );
});

test("returns a custom token for an unverified account", async () => {
  const result = await authenticateAdmissionLogin(
    { admissionNumber: "2099A199BIV", password: "Example123" },
    services({ emailVerified: false }),
    {
      apiKey: "public-web-api-key",
      fetchImpl: async () => jsonResponse(200, { localId: "uid-1" })
    }
  );
  assert.equal(result.emailVerified, false);
  assert.equal(result.customToken, "custom-token");
});

test("password reset is enumeration-safe for a missing admission", async () => {
  const result = await sendAdmissionPasswordReset(
    { admissionNumber: "2099A199BIV" },
    services({ admission: null }),
    { apiKey: "public-web-api-key", fetchImpl: async () => { throw new Error("must not call"); } }
  );
  assert.deepEqual(result, { accepted: true });
});

test("password reset sends through Identity Toolkit without exposing email", async () => {
  let requestBody = null;
  const result = await sendAdmissionPasswordReset(
    { admissionNumber: "2099A199BIV" },
    services(),
    {
      apiKey: "public-web-api-key",
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return jsonResponse(200, { email: "student@example.com" });
      }
    }
  );
  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(requestBody, {
    requestType: "PASSWORD_RESET",
    email: "student@example.com"
  });
});

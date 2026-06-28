import {
  IdentityToolkitError,
  firebaseWebApiKey,
  requestPasswordReset,
  verifyEmailPassword
} from "./identity-toolkit.mjs";

const INVALID_CREDENTIAL_CODES = new Set([
  "EMAIL_NOT_FOUND",
  "INVALID_PASSWORD",
  "INVALID_LOGIN_CREDENTIALS",
  "USER_DISABLED"
]);

export class SecureLoginError extends Error {
  constructor(code, message, status = 500, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = "SecureLoginError";
    this.code = code;
    this.status = status;
  }
}

function invalidCredentials(cause = undefined) {
  return new SecureLoginError(
    "invalid_credentials",
    "Invalid admission number or password.",
    401,
    cause
  );
}

function serviceUnavailable(code, cause = undefined) {
  return new SecureLoginError(
    code,
    "Authentication service is temporarily unavailable.",
    503,
    cause
  );
}

async function admissionLookup(db, admissionNumber) {
  try {
    const snapshot = await db.collection("admissionNumbers").doc(admissionNumber).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    const uid = String(data.uid || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    return uid && email ? { uid, email } : null;
  } catch (error) {
    throw serviceUnavailable("admission_lookup_failed", error);
  }
}

function mapIdentityLoginError(error) {
  if (error instanceof IdentityToolkitError && INVALID_CREDENTIAL_CODES.has(error.code)) {
    return invalidCredentials(error);
  }
  if (error instanceof IdentityToolkitError) {
    return serviceUnavailable("identity_verification_failed", error);
  }
  return serviceUnavailable("identity_verification_failed", error);
}

export async function authenticateAdmissionLogin(data, services, options = {}) {
  const { auth, db } = services || {};
  if (!auth || !db) throw serviceUnavailable("firebase_services_incomplete");

  const lookup = await admissionLookup(db, data.admissionNumber);
  if (!lookup) throw invalidCredentials();

  const apiKey = options.apiKey || firebaseWebApiKey(options.environment);
  let identity;
  try {
    identity = await verifyEmailPassword(lookup.email, data.password, {
      apiKey,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs
    });
  } catch (error) {
    throw mapIdentityLoginError(error);
  }

  const localId = String(identity.localId || "").trim();
  if (!localId || localId !== lookup.uid) {
    throw serviceUnavailable("identity_mismatch");
  }

  let authUser;
  let profileSnapshot;
  try {
    [authUser, profileSnapshot] = await Promise.all([
      auth.getUser(localId),
      db.collection("users").doc(localId).get()
    ]);
  } catch (error) {
    throw serviceUnavailable("account_load_failed", error);
  }

  if (!profileSnapshot.exists) throw serviceUnavailable("profile_missing");
  const profile = profileSnapshot.data() || {};
  if (authUser.disabled) throw invalidCredentials();
  if (profile.deactivated === true) {
    throw new SecureLoginError(
      "account_deactivated",
      "Your account is scheduled for deletion. Restore your account to continue.",
      403
    );
  }

  let customToken;
  try {
    customToken = await auth.createCustomToken(localId, {
      loginMethod: "admission_number"
    });
  } catch (error) {
    throw serviceUnavailable("custom_token_failed", error);
  }

  return {
    uid: localId,
    customToken,
    emailVerified: authUser.emailVerified === true
  };
}

export async function sendAdmissionPasswordReset(data, services, options = {}) {
  const { db } = services || {};
  if (!db) throw serviceUnavailable("firebase_services_incomplete");

  const lookup = await admissionLookup(db, data.admissionNumber);
  if (!lookup) return { accepted: true };

  const apiKey = options.apiKey || firebaseWebApiKey(options.environment);
  try {
    await requestPasswordReset(lookup.email, {
      apiKey,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs
    });
  } catch (error) {
    if (error instanceof IdentityToolkitError && error.code === "EMAIL_NOT_FOUND") {
      return { accepted: true };
    }
    throw serviceUnavailable("password_reset_failed", error);
  }

  return { accepted: true };
}

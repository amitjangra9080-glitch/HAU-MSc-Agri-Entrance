const IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1/accounts";
const REQUEST_TIMEOUT_MS = 10_000;

export class IdentityToolkitError extends Error {
  constructor(code, message, status = 503, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = "IdentityToolkitError";
    this.code = code;
    this.status = status;
  }
}

export function firebaseWebApiKey(environment = process.env) {
  return String(
    environment.FIREBASE_WEB_API_KEY
      || environment.FIREBASE_API_KEY
      || ""
  ).trim();
}

function remoteErrorCode(payload) {
  const raw = String(payload?.error?.message || "").trim();
  return raw.split(" : ")[0].split(" ")[0] || "IDENTITY_TOOLKIT_ERROR";
}

async function postIdentityToolkit(path, body, options = {}) {
  const apiKey = String(options.apiKey || firebaseWebApiKey()).trim();
  if (!apiKey) {
    throw new IdentityToolkitError(
      "missing_firebase_web_api_key",
      "Authentication service is temporarily unavailable.",
      503
    );
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new IdentityToolkitError(
      "fetch_unavailable",
      "Authentication service is temporarily unavailable.",
      503
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${IDENTITY_TOOLKIT_BASE}:${path}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    throw new IdentityToolkitError(
      error?.name === "AbortError" ? "identity_toolkit_timeout" : "identity_toolkit_network_error",
      "Authentication service is temporarily unavailable.",
      503,
      error
    );
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new IdentityToolkitError(
      remoteErrorCode(payload),
      "Authentication request was rejected.",
      response.status >= 500 ? 503 : 401
    );
  }

  return payload || {};
}

export function verifyEmailPassword(email, password, options = {}) {
  return postIdentityToolkit("signInWithPassword", {
    email,
    password,
    returnSecureToken: true
  }, options);
}

export function requestPasswordReset(email, options = {}) {
  return postIdentityToolkit("sendOobCode", {
    requestType: "PASSWORD_RESET",
    email
  }, options);
}

import { createPrivateKey } from "node:crypto";

const EXPECTED_PROJECT_ID = "hau-msc-agri-entrance";

export class ServerCredentialError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "ServerCredentialError";
    this.code = code;
  }
}

export class ServerInitializationError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "ServerInitializationError";
    this.code = code;
  }
}

function cleanEnvText(value) {
  let text = String(value ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) return "";

  const candidate = text.endsWith(",") ? text.slice(0, -1).trim() : text;
  if (candidate.startsWith('"') && candidate.endsWith('"')) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") text = parsed.trim();
    } catch {
      text = candidate.slice(1, -1).trim();
    }
  } else if (candidate.startsWith("'") && candidate.endsWith("'")) {
    text = candidate.slice(1, -1).trim();
  } else {
    text = candidate;
  }

  return text;
}

function requiredText(value, fieldName) {
  const text = cleanEnvText(value);
  if (!text) {
    throw new ServerCredentialError(
      `missing_${fieldName}`,
      `Missing server credential field: ${fieldName}.`
    );
  }
  return text;
}

function decodeBase64Json(value) {
  const encoded = requiredText(value, "service_account_base64")
    .replace(/^data:application\/json;base64,/i, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new ServerCredentialError(
      "invalid_service_account_base64",
      "FIREBASE_SERVICE_ACCOUNT_BASE64 is not valid Base64."
    );
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    throw new ServerCredentialError(
      "invalid_service_account_base64",
      "FIREBASE_SERVICE_ACCOUNT_BASE64 could not be decoded."
    );
  }

  try {
    return JSON.parse(decoded);
  } catch {
    throw new ServerCredentialError(
      "invalid_service_account_base64_json",
      "Decoded Firebase service-account value is not valid JSON."
    );
  }
}

function normalizePrivateKey(value) {
  let privateKey = requiredText(value, "private_key")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  const beginMarker = "-----BEGIN PRIVATE KEY-----";
  const endMarker = "-----END PRIVATE KEY-----";
  const begin = privateKey.indexOf(beginMarker);
  const end = privateKey.indexOf(endMarker);

  if (begin < 0 || end < begin) {
    throw new ServerCredentialError(
      "invalid_private_key",
      "Firebase private key is not a PKCS#8 PEM value."
    );
  }

  privateKey = privateKey.slice(begin, end + endMarker.length);
  const body = privateKey
    .slice(beginMarker.length, -endMarker.length)
    .replace(/\s+/g, "");

  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new ServerCredentialError(
      "invalid_private_key",
      "Firebase private key body is invalid."
    );
  }

  const canonicalPem = `${beginMarker}\n${(body.match(/.{1,64}/g) || []).join("\n")}\n${endMarker}\n`;

  try {
    const keyObject = createPrivateKey({
      key: canonicalPem,
      format: "pem",
      type: "pkcs8"
    });
    if (keyObject.asymmetricKeyType !== "rsa") {
      throw new Error("Expected an RSA private key.");
    }
  } catch {
    throw new ServerCredentialError(
      "invalid_private_key",
      "Firebase private key could not be parsed cryptographically."
    );
  }

  return canonicalPem;
}

function normalizeServiceAccount(value) {
  const projectId = requiredText(value?.project_id ?? value?.projectId, "project_id");
  const clientEmail = requiredText(value?.client_email ?? value?.clientEmail, "client_email");
  const privateKey = normalizePrivateKey(value?.private_key ?? value?.privateKey);

  if (projectId !== EXPECTED_PROJECT_ID) {
    throw new ServerCredentialError(
      "wrong_project_id",
      `Firebase service account must belong to ${EXPECTED_PROJECT_ID}.`
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
    throw new ServerCredentialError(
      "invalid_client_email",
      "Firebase client email is invalid."
    );
  }

  return Object.freeze({ projectId, clientEmail, privateKey });
}

function parseJsonCredential(value) {
  const text = requiredText(value, "service_account_json");
  try {
    return JSON.parse(text);
  } catch {
    throw new ServerCredentialError(
      "invalid_service_account_json",
      "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON."
    );
  }
}

function completeSplitCredential(environment) {
  const projectId = cleanEnvText(environment.FIREBASE_PROJECT_ID);
  const clientEmail = cleanEnvText(environment.FIREBASE_CLIENT_EMAIL);
  const privateKey = cleanEnvText(environment.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) return null;
  return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
}

export function parseServiceAccountEnv(environment = process.env) {
  const candidates = [];

  if (cleanEnvText(environment.FIREBASE_SERVICE_ACCOUNT_BASE64)) {
    candidates.push(() => decodeBase64Json(environment.FIREBASE_SERVICE_ACCOUNT_BASE64));
  }
  if (cleanEnvText(environment.FIREBASE_SERVICE_ACCOUNT_JSON)) {
    candidates.push(() => parseJsonCredential(environment.FIREBASE_SERVICE_ACCOUNT_JSON));
  }
  const split = completeSplitCredential(environment);
  if (split) candidates.push(() => split);

  if (!candidates.length) {
    throw new ServerCredentialError(
      "missing_service_account",
      "No complete Firebase service-account credential is configured."
    );
  }

  let firstError = null;
  for (const getCandidate of candidates) {
    try {
      return normalizeServiceAccount(getCandidate());
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }

  throw firstError || new ServerCredentialError(
    "invalid_service_account",
    "Firebase service-account credential is invalid."
  );
}

export function credentialFailureReason(error) {
  if (error instanceof ServerCredentialError || error instanceof ServerInitializationError) {
    return error.code;
  }

  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  const causeCode = String(error?.cause?.code || "").toLowerCase();
  const causeMessage = String(error?.cause?.message || "").toLowerCase();
  const combined = `${code} ${message} ${causeCode} ${causeMessage}`;

  if (
    combined.includes("module_not_found")
    || combined.includes("cannot find package")
    || combined.includes("cannot find module")
    || combined.includes("package subpath")
  ) return "firebase_admin_module_load_failed";

  if (
    combined.includes("private key")
    || combined.includes("pem")
    || combined.includes("asn1")
    || combined.includes("asn.1")
    || combined.includes("decoder")
    || combined.includes("unsupported")
    || combined.includes("invalid-credential")
  ) return "invalid_private_key";

  if (combined.includes("permission") || combined.includes("403")) {
    return "firebase_permission_denied";
  }

  if (
    combined.includes("network")
    || combined.includes("fetch")
    || combined.includes("timeout")
    || combined.includes("econn")
    || combined.includes("enotfound")
  ) return "firebase_network_error";

  if (combined.includes("credential") || combined.includes("service account")) {
    return "invalid_service_account";
  }

  return "firebase_admin_initialization_failed";
}

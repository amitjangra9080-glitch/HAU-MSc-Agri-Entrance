export class ServerCredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ServerCredentialError";
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
      "Firebase private key is not a valid PEM value."
    );
  }

  const body = privateKey
    .slice(begin + beginMarker.length, end)
    .replace(/\s+/g, "");

  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new ServerCredentialError(
      "invalid_private_key",
      "Firebase private key body is invalid."
    );
  }

  // Rebuild a canonical PEM block so either literal \n or real line breaks work.
  const lines = body.match(/.{1,64}/g) || [];
  return `${beginMarker}\n${lines.join("\n")}\n${endMarker}\n`;
}

function normalizeServiceAccount(value) {
  const projectId = requiredText(value?.project_id ?? value?.projectId, "project_id");
  const clientEmail = requiredText(value?.client_email ?? value?.clientEmail, "client_email");
  const privateKey = normalizePrivateKey(value?.private_key ?? value?.privateKey);

  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
    throw new ServerCredentialError(
      "invalid_project_id",
      "Firebase project ID is invalid."
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
    throw new ServerCredentialError(
      "invalid_client_email",
      "Firebase client email is invalid."
    );
  }

  return { projectId, clientEmail, privateKey };
}

function hasCompleteSplitCredential(environment) {
  return Boolean(
    cleanEnvText(environment.FIREBASE_PROJECT_ID)
    && cleanEnvText(environment.FIREBASE_CLIENT_EMAIL)
    && cleanEnvText(environment.FIREBASE_PRIVATE_KEY)
  );
}

export function parseServiceAccountEnv(environment = process.env) {
  const jsonCredential = cleanEnvText(environment.FIREBASE_SERVICE_ACCOUNT_JSON);
  const splitCredentialAvailable = hasCompleteSplitCredential(environment);

  if (jsonCredential) {
    try {
      return normalizeServiceAccount(JSON.parse(jsonCredential));
    } catch (error) {
      // A stale JSON variable must not block correctly configured split variables.
      if (!splitCredentialAvailable) {
        if (error instanceof ServerCredentialError) throw error;
        throw new ServerCredentialError(
          "invalid_service_account_json",
          "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON."
        );
      }
    }
  }

  return normalizeServiceAccount({
    projectId: environment.FIREBASE_PROJECT_ID,
    clientEmail: environment.FIREBASE_CLIENT_EMAIL,
    privateKey: environment.FIREBASE_PRIVATE_KEY
  });
}

export function credentialFailureReason(error) {
  if (error instanceof ServerCredentialError) return error.code;

  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();

  if (
    code.includes("module_not_found")
    || code.includes("err_module_not_found")
    || message.includes("cannot find package")
    || message.includes("cannot find module")
  ) {
    return "firebase_admin_module_load_failed";
  }

  if (
    code.includes("invalid-credential")
    || message.includes("private key")
    || message.includes("pem")
    || message.includes("asn.1")
    || message.includes("decoder routines")
  ) {
    return "invalid_private_key";
  }

  if (message.includes("permission") || message.includes("403")) {
    return "firebase_permission_denied";
  }

  if (
    message.includes("network")
    || message.includes("fetch")
    || message.includes("timeout")
    || message.includes("econn")
  ) {
    return "firebase_network_error";
  }

  if (message.includes("credential") || message.includes("service account")) {
    return "invalid_service_account";
  }

  return "firebase_admin_initialization_failed";
}

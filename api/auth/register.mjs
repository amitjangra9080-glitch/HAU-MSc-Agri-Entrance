import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitError,
  AuthRateLimitServiceError,
  applyRetryAfterHeader,
  consumeAuthRateLimits,
  extractClientIp,
  isAuthRateLimitConfigured
} from "../_lib/auth-rate-limit.mjs";
import { getFirebaseAdmin } from "../_lib/firebase-admin.mjs";
import {
  exchangeCustomToken,
  requestEmailVerification
} from "../_lib/identity-toolkit.mjs";
import {
  RegistrationServiceError,
  createAtomicRegistration
} from "../_lib/registration-service.mjs";
import { validateRegistrationInput } from "../_lib/registration-validation.mjs";

const MAX_BODY_BYTES = 16 * 1024;

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.trim()) {
    if (Buffer.byteLength(request.body, "utf8") > MAX_BODY_BYTES) return "too_large";
    try {
      return JSON.parse(request.body);
    } catch {
      return null;
    }
  }
  return {};
}

function registrationWriteEnabled() {
  return process.env.REGISTRATION_WRITE_ENABLED === "true";
}

function safeErrorPayload(error) {
  if (error instanceof AuthRateLimitError) {
    return {
      status: 429,
      payload: {
        ok: false,
        error: "rate_limited",
        message: "Too many account-creation attempts. Try again later."
      }
    };
  }

  if (error instanceof AuthRateLimitServiceError) {
    return {
      status: 503,
      payload: {
        ok: false,
        error: "service_unavailable",
        message: "Registration service is temporarily unavailable."
      }
    };
  }

  if (error instanceof RegistrationServiceError) {
    return {
      status: error.status,
      payload: {
        ok: false,
        error: error.code,
        message: error.message
      }
    };
  }

  return {
    status: 503,
    payload: {
      ok: false,
      error: "service_unavailable",
      message: "Registration service is temporarily unavailable."
    }
  };
}

async function createClientCustomToken(services, uid, requestId) {
  try {
    return await services.auth.createCustomToken(uid, {
      purpose: "registration_client_session"
    });
  } catch (error) {
    console.warn("Registration client token creation failed; browser will use password fallback", {
      requestId,
      uid,
      reason: String(error?.code || "custom_token_failed").slice(0, 120)
    });
    return "";
  }
}

async function sendInitialVerificationEmail(services, uid, requestId) {
  try {
    const verificationToken = await services.auth.createCustomToken(uid, {
      purpose: "registration_email_verification"
    });
    const identity = await exchangeCustomToken(verificationToken);
    const idToken = String(identity?.idToken || "").trim();

    if (!idToken) {
      throw new Error("Identity Toolkit did not return an ID token.");
    }

    await requestEmailVerification(idToken);
    return true;
  } catch (error) {
    console.warn("Initial verification email could not be sent by the registration API", {
      requestId,
      uid,
      reason: String(error?.code || error?.name || "verification_email_failed").slice(0, 120),
      message: String(error?.message || "").slice(0, 200)
    });
    return false;
  }
}

export default async function handler(request, response) {
  setSecurityHeaders(response);

  if (request.method === "GET") {
    return response.status(200).json({
      ok: true,
      service: "atomic-registration",
      stage: "atomic-ready",
      writeEnabled: registrationWriteEnabled(),
      rateLimitConfigured: isAuthRateLimitConfigured()
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({
      ok: false,
      error: "method_not_allowed"
    });
  }

  const contentLength = Number(request.headers?.["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response.status(413).json({
      ok: false,
      error: "request_too_large"
    });
  }

  const body = readBody(request);
  if (body === "too_large") {
    return response.status(413).json({
      ok: false,
      error: "request_too_large"
    });
  }
  if (body === null) {
    return response.status(400).json({
      ok: false,
      error: "invalid_json"
    });
  }

  const result = validateRegistrationInput(body);
  if (!result.ok) {
    return response.status(400).json({
      ok: false,
      error: "validation_failed",
      fields: result.errors
    });
  }

  if (body.dryRun === true) {
    const { password: _password, ...normalized } = result.data;
    return response.status(200).json({
      ok: true,
      stage: "validated",
      normalized
    });
  }

  if (!registrationWriteEnabled()) {
    return response.status(503).json({
      ok: false,
      error: "registration_disabled",
      message: "Registration writes are not enabled for this deployment."
    });
  }

  const requestId = String(request.headers?.["x-vercel-id"] || "").slice(0, 160);

  try {
    const services = await getFirebaseAdmin();
    await consumeAuthRateLimits({
      db: services.db,
      entries: [
        {
          policy: AUTH_RATE_LIMIT_POLICIES.registrationIp,
          subject: extractClientIp(request)
        },
        {
          policy: AUTH_RATE_LIMIT_POLICIES.registrationAdmission,
          subject: result.data.admissionNumber
        }
      ]
    });

    const user = await createAtomicRegistration(result.data, services);

    const [verificationEmailSent, customToken] = await Promise.all([
      sendInitialVerificationEmail(services, user.uid, requestId),
      createClientCustomToken(services, user.uid, requestId)
    ]);

    return response.status(201).json({
      ok: true,
      stage: "registered",
      user,
      verificationEmailSent,
      ...(customToken ? { customToken } : {})
    });
  } catch (error) {
    applyRetryAfterHeader(response, error);
    const safe = safeErrorPayload(error);
    console.error("Atomic registration failed", {
      requestId,
      reason: String(error?.code || "registration_failed").slice(0, 120),
      errorName: String(error?.name || "Error").slice(0, 80),
      message: String(error?.message || "Unknown error").slice(0, 240)
    });
    return response.status(safe.status).json(safe.payload);
  }
}

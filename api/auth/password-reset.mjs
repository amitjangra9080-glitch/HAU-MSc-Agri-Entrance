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
import { firebaseWebApiKey } from "../_lib/identity-toolkit.mjs";
import { validatePasswordResetInput } from "../_lib/login-validation.mjs";
import {
  SecureLoginError,
  sendAdmissionPasswordReset
} from "../_lib/secure-login-service.mjs";

const MAX_BODY_BYTES = 4 * 1024;
const ACCEPTED_MESSAGE = "If the admission number is linked to an account, a reset email has been sent. Please check your inbox and spam folder.";

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.trim()) {
    if (Buffer.byteLength(request.body, "utf8") > MAX_BODY_BYTES) return "too_large";
    try { return JSON.parse(request.body); } catch { return null; }
  }
  return {};
}

function safeResetError(error) {
  if (error instanceof AuthRateLimitError) {
    return {
      status: 429,
      error: "rate_limited",
      message: "Too many password-reset requests. Try again later."
    };
  }

  if (error instanceof AuthRateLimitServiceError || error instanceof SecureLoginError) {
    return {
      status: 503,
      error: "service_unavailable",
      message: "Password reset is temporarily unavailable."
    };
  }

  return {
    status: 503,
    error: "service_unavailable",
    message: "Password reset is temporarily unavailable."
  };
}

export default async function handler(request, response) {
  setSecurityHeaders(response);

  if (request.method === "GET") {
    return response.status(200).json({
      ok: true,
      service: "secure-password-reset",
      stage: "backend-ready",
      configured: Boolean(firebaseWebApiKey()),
      rateLimitConfigured: isAuthRateLimitConfigured()
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const contentLength = Number(request.headers?.["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response.status(413).json({ ok: false, error: "request_too_large" });
  }

  const body = readBody(request);
  if (body === "too_large") return response.status(413).json({ ok: false, error: "request_too_large" });
  if (body === null) return response.status(400).json({ ok: false, error: "invalid_json" });

  const validation = validatePasswordResetInput(body);
  if (!validation.ok) {
    return response.status(400).json({
      ok: false,
      error: "validation_failed",
      fields: validation.errors
    });
  }

  try {
    const services = await getFirebaseAdmin();
    await consumeAuthRateLimits({
      db: services.db,
      entries: [
        {
          policy: AUTH_RATE_LIMIT_POLICIES.passwordResetIp,
          subject: extractClientIp(request)
        },
        {
          policy: AUTH_RATE_LIMIT_POLICIES.passwordResetAdmission,
          subject: validation.data.admissionNumber
        }
      ]
    });

    await sendAdmissionPasswordReset(validation.data, services);
    return response.status(200).json({
      ok: true,
      stage: "accepted",
      message: ACCEPTED_MESSAGE
    });
  } catch (error) {
    applyRetryAfterHeader(response, error);
    const safe = safeResetError(error);

    console.error("Secure password reset failed", {
      requestId: String(request.headers?.["x-vercel-id"] || "").slice(0, 160),
      reason: String(error?.code || "password_reset_failed").slice(0, 120)
    });

    return response.status(safe.status).json({
      ok: false,
      error: safe.error,
      message: safe.message
    });
  }
}

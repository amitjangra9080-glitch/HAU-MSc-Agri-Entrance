import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitError,
  AuthRateLimitServiceError,
  applyRetryAfterHeader,
  clearAuthRateLimit,
  consumeAuthRateLimits,
  extractClientIp,
  isAuthRateLimitConfigured
} from "../_lib/auth-rate-limit.mjs";
import { getFirebaseAdmin } from "../_lib/firebase-admin.mjs";
import { firebaseWebApiKey } from "../_lib/identity-toolkit.mjs";
import { validateLoginInput } from "../_lib/login-validation.mjs";
import {
  SecureLoginError,
  authenticateAdmissionLogin
} from "../_lib/secure-login-service.mjs";

const MAX_BODY_BYTES = 8 * 1024;

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

function safeLoginError(error) {
  if (error instanceof AuthRateLimitError) {
    return {
      status: 429,
      error: "rate_limited",
      message: "Too many sign-in attempts. Try again later."
    };
  }

  if (error instanceof AuthRateLimitServiceError) {
    return {
      status: 503,
      error: "service_unavailable",
      message: "Authentication service is temporarily unavailable."
    };
  }

  if (error instanceof SecureLoginError) {
    return {
      status: error.status,
      error: error.code,
      message: error.message
    };
  }

  return {
    status: 503,
    error: "service_unavailable",
    message: "Authentication service is temporarily unavailable."
  };
}

export default async function handler(request, response) {
  setSecurityHeaders(response);

  if (request.method === "GET") {
    return response.status(200).json({
      ok: true,
      service: "secure-login",
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

  const validation = validateLoginInput(body);
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
          policy: AUTH_RATE_LIMIT_POLICIES.loginIp,
          subject: extractClientIp(request)
        },
        {
          policy: AUTH_RATE_LIMIT_POLICIES.loginAdmission,
          subject: validation.data.admissionNumber
        }
      ]
    });

    const result = await authenticateAdmissionLogin(validation.data, services);

    await clearAuthRateLimit({
      db: services.db,
      policy: AUTH_RATE_LIMIT_POLICIES.loginAdmission,
      subject: validation.data.admissionNumber
    }).catch((error) => {
      console.warn("Successful login rate-limit reset failed", {
        requestId: String(request.headers?.["x-vercel-id"] || "").slice(0, 160),
        reason: String(error?.code || "rate_limit_clear_failed").slice(0, 120)
      });
    });

    return response.status(200).json({
      ok: true,
      stage: "authenticated",
      customToken: result.customToken,
      user: {
        uid: result.uid,
        emailVerified: result.emailVerified
      }
    });
  } catch (error) {
    applyRetryAfterHeader(response, error);
    const safe = safeLoginError(error);

    console.error("Secure login failed", {
      requestId: String(request.headers?.["x-vercel-id"] || "").slice(0, 160),
      reason: String(safe.error || "login_failed").slice(0, 120)
    });

    return response.status(safe.status).json({
      ok: false,
      error: safe.error,
      message: safe.message
    });
  }
}

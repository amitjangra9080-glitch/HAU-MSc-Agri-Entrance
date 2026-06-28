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

export default async function handler(request, response) {
  setSecurityHeaders(response);

  if (request.method === "GET") {
    return response.status(200).json({
      ok: true,
      service: "secure-login",
      stage: "backend-ready",
      configured: Boolean(firebaseWebApiKey())
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
    const result = await authenticateAdmissionLogin(validation.data, services);
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
    const safe = error instanceof SecureLoginError
      ? error
      : new SecureLoginError(
        "service_unavailable",
        "Authentication service is temporarily unavailable.",
        503,
        error
      );

    console.error("Secure login failed", {
      requestId: String(request.headers?.["x-vercel-id"] || "").slice(0, 160),
      reason: String(safe.code || "login_failed").slice(0, 120)
    });

    return response.status(safe.status).json({
      ok: false,
      error: safe.code,
      message: safe.message
    });
  }
}

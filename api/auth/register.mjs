import { getFirebaseAdmin } from "../_lib/firebase-admin.mjs";
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

export default async function handler(request, response) {
  setSecurityHeaders(response);

  if (request.method === "GET") {
    return response.status(200).json({
      ok: true,
      service: "atomic-registration",
      stage: "atomic-ready",
      writeEnabled: registrationWriteEnabled()
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

  try {
    const services = await getFirebaseAdmin();
    const user = await createAtomicRegistration(result.data, services);
    return response.status(201).json({
      ok: true,
      stage: "registered",
      user
    });
  } catch (error) {
    const safe = safeErrorPayload(error);
    const cause = error?.cause || null;
    const nestedCause = cause?.cause || null;
    const firebaseCode = cause?.errorInfo?.code
      || cause?.code
      || nestedCause?.errorInfo?.code
      || nestedCause?.code
      || "";
    const firebaseMessage = cause?.errorInfo?.message
      || cause?.message
      || nestedCause?.errorInfo?.message
      || nestedCause?.message
      || "";

    console.error("Atomic registration failed", {
      requestId: String(request.headers?.["x-vercel-id"] || "").slice(0, 160),
      reason: String(error?.code || "registration_failed").slice(0, 120),
      errorName: String(error?.name || "Error").slice(0, 80),
      message: String(error?.message || "Unknown error").slice(0, 240),
      firebaseCode: String(firebaseCode).slice(0, 160),
      firebaseMessage: String(firebaseMessage).slice(0, 320)
    });

    if (process.env.VERCEL_ENV !== "production" && firebaseCode) {
      safe.payload.diagnostic = String(firebaseCode).slice(0, 160);
    }

    return response.status(safe.status).json(safe.payload);
  }
}

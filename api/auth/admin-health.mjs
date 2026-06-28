import { getFirebaseAdmin } from "../_lib/firebase-admin.mjs";
import { credentialFailureReason } from "../_lib/firebase-credentials.mjs";

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

export default async function handler(request, response) {
  setSecurityHeaders(response);

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({
      ok: false,
      error: "method_not_allowed"
    });
  }

  try {
    const services = await getFirebaseAdmin();
    if (!services?.app || !services?.auth || !services?.db) {
      throw Object.assign(
        new Error("Firebase Admin services did not initialize."),
        { code: "firebase_services_incomplete" }
      );
    }

    return response.status(200).json({
      ok: true,
      service: "secure-auth-backend",
      stage: "firebase-admin"
    });
  } catch (error) {
    const reason = credentialFailureReason(error);
    console.error("Firebase Admin health check failed", {
      requestId: String(request.headers?.["x-vercel-id"] || "").slice(0, 160),
      reason,
      errorName: String(error?.name || "Error").slice(0, 80),
      errorCode: String(error?.code || "").slice(0, 120),
      message: String(error?.message || "Unknown error").slice(0, 240)
    });

    const payload = {
      ok: false,
      error: "service_unavailable"
    };
    if (process.env.VERCEL_ENV !== "production") payload.reason = reason;
    return response.status(503).json(payload);
  }
}

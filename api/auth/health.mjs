import { credentialFailureReason } from "../_lib/firebase-credentials.mjs";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
});

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status, headers: JSON_HEADERS });
}

export async function GET(request) {
  try {
    const { getFirebaseAdmin } = await import("../_lib/firebase-admin.mjs");
    const services = await getFirebaseAdmin();
    if (!services?.app || !services?.auth || !services?.db) {
      throw new Error("Firebase Admin services did not initialize.");
    }

    return jsonResponse({
      ok: true,
      service: "secure-auth-backend"
    });
  } catch (error) {
    const reason = credentialFailureReason(error);
    console.error("Secure auth backend health check failed", {
      requestId: String(request?.headers?.get?.("x-vercel-id") || "").slice(0, 160),
      reason,
      errorName: String(error?.name || "Error").slice(0, 80),
      errorCode: String(error?.code || "").slice(0, 120),
      message: String(error?.message || "Unknown error").slice(0, 240)
    });

    const payload = { ok: false, error: "service_unavailable" };
    if (process.env.VERCEL_ENV !== "production") payload.reason = reason;
    return jsonResponse(payload, 503);
  }
}

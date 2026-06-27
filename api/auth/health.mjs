import { credentialFailureReason } from "../_lib/firebase-credentials.mjs";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
});

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: JSON_HEADERS
  });
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
    // This diagnostic helper has no Firebase Admin imports, so the error path
    // itself cannot repeat the module-loading failure and crash the function.
    const reason = credentialFailureReason(error);

    console.error("Secure auth backend health check failed", {
      requestId: String(request?.headers?.get?.("x-vercel-id") || "").slice(0, 160),
      reason,
      message: error instanceof Error ? error.message : "Unknown error"
    });

    const payload = {
      ok: false,
      error: "service_unavailable"
    };

    if (process.env.VERCEL_ENV !== "production") {
      payload.reason = reason;
    }

    return jsonResponse(payload, 503);
  }
}

import { getFirebaseAdmin } from "../_lib/firebase-admin.mjs";
import { requestId, requireMethod, sendJson } from "../_lib/http.mjs";

export default async function handler(request, response) {
  if (!requireMethod(request, response, "GET")) return;

  try {
    const { app } = getFirebaseAdmin();
    if (!app) throw new Error("Firebase Admin did not initialize.");

    return sendJson(response, 200, {
      ok: true,
      service: "secure-auth-backend"
    });
  } catch (error) {
    console.error("Secure auth backend health check failed", {
      requestId: requestId(request),
      message: error instanceof Error ? error.message : "Unknown error"
    });

    return sendJson(response, 503, {
      ok: false,
      error: "service_unavailable"
    });
  }
}

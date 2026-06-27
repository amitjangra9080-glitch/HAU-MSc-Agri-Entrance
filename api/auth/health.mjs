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
    const { app } = getFirebaseAdmin();
    if (!app) throw new Error("Firebase Admin did not initialize.");

    return jsonResponse({
      ok: true,
      service: "secure-auth-backend"
    });
  } catch (error) {
    console.error("Secure auth backend health check failed", {
      requestId: String(request?.headers?.get?.("x-vercel-id") || "").slice(0, 160),
      message: error instanceof Error ? error.message : "Unknown error"
    });

    return jsonResponse({
      ok: false,
      error: "service_unavailable"
    }, 503);
  }
}

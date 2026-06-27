const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
});

export function applyApiHeaders(response) {
  Object.entries(JSON_HEADERS).forEach(([name, value]) => response.setHeader(name, value));
}

export function sendJson(response, status, payload) {
  applyApiHeaders(response);
  return response.status(status).json(payload);
}

export function requireMethod(request, response, method) {
  if (request.method === method) return true;
  response.setHeader("Allow", method);
  sendJson(response, 405, {
    ok: false,
    error: "method_not_allowed"
  });
  return false;
}

export function requestId(request) {
  return String(request.headers?.["x-vercel-id"] || "").slice(0, 160);
}

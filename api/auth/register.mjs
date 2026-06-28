import { validateRegistrationInput } from "../_lib/registration-validation.mjs";

function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.trim()) {
    try {
      return JSON.parse(request.body);
    } catch {
      return null;
    }
  }
  return {};
}

export default function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "GET") {
    return response.status(200).json({
      ok: true,
      service: "atomic-registration",
      stage: "validation"
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({
      ok: false,
      error: "method_not_allowed"
    });
  }

  const body = readBody(request);
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

  const { password: _password, ...normalized } = result.data;
  return response.status(200).json({
    ok: true,
    stage: "validation",
    normalized
  });
}

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const COLLECTION_NAME = "authRateLimits";
const MIN_SECRET_LENGTH = 32;

export const AUTH_RATE_LIMIT_POLICIES = Object.freeze({
  registrationIp: Object.freeze({
    scope: "registration_ip",
    limit: 25,
    windowMs: 60 * 60 * 1000,
    blockMs: 60 * 60 * 1000
  }),
  registrationAdmission: Object.freeze({
    scope: "registration_admission",
    limit: 3,
    windowMs: 60 * 60 * 1000,
    blockMs: 60 * 60 * 1000
  }),
  loginIp: Object.freeze({
    scope: "login_ip",
    limit: 120,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000
  }),
  loginAdmission: Object.freeze({
    scope: "login_admission",
    limit: 8,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000
  }),
  passwordResetIp: Object.freeze({
    scope: "password_reset_ip",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    blockMs: 60 * 60 * 1000
  }),
  passwordResetAdmission: Object.freeze({
    scope: "password_reset_admission",
    limit: 3,
    windowMs: 60 * 60 * 1000,
    blockMs: 60 * 60 * 1000
  })
});

export class AuthRateLimitError extends Error {
  constructor(scope, retryAfterSeconds) {
    super("Too many authentication attempts. Try again later.");
    this.name = "AuthRateLimitError";
    this.code = "rate_limited";
    this.status = 429;
    this.scope = scope;
    this.retryAfterSeconds = Math.max(1, Math.ceil(Number(retryAfterSeconds) || 1));
  }
}

export class AuthRateLimitServiceError extends Error {
  constructor(code, cause = undefined) {
    super("Authentication protection is temporarily unavailable.", cause ? { cause } : undefined);
    this.name = "AuthRateLimitServiceError";
    this.code = code;
    this.status = 503;
  }
}

function readHeader(request, name) {
  const headers = request?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  return String(headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "");
}

function normalizeIp(value) {
  let candidate = String(value || "").split(",")[0].trim();
  if (!candidate) return "unknown";

  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  if (candidate.startsWith("::ffff:")) candidate = candidate.slice(7);
  candidate = candidate.toLowerCase().slice(0, 128);
  return isIP(candidate) ? candidate : "unknown";
}

export function extractClientIp(request) {
  return normalizeIp(
    readHeader(request, "x-forwarded-for")
      || readHeader(request, "x-real-ip")
      || request?.socket?.remoteAddress
      || request?.connection?.remoteAddress
  );
}

export function authRateLimitSecret(environment = process.env) {
  const secret = String(environment?.AUTH_RATE_LIMIT_SECRET || "").trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new AuthRateLimitServiceError("missing_auth_rate_limit_secret");
  }
  return secret;
}

export function isAuthRateLimitConfigured(environment = process.env) {
  return String(environment?.AUTH_RATE_LIMIT_SECRET || "").trim().length >= MIN_SECRET_LENGTH;
}

function validatePolicy(policy) {
  if (
    !policy
    || typeof policy.scope !== "string"
    || !Number.isInteger(policy.limit)
    || policy.limit < 1
    || !Number.isFinite(policy.windowMs)
    || policy.windowMs < 1000
    || !Number.isFinite(policy.blockMs)
    || policy.blockMs < 1000
  ) {
    throw new AuthRateLimitServiceError("invalid_rate_limit_policy");
  }
  return policy;
}

export function rateLimitDocumentId(policy, subject, secret = authRateLimitSecret()) {
  const normalizedPolicy = validatePolicy(policy);
  const normalizedSubject = String(subject || "unknown").trim().toLowerCase() || "unknown";
  return createHmac("sha256", secret)
    .update(`${normalizedPolicy.scope}\0${normalizedSubject}`, "utf8")
    .digest("hex");
}

function numericValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function evaluateEntry(snapshot, policy, nowMs) {
  const data = snapshot?.exists ? snapshot.data() || {} : {};
  const currentBlockedUntilMs = numericValue(data.blockedUntilMs);

  if (currentBlockedUntilMs > nowMs) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((currentBlockedUntilMs - nowMs) / 1000),
      writeData: null
    };
  }

  let windowStartedAtMs = numericValue(data.windowStartedAtMs);
  let count = Math.max(0, Math.floor(numericValue(data.count)));
  const invalidWindow = !windowStartedAtMs
    || nowMs < windowStartedAtMs
    || nowMs - windowStartedAtMs >= policy.windowMs;

  if (invalidWindow) {
    windowStartedAtMs = nowMs;
    count = 0;
  }

  if (count >= policy.limit) {
    const blockedUntilMs = nowMs + policy.blockMs;
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil(policy.blockMs / 1000),
      writeData: {
        scope: policy.scope,
        count,
        windowStartedAtMs,
        blockedUntilMs,
        updatedAt: new Date(nowMs),
        expiresAt: new Date(blockedUntilMs + Math.max(policy.windowMs, policy.blockMs))
      }
    };
  }

  const nextCount = count + 1;
  const windowEndsAtMs = windowStartedAtMs + policy.windowMs;
  return {
    blocked: false,
    remaining: Math.max(0, policy.limit - nextCount),
    resetAtMs: windowEndsAtMs,
    writeData: {
      scope: policy.scope,
      count: nextCount,
      windowStartedAtMs,
      blockedUntilMs: 0,
      updatedAt: new Date(nowMs),
      expiresAt: new Date(windowEndsAtMs + Math.max(policy.windowMs, policy.blockMs))
    }
  };
}

export async function consumeAuthRateLimits({
  db,
  entries,
  environment = process.env,
  nowMs = Date.now()
}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new AuthRateLimitServiceError("rate_limit_database_unavailable");
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AuthRateLimitServiceError("rate_limit_entries_missing");
  }

  const secret = authRateLimitSecret(environment);
  const prepared = entries.map((entry) => {
    const policy = validatePolicy(entry?.policy);
    const subject = String(entry?.subject || "unknown").trim().toLowerCase() || "unknown";
    const id = rateLimitDocumentId(policy, subject, secret);
    return {
      policy,
      ref: db.collection(COLLECTION_NAME).doc(id)
    };
  });

  let decision;
  try {
    decision = await db.runTransaction(async (transaction) => {
      const snapshots = typeof transaction.getAll === "function"
        ? await transaction.getAll(...prepared.map((entry) => entry.ref))
        : await Promise.all(prepared.map((entry) => transaction.get(entry.ref)));

      const evaluated = prepared.map((entry, index) => ({
        ...entry,
        ...evaluateEntry(snapshots[index], entry.policy, nowMs)
      }));

      const blocked = evaluated.find((entry) => entry.blocked);
      if (blocked) {
        if (blocked.writeData) transaction.set(blocked.ref, blocked.writeData, { merge: true });
        return {
          blocked: true,
          scope: blocked.policy.scope,
          retryAfterSeconds: blocked.retryAfterSeconds
        };
      }

      evaluated.forEach((entry) => {
        transaction.set(entry.ref, entry.writeData, { merge: true });
      });

      return {
        blocked: false,
        limits: evaluated.map((entry) => ({
          scope: entry.policy.scope,
          remaining: entry.remaining,
          resetAtMs: entry.resetAtMs
        }))
      };
    });
  } catch (error) {
    if (error instanceof AuthRateLimitError || error instanceof AuthRateLimitServiceError) throw error;
    throw new AuthRateLimitServiceError("rate_limit_transaction_failed", error);
  }

  if (decision?.blocked) {
    throw new AuthRateLimitError(decision.scope, decision.retryAfterSeconds);
  }

  return decision;
}

export async function clearAuthRateLimit({
  db,
  policy,
  subject,
  environment = process.env
}) {
  if (!db || typeof db.collection !== "function") {
    throw new AuthRateLimitServiceError("rate_limit_database_unavailable");
  }
  const secret = authRateLimitSecret(environment);
  const id = rateLimitDocumentId(policy, subject, secret);
  try {
    await db.collection(COLLECTION_NAME).doc(id).delete();
  } catch (error) {
    throw new AuthRateLimitServiceError("rate_limit_clear_failed", error);
  }
}

export function applyRetryAfterHeader(response, error) {
  if (error instanceof AuthRateLimitError) {
    response.setHeader("Retry-After", String(error.retryAfterSeconds));
  }
}

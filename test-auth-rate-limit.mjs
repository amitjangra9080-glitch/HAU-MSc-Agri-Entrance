import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthRateLimitError,
  AuthRateLimitServiceError,
  clearAuthRateLimit,
  consumeAuthRateLimits,
  extractClientIp,
  isAuthRateLimitConfigured,
  rateLimitDocumentId
} from "./api/_lib/auth-rate-limit.mjs";

const environment = {
  AUTH_RATE_LIMIT_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
};

class FakeSnapshot {
  constructor(value) {
    this.value = value;
    this.exists = value !== undefined;
  }

  data() {
    return this.value;
  }
}

class FakeDocRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  async delete() {
    this.store.delete(this.path);
  }
}

class FakeTransaction {
  constructor(store) {
    this.store = store;
    this.pending = [];
  }

  async get(ref) {
    return new FakeSnapshot(this.store.get(ref.path));
  }

  async getAll(...refs) {
    return Promise.all(refs.map((ref) => this.get(ref)));
  }

  set(ref, value) {
    this.pending.push({ ref, value });
  }

  commit() {
    this.pending.forEach(({ ref, value }) => {
      this.store.set(ref.path, { ...value });
    });
  }
}

class FakeFirestore {
  constructor() {
    this.store = new Map();
  }

  collection(name) {
    return {
      doc: (id) => new FakeDocRef(this.store, `${name}/${id}`)
    };
  }

  async runTransaction(operation) {
    const transaction = new FakeTransaction(this.store);
    const result = await operation(transaction);
    transaction.commit();
    return result;
  }
}

const testPolicy = Object.freeze({
  scope: "test_login",
  limit: 2,
  windowMs: 10_000,
  blockMs: 5_000
});

test("extractClientIp trusts the first Vercel-forwarded address and normalizes it", () => {
  assert.equal(
    extractClientIp({ headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" } }),
    "203.0.113.8"
  );
  assert.equal(
    extractClientIp({ headers: { "x-forwarded-for": "[2001:db8::1]:443" } }),
    "2001:db8::1"
  );
  assert.equal(extractClientIp({ headers: {} }), "unknown");
});

test("rate-limit document IDs are stable hashes and do not expose the subject", () => {
  const subject = "2099A199BIV";
  const first = rateLimitDocumentId(testPolicy, subject, environment.AUTH_RATE_LIMIT_SECRET);
  const second = rateLimitDocumentId(testPolicy, subject, environment.AUTH_RATE_LIMIT_SECRET);
  const otherScope = rateLimitDocumentId({ ...testPolicy, scope: "other" }, subject, environment.AUTH_RATE_LIMIT_SECRET);

  assert.equal(first, second);
  assert.notEqual(first, otherScope);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes(subject.toLowerCase()), false);
});

test("consumeAuthRateLimits allows the configured number of attempts then blocks", async () => {
  const db = new FakeFirestore();
  const request = {
    db,
    entries: [{ policy: testPolicy, subject: "2099A199BIV" }],
    environment
  };

  const first = await consumeAuthRateLimits({ ...request, nowMs: 1_000 });
  const second = await consumeAuthRateLimits({ ...request, nowMs: 2_000 });

  assert.equal(first.blocked, false);
  assert.equal(second.blocked, false);
  assert.equal(second.limits[0].remaining, 0);

  await assert.rejects(
    consumeAuthRateLimits({ ...request, nowMs: 3_000 }),
    (error) => {
      assert.ok(error instanceof AuthRateLimitError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 5);
      return true;
    }
  );

  const stored = [...db.store.values()][0];
  assert.equal(stored.scope, testPolicy.scope);
  assert.equal(stored.count, 2);
  assert.equal(stored.blockedUntilMs, 8_000);
  assert.equal(JSON.stringify(stored).includes("2099A199BIV"), false);
});

test("a completed window permits a new attempt", async () => {
  const db = new FakeFirestore();
  const request = {
    db,
    entries: [{ policy: testPolicy, subject: "user" }],
    environment
  };

  await consumeAuthRateLimits({ ...request, nowMs: 1_000 });
  await consumeAuthRateLimits({ ...request, nowMs: 2_000 });
  await assert.rejects(consumeAuthRateLimits({ ...request, nowMs: 3_000 }), AuthRateLimitError);

  const result = await consumeAuthRateLimits({ ...request, nowMs: 12_001 });
  assert.equal(result.blocked, false);
  assert.equal(result.limits[0].remaining, 1);
});

test("multiple limits are consumed atomically when none is blocked", async () => {
  const db = new FakeFirestore();
  const policyA = { ...testPolicy, scope: "scope_a", limit: 3 };
  const policyB = { ...testPolicy, scope: "scope_b", limit: 3 };

  await consumeAuthRateLimits({
    db,
    entries: [
      { policy: policyA, subject: "one" },
      { policy: policyB, subject: "two" }
    ],
    environment,
    nowMs: 1_000
  });

  assert.equal(db.store.size, 2);
  for (const value of db.store.values()) assert.equal(value.count, 1);
});

test("clearAuthRateLimit removes a successful login failure bucket", async () => {
  const db = new FakeFirestore();
  await consumeAuthRateLimits({
    db,
    entries: [{ policy: testPolicy, subject: "2099A199BIV" }],
    environment,
    nowMs: 1_000
  });
  assert.equal(db.store.size, 1);

  await clearAuthRateLimit({
    db,
    policy: testPolicy,
    subject: "2099A199BIV",
    environment
  });
  assert.equal(db.store.size, 0);
});

test("a strong server secret is required", async () => {
  assert.equal(isAuthRateLimitConfigured(environment), true);
  assert.equal(isAuthRateLimitConfigured({ AUTH_RATE_LIMIT_SECRET: "short" }), false);

  await assert.rejects(
    consumeAuthRateLimits({
      db: new FakeFirestore(),
      entries: [{ policy: testPolicy, subject: "user" }],
      environment: { AUTH_RATE_LIMIT_SECRET: "short" },
      nowMs: 1_000
    }),
    (error) => {
      assert.ok(error instanceof AuthRateLimitServiceError);
      assert.equal(error.code, "missing_auth_rate_limit_secret");
      return true;
    }
  );
});

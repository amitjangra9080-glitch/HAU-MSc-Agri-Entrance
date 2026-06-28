import assert from "node:assert/strict";
import test from "node:test";

import {
  RegistrationServiceError,
  createAtomicRegistration
} from "./api/_lib/registration-service.mjs";

const registration = Object.freeze({
  displayName: "Test Student",
  admissionNumber: "2024A59BIV",
  campus: "Hisar",
  programme: "4-year programme",
  academicStatus: "2nd Year",
  email: "test.student@example.com",
  phone: "9876543210",
  password: "StrongPass1"
});

function makeSnapshot(value) {
  return {
    exists: value !== undefined,
    data: () => value
  };
}

function makeServices(seed = {}, options = {}) {
  const documents = new Map(Object.entries(seed));
  const writes = [];
  const deletedUsers = [];
  const createdUsers = [];

  function ref(path) {
    return {
      path,
      async get() {
        return makeSnapshot(documents.get(path));
      }
    };
  }

  const db = {
    collection(name) {
      return {
        doc(id) {
          return ref(`${name}/${id}`);
        }
      };
    },
    async runTransaction(operation) {
      if (options.transactionError) throw options.transactionError;
      const pending = [];
      const transaction = {
        async getAll(...refs) {
          return refs.map((candidate) => makeSnapshot(documents.get(candidate.path)));
        },
        create(candidate, value) {
          if (documents.has(candidate.path) || pending.some((entry) => entry.path === candidate.path)) {
            throw new Error(`Document already exists: ${candidate.path}`);
          }
          pending.push({ path: candidate.path, value });
        }
      };
      await operation(transaction);
      for (const entry of pending) {
        documents.set(entry.path, entry.value);
        writes.push(entry);
      }
    }
  };

  const auth = {
    async createUser(input) {
      if (options.authCreateError) throw options.authCreateError;
      createdUsers.push(input);
      return { uid: "uid-test-123" };
    },
    async deleteUser(uid) {
      if (options.authDeleteError) throw options.authDeleteError;
      deletedUsers.push(uid);
    }
  };

  return { auth, db, documents, writes, deletedUsers, createdUsers };
}

test("creates Auth user and all three Firestore records", async () => {
  const services = makeServices();
  const createdAt = new Date("2026-06-28T06:00:00.000Z");

  const result = await createAtomicRegistration(registration, services, {
    now: () => createdAt
  });

  assert.equal(result.uid, "uid-test-123");
  assert.equal(services.createdUsers.length, 1);
  assert.deepEqual(services.createdUsers[0], {
    email: registration.email,
    password: registration.password,
    displayName: registration.displayName,
    emailVerified: false,
    disabled: false
  });
  assert.equal(services.writes.length, 3);
  assert.equal(services.documents.get("users/uid-test-123").password, undefined);
  assert.equal(services.documents.get("users/uid-test-123").active, false);
  assert.equal(services.documents.get("admissionNumbers/2024A59BIV").email, registration.email);
  assert.equal(services.documents.get("phones/9876543210").uid, "uid-test-123");
  assert.deepEqual(services.deletedUsers, []);
});

test("duplicate admission number rolls back the newly created Auth user", async () => {
  const services = makeServices({
    "admissionNumbers/2024A59BIV": { uid: "existing-user" }
  });

  await assert.rejects(
    () => createAtomicRegistration(registration, services),
    (error) => error instanceof RegistrationServiceError && error.code === "admission_in_use"
  );

  assert.deepEqual(services.deletedUsers, ["uid-test-123"]);
  assert.equal(services.writes.length, 0);
});

test("duplicate phone rolls back the newly created Auth user", async () => {
  const services = makeServices({
    "phones/9876543210": { uid: "existing-user" }
  });

  await assert.rejects(
    () => createAtomicRegistration(registration, services),
    (error) => error instanceof RegistrationServiceError && error.code === "phone_in_use"
  );

  assert.deepEqual(services.deletedUsers, ["uid-test-123"]);
  assert.equal(services.writes.length, 0);
});

test("duplicate email is reported before Firestore writes", async () => {
  const services = makeServices({}, {
    authCreateError: Object.assign(new Error("Email exists"), { code: "auth/email-already-exists" })
  });

  await assert.rejects(
    () => createAtomicRegistration(registration, services),
    (error) => error instanceof RegistrationServiceError && error.code === "email_in_use"
  );

  assert.equal(services.writes.length, 0);
  assert.deepEqual(services.deletedUsers, []);
});

test("unexpected Firestore failure rolls back Auth and returns a safe error", async () => {
  const services = makeServices({}, {
    transactionError: Object.assign(new Error("simulated database outage"), { code: "unavailable" })
  });

  await assert.rejects(
    () => createAtomicRegistration(registration, services),
    (error) => error instanceof RegistrationServiceError
      && error.code === "registration_persistence_failed"
      && error.status === 503
  );

  assert.deepEqual(services.deletedUsers, ["uid-test-123"]);
});

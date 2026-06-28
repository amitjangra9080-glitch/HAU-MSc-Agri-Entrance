import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRegistrationInput,
  validateRegistrationInput
} from "./api/_lib/registration-validation.mjs";

const valid = {
  displayName: " Amit  Jangra ",
  admissionNumber: " 2024a59biv ",
  campus: "Hisar",
  programme: "4-year programme",
  academicStatus: "2nd Year",
  email: " AMIT@EXAMPLE.COM ",
  phone: "+91 98765-43210",
  password: "Agri1234"
};

test("normalizes the existing signup fields", () => {
  const normalized = normalizeRegistrationInput(valid);
  assert.equal(normalized.displayName, "Amit Jangra");
  assert.equal(normalized.admissionNumber, "2024A59BIV");
  assert.equal(normalized.email, "amit@example.com");
  assert.equal(normalized.phone, "9876543210");
});

test("accepts a valid Hisar four-year registration", () => {
  const result = validateRegistrationInput(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
});

test("rejects campus and admission prefix mismatch", () => {
  const result = validateRegistrationInput({ ...valid, campus: "Bawal" });
  assert.equal(result.ok, false);
  assert.equal(result.errors.admissionNumber, "Invalid admission number.");
});

test("rejects programme and admission code mismatch", () => {
  const result = validateRegistrationInput({ ...valid, programme: "2+4-year programme" });
  assert.equal(result.ok, false);
  assert.equal(result.errors.admissionNumber, "Invalid admission number.");
});

test("rejects an academic status outside the selected programme", () => {
  const result = validateRegistrationInput({ ...valid, academicStatus: "5th Year" });
  assert.equal(result.ok, false);
  assert.equal(result.errors.academicStatus, "Select a valid academic status.");
});

test("rejects invalid email, phone and weak password", () => {
  const result = validateRegistrationInput({
    ...valid,
    email: "not-an-email",
    phone: "12345",
    password: "password"
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.email, "Valid email format required.");
  assert.equal(result.errors.phone, "Enter a valid 10-digit Indian mobile number.");
  assert.equal(result.errors.password, "Include at least one letter and one number.");
});

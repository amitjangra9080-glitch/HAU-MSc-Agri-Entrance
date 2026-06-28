import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAdmissionNumber,
  validateLoginInput,
  validatePasswordResetInput
} from "./api/_lib/login-validation.mjs";

test("normalizes admission number", () => {
  assert.equal(normalizeAdmissionNumber(" 2099 a199 biv "), "2099A199BIV");
});

test("accepts valid secure login input", () => {
  const result = validateLoginInput({
    admissionNumber: "2099a199biv",
    password: "Example123"
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.admissionNumber, "2099A199BIV");
});

test("rejects invalid admission and empty password", () => {
  const result = validateLoginInput({ admissionNumber: "bad", password: "" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.admissionNumber);
  assert.ok(result.errors.password);
});

test("password reset validates only admission number", () => {
  assert.equal(validatePasswordResetInput({ admissionNumber: "B2024A1BIV" }).ok, true);
  assert.equal(validatePasswordResetInput({ admissionNumber: "invalid" }).ok, false);
});

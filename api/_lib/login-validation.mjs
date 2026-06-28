export const ADMISSION_PATTERN = /^(?:B|K)?\d{4}A(?:[1-9]|[1-9]\d|1\d{2}|200)B(?:IV|VI)R?$/;
const MAX_PASSWORD_LENGTH = 256;

export function normalizeAdmissionNumber(value) {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

export function validateLoginInput(value = {}) {
  const admissionNumber = normalizeAdmissionNumber(value.admissionNumber);
  const password = typeof value.password === "string" ? value.password : "";
  const errors = {};

  if (!ADMISSION_PATTERN.test(admissionNumber)) {
    errors.admissionNumber = "Invalid admission number.";
  }
  if (!password) {
    errors.password = "Enter your password.";
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.password = "Password is too long.";
  }

  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, data: { admissionNumber, password } };
}

export function validatePasswordResetInput(value = {}) {
  const admissionNumber = normalizeAdmissionNumber(value.admissionNumber);
  if (!ADMISSION_PATTERN.test(admissionNumber)) {
    return { ok: false, errors: { admissionNumber: "Invalid admission number." } };
  }
  return { ok: true, data: { admissionNumber } };
}

export const ADMISSION_PATTERN = /^(?:B|K)?\d{4}A(?:[1-9]|[1-9]\d|1\d{2}|200)B(?:IV|VI)R?$/;
const MAX_PASSWORD_LENGTH = 256;

export function normalizeAdmissionNumber(value) {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

function admissionYear(admissionNumber) {
  const match = admissionNumber.match(/^(?:B|K)?(\d{4})A/);
  return match ? Number(match[1]) : null;
}

function admissionError(admissionNumber, currentYear = new Date().getFullYear()) {
  if (!ADMISSION_PATTERN.test(admissionNumber)) {
    return "Invalid admission number or password.";
  }

  const year = admissionYear(admissionNumber);
  if (year !== null && year > currentYear) {
    return "Invalid admission number or password.";
  }

  return "";
}

export function validateLoginInput(value = {}) {
  const admissionNumber = normalizeAdmissionNumber(value.admissionNumber);
  const password = typeof value.password === "string" ? value.password : "";
  const errors = {};

  const validationError = admissionError(admissionNumber);
  if (validationError) {
    errors.admissionNumber = validationError;
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
  const validationError = admissionError(admissionNumber);
  if (validationError) {
    return { ok: false, errors: { admissionNumber: validationError } };
  }
  return { ok: true, data: { admissionNumber } };
}

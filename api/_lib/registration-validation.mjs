const ADMISSION_PATTERN = /^(?:B|K)?\d{4}A(?:[1-9]|[1-9]\d|1\d{2}|200)B(?:IV|VI)R?$/;
const PHONE_PATTERN = /^[6-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CAMPUS_OPTIONS = Object.freeze(["Hisar", "Bawal", "Kaul"]);
export const PROGRAMME_OPTIONS = Object.freeze(["4-year programme", "2+4-year programme"]);
export const ACADEMIC_STATUS_BY_PROGRAMME = Object.freeze({
  "4-year programme": Object.freeze(["1st Year", "2nd Year", "3rd Year", "Final Year", "Passed Out"]),
  "2+4-year programme": Object.freeze(["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Final Year", "Passed Out"])
});

function text(value) {
  return typeof value === "string" ? value : "";
}

export function normalizeAdmissionNumber(value) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

export function normalizePhone(value) {
  return text(value).replace(/^\+91/, "").replace(/\D/g, "");
}

function campusPrefix(campus) {
  if (campus === "Bawal") return "B";
  if (campus === "Kaul") return "K";
  return "";
}

function programmeCode(programme) {
  return programme === "2+4-year programme" ? "VI" : "IV";
}

function validateAdmission(admissionNumber, campus, programme) {
  if (!ADMISSION_PATTERN.test(admissionNumber)) return "Invalid admission number.";

  const expectedPrefix = campusPrefix(campus);
  if (expectedPrefix && !admissionNumber.startsWith(expectedPrefix)) {
    return "Invalid admission number.";
  }
  if (!expectedPrefix && /^[BK]/.test(admissionNumber)) {
    return "Invalid admission number.";
  }

  const selectedProgrammeCode = admissionNumber.match(/B(IV|VI)R?$/)?.[1] || "";
  if (selectedProgrammeCode !== programmeCode(programme)) {
    return "Invalid admission number.";
  }

  return "";
}

function validatePassword(password) {
  if (password.length < 8) return "Password must contain at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return "";
}

export function normalizeRegistrationInput(input = {}) {
  return {
    displayName: text(input.displayName).trim().replace(/\s+/g, " "),
    admissionNumber: normalizeAdmissionNumber(input.admissionNumber),
    campus: text(input.campus).trim(),
    programme: text(input.programme).trim(),
    academicStatus: text(input.academicStatus).trim(),
    email: text(input.email).trim().toLowerCase(),
    phone: normalizePhone(input.phone),
    password: text(input.password)
  };
}

export function validateRegistrationInput(input = {}) {
  const data = normalizeRegistrationInput(input);
  const errors = {};

  if (!data.displayName) errors.displayName = "Enter your display name.";
  if (!CAMPUS_OPTIONS.includes(data.campus)) errors.campus = "Select a valid campus.";
  if (!PROGRAMME_OPTIONS.includes(data.programme)) errors.programme = "Select a valid programme.";

  if (!errors.campus && !errors.programme) {
    const admissionError = validateAdmission(data.admissionNumber, data.campus, data.programme);
    if (admissionError) errors.admissionNumber = admissionError;
  } else if (!data.admissionNumber || !ADMISSION_PATTERN.test(data.admissionNumber)) {
    errors.admissionNumber = "Invalid admission number.";
  }

  const allowedStatuses = ACADEMIC_STATUS_BY_PROGRAMME[data.programme] || [];
  if (!allowedStatuses.includes(data.academicStatus)) {
    errors.academicStatus = "Select a valid academic status.";
  }

  if (!EMAIL_PATTERN.test(data.email)) errors.email = "Valid email format required.";
  if (!PHONE_PATTERN.test(data.phone)) errors.phone = "Enter a valid 10-digit Indian mobile number.";

  const passwordError = validatePassword(data.password);
  if (passwordError) errors.password = passwordError;

  return {
    ok: Object.keys(errors).length === 0,
    data,
    errors
  };
}

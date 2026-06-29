(() => {
  "use strict";

  const FORM_IDS = new Set(["signupForm", "loginForm", "forgotForm"]);

  function normalizeAdmission(value) {
    return String(value || "").toUpperCase().replace(/\s+/g, "");
  }

  function admissionYear(value) {
    const match = normalizeAdmission(value).match(/^(?:B|K)?(\d{4})A/);
    return match ? Number(match[1]) : null;
  }

  function admissionYearError(value, currentYear = new Date().getFullYear()) {
    const year = admissionYear(value);
    return year !== null && year > currentYear
      ? `Admission year cannot be later than ${currentYear}.`
      : "";
  }

  function admissionValueFromForm(form) {
    return form?.elements?.admissionNumber?.value || "";
  }

  function blockFutureAdmissionYear(form, event) {
    if (!form || !FORM_IDS.has(form.id)) return false;

    const error = admissionYearError(admissionValueFromForm(form));
    if (!error) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (typeof setError === "function") {
      setError("admissionNumber", error);
      setError("form", "Please fix the highlighted field above.");
    }

    form.elements?.admissionNumber?.focus?.({ preventScroll: true });
    return true;
  }

  const existingValidateAdmission = typeof validateAdmission === "function"
    ? validateAdmission
    : null;

  if (existingValidateAdmission) {
    validateAdmission = function validateAdmissionWithCurrentYear(
      admissionNumber,
      campus,
      programme
    ) {
      const existingError = existingValidateAdmission(admissionNumber, campus, programme);
      if (existingError) return existingError;
      return admissionYearError(admissionNumber);
    };
  }

  document.addEventListener("submit", (event) => {
    const form = event.target?.closest?.("form");
    blockFutureAdmissionYear(form, event);
  }, true);

  document.addEventListener("click", (event) => {
    const submitControl = event.target?.closest?.(
      "#createAccountButton, #loginButton, #forgotForm button[type='submit']"
    );
    if (!submitControl) return;
    blockFutureAdmissionYear(submitControl.closest("form"), event);
  }, true);

  window.HAU_ADMISSION_YEAR_RULE = Object.freeze({
    normalizeAdmission,
    admissionYear,
    admissionYearError
  });
})();

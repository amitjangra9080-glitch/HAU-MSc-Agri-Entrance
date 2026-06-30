(() => {
  "use strict";

  const ADMISSION_PARTS = /^([BK]?)(\d{4})A(\d+)B(IV|VI)(R?)$/;
  const SIGNUP_REQUIRED_SELECTS = Object.freeze({
    campus: "Select a campus.",
    programme: "Select a programme.",
    academicStatus: "Select academic status."
  });
  const VERIFICATION_TEXT = "Please check your inbox and spam folder.";

  function normalizeBasic(value) {
    return String(value || "").toUpperCase().replace(/\s+/g, "");
  }

  function canonicalizeAdmissionNumber(value) {
    const normalized = normalizeBasic(value);
    const match = normalized.match(ADMISSION_PARTS);
    if (!match) return normalized;

    const rollNumber = Number(match[3]);
    if (!Number.isInteger(rollNumber)) return normalized;

    return `${match[1]}${match[2]}A${rollNumber}B${match[4]}${match[5]}`;
  }

  function canonicalizeAdmissionField(container) {
    const input = container?.querySelector?.('[name="admissionNumber"]');
    if (!input) return "";
    const canonical = canonicalizeAdmissionNumber(input.value);
    if (input.value !== canonical) input.value = canonical;
    return canonical;
  }

  function placeholderOption() {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Select";
    option.disabled = true;
    option.selected = true;
    return option;
  }

  function resetSelectWithPlaceholder(select, options = []) {
    if (!select) return;
    select.replaceChildren(placeholderOption());
    options.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = "";
    select.required = true;
  }

  function addPlaceholderToExistingSelect(select) {
    if (!select) return;
    const values = [...select.options]
      .map((option) => option.value)
      .filter(Boolean);
    resetSelectWithPlaceholder(select, values);
  }

  function configureSignupForm(form) {
    if (!form || form.dataset.manualDropdownsConfigured === "true") return;

    const campus = form.querySelector('[name="campus"]');
    const programme = form.querySelector('[name="programme"]');
    const academicStatus = form.querySelector('[name="academicStatus"]');

    addPlaceholderToExistingSelect(campus);
    addPlaceholderToExistingSelect(programme);
    resetSelectWithPlaceholder(academicStatus);

    form.dataset.manualDropdownsConfigured = "true";
  }

  function populateAcademicStatus(form) {
    const programme = form?.querySelector?.('[name="programme"]')?.value || "";
    const academicStatus = form?.querySelector?.('[name="academicStatus"]');
    const options = programme && typeof academicStatusOptionsFor === "function"
      ? academicStatusOptionsFor(programme)
      : [];

    resetSelectWithPlaceholder(academicStatus, options);
  }

  function showSignupSelectErrors(form) {
    let firstMissing = null;
    let hasError = false;

    Object.entries(SIGNUP_REQUIRED_SELECTS).forEach(([name, message]) => {
      const select = form.querySelector(`[name="${name}"]`);
      const missing = !String(select?.value || "").trim();
      if (typeof setError === "function") setError(name, missing ? message : "");
      if (missing) {
        hasError = true;
        if (!firstMissing) firstMissing = select;
      }
    });

    return { hasError, firstMissing };
  }

  function prepareSignup(event, form) {
    canonicalizeAdmissionField(form);

    const result = showSignupSelectErrors(form);
    if (!result.hasError) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (typeof setError === "function") {
      setError("form", "Please select all required fields.");
    }

    result.firstMissing?.focus?.({ preventScroll: true });
    return true;
  }

  function highlightReminderIn(element) {
    if (!element || !element.textContent.includes(VERIFICATION_TEXT)) return;
    if (element.querySelector(".verification-inbox-reminder")) return;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      const index = node.nodeValue.indexOf(VERIFICATION_TEXT);
      if (index !== -1) {
        const before = node.nodeValue.slice(0, index);
        const after = node.nodeValue.slice(index + VERIFICATION_TEXT.length);
        const fragment = document.createDocumentFragment();

        if (before) fragment.appendChild(document.createTextNode(before));

        const reminder = document.createElement("span");
        reminder.className = "verification-inbox-reminder";
        reminder.textContent = VERIFICATION_TEXT;
        fragment.appendChild(reminder);

        if (after) fragment.appendChild(document.createTextNode(after));

        node.parentNode.replaceChild(fragment, node);
        break;
      }
      node = walker.nextNode();
    }
  }

  function highlightInboxAndSpamReminder() {
    const route = state?.route;
    if (route !== "verify" && route !== "forgot") return;

    const screen = document.querySelector("#app .screen");
    if (!screen) return;

    const selector = route === "verify"
      ? ".notice"
      : ".notice, [data-error='form'], .form-status";

    screen.querySelectorAll(selector).forEach(highlightReminderIn);
  }

  function enhanceCurrentScreen() {
    configureSignupForm(document.querySelector("#signupForm"));
    highlightInboxAndSpamReminder();
  }

  if (!document.querySelector("#registrationInputFixStyles")) {
    const style = document.createElement("style");
    style.id = "registrationInputFixStyles";
    style.textContent = `
      .verification-inbox-reminder {
        display: block;
        margin: 14px 0 4px;
        padding: 12px 14px;
        border: 1px solid rgba(155, 91, 46, 0.34);
        border-radius: 8px;
        background: #fff4cf;
        color: #684215;
        font-weight: 750;
        line-height: 1.45;
      }
    `;
    document.head.appendChild(style);
  }

  const appRoot = document.querySelector("#app");

  appRoot?.addEventListener("change", (event) => {
    const form = event.target.closest?.("#signupForm");
    if (!form) return;

    if (event.target.name === "programme") {
      populateAcademicStatus(form);
      if (typeof setError === "function") {
        setError("programme", "");
        setError("academicStatus", "");
      }
      return;
    }

    if (
      event.target.name === "campus"
      || event.target.name === "academicStatus"
    ) {
      if (typeof setError === "function") setError(event.target.name, "");
    }
  });

  document.addEventListener("focusout", (event) => {
    if (event.target?.name === "admissionNumber") {
      canonicalizeAdmissionField(event.target.closest("form, #signupForm") || document);
    }
  }, true);

  document.addEventListener("click", (event) => {
    const createButton = event.target.closest?.("#createAccountButton");
    if (!createButton) return;

    const form = createButton.closest("#signupForm");
    if (form) prepareSignup(event, form);
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target?.closest?.("form");
    if (!form) return;

    canonicalizeAdmissionField(form);

    if (form.id === "signupForm") {
      prepareSignup(event, form);
    }
  }, true);

  if (typeof MutationObserver === "function" && appRoot) {
    new MutationObserver(enhanceCurrentScreen).observe(appRoot, {
      childList: true,
      subtree: true
    });
  }

  enhanceCurrentScreen();

  window.HAU_REGISTRATION_INPUT_FIXES = Object.freeze({
    canonicalizeAdmissionNumber
  });
})();

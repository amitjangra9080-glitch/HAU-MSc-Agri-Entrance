(function initializeAtomicRegistrationClient(global) {
  "use strict";

  const REGISTER_ENDPOINT = "/api/auth/register";
  const SIGN_IN_ATTEMPTS = 5;
  const VERIFICATION_SEND_ATTEMPTS = 3;
  let registrationInFlight = false;

  function buildRequestBody(data = {}) {
    const {
      confirmPassword: _confirmPassword,
      ...requestBody
    } = data;
    return requestBody;
  }

  function isRegistrationDisabled(status, payload) {
    return status === 503 && payload?.error === "registration_disabled";
  }

  function responseMessage(payload, fallback) {
    return typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : fallback;
  }

  async function readJsonResponse(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function clearSignupErrors() {
    [
      "displayName",
      "admissionNumber",
      "campus",
      "programme",
      "academicStatus",
      "email",
      "phone",
      "password",
      "confirmPassword",
      "form"
    ].forEach((name) => setError(name, ""));
  }

  function normalizeSignupData(form) {
    const data = collectForm(form);
    data.displayName = String(data.displayName || "").trim().replace(/\s+/g, " ");

    const admissionFix = global.HAU_REGISTRATION_INPUT_FIXES;
    data.admissionNumber = typeof admissionFix?.canonicalizeAdmissionNumber === "function"
      ? admissionFix.canonicalizeAdmissionNumber(data.admissionNumber)
      : normalizeAdmissionNumber(String(data.admissionNumber || ""));

    data.phone = normalizePhone(String(data.phone || ""));
    data.email = String(data.email || "").trim().toLowerCase();
    data.campus = String(data.campus || "").trim();
    data.programme = String(data.programme || "").trim();
    data.academicStatus = String(data.academicStatus || "").trim();
    return data;
  }

  function validateSignupBeforeRequest(data) {
    const allowedStatuses = typeof academicStatusOptionsFor === "function"
      ? academicStatusOptionsFor(data.programme)
      : [];

    return {
      displayName: data.displayName ? "" : "Enter your display name.",
      admissionNumber: validateAdmission(data.admissionNumber, data.campus, data.programme),
      campus: campusOptions.includes(data.campus) ? "" : "Select a campus.",
      programme: programmeOptions.includes(data.programme) ? "" : "Select a programme.",
      academicStatus: allowedStatuses.includes(data.academicStatus)
        ? ""
        : "Select academic status.",
      email: emailPattern.test(data.email) ? "" : "Valid email format required.",
      phone: phonePattern.test(data.phone) ? "" : "Enter a valid 10-digit Indian mobile number.",
      password: validatePassword(data.password),
      confirmPassword: data.password === data.confirmPassword ? "" : "Passwords do not match."
    };
  }

  function showFieldErrors(errors = {}) {
    Object.entries(errors).forEach(([name, message]) => setError(name, message));
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function assertExpectedUser(credential, expectedUid) {
    if (!credential?.user?.uid) {
      throw new Error("The newly created account could not be signed in.");
    }
    if (expectedUid && credential.user.uid !== expectedUid) {
      throw new Error("Created account identity did not match the registration response.");
    }
    return credential;
  }

  async function signInWithRegistrationToken(customToken, expectedUid) {
    if (!customToken || typeof state.auth?.signInWithCustomToken !== "function") return null;

    try {
      const credential = await state.auth.signInWithCustomToken(
        state.firebaseAuth,
        customToken
      );
      return assertExpectedUser(credential, expectedUid);
    } catch (error) {
      console.warn("Registration custom-token sign-in failed; using password fallback", error);
      return null;
    }
  }

  async function signInCreatedAccount(data, expectedUid, customToken = "") {
    const tokenCredential = await signInWithRegistrationToken(customToken, expectedUid);
    if (tokenCredential) return tokenCredential;

    let lastError;
    for (let attempt = 0; attempt < SIGN_IN_ATTEMPTS; attempt += 1) {
      try {
        const credential = await state.auth.signInWithEmailAndPassword(
          state.firebaseAuth,
          data.email,
          data.password
        );
        return assertExpectedUser(credential, expectedUid);
      } catch (error) {
        lastError = error;
        if (attempt < SIGN_IN_ATTEMPTS - 1) {
          await sleep(400 * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  function openVerificationPage(data, expectedUid) {
    const {
      password: _password,
      confirmPassword: _confirmPassword,
      ...profile
    } = data;

    state.user = {
      ...profile,
      uid: expectedUid,
      emailVerified: false
    };
    state.route = "verify";
    render();
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  }

  async function sendVerificationWithRetry(credential) {
    let lastError;

    for (let attempt = 0; attempt < VERIFICATION_SEND_ATTEMPTS; attempt += 1) {
      try {
        await state.auth.sendEmailVerification(credential.user);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < VERIFICATION_SEND_ATTEMPTS - 1) {
          await sleep(600 * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  async function completeVerificationSetup(data, payload) {
    try {
      const credential = await signInCreatedAccount(
        data,
        payload.user.uid,
        payload.customToken
      );

      if (payload.verificationEmailSent !== true) {
        await sendVerificationWithRetry(credential);
      }
    } catch (error) {
      console.warn(
        "Account was created and the verification page was opened, but browser verification setup did not finish",
        error
      );
    }
  }

  async function useLegacySignup(form) {
    registrationInFlight = false;
    await handleSignup(form);
  }

  async function submitAtomicRegistration(form) {
    if (registrationInFlight) return;
    if (!state.firebaseReady) {
      await useLegacySignup(form);
      return;
    }

    registrationInFlight = true;
    const button = app.querySelector("#createAccountButton");
    clearSignupErrors();
    setButtonBusy(button, true);

    const data = normalizeSignupData(form);
    const localErrors = validateSignupBeforeRequest(data);
    showFieldErrors(localErrors);
    if (Object.values(localErrors).some(Boolean)) {
      setError("form", "Please fix the highlighted fields above.");
      setButtonBusy(button, false);
      registrationInFlight = false;
      return;
    }

    try {
      setError("form", "Creating your account securely...");
      const response = await fetch(REGISTER_ENDPOINT, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildRequestBody(data))
      });
      const payload = await readJsonResponse(response);

      if (isRegistrationDisabled(response.status, payload)) {
        await useLegacySignup(form);
        return;
      }

      if (!response.ok || !payload?.ok || payload.stage !== "registered" || !payload.user?.uid) {
        if (payload?.error === "validation_failed" && payload.fields) {
          showFieldErrors(payload.fields);
          throw new Error("Please fix the highlighted fields above.");
        }

        if (payload?.error === "email_in_use") {
          const message = "An account already exists with this email address. Sign in instead or use Forgot Password.";
          setError("email", message);
          throw new Error(message);
        }

        throw new Error(responseMessage(payload, "Account could not be created. Please try again."));
      }

      localStorage.removeItem("hau_signed_out");

      // The account is committed. Open the verification screen immediately.
      // Authentication and browser-side email fallback continue independently.
      openVerificationPage(data, payload.user.uid);
      completeVerificationSetup(data, payload);
    } catch (error) {
      console.error("Atomic signup failed", error);
      setError("form", error?.message || "Account could not be created. Please try again.");
      setButtonBusy(button, false);
    } finally {
      registrationInFlight = false;
    }
  }

  function interceptSignup(event) {
    const form = event.type === "submit"
      ? event.target?.closest?.("#signupForm")
      : event.target?.closest?.("#createAccountButton")?.closest?.("#signupForm");
    if (!form) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    submitAtomicRegistration(form);
  }

  function install() {
    document.addEventListener("click", interceptSignup, true);
    document.addEventListener("submit", interceptSignup, true);
  }

  global.HAUAtomicRegistrationClient = Object.freeze({
    buildRequestBody,
    isRegistrationDisabled,
    responseMessage,
    readJsonResponse
  });

  if (typeof document !== "undefined") install();
})(typeof window !== "undefined" ? window : globalThis);

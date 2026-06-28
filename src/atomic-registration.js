(function initializeAtomicRegistrationClient(global) {
  "use strict";

  const REGISTER_ENDPOINT = "/api/auth/register";
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
    data.admissionNumber = normalizeAdmissionNumber(String(data.admissionNumber || ""));
    data.phone = normalizePhone(String(data.phone || ""));
    data.email = String(data.email || "").trim().toLowerCase();
    return data;
  }

  function validateSignupBeforeRequest(data) {
    return {
      displayName: data.displayName ? "" : "Enter your display name.",
      admissionNumber: validateAdmission(data.admissionNumber, data.campus, data.programme),
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

  async function signInCreatedAccount(data, expectedUid) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const credential = await state.auth.signInWithEmailAndPassword(
          state.firebaseAuth,
          data.email,
          data.password
        );
        if (expectedUid && credential.user.uid !== expectedUid) {
          await state.auth.signOut(state.firebaseAuth).catch(() => {});
          throw new Error("Created account identity did not match the registration response.");
        }
        return credential;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(350 * (attempt + 1));
      }
    }
    throw lastError;
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
        throw new Error(responseMessage(payload, "Account could not be created. Please try again."));
      }

      localStorage.removeItem("hau_signed_out");
      setError("form", "Account created. Sending the verification link...");
      const credential = await signInCreatedAccount(data, payload.user.uid);
      await state.auth.sendEmailVerification(credential.user).catch((error) => {
        console.warn("Verification email could not be sent", error);
      });

      const {
        password: _password,
        confirmPassword: _confirmPassword,
        ...profile
      } = data;
      state.user = {
        ...profile,
        uid: credential.user.uid,
        emailVerified: false
      };
      state.route = "verify";
      render();
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

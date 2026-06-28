(function initializeSecureAuthClient(global) {
  "use strict";

  const LOGIN_ENDPOINT = "/api/auth/login";
  const PASSWORD_RESET_ENDPOINT = "/api/auth/password-reset";
  const ADMISSION_PATTERN = /^(?:B|K)?\d{4}A(?:[1-9]|[1-9]\d|1\d{2}|200)B(?:IV|VI)R?$/;
  const GENERIC_RESET_MESSAGE = "If the admission number is linked to an account, a reset email has been sent. Please check your inbox and spam folder.";
  let loginInFlight = false;
  let resetInFlight = false;

  function normalizeAdmission(value) {
    return String(value || "").toUpperCase().replace(/\s+/g, "");
  }

  function buildLoginRequest(data = {}) {
    return {
      admissionNumber: normalizeAdmission(data.admissionNumber),
      password: String(data.password || "")
    };
  }

  function buildPasswordResetRequest(data = {}) {
    return {
      admissionNumber: normalizeAdmission(data.admissionNumber)
    };
  }

  async function readJsonResponse(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function responseMessage(payload, fallback) {
    return typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : fallback;
  }

  function isAuthenticatedResponse(payload) {
    return Boolean(
      payload?.ok
      && payload.stage === "authenticated"
      && typeof payload.customToken === "string"
      && payload.customToken.trim()
      && typeof payload.user?.uid === "string"
      && payload.user.uid.trim()
    );
  }

  function clearLoginErrors() {
    ["admissionNumber", "password", "form"].forEach((name) => setError(name, ""));
  }

  function clearResetErrors() {
    ["admissionNumber", "form"].forEach((name) => setError(name, ""));
  }

  function showFieldErrors(errors = {}) {
    Object.entries(errors).forEach(([name, message]) => setError(name, message));
  }

  function setResetBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? "Sending..." : "Send Reset Link";
  }

  function legacyEvent(form) {
    return {
      preventDefault() {},
      currentTarget: form
    };
  }

  async function useLegacyLogin(form) {
    loginInFlight = false;
    await handleLogin(legacyEvent(form));
  }

  async function useLegacyReset(form) {
    resetInFlight = false;
    await handleForgot(legacyEvent(form));
  }

  async function loadSignedInProfile(uid) {
    const profileRef = state.db.doc(state.firestore, "users", uid);
    const profileSnapshot = await state.db.getDoc(profileRef);
    if (!profileSnapshot.exists()) {
      throw new Error("Your account profile could not be loaded. Please contact support.");
    }
    return profileSnapshot.data() || {};
  }

  async function submitSecureLogin(form) {
    if (loginInFlight) return;
    if (!state.firebaseReady) {
      await useLegacyLogin(form);
      return;
    }

    loginInFlight = true;
    const button = app.querySelector("#loginButton");
    clearLoginErrors();
    setLoginBusy(button, true);

    const requestBody = buildLoginRequest(collectForm(form));
    const localErrors = {
      admissionNumber: requestBody.admissionNumber ? "" : "Enter your admission number.",
      password: requestBody.password ? "" : "Enter your password."
    };
    showFieldErrors(localErrors);
    if (Object.values(localErrors).some(Boolean)) {
      setLoginBusy(button, false);
      loginInFlight = false;
      return;
    }

    let credential = null;
    try {
      setError("form", "Signing in securely...");
      const response = await fetch(LOGIN_ENDPOINT, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
      const payload = await readJsonResponse(response);

      if (payload?.error === "validation_failed" && payload.fields) {
        showFieldErrors(payload.fields);
        throw new Error("Please fix the highlighted fields above.");
      }
      if (!response.ok || !isAuthenticatedResponse(payload)) {
        throw new Error(responseMessage(payload, "Invalid admission number or password."));
      }

      localStorage.removeItem("hau_signed_out");
      credential = await state.auth.signInWithCustomToken(
        state.firebaseAuth,
        payload.customToken
      );
      if (credential.user.uid !== payload.user.uid) {
        throw new Error("The authenticated account did not match the requested account.");
      }

      const profile = await loadSignedInProfile(credential.user.uid);
      const emailVerified = payload.user.emailVerified === true;
      state.user = {
        ...profile,
        uid: credential.user.uid,
        emailVerified
      };

      if (!emailVerified) {
        state.route = "verify";
        render();
        return;
      }

      if (profile.deactivated === true) {
        throw new Error("Your account is scheduled for deletion. Restore your account to continue.");
      }

      const sessionId = makeId();
      localStorage.setItem("hau_active_session", sessionId);
      state.user = {
        ...state.user,
        active: true,
        activeSessionId: sessionId
      };
      state.route = "home";
      render();

      await state.db.updateDoc(
        state.db.doc(state.firestore, "users", credential.user.uid),
        {
          active: true,
          activeSessionId: sessionId,
          lastLoginAt: state.db.serverTimestamp()
        }
      ).catch((error) => {
        console.warn("Login session update was blocked, continuing sign in", error);
      });
    } catch (error) {
      console.error("Secure login failed", error);
      if (credential && state.route !== "verify") {
        await state.auth.signOut(state.firebaseAuth).catch(() => {});
        state.user = null;
      }
      if (state.route !== "verify") {
        setError("form", error?.message || "Invalid admission number or password.");
        setLoginBusy(button, false);
      }
    } finally {
      loginInFlight = false;
    }
  }

  async function submitSecurePasswordReset(form) {
    if (resetInFlight) return;
    if (!state.firebaseReady) {
      await useLegacyReset(form);
      return;
    }

    resetInFlight = true;
    const button = form.querySelector('button[type="submit"]');
    clearResetErrors();
    setResetBusy(button, true);

    const requestBody = buildPasswordResetRequest(collectForm(form));
    if (!ADMISSION_PATTERN.test(requestBody.admissionNumber)) {
      setError("admissionNumber", "Invalid admission number.");
      setResetBusy(button, false);
      resetInFlight = false;
      return;
    }

    try {
      setError("form", "Sending reset link...");
      const response = await fetch(PASSWORD_RESET_ENDPOINT, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
      const payload = await readJsonResponse(response);

      if (payload?.error === "validation_failed" && payload.fields) {
        showFieldErrors(payload.fields);
        throw new Error("Please fix the highlighted field above.");
      }
      if (!response.ok || !payload?.ok || payload.stage !== "accepted") {
        throw new Error(responseMessage(payload, "Password reset is temporarily unavailable."));
      }

      setError("form", responseMessage(payload, GENERIC_RESET_MESSAGE));
    } catch (error) {
      console.error("Secure password reset failed", error);
      setError("form", error?.message || "Password reset is temporarily unavailable.");
    } finally {
      setResetBusy(button, false);
      resetInFlight = false;
    }
  }

  function interceptSecureAuth(event) {
    if (event.type !== "submit") return;
    const form = event.target?.closest?.("form");
    if (!form) return;

    if (form.id === "loginForm") {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitSecureLogin(form);
      return;
    }

    if (form.id === "forgotForm") {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitSecurePasswordReset(form);
    }
  }

  function install() {
    document.addEventListener("submit", interceptSecureAuth, true);
  }

  global.HAUSecureAuthClient = Object.freeze({
    buildLoginRequest,
    buildPasswordResetRequest,
    normalizeAdmission,
    readJsonResponse,
    responseMessage,
    isAuthenticatedResponse
  });

  if (typeof document !== "undefined") install();
})(typeof window !== "undefined" ? window : globalThis);

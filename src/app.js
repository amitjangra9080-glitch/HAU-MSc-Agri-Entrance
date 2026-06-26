const app = document.querySelector("#app");
const firebaseConfig = window.firebaseConfig || {};
const hasFirebaseConfig = Boolean(window.hasFirebaseConfig);

const state = {
  route: "welcome",
  papers: [],
  user: null,
  selectedPaperId: null,
  globalSearch: "",
  paperSearch: "",
  auth: null,
  db: null,
  firebaseReady: false,
  demoUsers: JSON.parse(localStorage.getItem("hau_demo_users") || "[]"),
  activeSession: localStorage.getItem("hau_active_session") || ""
};

const admissionPattern = /^(?:B|K)?\d{4}A(?:[1-9]|[1-9]\d|1\d{2}|200)B(?:IV|VI)R?$/;
const phonePattern = /^[6-9]\d{9}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const campusOptions = [
  "College of Agriculture, Hisar",
  "College of Agriculture, Bawal",
  "College of Agriculture, Kaul"
];

const programmeOptions = ["4-year programme", "2+4-year programme"];
const academicStatusOptions = ["1st Year", "2nd Year", "3rd Year", "4th Year", "Passed Out"];

const icons = {
  back: "‹",
  search: "⌕",
  close: "×",
  home: "⌂",
  user: "♙"
};

function saveDemoUsers() {
  localStorage.setItem("hau_demo_users", JSON.stringify(state.demoUsers));
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeAdmissionNumber(value) {
  return value.toUpperCase().replace(/\s+/g, "");
}

function normalizePhone(value) {
  return value.replace(/^\+91/, "").replace(/\D/g, "");
}

function campusPrefix(campus) {
  if (campus.includes("Bawal")) return "B";
  if (campus.includes("Kaul")) return "K";
  return "";
}

function programmeCode(programme) {
  return programme === "2+4-year programme" ? "VI" : "IV";
}

function validateAdmission(admissionNumber, campus, programme) {
  if (!admissionNumber) return "Enter your admission number.";
  if (!admissionPattern.test(admissionNumber)) return "Use the correct format, for example 2022A59BIV.";
  const expectedPrefix = campusPrefix(campus);
  if (expectedPrefix && !admissionNumber.startsWith(expectedPrefix)) {
    return "Selected campus must match the admission-number prefix.";
  }
  if (!expectedPrefix && /^[BK]/.test(admissionNumber)) {
    return "Hisar admission number should not start with B or K.";
  }
  const selectedProgrammeCode = admissionNumber.match(/B(IV|VI)R?$/)?.[1] || "";
  if (selectedProgrammeCode !== programmeCode(programme)) {
    return "Selected programme must match IV or VI.";
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

function maskEmail(email) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}${"•".repeat(Math.max(4, name.length - 1))}@${domain}`;
}

function questionText(question) {
  return [
    question.question,
    ...Object.entries(question.options || {}).map(([key, value]) => `${key} ${value}`)
  ].join(" ");
}

function selectedPaper() {
  return state.papers.find((paper) => paper.id === state.selectedPaperId) || state.papers[0];
}

function allQuestions() {
  return state.papers.flatMap((paper) =>
    paper.questions.map((question) => ({
      ...question,
      paperTitle: paper.title,
      paperId: paper.id,
      year: paper.year,
      set: paper.set
    }))
  );
}

async function initFirebase() {
  if (!hasFirebaseConfig) return;
  const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
  ]);

  const firebaseApp = initializeApp(firebaseConfig);
  state.auth = authModule;
  state.db = firestoreModule;
  state.firebaseAuth = authModule.getAuth(firebaseApp);
  state.firestore = firestoreModule.getFirestore(firebaseApp);
  state.firebaseReady = true;

  authModule.onAuthStateChanged(state.firebaseAuth, async (firebaseUser) => {
    if (!firebaseUser) return;
    try {
      const profileRef = firestoreModule.doc(state.firestore, "users", firebaseUser.uid);
      const profileSnap = await firestoreModule.getDoc(profileRef);
      if (profileSnap.exists()) {
        state.user = { uid: firebaseUser.uid, ...profileSnap.data(), emailVerified: firebaseUser.emailVerified };
        state.route = firebaseUser.emailVerified ? "home" : "verify";
        render();
      }
    } catch (error) {
      console.warn("Saved session could not be restored", error);
    }
  });
}

async function signupFirebase(data) {
  const { auth, db, firebaseAuth, firestore } = state;
  const admissionRef = db.doc(firestore, "admissionNumbers", data.admissionNumber);
  const phoneRef = db.doc(firestore, "phones", data.phone);
  const credential = await auth.createUserWithEmailAndPassword(firebaseAuth, data.email, data.password);
  await auth.updateProfile(credential.user, { displayName: data.displayName });

  try {
    const [admissionSnap, phoneSnap] = await Promise.all([db.getDoc(admissionRef), db.getDoc(phoneRef)]);
    if (admissionSnap.exists()) throw new Error("An account already exists with this admission number. Sign in or reset your password.");
    if (phoneSnap.exists()) throw new Error("This phone number is already linked to an account. Sign in or recover your account.");

    await db.setDoc(db.doc(firestore, "users", credential.user.uid), {
      uid: credential.user.uid,
      displayName: data.displayName,
      admissionNumber: data.admissionNumber,
      campus: data.campus,
      programme: data.programme,
      academicStatus: data.academicStatus,
      email: data.email,
      phone: data.phone,
      active: false,
      deactivated: false,
      createdAt: db.serverTimestamp()
    });
    await Promise.all([
      db.setDoc(admissionRef, { uid: credential.user.uid, email: data.email }),
      db.setDoc(phoneRef, { uid: credential.user.uid })
    ]);
  } catch (error) {
    await auth.deleteUser(credential.user).catch(() => {});
    throw error;
  }

  await auth.sendEmailVerification(credential.user).catch((error) => {
    console.warn("Verification email could not be sent", error);
  });
  state.user = { ...data, uid: credential.user.uid, emailVerified: false };
  state.route = "verify";
}

async function loginFirebase(admissionNumber, password) {
  const { auth, db, firebaseAuth, firestore } = state;
  const admissionSnap = await db.getDoc(db.doc(firestore, "admissionNumbers", admissionNumber));
  if (!admissionSnap.exists()) throw new Error("Invalid admission number or password.");
  const admissionData = admissionSnap.data();
  if (!admissionData.email) {
    throw new Error("This account was created before the login fix. Create a new test account or add email to the admission lookup in Firestore.");
  }
  const credential = await auth.signInWithEmailAndPassword(firebaseAuth, admissionData.email, password);
  const userSnap = await db.getDoc(db.doc(firestore, "users", credential.user.uid));
  if (!userSnap.exists()) throw new Error("Invalid admission number or password.");
  const profile = userSnap.data();
  if (!credential.user.emailVerified) {
    state.user = { ...profile, uid: credential.user.uid, emailVerified: false };
    state.route = "verify";
    throw new Error("Verify your email before signing in.");
  }
  if (profile.deactivated) throw new Error("Your account is scheduled for deletion. Restore your account to continue.");
  const sessionId = makeId();
  localStorage.setItem("hau_active_session", sessionId);
  const nextUser = { ...profile, uid: credential.user.uid, emailVerified: true, active: true, activeSessionId: sessionId };
  state.user = nextUser;
  state.route = "home";
  await db.updateDoc(db.doc(firestore, "users", credential.user.uid), {
    active: true,
    activeSessionId: sessionId,
    lastLoginAt: db.serverTimestamp()
  }).catch((error) => {
    console.warn("Login session update was blocked, continuing sign in", error);
  });
}

async function signupDemo(data) {
  if (state.demoUsers.some((user) => user.admissionNumber === data.admissionNumber)) {
    throw new Error("An account already exists with this admission number. Sign in or reset your password.");
  }
  if (state.demoUsers.some((user) => user.email === data.email)) {
    throw new Error("This email is already linked to an account. Sign in instead.");
  }
  if (state.demoUsers.some((user) => user.phone === data.phone)) {
    throw new Error("This phone number is already linked to an account. Sign in or recover your account.");
  }
  const user = { ...data, uid: makeId(), emailVerified: false, active: false };
  state.demoUsers.push(user);
  saveDemoUsers();
  state.user = user;
  state.route = "verify";
}

async function loginDemo(admissionNumber, password) {
  const user = state.demoUsers.find((entry) => entry.admissionNumber === admissionNumber && entry.password === password);
  if (!user) throw new Error("Invalid admission number or password.");
  if (!user.emailVerified) {
    state.user = user;
    state.route = "verify";
    throw new Error("Verify your email before signing in.");
  }
  const sessionId = makeId();
  user.activeSessionId = sessionId;
  localStorage.setItem("hau_active_session", sessionId);
  saveDemoUsers();
  state.user = user;
  state.route = "home";
}

function htmlescape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function topbar(title, subtitle = "", backRoute = "") {
  return `
    <div class="topbar">
      ${backRoute ? `<button class="icon-button" data-route="${backRoute}" aria-label="Back">${icons.back}</button>` : ""}
      <div class="top-title">
        <h1>${htmlescape(title)}</h1>
        ${subtitle ? `<p>${htmlescape(subtitle)}</p>` : ""}
      </div>
    </div>
  `;
}

function bottomNav(activeRoute) {
  return `
    <nav class="bottom-nav" aria-label="Main navigation">
      <button class="nav-item ${activeRoute === "home" ? "active" : ""}" type="button" data-route="home" aria-label="Home">
        <span class="nav-icon">${icons.home}</span>
        <span>Home</span>
      </button>
      <button class="nav-item ${activeRoute === "profile" ? "active" : ""}" type="button" data-route="profile" aria-label="Profile">
        <span class="nav-icon">${icons.user}</span>
        <span>Profile</span>
      </button>
    </nav>
  `;
}

function field(name, label, type = "text", value = "", attrs = "") {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <input id="${name}" name="${name}" type="${type}" value="${htmlescape(value)}" ${attrs} />
      <div class="error" data-error="${name}"></div>
    </div>
  `;
}

function selectField(name, label, options) {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <select id="${name}" name="${name}">
        ${options.map((option) => `<option value="${htmlescape(option)}">${htmlescape(option)}</option>`).join("")}
      </select>
      <div class="error" data-error="${name}"></div>
    </div>
  `;
}

function passwordField(name, label) {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <div class="password-row">
        <input id="${name}" name="${name}" type="password" />
        <button class="show-pass" type="button" data-toggle-password="${name}">Show</button>
      </div>
      <div class="error" data-error="${name}"></div>
    </div>
  `;
}

function renderWelcome() {
  app.innerHTML = `
    <section class="screen welcome">
      <div>
        <div class="brand-mark">HAU</div>
        <h1 class="title">HAU M.Sc. PYQs</h1>
        <p class="support">Search previous-year questions, read clear explanations, and explore related topics.</p>
      </div>
      <div class="stack">
        <button class="button" data-route="login">Sign In</button>
        <button class="button secondary" data-route="signup">Create Account</button>
      </div>
    </section>
  `;
}

function renderLogin() {
  app.innerHTML = `
    <section class="screen">
      ${topbar("Sign In", "Use admission number and password", "welcome")}
      <form class="form" id="loginForm">
        ${field("admissionNumber", "Admission number", "text", "", "autocomplete=\"username\"")}
        ${passwordField("password", "Password")}
        <div class="error" data-error="form"></div>
        <button class="button" type="submit">Sign In</button>
        <button class="button ghost" type="button" data-route="forgot">Forgot Password</button>
        <button class="button secondary" type="button" data-route="signup">Create Account</button>
      </form>
    </section>
  `;
}

function renderSignup() {
  app.innerHTML = `
    <section class="screen">
      ${topbar("Create Account", "Student details", "welcome")}
      <div class="form" id="signupForm">
        ${field("displayName", "Full Name")}
        ${field("admissionNumber", "Admission number")}
        ${selectField("campus", "Campus", campusOptions)}
        ${selectField("programme", "Programme", programmeOptions)}
        ${selectField("academicStatus", "Current academic status", academicStatusOptions)}
        ${field("email", "Email address", "email", "", "autocomplete=\"email\"")}
        ${field("phone", "Mobile number", "tel", "", "inputmode=\"tel\"")}
        ${passwordField("password", "Password")}
        ${passwordField("confirmPassword", "Confirm password")}
        <div class="notice">Accounts stay inactive until email verification is complete.</div>
        <div class="form-status" data-error="form">Ready to create account.</div>
        <button class="button" type="button" id="createAccountButton">Create Account</button>
      </div>
    </section>
  `;
}

function renderVerify() {
  const email = state.user?.email || "";
  app.innerHTML = `
    <section class="screen">
      ${topbar("Check your email", "Verification required", "login")}
      <div class="stack">
        <div class="notice">
          <strong>Verification email has been sent</strong><br />
          ${htmlescape(email)}<br /><br />
          No app access is allowed before verification.
        </div>
        <button class="button" id="markVerified">I have verified my email</button>
        <button class="button secondary" id="resendVerification">Resend verification link</button>
        <button class="button secondary" id="changeEmail">Change email address</button>
        <button class="button ghost" data-route="login">Return to sign in</button>
      </div>
    </section>
  `;
}

function renderForgot() {
  app.innerHTML = `
    <section class="screen">
      ${topbar("Forgot Password", "Recover through admission number", "login")}
      <form class="form" id="forgotForm">
        ${field("admissionNumber", "Admission number")}
        <div class="notice">A reset link will be sent to the verified email linked with this admission number.</div>
        <div class="error" data-error="form"></div>
        <button class="button" type="submit">Send Reset Link</button>
      </form>
    </section>
  `;
}

function renderHome() {
  const query = state.globalSearch.trim().toLowerCase();
  const papers = state.papers;
  const results = query
    ? allQuestions().filter((question) => questionText(question).toLowerCase().includes(query))
    : [];
  const totalQuestions = papers.reduce((sum, paper) => sum + paper.questions.length, 0);
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <div class="top-title">
          <h1>HAU M.Sc Agri Entrance</h1>
          <p>${state.firebaseReady ? "Firebase connected" : "Demo mode until Firebase is connected"}</p>
        </div>
      </div>
      <div class="home-head">
        <div class="search">
          <span>${icons.search}</span>
          <input id="globalSearch" value="${htmlescape(state.globalSearch)}" placeholder="Search all PYQs" />
        </div>
        <div class="stats">
          <div class="stat"><strong>${papers.length}</strong><span>Papers</span></div>
          <div class="stat"><strong>${totalQuestions}</strong><span>Questions</span></div>
          <div class="stat"><strong>2018-25</strong><span>Years</span></div>
        </div>
      </div>
      ${
        query
          ? `<div class="question-list">${results.slice(0, 80).map(renderQuestionCard).join("") || `<div class="empty">No matches found.</div>`}</div>`
          : `<div class="paper-list">${papers.map(renderPaperCard).join("")}</div>`
      }
      ${bottomNav("home")}
    </section>
  `;
}

function profileRow(label, value) {
  return `
    <div class="profile-row">
      <span>${htmlescape(label)}</span>
      <strong>${htmlescape(value || "Not available")}</strong>
    </div>
  `;
}

function renderProfile() {
  const user = state.user || {};
  if (!state.user) {
    state.route = "welcome";
    render();
    return;
  }
  app.innerHTML = `
    <section class="screen app-screen">
      <div class="topbar">
        <div class="top-title">
          <h1>Profile</h1>
          <p>Your student details</p>
        </div>
      </div>
      <div class="profile-card">
        <div class="profile-avatar">${htmlescape((user.displayName || "H").trim().slice(0, 1).toUpperCase())}</div>
        <h2>${htmlescape(user.displayName || "Student")}</h2>
        <p>${htmlescape(user.admissionNumber || "")}</p>
      </div>
      <div class="profile-list">
        ${profileRow("Full Name", user.displayName)}
        ${profileRow("Admission number", user.admissionNumber)}
        ${profileRow("Campus", user.campus)}
        ${profileRow("Programme", user.programme)}
        ${profileRow("Current academic status", user.academicStatus)}
        ${profileRow("Email address", user.email)}
        ${profileRow("Mobile number", user.phone)}
      </div>
      <button class="button danger profile-logout" id="logoutButton" type="button">Log out</button>
      ${bottomNav("profile")}
    </section>
  `;
}

function renderPaperCard(paper) {
  return `
    <button class="paper-card" data-paper="${paper.id}">
      <h2>${htmlescape(paper.title)}</h2>
      <p>Set ${paper.set} · ${paper.questionCount} questions · ${paper.answerCount} answers</p>
      <div class="pill-row">
        <span class="pill">PYQ ${paper.year}</span>
        <span class="pill">Set ${paper.set}</span>
      </div>
    </button>
  `;
}

function renderPaper() {
  const paper = selectedPaper();
  const query = state.paperSearch.trim().toLowerCase();
  const questions = query
    ? paper.questions.filter((question) => questionText(question).toLowerCase().includes(query))
    : paper.questions;
  app.innerHTML = `
    <section class="screen">
      ${topbar(paper.title, `Set ${paper.set} · ${paper.questionCount} questions`, "home")}
      <div class="search">
        <span>${icons.search}</span>
        <input id="paperSearch" value="${htmlescape(state.paperSearch)}" placeholder="Search within this PYP" />
      </div>
      <div class="question-list">
        ${questions.map((question) => renderQuestionCard({ ...question, paperTitle: paper.title, year: paper.year, set: paper.set })).join("") || `<div class="empty">No matches found.</div>`}
      </div>
      ${bottomNav("home")}
    </section>
  `;
}

function renderQuestionCard(question) {
  return `
    <article class="question-card">
      <div class="q-meta"><span>${htmlescape(question.paperTitle || "")}</span><span>Q.${question.number}</span></div>
      <h2>${htmlescape(question.question)}</h2>
      <div class="options">
        ${["A", "B", "C", "D"]
          .map((key) => {
            const correct = question.correctOption === key || String(question.correctOption || "").split("/").includes(key);
            return `
              <div class="option ${correct ? "correct" : ""}">
                <span class="option-key">${key}</span>
                <span>${htmlescape(question.options?.[key] || "")}</span>
              </div>
            `;
          })
          .join("")}
      </div>
      <div class="answer-line">Correct answer: ${htmlescape(question.correctOption)}</div>
      ${question.parseWarning ? `<div class="warning">${htmlescape(question.parseWarning)}</div>` : ""}
    </article>
  `;
}

function render() {
  const routes = {
    welcome: renderWelcome,
    login: renderLogin,
    signup: renderSignup,
    verify: renderVerify,
    forgot: renderForgot,
    home: renderHome,
    profile: renderProfile,
    paper: renderPaper
  };
  routes[state.route]();
}

function refocusInput(id) {
  requestAnimationFrame(() => {
    const input = app.querySelector(`#${id}`);
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function setError(name, value) {
  const element = app.querySelector(`[data-error="${name}"]`);
  if (!element) return;
  element.textContent = value || "";
  element.classList.toggle("status-message", Boolean(value) && name === "form");
  if (value && name === "form") {
    element.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "Creating..." : "Create Account";
}

function friendlyFirebaseError(error) {
  const code = error?.code || "";
  const message = error?.message || "";
  const suffix = code ? ` (${code})` : "";
  if (code.includes("auth/email-already-in-use")) return "This email is already linked to an account. Sign in instead.";
  if (code.includes("auth/operation-not-allowed")) return "Email/password sign-in is not enabled in Firebase Authentication.";
  if (code.includes("auth/invalid-email")) return "Valid email format required.";
  if (code.includes("permission-denied")) return `Firestore blocked this action. I need to adjust the security rules.${suffix}`;
  if (code.includes("unavailable") || message.includes("network")) return `Firebase network request failed. Check internet connection and try again.${suffix}`;
  return `${message || "Account could not be created. Try again."}${suffix}`;
}

function collectForm(form) {
  const fields = form.querySelectorAll("input[name], select[name]");
  return Object.fromEntries([...fields].map((field) => [field.name, field.value]));
}

async function handleSignup(eventOrForm) {
  eventOrForm?.preventDefault?.();
  const form = eventOrForm?.currentTarget?.id === "signupForm"
    ? eventOrForm.currentTarget
    : app.querySelector("#signupForm");
  const button = app.querySelector("#createAccountButton");
  if (!form) {
    setError("form", "Signup form was not found. Reload the page and try again.");
    return;
  }
  setError("form", "");
  setButtonBusy(button, true);
  setError("form", `Button received. Starting validation at ${new Date().toLocaleTimeString()}.`);
  const data = collectForm(form);
  data.admissionNumber = normalizeAdmissionNumber(data.admissionNumber);
  data.phone = normalizePhone(data.phone);
  data.email = data.email.trim().toLowerCase();
  const errors = {
    displayName: data.displayName.trim() ? "" : "Enter your display name.",
    admissionNumber: validateAdmission(data.admissionNumber, data.campus, data.programme),
    email: emailPattern.test(data.email) ? "" : "Valid email format required.",
    phone: phonePattern.test(data.phone) ? "" : "Enter a valid 10-digit Indian mobile number.",
    password: validatePassword(data.password),
    confirmPassword: data.password === data.confirmPassword ? "" : "Passwords do not match."
  };
  Object.entries(errors).forEach(([name, value]) => setError(name, value));
  if (Object.values(errors).some(Boolean)) {
    setError("form", "Please fix the highlighted fields above.");
    setButtonBusy(button, false);
    return;
  }
  try {
    setError("form", `Validation passed. Firebase mode: ${state.firebaseReady ? "connected" : "demo"}. Creating account...`);
    if (state.firebaseReady) await signupFirebase(data);
    else await signupDemo(data);
    render();
  } catch (error) {
    console.error("Signup failed", error);
    setError("form", friendlyFirebaseError(error));
    setButtonBusy(button, false);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  setError("form", "");
  const data = collectForm(event.currentTarget);
  const admissionNumber = normalizeAdmissionNumber(data.admissionNumber);
  setError("admissionNumber", admissionNumber ? "" : "Enter your admission number.");
  setError("password", data.password ? "" : "Enter your password.");
  if (!admissionNumber || !data.password) return;
  try {
    if (state.firebaseReady) await loginFirebase(admissionNumber, data.password);
    else await loginDemo(admissionNumber, data.password);
    render();
  } catch (error) {
    if (state.route === "verify") render();
    else setError("form", friendlyFirebaseError(error) || "Invalid admission number or password.");
  }
}

function handleForgot(event) {
  event.preventDefault();
  const admissionNumber = normalizeAdmissionNumber(collectForm(event.currentTarget).admissionNumber);
  const user = state.demoUsers.find((entry) => entry.admissionNumber === admissionNumber);
  const message = user
    ? `A password-reset link has been sent to ${maskEmail(user.email)}.`
    : "If the admission number is linked to a verified email, a reset link will be sent.";
  setError("form", message);
}

app.addEventListener("click", async (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    state.route = routeButton.dataset.route;
    render();
    return;
  }

  const paperButton = event.target.closest("[data-paper]");
  if (paperButton) {
    state.selectedPaperId = paperButton.dataset.paper;
    state.paperSearch = "";
    state.route = "paper";
    render();
    return;
  }

  const passwordButton = event.target.closest("[data-toggle-password]");
  if (passwordButton) {
    const input = app.querySelector(`#${passwordButton.dataset.togglePassword}`);
    input.type = input.type === "password" ? "text" : "password";
    passwordButton.textContent = input.type === "password" ? "Show" : "Hide";
    return;
  }

  if (event.target.id === "logoutButton") {
    state.user = null;
    state.route = "welcome";
    localStorage.removeItem("hau_active_session");
    render();
    return;
  }

  if (event.target.id === "markVerified" && state.user) {
    if (state.firebaseReady && state.firebaseAuth.currentUser) {
      await state.auth.reload(state.firebaseAuth.currentUser);
      if (!state.firebaseAuth.currentUser.emailVerified) return;
    } else {
      const user = state.demoUsers.find((entry) => entry.uid === state.user.uid);
      if (user) user.emailVerified = true;
      saveDemoUsers();
    }
    state.user.emailVerified = true;
    state.route = "login";
    render();
    return;
  }

  if (event.target.id === "resendVerification") {
    if (state.firebaseReady && state.firebaseAuth.currentUser) {
      await state.auth.sendEmailVerification(state.firebaseAuth.currentUser);
    }
    event.target.textContent = "Verification link sent";
  }

  if (event.target.id === "changeEmail") {
    state.route = "signup";
    render();
  }

  if (event.target.id === "createAccountButton") {
    handleSignup(event);
  }
});

app.addEventListener("submit", (event) => {
  if (event.target.id === "signupForm") handleSignup(event);
  if (event.target.id === "loginForm") handleLogin(event);
  if (event.target.id === "forgotForm") handleForgot(event);
});

app.addEventListener("input", (event) => {
  if (event.target.name === "admissionNumber") {
    const position = event.target.selectionStart;
    event.target.value = normalizeAdmissionNumber(event.target.value);
    event.target.setSelectionRange(position, position);
  }
  if (event.target.name === "phone") {
    event.target.value = normalizePhone(event.target.value);
  }
  if (event.target.id === "globalSearch") {
    state.globalSearch = event.target.value;
    renderHome();
    refocusInput("globalSearch");
  }
  if (event.target.id === "paperSearch") {
    state.paperSearch = event.target.value;
    renderPaper();
    refocusInput("paperSearch");
  }
});

async function boot() {
  if (Array.isArray(window.HAU_PAPERS)) {
    state.papers = window.HAU_PAPERS;
  } else {
    state.papers = await fetch("src/data/papers.json").then((response) => response.json());
  }
  await initFirebase().catch(() => {
    state.firebaseReady = false;
  });
  state.route = state.user ? "home" : "welcome";
  render();
}

boot();

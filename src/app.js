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
  questionNavOpen: false,
  selectedTestPaperId: null,
  currentAttempt: null,
  testQuestionNumber: 1,
  testQuestionStartedAt: Date.now(),
  testPaletteOpen: false,
  testMessage: "",
  testTick: Date.now(),
  testSubmitting: false,
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
  "Hisar",
  "Bawal",
  "Kaul"
];

const programmeOptions = ["4-year programme", "2+4-year programme"];
const academicStatusByProgramme = {
  "4-year programme": ["1st Year", "2nd Year", "3rd Year", "Final Year", "Passed Out"],
  "2+4-year programme": ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Final Year", "Passed Out"]
};

const icons = {
  back: "‹",
  search: "⌕",
  close: "×",
  home: "⌂",
  test: "□",
  user: "♙"
};

const optionKeys = ["A", "B", "C", "D"];
let attemptAutosaveTimer = null;
let attemptPersistRunning = false;
let pendingAttemptSnapshot = null;
let attemptPersistPromise = Promise.resolve();
const testTicker = setInterval(syncTestTimer, 1000);

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

function academicStatusOptionsFor(programme) {
  return academicStatusByProgramme[programme] || academicStatusByProgramme[programmeOptions[0]];
}

function validateAdmission(admissionNumber, campus, programme) {
  if (!admissionNumber) return "Invalid admission number.";
  if (!admissionPattern.test(admissionNumber)) return "Invalid admission number.";
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

function maskEmail(email) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}${"•".repeat(Math.max(4, name.length - 1))}@${domain}`;
}

function questionText(question) {
  return [
    `Q${question.number}`,
    `Q.${question.number}`,
    String(question.number),
    question.question,
    ...Object.entries(question.options || {}).map(([key, value]) => `${key} ${value}`)
  ].join(" ");
}

function questionMatchesSearch(question, query) {
  const cleanQuery = query.trim().toLowerCase();
  const numberQuery = cleanQuery.match(/^q\.?\s*(\d+)$/)?.[1] || cleanQuery.match(/^\d+$/)?.[0];
  if (numberQuery && Number(numberQuery) === Number(question.number)) return true;
  return questionText(question).toLowerCase().includes(cleanQuery);
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

function selectedTestPaper() {
  return state.papers.find((paper) => paper.id === state.selectedTestPaperId) || state.papers[0];
}

function testDurationMs(paper) {
  return paper.questions.length > 100 ? 2 * 60 * 60 * 1000 : 80 * 60 * 1000;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function testAttemptId(paperId) {
  return `${state.user?.uid || "demo"}_${paperId}`;
}

function testAttemptRef(paperId) {
  return state.db.doc(state.firestore, "testAttempts", testAttemptId(paperId));
}

function demoAttemptKey(paperId) {
  return `hau_test_attempt_${testAttemptId(paperId)}`;
}

function testCloseMarkerKey(paperId) {
  return `hau_pending_test_pause_${testAttemptId(paperId)}`;
}

function blankAttempt(paper) {
  const now = Date.now();
  const durationMs = testDurationMs(paper);
  return {
    uid: state.user.uid,
    paperId: paper.id,
    paperTitle: paper.title,
    year: paper.year,
    set: paper.set,
    status: "active",
    questionCount: paper.questions.length,
    durationMs,
    remainingMs: durationMs,
    pauseCount: 0,
    lastPauseAtMs: null,
    activeStartedAtMs: now,
    startedAtMs: now,
    expiresAtMs: now + durationMs,
    submittedAtMs: null,
    currentQuestion: 1,
    answers: {},
    markedForReview: {},
    visited: { 1: true },
    timeSpent: {},
    result: null,
    createdAtMs: now,
    updatedAtMs: now
  };
}

function remainingAttemptMs(attempt) {
  if (!attempt) return 0;
  if (attempt.status === "paused") return Math.max(0, attempt.remainingMs || 0);
  return Math.max(0, (attempt.expiresAtMs || 0) - Date.now());
}

function timeTakenMs(attempt) {
  const duration = attempt.durationMs || 0;
  const remaining = attempt.status === "submitted"
    ? Math.max(0, attempt.remainingMs || 0)
    : remainingAttemptMs(attempt);
  return Math.max(0, duration - remaining);
}

async function loadTestAttempt(paperId) {
  if (!state.user) return null;
  if (state.firebaseReady) {
    const snap = await state.db.getDoc(testAttemptRef(paperId));
    return snap.exists() ? snap.data() : null;
  }
  return JSON.parse(localStorage.getItem(demoAttemptKey(paperId)) || "null");
}

async function saveTestAttempt(attempt) {
  const nextAttempt = { ...attempt, updatedAtMs: Date.now() };
  state.currentAttempt = nextAttempt;
  pendingAttemptSnapshot = JSON.parse(JSON.stringify(nextAttempt));
  await persistPendingAttempt();
  return nextAttempt;
}

async function writeAttemptSnapshot(snapshot) {
  if (state.firebaseReady) {
    await state.db.setDoc(testAttemptRef(snapshot.paperId), snapshot);
  } else {
    localStorage.setItem(demoAttemptKey(snapshot.paperId), JSON.stringify(snapshot));
  }
}

function persistPendingAttempt() {
  if (attemptPersistRunning) return attemptPersistPromise;
  attemptPersistRunning = true;
  attemptPersistPromise = (async () => {
    try {
      while (pendingAttemptSnapshot) {
        const snapshot = pendingAttemptSnapshot;
        pendingAttemptSnapshot = null;
        await writeAttemptSnapshot(snapshot);
      }
    } finally {
      attemptPersistRunning = false;
      if (pendingAttemptSnapshot) await persistPendingAttempt();
    }
  })();
  return attemptPersistPromise;
}

function saveTestAttemptQuietly(attempt) {
  state.currentAttempt = { ...attempt, updatedAtMs: Date.now() };
  clearTimeout(attemptAutosaveTimer);
  attemptAutosaveTimer = setTimeout(() => {
    saveTestAttempt(state.currentAttempt).catch((error) => {
      console.error("Test autosave failed", error);
      state.testMessage = "Autosave is having trouble. Your latest tap is still kept on this device.";
    });
  }, 350);
}

function cancelPendingAttemptAutosave() {
  clearTimeout(attemptAutosaveTimer);
  attemptAutosaveTimer = null;
}

async function flushCurrentAttempt() {
  cancelPendingAttemptAutosave();
  if (state.currentAttempt) await saveTestAttempt(state.currentAttempt);
}

function applyAttemptPatch(patch) {
  const attempt = {
    ...state.currentAttempt,
    ...patch,
    answers: { ...(state.currentAttempt.answers || {}), ...(patch.answers || {}) },
    markedForReview: { ...(state.currentAttempt.markedForReview || {}), ...(patch.markedForReview || {}) },
    visited: { ...(state.currentAttempt.visited || {}), ...(patch.visited || {}) },
    timeSpent: { ...(state.currentAttempt.timeSpent || {}), ...(patch.timeSpent || {}) },
    updatedAtMs: Date.now()
  };
  state.currentAttempt = attempt;
  saveTestAttemptQuietly(attempt);
  return attempt;
}

function activeQuestion() {
  const paper = selectedTestPaper();
  return paper.questions.find((question) => Number(question.number) === Number(state.testQuestionNumber)) || paper.questions[0];
}

function questionStatus(attempt, questionNumber) {
  const visited = Boolean(attempt.visited?.[questionNumber]);
  const answered = Boolean(attempt.answers?.[questionNumber]);
  const marked = Boolean(attempt.markedForReview?.[questionNumber]);
  if (answered && marked) return "answered-review";
  if (marked) return "review";
  if (answered) return "answered";
  if (visited) return "not-answered";
  return "not-visited";
}

function statusLabel(status) {
  return {
    "not-visited": "Not visited",
    "not-answered": "Not answered",
    answered: "Answered",
    review: "Marked for review",
    "answered-review": "Answered and marked for review"
  }[status] || status;
}

function attemptStatusCounts(attempt, paper) {
  return paper.questions.reduce((counts, question) => {
    const status = questionStatus(attempt, question.number);
    counts[status] += 1;
    return counts;
  }, { "not-visited": 0, "not-answered": 0, answered: 0, review: 0, "answered-review": 0 });
}

function calculateResult(attempt, paper) {
  let correct = 0;
  let incorrect = 0;
  let unattempted = 0;
  const review = {};
  paper.questions.forEach((question) => {
    const selected = attempt.answers?.[question.number] || "";
    const isCorrect = selected && selected === question.correctOption;
    if (!selected) unattempted += 1;
    else if (isCorrect) correct += 1;
    else incorrect += 1;
    review[question.number] = {
      selected,
      correctOption: question.correctOption,
      isCorrect: Boolean(isCorrect),
      timeSpentMs: attempt.timeSpent?.[question.number] || 0
    };
  });
  const total = paper.questions.length;
  const attempted = correct + incorrect;
  const score = correct;
  return {
    score,
    totalMarks: total,
    correct,
    incorrect,
    unattempted,
    accuracy: attempted ? Math.round((correct / attempted) * 10000) / 100 : 0,
    percentageScore: Math.round((score / total) * 10000) / 100,
    timeTakenMs: timeTakenMs(attempt),
    sectionPerformance: { Overall: { correct, incorrect, unattempted, total } },
    review
  };
}

async function submitAttempt(reason = "manual") {
  if (!state.currentAttempt) return;
  if (state.currentAttempt.status === "submitted") {
    state.route = "test-result";
    render();
    return;
  }
  if (state.testSubmitting) return;
  state.testSubmitting = true;
  try {
    if (state.route === "test-submit") renderSubmitSummary();
    recordQuestionTime();
    cancelPendingAttemptAutosave();
    const paper = selectedTestPaper();
    const attemptForResult = {
      ...state.currentAttempt,
      remainingMs: remainingAttemptMs(state.currentAttempt)
    };
    const result = calculateResult(attemptForResult, paper);
    const submittedAttempt = {
      ...attemptForResult,
      status: "submitted",
      submittedAtMs: Date.now(),
      submitReason: reason,
      result,
      locked: true
    };
    state.currentAttempt = submittedAttempt;
    state.testSubmitting = false;
    state.route = "test-result";
    render();
    saveTestAttempt(submittedAttempt).catch((error) => {
      console.error("Could not save submitted test", error);
      state.testMessage = "Result is shown, but saving is having trouble. Please keep the page open.";
    });
  } catch (error) {
    console.error("Could not submit test", error);
    state.testMessage = "Submit could not complete. Please try again.";
    state.testSubmitting = false;
    if (state.route === "test-submit") renderSubmitSummary();
  } finally {
    state.testSubmitting = false;
  }
}

function syncTestTimer() {
  if (state.route !== "test-taking" || !state.currentAttempt || state.currentAttempt.status !== "active") return;
  const remainingMs = remainingAttemptMs(state.currentAttempt);
  const timer = document.querySelector("#testTimer");
  if (timer) timer.textContent = formatDuration(remainingMs);
  if (remainingMs <= 0) submitAttempt("timeout");
}

async function ensureAttemptFresh() {
  if (state.currentAttempt?.status === "active" && remainingAttemptMs(state.currentAttempt) <= 0) {
    await submitAttempt("timeout");
  }
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
    if (!firebaseUser) {
      state.user = null;
      return;
    }
    if (localStorage.getItem("hau_signed_out") === "true") {
      await authModule.signOut(state.firebaseAuth).catch(() => {});
      state.user = null;
      return;
    }
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
  localStorage.removeItem("hau_signed_out");
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
  localStorage.removeItem("hau_signed_out");
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
  localStorage.removeItem("hau_signed_out");
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
  localStorage.removeItem("hau_signed_out");
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
      <button class="nav-item ${activeRoute === "tests" ? "active" : ""}" type="button" data-route="tests" aria-label="Tests">
        <span class="nav-icon">${icons.test}</span>
        <span>Tests</span>
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

function updateAcademicStatusOptions(programme) {
  const academicStatusSelect = app.querySelector("#academicStatus");
  if (!academicStatusSelect) return;
  academicStatusSelect.innerHTML = academicStatusOptionsFor(programme)
    .map((option) => `<option value="${htmlescape(option)}">${htmlescape(option)}</option>`)
    .join("");
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
        <button class="button" type="submit" id="loginButton">Sign In</button>
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
        ${selectField("campus", "College of Agriculture", campusOptions)}
        ${selectField("programme", "Programme", programmeOptions)}
        ${selectField("academicStatus", "Current academic status", academicStatusOptionsFor(programmeOptions[0]))}
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
          Please check your inbox and spam folder.<br /><br />
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
        <div class="notice">A reset link will be sent to the email linked with this admission number. Please check your inbox and spam folder.</div>
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
        </div>
      </div>
      <div class="home-head">
        <div class="search sticky-search">
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

function renderTests() {
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <div class="top-title">
          <h1>Tests</h1>
          <p>Attempt each PYP once</p>
        </div>
      </div>
      <div class="paper-list">
        ${state.papers.map((paper) => renderTestPaperCard(paper)).join("")}
      </div>
      ${bottomNav("tests")}
    </section>
  `;
}

function renderTestPaperCard(paper) {
  return `
    <button class="paper-card" data-test-paper="${paper.id}">
      <h2>${htmlescape(paper.title)}</h2>
      <p>${paper.questions.length} questions · ${paper.questions.length} marks · ${formatDuration(testDurationMs(paper))}</p>
      <div class="pill-row">
        <span class="pill">One attempt</span>
        <span class="pill">No negative marking</span>
      </div>
    </button>
  `;
}

function renderTestIntro() {
  const paper = selectedTestPaper();
  const attempt = state.currentAttempt;
  const submitted = attempt?.status === "submitted";
  const resumable = attempt?.status === "active" || attempt?.status === "paused";
  const pauseCount = attempt?.pauseCount || 0;
  app.innerHTML = `
    <section class="screen">
      ${topbar("Test Instructions", paper.title, "tests")}
      <div class="test-summary">
        <div><span>Questions</span><strong>${paper.questions.length}</strong></div>
        <div><span>Total marks</span><strong>${paper.questions.length}</strong></div>
        <div><span>Time limit</span><strong>${formatDuration(testDurationMs(paper))}</strong></div>
        <div><span>Negative marking</span><strong>0</strong></div>
        <div><span>Allowed attempts</span><strong>Only one</strong></div>
        <div><span>Pause used</span><strong>${pauseCount}/2</strong></div>
        <div><span>Time left</span><strong>${attempt ? formatDuration(remainingAttemptMs(attempt)) : formatDuration(testDurationMs(paper))}</strong></div>
      </div>
      <div class="notice">
        <strong>Scoring formula</strong><br />
        Correct answer: +1<br />
        Incorrect answer: 0<br />
        Unattempted answer: 0<br /><br />
        The timer begins after Start Test. Pausing stops the timer, and each test can be paused only 2 times.
      </div>
      <div class="stack">
        ${
          submitted
            ? `<button class="button" type="button" id="viewTestResult">View Result</button>`
            : resumable
              ? `<button class="button" type="button" id="resumeTest">Resume Test</button>`
              : `<button class="button" type="button" id="startTest">Start Test</button>`
        }
        <button class="button secondary" type="button" data-route="tests">Back to Tests</button>
      </div>
      ${state.testMessage ? `<div class="form-status status-message">${htmlescape(state.testMessage)}</div>` : ""}
      ${bottomNav("tests")}
    </section>
  `;
}

function renderTestTaking() {
  const paper = selectedTestPaper();
  const attempt = state.currentAttempt;
  if (!attempt) {
    renderTestIntro();
    return;
  }
  const question = activeQuestion();
  const selectedAnswer = attempt.answers?.[question.number] || "";
  const paused = attempt.status === "paused";
  const remainingMs = remainingAttemptMs(attempt);
  if (remainingMs <= 0) {
    submitAttempt("timeout");
    return;
  }
  app.innerHTML = `
    <section class="screen test-screen">
      <div class="test-topbar">
        <div>
          <h1>${htmlescape(paper.title)}</h1>
          <p>Q.${question.number} of ${paper.questions.length}</p>
        </div>
        <strong id="testTimer">${formatDuration(remainingMs)}</strong>
      </div>
      <article class="test-question-card">
        <h2>${htmlescape(question.question)}</h2>
        <div class="test-options">
          ${optionKeys.map((key) => `
            <button class="${selectedAnswer === key ? "selected" : ""}" type="button" data-test-answer="${key}" ${paused ? "disabled" : ""}>
              <span>${key}</span>
              <strong>${htmlescape(question.options?.[key] || "")}</strong>
            </button>
          `).join("")}
        </div>
      </article>
      ${paused ? `<div class="notice">Test is paused. Resume to continue answering.</div>` : ""}
      <div class="test-actions">
        <button class="button secondary" type="button" id="prevTestQuestion" ${paused ? "disabled" : ""}>Previous</button>
        <button class="button secondary" type="button" id="clearTestAnswer" ${paused ? "disabled" : ""}>Clear</button>
        <button class="button secondary" type="button" id="markTestReview" ${paused ? "disabled" : ""}>${attempt.markedForReview?.[question.number] ? "Unmark" : "Mark"}</button>
        <button class="button" type="button" id="nextTestQuestion" ${paused ? "disabled" : ""}>Next</button>
      </div>
      <button class="question-nav-handle test-palette-handle" type="button" id="testPaletteOpen" ${paused ? "disabled" : ""}>Palette</button>
      ${renderTestPalette(paper, attempt)}
      ${
        paused
          ? `
            <button class="button test-submit-button" type="button" id="resumePausedTest">Resume Test</button>
            <button class="button secondary test-submit-button" type="button" id="leavePausedTest">Quit Test Window</button>
            <button class="button danger test-submit-button" type="button" id="openSubmitSummary">Submit Test</button>
          `
          : `
            <button class="button secondary test-submit-button" type="button" id="pauseTestButton" ${Number(attempt.pauseCount || 0) >= 2 ? "disabled" : ""}>
              ${Number(attempt.pauseCount || 0) >= 2 ? "Pause limit reached" : "Pause Test"}
            </button>
            <button class="button danger test-submit-button" type="button" id="openSubmitSummary">Submit Test</button>
          `
      }
    </section>
  `;
}

function renderTestPalette(paper, attempt) {
  return `
    <div class="question-nav-layer ${state.testPaletteOpen ? "open" : ""}" aria-hidden="${state.testPaletteOpen ? "false" : "true"}">
      <button class="question-nav-backdrop" type="button" id="testPaletteClose" aria-label="Close test palette"></button>
      <aside class="question-nav-panel">
        <div class="question-nav-head">
          <div>
            <h2>Palette</h2>
            <p>Open any question</p>
          </div>
          <button class="icon-button" type="button" id="testPaletteCloseButton" aria-label="Close">${icons.close}</button>
        </div>
        <div class="palette-legend">
          <span class="legend-dot answered"></span>Answered
          <span class="legend-dot review"></span>Review
          <span class="legend-dot not-answered"></span>Not answered
        </div>
        <div class="question-number-grid test-number-grid">
          ${paper.questions.map((question) => `
            <button class="${questionStatus(attempt, question.number)} ${Number(question.number) === Number(state.testQuestionNumber) ? "current" : ""}" type="button" data-test-jump="${question.number}">
              ${question.number}
            </button>
          `).join("")}
        </div>
      </aside>
    </div>
  `;
}

function renderSubmitSummary() {
  const paper = selectedTestPaper();
  const counts = attemptStatusCounts(state.currentAttempt, paper);
  app.innerHTML = `
    <section class="screen">
      ${topbar("Submit Test", "Confirm final submission", "")}
      <div class="status-table">
        <div><span>Answered</span><strong>${counts.answered + counts["answered-review"]}</strong></div>
        <div><span>Not answered</span><strong>${counts["not-answered"]}</strong></div>
        <div><span>Marked for review</span><strong>${counts.review + counts["answered-review"]}</strong></div>
        <div><span>Not visited</span><strong>${counts["not-visited"]}</strong></div>
      </div>
      <div class="notice">Once submitted, the test cannot be resumed or edited.</div>
      <div class="stack">
        <button class="button danger" type="button" id="confirmSubmitTest" ${state.testSubmitting ? "disabled" : ""}>
          ${state.testSubmitting ? "Submitting..." : "Submit Now"}
        </button>
        <button class="button secondary" type="button" id="cancelSubmitTest">Continue Test</button>
      </div>
    </section>
  `;
}

function renderTestResult() {
  const paper = selectedTestPaper();
  const attempt = state.currentAttempt;
  const result = attempt?.result || calculateResult(attempt, paper);
  app.innerHTML = `
    <section class="screen">
      ${topbar("Result", paper.title, "tests")}
      <div class="result-score">
        <span>Score</span>
        <strong>${result.score}/${result.totalMarks}</strong>
      </div>
      <div class="test-summary">
        <div><span>Correct</span><strong>${result.correct}</strong></div>
        <div><span>Incorrect</span><strong>${result.incorrect}</strong></div>
        <div><span>Unattempted</span><strong>${result.unattempted}</strong></div>
        <div><span>Accuracy</span><strong>${result.accuracy}%</strong></div>
        <div><span>Percentage</span><strong>${result.percentageScore}%</strong></div>
        <div><span>Time taken</span><strong>${formatDuration(result.timeTakenMs)}</strong></div>
      </div>
      <div class="question-list">
        ${paper.questions.map((question) => renderResultQuestion(question, result.review?.[question.number] || {})).join("")}
      </div>
      ${bottomNav("tests")}
    </section>
  `;
}

function renderResultQuestion(question, review) {
  return `
    <article class="question-card">
      <div class="q-meta"><span>Q.${question.number}</span><span>${review.isCorrect ? "Correct" : review.selected ? "Incorrect" : "Unattempted"}</span></div>
      <h2>${htmlescape(question.question)}</h2>
      <div class="answer-line">Your answer: ${htmlescape(review.selected || "Not attempted")}</div>
      <div class="answer-line">Correct answer: ${htmlescape(question.correctOption)}</div>
      <div class="answer-line">Time spent: ${formatDuration(review.timeSpentMs || 0)}</div>
      <div class="notice">Explanation, reference and topic will appear here after they are added.</div>
    </article>
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
    ? paper.questions.filter((question) => questionMatchesSearch(question, query))
    : paper.questions;
  app.innerHTML = `
    <section class="screen">
      ${topbar(paper.title, `Set ${paper.set} · ${paper.questionCount} questions`, "home")}
      <div class="search sticky-search">
        <span>${icons.search}</span>
        <input id="paperSearch" value="${htmlescape(state.paperSearch)}" placeholder="Search within this PYP" />
      </div>
      <div class="question-list">
        ${questions.map((question) => renderQuestionCard({ ...question, paperTitle: paper.title, year: paper.year, set: paper.set })).join("") || `<div class="empty">No matches found.</div>`}
      </div>
      <button class="question-nav-handle" type="button" id="questionNavOpen">Q.No</button>
      ${renderQuestionNav(paper)}
      ${bottomNav("home")}
    </section>
  `;
}

function renderQuestionNav(paper) {
  return `
    <div class="question-nav-layer ${state.questionNavOpen ? "open" : ""}" aria-hidden="${state.questionNavOpen ? "false" : "true"}">
      <button class="question-nav-backdrop" type="button" id="questionNavClose" aria-label="Close question navigation"></button>
      <aside class="question-nav-panel">
        <div class="question-nav-head">
          <div>
            <h2>Questions</h2>
            <p>Jump to question</p>
          </div>
          <button class="icon-button" type="button" id="questionNavCloseButton" aria-label="Close">${icons.close}</button>
        </div>
        <div class="question-number-grid">
          ${paper.questions
            .map((question) => `<button type="button" data-jump-question="${question.number}">${question.number}</button>`)
            .join("")}
        </div>
      </aside>
    </div>
  `;
}

function renderQuestionCard(question) {
  return `
    <article class="question-card" id="question-${question.number}">
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
    tests: renderTests,
    "test-intro": renderTestIntro,
    "test-taking": renderTestTaking,
    "test-submit": renderSubmitSummary,
    "test-result": renderTestResult,
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

function setLoginBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "Signing in..." : "Sign In";
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
  const button = app.querySelector("#loginButton");
  setLoginBusy(button, true);
  const data = collectForm(event.currentTarget);
  const admissionNumber = normalizeAdmissionNumber(data.admissionNumber);
  setError("admissionNumber", admissionNumber ? "" : "Enter your admission number.");
  setError("password", data.password ? "" : "Enter your password.");
  if (!admissionNumber || !data.password) {
    setLoginBusy(button, false);
    return;
  }
  try {
    if (state.firebaseReady) await loginFirebase(admissionNumber, data.password);
    else await loginDemo(admissionNumber, data.password);
    render();
  } catch (error) {
    if (state.route === "verify") render();
    else {
      setError("form", friendlyFirebaseError(error) || "Invalid admission number or password.");
      setLoginBusy(button, false);
    }
  }
}

async function handleForgot(event) {
  event.preventDefault();
  const admissionNumber = normalizeAdmissionNumber(collectForm(event.currentTarget).admissionNumber);
  if (!admissionNumber || !admissionPattern.test(admissionNumber)) {
    setError("admissionNumber", "Invalid admission number.");
    return;
  }
  setError("admissionNumber", "");
  setError("form", "Sending reset link...");
  try {
    if (state.firebaseReady) {
      const admissionSnap = await state.db.getDoc(state.db.doc(state.firestore, "admissionNumbers", admissionNumber));
      if (admissionSnap.exists() && admissionSnap.data().email) {
        await state.auth.sendPasswordResetEmail(state.firebaseAuth, admissionSnap.data().email);
      }
      setError("form", "If the admission number is linked to an account, a reset email has been sent. Please check your inbox and spam folder.");
      return;
    }
    const user = state.demoUsers.find((entry) => entry.admissionNumber === admissionNumber);
    const message = user
      ? `A password-reset link has been sent to ${maskEmail(user.email)}. Please check your inbox and spam folder.`
      : "If the admission number is linked to an account, a reset email has been sent. Please check your inbox and spam folder.";
    setError("form", message);
  } catch (error) {
    console.error("Password reset failed", error);
    setError("form", friendlyFirebaseError(error));
  }
}

async function openTestPaper(paperId) {
  state.selectedTestPaperId = paperId;
  state.testMessage = "";
  let attempt = await loadTestAttempt(paperId);
  attempt = await reconcileClosedTestPause(attempt, paperId);
  state.currentAttempt = attempt;
  if (attempt?.status === "submitted") {
    state.route = "test-result";
  } else {
    state.testQuestionNumber = attempt?.currentQuestion || 1;
    state.testQuestionStartedAt = Date.now();
    state.route = "test-intro";
  }
  render();
}

async function startOrResumeTest() {
  const paper = selectedTestPaper();
  let attempt = state.currentAttempt;
  const now = Date.now();
  if (!attempt) {
    attempt = blankAttempt(paper);
  }
  if (attempt.status === "submitted") {
    state.route = "test-result";
    render();
    return;
  }
  const remainingMs = attempt.status === "paused"
    ? Math.max(0, attempt.remainingMs || testDurationMs(paper))
    : remainingAttemptMs(attempt);
  attempt = {
    ...attempt,
    status: "active",
    remainingMs,
    activeStartedAtMs: now,
    expiresAtMs: now + remainingMs
  };
  state.currentAttempt = attempt;
  state.testQuestionNumber = attempt.currentQuestion || 1;
  state.testQuestionStartedAt = Date.now();
  state.testPaletteOpen = false;
  state.route = "test-taking";
  render();
  saveTestAttempt(attempt).catch((error) => {
    console.error("Could not save test start", error);
    state.testMessage = "Test opened, but saving is having trouble. Please keep the page open.";
  });
  await ensureAttemptFresh();
}

function patchActiveAttempt(patch) {
  return applyAttemptPatch(patch);
}

function recordQuestionTime() {
  if (!state.currentAttempt || state.currentAttempt.status !== "active") return;
  const elapsed = Math.max(0, Date.now() - state.testQuestionStartedAt);
  if (elapsed < 500) return;
  const questionNumber = state.testQuestionNumber;
  const timeSpent = { ...(state.currentAttempt.timeSpent || {}) };
  timeSpent[questionNumber] = (timeSpent[questionNumber] || 0) + elapsed;
  state.testQuestionStartedAt = Date.now();
  saveTestAttemptQuietly({ ...state.currentAttempt, timeSpent });
}

async function pauseActiveTest(source = "manual") {
  if (!state.currentAttempt || state.currentAttempt.status !== "active") return;
  if (Number(state.currentAttempt.pauseCount || 0) >= 2) {
    state.testMessage = "Pause limit reached. You cannot pause this test again. Continue or submit the test.";
    renderTestTaking();
    return;
  }
  recordQuestionTime();
  cancelPendingAttemptAutosave();
  const remainingMs = remainingAttemptMs(state.currentAttempt);
  const attempt = {
    ...state.currentAttempt,
    status: "paused",
    remainingMs,
    pauseCount: Number(state.currentAttempt.pauseCount || 0) + 1,
    lastPauseAtMs: Date.now(),
    lastPauseSource: source,
    activeStartedAtMs: null,
    expiresAtMs: null
  };
  localStorage.removeItem(testCloseMarkerKey(attempt.paperId));
  state.currentAttempt = attempt;
  state.testMessage = `Test paused. Pauses used: ${attempt.pauseCount}/2.`;
  state.route = "test-taking";
  render();
  saveTestAttempt(attempt).catch((error) => {
    console.error("Could not save paused test", error);
    state.testMessage = "Test paused, but saving is having trouble. Please keep the page open.";
  });
}

async function reconcileClosedTestPause(attempt, paperId) {
  if (!attempt || attempt.status !== "active") return attempt;
  const markerKey = testCloseMarkerKey(paperId);
  const marker = JSON.parse(localStorage.getItem(markerKey) || "null");
  if (!marker) return attempt;
  localStorage.removeItem(markerKey);
  const pauseCount = Number(attempt.pauseCount || 0);
  if (pauseCount >= 2) {
    state.currentAttempt = {
      ...attempt,
      remainingMs: Math.max(0, marker.remainingMs || remainingAttemptMs(attempt))
    };
    await submitAttempt("pause-limit");
    state.testMessage = "Pause limit was already used. The test was submitted automatically.";
    return state.currentAttempt;
  }
  const pausedAttempt = {
    ...attempt,
    status: "paused",
    remainingMs: Math.max(0, marker.remainingMs || remainingAttemptMs(attempt)),
    pauseCount: pauseCount + 1,
    lastPauseAtMs: marker.atMs || Date.now(),
    lastPauseSource: "closed-app",
    activeStartedAtMs: null,
    expiresAtMs: null
  };
  await saveTestAttempt(pausedAttempt);
  state.testMessage = `Test paused because the app was closed. Pauses used: ${pausedAttempt.pauseCount}/2.`;
  return pausedAttempt;
}

function rememberActiveTestClose() {
  const attempt = state.currentAttempt;
  if (!attempt || attempt.status !== "active" || state.route !== "test-taking") return;
  localStorage.setItem(testCloseMarkerKey(attempt.paperId), JSON.stringify({
    paperId: attempt.paperId,
    remainingMs: remainingAttemptMs(attempt),
    atMs: Date.now()
  }));
}

function moveTestQuestion(nextNumber) {
  recordQuestionTime();
  const paper = selectedTestPaper();
  const bounded = Math.min(Math.max(Number(nextNumber), 1), paper.questions.length);
  state.testQuestionNumber = bounded;
  state.testQuestionStartedAt = Date.now();
  patchActiveAttempt({
    currentQuestion: bounded,
    visited: { [bounded]: true }
  });
  ensureAttemptFresh();
  renderTestTaking();
}

function selectTestAnswer(answer) {
  recordQuestionTime();
  const question = activeQuestion();
  const attempt = patchActiveAttempt({
    answers: { [question.number]: answer },
    visited: { [question.number]: true }
  });
  renderTestTaking();
  saveTestAttempt(attempt).catch((error) => {
    console.error("Could not save selected answer", error);
    state.testMessage = "Answer selected, but saving is having trouble. Please keep the page open.";
  });
}

function clearTestAnswer() {
  recordQuestionTime();
  const question = activeQuestion();
  const answers = { ...(state.currentAttempt.answers || {}) };
  delete answers[question.number];
  state.currentAttempt = { ...state.currentAttempt, answers, updatedAtMs: Date.now() };
  saveTestAttemptQuietly(state.currentAttempt);
  renderTestTaking();
}

function toggleReview() {
  recordQuestionTime();
  const question = activeQuestion();
  const markedForReview = { ...(state.currentAttempt.markedForReview || {}) };
  if (markedForReview[question.number]) delete markedForReview[question.number];
  else markedForReview[question.number] = true;
  state.currentAttempt = { ...state.currentAttempt, markedForReview, updatedAtMs: Date.now() };
  saveTestAttemptQuietly(state.currentAttempt);
  renderTestTaking();
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
    state.questionNavOpen = false;
    state.route = "paper";
    render();
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    return;
  }

  const testPaperButton = event.target.closest("[data-test-paper]");
  if (testPaperButton) {
    await openTestPaper(testPaperButton.dataset.testPaper);
    return;
  }

  if (event.target.id === "startTest" || event.target.id === "resumeTest") {
    await startOrResumeTest();
    return;
  }

  if (event.target.id === "viewTestResult") {
    state.route = "test-result";
    render();
    return;
  }

  if (event.target.id === "resumePausedTest") {
    await startOrResumeTest();
    return;
  }

  if (event.target.id === "leavePausedTest") {
    await flushCurrentAttempt();
    state.route = "test-intro";
    render();
    return;
  }

  const answerButton = event.target.closest("[data-test-answer]");
  if (answerButton) {
    if (state.currentAttempt?.status === "paused") return;
    await selectTestAnswer(answerButton.dataset.testAnswer);
    return;
  }

  if (event.target.id === "prevTestQuestion") {
    if (state.currentAttempt?.status === "paused") return;
    await moveTestQuestion(state.testQuestionNumber - 1);
    return;
  }

  if (event.target.id === "nextTestQuestion") {
    if (state.currentAttempt?.status === "paused") return;
    await moveTestQuestion(state.testQuestionNumber + 1);
    return;
  }

  if (event.target.id === "clearTestAnswer") {
    if (state.currentAttempt?.status === "paused") return;
    await clearTestAnswer();
    return;
  }

  if (event.target.id === "markTestReview") {
    if (state.currentAttempt?.status === "paused") return;
    await toggleReview();
    return;
  }

  if (event.target.id === "pauseTestButton") {
    if (Number(state.currentAttempt?.pauseCount || 0) >= 2) {
      state.testMessage = "Pause limit reached. You cannot pause this test again. Continue or submit the test.";
      renderTestTaking();
      return;
    }
    if (window.confirm("Pause this test? Timer will stop and this will use 1 of your 2 pauses.")) {
      await pauseActiveTest("manual");
    }
    return;
  }

  if (event.target.id === "testPaletteOpen") {
    if (state.currentAttempt?.status === "paused") return;
    state.testPaletteOpen = true;
    renderTestTaking();
    return;
  }

  if (event.target.id === "testPaletteClose" || event.target.id === "testPaletteCloseButton") {
    state.testPaletteOpen = false;
    renderTestTaking();
    return;
  }

  const testJumpButton = event.target.closest("[data-test-jump]");
  if (testJumpButton) {
    if (state.currentAttempt?.status === "paused") return;
    state.testPaletteOpen = false;
    await moveTestQuestion(Number(testJumpButton.dataset.testJump));
    return;
  }

  if (event.target.id === "openSubmitSummary") {
    state.route = "test-submit";
    renderSubmitSummary();
    return;
  }

  if (event.target.id === "cancelSubmitTest") {
    state.route = "test-taking";
    renderTestTaking();
    return;
  }

  if (event.target.id === "confirmSubmitTest") {
    await submitAttempt("manual");
    return;
  }

  if (event.target.id === "questionNavOpen") {
    state.questionNavOpen = true;
    renderPaper();
    return;
  }

  if (event.target.id === "questionNavClose" || event.target.id === "questionNavCloseButton") {
    state.questionNavOpen = false;
    renderPaper();
    return;
  }

  const jumpButton = event.target.closest("[data-jump-question]");
  if (jumpButton) {
    const questionNumber = jumpButton.dataset.jumpQuestion;
    state.questionNavOpen = false;
    renderPaper();
    requestAnimationFrame(() => {
      app.querySelector(`#question-${questionNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
    localStorage.setItem("hau_signed_out", "true");
    if (state.firebaseReady && state.firebaseAuth.currentUser) {
      await state.auth.signOut(state.firebaseAuth).catch((error) => {
        console.warn("Firebase sign out failed", error);
      });
    }
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

app.addEventListener("change", (event) => {
  if (event.target.name === "programme") {
    updateAcademicStatusOptions(event.target.value);
  }
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

window.addEventListener("pagehide", rememberActiveTestClose);
window.addEventListener("beforeunload", rememberActiveTestClose);

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

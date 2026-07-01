const FIREBASE_VERSION = "10.12.5";
const FIREBASE_APP_URL =
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`;
const FIREBASE_ANALYTICS_URL =
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-analytics.js`;

const PRODUCTION_HOSTS = new Set([
  "hau-msc-agri-entrance.vercel.app",
  "hau-msc-agri-entrance-amitjangra-s-projects.vercel.app",
  "hau-msc-agri-entrance-git-main-amitjangra-s-projects.vercel.app"
]);

const ALLOWED_EVENTS = new Set([
  "sign_up",
  "login",
  "verification_completed",
  "password_reset_requested",
  "open_paper",
  "search_question",
  "start_test",
  "resume_test",
  "pause_test",
  "submit_test",
  "view_result"
]);

const ALLOWED_PARAMETERS = new Set([
  "app_environment",
  "method",
  "paper_year",
  "paper_set",
  "question_count",
  "search_scope",
  "query_length",
  "result_source",
  "debug_mode"
]);

const appRoot = document.querySelector("#app");
const queuedEvents = [];
const pendingActions = new Map();
const searchTimers = new Map();
const lastSearchValues = new Map();

let analyticsInstance = null;
let logEventFunction = null;
let analyticsStatus = "starting";
let selectedTestPaperId = "";
let evaluationScheduled = false;

function deploymentEnvironment() {
  const host = window.location.hostname.toLowerCase();

  if (host === "localhost" || host === "127.0.0.1") {
    return "local";
  }

  if (PRODUCTION_HOSTS.has(host)) {
    return "production";
  }

  if (host.endsWith(".vercel.app")) {
    return "preview";
  }

  return "production";
}

const APP_ENVIRONMENT = deploymentEnvironment();
const DEBUG_MODE = APP_ENVIRONMENT !== "production";

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function safeText(value, maximumLength = 40) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}

function sanitizeParameters(parameters = {}) {
  const safe = {};

  Object.entries(parameters).forEach(([key, value]) => {
    if (!ALLOWED_PARAMETERS.has(key)) return;
    if (value === undefined || value === null || value === "") return;

    if (typeof value === "string") {
      safe[key] = safeText(value, 80);
      return;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
      return;
    }

    if (typeof value === "boolean") {
      safe[key] = value;
    }
  });

  safe.app_environment = APP_ENVIRONMENT;
  if (DEBUG_MODE) safe.debug_mode = true;

  return safe;
}

function sendEvent(eventName, parameters = {}) {
  if (!ALLOWED_EVENTS.has(eventName)) return;

  const event = {
    name: eventName,
    parameters: sanitizeParameters(parameters)
  };

  if (!analyticsInstance || !logEventFunction) {
    if (queuedEvents.length < 50) queuedEvents.push(event);
    return;
  }

  try {
    logEventFunction(
      analyticsInstance,
      event.name,
      event.parameters
    );
  } catch {
    // Analytics must never interrupt the app.
  }
}

function flushQueuedEvents() {
  if (!analyticsInstance || !logEventFunction) return;

  while (queuedEvents.length) {
    const event = queuedEvents.shift();
    try {
      logEventFunction(
        analyticsInstance,
        event.name,
        event.parameters
      );
    } catch {
      // Ignore analytics-only failures.
    }
  }
}

async function waitForFirebaseApp(getApps, maximumWaitMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maximumWaitMs) {
    const apps = getApps();
    if (apps.length) return apps[0];
    await delay(200);
  }

  return null;
}

async function initializeAnalytics() {
  if (!window.hasFirebaseConfig || !window.firebaseConfig) {
    analyticsStatus = "firebase_config_missing";
    return;
  }

  try {
    const [appModule, analyticsModule] = await Promise.all([
      import(FIREBASE_APP_URL),
      import(FIREBASE_ANALYTICS_URL)
    ]);

    if (!(await analyticsModule.isSupported())) {
      analyticsStatus = "unsupported";
      return;
    }

    const firebaseApp = await waitForFirebaseApp(appModule.getApps);
    if (!firebaseApp) {
      analyticsStatus = "firebase_app_unavailable";
      return;
    }

    analyticsInstance = analyticsModule.getAnalytics(firebaseApp);
    logEventFunction = analyticsModule.logEvent;
    analyticsStatus = "ready";
    flushQueuedEvents();
  } catch {
    analyticsStatus = "unavailable";
  }
}

function armAction(name, value = true, lifetimeMs = 60000) {
  pendingActions.set(name, {
    value,
    expiresAt: Date.now() + lifetimeMs
  });
}

function peekAction(name) {
  const pending = pendingActions.get(name);
  if (!pending) return null;

  if (pending.expiresAt < Date.now()) {
    pendingActions.delete(name);
    return null;
  }

  return pending.value;
}

function takeAction(name) {
  const value = peekAction(name);
  if (value === null) return null;
  pendingActions.delete(name);
  return value;
}

function currentScreen() {
  if (!appRoot) return "unknown";
  if (appRoot.querySelector(".welcome")) return "welcome";
  if (appRoot.querySelector("#loginForm")) return "login";
  if (appRoot.querySelector("#signupForm")) return "signup";
  if (appRoot.querySelector("#markVerified")) return "verify";
  if (appRoot.querySelector("#forgotForm")) return "forgot";
  if (appRoot.querySelector(".result-score")) return "test-result";
  if (appRoot.querySelector("#confirmSubmitTest")) return "test-submit";
  if (appRoot.querySelector(".test-screen")) return "test-taking";
  if (appRoot.querySelector("#startTest, #resumeTest")) return "test-intro";
  if (appRoot.querySelector("#paperSearch")) return "paper";
  if (appRoot.querySelector("#globalSearch")) return "home";
  return "other";
}

function allPapers() {
  return Array.isArray(window.HAU_PAPERS)
    ? window.HAU_PAPERS
    : [];
}

function paperById(paperId) {
  return allPapers().find(
    (paper) => String(paper.id) === String(paperId)
  ) || null;
}

function paperParameters(paperId) {
  const paper = paperById(paperId);
  if (!paper) return {};

  return {
    paper_year: safeInteger(paper.year),
    paper_set: safeText(paper.set, 12),
    question_count: safeInteger(
      paper.questionCount || paper.questions?.length
    )
  };
}

function verificationStatusText() {
  return safeText(
    appRoot?.querySelector("#forgotForm [data-error='form']")?.textContent,
    300
  ).toLowerCase();
}

function evaluateSuccessfulActions() {
  const screen = currentScreen();

  if (screen === "verify" && peekAction("signup")) {
    takeAction("signup");
    sendEvent("sign_up", { method: "email" });
  }

  if (screen === "home" && peekAction("login")) {
    takeAction("login");
    sendEvent("login", { method: "admission_number" });
  }

  if (screen === "verify" && peekAction("login")) {
    takeAction("login");
  }

  if (screen === "login" && peekAction("verification")) {
    takeAction("verification");
    sendEvent("verification_completed", { method: "email_link" });
  }

  if (screen === "paper" && peekAction("open-paper")) {
    const paperId = takeAction("open-paper");
    sendEvent("open_paper", paperParameters(paperId));
  }

  if (screen === "test-taking" && peekAction("test-action")) {
    const action = takeAction("test-action");
    const eventName = action === "resume"
      ? "resume_test"
      : "start_test";

    sendEvent(
      eventName,
      paperParameters(selectedTestPaperId)
    );
  }

  if (screen === "test-result" && peekAction("submit-test")) {
    takeAction("submit-test");
    sendEvent(
      "submit_test",
      paperParameters(selectedTestPaperId)
    );
    sendEvent("view_result", {
      ...paperParameters(selectedTestPaperId),
      result_source: "submission"
    });
  }

  if (screen === "test-result" && peekAction("view-result")) {
    takeAction("view-result");
    sendEvent("view_result", {
      ...paperParameters(selectedTestPaperId),
      result_source: "saved_result"
    });
  }

  if (
    screen === "forgot"
    && peekAction("password-reset")
    && verificationStatusText().includes("reset email has been sent")
  ) {
    takeAction("password-reset");
    sendEvent("password_reset_requested", {
      method: "admission_number"
    });
  }
}

function scheduleEvaluation() {
  if (evaluationScheduled) return;
  evaluationScheduled = true;

  window.requestAnimationFrame(() => {
    evaluationScheduled = false;
    evaluateSuccessfulActions();
  });
}

function scheduleSearchEvent(scope, rawValue) {
  const value = String(rawValue || "").trim();

  const previousTimer = searchTimers.get(scope);
  if (previousTimer) window.clearTimeout(previousTimer);

  if (value.length < 2) return;

  const timer = window.setTimeout(() => {
    if (lastSearchValues.get(scope) === value) return;
    lastSearchValues.set(scope, value);

    sendEvent("search_question", {
      search_scope: scope,
      query_length: value.length
    });
  }, 800);

  searchTimers.set(scope, timer);
}

function eventElement(event) {
  return event.target instanceof Element
    ? event.target
    : null;
}

document.addEventListener("click", (event) => {
  const target = eventElement(event);
  if (!target) return;

  if (target.closest("#createAccountButton")) {
    armAction("signup");
    return;
  }

  if (target.closest("#loginButton")) {
    armAction("login");
    return;
  }

  if (target.closest("#markVerified")) {
    armAction("verification");
    return;
  }

  const paperButton = target.closest("[data-paper]");
  if (paperButton) {
    armAction("open-paper", paperButton.dataset.paper);
    return;
  }

  const testPaperButton = target.closest("[data-test-paper]");
  if (testPaperButton) {
    selectedTestPaperId = String(
      testPaperButton.dataset.testPaper || ""
    );
    return;
  }

  if (target.closest("#startTest")) {
    armAction("test-action", "start");
    return;
  }

  if (target.closest("#resumeTest, #resumePausedTest")) {
    armAction("test-action", "resume");
    return;
  }

  if (target.closest("#pauseTestButton")) {
    window.setTimeout(() => {
      const pausedNotice = [...appRoot.querySelectorAll(".notice")]
        .some((notice) =>
          notice.textContent.toLowerCase().includes("test is paused")
        );

      if (pausedNotice) {
        sendEvent(
          "pause_test",
          paperParameters(selectedTestPaperId)
        );
      }
    }, 0);
    return;
  }

  if (target.closest("#confirmSubmitTest")) {
    armAction("submit-test");
    return;
  }

  if (target.closest("#viewTestResult")) {
    armAction("view-result");
  }
}, true);

document.addEventListener("submit", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLFormElement)) return;

  if (target.id === "loginForm") {
    armAction("login");
  }

  if (target.id === "forgotForm") {
    armAction("password-reset");
  }
}, true);

document.addEventListener("input", (event) => {
  const target = eventElement(event);
  if (!(target instanceof HTMLInputElement)) return;

  if (target.id === "globalSearch") {
    scheduleSearchEvent("all_pyqs", target.value);
  }

  if (target.id === "paperSearch") {
    scheduleSearchEvent("paper", target.value);
  }
}, true);

if (appRoot && typeof MutationObserver === "function") {
  new MutationObserver(scheduleEvaluation).observe(appRoot, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

window.HAU_ANALYTICS_STATUS = Object.freeze({
  get status() {
    return analyticsStatus;
  },
  get environment() {
    return APP_ENVIRONMENT;
  }
});

scheduleEvaluation();
initializeAnalytics();

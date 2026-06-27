const fs = require("fs");
const vm = require("vm");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

async function run() {
  const data = fs.readFileSync("src/data/papers-data.js", "utf8");
  const app = fs.readFileSync("src/app.js", "utf8");
  const appShell = {
    innerHTML: "",
    querySelector: () => null,
    addEventListener: () => {}
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    Date,
    Math,
    JSON,
    Promise,
    assert,
    fetch: async () => ({ json: async () => [] }),
    crypto: { randomUUID: () => "test-uid" },
    localStorage: createStorage(),
    document: {
      querySelector: (selector) => (selector === "#app" ? appShell : null)
    },
    window: {
      firebaseConfig: {},
      hasFirebaseConfig: false,
      addEventListener: () => {},
      confirm: () => true,
      crypto: { randomUUID: () => "test-uid" }
    },
    requestAnimationFrame: (fn) => fn(),
    htmlescape: undefined
  };
  context.window.localStorage = context.localStorage;
  context.globalThis = context;

  const tests = `
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      state.user = { uid: "student-1" };
      state.firebaseReady = false;
      state.papers = window.HAU_PAPERS.slice(0, 1);
      state.selectedTestPaperId = state.papers[0].id;
      state.route = "test-intro";
      await openTestPaper(state.selectedTestPaperId);
      assert(state.route === "test-intro", "opening test should show instructions");
      await startOrResumeTest();
      assert(state.route === "test-taking", "start should open test window");
      assert(state.currentAttempt.status === "active", "attempt should become active");
      selectTestAnswer("A");
      assert(state.currentAttempt.answers["1"] === "A", "answer should be in current attempt immediately");
      let saved = JSON.parse(localStorage.getItem(demoAttemptKey(state.selectedTestPaperId)));
      assert(saved.answers["1"] === "A", "answer should be saved immediately");
      await pauseActiveTest("manual");
      assert(state.route === "test-taking", "pause should stay in test window");
      assert(state.currentAttempt.status === "paused", "pause should set paused status");
      assert(state.currentAttempt.answers["1"] === "A", "pause should keep selected answer");
      assert(app.innerHTML.includes("Resume Test"), "paused screen should show Resume Test");
      assert(app.innerHTML.includes("Quit Test Window"), "paused screen should show Quit Test Window");
      assert(app.innerHTML.includes("Submit Test"), "paused screen should show Submit Test");
      assert(app.innerHTML.includes("disabled"), "paused screen should disable test actions");
      state.route = "test-intro";
      await openTestPaper(state.selectedTestPaperId);
      assert(state.currentAttempt.status === "paused", "reopened attempt should remain paused");
      assert(state.currentAttempt.answers["1"] === "A", "reopened paused attempt should keep answer");
      await startOrResumeTest();
      assert(state.currentAttempt.status === "active", "resume should reactivate attempt");
      assert(state.currentAttempt.answers["1"] === "A", "resume should keep answer");
      state.route = "test-submit";
      renderSubmitSummary();
      await submitAttempt("manual");
      assert(state.route === "test-result", "submit should open result");
      assert(state.currentAttempt.status === "submitted", "submit should lock status");
      assert(state.currentAttempt.locked === true, "submit should lock attempt");
      assert(state.currentAttempt.result.correct + state.currentAttempt.result.incorrect >= 1, "result should count attempted question");
      const delayedWrites = [];
      const remoteStore = new Map();
      state.route = "test-intro";
      state.selectedTestPaperId = state.papers[0].id;
      state.currentAttempt = null;
      state.firebaseReady = true;
      state.firestore = {};
      state.db = {
        doc: (_firestore, collection, id) => ({ collection, id }),
        getDoc: async () => ({ exists: () => false, data: () => null }),
        setDoc: async (ref, data) => {
          const snapshot = JSON.parse(JSON.stringify(data));
          delayedWrites.push(snapshot);
          await new Promise((resolve) => setTimeout(resolve, delayedWrites.length === 1 ? 25 : 0));
          remoteStore.set(ref.id, snapshot);
        }
      };
      await openTestPaper(state.selectedTestPaperId);
      await startOrResumeTest();
      selectTestAnswer("B");
      await flushCurrentAttempt();
      const remoteAttempt = remoteStore.get(testAttemptId(state.selectedTestPaperId));
      assert(remoteAttempt.answers["1"] === "B", "newer answer save must not be overwritten by older start save");
      state.firebaseReady = false;
      localStorage.clear();
      state.currentAttempt = null;
      state.route = "test-intro";
      await openTestPaper(state.selectedTestPaperId);
      await startOrResumeTest();
      selectTestAnswer("C");
      await pauseActiveTest("manual");
      state.route = "test-submit";
      renderSubmitSummary();
      await submitAttempt("manual");
      assert(state.route === "test-result", "paused attempt should still submit to result");
      assert(state.currentAttempt.status === "submitted", "paused submit should submit attempt");
      assert(state.currentAttempt.result.correct + state.currentAttempt.result.incorrect >= 1, "paused submit should include saved answer");
      localStorage.clear();
      state.currentAttempt = null;
      state.route = "test-intro";
      await openTestPaper(state.selectedTestPaperId);
      await startOrResumeTest();
      await pauseActiveTest("manual");
      await startOrResumeTest();
      await pauseActiveTest("manual");
      const countAfterTwoPauses = state.currentAttempt.pauseCount;
      await startOrResumeTest();
      await pauseActiveTest("manual");
      assert(state.currentAttempt.pauseCount === countAfterTwoPauses, "third manual pause should not increase pause count");
      assert(state.currentAttempt.status === "active", "third manual pause should keep test active");
      rememberActiveTestClose();
      const activeBeforeClose = state.currentAttempt;
      state.currentAttempt = activeBeforeClose;
      await reconcileClosedTestPause(activeBeforeClose, state.selectedTestPaperId);
      assert(state.currentAttempt.status === "submitted", "closing after pause limit should auto-submit");
      state.firebaseReady = true;
      state.db = {
        doc: (_firestore, collection, id) => ({ collection, id }),
        getDoc: async () => ({ exists: () => false, data: () => null }),
        setDoc: async () => { throw new Error("simulated write failure"); }
      };
      state.currentAttempt = blankAttempt(state.papers[0]);
      state.route = "test-taking";
      await pauseActiveTest("manual");
      assert(state.currentAttempt.status === "paused", "pause should still update UI state if save fails");
      assert(app.innerHTML.includes("Resume Test"), "failed pause save should still show paused controls");
      state.currentAttempt = blankAttempt(state.papers[0]);
      state.route = "test-submit";
      await submitAttempt("manual");
      assert(state.route === "test-result", "submit should still show result if save fails");
      assert(state.currentAttempt.status === "submitted", "submit should still lock local result if save fails");
      return "ok";
    })()
  `;

  const result = await vm.runInNewContext(`${data}\n${app}\n${tests}`, context, { timeout: 5000 });
  console.log(result);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

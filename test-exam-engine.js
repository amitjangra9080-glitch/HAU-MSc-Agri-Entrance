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
  const firestoreRules = fs.readFileSync("firestore.rules", "utf8");
  assert(
    firestoreRules.includes("resource.data.get('locked', false) != true"),
    "Firestore updates must treat legacy attempts without a locked field as unlocked"
  );
  assert(
    !app.includes('state.testMessage = "Test opened, but saving is having trouble. Please keep the page open."'),
    "test start failures must not create a duplicate save warning"
  );
  const handlers = {};
  const scrollCalls = [];
  const currentPaletteButton = {
    scrollIntoView: (options) => scrollCalls.push(options)
  };
  const testTimerNode = { textContent: "" };
  const testSaveStatusNode = { textContent: "", hidden: true };
  const appShell = {
    innerHTML: "",
    querySelector: (selector) => (selector === ".test-number-grid button.current" ? currentPaletteButton : null),
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    }
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
    handlers,
    scrollCalls,
    fetch: async () => ({ json: async () => [] }),
    crypto: { randomUUID: () => "test-uid" },
    localStorage: createStorage(),
    document: {
      querySelector: (selector) => {
        if (selector === "#app") return appShell;
        if (selector === "#testTimer") return testTimerNode;
        if (selector === "#testSaveStatus") return testSaveStatusNode;
        return null;
      }
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
      assert(state.currentAttempt.locked === false, "new attempts should explicitly persist locked false");
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
      selectTestAnswer("A");
      moveTestQuestion(2);
      selectTestAnswer("B");
      toggleReview();
      moveTestQuestion(3);
      selectTestAnswer("C");
      clearTestAnswer();
      await flushCurrentAttempt();
      await pauseActiveTest("manual");
      await handlers.click({ target: { id: "leavePausedTest", closest: () => null } });
      state.currentAttempt = null;
      await openTestPaper(state.selectedTestPaperId);
      assert(state.currentAttempt.answers["1"] === "A", "reopen after pause should keep q1 answer");
      assert(state.currentAttempt.answers["2"] === "B", "reopen after pause should keep q2 answer");
      assert(!state.currentAttempt.answers["3"], "reopen after pause should keep q3 cleared");
      assert(state.currentAttempt.markedForReview["2"] === true, "reopen after pause should keep review mark");
      assert(state.currentAttempt.currentQuestion === 3, "reopen after pause should keep current question");
      await startOrResumeTest();
      assert(state.testQuestionNumber === 3, "resume should return to last question");
      assert(state.currentAttempt.answers["1"] === "A", "resume should keep q1 answer");
      assert(state.currentAttempt.answers["2"] === "B", "resume should keep q2 answer");
      scrollCalls.length = 0;
      state.testPaletteOpen = false;
      await handlers.click({ target: { id: "testPaletteOpen", closest: () => null } });
      assert(scrollCalls.length === 1, "opening palette should scroll to current question");
      assert(scrollCalls[0].block === "center", "current palette question should be centered");
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
      selectTestAnswer("D");
      await pauseActiveTest("manual");
      assert(state.currentAttempt.status === "paused", "pause should still update UI state if save fails");
      assert(state.currentAttempt.answers["1"] === "D", "pause should keep local answer if save fails");
      assert(app.innerHTML.includes("Resume Test"), "failed pause save should still show paused controls");
      await handlers.click({ target: { id: "leavePausedTest", closest: () => null } });
      assert(state.route === "test-intro", "quit test window should leave immediately even if save fails");
      state.currentAttempt = null;
      await openTestPaper(state.selectedTestPaperId);
      assert(state.currentAttempt.answers["1"] === "D", "reopen should restore local answer if Firestore is stale");
      state.currentAttempt = blankAttempt(state.papers[0]);
      state.route = "test-submit";
      await submitAttempt("manual");
      assert(state.route === "test-result", "submit should still show result if save fails");
      assert(state.currentAttempt.status === "submitted", "submit should still lock local result if save fails");
      await new Promise((resolve) => setTimeout(resolve, 0));

      // A failed remote save must stay queued and succeed after the connection recovers.
      let recoveredSnapshot = null;
      state.db = {
        doc: (_firestore, collection, id) => ({ collection, id }),
        getDoc: async () => ({ exists: () => false, data: () => null }),
        setDoc: async (_ref, data) => { recoveredSnapshot = JSON.parse(JSON.stringify(data)); }
      };
      await persistPendingAttempt();
      assert(recoveredSnapshot?.status === "submitted", "failed submitted result should retry after Firestore recovers");
      assert(pendingAttemptSnapshot === null, "successful retry should clear the pending snapshot");
      assert(state.testSaveMessage === "", "successful retry should clear the save warning");

      // One answer tap must create exactly one remote write.
      let answerWriteCount = 0;
      state.currentAttempt = blankAttempt(state.papers[0]);
      state.route = "test-taking";
      state.db = {
        doc: (_firestore, collection, id) => ({ collection, id }),
        getDoc: async () => ({ exists: () => false, data: () => null }),
        setDoc: async () => { answerWriteCount += 1; }
      };
      selectTestAnswer("A");
      await persistPendingAttempt();
      assert(answerWriteCount === 1, "one answer selection should perform one Firestore write");

      // A transient failure must retain the latest snapshot and allow an explicit retry.
      let transientWriteCount = 0;
      let transientRemoteSnapshot = null;
      state.currentAttempt = blankAttempt(state.papers[0]);
      state.route = "test-taking";
      state.db = {
        doc: (_firestore, collection, id) => ({ collection, id }),
        getDoc: async () => ({ exists: () => false, data: () => null }),
        setDoc: async (_ref, data) => {
          transientWriteCount += 1;
          if (transientWriteCount === 1) throw new Error("temporary outage");
          transientRemoteSnapshot = JSON.parse(JSON.stringify(data));
        }
      };
      selectTestAnswer("B");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(Boolean(pendingAttemptSnapshot), "failed autosave should remain queued");
      assert(state.testSaveMessage.includes("retry automatically"), "failed autosave should expose a visible retry warning");
      renderTestTaking();
      assert(app.innerHTML.includes("retry automatically"), "active test page should render the save warning");
      await persistPendingAttempt();
      assert(transientWriteCount === 2, "queued autosave should retry after a transient failure");
      assert(transientRemoteSnapshot.answers["1"] === "B", "retry should save the latest selected answer");

      // Newer local progress should repair an older Firestore attempt after reopening.
      const remoteOlderAttempt = { ...blankAttempt(state.papers[0]), answers: { 1: "A" }, updatedAtMs: 10 };
      const localNewerAttempt = { ...remoteOlderAttempt, answers: { 1: "D" }, status: "submitted", locked: true, updatedAtMs: 20 };
      writeLocalTestAttempt(localNewerAttempt);
      let repairedRemoteAttempt = null;
      state.db = {
        doc: (_firestore, collection, id) => ({ collection, id }),
        getDoc: async () => ({ exists: () => true, data: () => remoteOlderAttempt }),
        setDoc: async (_ref, data) => { repairedRemoteAttempt = JSON.parse(JSON.stringify(data)); }
      };
      const reopenedAttempt = await loadTestAttempt(state.papers[0].id);
      await persistPendingAttempt();
      assert(reopenedAttempt.status === "submitted", "reopen should prefer newer submitted local progress");
      assert(repairedRemoteAttempt?.answers?.["1"] === "D", "reopen should repair stale Firestore progress from local storage");

      // Paused attempts with no time left must submit instead of regaining full duration.
      state.firebaseReady = false;
      state.currentAttempt = { ...blankAttempt(state.papers[0]), status: "paused", remainingMs: 0, expiresAtMs: null };
      state.route = "test-intro";
      await startOrResumeTest();
      assert(state.currentAttempt.status === "submitted", "zero-time paused attempt should auto-submit");
      assert(state.currentAttempt.submitReason === "timeout", "zero-time paused attempt should submit as timeout");
      assert(state.currentAttempt.remainingMs === 0, "zero-time paused attempt must not regain test time");

      // Slash-separated answer keys must accept either listed option.
      const multiAnswerPaper = {
        id: "multi-answer-paper",
        title: "Multi answer",
        questions: [{ number: 1, question: "Test", options: { A: "A", B: "B", C: "C", D: "D" }, correctOption: "C/D" }]
      };
      const multiAttempt = { ...blankAttempt(multiAnswerPaper), answers: { 1: "C" } };
      assert(calculateResult(multiAttempt, multiAnswerPaper).correct === 1, "C should be accepted for C/D answer key");
      multiAttempt.answers = { 1: "D" };
      assert(calculateResult(multiAttempt, multiAnswerPaper).correct === 1, "D should be accepted for C/D answer key");
      multiAttempt.answers = { 1: "B" };
      assert(calculateResult(multiAttempt, multiAnswerPaper).incorrect === 1, "unlisted option should remain incorrect");

      // Time expiry on the final confirmation screen must auto-submit.
      state.papers = window.HAU_PAPERS.slice(0, 1);
      state.selectedTestPaperId = state.papers[0].id;
      state.currentAttempt = { ...blankAttempt(state.papers[0]), expiresAtMs: Date.now() - 1, remainingMs: 0 };
      state.route = "test-submit";
      renderSubmitSummary();
      assert(app.innerHTML.includes('id="testTimer"'), "submit confirmation should display remaining time");
      await syncTestTimer();
      assert(state.currentAttempt.status === "submitted", "expired attempt on submit confirmation should auto-submit");
      assert(state.currentAttempt.submitReason === "timeout", "confirmation-page expiry should submit as timeout");

      // Invalid close markers must be discarded without breaking attempt recovery.
      state.currentAttempt = blankAttempt(state.papers[0]);
      state.route = "test-taking";
      const corruptMarkerKey = testCloseMarkerKey(state.papers[0].id);
      localStorage.setItem(corruptMarkerKey, "{not-json");
      const recoveredAttempt = await reconcileClosedTestPause(state.currentAttempt, state.papers[0].id);
      assert(recoveredAttempt.status === "active", "corrupt close marker should not destroy the active attempt");
      assert(localStorage.getItem(corruptMarkerKey) === null, "corrupt close marker should be removed");

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

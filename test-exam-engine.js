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
    firestoreRules.includes("validAttemptControlUpdate()"),
    "Firestore updates must reject stale cross-tab status changes"
  );
  assert(
    app.includes("state.db.onSnapshot"),
    "the test attempt must listen for real-time Firestore changes"
  );
  assert(
    app.includes("state.db.runTransaction"),
    "single-session acquisition must use a Firestore transaction"
  );
  assert(
    app.includes("renderTestSessionBlocked"),
    "a second tab or device must render a blocked test screen"
  );
  assert(
    app.includes("Test already active elsewhere"),
    "the blocked screen must clearly explain the active session"
  );
  assert(
    !app.includes("Move Test Here"),
    "the blocked screen must not offer a session takeover action"
  );
  assert(
    firestoreRules.includes("validAttemptSessionUpdate()"),
    "Firestore rules must enforce the active test-session owner"
  );
  assert(
    firestoreRules.includes("validAttemptSessionMigration()"),
    "Firestore rules must migrate existing attempts without breaking the current production client"
  );
  assert(
    app.includes("sessionEnforced: true"),
    "new test sessions must opt into strict single-session enforcement"
  );
  assert(
    app.includes("attemptSnapshotWasSuperseded"),
    "stale writes must be ignored after a newer remote test state is loaded"
  );
  assert(
    firestoreRules.includes("activeSessionHeartbeatAt"),
    "Firestore rules must use a server-timestamp heartbeat for session expiry"
  );
  assert(
    firestoreRules.includes("request.resource.data.get('activeSessionHeartbeatAt', timestamp.value(0)) == request.time"),
    "session heartbeat writes must be validated against server request time"
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
      crypto: { randomUUID: () => "test-uid" },
      sessionStorage: createStorage()
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

      // Pausing, resuming, and submitting in one tab must update every other open tab.
      state.firebaseReady = false;
      state.papers = window.HAU_PAPERS.slice(0, 1);
      state.selectedTestPaperId = state.papers[0].id;
      testClientId = "local-tab";
      const sharedActiveAttempt = {
        ...blankAttempt(state.papers[0]),
        status: "active",
        controlVersion: 0,
        expiresAtMs: Date.now() + 600000,
        remainingMs: 600000,
        updatedAtMs: 100,
        lastWriterClientId: "local-tab"
      };
      state.currentAttempt = sharedActiveAttempt;
      state.route = "test-taking";
      const remotePausedAttempt = {
        ...sharedActiveAttempt,
        status: "paused",
        controlVersion: 1,
        remainingMs: 420000,
        activeStartedAtMs: null,
        expiresAtMs: null,
        updatedAtMs: 200,
        lastWriterClientId: "other-tab"
      };
      assert(applyRemoteTestAttempt(remotePausedAttempt), "newer remote pause should be applied immediately");
      assert(state.currentAttempt.status === "paused", "remote pause should stop the test in this tab");
      assert(state.currentAttempt.remainingMs === 420000, "all tabs should use the same paused time");
      assert(state.route === "test-taking", "remote pause should keep the paused test screen open");
      assert(state.testMessage.includes("paused in another tab"), "remote pause should explain why the timer stopped");

      const staleActiveAttempt = {
        ...sharedActiveAttempt,
        status: "active",
        controlVersion: 0,
        updatedAtMs: 999999,
        lastWriterClientId: "stale-tab"
      };
      assert(!shouldApplyRemoteAttempt(staleActiveAttempt, state.currentAttempt), "older control state must not override a newer pause");
      assert(!applyRemoteTestAttempt(staleActiveAttempt), "stale active tab must not reactivate a paused test");
      assert(state.currentAttempt.status === "paused", "stale active state must leave the shared test paused");

      const remoteResumedAttempt = {
        ...remotePausedAttempt,
        status: "active",
        controlVersion: 2,
        remainingMs: 300000,
        activeStartedAtMs: Date.now(),
        expiresAtMs: Date.now() + 300000,
        updatedAtMs: 300,
        lastWriterClientId: "other-tab"
      };
      assert(applyRemoteTestAttempt(remoteResumedAttempt), "newer remote resume should be applied immediately");
      assert(state.currentAttempt.status === "active", "remote resume should restart the shared test");
      assert(remainingAttemptMs(state.currentAttempt) <= 300000 && remainingAttemptMs(state.currentAttempt) > 295000, "all tabs should use the same resumed expiry time");

      const sharedResult = calculateResult(remoteResumedAttempt, state.papers[0]);
      const remoteSubmittedAttempt = {
        ...remoteResumedAttempt,
        status: "submitted",
        controlVersion: 3,
        locked: true,
        result: sharedResult,
        submittedAtMs: Date.now(),
        updatedAtMs: 400,
        lastWriterClientId: "other-tab"
      };
      assert(applyRemoteTestAttempt(remoteSubmittedAttempt), "newer remote submission should be applied immediately");
      assert(state.currentAttempt.status === "submitted", "submission in one tab should submit every open tab");
      assert(state.route === "test-result", "remote submission should open the final result");

      // A stale in-flight save from the former window may be rejected after another
      // window submits. That expected rejection must not show a false save warning.
      testClientId = "former-window";
      const staleBeforeRemoteSubmit = {
        ...blankAttempt(state.papers[0]),
        status: "active",
        controlVersion: 10,
        activeClientId: "former-window",
        activeSessionExpiresAtMs: Date.now() + TEST_SESSION_LEASE_MS,
        lastWriterClientId: "former-window",
        updatedAtMs: 1000
      };
      const authoritativeRemoteSubmission = {
        ...staleBeforeRemoteSubmit,
        status: "submitted",
        controlVersion: 11,
        locked: true,
        result: calculateResult(staleBeforeRemoteSubmit, state.papers[0]),
        submittedAtMs: Date.now(),
        activeClientId: "submitting-window",
        activeSessionExpiresAtMs: Date.now() + TEST_SESSION_LEASE_MS,
        lastWriterClientId: "submitting-window",
        updatedAtMs: 2000
      };
      state.currentAttempt = staleBeforeRemoteSubmit;
      state.route = "test-taking";
      state.testSaveMessage = "";
      pendingAttemptSnapshot = JSON.parse(JSON.stringify(staleBeforeRemoteSubmit));
      attemptPersistRunning = false;
      attemptPersistRetryCount = 0;
      clearAttemptPersistRetry();
      state.firebaseReady = true;
      state.firestore = {};
      state.db = {
        doc: (_firestore, collection, id) => ({ collection, id }),
        setDoc: async () => {
          applyRemoteTestAttempt(authoritativeRemoteSubmission);
          const error = new Error("Missing or insufficient permissions");
          error.code = "permission-denied";
          throw error;
        }
      };
      await persistPendingAttempt();
      assert(state.currentAttempt.status === "submitted", "newer remote submission must remain authoritative");
      assert(state.route === "test-result", "stale save rejection must keep the shared result visible");
      assert(state.testSaveMessage === "", "stale save rejection after remote submission must not show a save warning");
      assert(pendingAttemptSnapshot === null, "superseded stale save must not be retried");
      state.firebaseReady = false;

      // Only the original test window may control an active attempt.
      state.firebaseReady = false;
      localStorage.clear();
      state.papers = window.HAU_PAPERS.slice(0, 1);
      state.selectedTestPaperId = state.papers[0].id;
      testClientId = "original-window";
      const originalSessionAttempt = {
        ...blankAttempt(state.papers[0]),
        activeClientId: "original-window",
        activeSessionExpiresAtMs: Date.now() + TEST_SESSION_LEASE_MS,
        lastWriterClientId: "original-window",
        updatedAtMs: 1000
      };
      writeLocalTestAttempt(originalSessionAttempt);

      testClientId = "second-window";
      state.currentAttempt = null;
      state.testSessionBlocked = false;
      state.route = "tests";
      await openTestPaper(state.selectedTestPaperId);
      assert(state.route === "test-session-blocked", "a second window must not open the active test");
      assert(state.testSessionBlocked === true, "a second window must be marked as blocked");
      assert(app.innerHTML.includes("Test already active elsewhere"), "blocked screen must identify the active session");
      assert(app.innerHTML.includes('id="checkTestSession"'), "blocked screen must include Check Again");
      assert(app.innerHTML.includes('id="returnFromBlockedTest"'), "blocked screen must include Return to Tests");
      assert(!app.innerHTML.includes("Move Test Here"), "blocked screen must not include takeover controls");
      const answerBeforeBlockedTap = state.currentAttempt.answers["1"] || "";
      selectTestAnswer("D");
      assert((state.currentAttempt.answers["1"] || "") === answerBeforeBlockedTap, "blocked window must not change answers");
      assert(state.route === "test-session-blocked", "blocked answer attempt must remain on blocked screen");

      // Check Again must keep blocking while the original heartbeat lease is fresh.
      await checkTestSessionAvailability();
      assert(state.route === "test-session-blocked", "fresh original session must remain blocked after Check Again");
      assert(state.testMessage.includes("still active"), "Check Again must explain that the original session is still active");

      // Once the original window's lease expires, this window may resume normally.
      const expiredSessionAttempt = {
        ...state.currentAttempt,
        activeSessionExpiresAtMs: Date.now() - 1,
        updatedAtMs: Date.now() + 1
      };
      writeLocalTestAttempt(expiredSessionAttempt);
      await checkTestSessionAvailability();
      assert(state.route === "test-intro", "expired original session must return to the test intro");
      assert(state.testSessionBlocked === false, "expired session must clear the blocked state");
      await startOrResumeTest();
      assert(state.route === "test-taking", "available test must resume in the new window");
      assert(state.currentAttempt.activeClientId === "second-window", "new window must become the session owner after expiry");
      assert(attemptSessionBelongsToCurrentTab(state.currentAttempt), "new session owner must control the attempt");

      // Explicitly quitting a paused test window releases ownership without a takeover button.
      await pauseActiveTest("manual");
      assert(state.currentAttempt.status === "paused", "owner must be able to pause before releasing the window");
      await releaseCurrentTestSession();
      assert(state.currentAttempt.activeClientId === "", "Quit Test Window must release the active client id");
      assert(state.currentAttempt.activeSessionExpiresAtMs === 0, "released test window must clear its lease");
      testClientId = "third-window";
      state.testSessionBlocked = false;
      await startOrResumeTest();
      assert(state.currentAttempt.activeClientId === "third-window", "another window may resume only after explicit release");

      // If a different window becomes owner, the stale original window must lock immediately.
      testClientId = "stale-original";
      const staleOriginalAttempt = {
        ...state.currentAttempt,
        activeClientId: "stale-original",
        activeSessionExpiresAtMs: Date.now() + TEST_SESSION_LEASE_MS,
        lastWriterClientId: "stale-original",
        updatedAtMs: 2000
      };
      state.currentAttempt = staleOriginalAttempt;
      state.testSessionBlocked = false;
      state.route = "test-taking";
      const newOwnerRemoteAttempt = {
        ...staleOriginalAttempt,
        activeClientId: "different-window",
        activeSessionExpiresAtMs: Date.now() + TEST_SESSION_LEASE_MS,
        lastWriterClientId: "different-window",
        updatedAtMs: 3000
      };
      assert(applyRemoteTestAttempt(newOwnerRemoteAttempt), "newer remote ownership must be applied");
      assert(state.route === "test-session-blocked", "stale original window must lock when ownership changes");
      assert(state.testSessionBlocked === true, "stale original window must enter blocked state");

      // Server heartbeat timestamps must define the local lease window.
      const heartbeatNow = Date.now();
      const heartbeatAttempt = normalizeTestAttempt({
        ...newOwnerRemoteAttempt,
        activeSessionExpiresAtMs: 0,
        activeSessionHeartbeatAt: {
          seconds: Math.floor(heartbeatNow / 1000),
          nanoseconds: 0
        }
      });
      assert(
        heartbeatAttempt.activeSessionExpiresAtMs >= heartbeatNow + TEST_SESSION_LEASE_MS - 1000,
        "remote server heartbeat must reconstruct a fresh local lease"
      );

      // Transactional acquisition must not write when another owner has a fresh lease.
      testClientId = "transaction-second-window";
      let transactionWriteCount = 0;
      const transactionRemoteAttempt = {
        ...blankAttempt(state.papers[0]),
        activeClientId: "transaction-owner",
        activeSessionExpiresAtMs: Date.now() + TEST_SESSION_LEASE_MS,
        lastWriterClientId: "transaction-owner",
        updatedAtMs: Date.now()
      };
      state.currentAttempt = transactionRemoteAttempt;
      state.firebaseReady = true;
      state.firestore = {};
      state.db = {
        doc: (_firestore, collection, id) => ({ collection, id }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
        runTransaction: async (_firestore, callback) => callback({
          get: async () => ({ exists: () => true, data: () => transactionRemoteAttempt }),
          set: () => { transactionWriteCount += 1; }
        })
      };
      const blockedTransactionResult = await acquireTestSession(state.papers[0]);
      assert(blockedTransactionResult.blocked === true, "transaction must reject a fresh session owned elsewhere");
      assert(transactionWriteCount === 0, "blocked transaction must not write a takeover");
      state.firebaseReady = false;

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

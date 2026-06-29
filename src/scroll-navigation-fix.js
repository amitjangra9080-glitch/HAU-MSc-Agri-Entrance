(() => {
  "use strict";

  const LIST_ROUTES = new Set(["home", "tests", "subjects"]);
  const TEST_DETAIL_ROUTES = new Set(["test-intro", "test-result", "test-session-blocked"]);
  const DETAIL_FROM_LIST = {
    home: new Set(["paper"]),
    tests: TEST_DETAIL_ROUTES,
    subjects: new Set(["subject"])
  };
  const TEST_LOAD_TIMEOUT_MS = 5000;

  const savedScrollTop = {
    home: 0,
    tests: 0,
    subjects: 0
  };

  let renderedRoute = state.route;
  let scrollOperation = 0;
  let scrollCaptureFrame = 0;
  let ignoreScrollCaptureUntil = 0;
  let testOpenGeneration = 0;
  let testOpenPromise = null;

  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  } catch {
    // Ignore browsers that do not expose scroll restoration controls.
  }

  function scrollingElement() {
    return document.scrollingElement || document.documentElement || document.body;
  }

  function currentScrollTop() {
    const element = scrollingElement();
    const elementTop = Number(element?.scrollTop);
    if (Number.isFinite(elementTop)) return Math.max(0, elementTop);
    return Math.max(0, Number(window.scrollY || window.pageYOffset) || 0);
  }

  function writeScrollTop(top) {
    const safeTop = Math.max(0, Number(top) || 0);
    if (document.documentElement) document.documentElement.scrollTop = safeTop;
    if (document.body) document.body.scrollTop = safeTop;
    const element = scrollingElement();
    if (element) element.scrollTop = safeTop;
    window.scrollTo(0, safeTop);
  }

  function rememberListPosition(route = renderedRoute) {
    if (!LIST_ROUTES.has(route)) return;
    savedScrollTop[route] = currentScrollTop();
  }

  function scheduleScroll(route, top) {
    const operation = ++scrollOperation;
    const safeTop = Math.max(0, Number(top) || 0);
    ignoreScrollCaptureUntil = performance.now() + 500;

    const apply = () => {
      if (operation !== scrollOperation || state.route !== route) return;
      writeScrollTop(safeTop);
    };

    requestAnimationFrame(apply);
    [40, 140, 320].forEach((delay) => window.setTimeout(apply, delay));
  }

  function shouldOpenAtTop(previousRoute, nextRoute) {
    return Boolean(DETAIL_FROM_LIST[previousRoute]?.has(nextRoute));
  }

  const renderBeforeScrollFix = render;
  render = function renderWithStableScroll(...args) {
    const previousRoute = renderedRoute;
    const nextRoute = state.route;

    rememberListPosition(previousRoute);
    const output = renderBeforeScrollFix.apply(this, args);
    renderedRoute = nextRoute;

    if (shouldOpenAtTop(previousRoute, nextRoute)) {
      scheduleScroll(nextRoute, 0);
    } else if (LIST_ROUTES.has(nextRoute)) {
      scheduleScroll(nextRoute, savedScrollTop[nextRoute]);
    }

    return output;
  };

  function normalizeAttempt(attempt) {
    return typeof normalizeTestAttempt === "function"
      ? normalizeTestAttempt(attempt)
      : attempt;
  }

  function localAttemptFor(paperId) {
    if (typeof readLocalTestAttempt !== "function") return null;
    try {
      return normalizeAttempt(readLocalTestAttempt(paperId));
    } catch (error) {
      console.warn("Saved test state could not be read", error);
      return null;
    }
  }

  function renderAttemptRoute(paperId, attempt) {
    const normalized = normalizeAttempt(attempt);

    state.selectedTestPaperId = paperId;
    state.currentAttempt = normalized;
    state.testMessage = "";
    state.testSessionBlocked = false;

    if (normalized && attemptSessionHeldByAnotherTab(normalized)) {
      state.testSessionBlocked = true;
      state.route = "test-session-blocked";
    } else if (normalized?.status === "submitted") {
      state.route = "test-result";
    } else {
      state.testQuestionNumber = normalized?.currentQuestion || 1;
      state.testQuestionStartedAt = Date.now();
      state.route = "test-intro";
    }

    render();
    scheduleScroll(state.route, 0);
  }

  function boundedResult(promise, timeoutMs) {
    let timeoutId = null;

    const settled = Promise.resolve(promise).then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ status: "rejected", error })
    );

    const timeout = new Promise((resolve) => {
      timeoutId = window.setTimeout(
        () => resolve({ status: "timeout" }),
        timeoutMs
      );
    });

    return Promise.race([settled, timeout]).finally(() => {
      if (timeoutId) window.clearTimeout(timeoutId);
    });
  }

  function requestIsCurrent(generation, paperId) {
    return generation === testOpenGeneration
      && state.selectedTestPaperId === paperId
      && TEST_DETAIL_ROUTES.has(state.route);
  }

  function applyClosedWindowMarker(attempt, paperId) {
    const normalized = normalizeAttempt(attempt);
    if (!normalized || normalized.status !== "active") return normalized;
    if (normalized.activeClientId && !attemptSessionBelongsToCurrentTab(normalized)) {
      return normalized;
    }

    const markerKey = testCloseMarkerKey(paperId);
    let marker = null;

    try {
      marker = JSON.parse(localStorage.getItem(markerKey) || "null");
    } catch (error) {
      console.warn("Invalid saved test-close marker was discarded", error);
      localStorage.removeItem(markerKey);
      return normalized;
    }

    if (!marker) return normalized;
    if (marker.clientId && marker.clientId !== currentTestClientId()) return normalized;

    localStorage.removeItem(markerKey);

    const remainingMs = Math.max(
      0,
      Number.isFinite(Number(marker.remainingMs))
        ? Number(marker.remainingMs)
        : remainingAttemptMs(normalized)
    );
    const pauseCount = Number(normalized.pauseCount || 0);

    if (pauseCount >= 2) {
      state.currentAttempt = { ...normalized, remainingMs };
      submitAttempt("pause-limit").catch((error) => {
        console.error("Automatic test submission failed", error);
      });
      state.testMessage = "Pause limit was already used. The test was submitted automatically.";
      return state.currentAttempt;
    }

    const pausedAttempt = normalizeAttempt({
      ...normalized,
      status: "paused",
      controlVersion: nextAttemptControlVersion(normalized),
      remainingMs,
      pauseCount: pauseCount + 1,
      lastPauseAtMs: marker.atMs || Date.now(),
      lastPauseSource: "closed-app",
      activeStartedAtMs: null,
      expiresAtMs: null
    });

    state.currentAttempt = pausedAttempt;
    state.testMessage = `Test paused because the app was closed. Pauses used: ${pausedAttempt.pauseCount}/2.`;
    saveTestAttempt(pausedAttempt).catch((error) => {
      console.error("Could not save the recovered paused test", error);
    });

    return pausedAttempt;
  }

  function cancelPendingTestOpen() {
    if (!testOpenPromise) return;
    testOpenGeneration += 1;
    testOpenPromise = null;
  }

  app.addEventListener(
    "click",
    (event) => {
      const routeButton = event.target.closest?.("[data-route]");
      if (routeButton && testOpenPromise) {
        cancelPendingTestOpen();
      }
    },
    true
  );

  openTestPaper = function openTestPaperWithoutBlocking(paperId) {
    if (testOpenPromise) return testOpenPromise;

    const selectedPaperId = String(paperId || "");
    const generation = ++testOpenGeneration;

    stopTestAttemptListener();
    stopTestSessionHeartbeat();

    const localAttempt = localAttemptFor(selectedPaperId);
    renderAttemptRoute(selectedPaperId, localAttempt);

    const operation = (async () => {
      const loaded = await boundedResult(loadTestAttempt(selectedPaperId), TEST_LOAD_TIMEOUT_MS);

      if (!requestIsCurrent(generation, selectedPaperId)) return;

      let attempt = localAttempt;

      if (loaded.status === "fulfilled") {
        attempt = normalizeAttempt(loaded.value);
      } else if (loaded.status === "rejected") {
        console.error("Could not load the latest test state", loaded.error);
      } else {
        console.warn("Latest test-state check timed out; continuing with the saved device state.");
      }

      if (!requestIsCurrent(generation, selectedPaperId)) return;

      if (attempt && attemptSessionHeldByAnotherTab(attempt)) {
        state.currentAttempt = attempt;
        state.testSessionBlocked = true;
        state.route = "test-session-blocked";
        startTestAttemptListener(selectedPaperId);
        render();
        scheduleScroll(state.route, 0);
        return;
      }

      attempt = applyClosedWindowMarker(attempt, selectedPaperId);

      if (!requestIsCurrent(generation, selectedPaperId)) return;

      state.currentAttempt = normalizeAttempt(attempt);
      startTestAttemptListener(selectedPaperId);

      if (state.currentAttempt?.status === "submitted") {
        state.route = "test-result";
      } else {
        state.testQuestionNumber = state.currentAttempt?.currentQuestion || 1;
        state.testQuestionStartedAt = Date.now();
        state.route = "test-intro";
      }

      render();
      scheduleScroll(state.route, 0);
    })();

    testOpenPromise = operation.finally(() => {
      if (generation === testOpenGeneration) {
        testOpenPromise = null;
      }
    });

    return testOpenPromise;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!LIST_ROUTES.has(state.route) || scrollCaptureFrame) return;
      if (performance.now() < ignoreScrollCaptureUntil) return;

      scrollCaptureFrame = requestAnimationFrame(() => {
        scrollCaptureFrame = 0;
        if (LIST_ROUTES.has(state.route) && performance.now() >= ignoreScrollCaptureUntil) {
          savedScrollTop[state.route] = currentScrollTop();
        }
      });
    },
    { passive: true }
  );

  window.addEventListener("pagehide", () => rememberListPosition(state.route));
})();

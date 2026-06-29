(() => {
  "use strict";

  const LIST_ROUTES = new Set(["home", "tests", "subjects"]);
  const DETAIL_FROM_LIST = {
    home: new Set(["paper"]),
    tests: new Set(["test-intro", "test-result", "test-session-blocked"]),
    subjects: new Set(["subject"])
  };
  const TEST_DETAIL_ROUTES = new Set(["test-intro", "test-result", "test-session-blocked"]);

  const savedScrollTop = {
    home: 0,
    tests: 0,
    subjects: 0
  };

  let renderedRoute = state.route;
  let scrollToken = 0;
  let scrollCaptureFrame = 0;
  let ignoreScrollCaptureUntil = 0;
  let testTopLockUntil = 0;
  let testOpenPromise = null;

  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  } catch {
    // Older browsers may not expose scrollRestoration.
  }

  function scrollingElement() {
    return document.scrollingElement || document.documentElement || document.body;
  }

  function currentScrollTop() {
    const element = scrollingElement();
    const value = Number(element?.scrollTop);
    if (Number.isFinite(value)) return Math.max(0, value);
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

  function releaseAnchorLock() {
    document.documentElement.style.removeProperty("overflow-anchor");
    document.body?.style.removeProperty("overflow-anchor");
  }

  function settleScroll(route, top, durationMs = 520) {
    const token = ++scrollToken;
    const safeTop = Math.max(0, Number(top) || 0);
    const startedAt = performance.now();
    ignoreScrollCaptureUntil = startedAt + durationMs + 100;

    document.documentElement.style.setProperty("overflow-anchor", "none");
    document.body?.style.setProperty("overflow-anchor", "none");

    const apply = () => {
      if (token !== scrollToken || state.route !== route) {
        releaseAnchorLock();
        return;
      }

      if (safeTop === 0) {
        app.querySelector(".screen")?.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
      }
      writeScrollTop(safeTop);

      if (performance.now() - startedAt < durationMs) {
        requestAnimationFrame(apply);
      } else {
        writeScrollTop(safeTop);
        releaseAnchorLock();
      }
    };

    requestAnimationFrame(apply);
  }

  function shouldOpenAtTop(previousRoute, nextRoute) {
    return Boolean(DETAIL_FROM_LIST[previousRoute]?.has(nextRoute));
  }

  function lockTestDetailAtTop(durationMs = 2200) {
    testTopLockUntil = Math.max(testTopLockUntil, performance.now() + durationMs);
    if (TEST_DETAIL_ROUTES.has(state.route)) {
      settleScroll(state.route, 0, Math.min(durationMs, 700));
    }
  }

  function applyOpeningState() {
    const screen = app.querySelector(".screen");
    if (screen) screen.setAttribute("aria-busy", "true");

    const primaryAction = app.querySelector("#startTest, #resumeTest, #viewTestResult");
    if (primaryAction) {
      primaryAction.disabled = true;
      primaryAction.textContent = "Checking test...";
    }

    app.querySelectorAll(".topbar [data-route], .bottom-nav [data-route], [data-route='tests']")
      .forEach((button) => {
        button.disabled = true;
      });
  }

  const renderBeforeScrollFix = render;
  render = function renderWithStableScroll(...args) {
    const previousRoute = renderedRoute;
    const nextRoute = state.route;

    rememberListPosition(previousRoute);
    const output = renderBeforeScrollFix.apply(this, args);
    renderedRoute = nextRoute;

    const testTopLocked = TEST_DETAIL_ROUTES.has(nextRoute) && performance.now() < testTopLockUntil;

    if (shouldOpenAtTop(previousRoute, nextRoute) || testTopLocked) {
      settleScroll(nextRoute, 0, testTopLocked ? 700 : 520);
    } else if (LIST_ROUTES.has(nextRoute)) {
      settleScroll(nextRoute, savedScrollTop[nextRoute], 360);
    }

    if (testOpenPromise && TEST_DETAIL_ROUTES.has(nextRoute)) {
      requestAnimationFrame(applyOpeningState);
    }

    return output;
  };

  const originalOpenTestPaper = typeof openTestPaper === "function" ? openTestPaper : null;

  if (originalOpenTestPaper) {
    openTestPaper = function openTestPaperSingleFlight(paperId) {
      if (testOpenPromise) return testOpenPromise;

      const selectedPaperId = String(paperId || "");
      lockTestDetailAtTop(2600);

      testOpenPromise = (async () => {
        try {
          // Render immediately from the latest device copy so the first tap responds
          // without waiting for a cold Firestore read. Controls stay disabled until
          // the authoritative cloud check finishes.
          const localAttempt = typeof readLocalTestAttempt === "function"
            ? normalizeTestAttempt(readLocalTestAttempt(selectedPaperId))
            : null;

          state.selectedTestPaperId = selectedPaperId;
          state.testMessage = "";
          state.testSessionBlocked = false;
          state.currentAttempt = localAttempt;

          if (localAttempt && attemptSessionHeldByAnotherTab(localAttempt)) {
            state.testSessionBlocked = true;
            state.route = "test-session-blocked";
          } else if (localAttempt?.status === "submitted") {
            state.route = "test-result";
          } else {
            state.testQuestionNumber = localAttempt?.currentQuestion || 1;
            state.testQuestionStartedAt = Date.now();
            state.route = "test-intro";
          }

          render();
          applyOpeningState();
          lockTestDetailAtTop(2600);

          await originalOpenTestPaper(selectedPaperId);
          lockTestDetailAtTop(900);
        } catch (error) {
          console.error("Could not open test", error);
          state.route = "tests";
          render();
        }
      })().finally(() => {
        testOpenPromise = null;
        if (TEST_DETAIL_ROUTES.has(state.route)) {
          lockTestDetailAtTop(700);
        }
      });

      return testOpenPromise;
    };
  }

  // A cloud snapshot can rerender the same Test Instructions route after the
  // first top reset. Keep the page pinned to top only during the short opening window.
  if (typeof MutationObserver === "function") {
    new MutationObserver(() => {
      if (TEST_DETAIL_ROUTES.has(state.route) && performance.now() < testTopLockUntil) {
        settleScroll(state.route, 0, 420);
        if (testOpenPromise) requestAnimationFrame(applyOpeningState);
      }
    }).observe(app, { childList: true });
  }

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

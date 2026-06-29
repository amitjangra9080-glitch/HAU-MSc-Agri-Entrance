(() => {
  "use strict";

  const LIST_ROUTES = new Set(["home", "tests", "subjects"]);
  const DETAIL_FROM_LIST = {
    home: new Set(["paper"]),
    tests: new Set(["test-intro", "test-result", "test-session-blocked"]),
    subjects: new Set(["subject"])
  };

  const savedScrollTop = {
    home: 0,
    tests: 0,
    subjects: 0
  };

  let renderedRoute = state.route;
  let pendingFrame = 0;
  let pendingTimers = [];
  let scrollCaptureFrame = 0;

  function currentScrollTop() {
    return Math.max(
      0,
      Number(window.pageYOffset) || 0,
      Number(document.documentElement?.scrollTop) || 0,
      Number(document.body?.scrollTop) || 0
    );
  }

  function rememberListPosition(route = renderedRoute) {
    if (!LIST_ROUTES.has(route)) return;
    savedScrollTop[route] = currentScrollTop();
  }

  function cancelPendingScroll() {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
    pendingTimers.forEach((timer) => clearTimeout(timer));
    pendingTimers = [];
  }

  function setScrollTop(top) {
    const safeTop = Math.max(0, Number(top) || 0);
    window.scrollTo({ top: safeTop, left: 0, behavior: "auto" });
    const scrollingElement = document.scrollingElement;
    if (scrollingElement) scrollingElement.scrollTop = safeTop;
  }

  function scheduleScroll(route, top) {
    cancelPendingScroll();

    const apply = () => {
      if (state.route !== route) return;
      setScrollTop(top);
    };

    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      apply();
    });

    [0, 60, 180, 360].forEach((delay) => {
      pendingTimers.push(window.setTimeout(apply, delay));
    });
  }

  function shouldOpenAtTop(previousRoute, nextRoute) {
    return Boolean(DETAIL_FROM_LIST[previousRoute]?.has(nextRoute));
  }

  const renderBeforeScrollFix = render;
  render = function renderWithScrollNavigation(...args) {
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

  window.addEventListener(
    "scroll",
    () => {
      if (!LIST_ROUTES.has(state.route) || scrollCaptureFrame) return;
      scrollCaptureFrame = requestAnimationFrame(() => {
        scrollCaptureFrame = 0;
        if (LIST_ROUTES.has(state.route)) {
          savedScrollTop[state.route] = currentScrollTop();
        }
      });
    },
    { passive: true }
  );

  window.addEventListener("pagehide", () => rememberListPosition(state.route));
})();

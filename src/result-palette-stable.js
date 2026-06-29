(() => {
  const IDS = Object.freeze({
    open: "stableResultPaletteOpen",
    close: "stableResultPaletteClose",
    closeButton: "stableResultPaletteCloseButton"
  });
  const JUMP_ATTRIBUTE = "data-stable-result-jump";
  let isolatedScreen = null;

  function resultScreen() {
    return app.querySelector(".result-screen");
  }

  function isolateResultPaletteControls() {
    const screen = resultScreen();
    if (!screen) {
      isolatedScreen = null;
      document.documentElement.classList.remove("question-palette-open");
      return;
    }
    if (screen === isolatedScreen && screen.dataset.stableResultPalette === "true") return;

    const openButton = screen.querySelector("#resultPaletteOpen, #stableResultPaletteOpen");
    const closeBackdrop = screen.querySelector("#resultPaletteClose, #stableResultPaletteClose");
    const closeButton = screen.querySelector("#resultPaletteCloseButton, #stableResultPaletteCloseButton");

    if (openButton) openButton.id = IDS.open;
    if (closeBackdrop) closeBackdrop.id = IDS.close;
    if (closeButton) closeButton.id = IDS.closeButton;

    screen.querySelectorAll(".result-number-grid [data-result-jump], .result-number-grid [data-stable-result-jump]").forEach((button) => {
      const number = button.getAttribute(JUMP_ATTRIBUTE) || button.dataset.resultJump;
      if (number) button.setAttribute(JUMP_ATTRIBUTE, number);
      button.removeAttribute("data-result-jump");
    });

    screen.dataset.stableResultPalette = "true";
    isolatedScreen = screen;
  }

  function currentVisibleQuestionNumber() {
    const screen = resultScreen();
    if (!screen) return 1;

    const appRect = app.getBoundingClientRect();
    const x = Math.max(16, Math.min(window.innerWidth - 16, appRect.left + (appRect.width / 2)));
    const anchorPoints = [92, 124, 164, 210].filter((y) => y < window.innerHeight);

    for (const y of anchorPoints) {
      const card = document.elementFromPoint(x, y)?.closest?.(".result-question-card[data-result-question]");
      const number = Number(card?.dataset.resultQuestion);
      if (number) return number;
    }

    const cards = screen.querySelectorAll(".result-question-card[data-result-question]");
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > 70 && rect.top < window.innerHeight) {
        return Number(card.dataset.resultQuestion) || 1;
      }
    }

    return 1;
  }

  function markCurrentQuestion(questionNumber) {
    resultScreen()?.querySelectorAll(`.result-number-grid [${JUMP_ATTRIBUTE}]`).forEach((button) => {
      button.classList.toggle(
        "current",
        Number(button.getAttribute(JUMP_ATTRIBUTE)) === Number(questionNumber)
      );
    });
  }

  function centerCurrentQuestion() {
    requestAnimationFrame(() => {
      const grid = resultScreen()?.querySelector(".result-number-grid");
      const current = grid?.querySelector("button.current");
      if (!grid || !current) return;
      const targetTop = current.offsetTop - (grid.clientHeight / 2) + (current.offsetHeight / 2);
      grid.scrollTop = Math.max(0, targetTop);
    });
  }

  function setPaletteOpen(isOpen) {
    const layer = resultScreen()?.querySelector(".result-palette-layer");
    if (!layer) return;
    layer.classList.toggle("open", isOpen);
    layer.setAttribute("aria-hidden", isOpen ? "false" : "true");
    document.documentElement.classList.toggle("question-palette-open", isOpen);
    if (isOpen) centerCurrentQuestion();
  }

  function jumpToQuestion(questionNumber) {
    const target = resultScreen()?.querySelector(`#result-question-${questionNumber}`);
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }

  app.addEventListener("click", (event) => {
    const screen = resultScreen();
    if (!screen || !screen.contains(event.target)) return;

    const openButton = event.target.closest?.(`#${IDS.open}`);
    const closeButton = event.target.closest?.(`#${IDS.close}, #${IDS.closeButton}`);
    const jumpButton = event.target.closest?.(`[${JUMP_ATTRIBUTE}]`);
    if (!openButton && !closeButton && !jumpButton) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (openButton) {
      const questionNumber = currentVisibleQuestionNumber();
      markCurrentQuestion(questionNumber);
      setPaletteOpen(true);
      return;
    }

    if (closeButton) {
      setPaletteOpen(false);
      return;
    }

    const questionNumber = Number(jumpButton.getAttribute(JUMP_ATTRIBUTE));
    if (!questionNumber) return;
    markCurrentQuestion(questionNumber);
    setPaletteOpen(false);
    jumpToQuestion(questionNumber);
  }, true);

  const screenObserver = new MutationObserver(() => {
    isolateResultPaletteControls();
  });
  screenObserver.observe(app, { childList: true });

  isolateResultPaletteControls();

  window.HAU_STABLE_RESULT_PALETTE = Object.freeze({
    isolateResultPaletteControls,
    currentVisibleQuestionNumber
  });
})();

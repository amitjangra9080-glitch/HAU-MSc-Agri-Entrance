(() => {
  function isResultScreenActive() {
    return typeof state !== "undefined"
      && state.route === "test-result"
      && Boolean(document.querySelector(".result-screen"));
  }

  function visibleResultQuestionNumber() {
    const cards = [...document.querySelectorAll(".result-question-card[data-result-question]")];
    if (!cards.length) return 1;

    const anchor = Math.min(140, Math.max(84, window.innerHeight * 0.16));
    let closestNumber = Number(cards[0].dataset.resultQuestion) || 1;
    let closestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const isVisible = rect.bottom > 0 && rect.top < window.innerHeight;
      const crossesAnchor = rect.top <= anchor && rect.bottom >= anchor;
      const distance = crossesAnchor
        ? 0
        : Math.min(Math.abs(rect.top - anchor), Math.abs(rect.bottom - anchor))
          + (isVisible ? 0 : window.innerHeight);
      const number = Number(card.dataset.resultQuestion);

      if (number && distance < closestDistance) {
        closestDistance = distance;
        closestNumber = number;
      }
    });

    return closestNumber;
  }

  function markCurrentQuestion(questionNumber) {
    document.querySelectorAll(".result-number-grid [data-result-jump]").forEach((button) => {
      button.classList.toggle(
        "current",
        Number(button.dataset.resultJump) === Number(questionNumber)
      );
    });
  }

  function centerCurrentQuestion() {
    const center = () => {
      const grid = document.querySelector(".result-number-grid");
      const current = grid?.querySelector("button.current");
      if (!grid || !current) return;

      const targetTop = current.offsetTop - (grid.clientHeight / 2) + (current.offsetHeight / 2);
      if (typeof grid.scrollTo === "function") {
        grid.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
      } else {
        grid.scrollTop = Math.max(0, targetTop);
      }
    };

    requestAnimationFrame(center);
    window.setTimeout(center, 80);
    window.setTimeout(center, 220);
  }

  function setPaletteOpen(isOpen) {
    const layer = document.querySelector(".result-palette-layer");
    if (!layer) return false;

    layer.classList.toggle("open", isOpen);
    layer.setAttribute("aria-hidden", isOpen ? "false" : "true");
    document.documentElement.classList.toggle("question-palette-open", isOpen);

    if (isOpen) centerCurrentQuestion();
    return true;
  }

  function consumeEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  document.addEventListener("click", (event) => {
    if (!isResultScreenActive()) return;

    const openButton = event.target.closest?.("#resultPaletteOpen");
    const closeButton = event.target.closest?.("#resultPaletteClose, #resultPaletteCloseButton");
    const jumpButton = event.target.closest?.("[data-result-jump]");

    if (!openButton && !closeButton && !jumpButton) return;

    consumeEvent(event);

    if (openButton) {
      const questionNumber = visibleResultQuestionNumber();
      markCurrentQuestion(questionNumber);
      setPaletteOpen(true);
      return;
    }

    if (closeButton) {
      setPaletteOpen(false);
      return;
    }

    const questionNumber = Number(jumpButton.dataset.resultJump);
    if (!questionNumber) return;

    markCurrentQuestion(questionNumber);
    setPaletteOpen(false);

    requestAnimationFrame(() => {
      document.querySelector(`#result-question-${questionNumber}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }, true);
})();

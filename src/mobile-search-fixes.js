(() => {
  const SEARCH_INPUT_IDS = new Set(["globalSearch", "paperSearch"]);

  function findDirectResultsContainer(screen) {
    if (!screen) return null;
    return (
      Array.from(screen.children).find(
        (child) =>
          child.classList?.contains("paper-list") ||
          child.classList?.contains("question-list")
      ) || null
    );
  }

  function updateClearButton(input) {
    const clearButton = input.closest(".search")?.querySelector(".search-clear");
    if (!clearButton) return;
    clearButton.hidden = input.value.length === 0;
  }

  function enhanceSearchControls(root = document) {
    root.querySelectorAll?.(".search input").forEach((input) => {
      if (!SEARCH_INPUT_IDS.has(input.id)) return;

      const search = input.closest(".search");
      if (!search || search.querySelector(".search-clear")) {
        updateClearButton(input);
        return;
      }

      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "search-clear";
      clearButton.setAttribute("aria-label", "Clear search");
      clearButton.hidden = input.value.length === 0;

      clearButton.addEventListener("pointerdown", (event) => {
        // Keep the search input focused so the mobile keyboard does not blink.
        event.preventDefault();
      });

      clearButton.addEventListener("click", () => {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus({ preventScroll: true });
      });

      search.appendChild(clearButton);
    });
  }

  function updateHomeSearch(input) {
    state.globalSearch = input.value;
    updateClearButton(input);

    const query = state.globalSearch.trim().toLowerCase();
    const screen = input.closest(".screen");
    const container = findDirectResultsContainer(screen);
    if (!container) return;

    if (query) {
      const results = allQuestions().filter((question) =>
        questionText(question).toLowerCase().includes(query)
      );
      container.className = "question-list";
      container.innerHTML =
        results.slice(0, 80).map(renderQuestionCard).join("") ||
        '<div class="empty">No matches found.</div>';
      return;
    }

    container.className = "paper-list";
    container.innerHTML = state.papers.map(renderPaperCard).join("");
  }

  function updatePaperSearch(input) {
    state.paperSearch = input.value;
    updateClearButton(input);

    const query = state.paperSearch.trim().toLowerCase();
    const paper = selectedPaper();
    const questions = query
      ? paper.questions.filter((question) => questionMatchesSearch(question, query))
      : paper.questions;
    const screen = input.closest(".screen");
    const container = findDirectResultsContainer(screen);
    if (!container) return;

    container.className = "question-list";
    container.innerHTML =
      questions
        .map((question) =>
          renderQuestionCard({
            ...question,
            paperTitle: paper.title,
            year: paper.year,
            set: paper.set
          })
        )
        .join("") ||
      '<div class="empty">No matches found.</div>';
  }

  function setSearchKeyboardState(isOpen) {
    document.documentElement.classList.toggle("search-keyboard-open", isOpen);
  }

  app.addEventListener(
    "input",
    (event) => {
      if (!SEARCH_INPUT_IDS.has(event.target.id)) return;

      // Prevent the original handler from rebuilding the entire screen.
      // Keeping the existing input node mounted prevents mobile keyboard blinking.
      event.stopImmediatePropagation();

      if (event.target.id === "globalSearch") {
        updateHomeSearch(event.target);
      } else {
        updatePaperSearch(event.target);
      }
    },
    true
  );

  document.addEventListener(
    "focusin",
    (event) => {
      if (SEARCH_INPUT_IDS.has(event.target.id)) {
        setSearchKeyboardState(true);
      }
    },
    true
  );

  document.addEventListener(
    "focusout",
    () => {
      window.setTimeout(() => {
        setSearchKeyboardState(SEARCH_INPUT_IDS.has(document.activeElement?.id));
      }, 80);
    },
    true
  );

  window.visualViewport?.addEventListener("resize", () => {
    setSearchKeyboardState(SEARCH_INPUT_IDS.has(document.activeElement?.id));
  });

  const observer = new MutationObserver(() => enhanceSearchControls(app));
  observer.observe(app, { childList: true, subtree: true });
  enhanceSearchControls(app);
})();

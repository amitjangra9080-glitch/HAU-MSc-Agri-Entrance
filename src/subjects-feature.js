(() => {
  const subjectNames = Array.isArray(window.HAU_SUBJECTS) ? window.HAU_SUBJECTS : [];
  const subjectMap = window.HAU_SUBJECT_BY_QUESTION || {};

  function applyCanonicalSubjects() {
    const papers = Array.isArray(state?.papers) && state.papers.length
      ? state.papers
      : (Array.isArray(window.HAU_PAPERS) ? window.HAU_PAPERS : []);

    papers.forEach((paper) => {
      const paperSubjects = subjectMap[paper.id] || {};
      paper.questions.forEach((question) => {
        const canonicalSubject = paperSubjects[String(question.number)];
        if (canonicalSubject) question.subject = canonicalSubject;
      });
    });
  }

  function questionsForSubject(subject) {
    applyCanonicalSubjects();
    return allQuestions().filter((question) => question.subject === subject);
  }

  function renderSubjects() {
    applyCanonicalSubjects();
    app.innerHTML = `
      <section class="screen">
        <div class="topbar">
          <div class="top-title">
            <h1>Subjects</h1>
            <p>Browse all PYQs subject-wise</p>
          </div>
        </div>
        <div class="paper-list subject-list">
          ${subjectNames.map((subject) => {
            const count = questionsForSubject(subject).length;
            return `
              <button class="paper-card subject-card" type="button" data-subject="${htmlescape(subject)}">
                <h2>${htmlescape(subject)}</h2>
                <p>${count} questions</p>
              </button>
            `;
          }).join("")}
        </div>
        ${bottomNav("subjects")}
      </section>
    `;
  }

  function renderSubjectQuestions() {
    const selectedSubject = subjectNames.includes(state.selectedSubject)
      ? state.selectedSubject
      : subjectNames[0];
    const questions = questionsForSubject(selectedSubject);

    app.innerHTML = `
      <section class="screen subject-question-screen">
        ${topbar(selectedSubject, `${questions.length} questions`, "subjects")}
        <div class="question-list">
          ${questions.map((question) => renderQuestionCard({
            ...question,
            paperTitle: String(question.year),
            year: question.year,
            set: question.set
          })).join("") || `<div class="empty">No questions found.</div>`}
        </div>
        ${bottomNav("subjects")}
      </section>
    `;
  }

  icons.subjects = `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m3 12 9 5 9-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m3 16 9 5 9-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  bottomNav = function bottomNavWithSubjects(activeRoute) {
    return `
      <nav class="bottom-nav" aria-label="Main navigation">
        <button class="nav-item ${activeRoute === "home" ? "active" : ""}" type="button" data-route="home" aria-label="Home">
          <span class="nav-icon">${icons.home}</span>
          <span>Home</span>
        </button>
        <button class="nav-item ${activeRoute === "tests" ? "active" : ""}" type="button" data-route="tests" aria-label="Tests">
          <span class="nav-icon">${icons.test}</span>
          <span>Tests</span>
        </button>
        <button class="nav-item ${activeRoute === "subjects" ? "active" : ""}" type="button" data-route="subjects" aria-label="Subjects">
          <span class="nav-icon">${icons.subjects}</span>
          <span>Subjects</span>
        </button>
        <button class="nav-item ${activeRoute === "profile" ? "active" : ""}" type="button" data-route="profile" aria-label="Profile">
          <span class="nav-icon">${icons.user}</span>
          <span>Profile</span>
        </button>
      </nav>
    `;
  };

  const renderExistingRoute = render;
  render = function renderWithSubjects() {
    applyCanonicalSubjects();
    if (state.route === "subjects") {
      renderSubjects();
      return;
    }
    if (state.route === "subject") {
      renderSubjectQuestions();
      return;
    }
    renderExistingRoute();
  };

  app.addEventListener("click", (event) => {
    const subjectButton = event.target.closest("[data-subject]");
    if (!subjectButton) return;

    state.selectedSubject = subjectButton.dataset.subject;
    state.route = "subject";
    render();
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
  });

  let pendingPaperQuestion = 1;

  function visibleQuestionNumber(selector) {
    const cards = [...app.querySelectorAll(selector)];
    if (!cards.length) return 1;

    const anchor = Math.min(140, Math.max(84, window.innerHeight * 0.16));
    let closestNumber = 1;
    let closestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const isVisible = rect.bottom > 0 && rect.top < window.innerHeight;
      const crossesAnchor = rect.top <= anchor && rect.bottom >= anchor;
      const distance = crossesAnchor
        ? 0
        : Math.min(Math.abs(rect.top - anchor), Math.abs(rect.bottom - anchor))
          + (isVisible ? 0 : window.innerHeight);
      const number = Number(card.dataset.resultQuestion || card.id.match(/^question-(\d+)$/)?.[1]);

      if (number && distance < closestDistance) {
        closestDistance = distance;
        closestNumber = number;
      }
    });

    return closestNumber;
  }

  function markPaletteQuestion(buttonSelector, datasetKey, questionNumber) {
    app.querySelectorAll(buttonSelector).forEach((button) => {
      button.classList.toggle(
        "current",
        Number(button.dataset[datasetKey]) === Number(questionNumber)
      );
    });
  }

  function centerPaletteQuestion(gridSelector) {
    const center = () => {
      const grid = app.querySelector(gridSelector);
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
    window.setTimeout(center, 90);
    window.setTimeout(center, 240);
  }

  function syncPaletteLayerState() {
    document.documentElement.classList.toggle(
      "question-palette-open",
      Boolean(app.querySelector(".question-nav-layer.open"))
    );
  }

  function openResultPalette() {
    const layer = app.querySelector(".result-palette-layer");
    if (!layer) return;

    const questionNumber = visibleQuestionNumber(".result-question-card[data-result-question]");
    markPaletteQuestion(".result-number-grid [data-result-jump]", "resultJump", questionNumber);
    layer.classList.add("open");
    layer.setAttribute("aria-hidden", "false");
    syncPaletteLayerState();
    centerPaletteQuestion(".result-number-grid");
  }

  function closeResultPalette() {
    const layer = app.querySelector(".result-palette-layer");
    if (!layer) return;
    layer.classList.remove("open");
    layer.setAttribute("aria-hidden", "true");
    syncPaletteLayerState();
  }

  app.addEventListener("click", (event) => {
    if (event.target.closest?.("#questionNavOpen")) {
      pendingPaperQuestion = visibleQuestionNumber('article.question-card[id^="question-"]');
      return;
    }

    if (event.target.closest?.("#resultPaletteOpen")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openResultPalette();
      return;
    }

    if (event.target.closest?.("#resultPaletteClose, #resultPaletteCloseButton")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeResultPalette();
      return;
    }

    const resultJumpButton = event.target.closest?.("[data-result-jump]");
    if (!resultJumpButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const questionNumber = Number(resultJumpButton.dataset.resultJump);
    markPaletteQuestion(".result-number-grid [data-result-jump]", "resultJump", questionNumber);
    closeResultPalette();
    requestAnimationFrame(() => {
      document.querySelector(`#result-question-${questionNumber}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }, true);

  app.addEventListener("click", (event) => {
    if (event.target.closest?.("#questionNavOpen")) {
      window.setTimeout(() => {
        markPaletteQuestion(
          ".question-number-grid [data-jump-question]",
          "jumpQuestion",
          pendingPaperQuestion
        );
        syncPaletteLayerState();
        centerPaletteQuestion(".question-number-grid");
      }, 0);
      return;
    }

    if (event.target.closest?.("#testPaletteOpen")) {
      window.setTimeout(() => {
        markPaletteQuestion(
          ".test-number-grid [data-test-jump]",
          "testJump",
          state.testQuestionNumber
        );
        syncPaletteLayerState();
        centerPaletteQuestion(".test-number-grid");
      }, 0);
      return;
    }

    if (event.target.closest?.(
      "#questionNavClose, #questionNavCloseButton, #testPaletteClose, #testPaletteCloseButton"
    )) {
      window.setTimeout(syncPaletteLayerState, 0);
    }
  });

  const paletteObserver = new MutationObserver(syncPaletteLayerState);
  paletteObserver.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-hidden"]
  });

  if (!document.querySelector("#hauSubjectsFeatureStyles")) {
    const style = document.createElement("style");
    style.id = "hauSubjectsFeatureStyles";
    style.textContent = `
      .bottom-nav {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .subject-card {
        text-align: left;
      }

      .nav-item[data-route="subjects"] .nav-icon::before {
        -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m12 3 9 5-9 5-9-5 9-5Z'/%3E%3Cpath d='m3 12 9 5 9-5'/%3E%3Cpath d='m3 16 9 5 9-5'/%3E%3C/svg%3E");
        mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m12 3 9 5-9 5-9-5 9-5Z'/%3E%3Cpath d='m3 12 9 5 9-5'/%3E%3Cpath d='m3 16 9 5 9-5'/%3E%3C/svg%3E");
      }

      .question-nav-layer {
        z-index: 40;
      }

      html.question-palette-open .sticky-search {
        visibility: hidden;
        pointer-events: none;
      }

      .question-number-grid button.current {
        border-width: 3px;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(47, 125, 74, 0.13), 3px 4px 9px rgba(82, 112, 84, 0.1);
      }
    `;
    document.head.appendChild(style);
  }

  applyCanonicalSubjects();

  window.HAU_SUBJECTS_FEATURE = {
    subjects: [...subjectNames],
    applyCanonicalSubjects,
    questionsForSubject
  };
})();

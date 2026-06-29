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
    document.documentElement.classList.remove("question-palette-open");
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

  function visiblePaperQuestionNumber() {
    const appRect = app.getBoundingClientRect();
    const x = Math.max(16, Math.min(window.innerWidth - 16, appRect.left + (appRect.width / 2)));
    const anchorPoints = [96, 132, 176, 220].filter((y) => y < window.innerHeight);

    for (const y of anchorPoints) {
      const card = document.elementFromPoint(x, y)?.closest?.('article.question-card[id^="question-"]');
      const number = Number(card?.id.match(/^question-(\d+)$/)?.[1]);
      if (number) return number;
    }

    const cards = app.querySelectorAll('article.question-card[id^="question-"]');
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > 76 && rect.top < window.innerHeight) {
        return Number(card.id.match(/^question-(\d+)$/)?.[1]) || 1;
      }
    }

    return 1;
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
    requestAnimationFrame(() => {
      const grid = app.querySelector(gridSelector);
      const current = grid?.querySelector("button.current");
      if (!grid || !current) return;

      const targetTop = current.offsetTop - (grid.clientHeight / 2) + (current.offsetHeight / 2);
      grid.scrollTop = Math.max(0, targetTop);
    });
  }

  function syncPaletteLayerState() {
    document.documentElement.classList.toggle(
      "question-palette-open",
      Boolean(app.querySelector(".question-nav-layer.open"))
    );
  }

  app.addEventListener("click", (event) => {
    if (event.target.closest?.("#questionNavOpen")) {
      pendingPaperQuestion = visiblePaperQuestionNumber();
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

    if (event.target.closest?.(
      "#questionNavClose, #questionNavCloseButton, #testPaletteClose, #testPaletteCloseButton"
    )) {
      window.setTimeout(syncPaletteLayerState, 0);
    }
  }, true);

  app.addEventListener("click", (event) => {
    if (!event.target.closest?.("#questionNavOpen")) return;
    window.setTimeout(() => {
      markPaletteQuestion(
        ".question-number-grid [data-jump-question]",
        "jumpQuestion",
        pendingPaperQuestion
      );
      syncPaletteLayerState();
      centerPaletteQuestion(".question-number-grid");
    }, 0);
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

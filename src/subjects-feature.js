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
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
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

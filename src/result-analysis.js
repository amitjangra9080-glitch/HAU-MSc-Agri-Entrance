(() => {
  const validOptionKeys = ["A", "B", "C", "D"];
  let resultPaletteOpen = false;
  let resultCurrentQuestion = 1;
  let resultPaperId = "";
  let resultQuestionObserver = null;
  let mutationQueued = false;

  function questionCorrectOptions(question) {
    const configured = Array.isArray(question?.correctOptions)
      ? question.correctOptions
      : String(question?.correctOption || "")
          .replace(/\band\b/gi, "/")
          .replace(/&/g, "/")
          .split("/");

    return [...new Set(
      configured
        .map((option) => String(option || "").trim().toUpperCase())
        .filter((option) => validOptionKeys.includes(option))
    )];
  }

  function optionAnswerText(question, option) {
    if (!option) return "Not attempted";
    const text = question?.options?.[option] || "";
    return text ? `${option} — ${text}` : option;
  }

  function acceptedAnswerText(question) {
    return questionCorrectOptions(question)
      .map((option) => optionAnswerText(question, option))
      .join("; ");
  }

  function renderedOptionText(question, option) {
    const escaped = htmlescape(question?.options?.[option] || "");
    return Array.isArray(question?.italicOptions) && question.italicOptions.includes(option)
      ? `<em>${escaped}</em>`
      : escaped;
  }

  function resultStatus(review) {
    if (!review?.selected) return "unattempted";
    return review.isCorrect ? "correct" : "incorrect";
  }

  function resultOptionBadge(question, option, selected) {
    const accepted = questionCorrectOptions(question);
    const isAccepted = accepted.includes(option);
    const isSelected = selected === option;

    if (isSelected && isAccepted) return "Your answer · Correct";
    if (isSelected) return "Your answer · Incorrect";
    if (isAccepted && accepted.length > 1) return "Accepted answer";
    if (isAccepted) return "Correct answer";
    return "";
  }

  function resultOptionClasses(question, option, selected) {
    const accepted = questionCorrectOptions(question);
    const isAccepted = accepted.includes(option);
    const isSelected = selected === option;
    return [
      "option",
      "result-option",
      isAccepted ? "correct" : "",
      isSelected && isAccepted ? "selected-correct" : "",
      isSelected && !isAccepted ? "selected-wrong" : ""
    ].filter(Boolean).join(" ");
  }

  function renderResultOptions(question, review) {
    return `
      <div class="options result-options">
        ${validOptionKeys.map((option) => {
          const badge = resultOptionBadge(question, option, review.selected || "");
          return `
            <div class="${resultOptionClasses(question, option, review.selected || "")}">
              <span class="option-key">${option}</span>
              <div class="result-option-copy">
                <span>${renderedOptionText(question, option)}</span>
                ${badge ? `<small>${htmlescape(badge)}</small>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderAnalysisField(label, value) {
    if (!value || String(value).trim() === "-") return "";
    return `
      <div class="result-analysis-field">
        <span>${htmlescape(label)}</span>
        <p>${htmlescape(String(value).trim())}</p>
      </div>
    `;
  }

  function renderQuestionAnalysis(question) {
    const reference = question.reference && String(question.reference).trim() !== "-"
      ? question.reference
      : "";
    const content = [
      renderAnalysisField("Subject / Domain", question.subject),
      renderAnalysisField("Topic", question.topic),
      renderAnalysisField("Explanation", question.explanation),
      renderAnalysisField("Reference", reference)
    ].join("");

    if (!content) return "";

    return `
      <details class="result-analysis">
        <summary>
          <span class="analysis-open-label">View analysis</span>
          <span class="analysis-close-label">Hide analysis</span>
        </summary>
        <div class="result-analysis-body">${content}</div>
      </details>
    `;
  }

  function renderMultipleAnswerFlag(question) {
    return questionCorrectOptions(question).length > 1
      ? `<div class="result-review-flag multiple">Multiple accepted answers</div>`
      : "";
  }

  function renderResultPalette(paper, result) {
    return `
      <div class="question-nav-layer result-palette-layer ${resultPaletteOpen ? "open" : ""}" aria-hidden="${resultPaletteOpen ? "false" : "true"}">
        <button class="question-nav-backdrop" type="button" id="resultPaletteClose" aria-label="Close result palette"></button>
        <aside class="question-nav-panel result-palette-panel">
          <div class="question-nav-head">
            <div>
              <h2>Result Palette</h2>
              <p>Open any reviewed question</p>
            </div>
            <button class="icon-button" type="button" id="resultPaletteCloseButton" aria-label="Close">${icons.close}</button>
          </div>
          <div class="palette-legend result-palette-legend">
            <span class="legend-dot correct"></span>Correct
            <span class="legend-dot incorrect"></span>Incorrect
            <span class="legend-dot unattempted"></span>Not attempted
          </div>
          <div class="question-number-grid result-number-grid">
            ${paper.questions.map((question) => {
              const review = result.review?.[question.number] || {};
              const status = resultStatus(review);
              const current = Number(question.number) === Number(resultCurrentQuestion) ? "current" : "";
              return `
                <button class="${status} ${current}" type="button" data-result-jump="${question.number}" aria-label="Question ${question.number}: ${status.replace("-", " ")}">
                  ${question.number}
                </button>
              `;
            }).join("")}
          </div>
        </aside>
      </div>
    `;
  }

  function focusCurrentResultPaletteQuestion() {
    requestAnimationFrame(() => {
      app.querySelector(".result-number-grid button.current")?.scrollIntoView({ block: "center" });
    });
  }

  function updateCurrentResultQuestion(number) {
    resultCurrentQuestion = Number(number) || 1;
    app.querySelectorAll(".result-number-grid button").forEach((button) => {
      button.classList.toggle("current", Number(button.dataset.resultJump) === resultCurrentQuestion);
    });
  }

  function setupResultQuestionObserver() {
    if (resultQuestionObserver) resultQuestionObserver.disconnect();
    if (typeof IntersectionObserver !== "function") return;

    resultQuestionObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top - 76) - Math.abs(b.boundingClientRect.top - 76));
      if (!visible.length) return;
      updateCurrentResultQuestion(visible[0].target.dataset.resultQuestion);
    }, {
      root: null,
      rootMargin: "-64px 0px -58% 0px",
      threshold: [0.05, 0.25, 0.5]
    });

    app.querySelectorAll("[data-result-question]").forEach((card) => resultQuestionObserver.observe(card));
  }

  function applyItalicOptionsInTestWindow() {
    if (typeof state === "undefined" || state.route !== "test-taking") return;
    const question = typeof activeQuestion === "function" ? activeQuestion() : null;
    if (!question || !Array.isArray(question.italicOptions)) return;
    question.italicOptions.forEach((option) => {
      const label = app.querySelector(`[data-test-answer="${option}"] strong`);
      if (label) label.style.fontStyle = "italic";
    });
  }

  function queuePostRenderEnhancements() {
    if (mutationQueued) return;
    mutationQueued = true;
    requestAnimationFrame(() => {
      mutationQueued = false;
      applyItalicOptionsInTestWindow();
    });
  }

  calculateResult = function calculateResultWithReviewedAnswers(attempt, paper) {
    const safeAttempt = attempt || {};
    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;
    const review = {};

    paper.questions.forEach((question) => {
      const selected = safeAttempt.answers?.[question.number] || "";
      const correctOptions = questionCorrectOptions(question);
      const isCorrect = Boolean(selected) && correctOptions.includes(selected);

      if (!selected) unattempted += 1;
      else if (isCorrect) correct += 1;
      else incorrect += 1;

      review[question.number] = {
        selected,
        correctOption: correctOptions[0] || "",
        correctOptions,
        isCorrect,
        timeSpentMs: safeAttempt.timeSpent?.[question.number] || 0
      };
    });

    const total = paper.questions.length;
    const attempted = correct + incorrect;
    const score = correct;

    return {
      score,
      totalMarks: total,
      correct,
      incorrect,
      unattempted,
      accuracy: attempted ? Math.round((correct / attempted) * 10000) / 100 : 0,
      percentageScore: total ? Math.round((score / total) * 10000) / 100 : 0,
      timeTakenMs: timeTakenMs(safeAttempt),
      sectionPerformance: { Overall: { correct, incorrect, unattempted, total } },
      answerKeyVersion: paper.answerKeyVersion || 1,
      review
    };
  };

  renderTestResult = function renderReviewedTestResult() {
    const paper = selectedTestPaper();
    const attempt = state.currentAttempt || {};
    const result = calculateResult(attempt, paper);

    if (resultPaperId !== paper.id) {
      resultPaperId = paper.id;
      resultPaletteOpen = false;
      resultCurrentQuestion = paper.questions[0]?.number || 1;
    }

    app.innerHTML = `
      <section class="screen result-screen">
        ${topbar("Result", paper.title, "tests")}
        <div id="testSaveStatus" class="form-status status-message" ${state.testSaveMessage ? "" : "hidden"}>${htmlescape(state.testSaveMessage)}</div>
        <div class="result-score">
          <span>Score</span>
          <strong>${result.score}/${result.totalMarks}</strong>
        </div>
        <div class="test-summary">
          <div><span>Correct</span><strong>${result.correct}</strong></div>
          <div><span>Incorrect</span><strong>${result.incorrect}</strong></div>
          <div><span>Unattempted</span><strong>${result.unattempted}</strong></div>
          <div><span>Accuracy</span><strong>${result.accuracy}%</strong></div>
          <div><span>Percentage</span><strong>${result.percentageScore}%</strong></div>
          <div><span>Time taken</span><strong>${formatDuration(result.timeTakenMs)}</strong></div>
        </div>
        <div class="question-list result-question-list">
          ${paper.questions.map((question) => renderResultQuestion(question, result.review?.[question.number] || {})).join("")}
        </div>
        <button class="question-nav-handle result-palette-handle" type="button" id="resultPaletteOpen">Palette</button>
        ${renderResultPalette(paper, result)}
        ${bottomNav("tests")}
      </section>
    `;

    requestAnimationFrame(setupResultQuestionObserver);
  };

  renderResultQuestion = function renderReviewedResultQuestion(question, review) {
    const accepted = questionCorrectOptions(question);
    const status = review.isCorrect ? "Correct" : review.selected ? "Incorrect" : "Not attempted";
    const statusClass = resultStatus(review);
    const answerLabel = accepted.length > 1 ? "Accepted answers" : "Correct answer";

    return `
      <article class="question-card result-question-card" id="result-question-${question.number}" data-result-question="${question.number}">
        <div class="q-meta">
          <span>Q.${question.number}</span>
          <span class="result-status ${statusClass}">${status}</span>
        </div>
        ${renderMultipleAnswerFlag(question)}
        <h2>${htmlescape(question.question)}</h2>
        ${renderResultOptions(question, review)}
        <div class="result-answer-summary">
          <div>
            <span>Your answer</span>
            <strong>${htmlescape(optionAnswerText(question, review.selected || ""))}</strong>
          </div>
          <div>
            <span>${answerLabel}</span>
            <strong>${htmlescape(acceptedAnswerText(question))}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>${status}</strong>
          </div>
          <div>
            <span>Time spent</span>
            <strong>${formatDuration(review.timeSpentMs || 0)}</strong>
          </div>
        </div>
        ${renderQuestionAnalysis(question)}
      </article>
    `;
  };

  renderQuestionCard = function renderQuestionCardWithReviewedAnswers(question) {
    const accepted = questionCorrectOptions(question);
    const answerLabel = accepted.length > 1 ? "Correct answers" : "Correct answer";
    return `
      <article class="question-card" id="question-${question.number}">
        <div class="q-meta"><span>${htmlescape(question.paperTitle || "")}</span><span>Q.${question.number}</span></div>
        <h2>${htmlescape(question.question)}</h2>
        <div class="options">
          ${validOptionKeys.map((option) => `
            <div class="option ${accepted.includes(option) ? "correct" : ""}">
              <span class="option-key">${option}</span>
              <span>${renderedOptionText(question, option)}</span>
            </div>
          `).join("")}
        </div>
        <div class="answer-line">${answerLabel}: ${htmlescape(accepted.join(" and "))}</div>
      </article>
    `;
  };

  app.addEventListener("click", (event) => {
    if (event.target.id === "resultPaletteOpen") {
      resultPaletteOpen = true;
      renderTestResult();
      focusCurrentResultPaletteQuestion();
      return;
    }

    if (event.target.id === "resultPaletteClose" || event.target.id === "resultPaletteCloseButton") {
      resultPaletteOpen = false;
      renderTestResult();
      return;
    }

    const jumpButton = event.target.closest("[data-result-jump]");
    if (!jumpButton) return;

    const questionNumber = Number(jumpButton.dataset.resultJump);
    resultCurrentQuestion = questionNumber;
    resultPaletteOpen = false;
    renderTestResult();
    requestAnimationFrame(() => {
      document.querySelector(`#result-question-${questionNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  if (typeof MutationObserver === "function") {
    new MutationObserver(queuePostRenderEnhancements).observe(app, { childList: true, subtree: true });
  }

  window.HAU_RESULT_ANALYSIS = {
    questionCorrectOptions,
    optionAnswerText,
    acceptedAnswerText,
    resultStatus
  };
})();

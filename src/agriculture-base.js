(() => {
  const DATA_URL = "src/data/agriculture-base-data.json?v=20260704-agbase6";
  const appRoot = document.querySelector("#app");
  if (!appRoot) return;

  let agricultureData = null;
  let dataPromise = null;
  let lastQuery = "";
  let answerState = { status: "idle", payload: null, error: "" };
  let answerTimer = null;
  let answerController = null;

  const icons = {
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.8 4.2a6.6 6.6 0 0 1 5.2 10.7l3.2 3.2-1.1 1.1-3.2-3.2A6.6 6.6 0 1 1 10.8 4.2Zm0 1.6a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"/></svg>`,
    leaf: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 4.4C13.7 4.6 8.6 6.9 5.7 11.2 3.4 14.6 3.5 18.6 3.6 19.4c.8.1 4.8.2 8.2-2.1 4.3-2.9 6.6-8 6.8-13ZM6 17.8c.6-2.2 2-4.4 4.2-6.6 1.7-1.7 3.5-2.9 5.4-3.7-.8 1.9-2 3.7-3.7 5.4-2.2 2.2-4.4 3.6-6.6 4.2.2.3.4.5.7.7Z"/></svg>`,
    back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.7 5.3 9 12l6.7 6.7-1.4 1.4L6.2 12l8.1-8.1 1.4 1.4Z"/></svg>`
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalize(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9%+\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function loadData() {
    if (agricultureData) return Promise.resolve(agricultureData);
    if (!dataPromise) {
      dataPromise = fetch(DATA_URL, { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error("Agriculture Base data unavailable");
          return response.json();
        })
        .then((payload) => {
          agricultureData = payload || { concepts: [] };
          return agricultureData;
        });
    }
    return dataPromise;
  }

  function injectStyles() {
    if (document.querySelector("#agricultureBaseStyles")) return;
    const style = document.createElement("style");
    style.id = "agricultureBaseStyles";
    style.textContent = `
      .agbase-card {
        border: 1px solid rgba(22, 101, 52, 0.14);
        background: linear-gradient(135deg, rgba(236, 253, 245, 0.96), rgba(255, 247, 237, 0.96));
        border-radius: 26px;
        padding: 18px;
        margin: 16px 0;
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 14px;
        align-items: center;
        box-shadow: 0 18px 45px rgba(22, 101, 52, 0.10);
      }
      .agbase-card-icon {
        width: 48px;
        height: 48px;
        border-radius: 18px;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #16a34a, #84cc16);
        color: white;
        box-shadow: 0 10px 24px rgba(22, 163, 74, 0.26);
      }
      .agbase-card-icon svg,
      .agbase-back svg,
      .agbase-search-icon svg { width: 22px; height: 22px; fill: currentColor; }
      .agbase-card h2 { margin: 0; font-size: 1.05rem; color: #102314; }
      .agbase-card p { margin: 4px 0 0; color: #64705f; font-size: .9rem; line-height: 1.35; }
      .agbase-card button {
        border: 0;
        border-radius: 999px;
        padding: 11px 15px;
        color: white;
        background: linear-gradient(135deg, #15803d, #65a30d);
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 10px 20px rgba(21, 128, 61, 0.22);
      }
      .agbase-screen { min-height: 100dvh; padding-bottom: 26px; }
      .agbase-hero {
        border-radius: 28px;
        padding: 18px;
        color: white;
        background: radial-gradient(circle at top left, rgba(255,255,255,.25), transparent 32%), linear-gradient(135deg, #166534, #65a30d);
        box-shadow: 0 20px 44px rgba(22, 101, 52, .22);
        margin-bottom: 16px;
      }
      .agbase-hero h1 { margin: 8px 0 4px; font-size: 1.55rem; }
      .agbase-hero p { margin: 0; opacity: .92; line-height: 1.45; }
      .agbase-back {
        border: 0;
        width: 42px;
        height: 42px;
        border-radius: 15px;
        background: rgba(255,255,255,.18);
        color: white;
        display: grid;
        place-items: center;
        cursor: pointer;
      }
      .agbase-search-box {
        position: sticky;
        top: 0;
        z-index: 5;
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(22, 101, 52, .14);
        border-radius: 22px;
        background: rgba(255,255,255,.96);
        padding: 12px 14px;
        box-shadow: 0 14px 34px rgba(15, 23, 42, .08);
        backdrop-filter: blur(14px);
      }
      .agbase-search-icon { color: #15803d; display: grid; place-items: center; }
      .agbase-search-box input {
        border: 0;
        outline: none;
        font-size: 16px;
        background: transparent;
        color: #172016;
        width: 100%;
      }
      .agbase-answer {
        margin-top: 14px;
        border: 1px solid rgba(22, 101, 52, .12);
        border-radius: 24px;
        background: linear-gradient(180deg, #ffffff, #f8fff9);
        padding: 16px;
        box-shadow: 0 16px 38px rgba(15, 23, 42, .07);
      }
      .agbase-answer p { margin: 8px 0; color: #334155; line-height: 1.58; font-size: .95rem; }
      .agbase-answer ul { margin: 10px 0 0; padding-left: 19px; color: #334155; line-height: 1.55; }
      .agbase-answer li { margin: 6px 0; }
      .agbase-loading { color: #536052; }
      .agbase-error { color: #7f1d1d; }
      @media (max-width: 430px) {
        .agbase-card { grid-template-columns: auto 1fr; }
        .agbase-card button { grid-column: 1 / -1; width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectHomeCard() {
    injectStyles();
    const homeHead = appRoot.querySelector(".home-head");
    const paperList = appRoot.querySelector(".paper-list");
    if (!homeHead || appRoot.querySelector(".agbase-card")) return;
    const card = document.createElement("div");
    card.className = "agbase-card";
    card.innerHTML = `
      <div class="agbase-card-icon">${icons.leaf}</div>
      <div>
        <h2>Agriculture Base</h2>
        <p>Search any agriculture keyword and get one clean answer.</p>
      </div>
      <button type="button" data-agbase-open>Ask</button>
    `;
    if (paperList) paperList.parentNode.insertBefore(card, paperList);
    else homeHead.parentNode.insertBefore(card, homeHead.nextSibling);
  }

  function sentenceWithPeriod(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return /[.!?]$/.test(value) ? value : `${value}.`;
  }

  function localLines(query) {
    const q = normalize(query);
    const compactQ = q.replace(/\s+/g, "");
    const tokens = q.split(" ").filter((token) => token.length > 2);
    const lines = [];
    const concepts = Array.isArray(agricultureData?.concepts) ? agricultureData.concepts : [];
    concepts.forEach((concept) => {
      (concept.blocks || []).forEach((block) => {
        const candidates = [];
        if (block.type === "paragraph") candidates.push(block.text);
        if (block.type === "list") candidates.push(...(block.items || []));
        if (block.type === "table") (block.rows || []).forEach((row) => candidates.push(row.filter(Boolean).join(" — ")));
        candidates.forEach((line) => {
          const clean = String(line || "").replace(/\s+/g, " ").trim();
          const normal = normalize(clean);
          const compactLine = normal.replace(/\s+/g, "");
          const hit = (q && normal.includes(q)) || (compactQ && compactLine.includes(compactQ)) || tokens.some((token) => normal.includes(token) || compactLine.includes(token));
          if (hit && clean.length > 3) lines.push(clean);
        });
      });
    });
    const seen = new Set();
    return lines.filter((line) => {
      const key = normalize(line).replace(/\s+/g, "").slice(0, 140);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }

  function localAnswer(query) {
    return {
      ok: true,
      answer: "Answer engine is unavailable. Deploy the API file with this package and refresh once.",
      bullets: []
    };
  }

  function renderAnswerPanel() {
    const query = String(lastQuery || "").trim();
    if (normalize(query).length < 2) return "";
    if (answerState.status === "loading") {
      return `<article class="agbase-answer"><p class="agbase-loading">Searching Agriculture Base...</p></article>`;
    }
    const payload = answerState.payload || localAnswer(query);
    const answer = String(payload.answer || "This keyword is not available in Agriculture Base yet.").trim();
    const bullets = Array.isArray(payload.bullets) ? payload.bullets.filter(Boolean).slice(0, 8) : [];
    return `
      <article class="agbase-answer">
        ${answer ? `<p>${escapeHtml(answer)}</p>` : ""}
        ${bullets.length ? `<ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      </article>
    `;
  }

  function updateAnswerPanel() {
    const panel = document.querySelector("#agbaseAnswerPanel");
    if (panel) panel.innerHTML = renderAnswerPanel();
  }

  async function requestAnswer(query) {
    if (!query || normalize(query).length < 2) {
      answerState = { status: "idle", payload: null, error: "" };
      updateAnswerPanel();
      return;
    }
    if (answerController) answerController.abort();
    answerController = new AbortController();
    answerState = { status: "loading", payload: null, error: "" };
    updateAnswerPanel();
    try {
      const response = await fetch("/api/agriculture-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: answerController.signal
      });
      if (!response.ok) throw new Error("Answer API failed");
      const payload = await response.json();
      if (payload && payload.ok && !payload.empty) answerState = { status: "ready", payload, error: "" };
      else answerState = { status: "ready", payload: localAnswer(query), error: "" };
    } catch (error) {
      if (error.name === "AbortError") return;
      answerState = { status: "ready", payload: localAnswer(query), error: error.message || "" };
    }
    updateAnswerPanel();
  }

  function scheduleAnswer() {
    if (answerTimer) window.clearTimeout(answerTimer);
    const query = String(lastQuery || "").trim();
    if (normalize(query).length < 2) {
      answerState = { status: "idle", payload: null, error: "" };
      updateAnswerPanel();
      return;
    }
    answerTimer = window.setTimeout(() => requestAnswer(query), 420);
  }

  function renderSearch() {
    injectStyles();
    appRoot.innerHTML = `
      <section class="screen agbase-screen">
        <div class="agbase-hero">
          <button class="agbase-back" type="button" data-route="home" aria-label="Back">${icons.back}</button>
          <h1>Agriculture Base</h1>
          <p>Ask any agriculture keyword or fact from the database.</p>
        </div>
        <label class="agbase-search-box">
          <span class="agbase-search-icon">${icons.search}</span>
          <input id="agbaseSearchInput" type="search" inputmode="search" autocomplete="off" placeholder="Search: particle size of sand, Poaceae, monocot..." value="${escapeHtml(lastQuery)}" />
        </label>
        <div id="agbaseAnswerPanel">${renderAnswerPanel()}</div>
      </section>
    `;
    const input = document.querySelector("#agbaseSearchInput");
    if (input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  async function openAgricultureBase() {
    injectStyles();
    appRoot.innerHTML = `
      <section class="screen agbase-screen">
        <div class="agbase-hero">
          <button class="agbase-back" type="button" data-route="home" aria-label="Back">${icons.back}</button>
          <h1>Agriculture Base</h1>
          <p>Loading...</p>
        </div>
      </section>
    `;
    try {
      await loadData();
      renderSearch();
      if (normalize(lastQuery).length >= 2) scheduleAnswer();
    } catch (error) {
      console.error(error);
      appRoot.innerHTML = `
        <section class="screen agbase-screen">
          <div class="agbase-hero">
            <button class="agbase-back" type="button" data-route="home" aria-label="Back">${icons.back}</button>
            <h1>Agriculture Base</h1>
            <p>Could not load the database.</p>
          </div>
          <article class="agbase-answer"><p class="agbase-error">Refresh once. If it still fails, check that agriculture-base-data.json is uploaded.</p></article>
        </section>
      `;
    }
  }

  document.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-agbase-open]");
    if (openButton) {
      event.preventDefault();
      openAgricultureBase();
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target && event.target.id === "agbaseSearchInput") {
      lastQuery = event.target.value || "";
      answerState = { status: "idle", payload: null, error: "" };
      updateAnswerPanel();
      scheduleAnswer();
    }
  });

  new MutationObserver(() => {
    window.requestAnimationFrame(injectHomeCard);
  }).observe(appRoot, { childList: true, subtree: true });

  injectStyles();
  injectHomeCard();
})();

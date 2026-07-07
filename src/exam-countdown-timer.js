(() => {
  const targetTimeMs = new Date("2026-07-19T00:00:00+05:30").getTime();
  const appRoot = document.querySelector("#app");
  let countdownInterval = null;

  if (!appRoot || Number.isNaN(targetTimeMs)) return;

  function remainingParts() {
    const remainingMs = Math.max(0, targetTimeMs - Date.now());
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { remainingMs, days, hours, minutes, seconds };
  }

  function twoDigit(value) {
    return String(value).padStart(2, "0");
  }

  function removeCountdown() {
    document.querySelector("#mscEntranceCountdown")?.remove();
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function countdownCardMarkup() {
    return `
      <section id="mscEntranceCountdown" class="exam-countdown-card" aria-label="M.Sc Entrance countdown">
        <div class="exam-countdown-copy">
          <span class="exam-countdown-kicker">M.Sc Entrance</span>
          <strong>Countdown to 19 July</strong>
          <p>Ends at 12:00 AM IST.</p>
        </div>
        <div class="exam-countdown-grid" aria-live="polite">
          <div class="exam-countdown-unit"><strong data-countdown-days>0</strong><span>Days</span></div>
          <div class="exam-countdown-unit"><strong data-countdown-hours>00</strong><span>Hours</span></div>
          <div class="exam-countdown-unit"><strong data-countdown-minutes>00</strong><span>Min</span></div>
          <div class="exam-countdown-unit"><strong data-countdown-seconds>00</strong><span>Sec</span></div>
        </div>
      </section>
    `;
  }

  function updateCountdown() {
    const parts = remainingParts();
    if (parts.remainingMs <= 0) {
      removeCountdown();
      return;
    }

    const homeHead = document.querySelector(".home-head");
    if (!homeHead) return;

    let card = document.querySelector("#mscEntranceCountdown");
    if (!card) {
      homeHead.insertAdjacentHTML("afterbegin", countdownCardMarkup());
      card = document.querySelector("#mscEntranceCountdown");
    }
    if (!card) return;

    card.querySelector("[data-countdown-days]").textContent = String(parts.days);
    card.querySelector("[data-countdown-hours]").textContent = twoDigit(parts.hours);
    card.querySelector("[data-countdown-minutes]").textContent = twoDigit(parts.minutes);
    card.querySelector("[data-countdown-seconds]").textContent = twoDigit(parts.seconds);
  }

  function startCountdown() {
    updateCountdown();
    if (!countdownInterval && targetTimeMs > Date.now()) {
      countdownInterval = setInterval(updateCountdown, 1000);
    }
  }

  new MutationObserver(startCountdown).observe(appRoot, {
    childList: true,
    subtree: true
  });

  document.addEventListener("visibilitychange", updateCountdown);
  startCountdown();
})();

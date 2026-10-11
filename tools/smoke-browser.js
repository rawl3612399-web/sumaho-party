/* Browser smoke test: opens every game from the list, presses its start button, and records script errors.
 * Run inside the built page (served locally):
 *   const s = await (await fetch("/tools/smoke-browser.js")).text(); await eval(s);
 * Returns [{ id, title, opened, started, errors }]. */
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const errors = [];
  const onError = (e) => errors.push(String(e.message || e.reason || e));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onError);
  const home = () => document.getElementById("homeBtn").click();
  const results = [];
  try {
    home();
    await wait(50);
    const cards = [...document.querySelectorAll(".menu-card")];
    for (let i = 0; i < cards.length; i++) {
      const before = errors.length;
      home();
      await wait(30);
      const card = document.querySelectorAll(".menu-card")[i];
      const title = card.querySelector(".menu-name").textContent;
      card.click();
      await wait(60);
      const mode = [...document.querySelectorAll(".app > .mode")].find(m => !m.hidden && m.id !== "modeMenu");
      const startBtn = mode && [...mode.querySelectorAll(".actions .btn")].find(b => !b.disabled && b.classList.contains("primary"));
      if (startBtn) startBtn.click();
      await wait(400);
      results.push({ id: mode ? mode.id : null, title, opened: Boolean(mode), started: Boolean(startBtn), errors: errors.slice(before) });
    }
    home();
  } finally {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onError);
  }
  return results;
})();

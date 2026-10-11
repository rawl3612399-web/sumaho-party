/* Shared helpers: DOM lookup, local storage, wake lock, UI builders, player names. Sound lives in audio.js, music in music.js. */
const $ = (id) => document.getElementById(id);

const Store = {
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable: lasts for this visit only */ }
  }
};

const Awake = (() => {
  let lock = null;
  async function keep() {
    try { if ("wakeLock" in navigator && !lock) lock = await navigator.wakeLock.request("screen"); }
    catch (e) { lock = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { lock = null; keep(); }
  });
  return { keep };
})();

/* Small UI builders shared by the game screens. */
function makeButton(label, onClick, cls = "", disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = ("btn " + cls).trim();
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}
function makeChip(label, on, onClick, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = label;
  b.disabled = disabled;
  b.setAttribute("aria-pressed", on ? "true" : "false");
  b.addEventListener("click", onClick);
  return b;
}

/* Two-player names, shared by every 2-player game so they are typed once. */
const Duo = (() => {
  const KEY = "duo.names";
  const LEGACY_KEY = "denki.names";
  const DEFAULTS = Object.freeze(["プレイヤー1", "プレイヤー2"]);
  const MAX_LEN = 12;

  function load() {
    const saved = Store.load(KEY, null) ?? Store.load(LEGACY_KEY, null);
    const list = Array.isArray(saved) ? saved : [];
    return DEFAULTS.map((d, i) => (typeof list[i] === "string" && list[i].trim() ? list[i].trim().slice(0, MAX_LEN) : d));
  }
  function fill(inputs) {
    const names = load();
    inputs.forEach((input, i) => { input.value = names[i]; });
  }
  function read(inputs) {
    const names = inputs.map((input, i) => input.value.trim().slice(0, MAX_LEN) || DEFAULTS[i]);
    Store.save(KEY, names);
    return names;
  }
  return { load, fill, read, DEFAULTS, MAX_LEN };
})();

/* Common pieces for the game screens: text that hides when empty, rule lists, option chips, a word card. */
const View = (() => {
  const SEATS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H"]);

  function text(el, value) {
    if (!el) return;
    el.textContent = value ?? "";
    el.hidden = value === null || value === undefined || value === "";
  }
  function list(el, lines) {
    el.replaceChildren(...lines.map(t => {
      const li = document.createElement("li");
      li.textContent = t;
      return li;
    }));
  }
  function chips(el, options, current, onPick) {
    el.replaceChildren(...options.map(o => makeChip(o.label, o.value === current, () => onPick(o.value))));
  }
  /* card: { main, sub, back, cls } or null */
  function card(el, c) {
    if (!el) return;
    el.hidden = !c;
    if (!c) return;
    el.className = ["word-card", c.back ? "back" : "", c.cls || ""].filter(Boolean).join(" ");
    const parts = [[c.main, "wc-main"], [c.sub, "wc-sub"]].filter(([t]) => t !== undefined && t !== null && t !== "");
    el.replaceChildren(...parts.map(([t, cls]) => {
      const s = document.createElement("span");
      s.className = cls;
      s.textContent = t;
      return s;
    }));
  }
  /* Renders the standard play view: { label, title, card, hint, actions }. */
  function stage(el, v) {
    text(el.label, v.label);
    text(el.title, v.title);
    card(el.card, v.card ?? null);
    text(el.hint, v.hint);
    el.actions.replaceChildren(...(v.actions || []));
  }
  const seat = (i) => SEATS[i];
  const options = (values, label) => values.map(v => ({ value: v, label: label(v) }));
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  return { SEATS, text, list, chips, card, stage, seat, options, clock };
})();

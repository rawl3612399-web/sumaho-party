/* Sliding puzzle screen: tap or swipe tiles toward the gap, numbers or a generated picture, best records per size. */
const Slide = (() => {
  const R = SlideRules;
  const KEY = "slide.settings";
  const REC_KEY = "slide.records";
  const PICS = Object.freeze(["num", "pic"]);
  const SWIPE_PX = 18;
  const PEEK_KEY_MS = 1500;
  const INTRO = Object.freeze({ hide: 550, scatter: 800, ready: 1500 });
  const WIN_SFX_MS = 380;
  const RECORD_MS = 1900;
  const PIC_PX = 720;
  const FLOW_GUARD_MS = 350;
  const KEY_DIRS = Object.freeze({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" });

  const el = {
    setup: $("slSetup"), play: $("slPlay"), label: $("slLabel"), title: $("slTitle"), hint: $("slHint"), actions: $("slActions"),
    moves: $("slMoves"), time: $("slTime"), best: $("slBest"), movesBox: $("slMovesBox"), timeBox: $("slTimeBox"),
    tray: $("slTray"), board: $("slBoard"), peek: $("slPeek"), record: $("slRecord"), setupBest: $("slSetupBest")
  };

  let settings = { size: 4, pic: "num", labels: true };
  let records = R.normalizeRecords(null);
  let game = null;
  let ui = { phase: "setup", busy: false, peek: false, result: null };
  let clock = { base: 0, since: 0, timer: 0 };
  let tileEls = [];
  let pointer = null;
  let timers = [];
  let art = { scene: 0, key: "", url: "" };
  let flowAt = -Infinity;

  const reduced = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sizeLabel = (n) => `${n}×${n}`;
  const picMode = () => el.tray.classList.contains("slide-mode-pic");
  const canPlay = () => ui.phase === "play" && !ui.busy && !ui.peek && Boolean(game) && !game.solved;
  const bestText = (rec) => (rec.ms === null ? "-" : `${R.timeText(rec.ms)}・${rec.moves}手`);

  function normalize(s) {
    const src = s && typeof s === "object" ? s : {};
    return {
      size: R.SIZES.includes(src.size) ? src.size : 4,
      pic: PICS.includes(src.pic) ? src.pic : "num",
      labels: typeof src.labels === "boolean" ? src.labels : true
    };
  }
  function update(patch) {
    settings = normalize({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function later(fn, ms) {
    const id = setTimeout(() => { timers = timers.filter(t => t !== id); fn(); }, ms);
    timers = [...timers, id];
  }
  function clearLater() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  /* Screen-changing buttons ignore a second quick tap, which would otherwise land on the next screen's button
     (a double tap on はじめる used to hit やめる and end the game at once). */
  function flowButton(label, fn, cls) {
    return makeButton(label, () => {
      const now = performance.now();
      if (now - flowAt < FLOW_GUARD_MS) return;
      flowAt = now;
      fn();
    }, cls);
  }

  /* ---------- clock: starts on the first move, pauses when the app is hidden ---------- */
  const running = () => clock.timer !== 0;
  const elapsed = () => clock.base + (running() ? performance.now() - clock.since : 0);
  const showTime = () => { el.time.textContent = R.timeText(elapsed()); };
  function runClock() {
    if (!running()) clock = { ...clock, since: performance.now(), timer: setInterval(showTime, 100) };
  }
  function pauseClock() {
    if (!running()) return;
    const base = elapsed();
    clearInterval(clock.timer);
    clock = { base, since: 0, timer: 0 };
    showTime();
  }
  function resetClock() {
    clearInterval(clock.timer);
    clock = { base: 0, since: 0, timer: 0 };
  }

  /* ---------- sounds: wooden tiles ---------- */
  function woodClick(count, home) {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const heavy = Math.min(count, 4);
    const at = t + (reduced() ? 0.005 : 0.1);
    Sound.hiss({ t, dur: 0.07 + heavy * 0.015, vol: 0.035 + heavy * 0.01, type: "bandpass", freq: 700, to: 1800, q: 0.8, attack: 0.012 });
    Sound.tone({ freq: 1250 - heavy * 70, glide: 760, glideTime: 0.03, type: "triangle", t: at, dur: 0.05, vol: 0.15 });
    Sound.tone({ freq: 260 - heavy * 15, glide: 170, type: "sine", t: at, dur: 0.08, vol: 0.2 });
    Sound.hiss({ t: at, dur: 0.03, vol: 0.1, type: "bandpass", freq: 2400, q: 1.6 });
    if (home) Sound.tone({ freq: Sound.hz(98), type: "sine", t: at + 0.04, dur: 0.2, vol: 0.035, send: 0.25 });
  }
  function thunk() {
    Sound.tone({ freq: 150, glide: 95, type: "sine", dur: 0.09, vol: 0.2 });
    Sound.hiss({ dur: 0.04, vol: 0.05, type: "lowpass", freq: 900 });
  }
  function rattle() {
    const ctx = Sound.ctx();
    if (!ctx) return;
    Sound.sfx("whoosh");
    for (let k = 0; k < 9; k++) {
      const t = ctx.currentTime + 0.05 + k * 0.055 + Math.random() * 0.02;
      Sound.hiss({ t, dur: 0.03, vol: 0.07, type: "bandpass", freq: 1600 + Math.random() * 1200, q: 1.4 });
      Sound.tone({ freq: 900 + Math.random() * 400, glide: 650, glideTime: 0.025, type: "triangle", t, dur: 0.035, vol: 0.06 });
    }
  }

  /* ---------- picture: drawn on a canvas from theme tokens, sliced into tiles by CSS ---------- */
  const ART_TOKENS = Object.freeze(["--c-sky", "--c-cyan", "--c-blue", "--c-indigo", "--c-teal", "--c-mint", "--c-green", "--c-lime", "--zap",
    "--c-amber", "--c-orange", "--c-red", "--c-pink", "--c-rose", "--c-violet", "--c-purple", "--c-gold", "--c-brown", "--c-slate", "--sl-cloud"]);
  const BRIGHT = ART_TOKENS.slice(0, 17);

  function seeded(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function paint(g, color, draw) { g.fillStyle = color; g.beginPath(); draw(); g.fill(); }
  const disc = (g, color, x, y, r) => paint(g, color, () => g.arc(x, y, r, 0, Math.PI * 2));
  const oval = (g, color, x, y, rx, ry, rot = 0) => paint(g, color, () => g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2));
  const poly = (g, color, pts) => paint(g, color, () => pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))));
  const box = (g, color, x, y, w, h) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
  function line(g, color, width, draw) { g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round"; g.beginPath(); draw(); g.stroke(); }
  function sky(g, S, stops) {
    const grad = g.createLinearGradient(0, 0, 0, S * 0.62);
    stops.forEach((col, i) => grad.addColorStop(i / (stops.length - 1), col));
    box(g, grad, 0, 0, S, S);
  }
  function cloud(g, color, x, y, r) {
    [[0, 0, 1], [r, 0.25 * r, 0.8], [-r, 0.3 * r, 0.7], [0.4 * r, -0.5 * r, 0.75]].forEach(([dx, dy, k]) => disc(g, color, x + dx, y + dy, r * k));
  }
  function ridge(g, color, S, y, amp, phase) {
    paint(g, color, () => {
      g.moveTo(0, S);
      for (let x = 0; x <= S; x += S / 48) g.lineTo(x, y + Math.sin((x / S) * Math.PI * 2 + phase) * amp);
      g.lineTo(S, S);
    });
  }
  function birds(g, color, u, list) {
    list.forEach(([x, y]) => line(g, color, 0.7 * u, () => {
      g.moveTo((x - 2) * u, (y - 1) * u);
      g.quadraticCurveTo((x - 1) * u, (y - 2) * u, x * u, y * u);
      g.quadraticCurveTo((x + 1) * u, (y - 2) * u, (x + 2) * u, (y - 1) * u);
    }));
  }
  function tree(g, c, u, [x, y, crown, shine]) {
    box(g, c("--c-brown"), (x - 1) * u, y * u, 2 * u, 6 * u);
    disc(g, c(crown), x * u, y * u, 5 * u);
    disc(g, c(shine), (x - 1.6) * u, (y - 1.6) * u, 1.8 * u);
  }
  function flower(g, c, u, x, y, col) {
    [0, 1, 2, 3, 4].forEach(k => disc(g, col, x + Math.cos(k * 1.257) * 1.1 * u, y + Math.sin(k * 1.257) * 1.1 * u, 0.8 * u));
    disc(g, c("--zap"), x, y, 0.6 * u);
  }

  function drawHills(g, S, c, rnd) {
    const u = S / 100;
    const P = (pts) => pts.map(([x, y]) => [x * u, y * u]);
    sky(g, S, [c("--c-sky"), c("--sl-cloud")]);
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      line(g, c("--c-amber"), 2.2 * u, () => { g.moveTo((78 + Math.cos(a) * 12) * u, (20 + Math.sin(a) * 12) * u); g.lineTo((78 + Math.cos(a) * 17) * u, (20 + Math.sin(a) * 17) * u); });
    }
    disc(g, c("--zap"), 78 * u, 20 * u, 9.5 * u);
    [[17, 14, 6], [50, 27, 5], [91, 44, 3.5]].forEach(([x, y, r]) => cloud(g, c("--sl-cloud"), x * u, y * u, r * u));
    birds(g, c("--c-slate"), u, [[38, 12], [44, 8], [60, 15]]);
    line(g, c("--c-brown"), 0.5 * u, () => { g.moveTo(23.5 * u, 39 * u); g.lineTo(25.5 * u, 44 * u); g.moveTo(30.5 * u, 39 * u); g.lineTo(28.5 * u, 44 * u); });
    oval(g, c("--c-red"), 27 * u, 36 * u, 5.5 * u, 6.5 * u);
    oval(g, c("--zap"), 27 * u, 36 * u, 2.2 * u, 6.5 * u);
    box(g, c("--c-brown"), 25.2 * u, 44 * u, 3.6 * u, 2.6 * u);
    poly(g, c("--c-indigo"), P([[0, 64], [16, 40], [30, 54], [48, 32], [66, 56], [84, 43], [100, 58], [100, 72], [0, 72]]));
    poly(g, c("--sl-cloud"), P([[16, 40], [12.4, 44.5], [16, 43.5], [19.4, 45.5]]));
    poly(g, c("--sl-cloud"), P([[48, 32], [43.6, 37.5], [47, 36.5], [49.5, 38.5], [52.6, 37]]));
    ridge(g, c("--c-lime"), S, 66 * u, 3 * u, 0.6);
    ridge(g, c("--c-green"), S, 78 * u, 4 * u, 2.6);
    line(g, c("--c-cyan"), 5 * u, () => { g.moveTo(60 * u, 68 * u); g.bezierCurveTo(44 * u, 77 * u, 74 * u, 86 * u, 50 * u, 101 * u); });
    ridge(g, c("--c-mint"), S, 93 * u, 2.5 * u, 4.2);
    box(g, c("--c-brown"), 22 * u, 64 * u, 2.6 * u, 6 * u);
    box(g, c("--sl-cloud"), 9 * u, 72 * u, 17 * u, 11 * u);
    poly(g, c("--c-red"), P([[7, 73], [17.5, 63], [28, 73]]));
    box(g, c("--c-brown"), 12 * u, 76 * u, 4.5 * u, 7 * u);
    box(g, c("--c-sky"), 19 * u, 75.5 * u, 4.5 * u, 4 * u);
    [[36, 79, "--c-teal", "--c-mint"], [84, 71, "--c-green", "--c-lime"], [94, 84, "--c-lime", "--c-gold"], [70, 91, "--c-green", "--c-lime"]].forEach(spec => tree(g, c, u, spec));
    const petals = ["--c-pink", "--c-red", "--c-violet", "--sl-cloud", "--c-orange"].map(c);
    for (let k = 0; k < 40; k++) flower(g, c, u, rnd() * S, (87 + rnd() * 12) * u, petals[k % petals.length]);
  }

  function drawSea(g, S, c, rnd) {
    const u = S / 100;
    const P = (pts) => pts.map(([x, y]) => [x * u, y * u]);
    sky(g, S, [c("--c-violet"), c("--c-pink"), c("--c-orange")]);
    disc(g, c("--zap"), 50 * u, 58 * u, 15 * u);
    [[18, 18, 4.5], [76, 12, 3.5], [90, 32, 2.5]].forEach(([x, y, r]) => cloud(g, c("--c-rose"), x * u, y * u, r * u));
    birds(g, c("--c-indigo"), u, [[30, 30], [36, 26], [64, 22]]);
    const sea = g.createLinearGradient(0, 58 * u, 0, S);
    [c("--c-cyan"), c("--c-blue"), c("--c-indigo")].forEach((col, i) => sea.addColorStop(i / 2, col));
    box(g, sea, 0, 58 * u, S, 42 * u);
    [0, 1, 2, 3, 4, 5].forEach(k => box(g, c("--zap"), (38 + k * 2) * u, (60 + k * 3) * u, (24 - k * 4) * u, 1.2 * u));
    for (let k = 0; k < 24; k++) {
      const x = rnd() * S;
      const y = (64 + rnd() * 34) * u;
      line(g, c("--sl-cloud"), 0.6 * u, () => g.arc(x, y, 2 * u, Math.PI * 1.15, Math.PI * 1.85));
    }
    oval(g, c("--c-gold"), 16 * u, 97 * u, 24 * u, 8 * u);
    line(g, c("--c-brown"), 1.8 * u, () => { g.moveTo(14 * u, 95 * u); g.quadraticCurveTo(12 * u, 82 * u, 19 * u, 73 * u); });
    [-2.6, -1.9, -1.1, -0.3, 0.4].forEach(a => oval(g, c("--c-green"), (19 + Math.cos(a) * 5) * u, (73 + Math.sin(a) * 3) * u, 6 * u, 1.7 * u, a));
    oval(g, c("--c-slate"), 86 * u, 98 * u, 14 * u, 6 * u);
    poly(g, c("--sl-cloud"), P([[81, 95], [83, 64], [89, 64], [91, 95]]));
    poly(g, c("--c-red"), P([[82.1, 72], [89.9, 72], [90.3, 78], [81.7, 78]]));
    poly(g, c("--c-red"), P([[81.3, 85], [90.7, 85], [91, 91], [81, 91]]));
    box(g, c("--c-red"), 82 * u, 60 * u, 8 * u, 4 * u);
    disc(g, c("--zap"), 86 * u, 58.5 * u, 2.4 * u);
    poly(g, c("--c-red"), P([[81.5, 58], [86, 52], [90.5, 58]]));
    poly(g, c("--c-red"), P([[30, 74], [48, 74], [45, 79], [33, 79]]));
    box(g, c("--c-brown"), 38.6 * u, 58 * u, 0.8 * u, 16 * u);
    poly(g, c("--sl-cloud"), P([[39.4, 59], [39.4, 73], [47, 73]]));
    poly(g, c("--c-amber"), P([[38.6, 61], [38.6, 73], [32, 73]]));
  }

  const MOTIFS = [
    (g, col, x, y, w) => disc(g, col, x + w / 2, y + w / 2, w * 0.34),
    (g, col, x, y, w, k) => disc(g, col, x + (k % 2) * w, y + Math.floor(k / 2) * w, w * 0.92),
    (g, col, x, y, w, k) => disc(g, col, x + [0.5, 1, 0.5, 0][k] * w, y + [0, 0.5, 1, 0.5][k] * w, w * 0.5),
    (g, col, x, y, w, k) => poly(g, col, [[x, y], [x + w, y], [x + w, y + w], [x, y + w]].filter((_, i) => i !== k)),
    (g, col, x, y, w) => poly(g, col, [[x + w / 2, y + w * 0.12], [x + w * 0.88, y + w / 2], [x + w / 2, y + w * 0.88], [x + w * 0.12, y + w / 2]]),
    (g, col, x, y, w, k) => [0, 1, 2].forEach(j => (k % 2 ? box(g, col, x + ((j * 2 + 0.5) * w) / 6, y, w / 6, w) : box(g, col, x, y + ((j * 2 + 0.5) * w) / 6, w, w / 6))),
    (g, col, x, y, w) => line(g, col, w * 0.14, () => g.arc(x + w / 2, y + w / 2, w * 0.3, 0, Math.PI * 2))
  ];
  function drawPattern(g, S, c, rnd) {
    const cells = 6;
    const w = S / cells;
    const colors = BRIGHT.map(c);
    for (let i = 0; i < cells * cells; i++) {
      const x = (i % cells) * w;
      const y = Math.floor(i / cells) * w;
      const a = Math.floor(rnd() * colors.length);
      const b = (a + 3 + Math.floor(rnd() * (colors.length - 6))) % colors.length;
      g.save();
      g.beginPath();
      g.rect(x, y, w, w);
      g.clip();
      box(g, colors[a], x, y, w, w);
      MOTIFS[Math.floor(rnd() * MOTIFS.length)](g, colors[b], x, y, w, Math.floor(rnd() * 4));
      g.restore();
    }
  }
  const SCENES = [drawHills, drawSea, drawPattern];

  /* Returns a data URL of the scene in the current theme (cached), or "" when the canvas is not available. */
  function pictureUrl(scene) {
    const css = getComputedStyle(document.documentElement);
    const colors = Object.fromEntries(ART_TOKENS.map(t => [t, css.getPropertyValue(t).trim()]));
    const key = `${scene}|${Object.values(colors).join(",")}`;
    if (art.key === key) return art.url;
    const canvas = document.createElement("canvas");
    canvas.width = PIC_PX;
    canvas.height = PIC_PX;
    const g = canvas.getContext("2d");
    if (!g) return "";
    try {
      SCENES[scene](g, PIC_PX, (t) => colors[t], seeded(17 + scene * 101));
      const url = canvas.toDataURL("image/jpeg", 0.9);
      art = { ...art, key, url };
      return url;
    } catch (e) {
      console.warn("slide: could not draw the picture", e);
      return "";
    }
  }

  /* ---------- board ---------- */
  function makeTile(v, n) {
    const t = document.createElement("div");
    const hx = (v - 1) % n;
    const hy = Math.floor((v - 1) / n);
    t.className = "slide-tile" + (v === n * n ? " slide-last" : "");
    t.dataset.v = String(v);
    t.style.setProperty("--hx", String(hx));
    t.style.setProperty("--hy", String(hy));
    t.style.setProperty("--k", String(hx + hy));
    t.style.setProperty("--d", `${Math.floor(Math.random() * 180)}ms`);
    t.innerHTML = `<span class="slide-face"><span class="slide-img"></span><b class="slide-num">${v}</b></span>`;
    if (v === n * n) t.setAttribute("aria-hidden", "true");
    return t;
  }
  function peekCell(v) {
    const s = document.createElement("span");
    s.className = "slide-peek-cell";
    s.innerHTML = `<b>${v}</b>`;
    return s;
  }
  function buildBoard(n, url) {
    el.tray.className = ["slide-tray", url ? "slide-mode-pic" : "slide-mode-num", !url || settings.labels ? "slide-labels" : "", "slide-intro"].filter(Boolean).join(" ");
    el.tray.style.setProperty("--n", String(n));
    if (url) el.tray.style.setProperty("--sl-img", `url("${url}")`);
    else el.tray.style.removeProperty("--sl-img");
    tileEls = Array.from({ length: n * n }, (_, k) => makeTile(k + 1, n));
    el.board.replaceChildren(...tileEls);
    el.peek.replaceChildren(...Array.from({ length: n * n - 1 }, (_, k) => peekCell(k + 1)));
    place(R.solved(n));
  }
  /* Moves every tile element to its square; the CSS transition animates the slide. */
  function place(arr) {
    const n = Math.round(Math.sqrt(arr.length));
    const movable = new Set(R.legalMoves(arr));
    arr.forEach((v, i) => {
      const t = tileEls[(v || n * n) - 1];
      t.style.transform = `translate(${(i % n) * 100}%, ${Math.floor(i / n) * 100}%)`;
      t.classList.toggle("slide-home", v !== 0 && v === i + 1);
      t.classList.toggle("slide-can", movable.has(i));
    });
  }

  /* ---------- input: tap, swipe, arrow keys ---------- */
  function onDown(e) {
    if (!canPlay() || (e.pointerType === "mouse" && e.button !== 0)) return;
    const tile = e.target.closest(".slide-tile");
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, value: tile ? Number(tile.dataset.v) : 0, done: false };
    try { el.board.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional: the swipe still works inside the board */ }
  }
  function onMove(e) {
    if (!pointer || pointer.id !== e.pointerId || pointer.done) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    if (Math.hypot(dx, dy) < SWIPE_PX) return;
    pointer = { ...pointer, done: true };
    swipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"), pointer.value);
  }
  function onUp(e) {
    if (!pointer || pointer.id !== e.pointerId) return;
    const p = pointer;
    pointer = null;
    if (!p.done && p.value && e.type === "pointerup") tap(p.value);
  }
  function onKey(e) {
    const dir = KEY_DIRS[e.key];
    if (!dir || !canPlay()) return;
    e.preventDefault();
    swipe(dir, 0);
  }
  function tap(value) {
    if (!canPlay()) return;
    const index = game.tiles.indexOf(value);
    if (index < 0) return;
    if (R.canSlide(game.tiles, index)) move(index);
    else refuse(tileEls[value - 1]);
  }
  /* A swipe moves the touched tile if it can go that way; otherwise the gap's neighbour that can. */
  function swipe(dir, value) {
    if (!canPlay()) return;
    const index = value ? game.tiles.indexOf(value) : -1;
    const target = index >= 0 && R.directionOf(game.tiles, index) === dir ? index : R.swipeIndex(game.tiles, dir);
    if (target >= 0) move(target);
    else refuse(null);
  }
  function refuse(tile) {
    thunk();
    if (tile) Fx.replay(tile.querySelector(".slide-face"), "slide-nope");
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    clearLater();
    resetClock();
    const n = settings.size;
    game = R.newGame(n);
    const url = settings.pic === "pic" ? pictureUrl(art.scene) : "";
    if (url) art = { ...art, scene: (art.scene + 1) % SCENES.length };
    buildBoard(n, url);
    ui = { phase: "play", busy: true, peek: false, result: null };
    Sound.sfx("confirm");
    if (Sound.ctx()) Music.play("think");
    render();
    Fx.pop(el.tray);
    const fast = reduced();
    later(() => el.tray.classList.remove("slide-intro"), fast ? 0 : INTRO.hide);
    later(() => { el.tray.classList.add("slide-scatter"); place(game.tiles); rattle(); }, fast ? 0 : INTRO.scatter);
    later(() => { finishIntro(); el.board.focus({ preventScroll: true }); }, fast ? 0 : INTRO.ready);
  }
  function finishIntro() {
    el.tray.classList.remove("slide-intro", "slide-scatter");
    place(game.tiles);
    ui = { ...ui, busy: false };
    render();
  }
  function move(index) {
    const before = R.homeCount(game.tiles);
    game = R.play(game, index);
    runClock();
    place(game.tiles);
    woodClick(game.last.count, R.homeCount(game.tiles) > before);
    el.moves.textContent = String(game.moves);
    if (game.solved) win();
  }
  function win() {
    pauseClock();
    const { ms, moves } = R.clampRecord(clock.base, game.moves);
    const out = R.addRecord(records, game.n, ms, moves);
    records = out.records;
    Store.save(REC_KEY, records);
    const record = !out.first && (out.newTime || out.newMoves);
    ui = { ...ui, phase: "done", peek: false, result: { first: out.first, newTime: out.newTime, newMoves: out.newMoves, record, shown: false } };
    Music.stop();
    el.tray.classList.remove("slide-peek-on");
    el.tray.classList.add("slide-won");
    render();
    later(() => { Sound.sfx("victory"); Fx.confetti(); }, WIN_SFX_MS);
    if (record) later(celebrate, RECORD_MS);
  }
  function celebrate() {
    ui = { ...ui, result: { ...ui.result, shown: true } };
    render();
    Sound.sfx("coin");
    Fx.pop(el.record);
    Fx.pop(el.title);
    Fx.confetti();
  }
  function toSetup() {
    clearLater();
    resetClock();
    Music.stop();
    ui = { phase: "setup", busy: false, peek: false, result: null };
    render();
  }
  function setPeek(on) {
    const want = Boolean(on) && ui.phase === "play" && !ui.busy;
    if (want === ui.peek) return;
    ui = { ...ui, peek: want };
    el.tray.classList.toggle("slide-peek-on", want);
    if (want) Sound.sfx("flip");
  }
  function peekButton() {
    const b = makeButton("長押しで完成図", (e) => {
      if (e.detail !== 0) return;
      setPeek(true);
      later(() => setPeek(false), PEEK_KEY_MS);
    }, "slide-peek-btn", ui.busy);
    b.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.button === 0) setPeek(true); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(type => b.addEventListener(type, () => setPeek(false)));
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }

  /* ---------- screens ---------- */
  const recordText = (r) => (r.newTime && r.newMoves ? "タイムも手数も自己ベスト更新！" : r.newTime ? "タイムが自己ベスト更新！" : "手数が自己ベスト更新！");
  const doneTitle = (r) => (r.record && r.shown ? "新記録！" : r.first ? "初クリア！" : "クリア！");
  const SCREENS = {
    setup: () => ({ actions: [flowButton("はじめる", start, "primary")] }),
    play: () => ({
      label: `${sizeLabel(game.n)}・${picMode() ? "絵" : "数字"}`,
      title: "",
      hint: ui.busy ? "シャッフル中…" : "空きマスと同じ行・列のタイルをタップ。スワイプでも動きます",
      actions: [flowButton("やめる", toSetup, "small"), peekButton()]
    }),
    done: () => ({
      label: `${sizeLabel(game.n)}・クリア`,
      title: doneTitle(ui.result),
      hint: ui.result.first ? "記録を残しました。次はこれをこえよう" : picMode() ? "1枚の絵が完成！" : "ぜんぶ順番にそろった！",
      actions: [flowButton("設定", toSetup, "small"), flowButton("もう一回", start, "primary")]
    })
  };

  function renderStats() {
    const r = ui.phase === "done" && ui.result.record && ui.result.shown ? ui.result : null;
    el.moves.textContent = String(game.moves);
    showTime();
    el.best.textContent = bestText(records[game.n]);
    el.timeBox.classList.toggle("slide-new", Boolean(r && r.newTime));
    el.movesBox.classList.toggle("slide-new", Boolean(r && r.newMoves));
    el.record.hidden = !r;
    el.record.textContent = r ? recordText(r) : "";
  }
  function renderSetup() {
    const n = settings.size;
    const rec = records[n];
    View.chips($("slSizeChips"), View.options(R.SIZES, sizeLabel), n, v => update({ size: v }));
    View.chips($("slPicChips"), [{ value: "num", label: "数字" }, { value: "pic", label: "絵" }], settings.pic, v => update({ pic: v }));
    View.chips($("slNumChips"), [{ value: true, label: "あり" }, { value: false, label: "なし" }], settings.labels, v => update({ labels: v }));
    $("slNumOpt").hidden = settings.pic !== "pic";
    el.setupBest.textContent = rec.ms === null ? `${sizeLabel(n)}はまだ記録なし` : `${sizeLabel(n)}の自己ベスト　${bestText(rec)}`;
    View.list($("slRules"), [
      `バラバラのタイルを、左上から1〜${n * n - 1}の順にそろえる。右下が空きマスになったら完成`,
      "空きマスと同じ行・同じ列のタイルをタップすると、空きに向かってすべる。間のタイルもいっしょに動く",
      "スワイプでも動かせる。動いたタイルの枚数が手数になる",
      "タイムは最初に動かした瞬間からスタート。「長押しで完成図」で、そろった形をのぞける",
      "絵柄を「絵」にすると、1枚の絵を完成させるパズルになる"
    ]);
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase !== "setup") renderStats();
  }

  function init() {
    settings = normalize(Store.load(KEY, null));
    records = R.normalizeRecords(Store.load(REC_KEY, null));
    art = { ...art, scene: Math.floor(Math.random() * SCENES.length) };
    el.board.addEventListener("pointerdown", onDown);
    el.board.addEventListener("pointermove", onMove);
    ["pointerup", "pointercancel"].forEach(type => el.board.addEventListener(type, onUp));
    el.board.addEventListener("keydown", onKey);
    el.board.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      pauseClock();
      setPeek(false);
    });
    render();
  }
  function onShow() {
    if (ui.phase === "play" && Sound.ctx()) Music.play("think");
  }
  function leave() {
    clearLater();
    pauseClock();
    setPeek(false);
    pointer = null;
    if (ui.phase === "play" && ui.busy) finishIntro();
    if (ui.phase === "done" && ui.result.record && !ui.result.shown) {
      ui = { ...ui, result: { ...ui.result, shown: true } };
      render();
    }
  }

  return { init, onShow, leave };
})();

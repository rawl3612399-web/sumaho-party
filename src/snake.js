/* Snake screen: speed and wall chips, a full-screen canvas board with smooth motion, swipe / d-pad / keys,
 * a fixed-timestep loop with pause, bonus stars, and best scores per speed. */
const Snake = (() => {
  const R = SnakeRules;
  const KEY = "snake.settings";
  const RECORD_KEY = "snake.records";
  const MAX_FRAME_MS = 250;
  const MAX_STEPS = 4;
  const CRASH_SHOW_MS = 1200;
  const WIN_SHOW_MS = 1800;
  const TOAST_MS = 1100;
  const SWIPE_PX = 20;
  const FRAME_PX = 12;
  const MAX_CELL = 40;
  const INTENSE_LEVEL = 5;
  const GOOD_SCORE = 25;
  const NOTES = [0, 2, 4, 7, 9, 12, 14, 16];
  const KEY_DIRS = { arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right", w: "up", s: "down", a: "left", d: "right" };
  const TOKENS = {
    board: "--card", alt: "--paper", ink: "--ink", body: "--c-lime", shine: "--snake-shine", eye: "--zap", pupil: "--on-zap",
    food: "--c-red", leaf: "--c-green", star: "--zap", timer: "--c-gold", alert: "--alert", font: "--body"
  };
  const IDLE = Object.freeze({ state: "idle", raf: 0, last: 0, acc: 0, moved: false, timer: 0, seq: 0, beat: false });
  const NO_FX = Object.freeze({ foodAt: 0, starAt: 0, parts: [], texts: [], rings: [], ghosts: [] });

  const el = {
    setup: $("snSetup"), play: $("snPlay"), label: $("snLabel"), title: $("snTitle"), card: $("snCard"),
    hint: $("snHint"), actions: $("snActions"), list: $("snList"), records: $("snRecords"),
    speedChips: $("snSpeedChips"), wallChips: $("snWallChips"), rules: $("snRules"),
    layer: $("snLayer"), field: $("snField"), canvas: $("snCanvas"), toast: $("snToast"),
    score: $("snScore"), length: $("snLength"), level: $("snLevel"), best: $("snBest"), pauseBtn: $("snPauseBtn"),
    paused: $("snPaused"), pausedSub: $("snPausedSub"), pausedActions: $("snPausedActions"), pad: $("snPad")
  };

  let settings = R.normalizeSettings(null);
  let records = R.normalizeRecords(null);
  let ui = { phase: "setup" };
  let game = null;
  let prev = null;
  let run = IDLE;
  let anim = NO_FX;
  let view = { cell: 0, w: 0, h: 0, dpr: 1 };
  let swipe = null;
  let result = null;
  let toastTimer = 0;

  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const interval = () => R.intervalMs(game.speed, game.snake.length);
  const center = (p) => ({ x: (p.x + 0.5) * view.cell, y: (p.y + 0.5) * view.cell });
  function colors() {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(Object.entries(TOKENS).map(([k, name]) => [k, css.getPropertyValue(name).trim()]));
  }

  /* ---------- sounds (built from the synth primitives; silent until audio is unlocked) ---------- */
  const hz = (m) => Sound.hz(m);
  const voice = (fn) => (...args) => { const c = Sound.ctx(); if (c) fn(c.currentTime, ...args); };
  const sndTurn = voice((t) => Sound.tone({ freq: 880, glide: 1040, glideTime: 0.03, type: "triangle", t, dur: 0.04, vol: 0.03 }));
  const sndEat = voice((t, n) => {
    const m = 76 + NOTES[(n - 1) % NOTES.length];
    Sound.tone({ freq: hz(m - 12), glide: hz(m), glideTime: 0.06, type: "sine", t, dur: 0.13, vol: 0.24 });
    Sound.tone({ freq: hz(m + 12), type: "triangle", t: t + 0.04, dur: 0.07, vol: 0.05 });
  });
  const sndStarNew = voice((t) => [0, 0.07, 0.14].forEach((d, i) =>
    Sound.tone({ freq: hz(91 + i * 4), type: "sine", t: t + d, dur: 0.14, vol: 0.07, send: 0.3 })));
  const sndStarGone = voice((t) => Sound.tone({ freq: hz(79), glide: hz(67), glideTime: 0.14, type: "triangle", t, dur: 0.16, vol: 0.06 }));
  const sndLevel = voice((t) => [72, 76, 79, 84].forEach((m, i) =>
    Sound.tone({ freq: hz(m), type: "square", t: t + i * 0.055, dur: 0.09, vol: 0.05, filter: { freq: 3200 } })));
  const sndCrash = voice((t) => {
    Sound.hiss({ t, dur: 0.45, vol: 0.5, type: "lowpass", freq: 3200, to: 160 });
    Sound.tone({ freq: 320, glide: 70, glideTime: 0.3, type: "square", t, dur: 0.36, vol: 0.12, filter: { freq: 1400 } });
    Sound.tone({ freq: 130, glide: 40, glideTime: 0.25, type: "sine", t, dur: 0.32, vol: 0.55 });
    Sound.vibrate([90, 40, 160]);
  });
  const sndPause = voice((t, on) => {
    const [a, b] = on ? [79, 72] : [72, 79];
    Sound.tone({ freq: hz(a), type: "triangle", t, dur: 0.08, vol: 0.09 });
    Sound.tone({ freq: hz(b), type: "triangle", t: t + 0.07, dur: 0.12, vol: 0.09 });
  });

  /* ---------- canvas drawing ---------- */
  function resize() {
    if (el.layer.hidden || !game) return;
    const box = el.field.getBoundingClientRect();
    const fit = Math.min((box.width - FRAME_PX) / game.cols, (box.height - FRAME_PX) / game.rows);
    const cell = Math.max(6, Math.min(MAX_CELL, Math.floor(fit)));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    view = { cell, w: cell * game.cols, h: cell * game.rows, dpr };
    el.canvas.style.width = `${view.w}px`;
    el.canvas.style.height = `${view.h}px`;
    el.canvas.width = Math.round(view.w * dpr);
    el.canvas.height = Math.round(view.h * dpr);
    draw(performance.now());
  }
  function circle(g, x, y, r) {
    g.beginPath();
    g.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  }
  /* 0 to 1 with a little overshoot, for things popping in. */
  function popIn(ms) {
    if (reduced()) return 1;
    const t = Math.min(1, Math.max(0, ms / 260)) - 1;
    return 1 + 2.7 * t * t * t + 1.7 * t * t;
  }
  function drawBoard(g, c) {
    g.fillStyle = c.board;
    g.fillRect(0, 0, view.w, view.h);
    g.fillStyle = c.alt;
    for (let y = 0; y < game.rows; y++) {
      for (let x = y % 2; x < game.cols; x += 2) g.fillRect(x * view.cell, y * view.cell, view.cell, view.cell);
    }
  }
  function drawApple(g, c, p, scale) {
    const r = view.cell * 0.38 * scale;
    if (r <= 0.5) return;
    const { x, y } = center(p);
    g.lineWidth = Math.max(1.5, view.cell * 0.08);
    g.strokeStyle = c.ink;
    g.fillStyle = c.leaf;
    g.beginPath();
    g.ellipse(x + r * 0.4, y - r * 1.05, r * 0.5, r * 0.24, -0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.food;
    circle(g, x, y + r * 0.08, r);
    g.fill();
    g.stroke();
    g.globalAlpha = 0.6;
    g.fillStyle = c.shine;
    circle(g, x - r * 0.35, y - r * 0.25, r * 0.24);
    g.fill();
    g.globalAlpha = 1;
  }
  function starPath(g, x, y, outer, rot) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? outer * 0.46 : outer;
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
  }
  function drawStarShape(g, c, p, scale, rot, faint) {
    const { x, y } = center(p);
    starPath(g, x, y, view.cell * 0.5 * scale, rot);
    g.globalAlpha = faint ? 0.35 : 1;
    g.fillStyle = c.star;
    g.fill();
    g.lineWidth = Math.max(1.5, view.cell * 0.07);
    g.strokeStyle = c.ink;
    g.stroke();
    g.globalAlpha = 1;
  }
  function drawItems(g, c, now, alpha) {
    anim.ghosts.forEach(h => {
      const k = 1 - (now - h.born) / h.life;
      if (h.kind === "food") drawApple(g, c, h, k);
      else drawStarShape(g, c, h, k, 0, false);
    });
    const pulse = reduced() ? 1 : 1 + 0.06 * Math.sin(now / 160);
    if (game.food) drawApple(g, c, game.food, popIn(now - anim.foodAt) * pulse);
    const b = game.bonus;
    if (!b) return;
    const ratio = Math.max(0, (b.left - (run.moved && !game.over ? alpha : 0)) / b.total);
    const urgent = ratio < 0.3;
    const { x, y } = center(b);
    g.lineWidth = Math.max(2, view.cell * 0.1);
    g.strokeStyle = urgent ? c.alert : c.timer;
    g.beginPath();
    g.arc(x, y, view.cell * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    g.stroke();
    const blink = urgent && !reduced() && Math.floor(now / 120) % 2 === 0;
    drawStarShape(g, c, b, popIn(now - anim.starAt), reduced() ? 0 : now / 900, blink);
  }

  /* Smooth motion: the head slides from its last cell into the new one; the tail slides out of its old cell. */
  const wrapDelta = (d, n) => (d > 1 ? d - n : d < -1 ? d + n : d);
  const seam = (d, n) => (d > 1.5 ? -n : d < -1.5 ? n : 0);
  function lerpCell(from, to, t) {
    const dx = wrapDelta(to.x - from.x, game.cols);
    const dy = wrapDelta(to.y - from.y, game.rows);
    return { x: to.x - dx * (1 - t), y: to.y - dy * (1 - t) };
  }
  function snakePoints(alpha) {
    const s = game.snake;
    if (alpha >= 1 || !prev) return s;
    const tail = s.length > prev.length ? [] : [lerpCell(prev[prev.length - 1], s[s.length - 1], alpha)];
    return [lerpCell(s[1], s[0], alpha), ...s.slice(1), ...tail];
  }
  /* One path through the points; a jump across a wrapped edge is drawn on both sides. */
  function tracePath(g, pts) {
    const at = (p) => center(p);
    g.beginPath();
    g.moveTo(at(pts[0]).x, at(pts[0]).y);
    pts.slice(1).forEach((b, i) => {
      const a = pts[i];
      const sx = seam(b.x - a.x, game.cols);
      const sy = seam(b.y - a.y, game.rows);
      const end = at({ x: b.x + sx, y: b.y + sy });
      g.lineTo(end.x, end.y);
      if (!sx && !sy) return;
      const start = at({ x: a.x - sx, y: a.y - sy });
      g.moveTo(start.x, start.y);
      g.lineTo(at(b).x, at(b).y);
    });
  }
  function copies(p) {
    const xs = [p.x, ...(p.x < 0 ? [p.x + game.cols] : p.x > game.cols - 1 ? [p.x - game.cols] : [])];
    const ys = [p.y, ...(p.y < 0 ? [p.y + game.rows] : p.y > game.rows - 1 ? [p.y - game.rows] : [])];
    return xs.flatMap(x => ys.map(y => ({ x, y })));
  }
  function drawSnake(g, c, alpha, now) {
    const pts = snakePoints(alpha);
    const w = view.cell * 0.72;
    const edge = Math.max(2, view.cell * 0.12);
    g.lineCap = "round";
    g.lineJoin = "round";
    tracePath(g, pts);
    [[c.ink, w + edge * 2, 1], [c.body, w, 1], [c.shine, w * 0.26, 0.35]].forEach(([color, width, a]) => {
      g.globalAlpha = a;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.stroke();
    });
    g.globalAlpha = 1;
    copies(pts[0]).forEach(p => drawHead(g, c, p, now));
  }
  function drawTongue(g, c, x, y, d) {
    const k = view.cell;
    const tip = { x: x + d.x * k * 0.74, y: y + d.y * k * 0.74 };
    const side = { x: -d.y * k * 0.11, y: d.x * k * 0.11 };
    g.strokeStyle = c.alert;
    g.lineWidth = Math.max(1.5, k * 0.07);
    g.beginPath();
    g.moveTo(x + d.x * k * 0.4, y + d.y * k * 0.4);
    g.lineTo(tip.x, tip.y);
    [1, -1].forEach(s => {
      g.moveTo(tip.x, tip.y);
      g.lineTo(tip.x + d.x * k * 0.1 + side.x * s, tip.y + d.y * k * 0.1 + side.y * s);
    });
    g.stroke();
  }
  function drawEye(g, c, x, y, d, dead) {
    const r = view.cell * 0.17;
    g.strokeStyle = c.ink;
    g.lineWidth = Math.max(1, view.cell * 0.05);
    if (dead) {
      g.lineWidth = Math.max(1.5, view.cell * 0.07);
      g.beginPath();
      [[-1, -1, 1, 1], [-1, 1, 1, -1]].forEach(([a, b, e, f]) => { g.moveTo(x + a * r, y + b * r); g.lineTo(x + e * r, y + f * r); });
      g.stroke();
      return;
    }
    g.fillStyle = c.eye;
    circle(g, x, y, r);
    g.fill();
    g.stroke();
    g.fillStyle = c.pupil;
    circle(g, x + d.x * r * 0.4, y + d.y * r * 0.4, r * 0.5);
    g.fill();
  }
  function drawHead(g, c, p, now) {
    const d = R.DIRS[game.dir];
    const { x, y } = center(p);
    const k = view.cell;
    if (!game.over && !reduced() && now % 1800 < 220) drawTongue(g, c, x, y, d);
    g.fillStyle = c.body;
    g.strokeStyle = c.ink;
    g.lineWidth = Math.max(2, k * 0.12);
    circle(g, x, y, k * 0.47);
    g.fill();
    g.stroke();
    const dead = game.over && !game.won;
    [-1, 1].forEach(s => drawEye(g, c, x + (d.x * 0.14 - d.y * s * 0.22) * k, y + (d.y * 0.14 + d.x * s * 0.22) * k, d, dead));
  }
  function drawEffects(g, c, now) {
    const alive = (f) => now - f.born < f.life;
    anim = { ...anim, parts: anim.parts.filter(alive), texts: anim.texts.filter(alive), rings: anim.rings.filter(alive), ghosts: anim.ghosts.filter(alive) };
    anim.rings.forEach(r => {
      const t = (now - r.born) / r.life;
      g.globalAlpha = 1 - t;
      g.strokeStyle = c[r.color];
      g.lineWidth = Math.max(2, view.cell * 0.14) * (1 - t);
      circle(g, r.x, r.y, view.cell * (0.4 + t * 1.5));
      g.stroke();
    });
    anim.parts.forEach(p => {
      const s = (now - p.born) / 1000;
      const k = 1 - (now - p.born) / p.life;
      g.globalAlpha = k;
      g.fillStyle = c[p.color];
      circle(g, p.x + p.vx * s, p.y + p.vy * s + 260 * s * s, p.size * k + 0.5);
      g.fill();
    });
    g.font = `900 ${Math.round(view.cell * 0.85)}px ${c.font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    anim.texts.forEach(tx => {
      const k = (now - tx.born) / tx.life;
      const y = tx.y - (reduced() ? 0 : k * view.cell * 1.3);
      g.globalAlpha = 1 - k * k;
      g.lineWidth = view.cell * 0.2;
      g.strokeStyle = c.board;
      g.strokeText(tx.text, tx.x, y);
      g.fillStyle = c.ink;
      g.fillText(tx.text, tx.x, y);
    });
    g.globalAlpha = 1;
  }
  function progress() {
    return !run.moved || game.over ? 1 : Math.min(1, run.acc / interval());
  }
  function draw(now) {
    if (!game || !view.cell) return;
    const g = el.canvas.getContext("2d");
    const c = colors();
    const alpha = progress();
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawBoard(g, c);
    drawItems(g, c, now, alpha);
    drawSnake(g, c, alpha, now);
    drawEffects(g, c, now);
  }

  /* ---------- effects ---------- */
  function burst(cellPos, color, count, now) {
    const at = center(cellPos);
    if (!reduced()) {
      const parts = Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const v = view.cell * (3 + Math.random() * 4);
        return { x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - view.cell * 2, size: view.cell * (0.12 + Math.random() * 0.12), color, born: now, life: 520 };
      });
      anim = { ...anim, parts: [...anim.parts, ...parts], rings: [...anim.rings, { ...at, color, born: now, life: 420 }] };
    }
  }
  function floatText(cellPos, text, now) {
    anim = { ...anim, texts: [...anim.texts, { ...center(cellPos), text, born: now, life: 700 }] };
  }
  function ghost(kind, cellPos, now) {
    anim = { ...anim, ghosts: [...anim.ghosts, { kind, x: cellPos.x, y: cellPos.y, born: now, life: interval() }] };
  }
  function toast(text, cls = "", ms = TOAST_MS) {
    clearTimeout(toastTimer);
    el.toast.textContent = text;
    el.toast.className = `snake-toast ${cls}`.trim();
    el.toast.hidden = false;
    Fx.replay(el.toast, "snake-toast-in");
    toastTimer = ms ? setTimeout(() => { el.toast.hidden = true; }, ms) : 0;
  }

  /* ---------- HUD ---------- */
  function renderHud(bump = false) {
    if (!game) return;
    const best = records[game.speed].score;
    el.score.textContent = String(game.score);
    el.length.textContent = String(game.snake.length);
    el.level.textContent = String(R.levelFor(game.snake.length));
    el.best.textContent = String(Math.max(best, game.score));
    el.best.parentElement.classList.toggle("snake-beat", best > 0 && game.score > best);
    if (bump) Fx.pop(el.score);
  }
  function setRun(patch) {
    run = { ...run, ...patch };
    el.layer.dataset.state = run.state;
    el.paused.hidden = run.state !== "paused";
    el.pauseBtn.disabled = run.state !== "run" && run.state !== "paused";
    el.pauseBtn.setAttribute("aria-label", run.state === "paused" ? "つづける" : "一時停止");
  }

  /* ---------- loop: fixed steps, drawn every frame ---------- */
  function startLoop() {
    if (!run.raf) run = { ...run, last: performance.now(), raf: requestAnimationFrame(frame) };
  }
  function stopLoop() {
    cancelAnimationFrame(run.raf);
    run = { ...run, raf: 0 };
  }
  function frame(now) {
    run = { ...run, raf: 0 };
    if (el.layer.hidden || !game) return;
    const dt = run.state === "run" ? Math.min(Math.max(0, now - run.last), MAX_FRAME_MS) : 0;
    run = { ...run, last: now, acc: run.acc + dt };
    for (let n = 0; n < MAX_STEPS && run.state === "run" && run.acc >= interval(); n++) {
      run = { ...run, acc: run.acc - interval() };
      advance();
    }
    if (run.state === "run") run = { ...run, acc: Math.min(run.acc, interval()) };
    draw(now);
    if (["ready", "run", "over"].includes(run.state)) run = { ...run, raf: requestAnimationFrame(frame) };
  }
  function advance() {
    prev = game.snake;
    game = R.step(game, Math.random);
    run = { ...run, moved: true };
    react(performance.now());
  }
  function react(now) {
    const ev = game.events;
    const head = game.snake[0];
    if (ev.includes("eat")) {
      sndEat(game.eaten);
      ghost("food", head, now);
      burst(head, "food", 10, now);
      floatText(head, "+1", now);
      anim = { ...anim, foodAt: now };
    }
    if (ev.includes("bonus")) {
      Sound.sfx("coin");
      ghost("star", head, now);
      burst(head, "star", 16, now);
      floatText(head, `+${R.BONUS_POINTS}`, now);
    }
    if (ev.includes("bonus-gone")) sndStarGone();
    if (ev.includes("bonus-new")) { anim = { ...anim, starAt: now }; sndStarNew(); }
    if (ev.includes("level")) levelUp();
    if (ev.includes("eat") || ev.includes("bonus")) scored();
    if (ev.includes("crash")) crashed(now);
    if (ev.includes("win")) wonGame();
  }
  function scored() {
    renderHud(true);
    const best = records[game.speed].score;
    if (run.beat || best === 0 || game.score <= best) return;
    run = { ...run, beat: true };
    toast("ベスト更新中！", "snake-good");
  }
  function levelUp() {
    sndLevel();
    toast("スピードアップ！");
    if (R.levelFor(game.snake.length) >= INTENSE_LEVEL) Music.intensify();
  }

  /* ---------- flow ---------- */
  function openLayer() {
    document.activeElement?.blur?.();
    el.layer.hidden = false;
    el.layer.classList.toggle("snake-wrap", game.wrap);
    document.body.classList.add("arena-open");
    el.toast.hidden = true;
    resize();
  }
  function closeLayer() {
    stopLoop();
    clearTimeout(run.timer);
    clearTimeout(toastTimer);
    setRun({ state: "idle", timer: 0 });
    el.layer.hidden = true;
    document.body.classList.remove("arena-open");
    swipe = null;
    anim = NO_FX;
  }
  async function start() {
    Sound.ensure();
    Awake.keep();
    Music.stop();
    clearTimeout(run.timer);
    game = R.newGame({ speed: settings.speed, wrap: settings.wrap });
    prev = null;
    result = null;
    const now = performance.now();
    anim = { ...NO_FX, foodAt: now, starAt: now };
    const seq = run.seq + 1;
    run = { ...IDLE, seq };
    setRun({ state: "ready" });
    Sound.sfx("confirm");
    go("play");
    openLayer();
    renderHud();
    startLoop();
    await Fx.countdown("スタート！");
    begin(seq);
  }
  function begin(seq) {
    if (run.seq !== seq || run.state !== "ready" || el.layer.hidden) return;
    if (document.hidden) {
      showPaused();
      return;
    }
    setRun({ state: "run", last: performance.now() });
    Music.play("draw");
    if (R.levelFor(game.snake.length) >= INTENSE_LEVEL) Music.intensify();
    startLoop();
  }
  function showPaused() {
    stopLoop();
    setRun({ state: "paused" });
    el.pausedSub.textContent = `スコア ${game.score}・長さ ${game.snake.length}`;
    draw(performance.now());
  }
  function pause() {
    if (run.state !== "run") return;
    Music.stop();
    sndPause(true);
    showPaused();
  }
  async function resume() {
    if (run.state !== "paused") return;
    Sound.ensure();
    sndPause(false);
    setRun({ state: "ready" });
    startLoop();
    const seq = run.seq;
    await Fx.countdown("つづき！", 2);
    begin(seq);
  }
  function togglePause() {
    if (run.state === "run") pause();
    else if (run.state === "paused") resume();
  }
  function crashed(now) {
    setRun({ state: "over" });
    Music.stop();
    sndCrash();
    Fx.shake(el.field);
    Fx.flash("--alert", 380);
    burst(game.snake[0], "alert", 14, now);
    toast(game.cause === "wall" ? "壁にぶつかった！" : "体にぶつかった！", "snake-bad", 0);
    run = { ...run, timer: setTimeout(() => finish(document.hidden), CRASH_SHOW_MS) };
  }
  function wonGame() {
    setRun({ state: "over" });
    Music.stop();
    Sound.sfx("fanfare");
    toast("盤面を埋めつくした！", "snake-good", 0);
    run = { ...run, timer: setTimeout(() => finish(document.hidden), WIN_SHOW_MS) };
  }
  /* quiet: save and show the result without sound or confetti (leaving the game, or the tab is hidden). */
  function finish(quiet) {
    if (!game) return;
    const res = R.applyRecord(records, game.speed, game.score, game.snake.length);
    records = res.records;
    Store.save(RECORD_KEY, records);
    result = {
      score: game.score, length: game.snake.length, eaten: game.eaten, bonuses: game.bonuses, level: R.levelFor(game.snake.length),
      won: game.won, speed: game.speed, wrap: game.wrap, isNew: res.isNew, previous: res.previous
    };
    closeLayer();
    go("result");
    if (quiet) return;
    Fx.pop(el.card);
    if (result.isNew || result.won) {
      Sound.sfx("victory");
      Fx.confetti();
    } else Sound.sfx(result.score >= GOOD_SCORE ? "fanfare" : "lose");
  }
  function quit() {
    Music.stop();
    closeLayer();
    go("setup");
  }

  /* ---------- input ---------- */
  function input(dir) {
    if (!game || (run.state !== "run" && run.state !== "ready")) return;
    const next = R.turn(game, dir);
    if (next === game) return;
    game = next;
    sndTurn();
  }
  function flashKey(dir) {
    const b = el.pad.querySelector(`[data-dir="${dir}"]`);
    if (b) Fx.replay(b, "snake-hit");
  }
  function onKey(e) {
    if (el.layer.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = (e.key || "").toLowerCase();
    if ((k === " " || k === "enter") && e.target.closest?.("button")) return;
    const dir = KEY_DIRS[k];
    if (dir) {
      e.preventDefault();
      input(dir);
      flashKey(dir);
    } else if (k === " " || k === "p") {
      e.preventDefault();
      if (!e.repeat) togglePause();
    } else if (k === "escape") {
      e.preventDefault();
      if (run.state === "paused") quit(); else pause();
    } else if (k === "enter" && run.state === "paused") {
      e.preventDefault();
      resume();
    }
  }
  function onDown(e) {
    if (e.target.closest("button") || (run.state !== "run" && run.state !== "ready")) return;
    e.preventDefault();
    try { el.field.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onMove(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    swipe = { ...swipe, x: e.clientX, y: e.clientY };
    const dir = R.dirFromDelta(dx, dy);
    if (dir) input(dir);
  }
  function onUp(e) {
    if (swipe && e.pointerId === swipe.id) swipe = null;
  }
  function bindControls() {
    el.field.addEventListener("pointerdown", onDown);
    el.field.addEventListener("pointermove", onMove);
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(t => el.field.addEventListener(t, onUp));
    el.pad.querySelectorAll("[data-dir]").forEach(b => {
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); input(b.dataset.dir); Fx.replay(b, "snake-hit"); });
      b.addEventListener("click", (e) => { if (e.detail === 0) input(b.dataset.dir); });
    });
    el.layer.addEventListener("contextmenu", (e) => e.preventDefault());
    el.pauseBtn.addEventListener("pointerdown", (e) => e.preventDefault());
    el.pauseBtn.addEventListener("click", togglePause);
    el.pausedActions.replaceChildren(makeButton("やめる", quit, "small"), makeButton("つづける", resume, "primary"));
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
    window.addEventListener("blur", pause);
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(el.field);
    else window.addEventListener("resize", resize);
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => draw(performance.now()));
  }

  /* ---------- screens ---------- */
  function update(patch) {
    settings = R.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(phase) {
    ui = { phase };
    render();
  }
  function resultHint() {
    if (result.won) return "全部のマスを埋めた、完ぺきなプレイ！";
    if (result.isNew) return result.previous > 0 ? `これまでの記録は${result.previous}点。みごと更新！` : "はじめての記録！ 次はこれを超えよう";
    const best = records[result.speed].score;
    return `自己ベストは${best}点。あと${best - result.score + 1}点で新記録！`;
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: () => ({ label: "プレイ中", title: "", hint: "", actions: [] }),
    result: () => {
      const rank = R.rankFor(result.score);
      return {
        label: `結果　${R.SPEEDS[result.speed].label}${result.wrap ? "・すりぬけ" : ""}`,
        title: result.won ? "クリア！" : result.isNew ? "新記録！" : rank,
        card: { main: `${result.score}点`, sub: result.won || result.isNew ? rank : `長さ ${result.length}マス`, cls: "number snake-score" },
        hint: resultHint(),
        actions: [makeButton("設定", () => go("setup"), "small"), makeButton("もう一回", start, "primary")]
      };
    }
  };
  function rulesFor(s) {
    return [
      "スワイプ、画面の矢印ボタン、矢印キー（WASD）で向きを変える",
      `エサを食べると1点、体が1マスのびる。${R.FOODS_PER_LEVEL}個ごとにスピードアップ`,
      `ときどき出る星は+${R.BONUS_POINTS}点。数秒で消えるので急いで`,
      s.wrap ? "壁はすりぬけて反対側から出てくる。自分の体にぶつかったら終わり" : "壁か自分の体にぶつかったら終わり",
      "盤面をぜんぶ埋めたらクリア。スペースキーか右上のボタンで一時停止"
    ];
  }
  function renderSetup() {
    View.chips(el.speedChips, R.SPEED_IDS.map(id => ({ value: id, label: R.SPEEDS[id].label })), settings.speed, v => update({ speed: v }));
    View.chips(el.wallChips, R.WALL_OPTIONS.map(o => ({ value: o.value, label: o.label })), settings.wrap, v => update({ wrap: v }));
    View.list(el.rules, rulesFor(settings));
  }
  function renderRecords() {
    const show = ui.phase === "setup";
    el.records.hidden = !show;
    if (!show) return;
    const head = document.createElement("p");
    head.className = "snake-recs-head";
    head.textContent = "自己ベスト";
    el.records.replaceChildren(head, ...R.SPEED_IDS.map(id => {
      const cell = document.createElement("div");
      cell.className = id === settings.speed ? "snake-rec on" : "snake-rec";
      cell.innerHTML = "<span></span><b></b><small>点</small>";
      cell.querySelector("span").textContent = R.SPEEDS[id].label;
      cell.querySelector("b").textContent = String(records[id].score);
      return cell;
    }));
  }
  function renderDetails() {
    const show = ui.phase === "result" && !!result;
    el.list.hidden = !show;
    if (!show) return;
    const rows = [
      ["ランク", R.rankFor(result.score), "snake-wide"], ["長さ", `${result.length}マス`], ["スピード", `${result.level}`],
      ["エサ", `${result.eaten}個`], ["星", `${result.bonuses}個`], ["自己ベスト", `${records[result.speed].score}点`, "snake-wide"]
    ];
    el.list.replaceChildren(...rows.map(([k, v, cls]) => {
      const li = document.createElement("li");
      if (cls) li.className = cls;
      li.innerHTML = "<span></span><b></b>";
      li.querySelector("span").textContent = k;
      li.querySelector("b").textContent = v;
      return li;
    }));
  }
  function render() {
    const p = ui.phase;
    el.setup.hidden = p !== "setup";
    el.play.hidden = p === "setup";
    if (p === "setup") renderSetup();
    View.stage(el, SCREENS[p]());
    renderDetails();
    renderRecords();
  }

  function init() {
    settings = R.normalizeSettings(Store.load(KEY, null));
    records = R.normalizeRecords(Store.load(RECORD_KEY, null));
    bindControls();
    setRun({ state: "idle" });
    render();
  }
  function leave() {
    if (run.state === "over") finish(true);
    else if (!el.layer.hidden) quit();
  }

  return { init, leave };
})();

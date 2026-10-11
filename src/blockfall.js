/* Falling-block puzzle screen: setup and results on the stage; play in a full-screen layer with a canvas field,
 * hold and next previews, a thumb pad with auto-repeat, swipe gestures on the field and keyboard keys. */
const Blockfall = (() => {
  const B = BlockfallRules;
  const KEY = "blockfall.settings";
  const RECORD_KEY = "blockfall.records";
  const MAX_DT = 50;
  const OVER_MS = 1700;
  const DPR_MAX = 3;
  const HERO_CELL = 18;
  const SLOT_GAP = 8;
  const GRAVITY_PX = 900;
  const KEY_MIN = 48;
  const KEY_MAX = 72;
  const COLORS = Object.freeze({ I: "--c-cyan", J: "--c-blue", L: "--c-orange", O: "--c-amber", S: "--c-green", T: "--c-purple", Z: "--c-red" });
  const KEYMAP = Object.freeze({
    ArrowLeft: "left", ArrowRight: "right", ArrowDown: "soft", ArrowUp: "rotr", x: "rotr", X: "rotr",
    z: "rotl", Z: "rotl", " ": "hard", c: "hold", C: "hold", Shift: "hold"
  });
  const HERO = Object.freeze(["....TTT...", ".....T....", "..........", "I.......OO", "IJJ.SS.LOO", "IJ.SSZZLLL"]);
  const IDLE = Object.freeze({ left: false, right: false, dir: 0, since: 0, last: 0, soft: false });

  const el = {
    setup: $("bfSetup"), play: $("bfPlay"), label: $("bfLabel"), title: $("bfTitle"), card: $("bfCard"),
    hint: $("bfHint"), actions: $("bfActions"), details: $("bfDetails"), hero: $("bfHero"),
    levelChips: $("bfLevelChips"), best: $("bfBest"), rules: $("bfRules"),
    layer: $("bfLayer"), pauseBtn: $("bfPause"), score: $("bfScore"), level: $("bfLevel"), lines: $("bfLines"),
    hold: $("bfHold"), next: $("bfNext"), bestNum: $("bfBestNum"), well: $("bfWell"), field: $("bfField"),
    callout: $("bfCallout"), pauseBox: $("bfPauseBox"), pauseActions: $("bfPauseActions"), pad: $("bfPad"), toNext: $("bfToNext")
  };

  let settings = B.normalizeSettings(null);
  let records = B.normalizeRecords(null);
  let ui = { phase: "setup", result: null };
  let game = null;
  let run = { mode: "off", token: 0, raf: 0, last: 0, overAt: 0, playMs: 0, intense: false };
  let input = IDLE;
  let touch = null;
  let fx = [];
  let view = { cell: 20, dpr: 1, mini: 11, miniW: 52, slot: 32, key: KEY_MIN, hud: "", minis: "" };
  let sprites = {};

  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (n) => n.toLocaleString("ja-JP");
  const bestOf = (lv) => records[String(lv)].score;

  /* ---------- sounds ---------- */
  const tone = (o) => Sound.tone(o);
  const SFX = {
    move: () => tone({ freq: 360, type: "triangle", dur: 0.035, vol: 0.06 }),
    rotate: () => tone({ freq: 560, glide: 840, glideTime: 0.05, type: "triangle", dur: 0.07, vol: 0.06 }),
    land: () => tone({ freq: 180, glide: 110, type: "sine", dur: 0.07, vol: 0.14 }),
    lock: () => {
      tone({ freq: 240, glide: 130, glideTime: 0.04, type: "square", dur: 0.06, vol: 0.045, filter: { freq: 1400 } });
      Sound.hiss({ dur: 0.035, vol: 0.09, type: "bandpass", freq: 3200, q: 1.2 });
    },
    hard: () => {
      tone({ freq: 160, glide: 42, glideTime: 0.14, type: "sine", dur: 0.2, vol: 0.34 });
      Sound.hiss({ dur: 0.1, vol: 0.14, type: "lowpass", freq: 2200, to: 260 });
    },
    clear: (n) => {
      const c = Sound.ctx();
      if (!c) return;
      const t = c.currentTime;
      [76, 79, 84, 88].slice(0, n + 1).forEach((m, i) =>
        tone({ freq: Sound.hz(m), type: "square", t: t + i * 0.06, dur: 0.18, vol: 0.055, filter: { freq: 3800 }, send: 0.22 }));
      Sound.hiss({ t, dur: 0.32, vol: 0.07, type: "highpass", freq: 2500, to: 7000 });
    },
    level: () => {
      const c = Sound.ctx();
      if (!c) return;
      const t = c.currentTime + 0.28;
      [72, 76, 79, 84, 88].forEach((m, i) => tone({ freq: Sound.hz(m), type: "triangle", t: t + i * 0.05, dur: 0.25, vol: 0.08, send: 0.3 }));
    }
  };

  /* ---------- drawing ---------- */
  function palette() {
    const css = getComputedStyle(document.documentElement);
    const get = (name) => css.getPropertyValue(name).trim();
    return {
      card: get("--card"), line: get("--line"), muted: get("--muted"), alert: get("--alert"),
      shine: get("--bf-shine"), shade: get("--bf-shade"), flash: get("--bf-flash"), other: get("--c-slate"),
      piece: Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, get(v)]))
    };
  }
  const colorOf = (pal, type) => pal.piece[type] || pal.other;
  function rounded(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }
  function size(canvas, w, h, dpr) {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  /* One block (color, top shine, bottom shade), drawn once per color and size and reused. */
  function sprite(color, s, dpr, pal) {
    const key = `${color}|${s}|${dpr}|${pal.shine}|${pal.shade}`;
    if (sprites[key]) return sprites[key];
    const c = document.createElement("canvas");
    c.width = c.height = Math.max(1, Math.round(s * dpr));
    const g = c.getContext("2d");
    g.scale(c.width / s, c.height / s);
    const pad = Math.max(0.75, s * 0.05);
    const w = s - pad * 2;
    rounded(g, pad, pad, w, w, s * 0.2);
    g.clip();
    g.fillStyle = color;
    g.fillRect(0, 0, s, s);
    g.fillStyle = pal.shade;
    g.fillRect(0, pad + w * 0.76, s, s);
    g.fillStyle = pal.shine;
    g.fillRect(0, 0, s, pad + w * 0.26);
    sprites = Object.keys(sprites).length > 80 ? { [key]: c } : { ...sprites, [key]: c };
    return c;
  }

  function drawGrid(g, pal, s) {
    g.strokeStyle = pal.line;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < B.WIDTH; x++) { g.moveTo(x * s + 0.5, 0); g.lineTo(x * s + 0.5, B.HEIGHT * s); }
    for (let y = 1; y < B.HEIGHT; y++) { g.moveTo(0, y * s + 0.5); g.lineTo(B.WIDTH * s, y * s + 0.5); }
    g.stroke();
  }
  function drawCells(g, cells, color, pal, alpha) {
    const s = view.cell;
    g.globalAlpha = alpha;
    cells.filter(([, y]) => y >= B.HIDDEN).forEach(([x, y]) => g.drawImage(sprite(color, s, view.dpr, pal), x * s, (y - B.HIDDEN) * s, s, s));
    g.globalAlpha = 1;
  }
  function drawStack(g, now, pal) {
    const progress = run.mode === "over" ? Math.min(1, (now - run.overAt) / 900) : 0;
    const grayFrom = B.ROWS - Math.floor(progress * B.HEIGHT);
    for (let y = B.HIDDEN; y < B.ROWS; y++) {
      const row = game.board[y];
      const cells = row.map((v, x) => [x, y, v]).filter(c => c[2] !== null);
      cells.forEach(([x, , v]) => drawCells(g, [[x, y]], y >= grayFrom ? pal.muted : colorOf(pal, v), pal, 1));
    }
  }
  function drawGhost(g, pal) {
    const gh = B.ghostOf(game);
    if (!gh || gh.y === game.active.y) return;
    const s = view.cell;
    g.strokeStyle = g.fillStyle = colorOf(pal, gh.type);
    g.lineWidth = Math.max(1.5, s * 0.08);
    B.cellsOf(gh).filter(([, y]) => y >= B.HIDDEN).forEach(([x, y]) => {
      rounded(g, x * s + 2.5, (y - B.HIDDEN) * s + 2.5, s - 5, s - 5, s * 0.16);
      g.globalAlpha = 0.14;
      g.fill();
      g.globalAlpha = 0.75;
      g.stroke();
    });
    g.globalAlpha = 1;
  }
  function drawDanger(g, now, pal) {
    if (B.stackHeight(game.board) <= B.HEIGHT - 5) return;
    g.globalAlpha = reduced() ? 0.1 : 0.08 + 0.06 * Math.sin(now / 160);
    g.fillStyle = pal.alert;
    g.fillRect(0, 0, B.WIDTH * view.cell, B.HEIGHT * view.cell);
    g.globalAlpha = 1;
  }

  const FX_DRAW = {
    row: (g, f, p, pal) => {
      const s = view.cell;
      g.globalAlpha = 1 - p;
      g.fillStyle = pal.flash;
      g.fillRect(0, f.y * s + (s * p) / 2, B.WIDTH * s, s * (1 - p));
    },
    flash: (g, f, p, pal) => drawCells(g, f.cells, pal.shine, pal, 1 - p),
    trail: (g, f, p) => {
      const s = view.cell;
      g.globalAlpha = 0.28 * (1 - p);
      g.fillStyle = f.color;
      f.cols.forEach(c => g.fillRect(c.x * s + s * 0.15, c.top * s, s * 0.7, Math.max(0, c.bottom - c.top) * s));
    },
    spark: (g, f, p) => {
      const t = (p * f.dur) / 1000;
      g.globalAlpha = 1 - p;
      g.fillStyle = f.color;
      g.fillRect(f.x + f.vx * t, f.y + f.vy * t + 0.5 * GRAVITY_PX * t * t, f.size, f.size);
    }
  };
  function drawFx(g, now, pal) {
    fx.forEach(f => FX_DRAW[f.kind](g, f, Math.min(1, (now - f.t0) / f.dur), pal));
    g.globalAlpha = 1;
  }

  function drawField(now, pal) {
    const g = el.field.getContext("2d");
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.fillStyle = pal.card;
    g.fillRect(0, 0, B.WIDTH * view.cell, B.HEIGHT * view.cell);
    drawDanger(g, now, pal);
    drawGrid(g, pal, view.cell);
    drawStack(g, now, pal);
    if (game.active && run.mode !== "over") {
      drawGhost(g, pal);
      drawCells(g, B.cellsOf(game.active), colorOf(pal, game.active.type), pal, 1 - 0.35 * Math.min(1, game.lockTimer / B.LOCK_MS));
    }
    drawFx(g, now, pal);
  }

  function drawMiniPiece(g, type, top, pal, alpha) {
    const m = view.mini;
    const cells = B.cells(type, 0);
    const xs = cells.map(c => c[0]);
    const ys = cells.map(c => c[1]);
    const ox = (view.miniW - (Math.max(...xs) - Math.min(...xs) + 1) * m) / 2 - Math.min(...xs) * m;
    const oy = top + (view.slot - (Math.max(...ys) - Math.min(...ys) + 1) * m) / 2 - Math.min(...ys) * m;
    g.globalAlpha = alpha;
    cells.forEach(([x, y]) => g.drawImage(sprite(colorOf(pal, type), m, view.dpr, pal), ox + x * m, oy + y * m, m, m));
    g.globalAlpha = 1;
  }
  function drawMinis(pal) {
    const next = B.nextPieces(game);
    const key = `${game.hold}|${game.canHold}|${next.join("")}|${pal.piece.T}|${view.mini}`;
    if (key === view.minis) return;
    view = { ...view, minis: key };
    const h = el.hold.getContext("2d");
    h.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    h.clearRect(0, 0, view.miniW, view.slot);
    if (game.hold) drawMiniPiece(h, game.hold, 0, pal, game.canHold ? 1 : 0.35);
    const n = el.next.getContext("2d");
    n.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    n.clearRect(0, 0, view.miniW, (view.slot + SLOT_GAP) * B.NEXT_COUNT);
    next.forEach((type, i) => drawMiniPiece(n, type, i * (view.slot + SLOT_GAP), pal, i === 0 ? 1 : 0.8));
  }

  function renderHud() {
    const record = bestOf(settings.startLevel);
    const best = Math.max(record, game.score);
    const key = `${game.score}|${game.level}|${game.lines}|${best}`;
    if (key === view.hud) return;
    view = { ...view, hud: key };
    el.score.textContent = fmt(game.score);
    el.level.textContent = String(game.level);
    el.lines.textContent = String(game.lines);
    el.bestNum.textContent = fmt(best);
    el.bestNum.classList.toggle("beat", record > 0 && game.score > record);
    el.toNext.textContent = `あと${B.LINES_PER_LEVEL - (game.lines % B.LINES_PER_LEVEL)}`;
  }

  function draw(now) {
    if (!game || el.layer.hidden) return;
    const pal = palette();
    if (run.mode !== "pause") {
      fx = fx.filter(f => now - f.t0 < f.dur);
      drawField(now, pal);
    }
    drawMinis(pal);
    renderHud();
  }

  function drawHero() {
    const s = HERO_CELL;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    size(el.hero, B.WIDTH * s, HERO.length * s, dpr);
    const pal = palette();
    const g = el.hero.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    HERO.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ".") g.drawImage(sprite(colorOf(pal, ch), s, dpr, pal), x * s, y * s, s, s);
    }));
  }

  /* Sizes the field to the space left; spare height on tall phones goes to bigger pad keys. */
  function fit() {
    if (el.layer.hidden) return;
    const h = el.well.clientHeight - 8 + 2 * (view.key - KEY_MIN);
    const { cell, key } = B.fitLayout(el.well.clientWidth - 8, h, KEY_MIN, KEY_MAX);
    el.pad.style.setProperty("--bf-key", `${key}px`);
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    const miniW = Math.max(30, el.hold.parentElement.clientWidth);
    const mini = Math.max(6, Math.min(12, Math.floor((miniW - 6) / 4)));
    view = { ...view, cell, dpr, mini, miniW, key, slot: mini * 2 + 10, minis: "", hud: "" };
    sprites = {};
    size(el.field, cell * B.WIDTH, cell * B.HEIGHT, dpr);
    size(el.hold, miniW, view.slot, dpr);
    size(el.next, miniW, view.slot * B.NEXT_COUNT + SLOT_GAP * (B.NEXT_COUNT - 1), dpr);
    if (game) draw(performance.now());
  }

  /* ---------- game events (sound, effects, callouts) ---------- */
  function callout(main, sub, cls) {
    const parts = [document.createTextNode(main)];
    if (sub) {
      const small = document.createElement("small");
      small.textContent = sub;
      parts.push(small);
    }
    el.callout.replaceChildren(...parts);
    el.callout.className = `blockfall-callout ${cls}`;
    Fx.replay(el.callout, "on");
  }
  function sparks(e, now) {
    if (reduced()) return [];
    const s = view.cell;
    const pal = palette();
    return e.rows.flatMap((y, i) => e.colors[i].map((type, x) => ({
      kind: "spark", t0: now, dur: 550 + Math.random() * 300, size: s * 0.26, color: colorOf(pal, type),
      x: x * s + s * 0.37, y: (y - B.HIDDEN) * s + s * 0.37, vx: (Math.random() - 0.5) * 260, vy: -80 - Math.random() * 240
    })));
  }
  function onClear(e, now) {
    const rows = e.rows.map(y => ({ kind: "row", y: y - B.HIDDEN, t0: now, dur: 420 }));
    fx = [...fx, ...rows, ...sparks(e, now)];
    Fx.pop(el.score);
    if (e.count === 4) {
      Sound.sfx("fanfare");
      Sound.vibrate([30, 40, 60]);
      Fx.flash("--zap", 320);
    } else SFX.clear(e.count);
  }
  function onHard(e, now) {
    SFX.hard();
    Sound.vibrate(12);
    if (reduced() || e.dist < 1) return;
    fx = [...fx, { kind: "trail", t0: now, dur: 240, cols: B.trailColumns(e.to, e.dist), color: colorOf(palette(), e.to.type) }];
  }
  const ON = {
    move: () => SFX.move(),
    rotate: () => SFX.rotate(),
    land: () => SFX.land(),
    hold: () => { Sound.sfx("flip"); Fx.pop(el.hold.parentElement); },
    hard: onHard,
    lock: (e, now) => { SFX.lock(); fx = [...fx, { kind: "flash", cells: e.cells, t0: now, dur: 170 }]; },
    clear: onClear,
    level: () => SFX.level(),
    over: () => gameOver()
  };
  function announce(events) {
    const clear = events.find(e => e.kind === "clear");
    const level = events.find(e => e.kind === "level");
    if (level && B.isIntense(game) && !run.intense) {
      Music.intensify();
      run = { ...run, intense: true };
    }
    if (!clear || (clear.count < 2 && !level)) return;
    const sub = level ? `レベル${level.level}！` : `+${fmt(clear.points)}`;
    if (clear.count === 4) callout("4ライン！", sub, "big");
    else if (clear.count >= 2) callout(`${clear.count}ライン！`, sub, level ? "level" : "");
    else callout("レベルアップ！", `レベル${level.level}`, "level");
  }
  function apply(next) {
    game = next;
    const now = performance.now();
    next.events.forEach(e => { if (ON[e.kind]) ON[e.kind](e, now); });
    announce(next.events);
  }

  /* ---------- input ---------- */
  const ONE_SHOT = {
    rotr: () => B.rotate(game, 1), rotl: () => B.rotate(game, -1),
    hard: () => B.hardDrop(game), hold: () => B.hold(game)
  };
  /* During the countdown a held direction is remembered (it auto-repeats once play starts); nothing moves yet. */
  function press(act) {
    const live = run.mode === "play";
    if (!live && run.mode !== "count") return;
    const now = performance.now();
    if (act === "left" || act === "right") {
      const d = act === "left" ? -1 : 1;
      input = { ...input, [act]: true, dir: d, since: now, last: now };
      if (live) apply(B.move(game, d));
    } else if (act === "soft") {
      input = { ...input, soft: true };
      if (live) apply(B.softStep(game));
    } else if (live && ONE_SHOT[act]) apply(ONE_SHOT[act]());
  }
  function release(act) {
    if (act === "soft") { input = { ...input, soft: false }; return; }
    if (act !== "left" && act !== "right") return;
    const d = act === "left" ? -1 : 1;
    const other = act === "left" ? "right" : "left";
    const held = { ...input, [act]: false };
    const now = performance.now();
    if (input.dir !== d) input = held;
    else input = held[other] ? { ...held, dir: -d, since: now, last: now } : { ...held, dir: 0 };
  }
  function autoRepeat(now) {
    if (!B.repeatDue(input, now)) return;
    input = { ...input, last: now };
    apply(B.move(game, input.dir));
  }

  function onFieldDown(e) {
    if (run.mode !== "play") return;
    e.preventDefault();
    try { el.well.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ax: e.clientX, ay: e.clientY, t0: performance.now(), moved: false };
  }
  function onFieldMove(e) {
    if (!touch || e.pointerId !== touch.id || run.mode !== "play") return;
    const s = view.cell;
    const totalX = e.clientX - touch.x0;
    const totalY = e.clientY - touch.y0;
    const cols = Math.trunc((e.clientX - touch.ax) / s);
    const rows = Math.abs(totalY) > Math.abs(totalX) ? Math.max(0, Math.trunc((e.clientY - touch.ay) / s)) : 0;
    for (let i = 0; i < Math.abs(cols); i++) apply(B.move(game, Math.sign(cols)));
    for (let i = 0; i < rows; i++) apply(B.softStep(game));
    touch = { ...touch, ax: touch.ax + cols * s, ay: touch.ay + rows * s, moved: touch.moved || Math.hypot(totalX, totalY) > B.TAP_PX };
  }
  /* Tap = rotate (left half turns left), quick swipe down = hard drop, quick swipe up = hold. */
  function onFieldUp(e) {
    if (!touch || e.pointerId !== touch.id) return;
    const t = touch;
    touch = null;
    if (run.mode !== "play" || e.type === "pointercancel") return;
    const kind = B.swipe({ dx: e.clientX - t.x0, dy: e.clientY - t.y0, dt: performance.now() - t.t0, moved: t.moved, cell: view.cell });
    if (kind === "tap") {
      const box = el.well.getBoundingClientRect();
      press(e.clientX < box.left + box.width / 2 ? "rotl" : "rotr");
    } else if (kind) press(kind);
  }

  function onKeyDown(e) {
    if (run.mode === "off") return;
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      e.preventDefault();
      togglePause();
      return;
    }
    const act = KEYMAP[e.key];
    if (!act || (run.mode !== "play" && run.mode !== "count")) return;
    e.preventDefault();
    if (!e.repeat) press(act);
  }
  function onKeyUp(e) {
    const act = KEYMAP[e.key];
    if (act && run.mode !== "off") release(act);
  }

  function bindPad() {
    el.pad.querySelectorAll("[data-act]").forEach(b => {
      const act = b.dataset.act;
      const up = () => { b.classList.remove("is-down"); release(act); };
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
        b.classList.add("is-down");
        press(act);
      });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => b.addEventListener(type, up));
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    el.pad.addEventListener("click", (e) => e.stopPropagation());
  }

  /* ---------- flow ---------- */
  function stopLoop() {
    cancelAnimationFrame(run.raf);
    run = { ...run, raf: 0 };
  }
  function startLoop() {
    if (!run.raf) run = { ...run, last: performance.now(), raf: requestAnimationFrame(frame) };
  }
  function frame(now) {
    const dt = Math.min(Math.max(now - run.last, 0), MAX_DT);
    run = { ...run, last: now, raf: requestAnimationFrame(frame) };
    if (run.mode === "play") {
      autoRepeat(now);
      apply(B.tick(game, dt, input.soft));
      run = { ...run, playMs: run.playMs + dt };
    }
    if (run.mode === "over" && now - run.overAt >= OVER_MS) {
      finish();
      return;
    }
    draw(now);
  }
  function openLayer() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    el.layer.hidden = false;
    document.body.classList.add("arena-open");
    el.callout.className = "blockfall-callout";
    renderPause();
    fit();
  }
  function closeLayer() {
    el.layer.hidden = true;
    el.pauseBox.hidden = true;
    document.body.classList.remove("arena-open");
  }

  async function start() {
    Sound.ensure();
    Awake.keep();
    stopLoop();
    const token = run.token + 1;
    game = B.newGame(settings.startLevel);
    fx = [];
    input = IDLE;
    touch = null;
    run = { mode: "count", token, raf: 0, last: performance.now(), overAt: 0, playMs: 0, intense: false };
    go("play");
    openLayer();
    Sound.sfx("confirm");
    startLoop();
    await Fx.countdown("スタート！");
    if (run.token !== token || run.mode !== "count") return;
    run = { ...run, mode: "play", last: performance.now() };
    Music.play("rush");
    if (document.hidden) pause();
  }
  function gameOver() {
    if (run.mode === "over") return;
    run = { ...run, mode: "over", overAt: performance.now() };
    input = IDLE;
    touch = null;
    Music.stop();
    Sound.sfx("lose");
    Fx.shake(el.well);
    Fx.flash("--alert", 420);
    callout("ゲームオーバー", "", "over");
  }
  /* Keeps the score if it beats the best for this start level; returns what the result screen shows. */
  function saveResult() {
    const result = { score: game.score, lines: game.lines, level: game.level };
    const res = B.applyRecord(records, settings.startLevel, result);
    records = res.records;
    Store.save(RECORD_KEY, records);
    return { ...result, quads: game.quads, playMs: run.playMs, isNew: res.isNew, previous: res.previous.score };
  }
  function finish() {
    if (run.mode === "off" || !game) return;
    stopLoop();
    Music.stop();
    const result = saveResult();
    closeLayer();
    run = { ...run, mode: "off" };
    ui = { phase: "result", result };
    render();
    Fx.pop(el.card);
    const token = run.token;
    setTimeout(() => {
      if (run.token !== token || ui.phase !== "result") return;
      if (result.isNew) { Sound.sfx("victory"); Fx.confetti(); } else Sound.sfx("reveal");
    }, 300);
  }

  /* Paused: no frame loop runs; the pause box covers the field until play resumes. */
  function pause() {
    if (run.mode !== "play") return;
    stopLoop();
    run = { ...run, mode: "pause" };
    input = IDLE;
    touch = null;
    Music.stop();
    Sound.sfx("back");
    renderPause();
  }
  function resume() {
    if (run.mode !== "pause") return;
    run = { ...run, mode: "play" };
    Sound.sfx("select");
    Music.play("rush");
    if (run.intense) Music.intensify();
    renderPause();
    startLoop();
    draw(performance.now());
  }
  /* The window lost focus (another app, a call, devtools): keys may never report key-up, so drop them and pause. */
  function onBlur() {
    input = IDLE;
    touch = null;
    pause();
  }
  const togglePause = () => (run.mode === "pause" ? resume() : pause());
  function renderPause() {
    el.pauseBox.hidden = run.mode !== "pause";
    el.pauseBtn.setAttribute("aria-label", run.mode === "pause" ? "つづける" : "一時停止");
    el.pauseBtn.dataset.paused = String(run.mode === "pause");
    el.pauseActions.replaceChildren(makeButton("つづける", resume, "primary"), makeButton("やめて結果を見る", finish, "small"));
  }

  /* ---------- stage screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: () => ({ label: "プレイ中", actions: [] }),
    result: () => {
      const r = ui.result;
      return {
        label: r.isNew ? "新記録！" : "結果",
        title: B.rankFor(r.score),
        card: { main: fmt(r.score), sub: "スコア", cls: `blockfall-scorecard${r.isNew ? " new" : ""}` },
        hint: B.bestNote(r),
        actions: [makeButton("設定", () => go("setup"), "small"), makeButton("もう一回", start, "primary")]
      };
    }
  };
  function renderDetails() {
    const show = ui.phase === "result";
    el.details.hidden = !show;
    if (!show) return;
    const r = ui.result;
    const rows = [["ライン", String(r.lines)], ["レベル", String(r.level)], ["4ライン消し", `${r.quads}回`], ["プレイ時間", View.clock(Math.round(r.playMs / 1000))]];
    el.details.replaceChildren(...rows.map(([k, v]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="k"></span><span class="v"></span>`;
      li.querySelector(".k").textContent = k;
      li.querySelector(".v").textContent = v;
      return li;
    }));
  }
  function renderSetup() {
    View.chips(el.levelChips, View.options(B.START_LEVELS, n => `レベル${n}`), settings.startLevel, v => update({ startLevel: v }));
    const best = bestOf(settings.startLevel);
    const num = document.createElement("b");
    num.textContent = best ? `${fmt(best)}点` : "まだなし";
    el.best.replaceChildren(document.createTextNode("自己ベスト"), num);
    View.list(el.rules, [
      "落ちてくるブロックを動かして回し、横一列をそろえると消える",
      "まとめて消すほど高得点。4列いっぺんで800点×レベル",
      "10列消すごとにレベルアップ。どんどん速くなる",
      "画面を左右になぞると移動、タップで回転、下にはらうと一気に落とす。上にはらうとホールド",
      "上まで積み上がったらおしまい。キーボードなら矢印・Z・X・スペース・C"
    ]);
    drawHero();
  }

  function update(patch) {
    settings = B.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(phase) {
    ui = { ...ui, phase };
    render();
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    renderDetails();
  }

  function init() {
    settings = B.normalizeSettings(Store.load(KEY, null));
    records = B.normalizeRecords(Store.load(RECORD_KEY, null));
    bindPad();
    el.well.addEventListener("pointerdown", onFieldDown);
    el.well.addEventListener("pointermove", onFieldMove);
    el.well.addEventListener("pointerup", onFieldUp);
    el.well.addEventListener("pointercancel", onFieldUp);
    el.well.addEventListener("contextmenu", (e) => e.preventDefault());
    /* No focus on press, so Space (hard drop) can never also click this button. */
    el.pauseBtn.addEventListener("pointerdown", (e) => e.preventDefault());
    el.pauseBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePause(); });
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
    window.addEventListener("blur", onBlur);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(el.well);
    else window.addEventListener("resize", fit);
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (ui.phase === "setup") drawHero(); });
    render();
  }
  function onShow() {
    if (ui.phase === "setup") render();
  }
  /* Leaving mid-game drops it; leaving on the game-over screen still keeps the score. Pending result sounds are cancelled. */
  function leave() {
    if (run.mode === "off") {
      run = { ...run, token: run.token + 1 };
      return;
    }
    const result = run.mode === "over" && game ? saveResult() : null;
    stopLoop();
    run = { ...run, mode: "off", token: run.token + 1 };
    input = IDLE;
    touch = null;
    fx = [];
    closeLayer();
    ui = result ? { phase: "result", result } : { phase: "setup", result: null };
    render();
  }

  return { init, onShow, leave };
})();

/* Odd-color hunt screen: one tile on the grid is slightly lighter or darker; tap it. 60 seconds, wrong taps cost 3 seconds.
 * Tile colors are the game content, so they come from the rules as rgb() values instead of tokens (the one exception). */
const ColorHunt = (() => {
  const R = ColorHuntRules;
  const RECORD_KEY = "colorhunt.records";
  const URGENT_SEC = 10;
  const TICK_SEC = 5;
  const OVER_MS = 1500;
  const HIT_LOCK_MS = 110;
  const BURST_MS = 480;
  const CLICK_AFTER_TAP_MS = 600;
  const SCALE = [0, 2, 4, 7, 9];
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  /* lost: penalty time really taken off the clock (a miss with under 3 seconds left only takes what is left). */
  const FRESH_CLOCK = Object.freeze({ endAt: 0, left: R.ROUND_MS, raf: 0, lastSec: null, urgent: false, lost: 0 });
  const BOARD_PHASES = ["ready", "play", "over"];
  const HUD_PHASES = ["ready", "play", "paused", "over"];

  const el = {
    mode: $("modeColorHunt"), stage: $("chStage"), setup: $("chSetup"), play: $("chPlay"),
    label: $("chLabel"), title: $("chTitle"), card: $("chCard"), hint: $("chHint"), actions: $("chActions"),
    best: $("chBest"), rules: $("chRules"), hud: $("chHud"), time: $("chTime"),
    score: $("chScore"), size: $("chSize"), bar: $("chBar"), float: $("chFloat"), pause: $("chPause"),
    wrap: $("chWrap"), board: $("chBoard"), fx: $("chFx"), stats: $("chStats")
  };

  let records = { best: 0 };
  let ui = { phase: "setup" };
  let run = R.newRun();
  let board = null;
  let tiles = [];
  let clock = FRESH_CLOCK;
  let result = null;
  let session = 0;
  let lockUntil = 0;
  let overTimer = 0;
  let keyboard = false;
  let pointerAt = -Infinity;

  /* ---------- sounds (built from the synth primitives; silent until audio is unlocked) ---------- */
  const hz = (m) => Sound.hz(m);
  const voice = (fn) => (...args) => { const c = Sound.ctx(); if (c) fn(c.currentTime, ...args); };
  /* Correct: a bubbly pop that climbs the pentatonic scale with every hit in a row (two octaves at most). */
  const sndHit = voice((t, streak) => {
    const step = Math.min(Math.max(streak - 1, 0), 10);
    const m = 72 + SCALE[step % SCALE.length] + 12 * Math.floor(step / SCALE.length);
    Sound.tone({ freq: hz(m - 7), glide: hz(m), glideTime: 0.045, type: "sine", t, dur: 0.17, vol: 0.24 });
    Sound.tone({ freq: hz(m + 12), type: "triangle", t: t + 0.03, dur: 0.14, vol: 0.05, send: 0.25 });
  });
  /* The grid got bigger: a quick sparkle on top of the pop. */
  const sndGrow = voice((t) => [79, 84, 88, 91].forEach((m, i) =>
    Sound.tone({ freq: hz(m), type: "triangle", t: t + 0.08 + i * 0.045, dur: 0.22, vol: 0.06, send: 0.3 })));
  /* Wrong: a short low thud with a buzz. */
  const sndMiss = voice((t) => {
    Sound.tone({ freq: 190, glide: 70, glideTime: 0.18, type: "square", t, dur: 0.22, vol: 0.09, filter: { freq: 900 } });
    Sound.tone({ freq: 95, glide: 50, type: "sine", t, dur: 0.2, vol: 0.35 });
  });

  /* ---------- clock ---------- */
  function runClock() {
    cancelAnimationFrame(clock.raf);
    clock = { ...clock, raf: requestAnimationFrame(frame) };
  }
  function stopClock() {
    cancelAnimationFrame(clock.raf);
    clock = { ...clock, raf: 0 };
  }
  function showClock() {
    const sec = Math.ceil(clock.left / 1000);
    el.time.textContent = String(sec);
    el.bar.style.transform = `scaleX(${Math.max(0, clock.left) / R.ROUND_MS})`;
    el.hud.classList.toggle("colorhunt-urgent", sec <= URGENT_SEC);
    return sec;
  }
  function onSecond(sec) {
    clock = { ...clock, lastSec: sec };
    if (sec <= URGENT_SEC && !clock.urgent) {
      clock = { ...clock, urgent: true };
      Music.intensify();
    }
    if (sec > 0 && sec <= TICK_SEC) Sound.sfx("tick", sec % 2 === 0);
  }
  function frame() {
    clock = { ...clock, left: Math.max(0, clock.endAt - performance.now()) };
    const sec = showClock();
    if (sec !== clock.lastSec) onSecond(sec);
    if (clock.left <= 0) {
      timeUp();
      return;
    }
    clock = { ...clock, raf: requestAnimationFrame(frame) };
  }

  /* ---------- board ---------- */
  function buildTiles(size) {
    const focused = tiles.indexOf(document.activeElement);
    tiles = Array.from({ length: size * size }, (_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "colorhunt-tile";
      b.dataset.i = String(i);
      b.setAttribute("aria-label", `${Math.floor(i / size) + 1}行${(i % size) + 1}列`);
      return b;
    });
    el.board.style.setProperty("--n", String(size));
    el.board.replaceChildren(...tiles);
    if (focused >= 0) tiles[Math.min(focused, tiles.length - 1)].focus();
  }
  function paintBoard() {
    const size = board ? board.size : R.sizeFor(0);
    if (tiles.length !== size * size) buildTiles(size);
    const colors = board ? [R.toCss(board.base), R.toCss(board.odd)] : ["", ""];
    tiles.forEach((t, i) => {
      t.classList.remove("colorhunt-miss", "colorhunt-answer");
      t.style.background = board && i === board.oddIndex ? colors[1] : colors[0];
    });
    el.board.classList.remove("colorhunt-done");
  }
  function nextBoard(score, prev) {
    try {
      return R.makeBoard(score, Math.random, prev);
    } catch (e) {
      console.error("colorhunt: board generation failed, retrying", e);
      return R.makeBoard(score, Math.random, null);
    }
  }
  function burst(index) {
    const tile = tiles[index];
    if (!tile) return;
    const box = el.fx.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    const ring = document.createElement("span");
    ring.className = "colorhunt-burst";
    Object.assign(ring.style, {
      left: `${r.left - box.left + r.width / 2}px`, top: `${r.top - box.top + r.height / 2}px`, width: `${r.width}px`, height: `${r.height}px`
    });
    el.fx.appendChild(ring);
    setTimeout(() => ring.remove(), BURST_MS);
  }
  function paintHud() {
    el.score.textContent = String(run.score);
    const size = board ? board.size : R.sizeFor(0);
    el.size.textContent = `${size}×${size}`;
  }

  /* ---------- flow ---------- */
  function go(phase) {
    ui = { phase };
    render();
  }
  async function start(e) {
    Sound.ensure();
    Awake.keep();
    Sound.sfx("confirm");
    keyboard = Boolean(e && e.detail === 0);
    stopClock();
    clearTimeout(overTimer);
    session += 1;
    const mine = session;
    run = R.newRun();
    board = null;
    result = null;
    clock = FRESH_CLOCK;
    go("ready");
    await Fx.countdown("スタート！");
    if (mine !== session || ui.phase !== "ready") return;
    begin();
  }
  function begin() {
    board = nextBoard(0, null);
    clock = { ...FRESH_CLOCK, endAt: performance.now() + R.ROUND_MS };
    Music.play("rush");
    go("play");
    Fx.pop(el.board);
    if (keyboard && tiles[0]) tiles[0].focus();
    runClock();
    if (document.hidden) pause();
  }
  function pick(index) {
    if (ui.phase !== "play" || !board || performance.now() < lockUntil) return;
    if (!Number.isInteger(index) || index < 0 || index >= tiles.length) return;
    const res = R.tap(run, board, index);
    run = res.run;
    if (res.correct) onHit(index); else onMiss(index);
  }
  function onHit(index) {
    const grew = R.sizeUp(run.score);
    sndHit(run.streak);
    if (grew) sndGrow();
    burst(index);
    lockUntil = performance.now() + HIT_LOCK_MS;
    board = nextBoard(run.score, board);
    paintBoard();
    paintHud();
    Fx.replay(el.score, "colorhunt-bump");
    if (grew) {
      Fx.pop(el.board);
      Fx.replay(el.size, "colorhunt-bump");
    } else Fx.replay(el.board, "colorhunt-in");
  }
  function onMiss(index) {
    sndMiss();
    Sound.vibrate(60);
    const lost = Math.min(R.PENALTY_MS, Math.max(0, clock.endAt - performance.now()));
    clock = { ...clock, endAt: clock.endAt - R.PENALTY_MS, lost: clock.lost + lost };
    [[tiles[index], "colorhunt-miss"], [el.wrap, "colorhunt-shake"], [el.float, "colorhunt-rise"], [el.time, "colorhunt-hurt"]]
      .forEach(([node, cls]) => Fx.replay(node, cls));
  }
  function timeUp() {
    stopClock();
    clock = { ...clock, left: 0 };
    Music.stop();
    Sound.sfx("buzz");
    const rec = R.applyRecord(records, run.score);
    records = rec.records;
    Store.save(RECORD_KEY, records);
    result = { ...R.summary(run, Math.max(0, R.ROUND_MS - clock.lost)), rank: R.rankFor(run.score), next: R.nextRank(run.score), isNew: rec.isNew, previous: rec.previous };
    go("over");
    if (board) {
      el.board.classList.add("colorhunt-done");
      tiles[board.oddIndex]?.classList.add("colorhunt-answer");
    }
    overTimer = setTimeout(showResult, OVER_MS);
  }
  function showResult() {
    if (ui.phase !== "over") return;
    go("result");
    Fx.pop(el.card);
    if (result.isNew) {
      Sound.sfx("victory");
      Fx.confetti();
    } else Sound.sfx(result.score >= R.RANKS[3].min ? "fanfare" : "reveal");
  }
  function pause() {
    if (ui.phase !== "play") return;
    stopClock();
    clock = { ...clock, left: Math.max(0, clock.endAt - performance.now()) };
    Music.stop();
    go("paused");
  }
  function resume() {
    if (ui.phase !== "paused") return;
    Sound.ensure();
    clock = { ...clock, endAt: performance.now() + clock.left };
    Music.play("rush");
    if (clock.urgent) Music.intensify();
    Sound.sfx("go");
    go("play");
    Fx.pop(el.board);
    if (keyboard && tiles[0]) tiles[0].focus();
    runClock();
  }
  function quit() {
    session += 1;
    stopClock();
    clearTimeout(overTimer);
    Music.stop();
    go("setup");
  }

  /* ---------- screens ---------- */
  function resultHint() {
    const n = result.next;
    return n ? `${result.rank.note}。あと${n.need}ステージで${n.title}` : `${result.rank.note}。最高ランク！`;
  }
  const PLAY_HINT = "色が1つだけちがうマスをタップ！";
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    ready: () => ({ hint: PLAY_HINT, actions: [] }),
    play: () => ({ hint: PLAY_HINT, actions: [] }),
    paused: () => ({
      label: "一時停止", title: "ひと休み中", hint: "つづけると、すぐにタイマーが動きます",
      actions: [makeButton("やめる", quit, "small"), makeButton("つづける", resume, "primary")]
    }),
    over: () => ({ hint: "タイムアップ！ 正解はこのマス", actions: [] }),
    result: () => ({
      label: "色彩感覚ランク",
      title: result.rank.title,
      card: {
        main: String(result.score),
        sub: result.isNew ? "ステージ　新記録！" : "ステージ クリア",
        cls: result.isNew ? "number colorhunt-score colorhunt-new" : "number colorhunt-score"
      },
      hint: resultHint(),
      actions: [makeButton("設定", () => go("setup"), "small"), makeButton("もう一回", start, "primary")]
    })
  };

  function statCell(label, value, note = "") {
    const cell = document.createElement("div");
    cell.className = "colorhunt-cell";
    const parts = [["span", label], ["b", value], ["small", note]].filter(([, text]) => text !== "");
    cell.append(...parts.map(([tag, text]) => Object.assign(document.createElement(tag), { textContent: text })));
    return cell;
  }
  function renderStats() {
    const show = ui.phase === "result" && result !== null;
    el.stats.hidden = !show;
    if (!show) return;
    const r = result;
    const penalty = (r.misses * R.PENALTY_MS) / 1000;
    el.stats.replaceChildren(
      statCell("正解率", r.accuracy === null ? "—" : `${r.accuracy}%`, `ミス${r.misses}回（−${penalty}秒）`),
      statCell("1ステージ平均", r.avgSec === null ? "—" : `${r.avgSec.toFixed(1)}秒`),
      statCell("最高れんぞく", `${r.bestStreak}回`),
      r.isNew ? statCell("前の記録", r.previous > 0 ? String(r.previous) : "なし") : statCell("自己ベスト", String(records.best))
    );
  }
  function renderSetup() {
    const best = records.best;
    View.text(el.best, best > 0 ? `自己ベスト ${best}ステージ（${R.rankFor(best).title}）` : "まだ記録なし。まずは1回やってみよう");
    const last = R.SIZE_STEPS[R.SIZE_STEPS.length - 1].size;
    View.list(el.rules, [
      "同じ色のマスの中に、1つだけ少し色がちがうマスがある",
      "見つけたらタップ。当たるとすぐ次の盤面へ",
      `進むほどマスが増えて（最大${last}×${last}）、色の差も小さくなる`,
      `持ち時間は${R.ROUND_MS / 1000}秒。まちがえると${R.PENALTY_MS / 1000}秒へる`,
      "クリアした数で、色彩感覚ランクが決まる"
    ]);
  }

  function render() {
    const p = ui.phase;
    el.setup.hidden = p !== "setup";
    el.play.hidden = p === "setup";
    el.stage.classList.toggle("colorhunt-live", HUD_PHASES.includes(p));
    if (p === "setup") renderSetup();
    View.stage(el, SCREENS[p]());
    el.hint.classList.toggle("colorhunt-alert", p === "over");
    el.hud.hidden = !HUD_PHASES.includes(p);
    el.pause.disabled = p !== "play";
    el.wrap.hidden = !BOARD_PHASES.includes(p);
    if (!el.hud.hidden) {
      showClock();
      paintHud();
    }
    if (!el.wrap.hidden) paintBoard();
    renderStats();
  }

  /* ---------- input ---------- */
  function onBoardDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const tile = e.target.closest(".colorhunt-tile");
    if (!tile) return;
    e.preventDefault();
    pointerAt = performance.now();
    pick(Number(tile.dataset.i));
  }
  /* Taps are handled on pointerdown for speed; clicks only come through for Enter / Space on a focused tile.
   * Stopping the click here also keeps the app-wide button tap sound off the tiles. */
  function onBoardClick(e) {
    e.stopPropagation();
    const tile = e.target.closest(".colorhunt-tile");
    const fromKeys = e.detail === 0 && performance.now() - pointerAt > CLICK_AFTER_TAP_MS;
    if (tile && fromKeys) pick(Number(tile.dataset.i));
  }
  function onBoardKey(e) {
    const move = ARROWS[e.key];
    const i = tiles.indexOf(document.activeElement);
    if (!move || i < 0) return;
    e.preventDefault();
    const n = Math.round(Math.sqrt(tiles.length));
    const x = Math.min(n - 1, Math.max(0, (i % n) + move[0]));
    const y = Math.min(n - 1, Math.max(0, Math.floor(i / n) + move[1]));
    tiles[y * n + x].focus();
  }
  function onKey(e) {
    const key = String(e.key || "");
    if (el.mode.hidden || e.repeat) return;
    if (key !== "Escape" && key.toLowerCase() !== "p") return;
    if (ui.phase === "play") pause();
    else if (ui.phase === "paused") resume();
  }
  function onVisibility() {
    if (document.hidden && ui.phase === "play") pause();
  }

  function init() {
    records = R.normalizeRecords(Store.load(RECORD_KEY, null));
    el.float.textContent = `−${R.PENALTY_MS / 1000}秒`;
    el.board.addEventListener("pointerdown", onBoardDown);
    el.board.addEventListener("click", onBoardClick);
    el.board.addEventListener("keydown", onBoardKey);
    el.board.addEventListener("contextmenu", (e) => e.preventDefault());
    el.pause.addEventListener("click", pause);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }
  function leave() {
    if (["ready", "play", "paused"].includes(ui.phase)) quit();
    else if (ui.phase === "over") {
      clearTimeout(overTimer);
      go("result");
    }
  }

  return { init, leave };
})();

/* Whack-a-mole screen: 3x3 holes, 30/60-second rounds, golden and bomb moles, combos, rank titles and personal bests. */
const Mole = (() => {
  const M = MoleRules;
  const KEY = "mole.settings";
  const RECORD_KEY = "mole.records";
  const URGENT_SEC = 10;
  const DONE_MS = 1300;
  const FX_MS = 760;
  const KEY_HOLE = Object.freeze({ 7: 0, 8: 1, 9: 2, 4: 3, 5: 4, 6: 5, 1: 6, 2: 7, 3: 8, q: 0, w: 1, e: 2, a: 3, s: 4, d: 5, z: 6, x: 7, c: 8 });
  const ARROWS = Object.freeze({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] });

  /* Drawings live in the partial: one critter holds every kind, CSS shows the right parts from data-kind on a parent. */
  const CRITTER = $("mlCritterArt").innerHTML;
  const HAMMER = $("mlHammerArt").innerHTML;

  const el = {
    mode: $("modeMole"), setup: $("mlSetup"), play: $("mlPlay"), label: $("mlLabel"), title: $("mlTitle"),
    card: $("mlCard"), hint: $("mlHint"), actions: $("mlActions"), arena: $("mlArena"), time: $("mlTime"),
    score: $("mlScore"), combo: $("mlCombo"), bar: $("mlBar"), board: $("mlBoard"), banner: $("mlBanner"),
    pause: $("mlPause"), stats: $("mlStats"), best: $("mlBest"), legend: $("mlLegend"), rules: $("mlRules"), timeChips: $("mlTimeChips")
  };

  let settings = M.normalizeSettings(null);
  let ui = { phase: "setup", paused: false };
  let game = null;
  let end = null;
  let clock = { start: 0, lost: 0, pausedAt: 0 };
  let loop = { raf: 0, run: 0, done: 0, lastSec: null, urgent: false };
  let holes = [];
  let shown = [];
  let cursor = { hole: 4, on: false };

  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gameNow = () => performance.now() - clock.start - clock.lost;
  const loadRecords = () => M.normalizeRecords(Store.load(RECORD_KEY, {}));
  const make = (tag, cls = "", text = "") => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text ? { textContent: text } : {});

  /* ---------- sounds (built from synth primitives) ---------- */
  const at = (fn) => { const ctx = Sound.ctx(); if (ctx) fn(ctx.currentTime); };
  const SFX = {
    pop: (kind) => at(t => {
      if (kind === "gold") [96, 100, 103].forEach((m, k) => Sound.tone({ freq: Sound.hz(m), type: "sine", t: t + k * 0.05, dur: 0.12, vol: 0.05, send: 0.2 }));
      else if (kind === "bomb") Sound.hiss({ t, dur: 0.24, vol: 0.05, freq: 5200 });
      else Sound.tone({ freq: 380, glide: 760, glideTime: 0.06, type: "triangle", t, dur: 0.08, vol: 0.045 });
    }),
    bonk: (combo) => at(t => {
      const lift = Math.pow(2, Math.min(combo, 12) / 24);
      Sound.tone({ freq: 170, glide: 70, glideTime: 0.1, type: "sine", t, dur: 0.16, vol: 0.45 });
      Sound.tone({ freq: 720 * lift, glide: 300 * lift, glideTime: 0.07, type: "square", t, dur: 0.09, vol: 0.09, filter: { freq: 2600 } });
      Sound.hiss({ t, dur: 0.05, vol: 0.16, type: "bandpass", freq: 1900, q: 0.9 });
    }),
    gold: () => at(t => [84, 88, 91, 96].forEach((m, k) =>
      Sound.tone({ freq: Sound.hz(m), type: "triangle", t: t + 0.04 + k * 0.055, dur: 0.2, vol: 0.07, send: 0.25 }))),
    blast: () => at(t => {
      Sound.tone({ freq: 130, glide: 32, glideTime: 0.45, type: "sine", t, dur: 0.55, vol: 0.7 });
      Sound.hiss({ t, dur: 0.7, vol: 0.5, type: "lowpass", freq: 2200, to: 120, send: 0.25 });
      Sound.hiss({ t, dur: 0.12, vol: 0.3, freq: 2600 });
    }),
    thud: () => at(t => {
      Sound.tone({ freq: 120, glide: 65, glideTime: 0.1, type: "sine", t, dur: 0.13, vol: 0.28 });
      Sound.hiss({ t, dur: 0.07, vol: 0.08, type: "lowpass", freq: 700 });
    }),
    combo: (combo) => at(t => [0, 4, 7, 12, 16, 19].slice(0, 2 + Math.min(4, combo / M.COMBO_STEP)).forEach((d, k) =>
      Sound.tone({ freq: Sound.hz(76 + d), type: "square", t: t + 0.06 + k * 0.06, dur: 0.14, vol: 0.05, filter: { freq: 3200 }, send: 0.2 }))),
    whistle: () => at(t => [[0, 0.16, 0], [0.2, 0.55, 0.35]].forEach(([d, dur, hold]) =>
      Sound.tone({ freq: 2100, type: "sine", t: t + d, dur, hold, vol: 0.13, vibrato: { rate: 30, depth: 60 } })))
  };

  /* ---------- board ---------- */
  function buildHole(i) {
    const h = make("div", "mole-hole");
    h.dataset.kind = "normal";
    h.setAttribute("role", "button");
    h.setAttribute("aria-label", `穴${i + 1}`);
    h.innerHTML = `<span class="mole-mound"></span><span class="mole-pit"></span><span class="mole-slot"><span class="mole-critter">${CRITTER}</span></span><span class="mole-hammer">${HAMMER}</span>`;
    /* Fingers and pens always whack; a mouse only with its main button. */
    h.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.button === 0) { e.preventDefault(); whack(i); } });
    h.addEventListener("contextmenu", (e) => e.preventDefault());
    return h;
  }
  function resetBoard() {
    holes.forEach(h => {
      h.classList.remove("is-up", "is-hit", "mole-thud", "is-cursor");
      h.querySelectorAll(".mole-burst, .mole-pts").forEach(n => n.remove());
    });
    shown = holes.map(() => "");
    cursor = { hole: 4, on: false };
    el.arena.classList.remove("mole-urgent");
    el.banner.className = "mole-banner";
  }
  function paintHoles(now) {
    shown = holes.map((h, i) => {
      const v = M.holeView(game, i, now);
      const key = `${v.phase}:${v.id}`;
      if (shown[i] !== key) {
        if (v.phase === "up" || v.phase === "hit") h.dataset.kind = v.kind;
        h.classList.toggle("is-up", v.phase === "up");
        h.classList.toggle("is-hit", v.phase === "hit");
      }
      return key;
    });
  }
  /* The combo shown is the live one: it drops to 0 when the chain window runs out, not only on the next tap. */
  function paintScore(now) {
    const combo = M.comboAt(game, now);
    const put = (node, value) => { if (node.textContent !== String(value)) node.textContent = String(value); };
    put(el.score, game.score);
    put(el.combo, combo);
    el.combo.parentElement.classList.toggle("mole-combo-on", combo >= 2);
  }
  function paintHud(now) {
    const left = M.timeLeft(game, now);
    const sec = Math.ceil(left / 1000);
    el.bar.style.transform = `scaleX(${(left / game.durationMs).toFixed(4)})`;
    if (sec === loop.lastSec) return;
    loop = { ...loop, lastSec: sec };
    el.time.textContent = String(sec);
    if (ui.phase !== "play") return;
    if (sec <= 3 && sec > 0) Sound.sfx("tick", sec > 1);
    if (sec <= URGENT_SEC && !loop.urgent) goUrgent();
  }
  function goUrgent() {
    loop = { ...loop, urgent: true };
    el.arena.classList.add("mole-urgent");
    Music.intensify();
    Sound.sfx("whoosh");
    banner("ラストスパート！", "is-hot");
  }

  /* ---------- effects ---------- */
  function banner(text, cls = "", stay = false) {
    el.banner.textContent = text;
    el.banner.className = `mole-banner ${cls}`.trim();
    Fx.replay(el.banner, stay ? "mole-stay" : "mole-show");
  }
  function floatText(i, text, cls = "") {
    const s = holes[i].appendChild(make("span", `mole-pts ${cls}`.trim(), text));
    setTimeout(() => s.remove(), FX_MS);
  }
  function burst(i, kind) {
    if (reduced()) return;
    const n = kind === "gold" ? 10 : 7;
    const wrap = make("span", `mole-burst mole-burst-${kind}`);
    const stars = Array.from({ length: n }, (_, k) => {
      const s = make("i");
      s.style.setProperty("--a", `${Math.round((360 / n) * k + Math.random() * 24)}deg`);
      s.style.setProperty("--d", `${Math.round(34 + Math.random() * 22)}px`);
      return s;
    });
    wrap.append(make("b"), ...stars);
    holes[i].appendChild(wrap);
    setTimeout(() => wrap.remove(), FX_MS);
  }
  const FEEDBACK = {
    hit: (i, res) => {
      SFX.bonk(res.combo);
      if (res.kind === "gold") SFX.gold();
      burst(i, res.kind);
      floatText(i, `+${res.base}`, res.kind === "gold" ? "is-gold" : "");
      Fx.replay(el.score, "mole-bump");
      if (res.combo >= 2) Fx.replay(el.combo, "mole-bump");
      if (res.bonus > 0) {
        SFX.combo(res.combo);
        banner(`${res.combo}コンボ！ +${res.bonus}`, "is-combo");
      }
    },
    bomb: (i) => {
      SFX.blast();
      Sound.vibrate([90, 40, 140]);
      burst(i, "bomb");
      floatText(i, `−${Math.abs(M.POINTS.bomb)}`, "is-bad");
      Fx.shake();
      Fx.flash("--alert", 320);
      Fx.replay(el.score, "mole-bump");
    },
    miss: (i) => {
      SFX.thud();
      Fx.replay(holes[i], "mole-thud");
    }
  };

  /* ---------- flow ---------- */
  function cancelLoop() {
    cancelAnimationFrame(loop.raf);
    clearTimeout(loop.done);
    loop = { ...loop, raf: 0, done: 0, run: loop.run + 1 };
  }
  async function start() {
    Sound.ensure();
    Awake.keep();
    cancelLoop();
    Sound.sfx("confirm");
    const run = loop.run;
    game = M.newGame(settings.seconds);
    end = null;
    loop = { ...loop, lastSec: null, urgent: false };
    resetBoard();
    ui = { phase: "ready", paused: false };
    render();
    paintScore(0);
    paintHud(0);
    await Fx.countdown("スタート！");
    if (loop.run !== run || ui.phase !== "ready") return;
    clock = { start: performance.now(), lost: 0, pausedAt: 0 };
    ui = { phase: "play", paused: false };
    Music.play("rush");
    render();
    if (document.hidden) pause();
    else loop = { ...loop, raf: requestAnimationFrame(frame) };
  }
  function frame() {
    if (ui.phase !== "play" || ui.paused) return;
    const now = gameNow();
    const out = M.step(game, now, Math.random);
    game = out.state;
    out.events.filter(ev => ev.type === "spawn").forEach(ev => SFX.pop(ev.kind));
    paintHoles(now);
    paintScore(now);
    paintHud(now);
    if (M.isOver(game, now)) finish();
    else loop = { ...loop, raf: requestAnimationFrame(frame) };
  }
  function whack(i) {
    if (ui.phase !== "play" || ui.paused) return;
    const now = gameNow();
    const out = M.whack(game, i, now);
    if (out.result.type === "none") return;
    game = out.state;
    Fx.replay(holes[i].querySelector(".mole-hammer"), "mole-swing");
    FEEDBACK[out.result.type](i, out.result);
    paintHoles(now);
    paintScore(now);
  }
  function finish() {
    cancelLoop();
    Music.stop();
    SFX.whistle();
    ui = { phase: "done", paused: false };
    render();
    paintHoles(game.durationMs + 60000);
    banner("そこまで！", "", true);
    loop = { ...loop, done: setTimeout(() => showResult(document.hidden), DONE_MS) };
  }
  function showResult(quiet) {
    clearTimeout(loop.done);
    loop = { ...loop, done: 0 };
    const sum = M.summary(game);
    const rec = M.applyRecord(loadRecords(), game.seconds, sum);
    if (rec.isNew) Store.save(RECORD_KEY, rec.records);
    end = { sum, rank: M.rankFor(sum.score, game.seconds), next: M.nextRank(sum.score, game.seconds), isNew: rec.isNew, previous: rec.previous };
    go("result");
    if (quiet) return;
    Fx.pop(el.card);
    if (rec.isNew) { Sound.sfx("victory"); Fx.confetti(); }
    else Sound.sfx(sum.score > 0 ? "fanfare" : "lose");
  }
  function pause() {
    if (ui.phase !== "play" || ui.paused) return;
    cancelAnimationFrame(loop.raf);
    loop = { ...loop, raf: 0 };
    clock = { ...clock, pausedAt: performance.now() };
    Music.stop();
    ui = { ...ui, paused: true };
    render();
  }
  function resume() {
    if (ui.phase !== "play" || !ui.paused) return;
    Sound.ensure();
    clock = { ...clock, lost: clock.lost + performance.now() - clock.pausedAt, pausedAt: 0 };
    ui = { ...ui, paused: false };
    Music.play("rush");
    if (loop.urgent) Music.intensify();
    render();
    loop = { ...loop, raf: requestAnimationFrame(frame) };
  }
  function quit() {
    cancelLoop();
    Music.stop();
    go("setup");
  }

  /* ---------- keyboard ---------- */
  function moveCursor([dr, dc]) {
    const r = Math.min(2, Math.max(0, Math.floor(cursor.hole / 3) + dr));
    const c = Math.min(2, Math.max(0, (cursor.hole % 3) + dc));
    cursor = { hole: r * 3 + c, on: true };
    holes.forEach((h, i) => h.classList.toggle("is-cursor", i === cursor.hole));
  }
  function onKey(e) {
    if (el.mode.hidden || ui.phase !== "play" || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    const toggle = key === "escape" || key === "p";
    if (toggle || (ARROWS[e.key] && !ui.paused)) e.preventDefault();
    if (toggle) return ui.paused ? resume() : pause();
    if (ui.paused) return;
    if (ARROWS[e.key]) return moveCursor(ARROWS[e.key]);
    const select = key === " " || key === "enter";
    if (select && e.target instanceof Element && e.target.closest("button")) return;
    const hole = select ? cursor.hole : KEY_HOLE[key];
    if (hole === undefined) return;
    e.preventDefault();
    if (select && !cursor.on) return moveCursor([0, 0]);
    whack(hole);
  }

  /* ---------- screens ---------- */
  function recordLine({ isNew, previous }) {
    if (isNew) return previous ? `新記録！（これまで ${previous.score}点）` : "新記録！";
    return previous ? `自己ベスト ${previous.score}点` : "";
  }
  function resultView() {
    const { sum, rank, next, isNew } = end;
    return {
      label: `${game.seconds}秒チャレンジの結果`,
      title: `「${rank.title}」`,
      card: { main: `${sum.score}点`, sub: recordLine(end), cls: `mole-result-card${isNew ? " is-new" : ""}` },
      hint: next ? `あと${next.need}点で「${next.title}」` : "最高ランク！ おみごと",
      actions: [makeButton("設定", () => go("setup"), "small"), makeButton("もう一回", start, "primary")]
    };
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    ready: () => ({ actions: [] }),
    done: () => ({ actions: [] }),
    play: () => (ui.paused
      ? { actions: [makeButton("やめる", quit, "small"), makeButton("つづける", resume, "primary")] }
      : { actions: [makeButton("一時停止", pause, "small")] }),
    result: resultView
  };

  function renderStats() {
    const show = ui.phase === "result" && end !== null;
    el.stats.hidden = !show;
    if (!show) return;
    const s = end.sum;
    const rows = [["たたいた", `${s.hits}匹`], ["命中率", `${s.accuracy}%`], ["最大コンボ", String(s.maxCombo)],
      ["金もぐら", `${s.golds}匹`], ["爆弾", `${s.bombs}回`], ["逃がした", `${s.escaped}匹`]];
    el.stats.replaceChildren(...rows.map(([name, value]) => {
      const li = make("li");
      li.append(make("span", "", name), make("b", "", value));
      return li;
    }));
  }
  function renderSetup() {
    const sec = settings.seconds;
    View.chips(el.timeChips, View.options(M.TIMES, n => `${n}秒`), sec, n => update({ seconds: n }));
    const best = loadRecords()[sec];
    el.best.textContent = best
      ? `自己ベスト（${sec}秒）：${best.score}点「${M.rankFor(best.score, sec).title}」`
      : `自己ベスト（${sec}秒）：まだ記録なし`;
    View.list(el.rules, [
      "穴から出てきたもぐらをタップ。1匹で+1点",
      "王冠の金もぐらは+5点。すぐ引っこむので急いで",
      "爆弾はたたくと−3点。さわらずに見送ろう",
      `続けてたたくとコンボ。${M.COMBO_STEP}コンボごとにボーナス点。空振りや、間があくと切れる`,
      `${sec}秒の間にだんだん速くなる。パソコンはテンキー1〜9でもたたける`
    ]);
  }
  function render() {
    const p = ui.phase;
    const live = p === "ready" || p === "play" || p === "done";
    el.setup.hidden = p !== "setup";
    el.play.hidden = p === "setup";
    if (p === "setup") renderSetup();
    View.stage(el, SCREENS[p]());
    el.arena.hidden = !live;
    el.play.classList.toggle("mole-live", live);
    el.pause.hidden = !(p === "play" && ui.paused);
    renderStats();
  }
  function go(phase) {
    ui = { phase, paused: false };
    render();
  }
  function update(patch) {
    settings = M.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }

  function init() {
    settings = M.normalizeSettings(Store.load(KEY, null));
    holes = Array.from({ length: M.HOLES }, (_, i) => buildHole(i));
    el.board.replaceChildren(...holes);
    shown = holes.map(() => "");
    el.legend.querySelectorAll(".mole-legend-art").forEach(n => { n.innerHTML = CRITTER; });
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
    render();
  }
  /* Leaving the game pauses a running round; a countdown in progress is cancelled. */
  function leave() {
    if (ui.phase === "play") pause();
    else if (ui.phase === "ready") quit();
    else if (ui.phase === "done") showResult(true);
  }

  return { init, leave };
})();

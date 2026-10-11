/* 色と文字 screen: a color word printed in another ink. Tap the ink color (or read the word) as fast as you can
 * in 30 or 60 seconds. Mistakes cost a second; a run of right answers lights a combo flame. */
const Stroop = (() => {
  const S = StroopRules;
  const KEY = "stroop.settings";
  const RECORD_KEY = "stroop.records";
  const READY_MS = 650;
  const TIMEUP_MS = 1200;
  const FLOAT_MS = 750;
  const GUARD_MS = 350;
  const URGENT_SEC = 5;
  const INTENSE_SEC = 10;
  const COMBO_SHOW = 2;
  const FANFARE_RANKS = 3;
  const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
  const KEYS = ["1", "2", "3", "4"];
  const LIVE = ["ready", "play", "paused", "timeup"];
  const DEMO = Object.freeze({ word: "blue", ink: "red" });
  const DROP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5c3.2 4.2 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.8-6.4 6-10.6z"/></svg>';

  const el = {
    mode: $("modeStroop"), stage: $("srStage"), setup: $("srSetup"), play: $("srPlay"), label: $("srLabel"), title: $("srTitle"),
    card: $("srCard"), hint: $("srHint"), actions: $("srActions"), modeChips: $("srModeChips"), timeChips: $("srTimeChips"),
    rules: $("srRules"), demoWord: $("srDemoWord"), demoAns: $("srDemoAns"), best: $("srBest"),
    hud: $("srHud"), clock: $("srClock"), time: $("srTime"), bar: $("srBar"), score: $("srScore"), pause: $("srPause"),
    stim: $("srStim"), combo: $("srCombo"), comboNum: $("srComboNum"), ask: $("srAsk"), word: $("srWord"),
    pad: $("srPad"), stats: $("srStats")
  };
  const buttons = new Map();

  let settings = { ...S.DEFAULT_SETTINGS };
  let records = S.normalizeRecords(null);
  let ui = { phase: "setup" };
  let game = null;
  let result = null;
  let clock = { base: 0, since: 0, raf: 0, lastSec: null };
  let trialAt = 0;
  let flowId = 0;
  let timeupTimer = 0;
  let armedAt = 0;

  const now = () => performance.now();
  const wait = (ms) => new Promise(res => setTimeout(res, ms));
  const wordOf = (id) => S.COLORS.find(c => c.id === id).word;
  const modeInfo = () => S.MODES[game ? game.mode : settings.mode];
  const roundName = (mode, seconds) => `${S.MODES[mode].label}・${seconds}秒`;
  const secText = (ms) => (ms / 1000).toFixed(2);

  function update(patch) {
    settings = S.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(phase) {
    if (phase !== ui.phase) armedAt = now() + GUARD_MS;
    ui = { phase };
    render();
  }
  /* Action buttons ignore a tap that lands right after the screen changed, so the second half of a double tap
   * on 「設定」 or 「やめる」 does not start a new round through 「はじめる」. */
  const action = (label, fn, cls) => makeButton(label, () => { if (now() >= armedAt) fn(); }, cls);

  /* ---------- custom sounds ---------- */
  /* Bright tick that climbs a major scale as the combo grows. */
  function tickSound(combo) {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const freq = Sound.hz(72 + SCALE[Math.min(Math.max(combo, 1), SCALE.length) - 1]);
    Sound.tone({ freq, type: "triangle", t, dur: 0.09, vol: 0.16 });
    Sound.tone({ freq: freq * 2, type: "sine", t, dur: 0.05, vol: 0.06 });
    Sound.hiss({ t, dur: 0.02, vol: 0.05, freq: 5000 });
  }
  /* Short low "bu" for a mistake. */
  function missSound() {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    [[150, 0.1], [158, 0.06]].forEach(([f, vol]) =>
      Sound.tone({ freq: f, glide: f * 0.66, type: "square", t, dur: 0.2, vol, hold: 0.11, filter: { freq: 1100 } }));
    Sound.vibrate(60);
  }
  /* Whoosh and sparkle when the combo catches fire. */
  function igniteSound() {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    Sound.hiss({ t, dur: 0.35, vol: 0.12, type: "bandpass", freq: 600, to: 3200, q: 1.4, attack: 0.05 });
    [0, 0.06, 0.12].forEach((d, i) => Sound.tone({ freq: Sound.hz(84 + i * 4), type: "sine", t: t + d, dur: 0.14, vol: 0.07, send: 0.25 }));
  }

  /* ---------- clock (pausable) ---------- */
  const elapsed = () => clock.base + (clock.since ? now() - clock.since : 0);
  function runClock() {
    cancelAnimationFrame(clock.raf);
    clock = { ...clock, since: now(), raf: requestAnimationFrame(frame) };
  }
  function haltClock() {
    cancelAnimationFrame(clock.raf);
    clock = { ...clock, base: elapsed(), since: 0, raf: 0 };
  }
  function frame() {
    if (ui.phase !== "play") return;
    const left = S.timeLeftMs(game, elapsed());
    renderClock(left);
    if (left <= 0) {
      finish();
      return;
    }
    clock = { ...clock, raf: requestAnimationFrame(frame) };
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    clearTimeout(timeupTimer);
    game = S.newGame(settings.mode, settings.seconds);
    result = null;
    clock = { base: 0, since: 0, raf: 0, lastSec: null };
    Sound.sfx("confirm");
    countIn("スタート！", READY_MS);
  }
  async function countIn(goText, delayMs) {
    const id = ++flowId;
    go("ready");
    await wait(delayMs);
    if (id !== flowId) return;
    await Fx.countdown(goText);
    if (id !== flowId || ui.phase !== "ready") return;
    if (document.hidden) {
      go("paused");
      return;
    }
    Music.play("rush");
    go("play");
    showTrial();
    runClock();
  }
  function showTrial() {
    trialAt = now();
    renderStim();
    Fx.replay(el.word, "stroop-new");
  }
  function answer(id) {
    if (ui.phase !== "play") return;
    const res = S.answer(game, id, now() - trialAt);
    game = res.state;
    Fx.replay(buttons.get(id), "stroop-press");
    if (res.ok) onRight();
    else onMiss();
    renderHud();
    showTrial();
    if (S.timeLeftMs(game, elapsed()) <= 0) finish();
  }
  function onRight() {
    tickSound(game.combo);
    const lit = game.combo === S.FIRE_COMBO || (game.combo > S.FIRE_COMBO && game.combo % 10 === 0);
    if (lit) igniteSound();
    Fx.replay(el.score, "stroop-bump");
    if (game.combo >= COMBO_SHOW) Fx.replay(el.combo, "stroop-bump");
  }
  function onMiss() {
    missSound();
    Fx.replay(el.stim, "stroop-miss");
    const minus = document.createElement("span");
    minus.className = "stroop-minus";
    minus.textContent = `-${S.PENALTY_MS / 1000}秒`;
    el.clock.appendChild(minus);
    setTimeout(() => minus.remove(), FLOAT_MS);
  }
  function finish() {
    if (ui.phase !== "play") return;
    haltClock();
    Music.stop();
    Sound.sfx("buzz");
    const sum = S.summary(game);
    const rec = S.applyRecord(records, game.mode, game.seconds, sum.correct);
    records = rec.records;
    Store.save(RECORD_KEY, records);
    result = { ...sum, rank: S.rankFor(sum.correct, game.seconds, game.mode), isNew: rec.isNew, previous: rec.previous };
    go("timeup");
    Fx.pop(el.title);
    clearTimeout(timeupTimer);
    timeupTimer = setTimeout(showResult, TIMEUP_MS);
  }
  function showResult() {
    if (ui.phase !== "timeup") return;
    go("result");
    Fx.pop(el.card);
    if (result.isNew) {
      Sound.sfx("victory");
      Fx.confetti();
    } else Sound.sfx(result.rank.index < FANFARE_RANKS ? "fanfare" : "reveal");
  }
  function pause() {
    if (ui.phase !== "play") return;
    haltClock();
    Music.stop();
    go("paused");
  }
  function resume() {
    if (ui.phase !== "paused") return;
    Sound.ensure();
    countIn("再開！", 0);
  }
  function toSetup() {
    flowId++;
    clearTimeout(timeupTimer);
    haltClock();
    Music.stop();
    go("setup");
  }

  /* ---------- screens ---------- */
  function resultHint() {
    const r = result.rank;
    return r.next ? `${r.note}\nあと${r.next.need}問で${r.next.title}！` : r.note;
  }
  const SCREENS = {
    setup: () => ({ actions: [action("はじめる", start, "primary")] }),
    ready: () => ({ label: "", title: "", hint: "", actions: [] }),
    play: () => ({ label: "", title: "", hint: "", actions: [] }),
    paused: () => ({
      label: "一時停止中",
      title: "ひと休み",
      hint: `残り${Math.ceil(S.timeLeftMs(game, clock.base) / 1000)}秒から再開します`,
      actions: [action("やめる", toSetup, "small"), action("つづける", resume, "primary")]
    }),
    timeup: () => ({ label: "", title: "そこまで！", hint: "", actions: [] }),
    result: () => ({
      label: `${roundName(game.mode, game.seconds)}の結果`,
      title: result.rank.title,
      card: { main: String(result.correct), sub: "問正解", cls: "number" },
      hint: resultHint(),
      actions: [action("設定", toSetup, "small"), action("もう一回", start, "primary")]
    })
  };

  function renderClock(left) {
    const sec = Math.ceil(left / 1000);
    const playing = ui.phase === "play";
    el.time.textContent = String(sec);
    el.bar.style.transform = `scaleX(${(left / (game.seconds * 1000)).toFixed(4)})`;
    el.hud.classList.toggle("urgent", playing && sec <= URGENT_SEC);
    if (playing && sec !== clock.lastSec) {
      if (sec <= URGENT_SEC && sec > 0) Sound.sfx("count");
      if (sec <= INTENSE_SEC) Music.intensify();
    }
    clock = { ...clock, lastSec: sec };
  }
  function renderHud() {
    el.score.textContent = String(game.correct);
    el.combo.hidden = ui.phase !== "play" || game.combo < COMBO_SHOW;
    el.combo.classList.toggle("stroop-fire", game.combo >= S.FIRE_COMBO);
    el.comboNum.textContent = `${game.combo}コンボ`;
    el.pause.disabled = ui.phase !== "play";
    renderClock(S.timeLeftMs(game, elapsed()));
  }
  function renderStim() {
    const playing = ui.phase === "play";
    el.ask.textContent = modeInfo().ask;
    el.word.textContent = playing ? wordOf(game.trial.word) : "";
    if (playing) el.word.dataset.ink = game.trial.ink;
    else delete el.word.dataset.ink;
  }
  function stat(label, value) {
    const box = document.createElement("div");
    box.className = "stroop-stat";
    const name = document.createElement("small");
    name.textContent = label;
    const num = document.createElement("b");
    num.textContent = value;
    box.append(name, num);
    return box;
  }
  function renderStats() {
    const show = ui.phase === "result";
    el.stats.hidden = !show;
    if (!show) return;
    el.stats.replaceChildren(
      stat("ミス", `${result.wrong}回`),
      stat("正答率", `${result.accuracy}%`),
      stat("平均反応", result.avgMs === null ? "-" : `${secText(result.avgMs)}秒`),
      stat("最大コンボ", String(result.bestCombo))
    );
  }
  function bestText(fresh) {
    if (fresh) return result.previous > 0 ? `新記録！ これまでの自己ベストは${result.previous}問` : "新記録！ はじめての記録です";
    const best = records[S.recordKey(settings.mode, settings.seconds)];
    return best > 0 ? `自己ベスト ${best}問（${roundName(settings.mode, settings.seconds)}）` : "自己ベストはまだありません";
  }
  function renderBest() {
    const show = ui.phase === "setup" || ui.phase === "result";
    el.best.hidden = !show;
    if (!show) return;
    const fresh = ui.phase === "result" && result.isNew;
    el.best.classList.toggle("stroop-new", fresh);
    el.best.textContent = bestText(fresh);
  }
  function rulesFor(s) {
    return [
      "「あか」「あお」などの文字が、ちがう色で出てくる",
      s.mode === "ink" ? "書いてある文字ではなく、文字の色をボタンで答える" : "色にまどわされずに、書いてある文字をボタンで答える",
      `${s.seconds}秒で何問正解できるか挑戦。まちがえると残り時間が1秒へる`,
      `${S.FIRE_COMBO}問続けて正解すると、コンボに火がつく`
    ];
  }
  function renderSetup() {
    View.chips(el.modeChips, S.MODE_IDS.map(id => ({ value: id, label: S.MODES[id].label })), settings.mode, v => update({ mode: v }));
    View.chips(el.timeChips, View.options(S.DURATIONS, n => `${n}秒`), settings.seconds, v => update({ seconds: v }));
    View.list(el.rules, rulesFor(settings));
    el.demoWord.textContent = wordOf(DEMO.word);
    el.demoWord.dataset.ink = DEMO.ink;
    el.demoAns.textContent = `答えは「${wordOf(S.answerOf(DEMO, settings.mode))}」`;
  }
  function renderPlay() {
    const p = ui.phase;
    el.hud.hidden = !LIVE.includes(p);
    el.stim.hidden = p !== "ready" && p !== "play";
    el.pad.hidden = el.stim.hidden;
    buttons.forEach(b => { b.disabled = p !== "play"; });
    if (!el.hud.hidden) renderHud();
    if (!el.stim.hidden) renderStim();
    renderStats();
  }
  function render() {
    const p = ui.phase;
    el.setup.hidden = p !== "setup";
    el.play.hidden = p === "setup";
    el.play.classList.toggle("stroop-live", LIVE.includes(p));
    el.stage.classList.toggle("stroop-tight", LIVE.includes(p));
    if (p === "setup") renderSetup();
    View.stage(el, SCREENS[p]());
    if (p !== "setup") renderPlay();
    renderBest();
  }

  /* ---------- input ---------- */
  function buildPad() {
    S.COLORS.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key stroop-ans";
      b.innerHTML = `<span class="stroop-kbd" aria-hidden="true">${i + 1}</span>${DROP_ICON}<span>${c.word}</span>`;
      b.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        answer(c.id);
      });
      b.addEventListener("click", (e) => { if (e.detail === 0) answer(c.id); });
      buttons.set(c.id, b);
      el.pad.appendChild(b);
    });
  }
  function onKey(e) {
    if (el.mode.hidden || e.repeat || e.metaKey || e.ctrlKey || e.altKey || ui.phase !== "play") return;
    const i = KEYS.indexOf(e.key);
    if (i >= 0) {
      e.preventDefault();
      answer(S.COLOR_IDS[i]);
    } else if (e.key === "Escape") pause();
  }
  function onHidden() {
    if (document.hidden) pause();
  }

  function init() {
    settings = S.normalizeSettings(Store.load(KEY, null));
    records = S.normalizeRecords(Store.load(RECORD_KEY, null));
    buildPad();
    el.pause.addEventListener("click", pause);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHidden);
    render();
  }
  function leave() {
    if (ui.phase === "play") pause();
    else if (ui.phase === "ready") {
      flowId++;
      go(clock.base > 0 ? "paused" : "setup");
    } else if (ui.phase === "timeup") {
      clearTimeout(timeupTimer);
      go("result");
    }
  }

  return { init, leave };
})();

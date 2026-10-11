/* Rhythm word game screen: pick a prompt, play a clap-clap-say beat built from synth hits, tap アウト when someone misses.
 * Drums go to the effects bus (heard in "効果音だけ"); bass and chord stabs go to the music bus. */
const Rhythm = (() => {
  const R = RhythmRules;
  const KEY = "rhythm.settings";
  const RECORD_KEY = "rhythm.records";
  const LOOKAHEAD = 0.12;
  const PUMP_MS = 25;
  const START_DELAY = 0.35;
  const RESULT_MS = 1100;
  const BIG_RUN = 8;
  const LONG_TITLE = 9;
  const KEYS = [0, 2, 5, -2, 3];
  const CHORDS = [[0, [0, 4, 7]], [-3, [0, 3, 7]], [-7, [0, 4, 7]], [-5, [0, 4, 7]]];
  const BASS = [0, null, 0, 12, null, 7, null, 12];
  const GAME_RULE = {
    koko: "お題に合うものを答える（例：果物なら「りんご」）",
    banana: "前の人の言葉から思いつくものを「バナナといったら黄色」の形でつなぐ",
    shiri: "前の人の言葉の最後の文字から始まる言葉を言う。「ん」で終わったらアウト"
  };

  const el = {
    setup: $("rSetup"), play: $("rPlay"), label: $("rLabel"), title: $("rTitle"), card: $("rCard"), hint: $("rHint"),
    actions: $("rActions"), beat: $("rBeat"), pulse: $("rPulse"), cue: $("rCue"), dots: $("rDots"),
    bars: $("rBars"), bpm: $("rBpm"), up: $("rUp"), records: $("rRecords"),
    gameChips: $("rGameChips"), tempoChips: $("rTempoChips"), accelChips: $("rAccelChips"), rules: $("rRules")
  };

  let settings = R.normalizeSettings(null);
  let records = R.normalizeRecords(null);
  let used = { koko: [], banana: [], shiri: [] };
  let ui = { phase: "setup" };
  let prompt = null;
  let result = null;
  let beat = null;
  let live = { answers: 0, armed: false };
  let loop = { timer: 0, raf: 0, pending: 0, groove: null };
  let lockUntil = 0;

  /* ---------- instruments ---------- */
  const T = (o) => Sound.tone(o);
  const N = (o) => Sound.hiss(o);
  const KIT = {
    kick: (t, vol = 0.42) => {
      T({ freq: 160, glide: 46, glideTime: 0.1, type: "sine", t, dur: 0.22, vol });
      T({ freq: 330, glide: 110, glideTime: 0.04, type: "triangle", t, dur: 0.06, vol: vol * 0.35 });
    },
    clap: (t, vol = 0.17) => {
      [0, 0.011, 0.022].forEach(d => N({ t: t + d, dur: 0.025, vol, type: "bandpass", freq: 1300, q: 1.1 }));
      N({ t: t + 0.033, dur: 0.18, vol: vol * 0.9, type: "bandpass", freq: 1150, q: 0.9, send: 0.22 });
    },
    cowbell: (t, vol = 0.085) => [562, 845].forEach(freq =>
      T({ freq, type: "square", t, dur: 0.32, vol, filter: { type: "bandpass", freq: 1150, q: 1.1 }, send: 0.12 })),
    hat: (t, vol = 0.035, open = false) => N({ t, dur: open ? 0.17 : 0.035, vol, freq: 7800 }),
    shaker: (t, vol = 0.022) => N({ t, dur: 0.05, vol, type: "bandpass", freq: 6200, q: 1.4 }),
    stick: (t, high) => {
      T({ freq: high ? 1760 : 1320, type: "sine", t, dur: 0.07, vol: 0.2 });
      N({ t, dur: 0.015, vol: 0.12, type: "bandpass", freq: 2500, q: 1.5 });
    },
    crash: (t, vol = 0.07) => N({ t, dur: 1.1, vol, freq: 5500, send: 0.3 }),
    riser: (t, dur) => N({ t, dur, vol: 0.09, attack: dur * 0.9, type: "bandpass", freq: 500, to: 5200, q: 1.1 }),
    bass: (m, t, dur) => {
      T({ freq: Sound.hz(m), type: "triangle", t, dur, vol: 0.2, dest: loop.groove });
      T({ freq: Sound.hz(m + 12), type: "square", t, dur: dur * 0.8, vol: 0.025, filter: { freq: 1100 }, dest: loop.groove });
    },
    stab: (notes, t, dur) => notes.forEach(m => {
      T({ freq: Sound.hz(m), type: "triangle", t, dur, vol: 0.04, dest: loop.groove });
      T({ freq: Sound.hz(m) * 2, type: "sine", t, dur: dur * 0.5, vol: 0.012, dest: loop.groove });
    }),
    tapeStop: () => T({ freq: 220, glide: 30, glideTime: 0.5, type: "sawtooth", dur: 0.55, vol: 0.1, filter: { freq: 1400, to: 150 } })
  };

  /* ---------- beat pattern ---------- */
  function playCountIn(pos, spb) {
    const last = pos.step === R.BEATS_PER_BAR - 1;
    KIT.stick(pos.t, last);
    KIT.hat(pos.t + spb / 2, 0.025);
    if (pos.step >= 2) KIT.kick(pos.t, 0.3);
    if (last) KIT.riser(pos.t, spb);
  }
  function playGroove(pos, spb) {
    if (!loop.groove) return;
    const [offset, shape] = CHORDS[pos.bar % CHORDS.length];
    const root = 48 + beat.key + offset;
    [0, 1].forEach(h => {
      const n = BASS[pos.step * 2 + h];
      if (n !== null) KIT.bass(root + n, pos.t + (h * spb) / 2, spb * 0.42);
    });
    if (pos.step % 2 === 1) KIT.stab(shape.map(i => root + 12 + i), pos.t + spb / 2, spb * 0.35);
  }
  function playStep(pos) {
    const spb = R.beatSeconds(pos.bpm);
    if (pos.bar === R.COUNT_IN_BAR) return playCountIn(pos, spb);
    const cue = R.cueFor(pos.bar, pos.step);
    const level = pos.bar >= 16 ? 2 : pos.bar >= 8 ? 1 : 0;
    if (pos.step === 0 && (pos.bar === 0 || R.isSpeedUp(beat.base, pos.bar, beat.accel))) KIT.crash(pos.t);
    if (cue.kind === "clap") { KIT.kick(pos.t, pos.step ? 0.36 : 0.44); KIT.clap(pos.t); }
    if (cue.answer) { KIT.kick(pos.t, 0.26); KIT.cowbell(pos.t); }
    if (cue.soft) KIT.kick(pos.t, 0.2);
    KIT.hat(pos.t, 0.03);
    KIT.hat(pos.t + spb / 2, 0.04, pos.step === 3);
    if (level >= 1) [0.25, 0.75].forEach(f => KIT.shaker(pos.t + spb * f));
    if (level >= 2 && pos.step === 3) KIT.cowbell(pos.t + spb / 2, 0.035);
    if (pos.step === 3 && R.isSpeedUp(beat.base, pos.bar + 1, beat.accel)) KIT.riser(pos.t, spb);
    playGroove(pos, spb);
  }

  /* ---------- scheduler (audio clock, scheduled slightly ahead) and visuals (drawn when the beat is heard) ---------- */
  const now = () => Sound.ctx()?.currentTime ?? performance.now() / 1000;
  /* Output delay, so the picture changes when the beat is heard (capped for odd values). */
  const latency = () => Math.min(Math.max(Sound.ctx()?.outputLatency || Sound.ctx()?.baseLatency || 0, 0), 0.3);
  function schedule() {
    const t = now();
    let pos = beat.pos.t < t - 0.2 ? { ...beat.pos, t: t + 0.05 } : beat.pos;
    const due = [];
    while (pos.t < t + LOOKAHEAD) {
      playStep(pos);
      due.push(pos);
      pos = R.nextBeat(pos, beat.base, beat.accel);
    }
    beat = { ...beat, pos, queue: [...beat.queue, ...due] };
  }
  function pump() {
    if (!beat) return;
    try {
      schedule();
    } catch (e) {
      console.error("リズムの再生を止めました", e);
      stopBeat();
      go({ phase: "ready" });
    }
  }
  function flush(heard) {
    if (!beat) return;
    const due = beat.queue.filter(p => p.t <= heard);
    if (!due.length) return;
    beat = { ...beat, queue: beat.queue.filter(p => p.t > heard) };
    due.forEach(showStep);
  }
  function frame() {
    if (!beat) return;
    flush(now() - latency());
    loop = { ...loop, raf: requestAnimationFrame(frame) };
  }
  function makeGroove() {
    const ctx = Sound.ctx();
    if (!ctx || !Sound.musicBus()) return null;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    g.connect(Sound.musicBus());
    return g;
  }
  function stopBeat() {
    clearInterval(loop.timer);
    cancelAnimationFrame(loop.raf);
    const g = loop.groove;
    const ctx = Sound.ctx();
    if (g && ctx) {
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
      setTimeout(() => g.disconnect(), 400);
    }
    loop = { ...loop, timer: 0, raf: 0, groove: null };
    beat = null;
  }

  /* ---------- beat view ---------- */
  function setDots(step) {
    [...el.dots.children].forEach((d, i) => d.classList.toggle("on", i <= step));
  }
  function resetBeatView(bpm) {
    el.pulse.className = "rhythm-pulse rhythm-count";
    el.cue.textContent = "";
    setDots(-1);
    el.bars.textContent = "0";
    el.bpm.textContent = String(bpm);
    el.up.hidden = true;
  }
  function showBar(pos) {
    el.bpm.textContent = String(pos.bpm);
    const up = R.isSpeedUp(beat.base, pos.bar, beat.accel);
    el.up.hidden = !up;
    if (up) Fx.replay(el.up, "rhythm-flash");
  }
  /* The counter moves on each いま！ beat, from the same numbers the result uses. */
  function showCount() {
    const bars = String(R.survived(live.answers));
    if (el.bars.textContent === bars) return;
    el.bars.textContent = bars;
    Fx.replay(el.bars, "rhythm-tick");
  }
  /* The アウト button wakes up with the first パン (it stays off during the count-in). */
  function armOut() {
    const b = el.actions.querySelector(".btn");
    if (ui.phase === "play" && b && b.disabled) b.disabled = false;
  }
  function showStep(pos) {
    const cue = R.cueFor(pos.bar, pos.step);
    live = { answers: R.answersAt(pos.bar, pos.step), armed: R.outAllowed(pos.bar) };
    el.cue.textContent = cue.text;
    el.pulse.classList.toggle("rhythm-count", cue.kind === "count");
    el.pulse.classList.toggle("rhythm-now", cue.kind === "now");
    el.pulse.classList.toggle("rhythm-soft", cue.soft);
    Fx.replay(el.pulse, "rhythm-hit");
    setDots(pos.step);
    if (live.armed) armOut();
    if (cue.answer) showCount();
    if (pos.step === 0 && pos.bar >= 0) showBar(pos);
  }
  function showOut() {
    el.pulse.className = "rhythm-pulse rhythm-out";
    el.cue.textContent = "アウト！";
    setDots(-1);
    el.up.hidden = true;
    Fx.replay(el.pulse, "rhythm-hit");
  }

  /* ---------- flow ---------- */
  function update(patch) {
    settings = R.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  /* Every screen change ignores taps for a moment, so a double tap cannot also press the next screen's button. */
  function go(patch) {
    ui = { ...ui, ...patch };
    lockUntil = performance.now() + R.INPUT_LOCK_MS;
    render();
  }
  const locked = () => performance.now() < lockUntil;
  const guard = (fn) => () => { if (!locked()) fn(); };
  function choosePrompt() {
    const game = settings.game;
    const next = R.pickTheme(used[game], Math.random, game);
    used = { ...used, [game]: next.used };
    prompt = { game, word: next.theme };
  }
  function begin() {
    Sound.ensure();
    choosePrompt();
    Sound.sfx("confirm");
    go({ phase: "ready" });
    Fx.pop(el.card);
  }
  function changePrompt() {
    choosePrompt();
    Sound.sfx("flip");
    render();
    Fx.pop(el.card);
  }
  function nextPrompt() {
    clearTimeout(loop.pending);
    choosePrompt();
    Sound.sfx("whoosh");
    go({ phase: "ready" });
    Fx.pop(el.card);
  }
  function startBeat() {
    Sound.ensure();
    Awake.keep();
    Music.stop();
    stopBeat();
    const base = R.TEMPOS[settings.tempo].bpm;
    loop = { ...loop, groove: makeGroove() };
    beat = { pos: R.firstBeat(base, now() + START_DELAY), base, accel: settings.accel, key: Rand.pick(KEYS), queue: [] };
    live = { answers: 0, armed: false };
    Sound.sfx("confirm");
    go({ phase: "play" });
    resetBeatView(base);
    pump();
    loop = { ...loop, timer: setInterval(pump, PUMP_MS), raf: requestAnimationFrame(frame) };
  }
  function out() {
    if (ui.phase !== "play" || !beat || locked()) return;
    flush(now() - latency());
    if (!live.armed) return;
    const bars = R.survived(live.answers);
    stopBeat();
    Sound.sfx("buzz");
    KIT.tapeStop();
    Fx.shake();
    Fx.flash("--alert", 500);
    const res = R.applyRecord(records, prompt.game, bars);
    records = res.records;
    Store.save(RECORD_KEY, records);
    result = { bars, isNew: res.isNew, previous: res.previous };
    go({ phase: "out" });
    loop = { ...loop, pending: setTimeout(showResult, RESULT_MS) };
  }
  function showResult() {
    if (ui.phase !== "out") return;
    go({ phase: "result" });
    Fx.pop(el.card);
    if (result.isNew) {
      Sound.sfx("victory");
      Fx.confetti();
    } else Sound.sfx(result.bars >= BIG_RUN ? "fanfare" : "lose");
  }

  /* ---------- screens ---------- */
  const view = () => R.promptView(prompt.game, prompt.word);
  function outButton(enabled) {
    const b = makeButton("アウト！", out, "primary danger big-press", !enabled);
    b.addEventListener("pointerdown", out);
    return b;
  }
  function readyHint() {
    const best = records[prompt.game];
    const base = "スマホを真ん中に置いて、スタートを押した人から時計回りに答えよう";
    return best > 0 ? `${base}。最高記録は${best}小節` : base;
  }
  function resultHint() {
    if (result.isNew) return result.previous > 0 ? `これまでの記録は${result.previous}小節。みごと更新！` : "はじめての記録！ 次はこれを超えよう";
    const best = records[prompt.game];
    return best > 0 ? `最高記録は${best}小節。あと${best - result.bars + 1}小節で新記録！` : "1小節でもつづけば、それが最初の記録！";
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", guard(begin), "primary")] }),
    ready: () => ({
      label: view().label,
      title: "",
      card: { main: view().main, sub: view().sub },
      hint: readyHint(),
      actions: [makeButton("お題を変える", guard(changePrompt), "small"), makeButton("スタート", guard(startBeat), "primary")]
    }),
    play: () => ({ label: view().label, title: view().title, hint: "", actions: [outButton(live.armed)] }),
    out: () => ({ label: view().label, title: view().title, hint: "", actions: [outButton(false)] }),
    result: () => ({
      label: "結果",
      title: result.isNew ? "新記録！" : "アウト！",
      card: { main: `${result.bars}小節`, sub: `${view().label}「${prompt.word}」`, cls: "rhythm-score" },
      hint: resultHint(),
      actions: [makeButton("設定", guard(() => go({ phase: "setup" })), "small"), makeButton("次のお題", guard(nextPrompt), "primary")]
    })
  };

  function rulesFor(s) {
    return [
      "スマホを真ん中に置いて「パン・パン・いま！」のリズムで、1人ずつ時計回りに答える",
      GAME_RULE[s.game],
      "言えない・遅れた・前に出た答えを言ったら、誰でもいいので「アウト！」をタップ",
      s.accel ? "8小節ごとにテンポが上がる。何小節つづくか、みんなで記録に挑戦" : "何小節つづくか、みんなで記録に挑戦"
    ];
  }
  function renderSetup() {
    View.chips(el.gameChips, R.GAME_IDS.map(id => ({ value: id, label: R.GAMES[id].label })), settings.game, v => update({ game: v }));
    View.chips(el.tempoChips, R.TEMPO_IDS.map(id => ({ value: id, label: R.TEMPOS[id].label })), settings.tempo, v => update({ tempo: v }));
    View.chips(el.accelChips, [{ value: true, label: "あり" }, { value: false, label: "なし" }], settings.accel, v => update({ accel: v }));
    View.list(el.rules, rulesFor(settings));
  }
  const node = (tag, text, cls = "") => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  function recordCell(id) {
    const fresh = ui.phase === "result" && result.isNew && id === prompt.game;
    const cell = node("div", "", ["rhythm-rec", id === settings.game ? "on" : "", fresh ? "rhythm-new" : ""].filter(Boolean).join(" "));
    cell.append(node("span", R.GAMES[id].label), node("b", String(records[id])), node("small", "小節"));
    return cell;
  }
  function renderRecords() {
    const show = ui.phase === "setup" || ui.phase === "result";
    el.records.hidden = !show;
    if (show) el.records.replaceChildren(node("p", "最高記録", "rhythm-rec-head"), ...R.GAME_IDS.map(recordCell));
  }

  function render() {
    const p = ui.phase;
    el.setup.hidden = p !== "setup";
    el.play.hidden = p === "setup";
    el.beat.hidden = p !== "play" && p !== "out";
    el.play.classList.toggle("rhythm-live", p === "play" || p === "out");
    if (p === "setup") renderSetup();
    View.stage(el, SCREENS[p]());
    el.title.classList.toggle("rhythm-long", [...el.title.textContent].length > LONG_TITLE);
    if (p === "out") showOut();
    renderRecords();
  }

  function onHidden() {
    if (!document.hidden || ui.phase !== "play") return;
    stopBeat();
    go({ phase: "ready" });
  }

  function init() {
    settings = R.normalizeSettings(Store.load(KEY, null));
    records = R.normalizeRecords(Store.load(RECORD_KEY, null));
    document.addEventListener("visibilitychange", onHidden);
    render();
  }
  function leave() {
    clearTimeout(loop.pending);
    if (ui.phase === "play") {
      stopBeat();
      go({ phase: "ready" });
    } else if (ui.phase === "out") go({ phase: "result" });
  }

  return { init, leave };
})();

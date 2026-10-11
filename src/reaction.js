/* Reaction-time test: wait for the signal (the screen turns green, or a beep), then tap as fast as you can.
 * Taps are timed on pointerdown with performance.now(); the eye signal is stamped on the frame that shows it,
 * the ear signal on the moment the beep leaves the speaker. */
const Reaction = (() => {
  const T = ReactionRules;
  const KEY = "reaction.settings";
  const RECORD_KEY = "reaction.records";
  const SHOW_MS = 1300;      // one trial's time stays up; taps are ignored meanwhile
  const FOUL_MS = 1600;
  const LATE_MS = 1500;
  const END_MS = 1000;
  const TALLY_MS = 1200;
  const BEEP_LEAD_S = 0.03;  // the beep is scheduled this far ahead so its real start time is known
  const MAX_LAG_MS = 400;
  const FAST_MS = T.RANKS[1].under;
  const EAR_WAIT = { msg: "よく聞いて…", sub: "「ピッ」と鳴ったらタップ" };
  const BADGES = { record: "　自己ベスト更新！", round: "　今回のベスト！" };
  const LONG_MS = 1000;      // 4-digit averages get a smaller card font so "ms" stays on the same line
  const COMPACT_AFTER = 5;   // longer rounds list their times in two columns
  const HERO = {
    eye: [["まって…", "wait"], ["タップ！", "go"]],
    ear: [["よく聞いて…", "wait"], ["ピッ！", "beep"]]
  };

  const el = {
    setup: $("reSetup"), play: $("rePlay"), label: $("reLabel"), title: $("reTitle"),
    card: $("reCard"), hint: $("reHint"), actions: $("reActions"),
    hero: $("reHero"), records: $("reRecords"), note: $("reNote"),
    next: $("reNext"), stats: $("reStats"), list: $("reList"), best: $("reBest"),
    layer: $("reLayer"), pad: $("rePad"), msg: $("reMsg"), unit: $("reUnit"), sub: $("reSub"),
    info: $("reInfo"), dots: $("reDots"), quit: $("reQuit")
  };

  let settings = { ...T.DEFAULT_SETTINGS };
  let records = T.normalizeRecords(null);
  let ui = { phase: "setup" };    // setup | play | tally | result
  let round = null;
  let result = null;              // summary of the last finished round plus record flags
  let trial = { state: "idle", id: 0, goAt: 0, last: null };  // idle count wait go shown foul late paused
  let timers = [];

  /* ---------- state helpers ---------- */
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  function later(fn, ms) {
    timers = [...timers, setTimeout(fn, Math.max(0, ms))];
  }
  function setTrial(patch) {
    trial = { ...trial, ...patch };
    renderLayer();
  }
  function update(patch) {
    settings = T.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(phase) {
    ui = { phase };
    render();
  }
  const soundBlocked = () => settings.mode === "ear" && Sound.mode() === "off";

  /* ---------- flow ---------- */
  async function start() {
    Sound.ensure();
    if (soundBlocked()) {
      go("setup");
      Fx.pop(el.note);
      return;
    }
    Awake.keep();
    clearTimers();
    Music.stop();
    const mine = T.newRound(settings.trials, settings.mode);
    round = mine;
    result = null;
    Sound.sfx("confirm");
    openLayer();
    setTrial({ state: "count", goAt: 0, last: null });
    go("play");
    await Fx.countdown("スタート！");
    if (round === mine && trial.state === "count") arm();
  }
  function arm() {
    clearTimers();
    if (document.hidden) {
      setTrial({ state: "paused", last: null });
      return;
    }
    setTrial({ state: "wait", id: trial.id + 1, goAt: 0, last: null });
    later(signal, round.wait);
  }
  function signal() {
    if (trial.state !== "wait") return;
    if (round.mode === "ear") {
      showGo(beep());
      return;
    }
    const id = trial.id;
    requestAnimationFrame(() => {
      if (trial.state === "wait" && trial.id === id) showGo(performance.now());
    });
  }
  function showGo(goAt) {
    setTrial({ state: "go", goAt });
    later(timeUp, goAt - performance.now() + T.TIMEOUT_MS + 50);
  }
  function timeUp() {
    if (trial.state !== "go") return;
    round = T.retry(round);
    showLate();
  }

  /* When the tap really happened: the event's own time stamp (same clock as performance.now()), so a busy
   * main thread does not add to the measured time. Falls back to now when the stamp looks wrong. */
  function tapTime(e) {
    const now = performance.now();
    const ts = e && e.timeStamp;
    return Number.isFinite(ts) && ts > 0 && ts <= now && now - ts < 1000 ? ts : now;
  }
  /* Every tap lands here. Only the waiting and signal states count; the rest are ignored. */
  function press(now) {
    if (trial.state === "paused") {
      Sound.ensure();
      arm();
      return;
    }
    if (trial.state !== "wait" && trial.state !== "go") return;
    clearTimers();
    const res = T.tap(round, trial.state === "go" ? now - trial.goAt : null);
    round = res.round;
    const kind = res.outcome.kind;
    if (kind === "ok") hit(res.outcome.ms);
    else if (kind === "late") showLate();
    else foul(kind);
  }
  function hit(ms) {
    const done = T.finished(round);
    Sound.sfx(ms < FAST_MS ? "coin" : "pop");
    setTrial({ state: "shown", last: { ms, rank: T.rankFor(ms) } });
    Fx.pop(el.msg.parentElement);
    later(done ? finish : arm, done ? END_MS : SHOW_MS);
  }
  function foul(kind) {
    Sound.sfx("wrong");
    Fx.shake(el.layer);
    setTrial({ state: "foul", last: { kind } });
    later(arm, FOUL_MS);
  }
  function showLate() {
    clearTimers();
    Sound.sfx("back");
    setTrial({ state: "late", last: null });
    later(arm, LATE_MS);
  }

  function finish() {
    clearTimers();
    closeLayer();
    const rec = T.applyRecords(records, round);
    records = rec.records;
    if (rec.newAverage || rec.newSingle) Store.save(RECORD_KEY, records);
    result = { ...T.summary(round), newAverage: rec.newAverage, newSingle: rec.newSingle };
    setTrial({ state: "idle", last: null });
    go("tally");
    Sound.sfx("drumroll", TALLY_MS / 1000);
    later(reveal, TALLY_MS);
  }
  function reveal() {
    if (ui.phase !== "tally") return;
    go("result");
    Fx.pop(el.card);
    if (result.newAverage || result.newSingle) {
      Sound.sfx("victory");
      Fx.confetti();
      return;
    }
    Sound.sfx(result.average < FAST_MS ? "fanfare" : "reveal");
  }
  /* The 3-2-1 countdown cannot be stopped once it runs, so quitting waits until it is over. */
  function requestQuit() {
    if (trial.state !== "count") quit();
  }
  function quit() {
    clearTimers();
    closeLayer();
    setTrial({ state: "idle", last: null });
    round = null;
    go("setup");
  }

  /* ---------- sound signal ---------- */
  function beep() {
    const ctx = Sound.ctx();
    if (!ctx) return performance.now();
    const t = ctx.currentTime + BEEP_LEAD_S;
    Sound.tone({ freq: 1760, type: "square", t, dur: 0.16, vol: 0.12, attack: 0.002, hold: 0.09, filter: { freq: 5200 } });
    Sound.tone({ freq: 3520, type: "sine", t, dur: 0.12, vol: 0.08, attack: 0.002 });
    return heardAt(ctx, t);
  }
  /* performance.now() time at which audio-context time t comes out of the speaker. */
  function heardAt(ctx, t) {
    const now = performance.now();
    const stamp = typeof ctx.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : null;
    const fromStamp = stamp && stamp.performanceTime > 0 ? stamp.performanceTime + (t - stamp.contextTime) * 1000 : NaN;
    if (Number.isFinite(fromStamp) && fromStamp >= now && fromStamp - now < MAX_LAG_MS) return fromStamp;
    const lag = Math.min((ctx.outputLatency || 0) + (ctx.baseLatency || 0), MAX_LAG_MS / 1000);
    return now + (t - ctx.currentTime + lag) * 1000;
  }

  /* ---------- full-screen layer ---------- */
  function openLayer() {
    el.layer.dataset.mode = settings.mode;
    el.layer.hidden = false;
    document.body.classList.add("arena-open");
    el.pad.focus({ preventScroll: true });
  }
  function closeLayer() {
    el.layer.hidden = true;
    document.body.classList.remove("arena-open");
  }
  const MESSAGES = {
    idle: () => ({ msg: "", sub: "" }),
    count: () => ({ msg: "かまえて！", sub: round.mode === "ear" ? "「ピッ」と鳴ったらすぐタップ" : "画面が緑になったらすぐタップ" }),
    wait: () => (round.mode === "ear" ? EAR_WAIT : { msg: "まって…", sub: "緑になったらタップ" }),
    go: () => (round.mode === "ear" ? EAR_WAIT : { msg: "タップ！", sub: "" }),
    shown: () => {
      const { ms, rank } = trial.last;
      const badge = T.trialBadge(round.times, T.bestOf(records, round.mode, round.trials).single);
      return { msg: String(ms), unit: "ms", sub: `${rank.title}${BADGES[badge] || ""}` };
    },
    foul: () => ({
      msg: "フライング！",
      sub: trial.last.kind === "guess" ? "速すぎ！ 勘で押したかも。やり直し" : "合図の前に押しちゃった。やり直し"
    }),
    late: () => ({ msg: "おそすぎ！", sub: `${T.TIMEOUT_MS / 1000}秒すぎたので、この回はやり直し` }),
    paused: () => ({ msg: "ひと休み", sub: "タップで再開" })
  };
  function renderLayer() {
    el.layer.dataset.state = trial.state;
    if (!round) return;
    const m = MESSAGES[trial.state]();
    el.msg.textContent = m.msg;
    View.text(el.unit, m.unit || "");
    el.sub.textContent = m.sub;
    const n = trial.state === "shown" ? round.times.length : T.trialNumber(round);
    el.info.textContent = `${n} / ${round.trials}回目${round.fouls ? `　フライング${round.fouls}` : ""}`;
    renderDots();
  }
  function renderDots() {
    const shown = trial.state === "shown";
    el.dots.replaceChildren(...Array.from({ length: round.trials }, (_, i) => {
      const ms = round.times[i];
      const fresh = shown && i === round.times.length - 1;
      if (ms !== undefined) return node("li", fresh ? "done fresh" : "done", String(ms));
      return node("li", i === round.times.length ? "now" : "", String(i + 1));
    }));
  }

  /* ---------- stage screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: () => ({ label: T.MODES[round.mode].label, title: "測定中", actions: [] }),
    tally: () => ({
      label: "結果発表", title: "集計中…",
      card: { main: "???", sub: `${result.trials}回の平均`, cls: "number reaction-score" }, actions: []
    }),
    result: () => ({
      label: `${T.MODES[result.mode].label}・${result.trials}回`,
      title: result.newAverage || result.newSingle ? `新記録！ ${result.rank.title}` : result.rank.title,
      card: { main: `${result.average}ms`, sub: "平均タイム", cls: `number reaction-score${result.average >= LONG_MS ? " reaction-long" : ""}` },
      hint: result.rank.note,
      actions: [makeButton("設定", () => go("setup"), "small"), makeButton("もう一回", start, "primary")]
    })
  };

  /* Small DOM builder: node("b", "num", "245ms", ...children). */
  function node(tag, cls, text, ...children) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    n.append(...children);
    return n;
  }
  function recordCell(name, ms, isNew) {
    const value = node("b", "", ms === null ? "--" : `${ms}ms`);
    const badge = isNew ? [node("em", "", "新記録！")] : [];
    return node("div", isNew ? "reaction-rec new" : "reaction-rec", "", node("span", "", name), value, ...badge);
  }
  function renderRecords(box, mode, trials, fresh = {}) {
    const best = T.bestOf(records, mode, trials);
    box.replaceChildren(node("p", "reaction-records-head", `自己ベスト（${T.MODES[mode].label}）`),
      recordCell(`平均（${trials}回）`, best.average, fresh.average), recordCell("1回の最速", best.single, fresh.single));
  }
  function timeRow(ms, i) {
    const fastest = ms === result.best;
    return node("li", fastest ? "ok" : "", "", node("span", "pos", `${i + 1}回目`), node("span", "who", T.rankFor(ms).title),
      node("b", "num", `${ms}ms`), node("span", "mark", fastest ? "最速" : ""));
  }
  function renderResult() {
    const show = ui.phase === "result";
    el.list.hidden = !show;
    el.best.hidden = !show;
    if (!show) {
      View.text(el.next, "");
      View.text(el.stats, "");
      return;
    }
    const next = T.nextRank(result.average);
    View.text(el.next, next ? `あと${next.gap}msで${next.rank.title}` : "最高ランク達成！");
    View.text(el.stats, `最速 ${result.best}ms ・ 最遅 ${result.worst}ms ・ フライング ${result.fouls}回`);
    el.list.classList.toggle("reaction-compact", result.times.length > COMPACT_AFTER);
    el.list.replaceChildren(...result.times.map(timeRow));
    renderRecords(el.best, result.mode, result.trials, { average: result.newAverage, single: result.newSingle });
  }

  function rulesFor(s) {
    const signal = s.mode === "ear"
      ? ["画面はそのまま。「ピッ」と鳴った瞬間にタップ", "音を出して遊んでね（マナーモードだと鳴らないことも）"]
      : ["「まって…」の画面が緑に変わった瞬間にタップ"];
    return [
      ...signal,
      "合図の前や、合図から0.1秒未満のタップはフライング。その回はやり直し",
      `${s.trials}回はかった平均タイムでランクが決まる`,
      "平均200ms（0.2秒）を切ればチーター級！"
    ];
  }
  function renderHero() {
    const [a, b] = HERO[settings.mode];
    const lamp = ([text, cls]) => node("span", `reaction-lamp ${cls}`, text);
    el.hero.replaceChildren(lamp(a), node("span", "reaction-arrow", ""), lamp(b));
  }
  function renderSetup() {
    renderHero();
    View.chips($("reModeChips"), T.MODE_IDS.map(id => ({ value: id, label: T.MODES[id].label })), settings.mode, v => update({ mode: v }));
    View.chips($("reTrialChips"), View.options(T.TRIAL_OPTIONS, n => `${n}回`), settings.trials, n => update({ trials: n }));
    renderRecords(el.records, settings.mode, settings.trials);
    View.text(el.note, soundBlocked() ? "いまは「音なし」です。右上のボタンで音をオンにしてね" : "");
    View.list($("reRules"), rulesFor(settings));
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    renderResult();
  }

  /* ---------- input and lifecycle ---------- */
  function onKey(e) {
    if (el.layer.hidden || e.repeat) return;
    if (e.key === "Escape") {
      requestQuit();
      return;
    }
    if (e.target === el.quit) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      press(tapTime(e));
    }
  }
  /* Leaving the page mid-trial would make the timing meaningless: replay that trial when back. */
  function onVisibility() {
    if (!document.hidden || el.layer.hidden) return;
    if (trial.state !== "wait" && trial.state !== "go") return;
    clearTimers();
    round = T.retry(round);
    setTrial({ state: "paused", last: null });
  }

  function init() {
    settings = T.normalizeSettings(Store.load(KEY, null));
    records = T.normalizeRecords(Store.load(RECORD_KEY, null));
    el.pad.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      press(tapTime(e));
    });
    el.pad.addEventListener("contextmenu", (e) => e.preventDefault());
    el.quit.addEventListener("click", requestQuit);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }
  function onShow() {
    if (ui.phase === "setup") render();
  }
  function leave() {
    if (!el.layer.hidden || ui.phase === "play" || ui.phase === "tally") quit();
  }

  return { init, onShow, leave };
})();

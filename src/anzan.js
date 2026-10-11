/* フラッシュ暗算 screen: numbers flash one at a time; add them in your head and type the total on the keypad. */
const Anzan = (() => {
  const R = AnzanRules;
  const KEY = "anzan.settings";
  const RECORD_KEY = "anzan.records";
  const LEAD_MS = 380;          /* blank board after the count-in, before the first number */
  const MIN_SHARE = 0.6;        /* a late frame still leaves each number on screen this share of its time */
  const PASS_COIN_MS = 380;
  const RESULT_SOUND_MS = 900;
  const PAD = Object.freeze(["7", "8", "9", "4", "5", "6", "1", "2", "3", "del", "0", "ok"]);
  const PAD_LABEL = Object.freeze({ del: "消す", ok: "決定" });
  const MODE_LABEL = Object.freeze({ free: "自由に", dan: "段位チャレンジ" });
  const RULES = Object.freeze({
    free: ["数字が1つずつパッと出て、すぐ消える", "出てきた数字を、頭の中でぜんぶ足していく",
      "最後に合計をキーで入れて「決定」", "まちがえるまで何問つづけて正解できるかが記録になる"],
    dan: ["10級からスタート。出てくる数字を頭の中で全部足す", "正解するたびに1つ上へ。数字が増えて、速くなる",
      "1回まちがえたら終わり。たどり着いた級・段が記録になる", "いちばん上は十段。暗算の達人をめざそう"]
  });

  const el = {
    mode: $("modeAnzan"), setup: $("azSetup"), play: $("azPlay"), label: $("azLabel"), title: $("azTitle"),
    board: $("azBoard"), num: $("azNum"), dots: $("azDots"), entry: $("azEntry"), pad: $("azPad"),
    card: $("azCard"), ladder: $("azLadder"), tape: $("azTape"), stats: $("azStats"), hint: $("azHint"), actions: $("azActions"),
    best: $("azBest"), digitsOpt: $("azDigitsOpt"), countOpt: $("azCountOpt"), speedOpt: $("azSpeedOpt")
  };

  let settings = { ...R.DEFAULTS };
  let records = R.normalizeRecords(null);
  let run = null; /* { mode, level, streak, played, startBest, celebrated, problem } */
  let ui = { phase: "setup", entry: "", result: null }; /* result: { ok, answer, isNew, streak, cleared } */
  let flash = { token: 0, raf: 0 };
  let keys = new Map();

  const freeKey = () => R.recordKey(settings.digits, settings.count, settings.speed);
  const step = () => R.LADDER[run.level];
  const currentSpec = () => (run.mode === "dan" ? step() : R.specFor(settings));
  const bestDanText = () => (records.dan > 0 ? R.danTitle(records.dan) : "まだ記録なし");

  function go(patch) {
    ui = { ...ui, ...patch };
    render();
  }
  function update(patch) {
    settings = R.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function saveRecords(next) {
    records = next;
    Store.save(RECORD_KEY, records);
  }
  /* Delayed effect that is dropped if the player has moved on. */
  function later(fn, ms) {
    const token = flash.token;
    setTimeout(() => { if (token === flash.token) fn(); }, ms);
  }

  /* ---------- sounds ---------- */
  /* Soft, same-pitch tick for every number, so the sound gives nothing away. */
  const tick = () => [[1568, 0.07, 0.06], [3136, 0.025, 0.015]].forEach(([freq, dur, vol]) => Sound.tone({ freq, dur, vol }));
  function answerCue() {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    Sound.tone({ freq: Sound.hz(84), type: "triangle", t, dur: 0.12, vol: 0.1 });
    Sound.tone({ freq: Sound.hz(91), type: "triangle", t: t + 0.09, dur: 0.24, vol: 0.1, send: 0.2 });
  }
  const keySound = (k) => Sound.tone({ freq: 560 + Number(k) * 32, type: "triangle", dur: 0.06, vol: 0.12 });

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    Sound.sfx("confirm");
    const startBest = settings.mode === "dan" ? records.dan : R.freeBest(records, freeKey());
    run = { mode: settings.mode, level: 0, streak: 0, played: 0, startBest, celebrated: false, problem: null };
    nextProblem();
  }
  function stopFlash() {
    cancelAnimationFrame(flash.raf);
    flash = { token: flash.token + 1, raf: 0 };
  }
  async function nextProblem() {
    stopFlash();
    const token = flash.token;
    run = { ...run, problem: R.newProblem(currentSpec()), played: run.played + 1 };
    go({ phase: "count", entry: "", result: null });
    await Fx.countdown("スタート！");
    if (token !== flash.token) return;
    go({ phase: "flash" });
    playFlash(token);
  }
  /* Walks the steps one at a time on the frame clock. Late frames slow the flash down but never skip a number. */
  function playFlash(token) {
    const p = run.problem;
    const steps = R.schedule(p, LEAD_MS);
    let at = 0;
    let end = performance.now() + steps[0].ms;
    showSlot(p, steps[0]);
    const frame = (now) => {
      if (token !== flash.token) return;
      if (now >= end) {
        at += 1;
        if (at >= steps.length) { endFlash(); return; }
        end = Math.max(end + steps[at].ms, now + steps[at].ms * MIN_SHARE);
        showSlot(p, steps[at]);
      }
      flash = { ...flash, raf: requestAnimationFrame(frame) };
    };
    flash = { ...flash, raf: requestAnimationFrame(frame) };
  }
  function showSlot(p, { n, passed }) {
    el.num.textContent = n >= 0 ? String(p.numbers[n]) : "";
    [...el.dots.children].forEach((d, k) => {
      d.classList.toggle("lit", k <= passed);
      d.classList.toggle("cur", k === n);
    });
    if (n < 0) return;
    Fx.replay(el.num, "anzan-in");
    tick();
  }
  function endFlash() {
    flash = { ...flash, raf: 0 };
    answerCue();
    go({ phase: "answer", entry: "" });
  }
  function toSetup() {
    stopFlash();
    run = null;
    go({ phase: "setup", entry: "", result: null });
  }

  /* ---------- answering ---------- */
  function press(k) {
    if (ui.phase !== "answer") return;
    if (ui.entry.length >= R.answerLength(run.problem.digits, run.problem.count)) return;
    if (ui.entry === "" && k === "0") return;
    keySound(k);
    go({ entry: ui.entry + k });
  }
  function erase() {
    if (ui.phase !== "answer" || !ui.entry) return;
    Sound.sfx("back");
    go({ entry: ui.entry.slice(0, -1) });
  }
  function submit() {
    if (ui.phase !== "answer" || !ui.entry) return;
    const ok = R.isCorrect(run.problem, ui.entry);
    const answer = Number(ui.entry);
    if (run.mode === "dan") (ok ? danPass : danFail)(answer);
    else (ok ? freePass : freeFail)(answer);
  }
  function freePass(answer) {
    const { cheer, ...next } = R.freeStep(run, true, 0);
    const res = R.addFree(records, freeKey(), next.streak);
    saveRecords(res.records);
    run = { ...run, ...next };
    Sound.sfx("correct");
    go({ phase: "verdict", result: { ok: true, answer, isNew: res.isNew, streak: next.streak } });
    Fx.pop(el.card);
    if (cheer) later(() => { Sound.sfx("victory"); Fx.confetti(); }, 450);
  }
  function freeFail(answer) {
    const streak = run.streak;
    const next = R.freeStep(run, false, R.freeBest(records, freeKey()));
    run = { ...run, streak: next.streak, startBest: next.startBest, celebrated: next.celebrated };
    Sound.sfx("wrong");
    go({ phase: "verdict", result: { ok: false, answer, isNew: false, streak } });
    Fx.shake(el.card);
  }
  function danPass(answer) {
    const cleared = run.level + 1;
    saveRecords(R.addDan(records, cleared).records);
    if (cleared >= R.LADDER.length) { finishDan(answer, cleared, true); return; }
    Sound.sfx("correct");
    later(() => Sound.sfx("coin"), PASS_COIN_MS);
    go({ phase: "verdict", result: { ok: true, answer, isNew: false, cleared } });
    Fx.pop(el.card);
  }
  function danFail(answer) {
    Sound.sfx("wrong");
    finishDan(answer, run.level, false);
  }
  function finishDan(answer, cleared, allClear) {
    const isNew = cleared > run.startBest;
    go({ phase: "over", result: { ok: allClear, answer, isNew, cleared } });
    Fx.pop(el.card);
    later(() => {
      if (isNew || allClear) { Sound.sfx("victory"); Fx.confetti(); } else Sound.sfx("reveal");
    }, allClear ? 0 : RESULT_SOUND_MS);
  }
  function climb() {
    run = { ...run, level: run.level + 1 };
    Sound.sfx("whoosh");
    nextProblem();
  }

  /* ---------- screens ---------- */
  const playLabel = () => (run.mode === "dan"
    ? `${step().title}に挑戦 ・ ${R.describe(step())}`
    : `${R.describe(currentSpec())} ・ 連続${run.streak}問`);
  const settingsBtn = () => makeButton("設定", toSetup, "small");
  const flashTitle = () => (run.mode === "dan" ? `${step().title}の問題` : `第${run.played}問`);

  const flashScreen = () => ({
    label: playLabel(), title: flashTitle(), hint: "数字が出たら、どんどん足していこう", actions: [makeButton("やめる", toSetup, "small")]
  });
  function verdictScreen() {
    const r = ui.result;
    const p = run.problem;
    if (run.mode === "dan") {
      const next = R.LADDER[run.level + 1];
      return {
        label: playLabel(), title: `${step().title} 合格！`,
        card: { main: String(p.total), sub: `${p.count}個の合計`, cls: "number anzan-ok" },
        hint: `次は${next.title}（${R.describe(next)}）`,
        actions: [settingsBtn(), makeButton(`${next.title}に挑戦`, climb, "primary")]
      };
    }
    const best = R.freeBest(records, freeKey());
    const bestText = best > 0 ? `自己ベスト ${best}問` : "";
    if (r.ok) {
      return {
        label: playLabel(), title: r.isNew && run.startBest > 0 ? "新記録！" : R.streakTitle(r.streak),
        card: { main: String(p.total), sub: `${p.count}個の合計`, cls: "number anzan-ok" },
        hint: `連続正解 ${r.streak}問 ・ ${bestText}`,
        actions: [settingsBtn(), makeButton("次の問題", nextProblem, "primary")]
      };
    }
    return {
      label: playLabel(), title: "ざんねん…",
      card: { main: String(p.total), sub: `が正しい答え（あなたは${r.answer}）`, cls: "number anzan-ng" },
      hint: r.streak > 0 ? `連続正解 ${r.streak}問でストップ ・ ${bestText}` : "出た数字を見て、足し算を確かめよう",
      actions: [settingsBtn(), makeButton("もう一回", nextProblem, "primary")]
    };
  }
  function overScreen() {
    const r = ui.result;
    const title = r.ok ? "全段クリア！" : r.isNew ? "新記録！" : "チャレンジ終了";
    return {
      label: "段位チャレンジの結果", title,
      card: { main: R.danTitle(r.cleared), sub: R.danNote(r.cleared), cls: "anzan-rank" },
      hint: "",
      actions: [settingsBtn(), makeButton("もう一回", start, "primary")]
    };
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    count: () => flashScreen(), flash: () => flashScreen(),
    answer: () => ({ label: playLabel(), title: "合計は？", hint: "", actions: [] }),
    verdict: verdictScreen,
    over: overScreen,
    paused: () => ({
      label: "", title: "中断しました", hint: "画面を切りかえたので、この問題はなしにしました",
      actions: [settingsBtn(), makeButton("再開", nextProblem, "primary")]
    })
  };

  /* ---------- rendering ---------- */
  const node = (tag, cls = "", text = "") => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  const withKids = (parent, ...kids) => { parent.append(...kids); return parent; };
  function renderBoard() {
    el.num.textContent = "";
    el.dots.replaceChildren(...run.problem.numbers.map(() => node("span", "anzan-dot")));
  }
  function renderEntry() {
    el.entry.replaceChildren(node("span", ui.entry ? "anzan-typed" : "anzan-ph", ui.entry || "ここに合計"), node("span", "anzan-caret"));
    const full = ui.entry.length >= R.answerLength(run.problem.digits, run.problem.count);
    keys.forEach((b, k) => {
      if (k === "del" || k === "ok") b.disabled = ui.entry === "";
      else b.disabled = full || (ui.entry === "" && k === "0");
    });
  }
  function chip(text, cls, i) {
    const s = node("span", `anzan-chip ${cls}`.trim(), text);
    s.style.setProperty("--i", String(i));
    return s;
  }
  function renderTape() {
    const r = ui.result;
    const show = !!r && !r.ok && (ui.phase === "verdict" || ui.phase === "over");
    el.tape.hidden = !show;
    if (!show) return;
    const p = run.problem;
    const nums = p.numbers.map((n, i) => chip(String(n), i > 0 ? "add" : "", i));
    el.tape.replaceChildren(node("p", "anzan-tape-head", `出た数字（${p.count}個）`), ...nums, chip(`= ${p.total}`, "sum", p.count));
  }
  /* 10級 to 十段 as a row of pips: cleared steps lit, the next (or missed) one outlined. */
  function renderLadder() {
    const r = ui.result;
    const show = run?.mode === "dan" && !!r && (ui.phase === "verdict" || ui.phase === "over");
    el.ladder.hidden = !show;
    if (!show) return;
    const mark = ui.phase === "over" ? "miss" : "next";
    const pips = R.LADDER.map((s, k) => node("span", `anzan-pip${k >= 10 ? " dan" : ""}${k < r.cleared ? " done" : k === r.cleared ? ` ${mark}` : ""}`));
    const ends = [R.LADDER[0], R.LADDER[R.LADDER.length - 1]].map(s => node("span", "anzan-ladder-end", s.title));
    el.ladder.replaceChildren(ends[0], withKids(node("span", "anzan-pips"), ...pips), ends[1]);
  }
  function renderStats() {
    const r = ui.result;
    const show = ui.phase === "over" && !!r;
    el.stats.hidden = !show;
    if (!show) return;
    const rows = [
      ["合格した数", `${r.cleared} / ${R.LADDER.length}`],
      ["自己ベスト", bestDanText()],
      ...(r.ok ? [] : [["まちがえた問題", R.describe(run.problem)], ["あなたの答え", String(r.answer)]])
    ];
    el.stats.replaceChildren(...rows.map(([k, v]) => withKids(node("li"), node("span", "", k), node("b", "", v))));
  }
  function renderPlay() {
    const ph = ui.phase;
    const flashing = ph === "count" || ph === "flash";
    el.board.hidden = !flashing;
    el.entry.hidden = ph !== "answer";
    el.pad.hidden = ph !== "answer";
    if (flashing) renderBoard();
    if (ph === "answer") renderEntry();
    renderLadder();
    renderTape();
    renderStats();
  }
  function renderSetup() {
    const free = settings.mode === "free";
    View.chips($("azModeChips"), R.MODES.map(m => ({ value: m, label: MODE_LABEL[m] })), settings.mode, m => update({ mode: m }));
    [el.digitsOpt, el.countOpt, el.speedOpt].forEach(o => { o.hidden = !free; });
    View.chips($("azDigitsChips"), View.options(R.DIGITS, d => `${d}けた`), settings.digits, d => update({ digits: d }));
    View.chips($("azCountChips"), View.options(R.COUNTS, n => `${n}口`), settings.count, n => update({ count: n }));
    View.chips($("azSpeedChips"), R.SPEED_IDS.map(id => ({ value: id, label: `${R.SPEEDS[id].label} ${R.seconds(R.SPEEDS[id].ms)}` })),
      settings.speed, id => update({ speed: id }));
    const best = R.freeBest(records, freeKey());
    el.best.textContent = free
      ? `この設定の自己ベスト：${best > 0 ? `連続${best}問正解` : "まだ記録なし"}`
      : `自己ベスト：${bestDanText()}`;
    View.list($("azRules"), RULES[settings.mode]);
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase !== "setup") renderPlay();
  }

  /* ---------- input ---------- */
  function buildPad() {
    const handler = { del: erase, ok: submit };
    const buttons = PAD.map(k => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = PAD_LABEL[k] ? `key anzan-key fn ${k}` : "key anzan-key";
      b.textContent = PAD_LABEL[k] || k;
      b.addEventListener("click", () => (handler[k] ? handler[k]() : press(k)));
      return [k, b];
    });
    keys = new Map(buttons);
    el.pad.replaceChildren(...buttons.map(([, b]) => b));
  }
  function onKey(e) {
    if (el.mode.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target instanceof HTMLButtonElement;
    if (ui.phase === "answer") {
      const onPad = onButton && el.pad.contains(e.target);
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); erase(); }
      else if (e.key === "Enter" && (onPad || !onButton)) { e.preventDefault(); submit(); }
      return;
    }
    if (e.key === "Enter" && !onButton && ["verdict", "over", "paused"].includes(ui.phase)) {
      e.preventDefault();
      el.actions.querySelector(".primary")?.click();
    }
  }
  /* Leaving the tab mid-flash would break the timing, so that problem is dropped. */
  function onVisibility() {
    if (!document.hidden || !(ui.phase === "count" || ui.phase === "flash")) return;
    stopFlash();
    go({ phase: "paused" });
  }

  function init() {
    settings = R.normalizeSettings(Store.load(KEY, null));
    records = R.normalizeRecords(Store.load(RECORD_KEY, null));
    buildPad();
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }
  function leave() {
    stopFlash();
    if (ui.phase === "setup") return;
    run = null;
    ui = { phase: "setup", entry: "", result: null };
    render();
  }

  return { init, leave };
})();

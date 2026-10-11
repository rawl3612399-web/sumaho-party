/* IQ challenge screen: 20 generated puzzles with a timer ring, instant feedback, and a playful IQ-style estimate. */
const IqChallenge = (() => {
  const Q = IqRules;
  const KEY = "iq.settings";
  const RECORD_KEY = "iq.records";
  const FEEDBACK_MS = Object.freeze({ ok: 900, ng: 1800 });
  const DRUM_MS = 1600;
  const COUNT_UP_MS = 900;
  const URGENT_SEC = 5;
  const RING = 2 * Math.PI * 19;
  const NOTE = "遊びの目安です。本物のIQ検査ではありません";
  const TIMING_LABEL = Object.freeze({ timed: "1問30秒", free: "じっくり" });
  const ASK = Object.freeze({
    seq: "? に入る数は？", matrix: "? に入る図形は？", odd: "仲間はずれはどれ？",
    rotate: "回すと同じになるのは？", relation: "? に入る数は？"
  });
  const HINTS = Object.freeze({
    seq: "数の並び方のルールを見つけよう",
    matrix: "横の列ごとに、形・数・ぬり方・向きのルールがある",
    odd: "1つだけ、ほかの3つと違うルールのものがある",
    rotate: "裏返した形はハズレ。回すだけでぴったり重なるものを選ぼう",
    pairs: "左の数が、同じルールで右の数に変わる",
    ops: "○ はどの行も同じ計算",
    grid: "横の列には、どれも同じルールがある"
  });

  const el = {
    mode: $("modeIqChallenge"), setup: $("iqSetup"), play: $("iqPlay"),
    label: $("iqLabel"), title: $("iqTitle"), card: $("iqCard"), hint: $("iqHint"), actions: $("iqActions"),
    hud: $("iqHud"), quit: $("iqQuit"), count: $("iqCount"), bar: $("iqBar"),
    ring: $("iqRing"), ringBar: $("iqRingBar"), ringNum: $("iqRingNum"),
    question: $("iqQuestion"), choices: $("iqChoices"), detail: $("iqDetail"),
    best: $("iqBest"), timeChips: $("iqTimeChips"), rules: $("iqRules"), error: $("iqError")
  };

  let settings = Q.normalizeSettings(null);
  let records = Q.normalizeRecords(null);
  let run = null;
  let ui = { phase: "setup", picked: null, streak: 0, error: "" };
  let clock = { start: 0, spent: 0, raf: 0, lastSec: null };
  let pending = [];
  let session = 0;
  let uidSeq = 0;
  let outcome = null;
  let countRaf = 0;

  const reduced = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timed = () => !!run && run.timing === "timed";
  const nextUid = () => `iqH${++uidSeq}`;
  const shown = () => (ui.phase === "question" ? Q.current(run) : run.questions[run.answers.length - 1]);
  const typeName = (id) => Q.TYPES.find(t => t.id === id).name;

  function update(patch) {
    settings = Q.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(patch) {
    ui = { ...ui, ...patch };
    render();
  }
  function later(ms, fn) {
    const id = setTimeout(() => {
      pending = pending.filter(x => x !== id);
      fn();
    }, ms);
    pending = [...pending, id];
  }
  function halt() {
    pending.forEach(clearTimeout);
    pending = [];
    cancelAnimationFrame(countRaf);
    stopClock();
  }

  /* ---------- per-question clock (pauses while the page is hidden) ---------- */
  const elapsed = () => clock.spent + (clock.start ? performance.now() - clock.start : 0);
  function stopClock() {
    cancelAnimationFrame(clock.raf);
    clock = { ...clock, spent: elapsed(), start: 0, raf: 0 };
  }
  function runClock() {
    clock = { ...clock, start: performance.now() };
    if (timed()) tick();
  }
  function tick() {
    const left = Q.TIME_LIMIT_SEC * 1000 - elapsed();
    paintRing(left);
    if (left <= 0) {
      choose(null);
      return;
    }
    const sec = Math.ceil(left / 1000);
    if (sec !== clock.lastSec && sec <= URGENT_SEC) Sound.sfx("tick", sec % 2 === 0);
    clock = { ...clock, lastSec: sec, raf: requestAnimationFrame(tick) };
  }
  function paintRing(left) {
    const ms = Math.max(0, left);
    const sec = Math.ceil(ms / 1000);
    el.ringBar.style.strokeDashoffset = String(RING * (1 - ms / (Q.TIME_LIMIT_SEC * 1000)));
    el.ringNum.textContent = String(sec);
    el.ring.classList.toggle("urgent", sec <= URGENT_SEC);
  }

  /* ---------- flow ---------- */
  async function start() {
    if (ui.phase === "count") return;
    Sound.ensure();
    Awake.keep();
    halt();
    const token = ++session;
    try {
      run = Q.newRun(settings.timing);
    } catch (e) {
      Sound.sfx("wrong");
      go({ phase: "setup", error: "問題を作れませんでした。もう一度押してください" });
      return;
    }
    outcome = null;
    Sound.sfx("confirm");
    go({ phase: "count", picked: null, streak: 0, error: "" });
    await Fx.countdown("スタート！");
    if (token !== session || ui.phase !== "count") return;
    Music.play("think");
    ask();
  }
  function ask() {
    buildQuestion(Q.current(run));
    clock = { start: 0, spent: 0, raf: 0, lastSec: null };
    go({ phase: "question", picked: null });
    Sound.sfx("flip");
    el.question.classList.remove("fx-shake"); /* a leftover shake class would block the pop below */
    Fx.pop(el.question);
    paintRing(Q.TIME_LIMIT_SEC * 1000);
    if (!document.hidden) runClock();
  }
  /* choice: 0-3, or null when the time ran out. */
  function choose(choice) {
    if (ui.phase !== "question") return;
    stopClock();
    const q = Q.current(run);
    run = Q.submit(run, choice, clock.spent);
    const ok = choice === q.answer;
    const streak = ok ? ui.streak + 1 : 0;
    Sound.sfx(ok ? "correct" : "wrong");
    if (ok && streak >= 3) later(280, () => Sound.sfx("coin"));
    if (!ok) Fx.shake(el.question);
    go({ phase: "feedback", picked: choice, streak });
    later(ok ? FEEDBACK_MS.ok : FEEDBACK_MS.ng, () => (Q.finished(run) ? judge() : ask()));
  }
  function judge() {
    Music.stop();
    go({ phase: "judge" });
    Sound.sfx("drumroll", DRUM_MS / 1000);
    later(DRUM_MS, reveal);
  }
  function reveal() {
    const res = Q.result(run);
    const up = Q.updateRecords(records, run.timing, res);
    records = up.records;
    Store.save(RECORD_KEY, records);
    outcome = { result: res, isNew: up.isNew };
    go({ phase: "result" });
    Fx.pop(el.card);
    countUp(res.iq);
    if (up.isNew) {
      Sound.sfx("victory");
      Fx.confetti();
    } else {
      Sound.sfx(res.iq >= 110 ? "fanfare" : "reveal");
    }
  }
  function countUp(to) {
    const main = el.card.querySelector(".wc-main");
    if (!main || reduced()) return;
    const from = Q.IQ_MIN;
    const t0 = performance.now();
    main.textContent = String(from);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / COUNT_UP_MS);
      main.textContent = String(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
      if (p < 1) countRaf = requestAnimationFrame(step);
    };
    countRaf = requestAnimationFrame(step);
  }
  function quit() {
    session++;
    halt();
    Music.stop();
    run = null;
    go({ phase: "setup" });
  }

  /* ---------- question markup (numbers come from the rules, so they are safe to inline) ---------- */
  function box(cls, html) {
    const d = document.createElement("div");
    d.className = cls;
    d.innerHTML = html;
    return d;
  }
  const term = (v) => (v === null ? '<span class="iq-term iq-blank">?</span>' : `<span class="iq-term">${v}</span>`);
  const sym = (s) => `<span class="iq-op" aria-hidden="true">${s}</span>`;
  const PROMPTS = {
    seq: (p) => box("iq-seq", p.terms.map(term).join("")),
    pairs: (p) => box("iq-pairs", [...p.pairs, [p.query, null]].map(([x, y]) => `<div class="iq-row">${term(x)}${sym("→")}${term(y)}</div>`).join("")),
    ops: (p) => box("iq-ops", p.rows.map(([a, b, c]) => `<div class="iq-row">${term(a)}${sym("○")}${term(b)}${sym("=")}${term(c)}</div>`).join("")),
    grid: (p) => box("iq-grid", p.rows.flat().map(term).join("")),
    matrix: (p) => box("iq-matrix", Q.matrixSvg(p.cells, nextUid())),
    rotate: (p) => box("iq-model", `<span class="iq-tag">この図形を回すと…</span>${Q.figureSvg(p.figure, nextUid())}`),
    odd: (p) => (p.example ? box("iq-model", `<span class="iq-tag">なかまの例</span>${Q.figureSvg(p.example, nextUid())}`) : null)
  };
  function choiceButton(c, i) {
    const b = document.createElement("button");
    const isNum = typeof c === "number";
    b.type = "button";
    b.className = "iq-choice";
    b.setAttribute("aria-label", isNum ? `${i + 1}番 ${c}` : `${i + 1}番の図形`);
    b.innerHTML = `<span class="iq-key" aria-hidden="true">${i + 1}</span>${isNum ? `<span class="iq-num">${c}</span>` : Q.figureSvg(c, nextUid())}`;
    b.addEventListener("click", () => choose(i));
    return b;
  }
  function buildQuestion(q) {
    const prompt = PROMPTS[q.prompt.kind](q.prompt);
    el.question.replaceChildren(...(prompt ? [prompt] : []));
    el.choices.className = `iq-choices ${typeof q.choices[0] === "number" ? "iq-numbers" : "iq-figures"}`;
    el.choices.replaceChildren(...q.choices.map(choiceButton));
  }

  /* ---------- screens ---------- */
  const labelFor = (q) => `${typeName(q.type)}・レベル${q.level + 1}`;
  function hintFor(q) {
    if (q.type === "relation") return HINTS[q.prompt.kind];
    if (q.type === "odd" && q.prompt.example) return "「なかまの例」と同じルールにならないものが1つだけある";
    return HINTS[q.type];
  }
  function feedbackView() {
    const last = run.answers[run.answers.length - 1];
    const title = last.correct ? "正解！" : last.choice === null ? "時間切れ！" : "ざんねん…";
    const hint = last.correct ? (ui.streak >= 3 ? `${ui.streak}問連続で正解！` : "いい調子！") : "「正解」の印がついたものが答え";
    return { label: labelFor(shown()), title, hint, actions: [] };
  }
  function resultView() {
    const { result: res, isNew } = outcome;
    return {
      label: "結果発表",
      title: isNew ? `新記録！ ${res.title}` : res.title,
      card: { main: String(res.iq), sub: "IQ目安", cls: "number iq-score" },
      hint: NOTE,
      actions: [makeButton("設定", () => go({ phase: "setup" }), "small"), makeButton("もう一回", start, "primary")]
    };
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    count: () => ({ actions: [] }),
    question: () => ({ label: labelFor(shown()), title: ASK[shown().type], hint: hintFor(shown()), actions: [] }),
    feedback: feedbackView,
    judge: () => ({ label: "採点中", title: "あなたのIQ目安は…", card: { main: "？", back: true }, actions: [] }),
    result: resultView
  };

  function renderAsking() {
    const total = run.questions.length;
    const done = run.answers.length;
    const q = shown();
    el.count.textContent = `${ui.phase === "question" ? done + 1 : done} / ${total}`;
    el.bar.style.width = `${(done / total) * 100}%`;
    el.ring.hidden = !timed();
    [...el.choices.children].forEach((b, i) => {
      b.disabled = ui.phase !== "question";
      b.dataset.state = ui.phase !== "feedback" ? "" : i === q.answer ? "right" : i === ui.picked ? "wrong" : "dim";
    });
  }
  function detailRow(name, value, rate) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="iq-d-name"></span><span class="iq-d-bar" aria-hidden="true"><span></span></span><b class="iq-d-val"></b>';
    li.querySelector(".iq-d-name").textContent = name;
    li.querySelector(".iq-d-val").textContent = value;
    const bar = li.querySelector(".iq-d-bar");
    bar.hidden = rate === null;
    bar.firstChild.style.width = `${Math.round((rate || 0) * 100)}%`;
    return li;
  }
  function renderDetail() {
    const res = outcome.result;
    const best = records[run.timing];
    el.detail.replaceChildren(
      detailRow("正解", `${res.correct} / ${res.total}問`, res.correct / res.total),
      ...res.byType.map(t => detailRow(t.name, `${t.correct} / ${t.total}`, t.total ? t.correct / t.total : 0)),
      detailRow("平均タイム", `${res.avgSec.toFixed(1)}秒`, null),
      detailRow("自己ベスト", best ? `IQ目安 ${best.iq}` : "-", null)
    );
  }
  function renderPlay() {
    const asking = ui.phase === "question" || ui.phase === "feedback";
    el.hud.hidden = !asking;
    el.choices.hidden = !asking;
    el.question.hidden = !asking || el.question.childElementCount === 0;
    el.detail.hidden = ui.phase !== "result";
    if (asking) renderAsking();
    if (ui.phase === "result") renderDetail();
  }
  function bestNodes() {
    const best = records[settings.timing];
    const make = (tag, cls, text) => {
      const n = document.createElement(tag);
      n.className = cls;
      n.textContent = text;
      return n;
    };
    return [
      make("span", "iq-best-label", `自己ベスト（${TIMING_LABEL[settings.timing]}）`),
      make("b", "iq-best-num", best ? String(best.iq) : "--"),
      make("span", "iq-best-sub", best ? `IQ目安・${best.correct} / ${Q.TOTAL}問正解` : "まだ記録なし")
    ];
  }
  function renderSetup() {
    View.chips(el.timeChips, Q.TIMINGS.map(t => ({ value: t, label: TIMING_LABEL[t] })), settings.timing, v => update({ timing: v }));
    el.best.replaceChildren(...bestNodes());
    View.text(el.error, ui.error);
    View.list(el.rules, [
      "数列・図形の規則・仲間はずれ・図形の回転・数の関係の5種類、全20問",
      "4つの中から答えをタップ。後半ほど難しくなる",
      settings.timing === "timed" ? "1問30秒。時間切れは不正解になる" : "時間制限なし。じっくり考えてOK",
      "最後に正解数と「IQ目安」が出る。問題は毎回ちがう"
    ]);
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase !== "setup") renderPlay();
  }

  /* ---------- input and lifecycle ---------- */
  function onKey(e) {
    if (el.mode.hidden || ui.phase !== "question" || e.repeat) return;
    const i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i < 0) return;
    e.preventDefault();
    Sound.sfx("tap");
    choose(i);
  }
  function onVisibility() {
    if (ui.phase !== "question") return;
    if (document.hidden) stopClock();
    else if (!clock.start) runClock();
  }
  function init() {
    settings = Q.normalizeSettings(Store.load(KEY, null));
    records = Q.normalizeRecords(Store.load(RECORD_KEY, null));
    el.ringBar.style.strokeDasharray = String(RING);
    el.quit.addEventListener("click", quit);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }
  function leave() {
    session++;
    halt();
    if (ui.phase !== "setup" && ui.phase !== "result") run = null;
    ui = { ...ui, phase: run ? ui.phase : "setup" };
    render();
  }

  return { init, leave };
})();

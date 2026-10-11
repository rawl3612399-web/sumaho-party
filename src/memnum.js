/* 瞬間記憶 screen: remember a flashed digit string (数字) or where 1..n sat on a grid (位置). 3 lives, a record per mode. */
const MemNum = (() => {
  const R = MemNumRules;
  const KEY = "memnum.settings";
  const RECORD_KEY = "memnum.records";
  const MS = Object.freeze({ ready: 700, next: 1000, finish: 1100, coin: 280, guard: 350 });
  const LABEL = Object.freeze({ digits: "数字", chimp: "位置" });
  const UNIT = Object.freeze({ digits: "けた", chimp: "個" });
  const PENTA = Object.freeze([0, 2, 4, 7, 9]);
  const OK_KEY = "ok";
  const PAD = Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9", R.DELETE, "0", OK_KEY]);
  const CELL_ARIA = Object.freeze({ empty: "空きマス", cleared: "タップ済み", wrong: "まちがい", expected: "ここが正解", covered: "かくれた数字" });
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4s-7.6-4.5-9.4-9.1C1.3 8 3.3 4.6 6.7 4.6c2.2 0 3.7 1.3 5.3 3.1 1.6-1.8 3.1-3.1 5.3-3.1 3.4 0 5.4 3.4 4.1 6.7-1.8 4.6-9.4 9.1-9.4 9.1z"/></svg>';
  const RULES = Object.freeze({
    digits: [
      "数字が少しのあいだだけ表示される。消える前に覚えよう",
      "消えたら、下のキーで同じ数字を入れて「決定」",
      `正解すると1けたずつ長くなる。${R.START.digits}けたからスタート`,
      `ミス${R.LIVES}回で終了。覚えられた一番長いけた数が記録`
    ],
    chimp: [
      "マスのあちこちに、1から順に数字が出る。場所を覚えよう",
      "1をタップすると、ほかの数字はかくれる",
      "のこりを2、3、4…と順番にタップ",
      `成功すると1個ずつふえる。${R.START.chimp}個からスタート`,
      `ミス${R.LIVES}回で終了。覚えられた一番多い個数が記録`
    ]
  });

  const el = {
    mode: $("modeMemNum"), setup: $("mnSetup"), play: $("mnPlay"), label: $("mnLabel"), title: $("mnTitle"),
    card: $("mnCard"), hint: $("mnHint"), actions: $("mnActions"), setupBest: $("mnSetupBest"),
    hud: $("mnHud"), level: $("mnLevel"), lives: $("mnLives"), hudBest: $("mnHudBest"),
    flash: $("mnFlash"), digits: $("mnDigits"), bar: $("mnTimerBar"), slots: $("mnSlots"),
    compare: $("mnCompare"), grid: $("mnGrid"), keypad: $("mnKeypad"), details: $("mnDetails")
  };

  let settings = { mode: "digits" };
  let records = R.normalizeRecords(null);
  let game = null;
  let ui = { phase: "setup", entry: "", judge: null, board: null, ok: false, isNew: false };
  let timers = [];
  let run = 0;
  let cells = [];
  let keys = new Map();
  let armedAt = 0;

  const unit = () => UNIT[game ? game.mode : settings.mode];
  /* Beating an earlier record mid-game (a first game has nothing to beat yet). */
  const beating = () => records[game.mode] > 0 && game.best > records[game.mode];
  const sizeOf = (len) => (len <= 5 ? "1" : len <= 8 ? "2" : len <= 12 ? "3" : "4");
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  function node(tag, cls, text = "") {
    const n = document.createElement(tag);
    n.className = cls;
    n.textContent = text;
    return n;
  }
  function after(ms, fn) {
    const id = run;
    timers = [...timers, setTimeout(() => { if (id === run) fn(); }, ms)];
  }
  function go(patch) {
    if (patch.phase && patch.phase !== ui.phase) armedAt = performance.now() + MS.guard;
    ui = { ...ui, ...patch };
    render();
  }
  /* Action buttons ignore a tap right after the screen changes (a double tap on つづける must not hit やめる). */
  const action = (label, fn, cls) => makeButton(label, () => { if (performance.now() >= armedAt) fn(); }, cls);
  function setMode(mode) {
    settings = { mode };
    Store.save(KEY, settings);
    render();
  }

  /* A bright tone that climbs a pentatonic scale with each correct tap. */
  function chime(i) {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const step = Math.min(Math.max(i, 0), 14);
    const freq = Sound.hz(64 + 12 * Math.floor(step / 5) + PENTA[step % 5]);
    const t = ctx.currentTime;
    Sound.tone({ freq, type: "triangle", t, dur: 0.22, vol: 0.16, send: 0.18 });
    Sound.tone({ freq: freq * 2, type: "sine", t, dur: 0.1, vol: 0.05 });
  }

  /* ---------- flow ---------- */
  async function start() {
    Sound.ensure();
    Awake.keep();
    clearTimers();
    run += 1;
    const id = run;
    game = R.newGame(settings.mode);
    Sound.sfx("confirm");
    go({ phase: "count", entry: "", judge: null, board: null, ok: false, isNew: false });
    await Fx.countdown("スタート！");
    if (id !== run || ui.phase !== "count") return;
    Music.play("think");
    beginRound();
  }
  function beginRound() {
    clearTimers();
    if (game.mode === "digits") {
      go({ phase: "ready", entry: "", judge: null });
      after(MS.ready, showDigits);
      return;
    }
    go({ phase: "chimp", board: R.newBoard(game.round.cells) });
    Sound.sfx("pop");
    Fx.pop(el.grid);
  }
  function showDigits() {
    const ms = R.showMs(game.level);
    go({ phase: "show" });
    Sound.sfx("pop");
    Fx.pop(el.digits);
    drainBar(ms);
    after(ms, () => {
      Sound.sfx("whoosh");
      go({ phase: "input", entry: "" });
    });
  }
  function setBar(scale, ms = 0) {
    el.bar.style.transition = ms ? `transform ${ms}ms linear` : "none";
    el.bar.style.transform = `scaleX(${scale})`;
  }
  function drainBar(ms) {
    setBar(1);
    void el.bar.offsetWidth;
    setBar(0, ms);
  }
  function press(key) {
    if (ui.phase !== "input") return;
    if (key === OK_KEY) { submit(); return; }
    const entry = R.enter(ui.entry, key, game.level);
    if (entry === ui.entry) return;
    if (key === R.DELETE) Sound.sfx("back");
    else chime(entry.length - 1);
    go({ entry });
  }
  function submit() {
    if (ui.phase !== "input" || ui.entry.length !== game.level) return;
    const answer = game.round.answer;
    const judge = { ...R.checkDigits(answer, ui.entry), answer, input: ui.entry };
    settleRound(judge.ok, { judge });
  }
  function tapCell(cell) {
    if (ui.phase !== "chimp") return;
    const { board, result } = R.tap(ui.board, cell);
    if (result === "none") return;
    if (result === "miss") { settleRound(false, { board }); return; }
    if (board.next === 2) Sound.sfx("flip");
    chime(board.next - 2);
    if (result === "done") settleRound(true, { board });
    else go({ board });
  }
  function settleRound(ok, patch) {
    clearTimers();
    const wasBeating = beating();
    game = R.settle(game, ok);
    go({ ...patch, phase: "judge", ok });
    if (ok) {
      Sound.sfx("correct");
      if (!wasBeating && beating()) after(MS.coin, () => Sound.sfx("coin"));
      Fx.pop(game.mode === "digits" ? el.compare : el.grid);
      after(game.over ? MS.finish : MS.next, game.over ? finish : beginRound);
      return;
    }
    Sound.sfx("wrong");
    Fx.shake();
    if (game.over) Fx.flash("--alert", 500);
  }
  function finish() {
    clearTimers();
    Music.stop();
    const res = R.applyRecord(records, game.mode, game.best);
    records = res.records;
    Store.save(RECORD_KEY, records);
    go({ phase: "over", isNew: res.isNew });
    Fx.pop(el.card);
    const cheer = res.isNew || game.cleared;
    Sound.sfx(cheer ? "victory" : "reveal");
    if (cheer) Fx.confetti();
  }
  function stop() {
    if (!game) return;
    run += 1;
    game = R.quit(game);
    finish();
  }

  /* ---------- screens ---------- */
  const quitButton = () => action("やめる", stop, "small");
  function judgeScreen() {
    if (ui.ok) {
      const up = beating() ? "自己ベスト更新中！ " : "";
      return { title: game.cleared ? "完全クリア！" : "正解！", hint: game.over ? "" : `${up}次は${game.level}${unit()}`, actions: [] };
    }
    const answer = game.mode === "chimp" ? `正しくは「${ui.board.next}」。` : "";
    return {
      title: "ざんねん…",
      hint: game.over ? `${answer}ミス${R.LIVES}回で終了` : `${answer}のこり${game.lives}回`,
      actions: [action(game.over ? "結果を見る" : "つづける", game.over ? finish : beginRound, "primary")]
    };
  }
  function overScreen() {
    const rank = R.rankFor(game.mode, game.best);
    return {
      label: ui.isNew ? "新記録！" : `${LABEL[game.mode]}の結果`,
      title: `「${rank.title}」`,
      card: { main: `${game.best}${unit()}`, sub: rank.note, cls: "memnum-score" },
      hint: game.cleared ? "最後までクリア。おみごと！" : game.quit ? "とちゅうでやめました" : "",
      actions: [action("設定", () => go({ phase: "setup" }), "small"), action("もう一回", start, "primary")]
    };
  }
  const SCREENS = {
    setup: () => ({ actions: [action("はじめる", start, "primary")] }),
    count: () => ({ title: "準備はいい？", hint: game.mode === "digits" ? "数字はすぐ消えます" : "数字の場所を覚えよう", actions: [] }),
    ready: () => ({ title: "よく見て…", actions: [quitButton()] }),
    show: () => ({ title: "覚えて！", actions: [quitButton()] }),
    input: () => ({ title: "さっきの数字は？", actions: [quitButton()] }),
    chimp: () => ({
      title: ui.board.covered ? "つづきをタップ" : "1から順にタップ",
      hint: ui.board.covered ? `のこり${ui.board.cells.length - ui.board.next + 1}個` : "1を押すと、ほかの数字はかくれます",
      actions: [quitButton()]
    }),
    judge: judgeScreen,
    over: overScreen
  };

  /* ---------- rendering ---------- */
  function renderHud() {
    const show = ui.phase !== "over";
    el.hud.hidden = !show;
    if (!show) return;
    el.level.textContent = `${game.level}${unit()}`;
    el.hudBest.textContent = `${Math.max(records[game.mode], game.best)}${unit()}`;
    el.hudBest.classList.toggle("up", beating());
    [...el.lives.children].forEach((h, i) => h.classList.toggle("lost", i >= game.lives));
    el.lives.setAttribute("aria-label", `のこり${game.lives}回`);
  }
  function renderFlash() {
    const show = ui.phase === "ready" || ui.phase === "show";
    el.flash.hidden = !show;
    if (!show) return;
    const waiting = ui.phase === "ready";
    el.digits.textContent = waiting ? "•".repeat(game.level) : game.round.answer;
    el.digits.dataset.size = sizeOf(game.level);
    el.digits.classList.toggle("wait", waiting);
    if (waiting) setBar(1);
  }
  function renderSlots() {
    const show = ui.phase === "input";
    el.slots.hidden = !show;
    el.keypad.hidden = !show;
    if (!show) return;
    const len = game.level;
    const n = ui.entry.length;
    el.slots.style.setProperty("--cols", String(len <= 10 ? len : Math.ceil(len / 2)));
    el.slots.dataset.rows = len <= 10 ? "1" : "2";
    el.slots.replaceChildren(...Array.from({ length: len }, (_, i) => node("span",
      ["memnum-slot", i < n ? "filled" : "", i === n ? "cur" : "", i === n - 1 ? "new" : ""].filter(Boolean).join(" "), ui.entry[i] || "")));
    keys.forEach((b, k) => {
      b.disabled = k === OK_KEY ? n < len : k === R.DELETE ? n === 0 : n >= len;
      b.classList.toggle("ready", k === OK_KEY && n >= len);
    });
  }
  /* One row of the answer check; digits whose mark is false get `cls` (fix = should be, ng = typed wrong). */
  function compareRow(name, text, marks, cls) {
    const line = node("span", "memnum-line");
    line.dataset.size = sizeOf(text.length);
    line.append(...text.split("").map((d, i) => node("span", marks && !marks[i] ? `memnum-d ${cls}` : "memnum-d", d)));
    const row = node("div", "memnum-row");
    row.append(node("span", "memnum-tag", name), line);
    return row;
  }
  function renderCompare() {
    const show = ui.phase === "judge" && game.mode === "digits";
    el.compare.hidden = !show;
    if (!show) return;
    const j = ui.judge;
    el.compare.classList.toggle("ok", ui.ok);
    el.compare.replaceChildren(...(ui.ok
      ? [compareRow("正解", j.answer, null, "")]
      : [compareRow("正解", j.answer, j.marks, "fix"), compareRow("あなた", j.input, j.marks, "ng")]));
  }
  function renderGrid() {
    const show = Boolean(ui.board) && (ui.phase === "chimp" || (ui.phase === "judge" && game.mode === "chimp"));
    el.grid.hidden = !show;
    if (!show) return;
    cells.forEach((b, cell) => {
      const v = R.cellState(ui.board, cell, ui.phase === "judge");
      const cls = `key memnum-cell ${v.state}`;
      const text = v.shown ? String(v.num) : "";
      if (b.className !== cls) b.className = cls;
      if (b.textContent !== text) b.textContent = text;
      b.disabled = !v.tappable;
      b.setAttribute("aria-label", [text, CELL_ARIA[v.state]].filter(Boolean).join("、"));
    });
  }
  function renderDetails() {
    const show = ui.phase === "over";
    el.details.hidden = !show;
    el.label.classList.toggle("memnum-newrec", show && ui.isNew);
    if (!show) return;
    const s = R.stats(game);
    const lines = [["成功", `${s.hits} / ${s.tries}回`], ["正解率", `${s.accuracy}%`], ["自己ベスト", `${records[game.mode]}${unit()}`]];
    el.details.replaceChildren(...lines.map(([k, v]) => {
      const li = node("li", "");
      li.append(node("span", "who", k), node("b", "num", v));
      return li;
    }));
  }
  function renderSetup() {
    View.chips($("mnModeChips"), R.MODES.map(m => ({ value: m, label: LABEL[m] })), settings.mode, setMode);
    const best = records[settings.mode];
    const parts = best > 0
      ? [["memnum-best-label", "自己ベスト"], ["memnum-best-num", `${best}${unit()}`], ["memnum-best-rank", `「${R.rankFor(settings.mode, best).title}」`]]
      : [["memnum-best-label", "自己ベスト"], ["memnum-best-rank", "まだ記録はありません"]];
    el.setupBest.replaceChildren(...parts.map(([cls, t]) => node("span", cls, t)));
    View.list($("mnRules"), RULES[settings.mode]);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase === "setup") return;
    renderHud();
    renderFlash();
    renderSlots();
    renderCompare();
    renderGrid();
    renderDetails();
  }

  /* ---------- setup ---------- */
  /* Pointer taps react on press (memory games feel faster); keyboard Enter/Space still works through click. */
  function bindTap(b, fn) {
    b.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      fn();
    });
    b.addEventListener("click", (e) => { if (e.detail === 0) fn(); });
  }
  function makeKey(label, cls, fn) {
    const b = node("button", cls, label);
    b.type = "button";
    bindTap(b, fn);
    return b;
  }
  function build() {
    cells = Array.from({ length: R.CELLS }, (_, cell) => makeKey("", "key memnum-cell empty", () => tapCell(cell)));
    el.grid.style.setProperty("--cols", String(R.COLS));
    el.grid.replaceChildren(...cells);
    keys = new Map(PAD.map(k => [k, makeKey(k === OK_KEY ? "決定" : k === R.DELETE ? "消す" : k,
      `key memnum-key${k === OK_KEY ? " ok" : k === R.DELETE ? " del" : ""}`, () => press(k))]));
    el.keypad.replaceChildren(...keys.values());
    el.lives.replaceChildren(...Array.from({ length: R.LIVES }, () => {
      const s = node("span", "memnum-heart");
      s.innerHTML = HEART;
      return s;
    }));
  }
  /* Desktop: type digits, Backspace, Enter. */
  function onKey(e) {
    if (el.mode.hidden || ui.phase !== "input" || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.closest("input, textarea")) return;
    const key = /^\d$/.test(e.key) ? e.key : e.key === "Backspace" ? R.DELETE : e.key === "Enter" ? OK_KEY : null;
    if (!key || (key === OK_KEY && target && target.closest("button"))) return;
    e.preventDefault();
    press(key);
  }

  function init() {
    const s = Store.load(KEY, {}) || {};
    settings = { mode: R.MODES.includes(s.mode) ? s.mode : "digits" };
    records = R.normalizeRecords(Store.load(RECORD_KEY, null));
    build();
    document.addEventListener("keydown", onKey);
    render();
  }
  /* Back to the game list: stop timers; an unfinished game is dropped, but its best so far still counts as a record. */
  function leave() {
    clearTimers();
    run += 1;
    if (ui.phase === "setup" || ui.phase === "over") return;
    if (game && game.best > 0) {
      records = R.applyRecord(records, game.mode, game.best).records;
      Store.save(RECORD_KEY, records);
    }
    go({ phase: "setup" });
  }

  return { init, leave };
})();

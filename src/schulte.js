/* 1〜25タッチ screen (Schulte table): tap 1, 2, 3... in order as fast as you can. A wrong tap costs one second.
 * Board sizes 3×3 / 4×4 / 5×5 and three variants; personal bests per size and variant. */
const Schulte = (() => {
  const S = SchulteRules;
  const KEY = "schulte.settings";
  const RECORD_KEY = "schulte.records";
  const BOARD_PHASES = ["ready", "play", "pause", "cleared"];
  const CLEAR_DELAY_MS = 550;
  const REVEAL_MS = 520;
  const PLUS_MS = 760;
  const FINAL_STRETCH = 5;
  const BASE_NOTE = 67;
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const RISE_STEPS = 14;
  const TAP_GUARD_MS = 400; /* a double tap must not also hit the button that appears under the finger */
  const VARIANT_RULES = {
    normal: "ふつう：押したマスは数字が見えたまま、沈んで薄くなる",
    shuffle: "シャッフル：正しく押すたびに、残りの数字の場所がぜんぶ入れかわる",
    vanish: "消える：押したマスはパッと消えて、盤面がだんだん空いていく"
  };
  const PLAY_HINTS = {
    normal: "まちがえると1秒プラス",
    shuffle: "押すたびに数字が入れかわる！",
    vanish: "押したマスは消えていく"
  };

  const el = {
    mode: $("modeSchulte"), setup: $("scSetup"), play: $("scPlay"), label: $("scLabel"), title: $("scTitle"),
    card: $("scCard"), hint: $("scHint"), actions: $("scActions"), hud: $("scHud"), next: $("scNext"),
    time: $("scTime"), miss: $("scMiss"), progress: $("scProgress"), grid: $("scGrid"), details: $("scDetails"),
    records: $("scRecords"), rules: $("scRules"), sizeChips: $("scSizeChips"), variantChips: $("scVariantChips")
  };
  const progressFill = el.progress.firstElementChild;

  let settings = { ...S.DEFAULTS };
  let records = {};
  let game = null;
  let result = null;
  let ui = { phase: "setup", at: 0 };
  let clock = { base: 0, since: 0, raf: 0 };
  let cells = [];
  let timers = { clear: 0, reveal: 0 };
  let countdownId = 0;
  let countdownBusy = Promise.resolve();
  let swapFlip = false;

  const sizeText = (n) => `${n}×${n}`;
  const modeText = (g) => `${sizeText(g.size)}・${S.VARIANT_LABELS[g.variant]}`;
  const secText = (ms) => `${S.timeText(ms)}${ms < 60000 ? "秒" : ""}`;
  const hundredths = (ms) => (Math.ceil(ms / 10) / 100).toFixed(2);

  function update(patch) {
    settings = S.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(phase) {
    ui = { phase, at: performance.now() };
    render();
  }
  const guard = (fn) => () => { if (performance.now() - ui.at >= TAP_GUARD_MS) fn(); };
  function stopTimers() {
    Object.values(timers).forEach(clearTimeout);
    timers = { clear: 0, reveal: 0 };
  }

  /* ---------- clock (base = ms already run, since = start of the running stretch) ---------- */
  const elapsed = () => clock.base + (clock.since ? performance.now() - clock.since : 0);
  const paintTime = () => { el.time.textContent = S.timeText(S.totalMs(game, elapsed())); };
  function frame() {
    paintTime();
    clock = { ...clock, raf: requestAnimationFrame(frame) };
  }
  function runClock() {
    cancelAnimationFrame(clock.raf);
    clock = { ...clock, since: performance.now(), raf: 0 };
    frame();
  }
  function holdClock() {
    cancelAnimationFrame(clock.raf);
    clock = { base: elapsed(), since: 0, raf: 0 };
  }

  /* ---------- sounds ---------- */
  /* Each correct tap climbs a major scale (up to two octaves over the whole board). */
  function noteFor(k) {
    const span = Math.min(game.count - 1, RISE_STEPS);
    const step = Math.round((k * span) / Math.max(1, game.count - 1));
    return BASE_NOTE + SCALE[step % SCALE.length] + 12 * Math.floor(step / SCALE.length);
  }
  function hitSound(k) {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = Sound.hz(noteFor(k));
    Sound.tone({ freq: f / 2, glide: f, glideTime: 0.03, type: "sine", t, dur: 0.17, vol: 0.22 });
    Sound.tone({ freq: f * 2, type: "triangle", t, dur: 0.07, vol: 0.04 });
    Sound.hiss({ t, dur: 0.025, vol: 0.05, type: "highpass", freq: 2500 });
  }

  /* ---------- flow ---------- */
  async function start() {
    Sound.ensure();
    Awake.keep();
    stopTimers();
    cancelAnimationFrame(clock.raf);
    game = S.newGame(settings.size, settings.variant);
    clock = { base: 0, since: 0, raf: 0 };
    result = null;
    buildGrid();
    Sound.sfx("confirm");
    go("ready");
    window.scrollTo(0, 0); /* small phones: keep the timer out from under the sticky top bar */
    const id = ++countdownId;
    await countdownBusy; /* a countdown from a run that was left is still on screen: never stack two */
    if (id !== countdownId || ui.phase !== "ready") return;
    countdownBusy = Fx.countdown("スタート！");
    await countdownBusy;
    if (id !== countdownId || ui.phase !== "ready") return;
    if (document.hidden) {
      go("pause");
      return;
    }
    Music.play("rush");
    go("play");
    revealBoard();
    runClock();
  }
  function onTap(i) {
    if (ui.phase !== "play" || !Number.isInteger(i)) return;
    const { game: next, outcome } = S.tap(game, i, elapsed());
    game = next;
    if (outcome === "miss") miss(i);
    else if (outcome !== "done") hit(i, outcome === "clear");
  }
  function hit(i, clear) {
    hitSound(S.found(game) - 1);
    paintBoard();
    Fx.replay(cells[i], "schulte-hit");
    if (game.variant === "shuffle" && !clear) flipSwap();
    paintHud(true);
    if (S.remaining(game) === FINAL_STRETCH) Music.intensify();
    if (clear) finish();
  }
  function miss(i) {
    Sound.sfx("wrong");
    Sound.vibrate(70);
    Fx.replay(cells[i], "schulte-miss");
    Fx.replay(el.time, "schulte-penalty");
    floatPenalty();
    paintHud(false);
  }
  function floatPenalty() {
    const plus = document.createElement("span");
    plus.className = "schulte-plus";
    plus.textContent = `+${S.PENALTY_MS / 1000}秒`;
    el.hud.appendChild(plus);
    setTimeout(() => plus.remove(), PLUS_MS);
  }
  function finish() {
    holdClock();
    Music.stop();
    const rawMs = Math.round(clock.base);
    const ms = Math.max(1, S.totalMs(game, clock.base));
    const saved = S.recordRun(records, game.size, game.variant, { ms, mistakes: game.mistakes });
    records = saved.records;
    if (saved.isNew) Store.save(RECORD_KEY, records);
    result = {
      ms, rawMs, isNew: saved.isNew, previous: saved.previous,
      rank: S.rankFor(ms, game.size, game.variant), up: S.nextRank(ms, game.size, game.variant)
    };
    go("cleared");
    Fx.pop(el.time);
    timers = { ...timers, clear: setTimeout(showResult, CLEAR_DELAY_MS) };
  }
  function showResult() {
    if (ui.phase !== "cleared") return;
    go("result");
    Fx.pop(el.card);
    if (result.isNew) {
      Sound.sfx("victory");
      Fx.confetti();
    } else {
      Sound.sfx(result.rank.index <= 1 ? "fanfare" : "correct");
    }
  }
  function pause(silent = false) {
    if (ui.phase !== "play") return;
    holdClock();
    Music.stop();
    if (!silent) Sound.sfx("back");
    go("pause");
  }
  function resume() {
    if (ui.phase !== "pause") return;
    Sound.sfx("go");
    Music.play("rush");
    if (S.remaining(game) <= FINAL_STRETCH) Music.intensify();
    go("play");
    revealBoard();
    runClock();
  }
  function quit() {
    const running = BOARD_PHASES.includes(ui.phase);
    countdownId++;
    stopTimers();
    holdClock();
    if (running) Music.stop();
    go("setup");
  }

  /* ---------- board ---------- */
  function buildGrid() {
    el.grid.className = "schulte-grid";
    el.grid.style.setProperty("--n", String(game.size));
    cells = game.cells.map((_, i) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "schulte-cell";
      c.dataset.i = String(i);
      c.style.setProperty("--d", String(Math.floor(i / game.size) + (i % game.size)));
      return c;
    });
    el.grid.replaceChildren(...cells);
  }
  function paintBoard() {
    const covered = ui.phase === "ready" || ui.phase === "pause";
    el.grid.classList.toggle("schulte-covered", covered);
    el.grid.classList.toggle("schulte-vanish", game.variant === "vanish");
    cells.forEach((c, i) => {
      const n = game.cells[i];
      const done = S.isDone(game, i);
      c.textContent = covered ? "" : String(n);
      c.classList.toggle("schulte-done", done);
      c.setAttribute("aria-disabled", String(done || covered));
      c.setAttribute("aria-label", covered ? "かくれたマス" : done ? `${n}、タッチ済み` : String(n));
    });
  }
  /* Two animation names in turn, so the shuffle flick restarts without forcing a layout per cell. */
  function flipSwap() {
    swapFlip = !swapFlip;
    el.grid.classList.toggle("schulte-swap-a", swapFlip);
    el.grid.classList.toggle("schulte-swap-b", !swapFlip);
  }
  function revealBoard() {
    clearTimeout(timers.reveal);
    el.grid.classList.remove("schulte-swap-a", "schulte-swap-b");
    Fx.replay(el.grid, "schulte-reveal");
    timers = { ...timers, reveal: setTimeout(() => el.grid.classList.remove("schulte-reveal"), REVEAL_MS) };
  }
  function paintHud(bump) {
    const done = S.finished(game);
    el.next.textContent = done ? "—" : String(game.next);
    el.miss.textContent = String(game.mistakes);
    el.miss.classList.toggle("schulte-has-miss", game.mistakes > 0);
    progressFill.style.transform = `scaleX(${(S.found(game) / game.count).toFixed(3)})`;
    if (bump && !done) Fx.replay(el.next, "schulte-bump");
    paintTime();
  }

  /* ---------- screens ---------- */
  const playActions = (canQuit, canPause) => [
    makeButton("やめる", guard(quit), "small", !canQuit),
    makeButton("一時停止", guard(() => pause()), "", !canPause)
  ];
  function resultHint() {
    const note = result.rank.note;
    if (!result.up) return `${note}。最高ランク！`;
    return `${note}。あと${hundredths(result.up.gapMs)}秒で${result.up.title}！`;
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", guard(start), "primary")] }),
    ready: () => ({ label: modeText(game), hint: "1から順番にタッチ！", actions: playActions(false, false) }),
    play: () => ({ label: modeText(game), hint: PLAY_HINTS[game.variant], actions: playActions(true, true) }),
    pause: () => ({
      label: modeText(game),
      title: "一時停止中",
      hint: "数字はかくしてあるよ。つづけると時計も動き出す",
      actions: [makeButton("やめる", guard(quit), "small"), makeButton("つづける", guard(resume), "primary")]
    }),
    cleared: () => ({ label: modeText(game), hint: "クリア！", actions: playActions(false, false) }),
    result: () => ({
      label: modeText(game),
      title: result.isNew ? "新記録！" : "クリア！",
      card: { main: secText(result.ms), sub: result.rank.title, cls: `schulte-result${result.isNew ? " schulte-new" : ""}` },
      hint: resultHint(),
      actions: [makeButton("設定", guard(() => go("setup")), "small"), makeButton("もう一回", guard(start), "primary")]
    })
  };

  function bestText() {
    if (result.isNew) return result.previous ? `${secText(result.previous.ms)} → ${secText(result.ms)}` : "はじめての記録";
    const best = S.bestOf(records, game.size, game.variant);
    return best ? secText(best.ms) : "—";
  }
  function textEl(tag, text, cls = "") {
    const n = document.createElement(tag);
    n.className = cls;
    n.textContent = text;
    return n;
  }
  function detailRow([label, value, cls]) {
    const li = textEl("li", "", cls || "");
    li.append(textEl("span", label), textEl("b", value));
    return li;
  }
  function renderDetails() {
    const show = ui.phase === "result";
    el.details.hidden = !show;
    if (!show) return;
    const slow = S.slowest(game);
    const rows = [
      ["内訳", game.mistakes ? `${secText(result.rawMs)} ＋ ミス${game.mistakes}秒` : "ノーミス！"],
      ["正確さ", `${Math.round(S.accuracy(game) * 100)}%（ミス${game.mistakes}回）`],
      ["1つあたり", `${(result.ms / game.count / 1000).toFixed(2)}秒`],
      slow ? ["いちばん迷った数字", `${slow.n}（${(slow.ms / 1000).toFixed(2)}秒）`] : null,
      ["自己ベスト", bestText(), result.isNew ? "schulte-best-new" : ""]
    ].filter(Boolean);
    el.details.replaceChildren(...rows.map(detailRow));
  }

  function renderRecords() {
    const head = ["", ...S.SIZES.map(sizeText)].map(t => textEl("span", t, "schulte-rec-head"));
    const rows = S.VARIANTS.flatMap(v => [
      textEl("span", S.VARIANT_LABELS[v], "schulte-rec-name"),
      ...S.SIZES.map(n => {
        const best = S.bestOf(records, n, v);
        const on = n === settings.size && v === settings.variant ? " schulte-rec-on" : "";
        return textEl("span", best ? S.timeText(best.ms) : "—", `schulte-rec-cell${on}${best ? "" : " schulte-rec-empty"}`);
      })
    ]);
    const table = textEl("div", "", "schulte-records-grid");
    table.replaceChildren(...head, ...rows);
    el.records.replaceChildren(textEl("span", "自己ベスト", "schulte-records-title"), table);
  }
  function renderSetup() {
    View.chips(el.sizeChips, View.options(S.SIZES, sizeText), settings.size, n => update({ size: n }));
    View.chips(el.variantChips, View.options(S.VARIANTS, v => S.VARIANT_LABELS[v]), settings.variant, v => update({ variant: v }));
    View.list(el.rules, [
      `1〜${settings.size * settings.size}の数字がバラバラに並んでいる。1から順番に、できるだけ速くタッチ`,
      VARIANT_RULES[settings.variant],
      `ちがう数字を押すとミス。1回につき${S.PENALTY_MS / 1000}秒プラス`,
      "上の「つぎ」に次の数字が出る。タイムで称号が決まる"
    ]);
    renderRecords();
  }

  function render() {
    const board = BOARD_PHASES.includes(ui.phase);
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    [el.hud, el.progress, el.grid].forEach(n => { n.hidden = !board; });
    if (board) {
      paintBoard();
      paintHud(false);
    }
    renderDetails();
  }

  /* ---------- input ---------- */
  function bindGrid() {
    el.grid.addEventListener("pointerdown", (e) => {
      const c = e.target.closest(".schulte-cell");
      if (!c || e.button > 0) return;
      e.preventDefault();
      onTap(Number(c.dataset.i));
    });
    el.grid.addEventListener("click", (e) => {
      e.stopPropagation(); /* the cells have their own sounds; skip the app-wide click sound */
      const c = e.target.closest(".schulte-cell");
      if (c && e.detail === 0) onTap(Number(c.dataset.i)); /* keyboard: Enter / Space */
    });
    el.grid.addEventListener("animationend", (e) => {
      if (e.target.classList.contains("schulte-cell")) e.target.classList.remove("schulte-hit", "schulte-miss");
    });
  }
  function onKey(e) {
    if (el.mode.hidden || e.key !== "Escape") return;
    if (ui.phase === "play") pause();
    else if (ui.phase === "pause") resume();
  }

  function init() {
    settings = S.normalizeSettings(Store.load(KEY, null));
    records = S.normalizeRecords(Store.load(RECORD_KEY, null));
    bindGrid();
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });
    document.addEventListener("keydown", onKey);
    render();
  }
  function leave() {
    if (BOARD_PHASES.includes(ui.phase)) quit();
  }
  const onShow = () => { ui = { ...ui, at: performance.now() }; }; /* opening the game counts for the tap guard */

  return { init, onShow, leave };
})();

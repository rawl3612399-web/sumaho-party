/* 神経衰弱 screen: real playing cards in a phone-sized grid. Solo time attack, 2-4 players, or a CPU that remembers. */
const Memory = (() => {
  const M = MemoryRules;
  const KEY = "memory.settings";
  const RECORD_KEY = "memory.records";
  const MS = Object.freeze({ cpu: 450, cpuSecond: 650, match: 520, fly: 640, miss: 900, dealStep: 22 });
  const CHROME_PX = 290; /* height around the grid besides the score bar: top bar, title, hint, buttons, paddings */
  const GAP_PX = 6;
  const SIDES = ["first", "second", "random"];
  const GROUP_SIZES = [2, 3, 4];
  const LABEL = Object.freeze({
    solo: "ひとりで", group: "みんなで", cpu: "CPUと", first: "先攻", second: "後攻", random: "ランダム",
    easy: "よわい", normal: "ふつう", hard: "つよい"
  });
  /* How each ending sounds: [sound, confetti]. */
  const MOODS = Object.freeze({ win: ["victory", true], cheer: ["fanfare", true], clear: ["fanfare", false], lose: ["lose", false], draw: ["reveal", false] });

  const el = {
    setup: $("sSetup"), play: $("sPlay"), label: $("sLabel"), title: $("sTitle"), hint: $("sHint"),
    actions: $("sActions"), grid: $("sGrid"), scores: $("sScores"), result: $("sResult"), record: $("sRecord"),
    mode: $("modeMemory")
  };

  let settings = { vs: "cpu", players: 2, level: "normal", side: "first", pairs: 12 };
  let match = { mode: "cpu", names: ["あなた", "CPU"], first: 0, cpuSeat: 1, level: "normal" };
  let game = null;
  let memory = {};
  let ui = { phase: "setup", wait: null, confirm: false, end: null };
  let slots = [];
  let sides = [];
  let flying = [];
  let timers = [];
  let clock = { banked: 0, since: 0, running: false, ticker: 0 };

  const cls = (...names) => names.filter(Boolean).join(" ");
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const solo = () => match.mode === "solo";
  const isCpuTurn = () => match.mode === "cpu" && game.turn === match.cpuSeat;
  const who = (i) => match.names[i];
  const sec = (ms) => Math.floor(ms / 1000);

  function normalize(s) {
    const src = s && typeof s === "object" ? s : {};
    const pick = (list, key, fallback) => (list.includes(src[key]) ? src[key] : fallback);
    return {
      vs: pick(M.MODES, "vs", "cpu"), players: pick(GROUP_SIZES, "players", 2), level: pick(M.LEVELS, "level", "normal"),
      side: pick(SIDES, "side", "first"), pairs: pick(M.PAIR_COUNTS, "pairs", 12)
    };
  }
  function update(patch) {
    settings = normalize({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(patch) {
    ui = { ...ui, ...patch };
    render();
  }
  /* timers holds only pending timeouts: each one drops itself when it fires. */
  function after(ms, fn) {
    const id = setTimeout(() => { timers = timers.filter(t => t !== id); fn(); }, ms);
    timers = [...timers, id];
  }
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  /* ---------- solo clock and records ---------- */
  const elapsed = () => clock.banked + (clock.running ? performance.now() - clock.since : 0);
  function runClock() {
    if (!clock.running) clock = { ...clock, since: performance.now(), running: true, ticker: setInterval(paintTime, 250) };
  }
  function stopClock(keep) {
    clearInterval(clock.ticker);
    clock = { banked: keep ? elapsed() : 0, since: 0, running: false, ticker: 0 };
  }
  const loadRecords = () => M.normalizeRecords(Store.load(RECORD_KEY, {}));
  const recordLine = (r) => `${r.tries}手・${View.clock(sec(r.ms))}`;
  const recordText = (best = loadRecords()[settings.pairs]) => (best ? `自己ベスト（${settings.pairs}組）：${recordLine(best)}` : "");

  /* ---------- sounds ---------- */
  const at = (fn) => { const ctx = Sound.ctx(); if (ctx) fn(ctx.currentTime); };
  const soundMiss = () => at(t => {
    Sound.tone({ freq: Sound.hz(67), type: "sine", t, dur: 0.16, vol: 0.13, filter: { freq: 1400 } });
    Sound.tone({ freq: Sound.hz(62), type: "sine", t: t + 0.14, dur: 0.3, vol: 0.12, filter: { freq: 1200 }, send: 0.15 });
  });
  const soundBack = () => at(t => Sound.hiss({ t, dur: 0.08, vol: 0.07, type: "bandpass", freq: 3200, to: 1500 }));
  const soundNope = () => Sound.tone({ freq: 160, type: "square", dur: 0.07, vol: 0.04, filter: { freq: 800 } });
  const soundLand = () => at(t => Sound.tone({ freq: Sound.hz(84), type: "triangle", t, dur: 0.12, vol: 0.08 }));
  function soundMatch(chain) {
    Sound.sfx("coin");
    if (chain > 1) at(t => Sound.tone({ freq: Sound.hz(Math.min(100, 86 + chain * 2)), type: "triangle", t: t + 0.2, dur: 0.3, vol: 0.07, send: 0.25 }));
  }
  const soundDeal = (n) => at(t => {
    for (let i = 0; i < n; i += 2) Sound.hiss({ t: t + (i * MS.dealStep) / 1000, dur: 0.04, vol: 0.05, type: "highpass", freq: 3500 });
  });

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    clearTimers();
    stopClock(false);
    const humanFirst = settings.side === "random" ? Math.random() < 0.5 : settings.side === "first";
    match = { ...M.seating(settings.vs, settings.players, humanFirst), level: settings.level };
    game = M.newGame({ pairs: settings.pairs, players: match.names.length, first: match.first });
    memory = M.newMemory();
    flying = [];
    buildScores();
    buildGrid();
    Sound.sfx("confirm");
    Music.play("think");
    go({ phase: "play", wait: "deal", confirm: false, end: null });
    soundDeal(game.cards.length);
    after(reduced() ? 0 : game.cards.length * MS.dealStep + 380, next);
  }
  /* Decides what happens after every flip or settled pair. */
  function next() {
    if (ui.phase !== "play") return;
    if (game.over) finish();
    else if (!isCpuTurn()) go({ wait: null });
    else {
      go({ wait: "cpu" });
      after(game.open.length ? MS.cpuSecond : MS.cpu, cpuFlip);
    }
  }
  function cpuFlip() {
    if (ui.phase !== "play" || ui.confirm || !isCpuTurn()) return;
    let i;
    try {
      i = M.cpuPick(game, memory);
    } catch (e) {
      console.error("神経衰弱: CPUのカードを決められませんでした", e);
      i = M.closed(game)[0];
    }
    reveal(i);
  }
  function tapSlot(i) {
    if (ui.phase !== "play" || ui.wait || ui.confirm || isCpuTurn()) return;
    if (M.canFlip(game, i)) reveal(i);
    else soundNope();
  }
  function reveal(i) {
    game = M.flip(game, i);
    if (match.mode === "cpu") memory = M.observe(memory, game, [i], match.level);
    Sound.sfx("flip");
    if (solo()) runClock();
    if (game.open.length === 2) settle();
    else if (isCpuTurn()) next();
    else render();
  }
  function settle() {
    const outcome = M.pending(game);
    go({ wait: outcome });
    if (outcome === "match") {
      after(160, () => soundMatch(game.chain + 1));
      after(MS.match, collect);
    } else {
      after(260, soundMiss);
      after(MS.miss, flipBack);
    }
  }
  /* The pair lifts off and flies into the player's score box; the score counts up when it lands. */
  function collect() {
    const pair = game.open;
    const by = game.turn;
    launch(pair, target(by));
    game = M.resolve(game);
    flying = pair;
    go({ wait: "fly" });
    after(reduced() ? 320 : MS.fly, () => {
      flying = [];
      soundLand();
      next();
      Fx.pop(target(by));
    });
  }
  function flipBack() {
    game = M.resolve(game);
    soundBack();
    if (game.players > 1) Sound.sfx("whoosh");
    next();
    if (game.players > 1) Fx.pop(el.title);
  }
  const target = (by) => (solo() ? sides[0] : sides[by]).count;
  function launch(pair, goalEl) {
    const goal = goalEl.getBoundingClientRect();
    pair.forEach(i => {
      const box = slots[i].getBoundingClientRect();
      slots[i].firstChild.style.setProperty("--memory-dx", `${Math.round(goal.left + goal.width / 2 - box.left - box.width / 2)}px`);
      slots[i].firstChild.style.setProperty("--memory-dy", `${Math.round(goal.top + goal.height / 2 - box.top - box.height / 2)}px`);
    });
  }
  function finish() {
    clearTimers();
    stopClock(true);
    Music.stop();
    const end = solo() ? soloEnd() : M.verdict(game, match);
    go({ phase: "result", wait: null, confirm: false, end });
    const [sfx, confetti] = MOODS[end.mood];
    Sound.sfx(sfx);
    if (confetti) Fx.confetti();
  }
  function soloEnd() {
    const rec = { tries: game.tries, ms: Math.round(elapsed()) };
    const best = loadRecords()[game.pairs];
    const isNew = M.isBetter(rec, best);
    if (isNew) Store.save(RECORD_KEY, { ...loadRecords(), [game.pairs]: rec });
    const hint = `${game.pairs}組を ${recordLine(rec)} でそろえました`;
    return { rec, best, isNew, winners: [], hint, title: isNew ? "新記録！" : "クリア！", mood: isNew ? "win" : "clear" };
  }
  /* Pausing (quit dialog, leaving the game, the phone going to the background) stops timers and the clock;
   * resume() picks up from the current state. */
  function pause() {
    clearTimers();
    stopClock(true);
    flying = [];
    ui = { ...ui, wait: null };
  }
  function resume() {
    if (ui.phase !== "play" || timers.length) return; /* already running: never start a second chain */
    flying = [];
    if (solo() && (game.tries > 0 || game.open.length > 0)) runClock();
    if (game.open.length === 2) settle();
    else next();
  }
  const askQuit = () => { pause(); go({ confirm: true }); };
  const keepPlaying = () => { ui = { ...ui, confirm: false }; resume(); };
  const quit = () => { pause(); Music.stop(); go({ phase: "setup", confirm: false }); };

  /* ---------- screens ---------- */
  function playView() {
    if (!ui.confirm) return { ...M.status(game, match, ui.wait), actions: [makeButton("やめる", askQuit, "small", ui.wait === "deal")] };
    return {
      title: "やめますか？",
      hint: "このゲームはここで終わりになります",
      actions: [makeButton("つづける", keepPlaying, "small"), makeButton("やめる", quit, "primary danger")]
    };
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: playView,
    result: () => ({
      label: "結果", title: ui.end.title, hint: ui.end.hint,
      actions: [makeButton("設定", () => go({ phase: "setup" }), "small"), makeButton("もう一回", start, "primary")]
    })
  };

  /* ---------- painting ---------- */
  function buildScores() {
    const n = solo() ? 3 : match.names.length;
    el.scores.style.setProperty("--memory-n", String(n));
    el.scores.classList.toggle("memory-stack", n > 2);
    sides = Array.from({ length: n }, () => {
      const box = document.createElement("div");
      box.className = "memory-side";
      box.innerHTML = '<span class="memory-name"></span><b class="memory-count"></b>';
      return { box, name: box.children[0], count: box.children[1] };
    });
    el.scores.replaceChildren(...sides.map(s => s.box));
  }
  const shownScore = (i) => game.scores[i] - (flying.length && game.last && game.last.by === i ? 1 : 0);
  function paintTime() {
    if (solo() && sides[2]) sides[2].count.textContent = View.clock(sec(elapsed()));
  }
  function paintScores() {
    const winners = ui.phase === "result" ? ui.end.winners : [];
    const solos = [["ペア", `${shownScore(0)}/${game.pairs}`], ["手数", String(game.tries)], ["時間", ""]];
    sides.forEach((s, i) => {
      const on = !solo() && ui.phase === "play" && game.turn === i;
      s.box.classList.toggle("on", on);
      s.box.classList.toggle("won", winners.includes(i));
      s.box.classList.toggle("thinking", on && ui.wait === "cpu");
      s.name.textContent = solo() ? solos[i][0] : who(i);
      s.count.textContent = solo() ? solos[i][1] : String(shownScore(i));
    });
    paintTime();
  }
  function buildGrid() {
    slots = game.cards.map((card, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.i = String(i);
      b.style.setProperty("--memory-i", String(i));
      const face = Cards.el(card, { faceDown: true, size: "md" });
      face.setAttribute("aria-hidden", "true");
      b.appendChild(face);
      return b;
    });
    el.grid.replaceChildren(...slots);
  }
  function paintGrid() {
    const res = ui.wait === "match" || ui.wait === "miss" ? ui.wait : null;
    el.grid.classList.toggle("memory-locked", ui.phase !== "play" || Boolean(ui.wait) || ui.confirm || isCpuTurn());
    slots.forEach((slot, i) => {
      const open = game.open.includes(i);
      const fly = flying.includes(i);
      const gone = game.owner[i] !== M.NONE && !fly;
      Cards.setFaceDown(slot.firstChild, !(open || fly));
      slot.className = cls("memory-slot", ui.wait === "deal" && "memory-deal", open && "memory-open",
        open && res === "match" && "memory-hit", open && res === "miss" && "memory-miss", fly && "memory-fly", gone && "memory-gone");
      slot.disabled = gone;
      const what = gone ? "取られたカード" : open || fly ? Cards.label(game.cards[i]) : "ふせたカード";
      slot.setAttribute("aria-label", `${i + 1}枚目 ${what}`);
    });
  }
  function resultRows(end) {
    if (!solo()) {
      return M.standings(game).order.map(o =>
        ({ pos: `${o.rank}位`, who: who(o.player), num: `${o.score}組`, mark: end.winners.includes(o.player) ? "勝ち" : "", ok: o.rank === 1 }));
    }
    const row = (pos, r, mark, ok) => ({ pos, who: `${r.tries}手`, num: View.clock(sec(r.ms)), mark, ok });
    const now = row("今回", end.rec, end.isNew ? "新記録" : "", end.isNew);
    return end.best ? [now, row(end.isNew ? "前のベスト" : "自己ベスト", end.best, "", false)] : [now];
  }
  function rowEl(row) {
    const li = document.createElement("li");
    li.className = row.ok ? "ok" : "";
    li.append(...["pos", "who", "num", "mark"].map(k =>
      Object.assign(document.createElement(k === "num" ? "b" : "span"), { className: k, textContent: row[k] })));
    return li;
  }
  function paintResult() {
    const show = ui.phase === "result";
    el.result.hidden = !show;
    el.grid.hidden = show;
    if (show) el.result.replaceChildren(...resultRows(ui.end).map(rowEl));
  }
  /* Sizes the cards so 8 and 12 pairs fit the phone screen without scrolling. */
  function fit() {
    if (!game || el.play.hidden || !el.play.clientWidth) return;
    try {
      const height = Math.max(200, window.innerHeight - CHROME_PX - el.scores.offsetHeight);
      const L = M.gridLayout(game.cards.length, el.play.clientWidth, height, { gap: GAP_PX });
      el.grid.style.setProperty("--memory-cols", String(L.cols));
      el.grid.style.setProperty("--memory-w", `${L.w}px`);
    } catch (e) {
      console.error("神経衰弱: カードの大きさを決められませんでした", e);
    }
  }
  function renderSetup() {
    const vs = settings.vs;
    const chips = (id, values, key, label = (v) => LABEL[v]) =>
      View.chips($(id), View.options(values, label), settings[key], v => update({ [key]: v }));
    chips("sVsChips", M.MODES, "vs");
    chips("sPlayerChips", GROUP_SIZES, "players", n => `${n}人`);
    chips("sLevelChips", M.LEVELS, "level");
    chips("sSideChips", SIDES, "side");
    chips("sPairChips", M.PAIR_COUNTS, "pairs", n => `${n}組`);
    $("sPlayersOpt").hidden = vs !== "group";
    $("sLevelOpt").hidden = vs !== "cpu";
    $("sSideOpt").hidden = vs !== "cpu";
    View.list($("sRules"), M.rulesText(vs, settings.pairs));
    View.text(el.record, vs === "solo" ? recordText() : "");
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    else {
      paintScores();
      paintGrid();
      paintResult();
      fit();
    }
    View.stage(el, SCREENS[ui.phase]());
  }

  function init() {
    settings = normalize(Store.load(KEY, {}));
    el.grid.addEventListener("click", (e) => {
      const slot = e.target.closest(".memory-slot");
      if (!slot) return;
      e.stopPropagation(); /* the flip sound replaces the app's generic button tap */
      tapSlot(Number(slot.dataset.i));
    });
    window.addEventListener("resize", fit);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }
  /* Leaving mid-game pauses it; coming back picks up where it stopped. */
  function leave() {
    clearTimers();
    if (ui.phase !== "play") return;
    pause();
    ui = { ...ui, confirm: false };
  }
  /* The phone going to the background (a call, another app) pauses play, so the solo clock does not run on. */
  function onVisibility() {
    if (ui.phase !== "play" || ui.confirm || el.mode.hidden) return;
    if (document.hidden) pause();
    else resume();
  }
  function onShow() {
    fit();
    if (ui.phase !== "play" || !game) return;
    Music.play("think");
    resume();
  }

  return { init, leave, onShow };
})();

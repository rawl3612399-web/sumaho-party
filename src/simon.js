/* Simon screen: watch the four pads light up, then tap them in the same order. The sequence grows each round.
 * Pad tones form an A major chord (E3, A3, C#4, E4), built with Sound.tone; clockwise from top-left they rise. */
const Simon = (() => {
  const R = SimonRules;
  const KEY = "simon.settings";
  const RECORD_KEY = "simon.records";
  const PADS = Object.freeze([
    { name: "緑", mark: "●", midi: 52 },
    { name: "赤", mark: "▲", midi: 57 },
    { name: "黄", mark: "■", midi: 64 },
    { name: "青", mark: "◆", midi: 61 }
  ].map(Object.freeze));
  const KEYMAP = Object.freeze({ "1": 0, "2": 1, "3": 2, "4": 3, q: 0, w: 1, a: 2, s: 3 });
  const MODE_LABEL = Object.freeze({ normal: "ふつう", easy: "やさしい" });
  const SPIN = Object.freeze([0, 1, 3, 2]);
  const MS = Object.freeze({
    spinDelay: 320, spinStep: 110, lead: 650, speedUpLead: 1150, press: 260, chime: 200,
    clear: 950, milestone: 1500, blink: 170, blinkDelay: 420, retry: 1900, over: 1900, resume: 600
  });
  const MILESTONE = 5;
  const TAP_GUARD_MS = 400; /* a double tap must not also hit the button that appears under the finger */
  const ACTIVE = Object.freeze(["intro", "watch", "input", "feedback"]);
  const BOARD_STATE = Object.freeze({ clear: "clear", perfect: "clear", retry: "miss", over: "miss" });
  const HUB_FEEDBACK = Object.freeze({ clear: "クリア", perfect: "クリア", retry: "もう一度", over: "ミス" });

  const el = {
    mode: $("modeSimon"), setup: $("siSetup"), play: $("siPlay"), label: $("siLabel"), title: $("siTitle"),
    card: $("siCard"), hint: $("siHint"), actions: $("siActions"), wrap: $("siWrap"), board: $("siBoard"),
    hub: $("siHub"), round: $("siRound"), hubState: $("siHubState"), badge: $("siBadge"), progress: $("siProgress"),
    best: $("siBest"), bestStat: $("siBestStat"), speed: $("siSpeed"), stats: $("siStats"),
    modeChips: $("siModeChips"), setupBest: $("siSetupBest"), rules: $("siRules"), rankList: $("siRankList")
  };
  const pads = [...el.board.querySelectorAll(".simon-pad")];

  let settings = R.normalizeSettings(null);
  let records = R.normalizeRecords(null);
  let game = null;
  let result = null;
  let ui = { phase: "setup", kind: "", miss: -1, suspended: false, at: 0 };
  let timers = [];
  let litUntil = [0, 0, 0, 0];

  const loadRecords = () => R.normalizeRecords(Store.load(RECORD_KEY, null));
  const padText = (i) => (PADS[i] ? `${PADS[i].name}の${PADS[i].mark}` : "");
  const haptic = (ms) => { if (typeof Sound.vibrate === "function") Sound.vibrate(ms); };

  /* The tap guard restarts only when the buttons change (setup, playing, result), not on every round step. */
  const screenOf = (phase) => (ACTIVE.includes(phase) ? "play" : phase);
  function go(patch) {
    const next = { ...ui, ...patch };
    ui = { ...next, at: screenOf(next.phase) !== screenOf(ui.phase) ? performance.now() : ui.at };
    render();
  }
  const guard = (fn) => () => { if (performance.now() - ui.at >= TAP_GUARD_MS) fn(); };

  /* ---------- timers (every one is cancellable) ---------- */
  function later(fn, ms) {
    const id = setTimeout(() => {
      timers = timers.filter(t => t !== id);
      fn();
    }, ms);
    timers = [...timers, id];
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    litUntil = [0, 0, 0, 0];
    pads.forEach(p => p.classList.remove("lit", "simon-press"));
    el.badge.classList.remove("on");
  }

  /* ---------- sound and light ---------- */
  function padTone(i, sec) {
    const freq = Sound.hz(PADS[i].midi);
    const hold = Math.max(0, sec - 0.12);
    Sound.tone({ freq, type: "triangle", dur: sec, vol: 0.26, attack: 0.012, hold, send: 0.14 });
    Sound.tone({ freq: freq * 2, type: "sine", dur: sec, vol: 0.11, attack: 0.012, hold });
    Sound.tone({ freq, type: "square", dur: sec, vol: 0.045, attack: 0.012, hold, filter: { freq: 1800 } });
  }
  function chime() {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    [69, 73, 76, 81].forEach((m, k) =>
      Sound.tone({ freq: Sound.hz(m + 12), type: "triangle", t: t + k * 0.06, dur: 0.22, vol: 0.11, send: 0.25 }));
  }
  /* Lights pad i for ms (with its tone unless sound is false). Overlapping flashes keep it lit until the last ends. */
  function flash(i, ms, sound = true) {
    const until = performance.now() + ms;
    litUntil = litUntil.map((v, k) => (k === i ? Math.max(v, until) : v));
    pads[i].classList.add("lit");
    if (sound) padTone(i, ms / 1000);
    later(() => { if (performance.now() >= litUntil[i] - 8) pads[i].classList.remove("lit"); }, ms);
  }
  function startChord() {
    PADS.forEach((p, i) => {
      flash(i, 420, false);
      Sound.tone({ freq: Sound.hz(p.midi + 12), type: "triangle", dur: 0.6, vol: 0.08, attack: 0.02, hold: 0.3, send: 0.3 });
    });
  }
  function showBadge() {
    Sound.sfx("whoosh");
    el.badge.classList.add("on");
    Fx.replay(el.badge, "simon-pop");
    later(() => el.badge.classList.remove("on"), MS.speedUpLead + 700);
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    clearTimers();
    records = loadRecords();
    game = R.newGame(settings.mode);
    result = null;
    Sound.sfx("confirm");
    go({ phase: "intro", kind: "", miss: -1, suspended: false });
    window.scrollTo(0, 0); /* small phones: show the whole board, not the bottom of the setup page */
    SPIN.forEach((p, k) => later(() => flash(p, MS.spinStep + 30), MS.spinDelay + k * MS.spinStep));
    const end = MS.spinDelay + SPIN.length * MS.spinStep;
    later(startChord, end + 60);
    later(advance, end + 760);
  }
  /* Decides what comes next from the game itself, so it also works after a pause. */
  function advance() {
    if (!game) return;
    if (game.over) return finish();
    const grew = R.isComplete(game);
    if (grew) game = R.extend(game);
    beginWatch(grew && R.isSpeedUp(game.sequence.length));
  }
  function beginWatch(speedUp) {
    const len = game.sequence.length;
    const sp = R.speedFor(len);
    const lead = speedUp ? MS.speedUpLead : MS.lead;
    const step = sp.on + sp.gap;
    go({ phase: "watch", kind: "", miss: -1 });
    Fx.pop(el.round);
    if (speedUp) showBadge();
    game.sequence.forEach((p, k) => later(() => flash(p, sp.on), lead + k * step));
    later(() => go({ phase: "input" }), lead + len * step - sp.gap + 80);
  }
  function press(i) {
    if (ui.phase !== "input" || !game) return;
    const out = R.press(game, i);
    game = out.game;
    haptic(12);
    const right = ["ok", "clear", "perfect"].includes(out.result);
    flash(i, MS.press, right);
    if (out.result === "ok") return renderBoard();
    if (right) return onClear();
    return onMiss(out);
  }
  function onClear() {
    const big = game.perfect || game.score % MILESTONE === 0;
    go({ phase: "feedback", kind: game.perfect ? "perfect" : "clear", miss: -1 });
    Fx.pop(big ? el.hub : el.round);
    later(() => (big ? Sound.sfx("correct") : chime()), MS.chime);
    later(advance, big ? MS.milestone : MS.clear);
  }
  function onMiss(out) {
    const over = out.result === "over";
    go({ phase: "feedback", kind: out.result, miss: out.expected });
    Fx.shake(el.board);
    if (over) {
      Sound.sfx("buzz");
      Fx.flash("--alert", 500);
    } else {
      Sound.sfx("wrong");
    }
    Array.from({ length: over ? 3 : 2 }, (_, k) =>
      later(() => flash(out.expected, MS.blink, false), MS.blinkDelay + k * MS.blink * 2));
    later(advance, over ? MS.over : MS.retry);
  }
  function finish() {
    clearTimers();
    const out = R.recordAfter(records, game.mode, game.score);
    records = out.records;
    Store.save(RECORD_KEY, records);
    result = {
      mode: game.mode, score: game.score, best: records[game.mode], isNew: out.isNew, perfect: game.perfect,
      misses: game.misses, level: R.speedFor(game.sequence.length).level,
      rank: R.rankFor(game.score), next: R.nextRank(game.score)
    };
    game = null;
    go({ phase: "result", kind: "", miss: -1, suspended: false });
    Fx.pop(el.card);
    if (result.isNew) {
      Sound.sfx("victory");
      Fx.confetti();
    } else {
      Sound.sfx("reveal");
    }
  }
  /* Ends the game early: with at least one round cleared it is scored, otherwise it just goes back. */
  function quit() {
    if (!game) return;
    if (game.score > 0) finish();
    else toSetup();
  }
  function toSetup() {
    clearTimers();
    game = null;
    result = null;
    go({ phase: "setup", kind: "", miss: -1, suspended: false });
  }

  /* ---------- screens ---------- */
  function modeLine() {
    if (!game) return "";
    if (game.mode === "normal") return "ふつう・ミスしたら終わり";
    return game.retriesLeft > 0 ? "やさしい・やり直しあと1回" : "やさしい・やり直しなし";
  }
  const quitButton = () => makeButton("やめる", guard(quit), "small");
  const FEEDBACK = {
    clear: () => ({ title: game.score % MILESTONE === 0 ? `${game.score}ラウンド突破！` : "クリア！", hint: "次はひとつ増えるよ" }),
    perfect: () => ({ title: "パーフェクト！", hint: `${R.MAX_ROUNDS}ラウンドぜんぶクリア` }),
    retry: () => ({ title: "おしい！", hint: `正解は${padText(ui.miss)}。もう一度見せるね` }),
    over: () => ({ title: "ざんねん…", hint: `正解は${padText(ui.miss)}でした` })
  };
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", guard(start), "primary")] }),
    intro: () => ({ label: modeLine(), title: "じゅんびはいい？", hint: "光る順番をよく見てね", actions: [quitButton()] }),
    watch: () => ({ label: modeLine(), title: "よく見て…", hint: "光った順番を覚えよう", actions: [quitButton()] }),
    input: () => ({ label: modeLine(), title: "あなたの番！", hint: "同じ順番でタップ", actions: [quitButton()] }),
    feedback: () => ({ label: modeLine(), ...FEEDBACK[ui.kind](), actions: [quitButton()] }),
    result: () => ({
      label: result.isNew ? "新記録！" : `${MODE_LABEL[result.mode]}モードの結果`,
      title: result.perfect ? "パーフェクト！" : result.rank.title,
      card: { main: String(result.score), sub: "ラウンドクリア", cls: result.isNew ? "number simon-record" : "number" },
      hint: result.rank.note,
      actions: [makeButton("設定", guard(toSetup), "small"), makeButton("もう一回", guard(start), "primary")]
    })
  };

  function hubState() {
    if (ui.phase === "input") return `${game.pos} / ${game.sequence.length}`;
    if (ui.phase === "feedback") return HUB_FEEDBACK[ui.kind] || "";
    return ui.phase === "watch" ? "見てね" : "じゅんび";
  }
  function renderBoard() {
    const show = Boolean(game) && ACTIVE.includes(ui.phase);
    el.wrap.hidden = !show;
    if (!show) return;
    const len = game.sequence.length;
    const best = records[game.mode];
    el.board.dataset.state = ui.phase === "input" ? "input" : (ui.phase === "feedback" && BOARD_STATE[ui.kind]) || "lock";
    if (ui.phase !== "input") pads.forEach(p => p.classList.remove("simon-press"));
    el.round.textContent = String(len);
    el.hubState.textContent = hubState();
    el.progress.style.width = `${Math.round((game.pos / len) * 100)}%`;
    el.best.textContent = String(Math.max(best, game.score));
    el.bestStat.classList.toggle("simon-hot", game.score > best);
    el.speed.textContent = String(R.speedFor(len).level);
  }
  function statRow([name, value, isNew]) {
    const li = document.createElement("li");
    li.className = isNew ? "simon-new" : "";
    const k = document.createElement("span");
    k.textContent = name;
    const v = document.createElement("b");
    v.textContent = isNew ? `${value}（新記録）` : value;
    li.append(k, v);
    return li;
  }
  function renderStats() {
    const show = ui.phase === "result" && Boolean(result);
    el.stats.hidden = !show;
    if (!show) return;
    const rows = [
      ["今回", `${result.score}ラウンド`, result.isNew],
      ["自己ベスト", `${result.best}ラウンド`, false],
      ["次のランク", result.next ? `あと${result.next.min - result.score}ラウンドで${result.next.title}` : "最高ランク！", false],
      ["最高スピード", `Lv.${result.level}`, false],
      ...(result.mode === "easy" ? [["ミス", `${result.misses}回`, false]] : [])
    ];
    el.stats.replaceChildren(...rows.map(statRow));
  }
  function renderSetup() {
    View.chips(el.modeChips, R.MODES.map(m => ({ value: m, label: MODE_LABEL[m] })), settings.mode, (m) => {
      settings = R.normalizeSettings({ mode: m });
      Store.save(KEY, settings);
      render();
    });
    const any = R.MODES.some(m => records[m] > 0);
    View.text(el.setupBest, any
      ? `自己ベスト　${R.MODES.map(m => `${MODE_LABEL[m]} ${records[m]}`).join("　")}`
      : "自己ベスト　まだなし");
    View.list(el.rules, [
      "4つのパッドが、音といっしょに順番に光る",
      "光り終わったら、同じ順番でパッドをタップ",
      "1ラウンドごとに1つ増えて、4ラウンドごとにスピードアップ",
      settings.mode === "easy" ? "まちがえても1回だけ、同じ順番をもう一度見てやり直せる" : "1回でもまちがえたら終わり。何ラウンド続くかな？",
      "色と ●▲■◆ の形で見分けよう。パソコンは1〜4キーでもOK"
    ]);
    View.list(el.rankList, R.RANKS.map((rank, k) => {
      const next = R.RANKS[k + 1];
      return `${next ? `${rank.min}〜${next.min - 1}` : `${rank.min}〜`}ラウンド　${rank.title}`;
    }));
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase !== "setup") {
      renderBoard();
      renderStats();
    }
  }

  /* ---------- input and lifecycle ---------- */
  function onPadDown(e, i) {
    if (e.button > 0 || ui.phase !== "input") return;
    e.preventDefault();
    pads[i].classList.add("simon-press");
    press(i);
  }
  function onKey(e) {
    if (el.mode.hidden || ui.phase !== "input" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const i = KEYMAP[String(e.key).toLowerCase()];
    if (i === undefined) return;
    e.preventDefault();
    press(i);
  }
  /* Hidden tab: stop the lights. Back again: replay the current round from the start. */
  function onVisibility() {
    if (document.hidden) {
      if (!game || !ACTIVE.includes(ui.phase)) return;
      clearTimers();
      if (ui.phase !== "input") ui = { ...ui, suspended: true };
      return;
    }
    if (!ui.suspended) return;
    ui = { ...ui, suspended: false };
    later(advance, MS.resume);
  }

  function init() {
    settings = R.normalizeSettings(Store.load(KEY, null));
    records = loadRecords();
    pads.forEach((pad, i) => {
      pad.addEventListener("pointerdown", (e) => onPadDown(e, i));
      ["pointerup", "pointercancel", "pointerleave"].forEach(type => pad.addEventListener(type, () => pad.classList.remove("simon-press")));
      pad.addEventListener("contextmenu", (e) => e.preventDefault());
      pad.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (!e.repeat) press(i);
      });
    });
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }
  function onShow() {
    ui = { ...ui, at: performance.now() }; /* opening the game counts as a screen change for the tap guard */
    if (ui.phase !== "setup") return;
    records = loadRecords();
    render();
  }
  /* Leaving mid-game keeps a beaten record, then returns to setup. */
  function leave() {
    clearTimers();
    if (!game || !ACTIVE.includes(ui.phase)) return;
    records = R.recordAfter(records, game.mode, game.score).records;
    Store.save(RECORD_KEY, records);
    game = null;
    go({ phase: "setup", kind: "", miss: -1, suspended: false });
  }

  return { init, onShow, leave };
})();

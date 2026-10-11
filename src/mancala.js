/* Mancala screen: Kalah on a wooden board. Stones are sown one by one; play the CPU or a friend on one phone. */
const Mancala = (() => {
  const M = MancalaRules;
  const KEY = "mancala.settings";
  const MS = Object.freeze({ lift: 160, step: 120, capture: 320, sweep: 420, cpu: 450, callout: 1150, guard: 250 });
  const CAP = Object.freeze({ pit: 12, store: 24 });
  const STONE_TONES = 5;
  const VS = Object.freeze({ cpu: "CPUと", duo: "2人で" });
  const LEVEL = Object.freeze({ easy: "よわい", normal: "ふつう", hard: "つよい" });
  const ORDER = Object.freeze({ first: "先攻", second: "後攻", random: "ランダム" });
  const DEFAULTS = Object.freeze({ vs: "cpu", level: "normal", order: "first", seeds: 4 });
  const NO_MARKS = Object.freeze({ from: -1, land: -1, steal: Object.freeze([]) });

  const el = {
    mode: $("modeMancala"), setup: $("mSetup"), play: $("mPlay"), stage: $("mStage"), label: $("mLabel"), title: $("mTitle"),
    hint: $("mHint"), actions: $("mActions"),
    sides: [$("mSide0"), $("mSide1")], who: [$("mWho0"), $("mWho1")], pts: [$("mPts0"), $("mPts1")],
    board: $("mBoard"), callout: $("mCallout"), levelOpt: $("mLevelOpt"), orderOpt: $("mOrderOpt"),
    names: $("mNames"), nameInputs: [$("mName0"), $("mName1")]
  };

  let settings = DEFAULTS;
  let match = null;          // { vs, level, names } fixed when a game starts
  let game = null;
  let past = [];             // states before each human move, for 1手もどす
  let outcome = null;        // { winner, resigned }
  let shown = null;          // pits on screen while a move is animating (null = the real state)
  let marks = NO_MARKS;
  let ui = { phase: "setup", busy: false, thinking: false, confirm: false, note: "" };
  let anim = { token: 0, skip: false, wake: null, since: 0 };
  let timers = { cpu: 0, callout: 0 };

  /* Pebble spots: a sunflower spiral, so a few stones sit in the middle and more spread outward. */
  const spiral = (cap, sx, sy) => Object.freeze(Array.from({ length: cap }, (_, i) => {
    const r = Math.sqrt((i + 0.6) / cap);
    const a = i * 2.39996 + 0.6;
    return Object.freeze([50 + sx * r * Math.cos(a), 50 + sy * r * Math.sin(a)]);
  }));
  const SPOTS = Object.freeze({ pit: spiral(CAP.pit, 30, 30), store: spiral(CAP.store, 24, 40) });

  const keysOf = (o) => Object.keys(o);
  const isCpu = (p) => match !== null && match.vs === "cpu" && p === 1;
  const mover = () => (ui.busy && game.last ? game.last.player : game.turn);
  const canTouch = () => ui.phase === "play" && !game.over && !isCpu(game.turn) && !ui.busy && !ui.thinking;
  const call = (p) => (match.vs === "duo" ? `${match.names[p]}さん` : match.names[p]);
  const reduced = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const withCount = (pits, i, n) => pits.map((v, k) => (k === i ? n : v));
  const plus = (pits, i, n) => withCount(pits, i, pits[i] + n);
  const sown = (before, L) => L.path.reduce((p, i) => plus(p, i, 1), withCount(before.pits, L.pit, 0));

  function normalize(s) {
    const v = s && typeof s === "object" ? s : {};
    const pick = (list, key) => (list.includes(v[key]) ? v[key] : DEFAULTS[key]);
    return Object.freeze({
      vs: pick(keysOf(VS), "vs"), level: pick(M.LEVELS, "level"), order: pick(keysOf(ORDER), "order"), seeds: pick(M.SEEDS, "seeds")
    });
  }
  const update = (patch) => { settings = normalize({ ...settings, ...patch }); Store.save(KEY, settings); render(); };
  const go = (patch) => { ui = { ...ui, ...patch }; render(); };

  /* ---------- sounds: wooden tok per stone, a rattle when stones are picked up, a chime for もう1回 ---------- */
  const clock = (fn) => { const c = Sound.ctx(); if (c) fn(c.currentTime); };
  const tok = (step, store) => clock(t => {
    const f = (store ? 290 : 680) * Math.pow(2, Math.min(step, 12) / 36);
    Sound.tone({ freq: f, glide: f * 0.62, glideTime: 0.05, type: "triangle", t, dur: store ? 0.16 : 0.09,
      vol: store ? 0.22 : 0.17, filter: { freq: 2600 }, send: store ? 0.14 : 0 });
    Sound.tone({ freq: f * 0.5, type: "sine", t, dur: 0.06, vol: 0.12 });
    Sound.hiss({ t, dur: 0.02, vol: 0.05, type: "bandpass", freq: 2800, q: 1.4 });
  });
  const rattle = (n) => clock(t => {
    for (let i = 0; i < Math.min(n, 5); i++) Sound.hiss({ t: t + i * 0.03, dur: 0.035, vol: 0.06, type: "bandpass", freq: 2600 + i * 400, q: 2.5 });
  });
  const chime = () => clock(t => [79, 84, 88, 91].forEach((m, i) =>
    Sound.tone({ freq: Sound.hz(m), type: "triangle", t: t + i * 0.07, dur: 0.26, vol: 0.11, send: 0.25 })));
  const thud = () => clock(t => Sound.tone({ freq: 150, glide: 110, type: "sine", t, dur: 0.1, vol: 0.18 }));
  const nope = (i) => { thud(); Fx.replay(cells[i].bowl, "m-nope"); };

  const CALLOUT_SOUND = Object.freeze({ extra: () => chime(), steal: () => Sound.sfx("coin"), info: () => {} });
  function callout(text, kind) {
    CALLOUT_SOUND[kind]();
    clearTimeout(timers.callout);
    el.callout.textContent = text;
    el.callout.className = `m-callout ${kind}`;
    el.callout.hidden = false;
    Fx.replay(el.callout, "m-show");
    timers = { ...timers, callout: setTimeout(() => { el.callout.hidden = true; }, MS.callout) };
  }

  /* ---------- animation timing: a tap (not a double tap's second half) or reduced motion skips; a new token cancels ---------- */
  function wait(ms) {
    if (anim.skip) return Promise.resolve();
    return new Promise(resolve => {
      const id = setTimeout(() => { anim = { ...anim, wake: null }; resolve(); }, ms);
      anim = { ...anim, wake: () => { clearTimeout(id); resolve(); } };
    });
  }
  const beat = async (ms, token) => { await wait(ms); return token === anim.token; };
  /* Swaps in the next animation state and releases a pending wait (it then sees skip or a stale token). */
  function wakeWith(next) {
    const wake = anim.wake;
    anim = next;
    if (wake) wake();
  }
  function skip() {
    if (ui.busy && !anim.skip && performance.now() - anim.since > MS.guard) wakeWith({ ...anim, skip: true, wake: null });
  }
  function stopAll() {
    [timers.cpu, timers.callout].forEach(clearTimeout);
    timers = { cpu: 0, callout: 0 };
    wakeWith({ token: anim.token + 1, skip: false, wake: null, since: 0 });
    el.callout.hidden = true;
    shown = null;
  }

  /* ---------- flow ---------- */
  const firstPlayer = () => (settings.vs === "duo" || settings.order === "random" ? (Math.random() < 0.5 ? 0 : 1)
    : settings.order === "first" ? 0 : 1);
  function start() {
    Sound.ensure();
    Awake.keep();
    stopAll();
    const names = settings.vs === "duo" ? Duo.read(el.nameInputs) : ["あなた", "CPU"];
    match = Object.freeze({ vs: settings.vs, level: settings.level, names: Object.freeze(names) });
    game = M.newGame(settings.seeds, firstPlayer());
    [past, outcome, marks] = [[], null, NO_MARKS];
    Sound.sfx("confirm");
    Music.play("think");
    go({ phase: "play", busy: false, thinking: false, confirm: false, note: "" });
    callout(`${call(game.turn)}が先攻`, "info");
    if (isCpu(game.turn)) scheduleCpu();
  }

  /* choose() returns the pit to play; any error (bad pit, CPU failure) ends up in one friendly message. */
  function run(choose) {
    playMove(choose).catch(e => {
      console.error("mancala move failed", e);
      shown = null;
      go({ busy: false, thinking: false, note: "うまく動かせませんでした。盤をタップしてね" });
    });
  }
  async function playMove(choose) {
    const before = game;
    game = M.move(before, choose());
    if (match.vs === "cpu" && !isCpu(before.turn)) past = [...past, before];
    const token = anim.token + 1;
    anim = { token, skip: reduced(), wake: null, since: performance.now() };
    if (await animate(before, game, token)) settle();
  }
  async function animate(before, after, token) {
    const L = after.last;
    const store = M.STORES[L.player];
    marks = { ...NO_MARKS, from: L.pit };
    shown = withCount(before.pits, L.pit, 0);
    go({ busy: true, note: "" });
    rattle(L.count);
    for (let k = 0; k < L.path.length && !anim.skip; k++) {
      await wait(k === 0 ? MS.lift : MS.step);
      if (token !== anim.token) return false;
      if (anim.skip) break;
      shown = plus(shown, L.path[k], 1);
      tok(k, L.path[k] === store);
      paint(true);
      Fx.replay(cells[L.path[k]].bowl, "m-drop");
    }
    if (token !== anim.token) return false;
    if (anim.skip) tok(0, L.end === store);
    shown = sown(before, L);
    marks = { ...marks, land: L.end };
    paint(false);
    if (L.capture && !(await showCapture(L, token))) return false;
    if (L.sweep && !(await showSweep(after, token))) return false;
    return token === anim.token;
  }
  async function showCapture(L, token) {
    const c = L.capture;
    const store = M.STORES[L.player];
    marks = { ...marks, steal: [c.pit, c.opposite] };
    paint(false);
    if (!(await beat(MS.capture, token))) return false;
    shown = plus(withCount(withCount(shown, c.pit, 0), c.opposite, 0), store, c.count);
    marks = { ...marks, steal: [] };
    callout(`横取り！ +${c.count}`, "steal");
    paint(true);
    Fx.replay(cells[store].bowl, "m-drop");
    return beat(MS.capture, token);
  }
  async function showSweep(after, token) {
    if (!(await beat(MS.sweep, token))) return false;
    shown = after.pits;
    rattle(6);
    tok(0, true);
    go({ note: "残りの石は、それぞれのゴールへ" });
    return beat(MS.sweep * 2, token);
  }
  function settle() {
    shown = null;
    if (game.over) return finish(null);
    const L = game.last;
    if (L.extra) callout("もう1回！", "extra");
    else Sound.sfx("whoosh");
    const note = L.extra ? `ゴールにぴったり！ ${call(L.player)}がもう1回`
      : L.capture ? `${call(L.player)}が${L.capture.count}個を横取り！` : "";
    go({ busy: false, note });
    Fx.pop(el.title);
    if (isCpu(game.turn)) scheduleCpu();
  }
  function scheduleCpu() {
    clearTimeout(timers.cpu);
    go({ thinking: true });
    timers = { ...timers, cpu: setTimeout(cpuTurn, MS.cpu) };
  }
  function cpuTurn() {
    ui = { ...ui, thinking: false };
    if (ui.phase !== "play" || game.over || !isCpu(game.turn)) return render();
    run(() => M.cpuMove(game, match.level));
  }
  /* Only after a failed move is nothing pending here: a tap then finishes the game or wakes the CPU. */
  function recover() {
    if (ui.phase !== "play" || ui.thinking) return;
    if (game.over) finish(null);
    else if (isCpu(game.turn)) scheduleCpu();
  }
  function onBoard(e) {
    e.stopPropagation();
    if (ui.busy) return skip();
    if (!canTouch()) return recover();
    const btn = e.target.closest(".m-pit");
    if (!btn) return;
    const i = Number(btn.dataset.i);
    if (!M.isLegal(game, i)) return nope(i);
    ui = { ...ui, confirm: false };
    run(() => i);
  }
  function undo() {
    if (!past.length || ui.busy) return;
    stopAll();
    game = past[past.length - 1];
    [past, marks] = [past.slice(0, -1), NO_MARKS];
    Sound.sfx("back");
    go({ thinking: false, confirm: false, note: "1手もどしました" });
  }
  function resign() {
    if (!ui.confirm) return go({ confirm: true });
    finish(match.vs === "cpu" ? 0 : mover());
  }
  function finish(resigned) {
    stopAll();
    outcome = Object.freeze({ winner: resigned === null ? game.winner : 1 - resigned, resigned });
    Music.stop();
    go({ phase: "over", busy: false, thinking: false, confirm: false, note: "" });
    Fx.pop(el.title);
    if (outcome.winner === null) return Sound.sfx("reveal");
    if (isCpu(outcome.winner)) return Sound.sfx("lose");
    Sound.sfx(match.vs === "cpu" ? "victory" : "fanfare");
    Fx.confetti();
  }
  const toSetup = () => { stopAll(); go({ phase: "setup", confirm: false }); };

  /* ---------- screens ---------- */
  const turnTitle = () => (ui.thinking ? "CPUが考え中…"
    : match.vs === "duo" ? `${call(mover())}の番` : isCpu(mover()) ? "CPUの番" : "あなたの番");
  function playHint() {
    if (ui.busy) return ui.note || "タップでとばせます";
    if (ui.note || ui.thinking || isCpu(game.turn)) return ui.note;
    if (match.vs === "duo") return `${call(game.turn)}は${game.turn === 0 ? "下" : "上"}の列。光っている穴をタップ`;
    return "光っている穴をタップ。最後の1個がゴールに入ると、もう1回！";
  }
  function playActions() {
    if (ui.confirm) return [makeButton("やめない", () => go({ confirm: false }), "small"), makeButton("投了する", resign, "primary danger")];
    const quit = makeButton("投了", resign, "small");
    return match.vs === "cpu" ? [makeButton("1手もどす", undo, "small", !past.length || ui.busy), quit] : [quit];
  }
  function resultTitle() {
    const { winner, resigned } = outcome;
    if (resigned !== null) return match.vs === "cpu" ? "投了… CPUの勝ち" : `${call(resigned)}が投了。${call(winner)}の勝ち！`;
    if (winner === null) return "引き分け！";
    if (match.vs === "cpu") return winner === 0 ? "あなたの勝ち！" : "CPUの勝ち…";
    return `${call(winner)}の勝ち！`;
  }
  function resultHint() {
    const [a, b] = M.scores(game);
    if (outcome.resigned !== null) return "次は最後まで粘ってみよう";
    if (a === b) return "ゴールの石がぴったり同じ数でした";
    const tip = match.vs === "cpu" && outcome.winner === 1 ? "ゴールにぴったり入る穴を先に使うのがコツ" : "";
    return `${Math.abs(a - b)}個差で決着。${tip}`;
  }

  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: () => ({
      label: match.vs === "cpu" ? `CPU ${LEVEL[match.level]}・石${game.seeds}個` : `2人で対戦・石${game.seeds}個`,
      title: turnTitle(), hint: playHint(), actions: playActions()
    }),
    over: () => ({
      label: outcome.resigned !== null ? "投了" : "対局終了", title: resultTitle(), hint: resultHint(),
      actions: [makeButton("設定", toSetup, "small"), makeButton("もう一回", start, "primary")]
    })
  };

  /* ---------- board ---------- */
  /* The 14 cells are in the markup (data-i = board index); this reads one into a lookup record. */
  function readCell(root) {
    const index = Number(root.dataset.i);
    const store = M.STORES.includes(index);
    return Object.freeze({
      root, index, store, player: index > M.STORES[0] ? 1 : 0, count: root.querySelector(".m-count"),
      bowl: root.querySelector(".m-bowl"), cap: store ? CAP.store : CAP.pit, spots: store ? SPOTS.store : SPOTS.pit
    });
  }
  const cells = Object.freeze([...el.board.children].map(readCell).sort((a, b) => a.index - b.index));

  function stone(c, k, fresh) {
    const s = Object.assign(document.createElement("span"), { className: `m-stone t${(k + c.index * 2) % STONE_TONES}${fresh ? " m-new" : ""}` });
    s.style.cssText = `left:${c.spots[k][0]}%;top:${c.spots[k][1]}%`;
    return s;
  }
  function paintStones(c, n, fresh) {
    const want = Math.min(n, c.cap);
    const have = c.bowl.childElementCount;
    if (want < have) c.bowl.replaceChildren(...Array.from({ length: want }, (_, k) => stone(c, k, false)));
    else if (want > have) c.bowl.append(...Array.from({ length: want - have }, (_, k) => stone(c, have + k, fresh)));
  }
  function paintCell(c, n, legal) {
    if (c.count.textContent !== String(n)) c.count.textContent = String(n);
    ["from", "land"].forEach(k => c.root.classList.toggle(k, marks[k] === c.index));
    c.root.classList.toggle("steal", marks.steal.includes(c.index));
    if (c.store) return c.root.classList.toggle("turn", ui.phase === "play" && mover() === c.player);
    const where = c.player === 0 ? `下の列の左から${c.index + 1}番目` : `上の列の左から${13 - c.index}番目`;
    c.root.classList.toggle("legal", legal);
    c.root.setAttribute("aria-disabled", String(!legal));
    c.root.setAttribute("aria-label", `${where}の穴、石${n}個`);
  }
  function paint(fresh) {
    const pits = shown || game.pits;
    const legal = canTouch() ? M.legalMoves(game) : [];
    cells.forEach((c, i) => {
      paintStones(c, pits[i], fresh);
      paintCell(c, pits[i], legal.includes(i));
    });
    [0, 1].forEach(p => paintScore(p, pits[M.STORES[p]]));
  }
  function paintScore(p, n) {
    const playing = ui.phase === "play";
    el.sides[p].classList.toggle("turn", playing && mover() === p);
    el.sides[p].classList.toggle("won", ui.phase === "over" && outcome.winner === p);
    el.sides[p].classList.toggle("think", playing && ui.thinking && isCpu(p));
    el.who[p].textContent = match.names[p];
    el.pts[p].textContent = String(n);
  }

  /* ---------- setup ---------- */
  function renderSetup() {
    View.chips($("mVsChips"), View.options(keysOf(VS), k => VS[k]), settings.vs, v => update({ vs: v }));
    View.chips($("mLevelChips"), View.options(M.LEVELS, k => LEVEL[k]), settings.level, v => update({ level: v }));
    View.chips($("mOrderChips"), View.options(keysOf(ORDER), k => ORDER[k]), settings.order, v => update({ order: v }));
    View.chips($("mSeedChips"), View.options(M.SEEDS, n => `${n}個`), settings.seeds, v => update({ seeds: v }));
    [el.levelOpt, el.orderOpt].forEach(o => { o.hidden = settings.vs !== "cpu"; });
    el.names.hidden = settings.vs !== "duo";
    View.list($("mRules"), [
      "自分の列の穴を1つ選び、石を全部取って反時計回りに1個ずつ置いていく",
      "自分のゴールにも置く。相手のゴールはとばす",
      "最後の1個が自分のゴールに入ったら、もう1回！",
      "最後の1個が自分の列の空の穴に入り、向かいに石があれば、両方まとめて自分のゴールへ",
      "どちらかの列が空になったら終了。残りの石はその列の人のもの。ゴールの石が多い方の勝ち"
    ]);
  }
  function render() {
    const playing = ui.phase !== "setup";
    el.setup.hidden = playing;
    el.play.hidden = !playing;
    el.stage.classList.toggle("m-playing", playing);
    el.stage.classList.toggle("m-turns", ui.phase === "play");
    if (!playing) renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (playing) paint(false);
  }
  function init() {
    settings = normalize(Store.load(KEY, {}));
    el.board.addEventListener("click", onBoard);
    el.play.addEventListener("click", () => { if (ui.busy) skip(); });
    el.board.addEventListener("animationend", e => e.target.classList.remove("m-new", "m-drop", "m-nope"));
    Duo.fill(el.nameInputs);
    render();
  }
  function onShow() {
    if (ui.phase === "setup") Duo.fill(el.nameInputs);
    if (ui.phase !== "play") return;
    if (game.over) return finish(null); /* left during the last move: settle it now */
    Music.play("think");
    if (isCpu(game.turn)) scheduleCpu();
  }
  function leave() {
    if (ui.phase === "play" && !el.mode.hidden) Music.stop();
    stopAll();
    if (ui.phase === "play") go({ busy: false, thinking: false, confirm: false });
  }

  return { init, onShow, leave };
})();

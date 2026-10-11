/* Klondike solitaire screen: animated deal, tap or drag cards, unlimited undo, hints, auto finish,
 * a clock and move count, a saved game to come back to, and the classic bouncing-card cascade on a win. */
const Klondike = (() => {
  const K = KlondikeRules;
  const KEY = "klondike.settings";
  const SAVE_KEY = "klondike.game";
  const RECORD_KEY = "klondike.records";
  const MOVE_MS = 210;
  const DEAL_STEP_MS = 32;
  const DEALT = K.dealStep(K.COLS - 1, K.COLS - 1) + 1;
  const AUTO_STEP_MS = 115;
  const HINT_MS = 2600;
  const CONFIRM_MS = 2600;
  const DRAG_PX = 7;
  const CASCADE_GAP_MS = 110;
  const CASCADE_MAX_MS = 9000;
  const MAX_ELAPSED_MS = 100 * 3600 * 1000;
  const DRAW_LABEL = Object.freeze({ 1: "1枚めくり", 3: "3枚めくり" });
  const READY_MSG = "場のカードが全部表になった！「自動で上げる」で仕上げよう";
  const RECYCLE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15"/><path d="M4.5 19.5V15H9"/></svg>';

  const el = {
    mode: $("modeKlondike"), stage: $("klStage"), setup: $("klSetup"), play: $("klPlay"),
    label: $("klLabel"), title: $("klTitle"), hint: $("klHint"), actions: $("klActions"),
    record: $("klRecord"), modeTag: $("klMode"), moves: $("klMoves"), time: $("klTime"),
    board: $("klBoard"), stock: $("klStock"), waste: $("klWaste"),
    found: [$("klF0"), $("klF1"), $("klF2"), $("klF3")],
    cols: [$("klT0"), $("klT1"), $("klT2"), $("klT3"), $("klT4"), $("klT5"), $("klT6")]
  };

  let settings = { draw: 1 };
  let game = null;
  let ui = { phase: "setup", busy: false, hint: null, msg: "", confirm: false, ready: false, result: null };
  let clock = { base: 0, since: 0, timer: 0 };
  let faces = new Map();
  let finish = { state: null, plan: null };
  let tapCycle = null;
  let drag = null;
  let timers = [];
  let cascadeStop = null;
  let confettiStop = null;

  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* A card held by one finger blocks the stock and the buttons, so a second finger cannot change the table under it. */
  const canAct = () => ui.phase === "play" && !ui.busy && !drag;
  const inProgress = () => Boolean(game) && !K.isWon(game.state);
  const homeCount = (s) => s.foundations.reduce((n, f) => n + f.length, 0);
  const hiddenCount = (s) => s.tableau.reduce((n, c) => n + c.hidden, 0);
  const moveOf = (from, to, count) => ({ type: "move", from, to, count });

  function later(fn, ms) {
    const id = setTimeout(() => { timers = timers.filter(t => t !== id); fn(); }, ms);
    timers = [...timers, id];
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /* ---------- sounds (built from the shared synth) ---------- */
  const at = (sec) => (Sound.ctx() ? Sound.ctx().currentTime + sec : undefined);
  const Sfx = {
    snap: () => { Sound.hiss({ dur: 0.045, vol: 0.18, type: "bandpass", freq: 2600, q: 1.3 }); Sound.tone({ freq: 210, glide: 120, dur: 0.08, vol: 0.16 }); },
    slide: () => Sound.hiss({ dur: 0.14, vol: 0.1, type: "bandpass", freq: 900, to: 3400, q: 0.9, attack: 0.03 }),
    lift: () => Sound.hiss({ dur: 0.05, vol: 0.07, type: "highpass", freq: 3200 }),
    nope: () => Sound.tone({ freq: 170, glide: 115, type: "square", dur: 0.13, vol: 0.05, filter: { freq: 800 } }),
    /* Each card going home rings one step higher on a major scale: A is low, K is high. */
    home: (rank) => {
      const step = [0, 2, 4, 5, 7, 9, 11][rank % 7] + 12 * Math.floor(rank / 7);
      Sound.tone({ freq: Sound.hz(72 + step), type: "triangle", dur: 0.26, vol: 0.13, send: 0.25 });
      Sound.tone({ freq: Sound.hz(84 + step), dur: 0.18, vol: 0.05, send: 0.25 });
      Sound.hiss({ dur: 0.04, vol: 0.1, type: "bandpass", freq: 2600, q: 1.3 });
    },
    deal: () => Array.from({ length: DEALT }, (_, k) =>
      Sound.hiss({ t: at((k * DEAL_STEP_MS + MOVE_MS * 0.8) / 1000), dur: 0.035, vol: 0.08, type: "bandpass", freq: 3000, q: 1.2 })),
    ready: () => [76, 79, 84].forEach((m, i) => Sound.tone({ t: at(i * 0.08), freq: Sound.hz(m), type: "triangle", dur: 0.3, vol: 0.1, send: 0.3 }))
  };

  /* ---------- settings, records, saved game ---------- */
  const normalize = (s) => ({ draw: K.DRAWS.includes(s && s.draw) ? s.draw : 1 });
  function update(patch) {
    settings = normalize({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function recordText() {
    const r = K.readRecord(Store.load(RECORD_KEY, {}))[settings.draw];
    const best = r.wins && r.time && r.moves ? `自己ベスト（${DRAW_LABEL[settings.draw]}）：最短${View.clock(r.time)}・最少${r.moves}手・クリア${r.wins}回` : "";
    const note = inProgress() && game.state.draw !== settings.draw ? "めくる枚数は、新しく配るときに変わります" : "";
    return [best, note].filter(Boolean).join("　");
  }
  function save() {
    if (inProgress()) Store.save(SAVE_KEY, { state: game.state, elapsed: Math.round(elapsed()) });
  }
  function loadSaved() {
    const raw = Store.load(SAVE_KEY, null);
    const state = raw && typeof raw === "object" ? K.restore(raw.state) : null;
    if (!state || K.isWon(state)) return null;
    const ms = Number.isFinite(raw.elapsed) && raw.elapsed >= 0 ? Math.min(raw.elapsed, MAX_ELAPSED_MS) : 0;
    return { game: { state, history: [] }, elapsed: ms };
  }

  /* ---------- clock: runs from the first action, pauses while away ---------- */
  const elapsed = () => clock.base + (clock.since ? performance.now() - clock.since : 0);
  function startClock() {
    if (!clock.since && ui.phase === "play") clock = { ...clock, since: performance.now(), timer: setInterval(renderStatus, 500) };
  }
  function stopClock() {
    clearInterval(clock.timer);
    clock = { base: Math.min(elapsed(), MAX_ELAPSED_MS), since: 0, timer: 0 };
  }
  /* The phone is locked or the tab hidden: the clock waits, and picks up again on return. */
  function onVisibility() {
    if (document.visibilityState === "hidden" && clock.since) {
      stopClock();
      clock = { ...clock, paused: true };
      save();
    } else if (document.visibilityState === "visible" && clock.paused) {
      clock = { ...clock, paused: false };
      if (ui.phase === "play" && !el.mode.hidden) startClock();
    }
  }
  function resetClock(ms) {
    clearInterval(clock.timer);
    clock = { base: ms, since: 0, timer: 0 };
  }
  function finishPlan() {
    if (game && finish.state !== game.state) finish = { state: game.state, plan: K.allFaceUp(game.state) ? K.finishPlan(game.state) : null };
    return game ? finish.plan : null;
  }

  /* ---------- board ---------- */
  function pileBox(id) {
    if (id === "stock" || id === "waste") return id === "stock" ? el.stock : el.waste;
    return (id[0] === "f" ? el.found : el.cols)[Number(id[1])];
  }
  function slot(kind, suit) {
    const s = document.createElement("span");
    s.className = `klondike-slot klondike-slot-${kind}`;
    if (kind === "found") s.innerHTML = Cards.suitSvg(suit);
    if (kind === "recycle") s.innerHTML = RECYCLE_SVG;
    if (kind === "king") s.textContent = "K";
    return s;
  }
  /* Builds a card with the face it showed last time; `out.flips` turns it over afterwards so the flip animates. */
  function cardNode(out, card, down, pile, index, vars = {}, live = false) {
    const was = faces.has(card.id) ? faces.get(card.id) : down;
    const node = Cards.el(card, { faceDown: was, size: "sm" });
    Object.assign(node.dataset, { id: card.id, pile, index: String(index) });
    node.setAttribute("aria-label", down ? "伏せたカード" : Cards.label(card));
    Object.entries(vars).forEach(([k, v]) => node.style.setProperty(k, String(v)));
    if (live) node.tabIndex = 0;
    if (live) node.setAttribute("role", "button");
    out.faces.set(card.id, down);
    if (was !== down) out.flips.push({ node, down });
    return node;
  }
  function renderStock(s, out) {
    const shown = s.stock.slice(-3);
    const count = document.createElement("span");
    count.className = "klondike-count";
    count.textContent = String(s.stock.length);
    count.hidden = s.stock.length === 0;
    const kind = s.stock.length || !s.waste.length ? "empty" : "recycle";
    el.stock.replaceChildren(slot(kind), ...shown.map((c, i) => cardNode(out, c, true, "stock", s.stock.length - shown.length + i)), count);
    el.stock.setAttribute("aria-label", s.stock.length ? `山札をめくる（残り${s.stock.length}枚）` : s.waste.length ? "山札を戻す" : "山札はありません");
  }
  function renderWaste(s, out) {
    const fan = s.draw === 3 ? 3 : 1;
    const shown = s.waste.slice(-(fan + 1));
    const visible = Math.min(fan, s.waste.length);
    el.waste.replaceChildren(...shown.map((c, i) => {
      const fromTop = shown.length - 1 - i;
      return cardNode(out, c, false, "waste", s.waste.length - shown.length + i, { "--f": Math.max(0, visible - 1 - fromTop) }, fromTop === 0);
    }));
  }
  function renderFoundations(s, out) {
    el.found.forEach((box, i) => {
      const pile = s.foundations[i];
      const shown = pile.slice(-2);
      const cards = shown.map((c, k) => cardNode(out, c, false, `f${i}`, pile.length - shown.length + k, {}, k === shown.length - 1));
      box.replaceChildren(slot("found", K.SUITS[i]), ...cards);
      box.setAttribute("aria-label", `${Cards.SUITS[i].name}の組札（${pile.length}枚）`);
    });
  }
  function renderTableau(s, out) {
    el.cols.forEach((box, i) => {
      const col = s.tableau[i];
      const last = Math.max(col.cards.length - 1, 0);
      box.style.setProperty("--d", String(Math.min(last, col.hidden)));
      box.style.setProperty("--u", String(Math.max(0, last - col.hidden)));
      const cards = col.cards.map((c, k) => cardNode(out, c, k < col.hidden, `t${i}`, k,
        { "--d": Math.min(k, col.hidden), "--u": Math.max(0, k - col.hidden) }, k >= col.hidden));
      box.replaceChildren(slot(col.cards.length ? "empty" : "king"), ...cards);
    });
  }
  function clearGlow() {
    el.board.querySelectorAll(".klondike-glow").forEach(n => n.classList.remove("klondike-glow"));
  }
  function applyGlow() {
    const h = ui.hint;
    el.stock.classList.toggle("klondike-glow", Boolean(h) && h.type === "draw");
    if (!h || h.type !== "move") return;
    const src = [...pileBox(h.from).querySelectorAll(".pcard")].slice(-h.count);
    const dst = [...pileBox(h.to).querySelectorAll(".pcard, .klondike-slot")].pop();
    [...src, dst].filter(Boolean).forEach(n => n.classList.add("klondike-glow"));
  }
  /* Card positions before a change, so every card can glide from where it was (FLIP). */
  function snapshot(layer = null) {
    const nodes = [...el.board.querySelectorAll(".pcard[data-id]:not(.klondike-ghost)"), ...(layer ? layer.querySelectorAll(".pcard[data-id]") : [])];
    return new Map(nodes.map(n => [n.dataset.id, n.getBoundingClientRect()]));
  }
  function animate(snap, delayOf) {
    if (!snap || reduced()) return;
    el.board.querySelectorAll(".pcard[data-id]").forEach(node => {
      const from = snap.get(node.dataset.id);
      const to = from && typeof node.animate === "function" ? node.getBoundingClientRect() : null;
      if (!to || (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1)) return;
      node.classList.add("klondike-flying");
      const anim = node.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "none" }],
        { duration: MOVE_MS, delay: delayOf ? delayOf(node) : 0, easing: "cubic-bezier(.2, .75, .25, 1)", fill: "backwards" });
      anim.onfinish = () => node.classList.remove("klondike-flying");
    });
  }
  function runFlips(flips, delayOf) {
    if (flips.length) void el.board.offsetWidth;
    flips.forEach(({ node, down }) => {
      const wait = delayOf && !reduced() ? delayOf(node) : 0;
      if (wait > 0) later(() => Cards.setFaceDown(node, down), wait);
      else Cards.setFaceDown(node, down);
    });
  }
  function paintBoard(snap, opts) {
    const before = typeof snap === "function" ? snap() : snap;
    const out = { faces: new Map(), flips: [] };
    [renderStock, renderWaste, renderFoundations, renderTableau].forEach(f => f(game.state, out));
    faces = out.faces;
    applyGlow();
    animate(before, opts.delayOf);
    runFlips(out.flips, opts.flipDelay);
  }

  /* ---------- screens ---------- */
  function playActions() {
    const off = ui.busy;
    const back = makeButton("1手もどす", undoMove, "small", off || !K.canUndo(game));
    const setup = makeButton("設定", openSetup, "small", off);
    if (finishPlan()) return [back, makeButton("自動で上げる", autoFinish, "primary", off), setup];
    const redeal = ui.confirm ? makeButton("本当に？", start, "small primary danger") : makeButton("配り直す", askRedeal, "small", off);
    return [back, makeButton("ヒント", showHint, "small", off), redeal, setup];
  }
  const SCREENS = {
    setup: () => ({
      actions: inProgress()
        ? [makeButton("新しく配る", start, "small"), makeButton("つづきから", resume, "primary")]
        : [makeButton("はじめる", start, "primary")]
    }),
    play: () => ({ hint: ui.msg, actions: playActions() }),
    won: () => ({
      label: "クリア！",
      title: `${View.clock(ui.result.time)}・${ui.result.moves}手で完成`,
      hint: wonLine(ui.result),
      actions: [makeButton("設定", openSetup, "small"), makeButton("もう一回", start, "primary")]
    })
  };
  function wonLine(r) {
    const best = `自己ベスト：最短${View.clock(r.bestTime)}・最少${r.bestMoves}手`;
    if (r.best) return `新記録！　${best}`;
    return r.wins === 1 ? "はじめてのクリア、おめでとう！" : `${r.wins}回目のクリア。${best}`;
  }
  function renderSetup() {
    View.chips($("klDrawChips"), View.options(K.DRAWS, n => DRAW_LABEL[n]), settings.draw, n => update({ draw: n }));
    View.list($("klRules"), [
      "Aから順に、マークごとに右上の4か所へ積み上げたら完成",
      "下の7列には、数字が1つ小さく色ちがいのカードを重ねられる（赤の8に黒の7など）",
      "空いた列に置けるのはKだけ。表になったカードは、まとめて動かせる",
      settings.draw === 1 ? "左上の山札をタップで1枚ずつめくる。何周でもできる" : "左上の山札をタップで3枚ずつめくる。使えるのは一番上の1枚。何周でもできる",
      "カードはタップで置ける場所へ動く。もう一度タップで別の場所へ。ドラッグでもOK"
    ]);
    View.text(el.record, recordText());
  }
  function renderStatus() {
    if (!game) return;
    el.modeTag.textContent = DRAW_LABEL[game.state.draw];
    el.moves.textContent = `${game.state.moves}手`;
    el.time.textContent = View.clock(Math.floor(elapsed() / 1000));
  }
  function refreshChrome() {
    View.stage(el, SCREENS[ui.phase]());
    renderStatus();
  }
  function render(snap = null, opts = {}) {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    el.stage.classList.toggle("klondike-on", ui.phase !== "setup");
    if (ui.phase === "setup") renderSetup();
    refreshChrome();
    if (ui.phase !== "setup") paintBoard(snap, opts);
  }
  function setMsg(msg) {
    ui = { ...ui, msg };
    View.text(el.hint, msg);
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    [clearTimers, stopEffects, cancelDrag].forEach(f => f());
    resetClock(0);
    game = K.newGame(settings.draw);
    tapCycle = null;
    faces = new Map(game.state.tableau.flatMap(c => c.cards.map(card => [card.id, true])));
    const animated = !reduced();
    ui = { phase: "play", busy: animated, hint: null, msg: "カードをタップすると、置ける場所へ動くよ", confirm: false, ready: false, result: null };
    Sound.sfx("confirm");
    Music.play("think");
    const delay = (node) => (node.dataset.pile[0] === "t" ? K.dealStep(Number(node.dataset.pile[1]), Number(node.dataset.index)) * DEAL_STEP_MS : 0);
    const fromStock = () => {
      const r = el.stock.getBoundingClientRect();
      return new Map(game.state.tableau.flatMap(c => c.cards.map(card => [card.id, r])));
    };
    render(fromStock, { delayOf: delay, flipDelay: (node) => delay(node) + MOVE_MS * 0.75 });
    if (animated) Sfx.deal();
    if (animated) later(() => { ui = { ...ui, busy: false }; refreshChrome(); }, DEALT * DEAL_STEP_MS + MOVE_MS);
    save();
  }
  function resume() {
    if (!inProgress()) return start();
    Sound.ensure();
    Awake.keep();
    const ready = Boolean(finishPlan());
    ui = { ...ui, phase: "play", busy: false, hint: null, msg: ready ? READY_MSG : "", confirm: false, ready };
    Sound.sfx("confirm");
    Music.play("think");
    render();
  }
  function openSetup() {
    [clearTimers, cancelDrag, stopEffects].forEach(f => f());
    if (ui.phase === "play") stopClock();
    save();
    Music.stop();
    ui = { ...ui, phase: "setup", busy: false, hint: null, confirm: false };
    render();
  }

  /* Applies a new game state, glides the cards from where they were and plays the matching sound. */
  function commit(next, opts) {
    const before = game.state;
    const snap = snapshot(opts.layer || null);
    game = next;
    tapCycle = opts.cycle ? { ...opts.cycle, after: game.state } : null;
    const ready = Boolean(finishPlan());
    const fresh = ready && !ui.ready && !ui.busy;
    ui = { ...ui, hint: null, confirm: false, ready, msg: fresh ? READY_MSG : "" };
    startClock();
    render(snap);
    feedback(before, game.state, opts.action);
    save();
    if (K.isWon(game.state)) win();
    else if (fresh) Sfx.ready();
    if (fresh) Fx.pop(el.actions.querySelector(".btn.primary"));
  }
  function feedback(a, b, action) {
    if (action.type === "draw") return b.recycles > a.recycles ? Sound.sfx("whoosh") : Sfx.slide();
    if (homeCount(b) > homeCount(a)) Sfx.home(K.rank(K.cardsAt(b, action.to).slice(-1)[0]));
    else Sfx.snap();
    if (hiddenCount(b) < hiddenCount(a)) later(() => Sound.sfx("flip"), MOVE_MS * 0.6);
  }
  function drawCard() {
    if (!canAct()) return;
    if (K.canDraw(game.state)) return commit(K.play(game, K.DRAW), { action: K.DRAW });
    Sfx.nope();
    Fx.replay(el.stock, "klondike-nope");
  }
  function undoMove() {
    if (!canAct() || !K.canUndo(game)) return;
    const snap = snapshot();
    game = K.undo(game);
    tapCycle = null;
    ui = { ...ui, hint: null, confirm: false, msg: "", ready: Boolean(finishPlan()) };
    render(snap);
    Sound.sfx("back");
    save();
  }
  function askRedeal() {
    if (!canAct()) return;
    if (game.state.moves === 0) return start();
    ui = { ...ui, confirm: true };
    refreshChrome();
    later(() => { if (ui.confirm) { ui = { ...ui, confirm: false }; refreshChrome(); } }, CONFIRM_MS);
  }
  function showHint() {
    if (!canAct()) return;
    const found = K.hint(game.state);
    const h = found && { ...found }; /* a fresh object, so an older hint's timer never clears this one */
    clearGlow();
    if (!h) {
      Sfx.nope();
      return setMsg(K.allFaceUp(game.state)
        ? "いい手が見つからないよ。組札のカードをドラッグで列にもどすと、道がひらけるかも"
        : "役に立つ手が見つからないよ。1手もどすか、配り直そう");
    }
    Sound.sfx("select");
    ui = { ...ui, hint: h };
    setMsg(h.type === "move" ? "光っているカードを動かせるよ" : game.state.stock.length ? "山札をめくってみよう" : "山札を戻して、めくり直してみよう");
    applyGlow();
    later(() => { if (ui.hint === h) { ui = { ...ui, hint: null }; clearGlow(); } }, HINT_MS);
  }
  function autoFinish() {
    const plan = finishPlan();
    if (!canAct() || !plan) return;
    ui = { ...ui, busy: true, msg: "" };
    refreshChrome();
    runPlan(plan, 0);
  }
  /* Cards fly home one by one; the last one wins the game. A run of stock turns plays as one step. */
  function runPlan(plan, i) {
    if (ui.phase !== "play") return;
    if (i >= plan.length) {
      ui = { ...ui, busy: false };
      return refreshChrome();
    }
    const other = plan.slice(i).findIndex(a => a.type !== "draw");
    const n = plan[i].type !== "draw" ? 1 : other < 0 ? plan.length - i : other;
    commit(plan.slice(i, i + n).reduce(K.play, game), { action: plan[i] });
    later(() => runPlan(plan, i + n), AUTO_STEP_MS);
  }
  function win() {
    stopClock();
    const time = Math.max(1, Math.floor(elapsed() / 1000)); /* same rounding as the clock on screen */
    const moves = game.state.moves;
    const { record, best } = K.addWin(Store.load(RECORD_KEY, {}), game.state.draw, time, moves);
    const mine = record[game.state.draw];
    Store.save(RECORD_KEY, record);
    Store.save(SAVE_KEY, null);
    ui = { ...ui, phase: "won", busy: false, hint: null, msg: "", result: { time, moves, best, wins: mine.wins, bestTime: mine.time, bestMoves: mine.moves } };
    Music.stop();
    later(() => {
      render();
      Sound.sfx("victory");
      confettiStop = Fx.confetti() || null;
      cascade();
    }, MOVE_MS + 60);
  }

  /* ---------- tapping ---------- */
  /* The card (and everything on it) that a press on `node` picks up, or null. */
  function pickFrom(node) {
    const pile = node.dataset.pile;
    if (!game || !pile || pile === "stock") return null;
    const index = Number(node.dataset.index);
    const cards = K.cardsAt(game.state, pile);
    const first = pile[0] === "t" ? game.state.tableau[Number(pile[1])].hidden : cards.length - 1;
    return index >= first && index < cards.length ? { from: pile, count: cards.length - index, id: node.dataset.id } : null;
  }
  function nope(p) {
    Sfx.nope();
    [...pileBox(p.from).querySelectorAll(".pcard")].slice(-p.count).forEach(n => Fx.replay(n, "klondike-nope"));
    setMsg(p.from[0] === "f" ? "組札のカードは、ドラッグで列にもどせるよ" : "このカードは、今は置ける場所がないよ");
  }
  /* Tap: send the cards to the best place. Tapping the same card again tries the next place instead. */
  function tapCard(p) {
    const cyc = tapCycle;
    if (cyc && cyc.id === p.id && cyc.after === game.state && cyc.options.length > 1) {
      const i = (cyc.i + 1) % cyc.options.length;
      const action = moveOf(cyc.from, cyc.options[i], cyc.count);
      return commit(K.play(K.undo(game), action), { action, cycle: { ...cyc, i } });
    }
    const options = p.from[0] === "f" ? [] : K.targets(game.state, p.from, p.count);
    if (!options.length) return nope(p);
    const action = moveOf(p.from, options[0], p.count);
    commit(K.play(game, action), { action, cycle: { id: p.id, from: p.from, count: p.count, options, i: 0 } });
  }

  /* ---------- dragging ---------- */
  function onDown(e) {
    if (!canAct() || drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const node = e.target.closest(".pcard[data-pile]");
    const pick = node ? pickFrom(node) : null;
    if (!pick) return;
    drag = { ...pick, pointer: e.pointerId, x: e.clientX, y: e.clientY, layer: null };
    try { el.board.setPointerCapture(e.pointerId); } catch (err) { /* no capture: moves still arrive over the board */ }
  }
  function lift() {
    const nodes = [...pileBox(drag.from).querySelectorAll(".pcard")].slice(-drag.count);
    const layer = document.createElement("div");
    layer.className = "klondike-drag";
    layer.style.setProperty("--kl-w", `${nodes[0].getBoundingClientRect().width}px`);
    layer.append(...nodes.map(n => {
      const r = n.getBoundingClientRect();
      const copy = n.cloneNode(true);
      copy.classList.remove("klondike-glow", "klondike-flying");
      Object.assign(copy.style, { left: `${r.left}px`, top: `${r.top}px` });
      return copy;
    }));
    nodes.forEach(n => n.classList.add("klondike-ghost"));
    document.body.appendChild(layer);
    drag = { ...drag, layer };
    Sfx.lift();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.layer && Math.hypot(dx, dy) < DRAG_PX) return;
    if (!drag.layer) lift();
    drag.layer.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  /* How much the leading dragged card overlaps a pile (columns reach a little below their last card). */
  function overlap(d, id) {
    const lead = d.layer.firstElementChild.getBoundingClientRect();
    const b = pileBox(id).getBoundingClientRect();
    const bottom = id[0] === "t" ? b.bottom + b.width * 0.5 : b.bottom;
    return Math.max(0, Math.min(lead.right, b.right) - Math.max(lead.left, b.left)) * Math.max(0, Math.min(lead.bottom, bottom) - Math.max(lead.top, b.top));
  }
  /* The legal pile that the leading dragged card overlaps the most. */
  function dropTarget(d) {
    const fits = [...K.FOUNDATIONS, ...K.TABLEAU]
      .filter(id => id !== d.from && !K.moveError(game.state, moveOf(d.from, id, d.count)))
      .map(id => ({ id, a: overlap(d, id) }))
      .filter(x => x.a > 0);
    return fits.length ? fits.reduce((a, b) => (b.a > a.a ? b : a)).id : null;
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    if (!d.layer) return e.type === "pointerup" && canAct() ? tapCard(d) : undefined;
    const to = e.type === "pointerup" && canAct() ? dropTarget(d) : null;
    if (to) commit(K.play(game, moveOf(d.from, to, d.count)), { action: moveOf(d.from, to, d.count), layer: d.layer });
    else render(snapshot(d.layer));
    if (!to && e.type === "pointerup" && overlap(d, d.from) === 0) Sfx.nope(); /* dropped back home: no buzz */
    d.layer.remove();
  }
  function cancelDrag() {
    if (drag && drag.layer) drag.layer.remove();
    drag = null;
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const node = e.target === el.stock ? null : e.target.closest(".pcard[data-pile]");
    const pick = node && canAct() ? pickFrom(node) : null;
    if (e.target !== el.stock && !pick) return;
    e.preventDefault();
    if (!pick) return drawCard();
    tapCard(pick);
    const again = el.board.querySelector(`.pcard[data-id="${pick.id}"]`);
    if (again && again.tabIndex === 0) again.focus({ preventScroll: true });
  }
  function onShortcut(e) {
    if (el.mode.hidden || ui.phase !== "play" || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
    e.preventDefault();
    undoMove();
  }

  /* ---------- victory cascade: cards bounce off the bottom of the screen, leaving trails ---------- */
  function sprite(card, w, h, dpr, look) {
    const c = document.createElement("canvas");
    Object.assign(c, { width: Math.ceil(w * dpr), height: Math.ceil(h * dpr) });
    const g = c.getContext("2d");
    if (!g) return c;
    g.scale(dpr, dpr);
    g.beginPath();
    if (g.roundRect) g.roundRect(0.75, 0.75, w - 1.5, h - 1.5, w * 0.1);
    else g.rect(0.75, 0.75, w - 1.5, h - 1.5);
    Object.assign(g, { fillStyle: look.face, strokeStyle: look.edge, lineWidth: 1.5 });
    g.fill();
    g.stroke();
    Object.assign(g, { fillStyle: Cards.isRed(card) ? look.red : look.black, font: `900 ${Math.round(w * 0.26)}px ${look.font}`, textBaseline: "top" });
    g.fillText(card.rank, w * 0.09, h * 0.06);
    const d = /d="([^"]+)"/.exec(Cards.suitSvg(card.suit));
    if (d) g.setTransform(dpr * w * 0.46 / 24, 0, 0, dpr * w * 0.46 / 24, dpr * w * 0.27, dpr * h * 0.38);
    if (d) g.fill(new Path2D(d[1]));
    return c;
  }
  function fly(f, dt, floor, h) {
    const vy = f.vy + 0.45 * dt;
    const bounce = f.y + vy * dt + h > floor;
    return { ...f, x: f.x + f.vx * dt, y: bounce ? floor - h : f.y + vy * dt, vy: bounce ? -Math.abs(vy) * 0.78 : vy };
  }
  function cascade() {
    const canvas = document.createElement("canvas");
    const g = reduced() || !game ? null : canvas.getContext("2d");
    if (!g) return;
    stopCascade();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const [W, H] = [window.innerWidth, window.innerHeight];
    Object.assign(canvas, { className: "klondike-cascade", width: Math.round(W * dpr), height: Math.round(H * dpr) });
    g.scale(dpr, dpr);
    document.body.appendChild(canvas);
    const css = getComputedStyle(document.documentElement);
    const tok = (n) => css.getPropertyValue(n).trim();
    const look = { face: tok("--pc-face"), edge: tok("--pc-edge"), red: tok("--pc-red"), black: tok("--pc-black"), font: getComputedStyle(document.body).fontFamily };
    const starts = el.found.map(b => b.getBoundingClientRect());
    const [w, h] = [starts[0].width, starts[0].width * 1.4];
    const order = Array.from({ length: 13 }, (_, k) => 12 - k).flatMap(r => game.state.foundations.map((f, i) => ({ card: f[r], from: starts[i] })));
    const t0 = performance.now();
    let run = { flyers: [], launched: 0, last: t0, frame: 0, ended: false };
    const end = () => {
      if (run.ended) return;
      cancelAnimationFrame(run.frame);
      run = { ...run, ended: true };
      document.removeEventListener("pointerdown", end);
      canvas.classList.add("out");
      setTimeout(() => canvas.remove(), 650);
      cascadeStop = null;
    };
    const tick = (now) => {
      const due = Math.min(order.length, Math.floor((now - t0) / CASCADE_GAP_MS) + 1);
      const fresh = order.slice(run.launched, due).map(o => ({ img: sprite(o.card, w, h, dpr, look), x: o.from.left, y: o.from.top,
        vx: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4.5), vy: -2 - Math.random() * 7 }));
      const dt = Math.min(3, (now - run.last) / 16.7);
      const flyers = [...run.flyers, ...fresh].map(f => fly(f, dt, H, h)).filter(f => f.x > -w && f.x < W);
      flyers.forEach(f => g.drawImage(f.img, f.x, f.y, w, h));
      run = { ...run, flyers, launched: Math.max(run.launched, due), last: now };
      if ((run.launched >= order.length && !flyers.length) || now - t0 > CASCADE_MAX_MS) end();
      else run = { ...run, frame: requestAnimationFrame(tick) };
    };
    document.addEventListener("pointerdown", end);
    cascadeStop = end;
    run = { ...run, frame: requestAnimationFrame(tick) };
  }
  function stopCascade() {
    if (cascadeStop) cascadeStop();
  }
  /* Everything the win left on screen: the cascade and the confetti. */
  function stopEffects() {
    if (confettiStop) confettiStop();
    confettiStop = null;
    stopCascade();
  }

  /* ---------- lifecycle ---------- */
  function init() {
    settings = normalize(Store.load(KEY, {}) || {});
    const saved = loadSaved();
    if (saved) {
      game = saved.game;
      resetClock(saved.elapsed);
    }
    el.stock.addEventListener("click", drawCard);
    /* Moves and releases are heard on the whole window, so a card is never left held if capture fails. */
    ["pointerup", "pointercancel"].forEach(t => window.addEventListener(t, onUp));
    el.board.addEventListener("lostpointercapture", onUp);
    el.board.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    el.board.addEventListener("keydown", onKey);
    el.board.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", onShortcut);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }
  function onShow() {
    render();
    if (ui.phase === "play") Music.play("think");
  }
  function leave() {
    [clearTimers, stopEffects, cancelDrag].forEach(f => f());
    if (ui.phase === "play") stopClock();
    save();
    ui = { ...ui, busy: false, hint: null, confirm: false };
  }

  return { init, onShow, leave };
})();

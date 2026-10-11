/* ドット&ボックス screen: draw lines between dots and claim boxes, against the CPU or a friend on one phone. */
const DotsBoxes = (() => {
  const R = DotsBoxesRules;
  const KEY = "dots.settings";
  const NS = "http://www.w3.org/2000/svg";
  const U = 100; /* SVG units between two dots (a drawn line is exactly 100 long, matching the CSS dash animation) */
  const PAD = 42; /* margin around the dots, so lines on the edge can be touched from outside too */
  const INSET = 7;
  const DOT_R = 11;
  const CPU_WAIT_MS = 450;
  const CPU_AGAIN_MS = 360; /* after taking a box the CPU draws again a little quicker */
  const END_MS = 650;
  const CALLOUT_MS = 950;
  const ARM_MS = 3000;
  const VS = Object.freeze({ cpu: "CPUと", duo: "2人で" });
  const LEVEL_LABELS = Object.freeze({ easy: "よわい", normal: "ふつう", hard: "つよい" });
  const LEVEL_NOTES = Object.freeze({
    easy: "取れる箱を見のがすことも多い。まずはここから",
    normal: "取れる箱は必ず取って、3本目はなるべく引かない",
    hard: "長い列のゆずり合いまで読んでくる本気モード"
  });
  const ORDER = Object.freeze({ first: "先攻", second: "後攻", random: "ランダム" });
  const COLOR = Object.freeze(["青", "赤"]);
  const DEFAULTS = Object.freeze({ vs: "cpu", level: "normal", order: "first", size: 4 });

  const side = (mark, who, state, count, box) => ({ mark: $(mark), who: $(who), state: $(state), count: $(count), box: $(box) });
  const el = {
    setup: $("oSetup"), play: $("oPlay"), label: $("oLabel"), title: $("oTitle"), card: null,
    hint: $("oHint"), actions: $("oActions"), board: $("oBoard"), callout: $("oCallout"), rules: $("oRules"),
    levelOpt: $("oLevelOpt"), orderOpt: $("oOrderOpt"), names: $("oNames"), nameInputs: [$("oInput1"), $("oInput2")],
    sides: [side("oMark0", "oWho0", "oState0", "oCount0", "oSide0"), side("oMark1", "oWho1", "oState1", "oCount1", "oSide1")]
  };

  let settings = DEFAULTS;
  let game = null;
  let match = null; /* { people: [{ name, cpu, mark }], first: person index moving first, wins: [n, n], draws } */
  let ui = { phase: "setup", aim: -1, pressed: false, busy: false, thinking: false, armed: false, result: null };
  let timers = [];
  let arms = 0; /* counts 投了 presses, so an older disarm timer leaves a newer press alone */
  let board = null; /* SVG parts for the current size */
  let shown = 0; /* moves already drawn on screen; the next one animates */
  let anim = { line: -1, boxes: [] };

  const cls = (...names) => names.filter(Boolean).join(" ");
  const reduced = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
  const personOf = (player) => (player === 0 ? match.first : 1 - match.first);
  const isCpu = (player) => match.people[personOf(player)].cpu;
  const vsCpu = () => match.people.some(p => p.cpu);
  const humanPlayer = () => [0, 1].find(p => !isCpu(p));
  const ink = (player) => `dots-c${personOf(player)}`;
  const live = () => ui.phase === "play" && !ui.busy && !R.isOver(game) && !isCpu(game.turn);
  const left = () => game.lines.filter(x => x === null).length;

  function who(player) {
    if (isCpu(player)) return "CPU";
    return vsCpu() ? "あなた" : `${match.people[personOf(player)].name}さん`;
  }
  /* One letter per person for the claimed boxes: first letters, or last letters when the first ones match. */
  function marks(names) {
    const pick = (fromEnd) => names.map(n => {
      const chars = Array.from(n);
      return chars[fromEnd ? chars.length - 1 : 0] || "?";
    });
    const first = pick(false);
    if (first[0] !== first[1]) return first;
    const last = pick(true);
    return last[0] !== last[1] ? last : ["A", "B"];
  }

  /* ---------- settings and timers ---------- */
  function normalize(s) {
    const src = s && typeof s === "object" ? s : {};
    return {
      vs: Object.keys(VS).includes(src.vs) ? src.vs : DEFAULTS.vs,
      level: R.LEVELS.includes(src.level) ? src.level : DEFAULTS.level,
      order: Object.keys(ORDER).includes(src.order) ? src.order : DEFAULTS.order,
      size: R.SIZES.includes(src.size) ? src.size : DEFAULTS.size
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
    el.callout.hidden = true;
  }

  /* ---------- sounds ---------- */
  /* A felt pen scratching across paper: band-passed noise sweeping up, a hiss on top, a soft lift at the end. */
  function penSound() {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = 2300 + Math.random() * 900;
    Sound.hiss({ t, dur: 0.16, vol: 0.13, type: "bandpass", freq: f, to: f * 1.7, q: 4, attack: 0.015 });
    Sound.hiss({ t: t + 0.02, dur: 0.12, vol: 0.05, type: "highpass", freq: 6000, attack: 0.02 });
    Sound.hiss({ t: t + 0.14, dur: 0.05, vol: 0.06, type: "bandpass", freq: f * 0.6, q: 2 });
  }
  function extraSound() {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    Sound.tone({ freq: Sound.hz(79), type: "triangle", t, dur: 0.09, vol: 0.13 });
    Sound.tone({ freq: Sound.hz(84), type: "triangle", t: t + 0.08, dur: 0.1, vol: 0.13 });
    Sound.tone({ freq: Sound.hz(91), type: "square", t: t + 0.16, dur: 0.2, vol: 0.05, filter: { freq: 3000 }, send: 0.2 });
  }
  const aimSound = () => Sound.tone({ freq: 1700, type: "sine", dur: 0.025, vol: 0.05 });
  const nopeSound = () => Sound.tone({ freq: 150, type: "square", dur: 0.08, vol: 0.05, filter: { freq: 800 } });

  /* ---------- flow ---------- */
  function firstFor(prev) {
    if (settings.vs === "duo") return prev === null ? 0 : 1 - prev;
    if (settings.order === "random") return Math.random() < 0.5 ? 0 : 1;
    return settings.order === "first" ? 0 : 1;
  }
  function start() {
    Sound.ensure();
    Awake.keep();
    const cpu = settings.vs === "cpu";
    const names = cpu ? ["あなた", "CPU"] : Duo.read(el.nameInputs);
    const letters = marks(names);
    match = { people: names.map((name, i) => ({ name, cpu: cpu && i === 1, mark: letters[i] })), first: firstFor(null), wins: [0, 0], draws: 0 };
    newRound();
  }
  function rematch() {
    match = { ...match, first: firstFor(match.first) };
    newRound();
  }
  function newRound() {
    clearTimers();
    game = R.newGame(settings.size);
    shown = 0;
    anim = { line: -1, boxes: [] };
    ui = { phase: "play", aim: -1, pressed: false, busy: false, thinking: false, armed: false, result: null };
    buildBoard(settings.size);
    Sound.sfx("confirm");
    Music.play("think");
    render();
    Fx.pop(el.board);
    if (isCpu(game.turn)) cpuTurn(CPU_WAIT_MS);
  }
  function toSetup() {
    clearTimers();
    Music.stop();
    go({ phase: "setup", busy: false, thinking: false, armed: false, aim: -1, pressed: false });
  }

  function commit(line) {
    const player = game.turn;
    game = R.play(game, line);
    penSound();
    const over = R.isOver(game);
    go({ aim: -1, pressed: false, armed: false, busy: over, thinking: false });
    if (game.claimed.length) claimed(player, over);
    if (over) later(() => finish(game.winner, false), END_MS);
    else if (isCpu(game.turn)) cpuTurn(R.extraTurn(game) ? CPU_AGAIN_MS : CPU_WAIT_MS);
  }
  function claimed(player, over) {
    Sound.sfx("coin");
    if (game.claimed.length > 1) later(() => Sound.sfx("coin"), 120);
    Fx.pop(el.sides[personOf(player)].count);
    if (over) return;
    later(() => {
      extraSound();
      el.callout.className = cls("dots-callout", ink(player));
      el.callout.hidden = false;
      Fx.replay(el.callout, "dots-show");
      later(() => { el.callout.hidden = true; }, CALLOUT_MS);
    }, 130);
  }
  function cpuTurn(wait) {
    go({ busy: true, thinking: true });
    later(() => {
      const line = safeCpuMove();
      go({ aim: line });
      later(() => commit(line), Math.round(wait * 0.45));
    }, Math.round(wait * 0.55));
  }
  function safeCpuMove() {
    try {
      return R.cpuMove(game, settings.level);
    } catch (e) {
      console.error("DotsBoxes: CPU move failed, drawing the first open line", e);
      return R.legalMoves(game)[0];
    }
  }
  /* winner is a rules player (0 moves first) or null for a draw. */
  function finish(winner, resigned) {
    clearTimers();
    Music.stop();
    const wins = match.wins.map((w, i) => (winner !== null && i === personOf(winner) ? w + 1 : w));
    match = { ...match, wins, draws: match.draws + (winner === null ? 1 : 0) };
    go({ phase: "over", busy: false, thinking: false, armed: false, aim: -1, pressed: false, result: { winner, resigned } });
    celebrate(winner);
    Fx.pop(el.title);
  }
  function celebrate(winner) {
    if (winner === null) return Sound.sfx("reveal");
    if (vsCpu() && isCpu(winner)) return Sound.sfx("lose");
    Sound.sfx(vsCpu() ? "victory" : "fanfare");
    Fx.confetti();
  }
  /* Nothing to resign before the first line; this also keeps a double tap on もう一回 from arming 投了. */
  const canResign = () => ui.phase === "play" && !R.isOver(game) && game.moves.length > 0;
  function resign() {
    if (!canResign()) return;
    if (!ui.armed) {
      arms += 1;
      const stamp = arms;
      go({ armed: stamp });
      later(() => { if (ui.armed === stamp) go({ armed: false }); }, ARM_MS);
      return;
    }
    const loser = vsCpu() ? humanPlayer() : game.turn;
    finish(1 - loser, true);
  }
  /* Vs the CPU, undo goes back to just before your latest line (the CPU's replies go too). */
  function canUndo() {
    if (ui.phase !== "play" || ui.busy || R.isOver(game)) return false;
    return vsCpu() ? game.movers.includes(humanPlayer()) : game.moves.length > 0;
  }
  function takeBack() {
    if (!canUndo()) return;
    game = vsCpu() ? R.undoLastBy(game, humanPlayer()) : R.undo(game, 1);
    clearTimers(); /* the coin and "もう1本！" of a box just taken back must not play */
    shown = game.moves.length;
    anim = { line: -1, boxes: [] };
    Sound.sfx("back");
    go({ armed: false, aim: -1 });
  }

  /* ---------- touch and keys ---------- */
  function lineAt(e) {
    const rect = el.board.getBoundingClientRect();
    if (!board || !rect.width || !rect.height) return -1;
    const span = board.n * U + 2 * PAD;
    const x = ((e.clientX - rect.left) / rect.width) * span - PAD;
    const y = ((e.clientY - rect.top) / rect.height) * span - PAD;
    return R.lineNear(board.n, x / U, y / U);
  }
  function aimAt(line, pressed) {
    const aim = line >= 0 && R.canPlay(game, line) ? line : -1;
    if (aim === ui.aim && pressed === ui.pressed) return;
    if (aim >= 0 && aim !== ui.aim && pressed) aimSound();
    go({ aim, pressed });
  }
  function onDown(e) {
    if (!live() || (e.pointerType === "mouse" && e.button !== 0)) return;
    Sound.ensure();
    try { el.board.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported: moves still arrive while over the board */ }
    aimAt(lineAt(e), true);
  }
  function onMove(e) {
    if (live() && (ui.pressed || e.pointerType === "mouse")) aimAt(lineAt(e), ui.pressed);
  }
  /* Lifting the finger draws the line under it; sliding off the board cancels. */
  function onUp(e) {
    if (!ui.pressed) return;
    const line = lineAt(e);
    ui = { ...ui, pressed: false };
    if (!live()) return render();
    if (line >= 0 && R.canPlay(game, line)) return commit(line);
    if (line >= 0) nopeSound();
    aimAt(e.pointerType === "mouse" ? line : -1, false);
  }
  function onLeave() {
    if (!ui.pressed && ui.aim >= 0 && live()) aimAt(-1, false);
  }
  function onCancel() {
    if (ui.pressed) go({ pressed: false, aim: -1 });
  }
  function midpoint(line) {
    const e = R.lineEnds(game.size, line);
    return [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2];
  }
  /* The nearest open line in the arrow's direction. */
  function stepAim(dx, dy) {
    const legal = R.legalMoves(game);
    if (ui.aim < 0) return legal[0];
    const [x, y] = midpoint(ui.aim);
    const scored = legal.map(l => {
      const [lx, ly] = midpoint(l);
      const along = (lx - x) * dx + (ly - y) * dy;
      return { l, along, score: along + 2 * (Math.abs((lx - x) * dy) + Math.abs((ly - y) * dx)) };
    }).filter(c => c.along > 0.01).sort((a, b) => a.score - b.score);
    return scored.length ? scored[0].l : ui.aim;
  }
  function onKey(e) {
    if (!live()) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step) {
      e.preventDefault();
      aimAt(stepAim(...step), false);
    } else if ((e.key === "Enter" || e.key === " ") && ui.aim >= 0) {
      e.preventDefault();
      commit(ui.aim);
    }
  }
  function keyboardFocus() {
    try { return el.board.matches(":focus-visible"); } catch (e) { return false; }
  }
  function bindBoard() {
    el.board.addEventListener("pointerdown", onDown);
    el.board.addEventListener("pointermove", onMove);
    el.board.addEventListener("pointerup", onUp);
    el.board.addEventListener("pointercancel", onCancel);
    el.board.addEventListener("pointerleave", onLeave);
    el.board.addEventListener("keydown", onKey);
    el.board.addEventListener("contextmenu", (e) => e.preventDefault());
    el.board.addEventListener("focus", () => { if (keyboardFocus() && live() && ui.aim < 0) aimAt(stepAim(0, 0), false); });
    el.board.addEventListener("blur", () => { if (!ui.pressed && ui.aim >= 0 && live()) aimAt(-1, false); });
  }

  /* ---------- board (SVG, built once per size) ---------- */
  function svg(tag, attrs, className) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (className) node.setAttribute("class", className);
    return node;
  }
  const group = (nodes) => {
    const g = svg("g", {});
    g.append(...nodes);
    return g;
  };
  function place(node, line) {
    const e = R.lineEnds(board.n, line);
    [["x1", e.x1], ["y1", e.y1], ["x2", e.x2], ["y2", e.y2]].forEach(([k, v]) => node.setAttribute(k, String(v * U)));
  }
  function buildBox(n, b) {
    const x = (b % n) * U;
    const y = Math.floor(b / n) * U;
    const g = svg("g", {}, "dots-box");
    const text = svg("text", { x: x + U / 2, y: y + U / 2 + 2, "text-anchor": "middle", "dominant-baseline": "central" });
    g.append(svg("rect", { x: x + INSET, y: y + INSET, width: U - 2 * INSET, height: U - 2 * INSET, rx: 12 }), text);
    return { g, text };
  }
  function buildBoard(n) {
    if (board && board.n === n) return;
    const span = n * U + 2 * PAD;
    const root = svg("svg", { viewBox: `${-PAD} ${-PAD} ${span} ${span}`, "aria-hidden": "true", focusable: "false" }, "dots-svg");
    const lines = Array.from({ length: R.lineCount(n) }, (_, l) => l);
    const boxes = Array.from({ length: R.boxCount(n) }, (_, b) => buildBox(n, b));
    const strokes = lines.map(() => svg("line", {}, "dots-line dots-off"));
    const halo = svg("line", {}, "dots-halo dots-off");
    const preview = svg("line", {}, "dots-preview dots-off");
    const dots = Array.from({ length: (n + 1) * (n + 1) }, (_, i) =>
      svg("circle", { cx: (i % (n + 1)) * U, cy: Math.floor(i / (n + 1)) * U, r: DOT_R }, "dots-dot"));
    const guides = lines.map(() => svg("line", {}, "dots-guide"));
    root.append(group(boxes.map(b => b.g)), group(guides), halo, group(strokes), preview, group(dots));
    board = { n, boxes, strokes, halo, preview };
    lines.forEach(l => { place(guides[l], l); place(strokes[l], l); });
    el.board.replaceChildren(root);
  }
  function setClass(node, value) {
    if (node.getAttribute("class") !== value) node.setAttribute("class", value);
  }
  /* Boxes that would get a third side from the aimed line (shown as a warning on your turn). */
  function warned() {
    if (!live() || ui.aim < 0 || !R.givesAway(game, ui.aim)) return [];
    return R.boxesOfLine(game.size, ui.aim).filter(b => R.sides(game, b) === 2);
  }
  function renderBoard() {
    if (game.moves.length !== shown) {
      anim = game.moves.length === shown + 1 && !reduced() ? { line: game.last, boxes: game.claimed } : { line: -1, boxes: [] };
      shown = game.moves.length;
    }
    const warn = warned();
    setClass(el.board, cls("dots-board", live() && "dots-live", ui.phase === "over" && "dots-over"));
    board.strokes.forEach((node, l) => {
      const owner = game.lines[l];
      setClass(node, owner === null ? "dots-line dots-off" : cls("dots-line", ink(owner), l === anim.line && "dots-draw"));
    });
    board.boxes.forEach((box, b) => {
      const owner = game.boxes[b];
      setClass(box.g, cls("dots-box", owner !== null && `dots-on ${ink(owner)}`, anim.boxes.includes(b) && "dots-new", warn.includes(b) && "dots-warn"));
      box.text.textContent = owner === null ? "" : match.people[personOf(owner)].mark;
    });
    const aimed = ui.phase === "play" && ui.aim >= 0 && R.canPlay(game, ui.aim) && (live() || ui.thinking);
    if (aimed) place(board.preview, ui.aim);
    setClass(board.preview, aimed ? cls("dots-preview", ink(game.turn), (ui.pressed || ui.thinking) && "dots-press") : "dots-preview dots-off");
    if (game.last !== null) place(board.halo, game.last);
    setClass(board.halo, game.last !== null && ui.phase === "play" ? cls("dots-halo", ink(game.lines[game.last])) : "dots-halo dots-off");
  }

  /* ---------- text for each screen ---------- */
  const levelTag = () => (vsCpu() ? `CPU ${LEVEL_LABELS[settings.level]}・` : "");
  const sizeTag = () => `${game.size}×${game.size}`;
  function playHint() {
    if (R.isOver(game)) return "最後の箱が決まった！";
    if (ui.thinking) return "どこに線を引くか考えています";
    if (warned().length) return "その線は3本目。相手に箱を取られちゃうかも";
    if (R.extraTurn(game)) return "箱を取ったので、続けてもう1本！";
    if (game.moves.length < 2) return "点と点のあいだをタップ。指をすべらせて選んで、はなすと線が引ける";
    return "箱の4辺目を引いた人が、その箱をもらえる";
  }
  function playTitle() {
    if (R.isOver(game)) return "そこまで！";
    if (ui.thinking) return "CPUが考え中…";
    return `${who(game.turn)}の番${R.extraTurn(game) ? "（もう1本）" : ""}`;
  }
  function tally() {
    const [a, b] = match.people;
    const draws = match.draws ? `・引き分け${match.draws}` : "";
    return `通算 ${a.name}${match.wins[0]}勝・${b.name}${match.wins[1]}勝${draws}`;
  }
  function overTitle() {
    const w = ui.result.winner;
    if (w === null) return "引き分け！";
    if (vsCpu()) return isCpu(w) ? "CPUの勝ち…" : "あなたの勝ち！";
    return `${who(w)}の勝ち！`;
  }
  function overReason() {
    const { winner, resigned } = ui.result;
    if (resigned) return `${who(1 - winner)}が投了しました。`;
    const [a, b] = [0, 1].map(person => game.scores[match.first === person ? 0 : 1]);
    return winner === null ? `箱は${a}対${b}で同じ数。` : `箱は${a}対${b}。`;
  }

  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: () => ({
      label: `${levelTag()}${sizeTag()}・残り${left()}本`,
      title: playTitle(),
      hint: playHint(),
      actions: [
        makeButton("1手もどす", takeBack, "small", !canUndo()),
        makeButton(ui.armed ? "本当に投了する" : "投了", resign, ui.armed ? "primary danger" : "small", !canResign())
      ]
    }),
    over: () => ({
      label: `${levelTag()}${sizeTag()}・${game.moves.length}本で決着`,
      title: overTitle(),
      hint: `${overReason()}　${tally()}`,
      actions: [makeButton("設定", toSetup, "small"), makeButton("もう一回", rematch, "primary")]
    })
  };

  /* ---------- rendering ---------- */
  function renderSetup() {
    const cpu = settings.vs === "cpu";
    View.chips($("oVsChips"), options(VS), settings.vs, v => update({ vs: v }));
    View.chips($("oLevelChips"), options(LEVEL_LABELS), settings.level, v => update({ level: v }));
    View.chips($("oOrderChips"), options(ORDER), settings.order, v => update({ order: v }));
    View.chips($("oSizeChips"), R.SIZES.map(n => ({ value: n, label: `${n}×${n}` })), settings.size, v => update({ size: v }));
    el.levelOpt.hidden = !cpu;
    el.orderOpt.hidden = !cpu;
    el.names.hidden = cpu;
    View.list(el.rules, [
      "交代で、となり合う点と点のあいだに線を1本ずつ引く",
      "箱の4辺目を引いた人がその箱をもらい、続けてもう1本引ける",
      "線が全部引かれたら終わり。箱が多いほうの勝ち（同じ数なら引き分け）",
      "3本目の線は相手へのプレゼントになりがち。最後は長い列のゆずり合い",
      cpu ? `CPU（${LEVEL_LABELS[settings.level]}）は${LEVEL_NOTES[settings.level]}` : "1台のスマホを交代で持って遊ぶ。もう一回のたびに先攻が入れかわる"
    ]);
  }
  function stateText(person, player, turn) {
    if (ui.phase === "over") {
      const w = ui.result.winner;
      if (w === player) return "勝ち！";
      if (w === null) return "引き分け";
    }
    if (turn) return ui.thinking ? "考え中…" : "いまの番";
    return `${COLOR[person]}・${match.wins[person]}勝`;
  }
  function renderScores() {
    [0, 1].forEach(person => {
      const s = el.sides[person];
      const player = match.first === person ? 0 : 1;
      const turn = ui.phase === "play" && !R.isOver(game) && game.turn === player;
      const won = ui.phase === "over" && ui.result.winner === player;
      setClass(s.box, cls("dots-side", `dots-c${person}`, turn && "dots-on", turn && ui.thinking && "dots-think", won && "dots-won"));
      s.who.textContent = match.people[person].name;
      s.mark.textContent = match.people[person].mark;
      s.state.textContent = stateText(person, player, turn);
      s.count.textContent = String(game.scores[player]);
    });
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    else {
      renderScores();
      renderBoard();
    }
    View.stage(el, SCREENS[ui.phase]());
  }

  function init() {
    settings = normalize(Store.load(KEY, null));
    Duo.fill(el.nameInputs);
    bindBoard();
    render();
  }
  function leave() {
    clearTimers();
    if (ui.phase === "play") ui = { ...ui, busy: false, thinking: false, armed: false, pressed: false, aim: -1 };
  }
  function onShow() {
    if (ui.phase === "setup") Duo.fill(el.nameInputs);
    if (ui.phase !== "play") return;
    leave(); /* a second onShow must not start a second CPU turn */
    Music.play("think");
    if (R.isOver(game)) {
      finish(game.winner, false); /* left during the last box: settle it now */
      return;
    }
    render();
    if (isCpu(game.turn)) cpuTurn(CPU_WAIT_MS);
  }

  return { init, leave, onShow };
})();

/* Gomoku screen: 15x15 wooden board, tap twice to place a stone, play the CPU or a friend on one phone. */
const Gomoku = (() => {
  const G = GomokuRules;
  const KEY = "gomoku.settings";
  const CPU_DELAY = 450;
  const RESULT_GUARD = 600; // ms: a quick second tap on the last button must not hit もう一回 right away
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MODES = Object.freeze({ cpu: "CPUと", duo: "2人で" });
  const LEVELS = Object.freeze({ easy: "よわい", normal: "ふつう", hard: "つよい" });
  const SIDES = Object.freeze({ first: "先攻（黒）", second: "後攻（白）", random: "ランダム" });
  const COLOR = Object.freeze({ [G.BLACK]: "黒", [G.WHITE]: "白" });
  const ARROWS = Object.freeze({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] });
  const RULES = Object.freeze([
    "黒と白が交互に、線の交わる点へ石を置く。黒が先手",
    "たて・よこ・ななめに5つ並べたら勝ち",
    "フリールール：禁じ手なし。三三も四四もOK、6つ以上並んでも勝ち",
    "置きたい点をタップすると仮置き。同じ点をもう一度タップで決定",
    "盤が全部うまったら引き分け"
  ]);

  const el = {
    setup: $("gSetup"), play: $("gPlay"), title: $("gTitle"), hint: $("gHint"), actions: $("gActions"),
    board: $("gBoard"), grid: $("gGrid"), moves: $("gMoves"), names: $("gNames"),
    nameInputs: [$("gName0"), $("gName1")], levelOpt: $("gLevelOpt"), sideOpt: $("gSideOpt"),
    modeChips: $("gModeChips"), levelChips: $("gLevelChips"), sideChips: $("gSideChips"), rules: $("gRules"),
    side: { [G.BLACK]: $("gSideB"), [G.WHITE]: $("gSideW") },
    name: { [G.BLACK]: $("gNameB"), [G.WHITE]: $("gNameW") },
    count: { [G.BLACK]: $("gCountB"), [G.WHITE]: $("gCountW") }
  };

  let settings = { mode: "cpu", level: "normal", side: "first" };
  let game = G.newGame();
  let match = { cpu: true, level: "normal", human: G.BLACK, round: 0, names: { [G.BLACK]: "あなた", [G.WHITE]: "CPU" } };
  let ui = { phase: "setup", preview: -1, thinking: false, confirm: false, threat: null, error: "" };
  let cells = [];
  let guides = [];
  let cpuTimer = 0;
  let stopConfetti = null;
  let finishedAt = 0;

  const pickKey = (table, value, fallback) => (Object.keys(table).includes(value) ? value : fallback);
  function normalize(s) {
    const src = s && typeof s === "object" ? s : {};
    return {
      mode: pickKey(MODES, src.mode, "cpu"),
      level: pickKey(LEVELS, src.level, "normal"),
      side: pickKey(SIDES, src.side, "first")
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

  const nameOf = (color) => match.names[color];
  const humanTurn = () => !game.over && (!match.cpu || game.turn === match.human);
  const canPlace = () => ui.phase === "play" && !ui.thinking && !ui.confirm && humanTurn() && ui.preview >= 0 && G.isLegal(game, ui.preview);
  function canUndo() {
    if (ui.phase !== "play" || ui.thinking || ui.confirm) return false;
    return match.cpu ? game.moves.some((_, n) => G.colorOfMove(n) === match.human) : game.moves.length > 0;
  }

  /* ---------- sounds ---------- */
  function stoneSound(color) {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = color === G.BLACK ? 1 : 1.09;
    Sound.hiss({ t, dur: 0.04, vol: 0.3, type: "bandpass", freq: 2600 * k, q: 2.4 });
    Sound.tone({ freq: 1700 * k, glide: 1150 * k, glideTime: 0.05, type: "triangle", t, dur: 0.07, vol: 0.12 });
    Sound.tone({ freq: 210, glide: 90, glideTime: 0.08, type: "sine", t, dur: 0.1, vol: 0.3 });
    Sound.hiss({ t: t + 0.01, dur: 0.16, vol: 0.05, type: "lowpass", freq: 1200, to: 300, send: 0.3 });
  }
  const previewSound = () => Sound.tone({ freq: 1320, glide: 1560, glideTime: 0.03, type: "sine", dur: 0.05, vol: 0.06 });
  function threatSound(threat) {
    const ctx = Sound.ctx();
    if (!threat || !ctx) return;
    const mine = match.cpu && threat.color === match.human;
    if (threat.kind !== "three") { Sound.sfx(mine ? "coin" : "heartbeat"); return; }
    const t = ctx.currentTime + 0.09;
    Sound.tone({ freq: Sound.hz(76), type: "triangle", t, dur: 0.12, vol: 0.08 });
    Sound.tone({ freq: Sound.hz(mine ? 83 : 71), type: "triangle", t: t + 0.09, dur: 0.2, vol: 0.08 });
  }

  /* ---------- flow ---------- */
  function newMatch(fresh) {
    const round = fresh ? 1 : match.round + 1;
    if (settings.mode === "cpu") {
      const first = settings.side === "random" ? Math.random() < 0.5 : settings.side === "first";
      const human = first ? G.BLACK : G.WHITE;
      return { cpu: true, level: settings.level, human, round, names: { [human]: "あなた", [G.other(human)]: "CPU" } };
    }
    const [a, b] = Duo.read(el.nameInputs);
    const swap = round % 2 === 0;
    return { cpu: false, level: settings.level, human: G.EMPTY, round, names: { [G.BLACK]: swap ? b : a, [G.WHITE]: swap ? a : b } };
  }
  function start() {
    Sound.ensure();
    Awake.keep();
    clearTimeout(cpuTimer);
    match = newMatch(ui.phase === "setup");
    game = G.newGame();
    Sound.sfx("confirm");
    Music.play("think");
    ui = { phase: "play", preview: -1, thinking: false, confirm: false, threat: null, error: "" };
    Fx.pop(el.board);
    nextTurn();
  }
  function nextTurn() {
    if (game.over) { finish(); return; }
    if (!match.cpu || game.turn === match.human) { go({ thinking: false }); return; }
    go({ thinking: true, preview: -1 });
    const expected = game;
    clearTimeout(cpuTimer);
    cpuTimer = setTimeout(() => cpuPlays(expected), CPU_DELAY);
  }
  function cpuPlays(expected) {
    if (game !== expected || ui.phase !== "play") return;
    try {
      place(G.cpuMove(game, match.level));
    } catch (e) {
      console.error("gomoku cpu", e);
      go({ thinking: false, error: "CPUが打てませんでした。1手もどすか、もう一回遊んでね" });
    }
  }
  function place(i) {
    const color = game.turn;
    game = G.play(game, i);
    stoneSound(color);
    const threat = G.threat(game);
    ui = { ...ui, preview: -1, thinking: false, confirm: false, threat, error: "" };
    if (!game.over) threatSound(threat);
    nextTurn();
  }
  function choose(i) {
    if (ui.phase !== "play" || ui.thinking || ui.confirm || !humanTurn()) return;
    if (!G.isLegal(game, i)) { Sound.beep(180, 0.08, 0, "square", 0.05); return; }
    if (ui.preview === i) { place(i); return; }
    previewSound();
    go({ preview: i });
  }
  function undo() {
    if (!canUndo()) return;
    clearTimeout(cpuTimer);
    game = G.undoTurn(game, match.cpu ? match.human : G.colorOfMove(game.moves.length - 1));
    Sound.sfx("back");
    ui = { ...ui, preview: -1, threat: G.threat(game), error: "" };
    nextTurn();
  }
  function resign() {
    clearTimeout(cpuTimer);
    game = G.resign(game, match.cpu ? match.human : game.turn);
    finish();
  }
  function finish() {
    clearTimeout(cpuTimer);
    finishedAt = Date.now();
    Music.stop();
    go({ phase: "over", preview: -1, thinking: false, confirm: false, threat: null });
    Fx.pop(el.title);
    if (game.draw) { Sound.sfx("reveal"); return; }
    if (match.cpu && game.winner !== match.human) { Sound.sfx("lose"); Fx.shake(); return; }
    Sound.sfx(match.cpu ? "victory" : "fanfare");
    stopConfetti = Fx.confetti() || null;
  }
  function toSetup() {
    clearTimeout(cpuTimer);
    Duo.fill(el.nameInputs);
    go({ phase: "setup", preview: -1, thinking: false, confirm: false });
  }

  /* ---------- text ---------- */
  function statusTitle() {
    if (ui.confirm) return "投了しますか？";
    if (ui.thinking) return "CPUが考え中…";
    if (match.cpu) return game.turn === match.human ? `あなたの番（${COLOR[game.turn]}）` : "CPUの番";
    return `${nameOf(game.turn)}さんの番（${COLOR[game.turn]}）`;
  }
  function threatHint(t) {
    const byCpu = match.cpu && t.color !== match.human;
    const byYou = match.cpu && t.color === match.human;
    const who = byCpu ? "CPU" : COLOR[t.color];
    if (t.kind === "open4") return byYou ? "四が2か所！ もう止められない" : `${who}の四が2か所…！ 大ピンチ`;
    if (t.kind === "four") return byYou ? "四！ あと1つで5つ" : `${who}の四！ ふさがないと負け`;
    return byYou ? "三ができた！ チャンス到来" : `${who}の三！ 早めにふさごう`;
  }
  function playHint() {
    if (ui.confirm) return "投了すると相手の勝ちになります";
    if (ui.error) return ui.error;
    if (ui.threat) return threatHint(ui.threat);
    if (ui.thinking) return "どこに置くかな…";
    if (ui.preview >= 0) return "もう一度タップか「ここに置く」で決定";
    return game.moves.length ? "置きたい点をタップ" : "黒から。まずは真ん中あたりがおすすめ";
  }
  function resultTitle() {
    if (game.draw) return "引き分け";
    if (match.cpu) return game.winner === match.human ? "あなたの勝ち！" : "CPUの勝ち…";
    return `${nameOf(game.winner)}さんの勝ち！`;
  }
  function resultHint() {
    const n = game.moves.length;
    if (game.draw) return `盤がうまりました。全${n}手の大勝負！`;
    if (game.resigned) return `${match.cpu ? "あなた" : `${nameOf(game.resigned)}さん`}が投了。${n}手で決着`;
    return `${COLOR[game.winner]}が5つならべた！ ${n}手で決着`;
  }
  function playActions() {
    if (ui.confirm) {
      return [makeButton("やめない", () => go({ confirm: false }), "small"), makeButton("投了する", resign, "primary danger")];
    }
    return [
      makeButton("投了", () => go({ confirm: true, preview: -1 }), "small", ui.thinking),
      makeButton("1手もどす", undo, "small", !canUndo()),
      makeButton("ここに置く", () => choose(ui.preview), "primary", !canPlace())
    ];
  }

  const settled = (fn) => () => { if (Date.now() - finishedAt >= RESULT_GUARD) fn(); };
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: () => ({ title: statusTitle(), hint: playHint(), actions: playActions() }),
    over: () => ({
      title: resultTitle(),
      hint: resultHint(),
      actions: [makeButton("設定", settled(toSetup), "small"), makeButton("もう一回", settled(start), "primary")]
    })
  };

  /* ---------- rendering ---------- */
  function renderSetup() {
    View.chips(el.modeChips, View.options(Object.keys(MODES), k => MODES[k]), settings.mode, v => update({ mode: v }));
    View.chips(el.levelChips, View.options(Object.keys(LEVELS), k => LEVELS[k]), settings.level, v => update({ level: v }));
    View.chips(el.sideChips, View.options(Object.keys(SIDES), k => SIDES[k]), settings.side, v => update({ side: v }));
    const cpu = settings.mode === "cpu";
    el.levelOpt.hidden = !cpu;
    el.sideOpt.hidden = !cpu;
    el.names.hidden = cpu;
    View.list(el.rules, RULES);
  }
  function renderBar() {
    const n = G.counts(game);
    [G.BLACK, G.WHITE].forEach(c => {
      el.name[c].textContent = nameOf(c);
      const level = match.cpu && c !== match.human ? `${LEVELS[match.level]}・` : "";
      el.count[c].textContent = `${level}石 ${c === G.BLACK ? n.black : n.white}`;
      el.side[c].classList.toggle("on", ui.phase === "play" && game.turn === c);
      el.side[c].classList.toggle("think", ui.thinking && game.turn === c);
      el.side[c].classList.toggle("won", ui.phase === "over" && game.winner === c);
    });
    el.moves.textContent = `${game.moves.length}手`;
  }
  function pointClass(i, last, win, ghost) {
    const v = game.board[i];
    const stone = v === G.BLACK ? "b" : v === G.WHITE ? "w" : "";
    const pv = i !== ghost ? "" : v ? "cursor" : `pv ${game.turn === G.BLACK ? "pv-b" : "pv-w"}`;
    return ["g-pt", stone, i === last ? "last" : "", win.has(i) ? "win" : "", pv].filter(Boolean).join(" ");
  }
  function renderBoard() {
    const last = G.lastMove(game);
    const win = new Set(game.line);
    const ghost = ui.phase === "play" ? ui.preview : -1;
    cells.forEach((cell, i) => {
      const cls = pointClass(i, last, win, ghost);
      if (cell.className !== cls) cell.className = cls;
    });
    const live = ui.phase === "play" && humanTurn() && !ui.thinking && !ui.confirm;
    el.board.classList.toggle("live", live);
    el.board.classList.toggle("turn-w", game.turn === G.WHITE);
    renderGuides(ghost);
  }
  /* Faint row and column lines through the previewed point, so small points are easy to check. */
  function renderGuides(ghost) {
    const [across, down] = guides;
    const on = ghost >= 0;
    [across, down].forEach(g => g.setAttribute("visibility", on ? "visible" : "hidden"));
    if (!on) return;
    const y = G.rowOf(ghost) + 0.5, x = G.colOf(ghost) + 0.5;
    [["y1", y], ["y2", y]].forEach(([k, v]) => across.setAttribute(k, String(v)));
    [["x1", x], ["x2", x]].forEach(([k, v]) => down.setAttribute(k, String(v)));
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    else { renderBar(); renderBoard(); }
    View.stage(el, SCREENS[ui.phase]());
  }

  /* ---------- board ---------- */
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    return node;
  }
  function buildLines() {
    const max = G.SIZE - 0.5;
    const svg = svgEl("svg", { viewBox: `0 0 ${G.SIZE} ${G.SIZE}`, class: "g-lines", "aria-hidden": "true" });
    for (let k = 1; k < G.SIZE - 1; k++) {
      svg.appendChild(svgEl("line", { x1: k + 0.5, y1: 0.5, x2: k + 0.5, y2: max }));
      svg.appendChild(svgEl("line", { x1: 0.5, y1: k + 0.5, x2: max, y2: k + 0.5 }));
    }
    svg.appendChild(svgEl("rect", { x: 0.5, y: 0.5, width: G.SIZE - 1, height: G.SIZE - 1, class: "edge" }));
    G.STARS.forEach(i => svg.appendChild(svgEl("circle", { cx: G.colOf(i) + 0.5, cy: G.rowOf(i) + 0.5, r: 0.12 })));
    guides = [
      svgEl("line", { x1: 0.5, y1: 0.5, x2: max, y2: 0.5, class: "guide", visibility: "hidden" }),
      svgEl("line", { x1: 0.5, y1: 0.5, x2: 0.5, y2: max, class: "guide", visibility: "hidden" })
    ];
    guides.forEach(g => svg.appendChild(g));
    return svg;
  }
  function buildBoard() {
    cells = Array.from({ length: G.CELLS }, (_, i) => {
      const d = document.createElement("div");
      d.className = "g-pt";
      d.dataset.i = String(i);
      return d;
    });
    el.grid.replaceChildren(buildLines(), ...cells);
    el.grid.addEventListener("click", (e) => {
      const cell = e.target.closest(".g-pt");
      if (cell) choose(Number(cell.dataset.i));
    });
    el.board.addEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (ui.phase !== "play" || ui.thinking || ui.confirm || !humanTurn()) return;
    if (ARROWS[e.key]) {
      e.preventDefault();
      const last = G.lastMove(game);
      const from = ui.preview >= 0 ? ui.preview : last >= 0 ? last : G.CENTER;
      const [dr, dc] = ARROWS[e.key];
      const next = G.at(G.rowOf(from) + dr, G.colOf(from) + dc);
      if (next >= 0) { previewSound(); go({ preview: next }); }
    } else if ((e.key === "Enter" || e.key === " ") && ui.preview >= 0) {
      e.preventDefault();
      choose(ui.preview);
    }
  }

  function init() {
    settings = normalize(Store.load(KEY, {}));
    Duo.fill(el.nameInputs);
    buildBoard();
    render();
  }
  function leave() {
    clearTimeout(cpuTimer);
    if (stopConfetti) stopConfetti();
    stopConfetti = null;
    if (ui.thinking || ui.confirm) ui = { ...ui, thinking: false, confirm: false };
  }
  function onShow() {
    if (ui.phase !== "play") { render(); return; }
    Music.play("think");
    nextTurn();
  }

  return { init, leave, onShow };
})();

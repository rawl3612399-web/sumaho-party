/* 四目並べ screen: drop discs into a 7x6 board, against the CPU or a friend on one phone. */
const Connect4 = (() => {
  const C = Connect4Rules;
  const KEY = "connect4.settings";
  const CPU_AIM_MS = 200;
  const CPU_WAIT_MS = 450;
  const ARM_MS = 3000;
  const CONFIRM_GAP_MS = 400; /* a second tap sooner than this is a double tap, not a confirmation */
  const LAND_AT = 0.72; /* share of the drop animation when the disc first touches down (matches the CSS keyframes) */
  const VS = Object.freeze({ cpu: "CPUと", duo: "2人で" });
  const LEVEL_LABELS = Object.freeze({ easy: "よわい", normal: "ふつう", hard: "つよい" });
  const LEVEL_NOTES = Object.freeze({ easy: "ときどき見落としてくれる。まずはここから",
    normal: "4手先まで読んでくる。油断すると負けるかも", hard: "7手先以上まで読んでくる本気モード" });
  const ORDER = Object.freeze({ first: "先攻", second: "後攻", random: "ランダム" });
  const COLOR = Object.freeze(["赤", "黄色"]);
  const KIND_NAMES = Object.freeze({ row: "ヨコ", col: "タテ", diag: "ナナメ", anti: "ナナメ" });
  const DEFAULTS = Object.freeze({ vs: "cpu", level: "normal", order: "first" });

  const el = {
    stage: $("cStage"), setup: $("cSetup"), play: $("cPlay"), label: $("cLabel"), title: $("cTitle"), card: null,
    hint: $("cHint"), actions: $("cActions"), scores: $("cScores"), board: $("cBoard"), rules: $("cRules"),
    levelOpt: $("cLevelOpt"), orderOpt: $("cOrderOpt"), names: $("cNames"), nameInputs: [$("cName1"), $("cName2")]
  };

  let settings = DEFAULTS;
  let game = null;
  let match = null; /* { people: [{ name, cpu }], red: person index playing red, wins: [n, n], draws } */
  /* busy: taps ignored (disc falling, CPU thinking). landing: a disc has not touched down. armed: when 投了 was first tapped, or 0. */
  const FRESH = Object.freeze({ aim: 3, busy: false, landing: false, thinking: false, armed: 0, note: "", result: null });
  let ui = { ...FRESH, phase: "setup" };
  let timers = [];
  let shown = 0; /* moves already drawn; the next one gets the drop animation */
  let cols = [];

  const reduced = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const personOf = (player) => (player === 0 ? match.red : 1 - match.red);
  const isCpu = (player) => match.people[personOf(player)].cpu;
  const vsCpu = () => match.people.some(p => p.cpu);
  const humanTurn = () => ui.phase === "play" && !C.isOver(game) && !isCpu(game.turn);
  const fallMs = (row) => 200 + 25 * (C.ROWS - row);
  const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
  const who = (player) => (isCpu(player) ? "CPU" : vsCpu() ? "あなた" : `${match.people[personOf(player)].name}さん`);

  /* ---------- settings ---------- */
  function normalize(s) {
    const src = s && typeof s === "object" ? s : {};
    const pick = (key, allowed) => (allowed.includes(src[key]) ? src[key] : DEFAULTS[key]);
    return { vs: pick("vs", Object.keys(VS)), level: pick("level", C.LEVELS), order: pick("order", Object.keys(ORDER)) };
  }
  function update(patch) {
    settings = normalize({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(patch) { ui = { ...ui, ...patch }; render(); }
  function later(fn, ms) {
    const id = setTimeout(() => { timers = timers.filter(t => t !== id); fn(); }, ms);
    timers = [...timers, id];
  }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /* ---------- flow ---------- */
  function redFor(prev) {
    if (settings.vs === "duo") return prev === null ? 0 : 1 - prev;
    if (settings.order === "random") return Math.random() < 0.5 ? 0 : 1;
    return settings.order === "first" ? 0 : 1;
  }
  function start() {
    Sound.ensure();
    Awake.keep();
    const people = settings.vs === "duo"
      ? Duo.read(el.nameInputs).map(name => ({ name, cpu: false }))
      : [{ name: "あなた", cpu: false }, { name: "CPU", cpu: true }];
    match = { people, red: redFor(null), wins: [0, 0], draws: 0 };
    newRound();
  }
  function rematch() {
    match = { ...match, red: redFor(match.red) };
    newRound();
  }
  function newRound() {
    clearTimers();
    game = C.newGame();
    shown = 0;
    ui = { ...FRESH, phase: "play" };
    Sound.sfx("confirm");
    Music.play("think");
    render();
    Fx.pop(el.board);
    if (isCpu(game.turn)) cpuTurn();
  }
  function toSetup() {
    clearTimers();
    Music.stop();
    go({ ...FRESH, phase: "setup" });
  }
  function onColumn(c) {
    if (!humanTurn() || ui.busy) return;
    if (!C.canDrop(game, c)) {
      Sound.sfx("wrong");
      go({ aim: c, note: "その列はもういっぱい。ほかの列にしよう" });
      Fx.replay(cols[c].ghost, "c4-nope");
      return;
    }
    drop(c);
  }
  function drop(c) {
    const player = game.turn;
    game = C.play(game, c);
    const ms = reduced() ? 0 : fallMs(game.last.row);
    go({ aim: c, busy: true, landing: true, thinking: false, armed: 0, note: "" });
    dropSound((ms * LAND_AT) / 1000, game.last.row, player);
    later(landed, ms * LAND_AT);
  }
  function landed() {
    if (C.isOver(game)) return finish(game.draw ? null : game.winner, game.draw ? "draw" : "four");
    const reach = reachNote();
    if (reach) Sound.sfx(reach.good ? "coin" : "heartbeat");
    go({ busy: false, landing: false, note: reach ? reach.text : "" });
    if (isCpu(game.turn)) cpuTurn();
  }
  /* Who can make four next, never which column. A human to move hears their own chance first (no "block" advice when they can win). */
  function reachNote() {
    const next = game.turn;
    const mover = 1 - next;
    if (!isCpu(next) && C.winningMoves(game, next).length) {
      return { good: vsCpu(), text: vsCpu() ? "チャンス！ 4つそろう列があるよ" : `${who(next)}のチャンス！ 4つそろう列があるよ` };
    }
    if (!C.winningMoves(game, mover).length) return null;
    if (!vsCpu()) return { good: false, text: `${who(mover)}がリーチ！ 4つ目を止めないと負けちゃう` };
    return isCpu(mover) ? { good: false, text: "CPUがリーチ！ 4つ目をふさごう" } : { good: true, text: "リーチ！ あと1つでそろう" };
  }
  function cpuTurn() {
    go({ busy: true, thinking: true });
    later(() => {
      const col = safeCpuMove();
      go({ aim: col });
      later(() => drop(col), CPU_WAIT_MS - CPU_AIM_MS);
    }, CPU_AIM_MS);
  }
  function safeCpuMove() {
    try {
      return C.cpuMove(game, settings.level);
    } catch (e) {
      console.error("Connect4: CPU move failed, playing the first open column", e);
      return C.legalMoves(game)[0];
    }
  }
  function finish(winner, reason) {
    clearTimers();
    Music.stop();
    const wins = match.wins.map((w, i) => (winner !== null && i === personOf(winner) ? w + 1 : w));
    match = { ...match, wins, draws: match.draws + (winner === null ? 1 : 0) };
    go({ ...FRESH, aim: ui.aim, phase: "over", result: { winner, reason } });
    celebrate(winner);
    Fx.pop(el.title);
  }
  function celebrate(winner) {
    if (winner === null) return Sound.sfx("reveal");
    const lost = vsCpu() && isCpu(winner);
    Sound.sfx(lost ? "lose" : vsCpu() ? "victory" : "fanfare");
    if (lost) Fx.shake(); else Fx.confetti();
  }
  /* 投了 needs a second tap within ARM_MS; a double tap (faster than CONFIRM_GAP_MS) does not count. */
  function resign() {
    if (ui.phase !== "play" || (ui.busy && !ui.thinking)) return;
    if (!ui.armed) {
      const at = performance.now();
      go({ armed: at });
      later(() => { if (ui.armed === at) go({ armed: 0 }); }, ARM_MS);
      return;
    }
    if (performance.now() - ui.armed < CONFIRM_GAP_MS) return;
    const loser = vsCpu() ? [0, 1].find(p => !isCpu(p)) : game.turn;
    finish(1 - loser, "resign");
  }
  /* Vs the CPU, one undo goes back to your previous turn (your move and the CPU's reply). */
  function undoSteps() {
    if (ui.phase !== "play" || ui.busy || !game) return 0;
    const n = vsCpu() ? 2 : 1;
    return game.moves.length >= n ? n : 0;
  }
  function takeBack() {
    const n = undoSteps();
    if (!n) return;
    game = C.undo(game, n);
    shown = game.moves.length;
    Sound.sfx("back");
    go({ note: "", armed: 0 });
  }

  /* ---------- sound ---------- */
  /* A soft swish when the disc is let go, then a plastic "thunk" and a tiny bounce where it lands. */
  function dropSound(delay, row, player) {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const land = t + delay;
    const base = 118 + row * 7 + player * 9;
    Sound.hiss({ t, dur: 0.12, vol: 0.05, type: "bandpass", freq: 2600, to: 900 });
    Sound.tone({ freq: base * 2.4, glide: base, glideTime: 0.07, type: "sine", t: land, dur: 0.2, vol: 0.5 });
    Sound.tone({ freq: 1500, glide: 700, type: "triangle", t: land, dur: 0.04, vol: 0.07 });
    Sound.hiss({ t: land, dur: 0.07, vol: 0.16, type: "lowpass", freq: 1700, to: 300 });
    Sound.tone({ freq: base * 1.9, glide: base * 1.2, type: "sine", t: land + 0.09, dur: 0.09, vol: 0.13 });
  }

  /* ---------- text for each screen ---------- */
  function lineName() {
    const kinds = C.lineKinds(game);
    if (kinds.length !== 1) return `一度に${kinds.length}方向そろった！`;
    return `${KIND_NAMES[kinds[0]]}に${game.line.length}つそろった！`;
  }
  function tally() {
    const [a, b] = match.people;
    const draws = match.draws ? `、引き分け${match.draws}回` : "";
    return `通算 ${a.name}が${match.wins[0]}勝、${b.name}が${match.wins[1]}勝${draws}`;
  }
  function overTitle() {
    const w = ui.result.winner;
    if (w === null) return "引き分け！";
    if (vsCpu()) return isCpu(w) ? "CPUの勝ち…" : "あなたの勝ち！";
    return `${who(w)}の勝ち！`;
  }
  function overReason() {
    const { winner, reason } = ui.result;
    if (reason === "draw") return "盤がうまって、どちらも4つそろわず。";
    if (reason === "resign") return `${who(1 - winner)}が投了しました。`;
    return lineName();
  }
  const levelTag = () => (vsCpu() ? `CPU ${LEVEL_LABELS[settings.level]}・` : "");
  function playHint() {
    if (ui.thinking) return "どこに落とすか考えています";
    if (game.moves.length < 2) return "落としたい列をタップ。コマはいちばん下まで落ちる";
    return `${COLOR[game.turn]}のコマ。タテ・ヨコ・ナナメに4つをめざそう`;
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: () => ({
      label: `${levelTag()}${game.moves.length + 1}手目`,
      title: ui.thinking ? "CPUが考え中…" : `${who(game.turn)}の番（${COLOR[game.turn]}）`,
      hint: ui.note || playHint(),
      actions: [
        makeButton("1手もどす", takeBack, "small", undoSteps() === 0),
        makeButton(ui.armed ? "本当に投了する" : "投了", resign, ui.armed ? "primary danger" : "small")
      ]
    }),
    over: () => ({
      label: `${levelTag()}${game.moves.length ? `${game.moves.length}手で` : ""}決着`,
      title: overTitle(),
      hint: `${overReason()}\n${tally()}`, /* #cHint keeps the line break (white-space: pre-line) */
      actions: [makeButton("設定", toSetup, "small"), makeButton("もう一回", rematch, "primary")]
    })
  };

  /* ---------- rendering ---------- */
  function renderSetup() {
    const cpu = settings.vs === "cpu";
    View.chips($("cVsChips"), options(VS), settings.vs, v => update({ vs: v }));
    View.chips($("cLevelChips"), options(LEVEL_LABELS), settings.level, v => update({ level: v }));
    View.chips($("cOrderChips"), options(ORDER), settings.order, v => update({ order: v }));
    el.levelOpt.hidden = !cpu;
    el.orderOpt.hidden = !cpu;
    el.names.hidden = cpu;
    View.list(el.rules, [
      "交代で、好きな列にコマを1つずつ落とす。コマはいちばん下まで落ちる",
      "タテ・ヨコ・ナナメのどれかに、自分の色を4つ並べたら勝ち",
      "先攻が赤、後攻が黄色。盤がうまっても4つ並ばなければ引き分け",
      cpu ? `CPU（${LEVEL_LABELS[settings.level]}）は${LEVEL_NOTES[settings.level]}` : "1台のスマホを交代で持って遊ぶ。もう一回のたびに先攻が入れかわる"
    ]);
  }
  function renderScores() {
    const counts = C.counts(game);
    const winner = ui.phase === "over" ? ui.result.winner : null;
    el.scores.replaceChildren(...[0, 1].map(player => {
      const card = document.createElement("div");
      const turn = ui.phase === "play" && game.turn === player;
      card.className = `c4-side c4-p${player}${turn ? " c4-turn" : ""}${winner === player ? " c4-won" : ""}`;
      card.innerHTML = '<span class="c4-swatch"></span><span class="c4-who"><span class="c4-name"></span><span class="c4-meta"></span></span>';
      card.querySelector(".c4-name").textContent = match.people[personOf(player)].name;
      card.querySelector(".c4-meta").textContent = `${COLOR[player]}・${counts[player]}個・${match.wins[personOf(player)]}勝`;
      return card;
    }));
  }
  function renderBoard() {
    const ghostOn = (!ui.busy && humanTurn()) || ui.thinking;
    const flags = { "c4-t0": game.turn === 0, "c4-t1": game.turn === 1, "c4-over": ui.phase === "over",
      "c4-decided": game.line.length > 0, "c4-live": !ui.busy && humanTurn() };
    Object.entries(flags).forEach(([cls, on]) => el.board.classList.toggle(cls, on)); /* one by one: keeps a running Fx.pop */
    cols.forEach((col, c) => {
      const full = game.heights[c] >= C.ROWS;
      const aimed = ghostOn && c === ui.aim;
      col.el.classList.toggle("c4-full", full);
      col.el.classList.toggle("c4-aim", aimed);
      col.el.setAttribute("aria-label", `${c + 1}列目${full ? "（いっぱい）" : ""}`);
      col.ghostDisc.classList.toggle("c4-p0", aimed && game.turn === 0);
      col.ghostDisc.classList.toggle("c4-p1", aimed && game.turn === 1);
      col.cells.forEach((cell, row) => paintCell(cell, c, row, aimed && row === game.heights[c]));
    });
    animateNew();
  }
  function paintCell(cell, col, row, target) {
    const i = C.index(col, row);
    const v = game.board[i];
    cell.el.classList.toggle("c4-win", game.line.includes(i));
    cell.el.classList.toggle("c4-target", target);
    cell.disc.classList.toggle("c4-p0", v === 0);
    cell.disc.classList.toggle("c4-p1", v === 1);
    cell.disc.classList.toggle("c4-last", !!game.last && game.last.col === col && game.last.row === row);
  }
  /* The newest disc falls from the ghost spot above its column into its cell. */
  function animateNew() {
    const n = game.moves.length;
    if (n === shown + 1 && game.last && !reduced()) {
      const { col, row } = game.last;
      const cell = cols[col].cells[row];
      const from = cols[col].ghost.getBoundingClientRect().top - cell.el.getBoundingClientRect().top;
      cell.disc.style.setProperty("--c4-from", `${from}px`);
      cell.disc.style.setProperty("--c4-ms", `${fallMs(row)}ms`);
      Fx.replay(cell.disc, "c4-drop");
    }
    shown = n;
  }
  function render() {
    el.stage.classList.toggle("c4-wide", ui.phase !== "setup");
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    el.scores.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    else { renderScores(); renderBoard(); }
    View.stage(el, SCREENS[ui.phase]());
  }

  /* ---------- board markup (built once) ---------- */
  function slot(cls) {
    const box = document.createElement("div");
    box.className = cls;
    const disc = document.createElement("span");
    disc.className = "c4-disc";
    box.appendChild(disc);
    box.addEventListener("animationend", (e) => {
      if (e.target === disc) disc.classList.remove("c4-drop");
      else box.classList.remove("c4-nope");
    });
    return { el: box, disc };
  }
  function aim(c) {
    if (c === ui.aim || !humanTurn() || ui.busy) return;
    ui = { ...ui, aim: c };
    renderBoard();
  }
  function onKey(e, c) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (step) cols[Math.min(C.COLS - 1, Math.max(0, c + step))].el.focus();
    else onColumn(c);
  }
  function buildColumn(c) {
    const col = document.createElement("div");
    col.className = "c4-col";
    col.tabIndex = 0;
    col.setAttribute("role", "button");
    const ghost = slot("c4-ghost");
    const cells = Array.from({ length: C.ROWS }, () => slot("c4-cell")); /* index = row, 0 is the bottom */
    col.append(ghost.el, ...[...cells].reverse().map(x => x.el));
    col.addEventListener("click", () => onColumn(c));
    col.addEventListener("pointermove", () => aim(c));
    col.addEventListener("focus", () => aim(c));
    col.addEventListener("keydown", (e) => onKey(e, c));
    return { el: col, ghost: ghost.el, ghostDisc: ghost.disc, cells };
  }
  function buildBoard() {
    cols = Array.from({ length: C.COLS }, (_, c) => buildColumn(c));
    const frame = document.createElement("div");
    frame.className = "c4-frame";
    el.board.replaceChildren(...cols.map(x => x.el), frame);
  }
  function init() {
    settings = normalize(Store.load(KEY, null));
    Duo.fill(el.nameInputs);
    buildBoard();
    render();
  }
  /* Stops the CPU and drop timers; `landing` stays set so onShow can finish that move (win check, CPU reply). */
  function leave() {
    clearTimers();
    el.board.querySelectorAll(".c4-drop, .c4-nope").forEach(x => x.classList.remove("c4-drop", "c4-nope"));
    if (ui.phase === "play") ui = { ...ui, busy: false, thinking: false, armed: 0 };
  }
  function onShow() {
    if (ui.phase === "setup") Duo.fill(el.nameInputs);
    if (ui.phase !== "play") return;
    Music.play("think");
    if (ui.landing) return landed();
    render();
    if (isCpu(game.turn)) cpuTurn();
  }

  return { init, leave, onShow };
})();

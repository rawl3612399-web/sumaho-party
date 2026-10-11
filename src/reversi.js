/* Reversi screen: 8x8 board against the CPU or a friend, with flip animations, passes and a live score bar. */
const Reversi = (() => {
  const V = ReversiRules;
  const KEY = "reversi.settings";
  const RECORD_KEY = "reversi.record";
  const CPU_WAIT_MS = 450;
  const PASS_MS = 1500;
  const CALM_MS = 600; /* after つぎへ, a quick second tap must not land on 1手もどす */
  const PLACE_MS = 90;
  const FLIP_MS = 300;
  const FLIP_STEP_MS = 60;
  const SIDES = ["black", "white", "random"];
  const LEVEL_LABEL = { easy: "よわい", normal: "ふつう", hard: "つよい" };
  const SIDE_LABEL = { black: "黒（先攻）", white: "白（後攻）", random: "ランダム" };
  const COLOR_NAME = { [V.BLACK]: "黒", [V.WHITE]: "白" };
  const RULES = [
    "黒が先攻。相手の石を自分の石ではさめるマスにだけ置ける",
    "はさんだ石は、たて・よこ・ななめ全部ひっくり返って自分の色になる",
    "置ける場所がないときはパス。どちらも置けなくなったら終わり",
    "最後に石が多いほうの勝ち。同じ数なら引き分け"
  ];

  const el = {
    setup: $("vSetup"), play: $("vPlay"), label: $("vLabel"), title: $("vTitle"), hint: $("vHint"),
    actions: $("vActions"), board: $("vBoard"), banner: $("vBanner"), bannerSub: $("vBannerSub"),
    namesBox: $("vNames"), names: [$("vName1"), $("vName2")], record: $("vRecord"),
    sides: {
      [V.BLACK]: { box: $("vSideB"), name: $("vNameB"), state: $("vStateB"), count: $("vCountB") },
      [V.WHITE]: { box: $("vSideW"), name: $("vNameW"), state: $("vStateW"), count: $("vCountW") }
    }
  };

  let settings = { vs: "cpu", level: "normal", side: "black", hints: true };
  let match = { cpu: true, human: V.BLACK, level: "normal", names: { [V.BLACK]: "あなた", [V.WHITE]: "CPU" } };
  let game = null;
  let history = [];
  let ui = { phase: "setup", wait: null, anim: null, confirm: false, end: null, calmUntil: 0 };
  let cells = [];
  let timer = 0;

  const cls = (...names) => names.filter(Boolean).join(" ");
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isCpuTurn = () => match.cpu && game.turn !== match.human;
  const who = (color) => match.names[color];

  function normalize(s) {
    return {
      vs: s.vs === "duo" ? "duo" : "cpu",
      level: V.LEVELS.includes(s.level) ? s.level : "normal",
      side: SIDES.includes(s.side) ? s.side : "black",
      hints: typeof s.hints === "boolean" ? s.hints : true
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
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }

  /* ---------- record against the CPU ---------- */
  function loadRecord() {
    const raw = Store.load(RECORD_KEY, {});
    const src = raw && typeof raw === "object" ? raw : {};
    const n = (x) => (Number.isInteger(x) && x >= 0 ? x : 0);
    return Object.fromEntries(V.LEVELS.map(l => [l, { win: n(src[l]?.win), lose: n(src[l]?.lose), draw: n(src[l]?.draw) }]));
  }
  function saveRecord(winner) {
    const rec = loadRecord();
    const key = winner === V.EMPTY ? "draw" : winner === match.human ? "win" : "lose";
    const mine = rec[match.level];
    Store.save(RECORD_KEY, { ...rec, [match.level]: { ...mine, [key]: mine[key] + 1 } });
  }
  function recordText() {
    const r = loadRecord()[settings.level];
    if (!r.win && !r.lose && !r.draw) return "";
    return `${LEVEL_LABEL[settings.level]}との成績：${r.win}勝 ${r.lose}敗${r.draw ? ` ${r.draw}分` : ""}`;
  }

  /* ---------- sounds ---------- */
  function soundMove(plan) {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    Sound.hiss({ t, dur: 0.035, vol: 0.3, type: "bandpass", freq: 2400, q: 1.3 });
    Sound.tone({ freq: 230, glide: 110, glideTime: 0.07, type: "sine", t, dur: 0.1, vol: 0.38 });
    const delays = [...plan.delays.values()].sort((a, b) => a - b);
    let same = 0;
    delays.forEach((d, k) => {
      same = k > 0 && d === delays[k - 1] ? same + 1 : 0;
      const at = t + (d + FLIP_MS / 2) / 1000 + same * 0.014;
      Sound.tone({ freq: 1250 + k * 55, type: "triangle", t: at, dur: 0.03, vol: 0.1 });
      Sound.hiss({ t: at, dur: 0.02, vol: 0.05, type: "highpass", freq: 5000 });
    });
    if (V.CORNERS.includes(plan.at)) Sound.sfx("coin");
  }
  function soundPass() {
    const ctx = Sound.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    Sound.tone({ freq: Sound.hz(76), type: "square", t, dur: 0.12, vol: 0.06, filter: { freq: 2400 } });
    Sound.tone({ freq: Sound.hz(69), type: "square", t: t + 0.13, dur: 0.26, vol: 0.06, filter: { freq: 2400 }, send: 0.2 });
  }
  function soundNope() {
    Sound.tone({ freq: 150, type: "square", dur: 0.08, vol: 0.05, filter: { freq: 800 } });
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    const human = settings.side === "random" ? (Math.random() < 0.5 ? V.BLACK : V.WHITE) : settings.side === "white" ? V.WHITE : V.BLACK;
    const duo = settings.vs === "duo" ? Duo.read(el.names) : null;
    match = {
      cpu: !duo, human, level: settings.level,
      names: duo ? { [V.BLACK]: duo[0], [V.WHITE]: duo[1] } : { [human]: "あなた", [3 - human]: "CPU" }
    };
    game = V.newGame();
    history = [game];
    Sound.sfx("confirm");
    Music.play("think");
    go({ phase: "play", wait: null, anim: null, confirm: false, end: null });
    Fx.pop(el.board);
    next();
  }
  /* Decides what happens after every move or pass. */
  function next() {
    if (game.over) {
      finish(null);
      return;
    }
    if (V.mustPass(game)) {
      showPass();
      return;
    }
    if (isCpuTurn()) {
      go({ wait: "cpu" });
      later(cpuPlay, CPU_WAIT_MS);
      return;
    }
    go({ wait: null });
  }
  function cpuPlay() {
    if (ui.phase !== "play" || !isCpuTurn()) return;
    let sq;
    try {
      sq = V.cpuMove(game, match.level);
    } catch (e) {
      console.error("リバーシ: CPUの手を決められませんでした", e);
      sq = V.legalMoves(game)[0];
    }
    move(sq);
  }
  function tapCell(i) {
    if (ui.phase !== "play" || ui.wait || ui.confirm || isCpuTurn()) return;
    if (!V.isLegal(game, i)) {
      soundNope();
      Fx.replay(cells[i], "v-nope");
      return;
    }
    move(i);
  }
  /* Flips ripple outward from the new stone. */
  function flipPlan(state) {
    const at = state.last;
    const dist = (sq) => Math.max(Math.abs((sq >> 3) - (at >> 3)), Math.abs((sq & 7) - (at & 7)));
    const delays = new Map(state.flipped.map(sq => [sq, PLACE_MS + (dist(sq) - 1) * FLIP_STEP_MS]));
    const total = reduced() ? 180 : Math.max(...delays.values()) + FLIP_MS + 140;
    return { at, by: 3 - state.turn, delays, total };
  }
  function move(i) {
    game = V.play(game, i);
    history = [...history, game];
    const plan = flipPlan(game);
    go({ wait: "anim", anim: plan });
    soundMove(plan);
    later(() => {
      ui = { ...ui, anim: null };
      next();
    }, plan.total);
  }
  function showPass() {
    go({ wait: "pass" });
    soundPass();
    if (match.cpu) later(doPass, PASS_MS);
  }
  function doPass() {
    if (ui.phase !== "play" || ui.wait !== "pass") return;
    game = V.pass(game);
    history = [...history, game];
    ui = { ...ui, calmUntil: Date.now() + CALM_MS };
    Sound.sfx("whoosh");
    next();
  }
  /* 1手もどす: back to the previous position where it was the human's move (any real move in 2-player). */
  function undoTarget() {
    for (let i = history.length - 2; i >= 0; i--) {
      if (V.mustPass(history[i])) continue;
      if (!match.cpu || history[i].turn === match.human) return i;
    }
    return -1;
  }
  function undo() {
    const i = undoTarget();
    if (i < 0 || ui.wait || Date.now() < ui.calmUntil) return;
    clearTimeout(timer);
    history = history.slice(0, i + 1);
    game = history[i];
    Sound.sfx("back");
    go({ wait: null, anim: null, confirm: false });
  }
  /* The resign question pauses a pending CPU move, so the board never changes behind it. */
  function askResign() {
    if (ui.phase !== "play" || ui.wait === "anim" || ui.wait === "pass") return;
    clearTimeout(timer);
    go({ confirm: true, wait: null });
  }
  function keepPlaying() {
    ui = { ...ui, confirm: false };
    next();
  }
  function resign() {
    if (ui.phase !== "play" || !ui.confirm) return;
    finish(match.cpu ? match.human : game.turn);
  }
  function finish(resigned) {
    clearTimeout(timer);
    const winner = resigned ? 3 - resigned : V.result(game).winner;
    Music.stop();
    go({ phase: "result", wait: null, anim: null, confirm: false, end: { winner, resigned } });
    if (match.cpu) saveRecord(winner);
    if (winner === V.EMPTY) Sound.sfx("reveal");
    else if (!match.cpu) Sound.sfx("fanfare");
    else Sound.sfx(winner === match.human ? "victory" : "lose");
    if (winner !== V.EMPTY && (!match.cpu || winner === match.human)) Fx.confetti();
  }

  /* ---------- screens ---------- */
  function statusText() {
    if (ui.wait === "pass") return `${who(game.turn)}はパス`;
    if (ui.wait === "cpu") return "CPUが考え中…";
    if (ui.wait === "anim") return `${who(ui.anim.by)}の番`;
    return `${who(game.turn)}の番`;
  }
  function hintText() {
    if (ui.wait === "pass") return match.cpu ? "" : "「つぎへ」で相手の番にもどります";
    if (ui.wait || isCpuTurn()) return "";
    const color = `${COLOR_NAME[game.turn]}の石`;
    return settings.hints ? `${color}を、点のマスに置けます` : `${color}で、相手の石をはさめるマスに置こう`;
  }
  function playView() {
    if (ui.confirm) {
      return {
        label: "投了",
        title: "投了しますか？",
        hint: match.cpu ? "CPUの勝ちになります" : `${who(game.turn)}の負けになります`,
        actions: [makeButton("つづける", keepPlaying, "small"), makeButton("投了する", resign, "primary danger")]
      };
    }
    const actions = ui.wait === "pass" && !match.cpu
      ? [makeButton("つぎへ", doPass, "primary")]
      : [
        makeButton("投了", askResign, "small", ui.wait === "anim" || ui.wait === "pass"),
        makeButton("1手もどす", undo, "small", Boolean(ui.wait) || undoTarget() < 0)
      ];
    return { label: `のこり${V.counts(game.board).empty}マス`, title: statusText(), hint: hintText(), actions };
  }
  function resultTitle() {
    const { winner, resigned } = ui.end;
    if (resigned && match.cpu) return "投了しました。CPUの勝ち";
    if (resigned) return `${who(resigned)}が投了。${who(winner)}の勝ち！`;
    if (winner === V.EMPTY) return "引き分け！";
    if (!match.cpu) return `${who(winner)}の勝ち！`;
    return winner === match.human ? "あなたの勝ち！" : "CPUの勝ち…";
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: playView,
    result: () => {
      const c = V.counts(game.board);
      return {
        label: ui.end.resigned ? "投了" : "対局終了",
        title: resultTitle(),
        hint: `黒 ${c.black} 対 ${c.white} 白`,
        actions: [makeButton("設定", () => go({ phase: "setup" }), "small"), makeButton("もう一回", start, "primary")]
      };
    }
  };

  function paintScores() {
    const c = V.counts(game.board);
    [V.BLACK, V.WHITE].forEach(color => {
      const s = el.sides[color];
      const turn = ui.wait === "anim" ? ui.anim.by : game.turn;
      const on = ui.phase === "play" && turn === color;
      const won = ui.phase === "result" && ui.end.winner === color;
      s.box.classList.toggle("on", on);
      s.box.classList.toggle("won", won);
      s.box.classList.toggle("thinking", on && ui.wait === "cpu");
      s.name.textContent = who(color);
      s.state.textContent = won ? "勝ち" : on ? (ui.wait === "cpu" ? "考え中…" : ui.wait === "pass" ? "パス" : "手番") : "";
      const n = String(color === V.BLACK ? c.black : c.white);
      if (s.count.textContent !== n) {
        s.count.textContent = n;
        Fx.pop(s.count);
      }
    });
  }
  function paintBoard() {
    const showHints = settings.hints && ui.phase === "play" && !ui.wait && !ui.confirm && !isCpuTurn();
    const legal = new Set(showHints ? V.legalMoves(game) : []);
    const plan = ui.anim;
    el.board.dataset.turn = game.turn === V.BLACK ? "black" : "white";
    el.board.classList.toggle("v-locked", ui.phase !== "play" || Boolean(ui.wait) || isCpuTurn());
    cells.forEach((cell, i) => {
      const v = game.board[i];
      const delay = plan ? plan.delays.get(i) : undefined;
      cell.className = cls("v-cell", legal.has(i) && "v-can", game.last === i && "v-last");
      cell.firstChild.className = cls("v-disc", v === V.BLACK && "v-b", v === V.WHITE && "v-w",
        plan && plan.at === i && "v-place", delay !== undefined && "v-flip");
      cell.firstChild.style.setProperty("--v-delay", `${delay ?? 0}ms`);
      cell.setAttribute("aria-label", `${V.name(i)} ${v ? COLOR_NAME[v] : legal.has(i) ? "置ける" : "空き"}`);
    });
  }
  function renderPlay() {
    if (!game) return;
    paintScores();
    paintBoard();
    const passing = ui.phase === "play" && ui.wait === "pass";
    el.banner.hidden = !passing;
    if (passing) el.bannerSub.textContent = `${who(game.turn)}は置ける場所がありません`;
  }
  function renderSetup() {
    const cpu = settings.vs === "cpu";
    View.chips($("vVsChips"), [{ value: "cpu", label: "CPUと" }, { value: "duo", label: "2人で" }], settings.vs, v => update({ vs: v }));
    View.chips($("vLevelChips"), View.options(V.LEVELS, l => LEVEL_LABEL[l]), settings.level, v => update({ level: v }));
    View.chips($("vSideChips"), View.options(SIDES, s => SIDE_LABEL[s]), settings.side, v => update({ side: v }));
    View.chips($("vHintChips"), [{ value: true, label: "あり" }, { value: false, label: "なし" }], settings.hints, v => update({ hints: v }));
    $("vLevelOpt").hidden = !cpu;
    $("vSideOpt").hidden = !cpu;
    el.namesBox.hidden = cpu;
    View.list($("vRules"), RULES);
    View.text(el.record, cpu ? recordText() : "");
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    else renderPlay();
    View.stage(el, SCREENS[ui.phase]());
  }

  function buildBoard() {
    cells = Array.from({ length: V.CELLS }, (_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "v-cell";
      b.dataset.i = String(i);
      b.appendChild(document.createElement("span"));
      return b;
    });
    el.board.replaceChildren(...cells);
    el.board.addEventListener("click", (e) => {
      const cell = e.target.closest(".v-cell");
      if (!cell) return;
      e.stopPropagation(); /* the stone sound replaces the app's generic button tap */
      tapCell(Number(cell.dataset.i));
    });
  }
  function init() {
    const saved = Store.load(KEY, {});
    settings = normalize(saved && typeof saved === "object" ? saved : {});
    buildBoard();
    Duo.fill(el.names);
    render();
  }
  /* Leaving mid-game pauses it; coming back picks up where it stopped. */
  function leave() {
    clearTimeout(timer);
    if (ui.phase === "play") ui = { ...ui, wait: null, anim: null, confirm: false };
  }
  function onShow() {
    if (ui.phase === "setup") Duo.fill(el.names);
    if (ui.phase !== "play" || !game) return;
    Awake.keep();
    Music.play("think");
    next();
  }

  return { init, leave, onShow };
})();

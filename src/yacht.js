/* Yacht screen: roll five dice up to three times, keep the good ones, fill the score sheet. Solo, 2-4 on one phone, or vs CPU. */
const Yacht = (() => {
  const Y = YachtRules;
  const KEY = "yacht.settings";
  const BEST_KEY = "yacht.best";
  const MAX_TOTAL = 400;
  const MS = Object.freeze({ roll: 520, face: 65, cpu: 450, hold: 520, pick: 700, turn: 750, end: 900, callout: 1300, bonus: 650, confirm: 400 });
  const VS = Object.freeze({ solo: "ひとりで", party: "みんなで", cpu: "CPUと" });
  const LEVEL = Object.freeze({ easy: "よわい", normal: "ふつう", hard: "つよい" });
  const ORDER = Object.freeze({ first: "先攻", second: "後攻", random: "ランダム" });
  const COUNTS = Object.freeze([2, 3, 4]);
  const DEFAULTS = Object.freeze({ vs: "cpu", level: "normal", order: "first", count: 2 });
  const HANDS = Object.freeze([["lstraight", "B.ストレート！"], ["four", "フォーダイス！"], ["full", "フルハウス！"], ["sstraight", "S.ストレート！"]]);
  const SOFT_FAIL = "うまく動かせませんでした。もう一度タップしてね";

  const el = {
    setup: $("ySetup"), play: $("yPlay"), stage: $("yStage"), label: $("yLabel"), title: $("yTitle"),
    card: $("yCard"), hint: $("yHint"), actions: $("yActions"), ranking: $("yRanking"), sheet: $("ySheet"),
    dock: $("yDock"), tray: $("yTray"), dice: $("yDice"), rolls: $("yRolls"), callout: $("yCallout"),
    levelOpt: $("yLevelOpt"), orderOpt: $("yOrderOpt"), countOpt: $("yCountOpt"), best: $("yBest")
  };

  let settings = DEFAULTS;
  let best = 0;
  let match = null;      // { vs, level, names, cpu } fixed when a game starts (cpu = seat index or -1)
  let game = null;
  let shown = null;      // faces on screen while the dice tumble
  let ui = { phase: "setup", busy: false, handoff: false, thinking: false, armed: null, armedAt: 0, pick: null, quit: false, note: "", record: false };
  let timers = [];
  let epoch = 0;
  let calloutTimer = 0;
  let dieEls = [];
  let sheetEls = null;

  const keysOf = (o) => Object.keys(o);
  const reduced = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const isCpu = (p) => match !== null && match.cpu === p;
  const call = (p) => (match.vs === "party" ? `${match.names[p]}さん` : match.names[p]);
  const shownTurn = () => (ui.handoff && game.last ? game.last.player : game.turn);
  const canTouch = () => ui.phase === "play" && game !== null && !game.over && !isCpu(game.turn) && !ui.busy && !ui.thinking && !ui.quit;
  const randomFace = () => 1 + Math.floor(Math.random() * Y.FACES);
  const validBest = (v) => (Number.isInteger(v) && v > 0 && v <= MAX_TOTAL ? v : 0);
  function make(tag, cls, text) {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function normalize(s) {
    const v = s && typeof s === "object" ? s : {};
    const pick = (list, key) => (list.includes(v[key]) ? v[key] : DEFAULTS[key]);
    return Object.freeze({ vs: pick(keysOf(VS), "vs"), level: pick(Y.LEVELS, "level"), order: pick(keysOf(ORDER), "order"), count: pick(COUNTS, "count") });
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

  /* ---------- timing: every delayed step belongs to the current epoch; stopAll() cancels them all ---------- */
  function guard(fn) {
    try {
      fn();
    } catch (e) {
      console.error("yacht step failed", e);
      shown = null;
      go({ busy: false, thinking: false, pick: null, note: SOFT_FAIL });
    }
  }
  function later(ms, fn) {
    const mine = epoch;
    const id = setTimeout(() => {
      timers = timers.filter(t => t !== id);
      if (mine === epoch) guard(fn);
    }, ms);
    timers = [...timers, id];
  }
  function stopAll() {
    timers.forEach(clearTimeout);
    clearTimeout(calloutTimer);
    timers = [];
    epoch += 1;
    shown = null;
    el.callout.hidden = true;
    dieEls.forEach(d => d.cube.classList.remove("yacht-tumble"));
  }

  /* ---------- sounds: cup rattle, dice clacks on the felt, hold clicks, pencil scribble ---------- */
  const at = (fn) => { const c = Sound.ctx(); if (c) fn(c.currentTime); };
  const rattle = () => at(t => Array.from({ length: 9 }, (_, i) => {
    const d = t + i * 0.045 + Math.random() * 0.02;
    Sound.hiss({ t: d, dur: 0.03, vol: 0.08, type: "bandpass", freq: 2200 + Math.random() * 2200, q: 3 });
    Sound.tone({ freq: 1700 + Math.random() * 900, type: "triangle", t: d, dur: 0.025, vol: 0.05 });
    return d;
  }));
  const clack = (n) => at(t => Array.from({ length: n }, (_, k) => {
    const d = t + k * 0.05 + Math.random() * 0.015;
    Sound.tone({ freq: 300 + Math.random() * 90, glide: 170, glideTime: 0.06, type: "triangle", t: d, dur: 0.08, vol: 0.2, filter: { freq: 2400 } });
    Sound.hiss({ t: d, dur: 0.025, vol: 0.1, type: "bandpass", freq: 3200, q: 1.6 });
    return d;
  }));
  const holdSound = (on) => Sound.tone({ freq: on ? 760 : 620, glide: on ? 1150 : 420, glideTime: 0.07, type: "triangle", dur: 0.09, vol: 0.12 });
  const scribble = () => at(t => [0, 0.09].forEach(d => Sound.hiss({ t: t + d, dur: 0.08, vol: 0.06, type: "bandpass", freq: 1600, to: 3400, q: 2 })));
  const thud = () => Sound.tone({ freq: 170, glide: 95, type: "sine", dur: 0.18, vol: 0.22 });
  const chime = () => at(t => [79, 84, 88, 91].forEach((m, i) =>
    Sound.tone({ freq: Sound.hz(m), type: "triangle", t: t + i * 0.07, dur: 0.28, vol: 0.11, send: 0.25 })));

  function callout(text, kind) {
    clearTimeout(calloutTimer);
    el.callout.textContent = text;
    el.callout.className = `yacht-callout ${kind}`;
    el.callout.hidden = false;
    Fx.replay(el.callout, "yacht-show");
    calloutTimer = setTimeout(() => { el.callout.hidden = true; }, MS.callout);
  }

  /* ---------- flow ---------- */
  function seatsFor(s) {
    if (s.vs === "solo") return { names: ["あなた"], cpu: -1 };
    if (s.vs === "party") return { names: Array.from({ length: s.count }, (_, i) => View.seat(i)), cpu: -1 };
    const cpuFirst = s.order === "second" || (s.order === "random" && Math.random() < 0.5);
    return cpuFirst ? { names: ["CPU", "あなた"], cpu: 0 } : { names: ["あなた", "CPU"], cpu: 1 };
  }
  function start() {
    Sound.ensure();
    Awake.keep();
    stopAll();
    const seats = seatsFor(settings);
    match = Object.freeze({ vs: settings.vs, level: settings.level, names: Object.freeze(seats.names), cpu: seats.cpu });
    game = Y.newGame(match.names.length);
    if (match.cpu >= 0) Y.warmUp();
    buildSheet();
    Sound.sfx("confirm");
    Music.play("think");
    go({ phase: "play", busy: false, handoff: false, thinking: false, armed: null, pick: null, quit: false, note: "", record: false });
    if (match.names.length > 1) callout(`${call(game.turn)}から`, "turn");
    if (isCpu(game.turn)) scheduleCpu();
  }
  function roll() {
    if (canTouch() && Y.canRoll(game)) guard(throwDice);
  }
  function throwDice() {
    const before = game;
    game = Y.roll(before);
    const moving = game.dice.map((_, i) => before.rolls === 0 || !before.held[i]);
    const animate = !reduced();
    shown = animate ? game.dice.map((f, i) => (moving[i] ? randomFace() : f)) : null;
    go({ busy: true, armed: null, note: "" });
    rattle();
    if (!animate) return later(160, () => land(before, moving));
    dieEls.forEach((d, i) => { if (moving[i]) tumble(d); });
    const swaps = Math.floor(MS.roll / MS.face) - 1;
    Array.from({ length: swaps }, (_, k) => later((k + 1) * MS.face, () => {
      shown = shown.map((f, i) => (moving[i] ? randomFace() : f));
      paintDice();
    }));
    later(MS.roll, () => land(before, moving));
  }
  /* The landing class from the last roll must go first: it comes later in the CSS and would override the tumble. */
  function tumble(d) {
    d.cube.classList.remove("yacht-land");
    d.cube.style.setProperty("--spin", ((Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.5)).toFixed(2));
    d.cube.style.setProperty("--dur", `${Math.round(MS.roll * (0.82 + Math.random() * 0.18))}ms`);
    Fx.replay(d.cube, "yacht-tumble");
  }
  function land(before, moving) {
    shown = null;
    dieEls.forEach((d, i) => {
      d.cube.classList.remove("yacht-tumble");
      if (moving[i] && !reduced()) Fx.replay(d.cube, "yacht-land");
    });
    clack(moving.filter(Boolean).length);
    go({ busy: false });
    announce(before);
    if (isCpu(game.turn)) scheduleCpu();
  }
  /* Calls out a hand that just appeared, if the player can still use its box. A yacht is always celebrated. */
  function announce(before) {
    if (Y.isYacht(game.dice)) return celebrateYacht();
    const now = Y.previews(game) || {};
    const had = before.rolls > 0 ? Y.scoreAll(before.dice) : {};
    const hit = HANDS.find(([id]) => now[id] > 0 && !(had[id] > 0));
    if (!hit) return;
    chime();
    callout(hit[1], "hand");
  }
  function celebrateYacht() {
    callout(isCpu(game.turn) ? "CPUがヨット！" : "ヨット！", "yacht");
    Fx.flash("--zap", 500);
    if (isCpu(game.turn)) {
      Sound.sfx("reveal");
      Fx.shake();
      return;
    }
    Sound.sfx("victory");
    Fx.confetti();
  }

  function onDice(e) {
    const btn = e.target.closest(".yacht-die");
    if (!btn || !canTouch()) return;
    if (!Y.canHold(game)) {
      thud();
      go({ note: game.rolls === 0 ? "先に「ふる」でサイコロをふってね" : "3回ふったので、表から記入するマスを選ぼう" });
      return;
    }
    guard(() => {
      const i = Number(btn.dataset.i);
      game = Y.toggleHold(game, i);
      holdSound(game.held[i]);
      go({ armed: null, note: "" });
    });
  }
  function onSheet(e) {
    const row = e.target.closest("button.yacht-row");
    if (!row || !canTouch()) return;
    const id = row.dataset.cat;
    if (!Y.canScore(game, id)) {
      if (game.rolls === 0) {
        thud();
        go({ note: "先に「ふる」でサイコロをふってね" });
      }
      return;
    }
    if (Y.previews(game)[id] === 0 && ui.armed !== id) {
      thud();
      go({ armed: id, armedAt: Date.now(), note: "" });
      return;
    }
    /* A quick double tap is one tap: a zero needs a second, deliberate tap. */
    if (ui.armed === id && Date.now() - ui.armedAt < MS.confirm) return;
    guard(() => commit(id));
  }
  function commit(id) {
    const player = game.turn;
    game = Y.choose(game, id);
    const { points, bonus } = game.last;
    scribble();
    if (points === 0) thud();
    else Sound.sfx(points >= 30 ? "correct" : "coin");
    go({ armed: null, pick: null, busy: true, handoff: true, note: "" });
    Fx.replay(sheetEls.rows[id].cells[player], "yacht-fresh");
    if (bonus) later(380, () => { chime(); callout("ボーナス +35！", "bonus"); });
    /* After a bonus, wait a little longer so the next turn's callout does not cover it. */
    later((game.over ? MS.end : MS.turn) + (bonus ? MS.bonus : 0), game.over ? finish : nextTurn);
  }
  function nextTurn() {
    go({ busy: false, handoff: false });
    Fx.pop(el.title);
    if (match.names.length > 1) {
      Sound.sfx("whoosh");
      callout(`${call(game.turn)}の番`, "turn");
    }
    if (isCpu(game.turn)) scheduleCpu();
  }

  /* ---------- CPU: think, show the dice it keeps, roll, then mark its box ---------- */
  function scheduleCpu() {
    go({ thinking: true });
    later(MS.cpu, cpuStep);
  }
  function cpuStep() {
    if (ui.phase !== "play" || game.over || !isCpu(game.turn)) return;
    const plan = Y.cpuPlan(game, match.level);
    if (plan.action === "score") {
      const name = Y.BY_ID[plan.cat].name;
      go({ thinking: false, pick: plan.cat, note: `CPUは「${name}」に${Y.previews(game)[plan.cat]}点` });
      later(MS.pick, () => commit(plan.cat));
      return;
    }
    if (game.rolls === 0) {
      ui = { ...ui, thinking: false };
      throwDice();
      return;
    }
    game = Y.setHeld(game, plan.held);
    const kept = game.dice.filter((_, i) => plan.held[i]);
    holdSound(kept.length > 0);
    go({ thinking: false, busy: true, note: kept.length ? `CPUは ${kept.join("・")} をキープ` : "CPUは全部ふり直し" });
    later(MS.hold, () => {
      ui = { ...ui, busy: false };
      throwDice();
    });
  }

  function finish() {
    stopAll();
    Music.stop();
    const rows = Y.ranking(game);
    const record = match.vs === "solo" && rows[0].total > best;
    if (record) {
      best = rows[0].total;
      Store.save(BEST_KEY, best);
    }
    go({ phase: "over", busy: false, handoff: false, thinking: false, armed: null, pick: null, quit: false, note: "", record });
    Fx.pop(match.vs === "solo" ? el.card : el.ranking);
    endSound(rows, record);
  }
  function endSound(rows, record) {
    const tie = rows.filter(r => r.rank === 1).length > 1;
    if (match.vs === "solo") Sound.sfx(record ? "victory" : "fanfare");
    else if (tie) Sound.sfx("reveal");
    else if (isCpu(rows[0].player)) Sound.sfx("lose");
    else Sound.sfx(match.vs === "cpu" ? "victory" : "fanfare");
    if ((match.vs === "solo" && record) || (match.vs !== "solo" && !tie && !isCpu(rows[0].player))) Fx.confetti();
  }
  function quit() {
    if (!ui.quit) go({ quit: true });
  }
  function toSetup() {
    stopAll();
    Music.stop();
    go({ phase: "setup", busy: false, handoff: false, thinking: false, armed: null, pick: null, quit: false, note: "" });
  }

  /* ---------- screens ---------- */
  function playTitle() {
    if (ui.handoff && game.last) return `「${Y.BY_ID[game.last.cat].name}」に${game.last.points}点${game.last.points >= 30 ? "！" : ""}`;
    if (ui.thinking) return "CPUが考え中…";
    if (match.vs === "solo") return `合計 ${Y.totalOf(game.sheets[0])}点`;
    if (match.vs === "cpu") return isCpu(game.turn) ? "CPUの番" : "あなたの番";
    return `${call(game.turn)}の番`;
  }
  function playHint() {
    if (ui.note) return ui.note;
    if (ui.busy || ui.thinking || isCpu(game.turn)) return "";
    if (ui.armed) return `「${Y.BY_ID[ui.armed].name}」は0点。もう一度タップで記入`;
    if (game.rolls === 0) return "「ふる」でサイコロを5個ふろう";
    if (game.rolls >= Y.ROLLS) return "表から記入するマスを1つ選ぼう";
    return "サイコロをタップでキープ。表をタップで記入";
  }
  function rollLabel() {
    if (isCpu(game.turn)) return "CPUの番";
    if (game.rolls === 0) return match.vs === "party" ? `${call(game.turn)}がふる` : "ふる";
    if (game.rolls >= Y.ROLLS) return "マスを選んでね";
    if (!Y.canRoll(game)) return "全部キープ中";
    return `ふる（あと${Y.rollsLeft(game)}回）`;
  }
  function playActions() {
    if (ui.quit) return [makeButton("つづける", () => go({ quit: false }), "small"), makeButton("やめる", toSetup, "primary danger")];
    if (ui.armed) {
      const id = ui.armed;
      return [makeButton("とりけす", () => go({ armed: null }), "small"),
        makeButton(`${Y.BY_ID[id].name}に0点`, () => { if (canTouch()) guard(() => commit(id)); }, "primary danger", !canTouch())];
    }
    return [makeButton("やめる", quit, "small"), makeButton(rollLabel(), roll, "primary", !canTouch() || !Y.canRoll(game))];
  }
  function resultTitle() {
    const top = Y.ranking(game).filter(r => r.rank === 1);
    if (match.vs === "solo") return ui.record ? "自己ベスト更新！" : "おつかれさま！";
    if (top.length === match.names.length) return "引き分け！";
    if (top.length > 1) return `${top.map(r => call(r.player)).join("と")}が同点優勝！`;
    if (match.vs === "cpu") return isCpu(top[0].player) ? "CPUの勝ち…" : "あなたの勝ち！";
    return `${call(top[0].player)}の優勝！`;
  }
  function resultHint() {
    const rows = Y.ranking(game);
    if (match.vs === "solo") {
      const tip = Y.bonusOf(game.sheets[0]) ? "ボーナスも取れました！" : "1〜6の目の小計が63点以上なら+35点";
      return `自己ベスト ${best}点。${tip}`;
    }
    const gap = rows[0].total - rows[1].total;
    return gap > 0 ? `${gap}点差で決着` : "合計点がぴったり同じでした";
  }

  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: () => ({
      label: `${match.vs === "cpu" ? `CPU ${LEVEL[match.level]}・` : ""}ラウンド ${game.round} / ${Y.TURNS}`,
      title: playTitle(), hint: playHint(), actions: playActions()
    }),
    over: () => ({
      label: "結果", title: resultTitle(), hint: resultHint(),
      card: match.vs === "solo" ? { main: `${Y.totalOf(game.sheets[0])}点`, sub: "12マスの合計", cls: "yacht-final" } : null,
      actions: [makeButton("設定", toSetup, "small"), makeButton("もう一回", start, "primary")]
    })
  };

  /* ---------- dice ---------- */
  function buildDice() {
    return Array.from({ length: Y.DICE }, (_, i) => {
      const root = make("button", "yacht-die");
      root.type = "button";
      root.dataset.i = String(i);
      const cube = pips(make("span", "yacht-cube"), 0);
      root.append(cube, make("span", "yacht-tag", "キープ"));
      el.dice.append(root);
      return Object.freeze({ root, cube });
    });
  }
  function pips(cube, face) {
    cube.dataset.face = String(face);
    cube.append(...Array.from({ length: 9 }, () => document.createElement("i")));
    return cube;
  }
  function paintDice() {
    const faces = shown || (game && game.dice) || null;
    const holdable = canTouch() && Y.canHold(game);
    dieEls.forEach((d, i) => {
      const face = faces ? faces[i] : 0;
      const held = Boolean(game && game.rolls > 0 && game.held[i]);
      if (d.cube.dataset.face !== String(face)) d.cube.dataset.face = String(face);
      d.root.classList.toggle("held", held);
      d.root.classList.toggle("can", holdable);
      d.root.setAttribute("aria-pressed", String(held));
      d.root.setAttribute("aria-label", face ? `${face}の目${held ? "、キープ中" : ""}` : "まだふっていないサイコロ");
    });
    const left = game && !game.over ? Y.rollsLeft(game) : 0;
    [...el.rolls.children].forEach((dot, i) => dot.classList.toggle("on", i < left));
  }

  /* ---------- score sheet: built once per game, then repainted in place ---------- */
  function catLabel(c) {
    const box = make("span", "yacht-cat");
    const name = make("span", "yacht-cat-name");
    if (c.face) name.append(pips(make("span", "yacht-cube yacht-mini"), c.face));
    name.append(c.name);
    box.append(name, make("small", "", c.note));
    return box;
  }
  function buildRow(tag, cls, label, n) {
    const row = make(tag, `yacht-row ${cls}`.trim());
    if (tag === "button") row.type = "button";
    const cells = Array.from({ length: n }, () => make("span", "yacht-cell"));
    row.append(label, ...cells);
    return Object.freeze({ row, cells });
  }
  function buildSheet() {
    const n = match.names.length;
    const plain = (text) => make("span", "yacht-cat", text);
    const noted = (name, note) => {
      const box = make("span", "yacht-cat");
      box.append(make("span", "yacht-cat-name", name), make("small", "", note));
      return box;
    };
    const head = buildRow("div", "yacht-head", plain(""), n);
    head.cells.forEach((c, p) => { c.textContent = match.names[p]; });
    const rows = Object.fromEntries(Y.CATEGORIES.map(c => {
      const r = buildRow("button", "", catLabel(c), n);
      r.row.dataset.cat = c.id;
      return [c.id, r];
    }));
    const sub = buildRow("div", "yacht-sum", noted("小計", `${Y.BONUS.line}点で+${Y.BONUS.points}`), n);
    const bonus = buildRow("div", "yacht-sum", plain("ボーナス"), n);
    const total = buildRow("div", "yacht-total", plain("合計"), n);
    const lower = Y.IDS.filter(id => !Y.UPPER.includes(id));
    el.sheet.style.setProperty("--n", String(n));
    el.sheet.replaceChildren(head.row, ...Y.UPPER.map(id => rows[id].row), sub.row, bonus.row, ...lower.map(id => rows[id].row), total.row);
    sheetEls = Object.freeze({ rows, head: head.cells, sub: sub.cells, bonus: bonus.cells, total: total.cells });
  }
  function paintRow(c, r, turn, pre, touch) {
    const can = touch && pre !== null && c.id in pre;
    r.row.classList.toggle("open", can);
    r.row.classList.toggle("used", turn >= 0 && game.sheets[turn][c.id] !== null);
    r.row.classList.toggle("armed", ui.armed === c.id);
    r.row.classList.toggle("pick", ui.pick === c.id);
    r.row.setAttribute("aria-disabled", String(!can));
    r.row.setAttribute("aria-label", can ? `${c.name}に${pre[c.id]}点で記入` : c.name);
    r.cells.forEach((cell, p) => {
      const val = game.sheets[p][c.id];
      const preview = val === null && p === turn && pre !== null ? pre[c.id] : null;
      const text = val !== null ? String(val) : preview !== null ? String(preview) : "";
      if (cell.textContent !== text) cell.textContent = text;
      cell.classList.toggle("done", val !== null);
      cell.classList.toggle("preview", preview !== null);
      cell.classList.toggle("zero", preview === 0);
      cell.classList.toggle("turn", p === turn);
    });
  }
  function bonusText(sheet, info) {
    if (info.reached) return `+${Y.BONUS.points}`;
    const upperDone = Y.UPPER.every(id => sheet[id] !== null);
    return !info.possible || upperDone ? "0" : `あと${info.need}`;
  }
  function paintTotals(turn, leaders) {
    game.sheets.forEach((sheet, p) => {
      const info = Y.bonusInfo(sheet);
      const btext = bonusText(sheet, info);
      sheetEls.sub[p].textContent = String(info.subtotal);
      sheetEls.bonus[p].textContent = btext;
      sheetEls.bonus[p].classList.toggle("got", info.reached);
      sheetEls.bonus[p].classList.toggle("need", btext.startsWith("あと"));
      sheetEls.total[p].textContent = String(Y.totalOf(sheet));
      [sheetEls.head[p], sheetEls.sub[p], sheetEls.bonus[p], sheetEls.total[p]].forEach(cell => cell.classList.toggle("turn", p === turn));
      [sheetEls.head[p], sheetEls.total[p]].forEach(cell => cell.classList.toggle("lead", leaders.includes(p)));
    });
  }
  function paintSheet() {
    if (!sheetEls) return;
    const turn = ui.phase === "play" && !game.over ? shownTurn() : -1;
    const pre = turn >= 0 && !ui.busy ? Y.previews(game) : null;
    const touch = canTouch();
    Y.CATEGORIES.forEach(c => paintRow(c, sheetEls.rows[c.id], turn, pre, touch));
    paintTotals(turn, ui.phase === "over" && match.names.length > 1 ? Y.winners(game) : []);
  }
  function paintRanking() {
    const show = ui.phase === "over" && match.names.length > 1;
    el.ranking.hidden = !show;
    if (!show) return;
    el.ranking.replaceChildren(...Y.ranking(game).map(r => {
      const li = make("li", r.rank === 1 ? "ok" : "");
      li.append(make("span", "pos", `${r.rank}位`), make("span", "who", call(r.player)), make("b", "num", String(r.total)), make("span", "mark", "点"));
      return li;
    }));
  }

  /* ---------- setup ---------- */
  function renderSetup() {
    View.chips($("yVsChips"), View.options(keysOf(VS), k => VS[k]), settings.vs, v => update({ vs: v }));
    View.chips($("yLevelChips"), View.options(Y.LEVELS, k => LEVEL[k]), settings.level, v => update({ level: v }));
    View.chips($("yOrderChips"), View.options(keysOf(ORDER), k => ORDER[k]), settings.order, v => update({ order: v }));
    View.chips($("yCountChips"), View.options(COUNTS, n => `${n}人`), settings.count, v => update({ count: v }));
    el.levelOpt.hidden = settings.vs !== "cpu";
    el.orderOpt.hidden = settings.vs !== "cpu";
    el.countOpt.hidden = settings.vs !== "party";
    View.text(el.best, settings.vs === "solo" && best > 0 ? `自己ベスト ${best}点` : "");
    View.list($("yRules"), [
      "1回の番で、サイコロ5個を3回までふれる。残したいサイコロはタップでキープ",
      "ふり終えたら表のマスを1つ選んで記入。0点でもどこかに必ず記入する",
      "1〜6の目はその目の合計。チョイス・フォーダイス・フルハウスは5個の合計",
      "S.ストレートは15点、B.ストレートは30点、ヨット（5個同じ）は50点",
      settings.vs === "solo"
        ? "1〜6の目の小計が63点以上で+35点。12マス埋めて自己ベストをねらおう"
        : "1〜6の目の小計が63点以上で+35点。12マス埋めて合計が多い人の勝ち"
    ]);
  }

  function render() {
    const playing = ui.phase !== "setup";
    el.setup.hidden = playing;
    el.play.hidden = !playing;
    el.tray.hidden = ui.phase !== "play";
    el.stage.classList.toggle("yacht-playing", playing);
    el.dock.classList.toggle("yacht-dock-setup", !playing);
    if (!playing) renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (!playing) return;
    paintSheet();
    paintDice();
    paintRanking();
  }

  function init() {
    settings = normalize(Store.load(KEY, {}));
    best = validBest(Store.load(BEST_KEY, 0));
    dieEls = buildDice();
    el.dice.addEventListener("click", onDice);
    el.sheet.addEventListener("click", onSheet);
    render();
  }
  function onShow() {
    if (ui.phase !== "play") return;
    Music.play("think");
    if (game.over) finish();
    else if (isCpu(game.turn)) scheduleCpu();
  }
  function leave() {
    stopAll();
    if (ui.phase === "play") go({ busy: false, handoff: false, thinking: false, pick: null, quit: false });
  }

  return { init, onShow, leave };
})();

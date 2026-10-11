/* Speed screen: a real-time card race on a full-screen table, against the CPU or a friend across the phone. */
const Speed = (() => {
  const R = SpeedRules;
  const KEY = "speed.settings";
  const RECORD_KEY = "speed.record";
  const CPU = 1;
  const PILE_SHOW = 3;
  const SLIDE_MS = 260;
  const DEAL_STEP_MS = 90;
  const COUNT_LEAD_MS = 500;
  const COUNT_MS = 700;
  const LOOK_MS = 300;
  const STUCK_MS = 700;
  const SENO_MS = 560;
  const CALL_CLEAR_MS = 900;
  const QUIT_ARM_MS = 2500;
  const FEW_LEFT = 5;
  const LEVEL_LABEL = { easy: "よわい", normal: "ふつう", hard: "つよい" };
  const VS = [{ value: "cpu", label: "CPUと" }, { value: "duo", label: "2人で" }];
  const HINTS = [{ value: true, label: "光らせる" }, { value: false, label: "なし" }];
  const DEMO = [["S", "Q", -14, 6], ["H", "K", -5, 1], ["C", "A", 5, 1], ["D", "2", 14, 6]];
  const RULES_TAIL = [
    "「せーの」で山札から1枚ずつ、まん中の台札に出す",
    "台札と数字が1つちがいのカードを出せる（KとAもつながる）。順番はなし、早い者勝ち",
    "出すカードをタップ。両方の台札に出せるときは、出す方の台札もタップ",
    "2人とも出せなくなったら、また「せーの」（山札がなければ手元から1枚）。手元と山札を先に全部なくした方の勝ち"
  ];

  const el = {
    setup: $("spSetup"), actions: $("spActions"), record: $("spRecord"), namesBox: $("spNames"),
    nameInputs: [$("spNameIn0"), $("spNameIn1")], levelOpt: $("spLevelOpt"), demo: $("spDemo"),
    table: $("spTable"), call: $("spCall"), buttons: $("spButtons"),
    sides: [$("spSide0"), $("spSide1")], who: [$("spWho0"), $("spWho1")], left: [$("spLeft0"), $("spLeft1")],
    msgs: [$("spMsg0"), $("spMsg1")], decks: [$("spDeck0"), $("spDeck1")], deckN: [$("spDeckN0"), $("spDeckN1")],
    slotRows: [$("spSlots0"), $("spSlots1")], piles: [$("spPile0"), $("spPile1")]
  };

  let settings = { vs: "cpu", level: "normal", hints: true };
  let match = { cpu: true, level: "normal", hints: true, names: ["あなた", "CPU"] };
  let game = null;
  let ui = { phase: "idle", sel: [null, null], call: "", quitArm: false };
  let slots = [[], []];
  let timers = [];
  let cpuTimer = 0;
  let cpuDue = 0;
  let stopConfetti = null;
  let drawnButtons = "";

  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isHuman = (side) => !match.cpu || side !== CPU;
  const turned = (side) => side === 1 && !match.cpu;
  const now = () => (Sound.ctx() ? Sound.ctx().currentTime : null);

  function normalize(s) {
    return {
      vs: s.vs === "duo" ? "duo" : "cpu",
      level: R.LEVELS.includes(s.level) ? s.level : "normal",
      hints: typeof s.hints === "boolean" ? s.hints : true
    };
  }
  function update(patch) {
    settings = normalize({ ...settings, ...patch });
    Store.save(KEY, settings);
    renderSetup();
  }

  /* ---------- timers ---------- */
  function later(fn, ms) {
    const id = setTimeout(() => {
      timers = timers.filter(t => t !== id);
      fn();
    }, ms);
    timers = [...timers, id];
    return id;
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    cpuTimer = 0;
    if (stopConfetti) stopConfetti();
    stopConfetti = null;
  }
  function cancelCpu() {
    if (!cpuTimer) return;
    clearTimeout(cpuTimer);
    timers = timers.filter(t => t !== cpuTimer);
    cpuTimer = 0;
  }

  /* ---------- record against the CPU ---------- */
  function loadRecord() {
    const raw = Store.load(RECORD_KEY, {});
    const src = raw && typeof raw === "object" ? raw : {};
    const n = (x) => (Number.isInteger(x) && x >= 0 ? x : 0);
    return Object.fromEntries(R.LEVELS.map(l => [l, { win: n(src[l]?.win), lose: n(src[l]?.lose), draw: n(src[l]?.draw) }]));
  }
  function saveRecord(winner) {
    const rec = loadRecord();
    const key = winner === null ? "draw" : winner === CPU ? "lose" : "win";
    const mine = rec[match.level];
    Store.save(RECORD_KEY, { ...rec, [match.level]: { ...mine, [key]: mine[key] + 1 } });
  }
  function recordText() {
    const r = loadRecord()[settings.level];
    if (!r.win && !r.lose && !r.draw) return "";
    return `CPU（${LEVEL_LABEL[settings.level]}）との成績：${r.win}勝 ${r.lose}敗${r.draw ? ` ${r.draw}分` : ""}`;
  }

  /* ---------- sounds ---------- */
  function soundSnap(t, card) {
    Sound.hiss({ t, dur: 0.035, vol: 0.28, type: "highpass", freq: 2400 });
    Sound.tone({ freq: 210, glide: 90, glideTime: 0.05, type: "sine", t, dur: 0.09, vol: 0.32 });
    Sound.tone({ freq: Sound.hz(76 + Cards.rankIndex(card)), type: "triangle", t, dur: 0.16, vol: 0.05, send: 0.15 });
  }
  function soundPlay(card) {
    const t = now();
    if (t === null) return;
    Sound.hiss({ t, dur: 0.18, vol: 0.13, type: "bandpass", freq: 600, to: 3600, q: 1.2, attack: 0.05 });
    soundSnap(t + (SLIDE_MS / 1000) * 0.8, card);
  }
  function soundFlip(moves) {
    const t = now();
    if (t === null) return;
    Sound.sfx("flip");
    moves.filter(Boolean).forEach((m, i) => soundSnap(t + 0.22 + i * 0.04, m.card));
  }
  function soundNope() {
    const t = now();
    if (t === null) return;
    Sound.tone({ freq: 220, glide: 160, type: "square", t, dur: 0.09, vol: 0.045, filter: { freq: 900 } });
    Sound.tone({ freq: 165, type: "square", t: t + 0.08, dur: 0.11, vol: 0.04, filter: { freq: 800 } });
  }
  function soundStuck() {
    const t = now();
    if (t === null) return;
    Sound.tone({ freq: Sound.hz(74), type: "sine", t, dur: 0.16, vol: 0.12 });
    Sound.tone({ freq: Sound.hz(69), type: "sine", t: t + 0.14, dur: 0.26, vol: 0.12, send: 0.2 });
  }
  const soundSelect = () => Sound.tone({ freq: 1100, glide: 1500, glideTime: 0.05, type: "triangle", dur: 0.06, vol: 0.08 });
  const soundNo = () => Sound.tone({ freq: Sound.hz(88), type: "square", dur: 0.2, vol: 0.08, filter: { freq: 3600 }, send: 0.15 });

  /* ---------- table drawing ---------- */
  function capture() {
    const rect = (n) => n.getBoundingClientRect();
    return { slots: slots.map(row => row.map(rect)), decks: el.decks.map(rect), piles: el.piles.map(rect) };
  }
  /* Slides a new card in from where it came from (FLIP). Inside the upside-down half, offsets are mirrored. */
  function slide(node, from, to, o = {}) {
    if (!from || !to || reduced() || typeof node.animate !== "function") return null;
    const k = o.invert ? -1 : 1;
    const dx = k * (from.left + from.width / 2 - (to.left + to.width / 2));
    const dy = k * (from.top + from.height / 2 - (to.top + to.height / 2));
    const scale = to.width ? from.width / to.width : 1;
    return node.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(${o.spin || 0}deg)` }, { transform: node.style.transform || "none" }],
      { duration: SLIDE_MS, delay: o.delay || 0, easing: "cubic-bezier(.2, .75, .25, 1)", fill: "backwards" }
    );
  }
  function turnUp(face, anim) {
    const up = () => Cards.setFaceDown(face, false);
    if (anim) anim.finished.then(up, up);
    else requestAnimationFrame(() => requestAnimationFrame(up));
  }
  function placeSlot(node, card, side, i, rects) {
    node.dataset.cid = card ? card.id : "";
    node.classList.toggle("speed-empty", !card);
    if (!card) {
      node.replaceChildren();
      return;
    }
    const face = Cards.el(card, { faceDown: true });
    node.replaceChildren(face);
    node.dataset.at = String(performance.now());
    const dealing = game.last.type === "deal";
    const anim = slide(face, rects.decks[side], rects.slots[side][i], { invert: turned(side), delay: dealing ? i * DEAL_STEP_MS : 0 });
    turnUp(face, dealing ? anim : null);
  }
  function drawSlots(side, rects) {
    const showOk = match.hints && isHuman(side) && ui.phase === "play";
    const ok = new Set(showOk ? R.legalPlays(game, side).map(p => p.slot) : []);
    game.sides[side].field.forEach((card, i) => {
      const node = slots[side][i];
      if (node.dataset.cid !== (card ? card.id : "")) placeSlot(node, card, side, i, rects);
      node.classList.toggle("speed-ok", ok.has(i));
      node.classList.toggle("speed-sel", ui.sel[side] === i);
      node.setAttribute("aria-label", card ? Cards.label(card) : "空き");
    });
  }
  function drawSide(side) {
    const n = R.cardsLeft(game, side);
    const deck = game.sides[side].deck.length;
    el.decks[side].classList.toggle("speed-empty", deck === 0);
    el.decks[side].classList.toggle("speed-stack", deck > 1);
    el.deckN[side].textContent = String(deck);
    el.left[side].textContent = `のこり${n}枚`;
    el.left[side].classList.toggle("speed-few", n <= FEW_LEFT);
    el.msgs[side].textContent = sideMsg(side, n);
    el.sides[side].classList.toggle("speed-win", ui.phase === "over" && game.winner === side);
    el.sides[side].classList.toggle("speed-lose", ui.phase === "over" && game.winner === 1 - side);
  }
  function sideMsg(side, n) {
    if (ui.phase === "over") return game.winner === null ? "引き分け" : game.winner === side ? "勝ち！" : "負け…";
    /* 2人で: the count and 「せーの」 also show in each half, so the player across the phone can read them too. */
    if (!match.cpu && ui.call && (ui.phase === "ready" || ui.phase === "seno")) return ui.call;
    if (ui.phase === "ready") return isHuman(side) ? "かまえて！" : "";
    if (ui.sel[side] !== null) return "出す台札をタップ";
    return n <= 3 ? `あと${n}枚！` : "";
  }
  const tiltOf = (id) => ([...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) % 15) - 7;
  function pileSource(card, rects) {
    const last = game.last;
    if (last.type === "play" && last.card.id === card.id) {
      return { rect: rects.slots[last.side][last.slot], spin: turned(last.side) ? 180 : 0, faceDown: false };
    }
    const move = last.type === "flip" ? last.moves.find(m => m && m.card.id === card.id) : null;
    if (!move) return { rect: null, spin: 0, faceDown: false };
    const rect = move.from === "deck" ? rects.decks[move.side] : rects.slots[move.side][move.slot];
    return { rect, spin: turned(move.side) ? 180 : 0, faceDown: move.from === "deck" };
  }
  function drawPile(p, rects) {
    const node = el.piles[p];
    const want = game.piles[p].slice(-PILE_SHOW);
    const ids = new Set(want.map(c => c.id));
    [...node.children].forEach(ch => { if (!ids.has(ch.dataset.cid)) ch.remove(); });
    const have = new Set([...node.children].map(ch => ch.dataset.cid));
    want.filter(c => !have.has(c.id)).forEach(card => {
      const src = pileSource(card, rects);
      const face = Cards.el(card, { faceDown: src.faceDown });
      face.dataset.cid = card.id;
      face.style.transform = `rotate(${tiltOf(card.id)}deg)`;
      node.appendChild(face);
      if (src.faceDown) turnUp(face, null);
      slide(face, src.rect, rects.piles[p], { spin: src.spin });
    });
    node.classList.toggle("speed-target", targetPiles().includes(p));
    node.setAttribute("aria-label", `${p === 0 ? "右" : "左"}の台札${want.length ? `：${Cards.label(want[want.length - 1])}` : ""}`);
  }
  const targetPiles = () => [0, 1].flatMap(s => (isHuman(s) && ui.sel[s] !== null ? R.pilesFor(game, s, ui.sel[s]) : []));
  function drawCenter() {
    el.table.dataset.phase = ui.phase;
    el.call.textContent = ui.call;
    const key = `${ui.phase === "over"}:${ui.quitArm}`;
    if (key === drawnButtons) return;
    drawnButtons = key;
    el.buttons.replaceChildren(...(ui.phase === "over"
      ? [makeButton("もう一回", start, "primary"), makeButton("設定", quit, "small")]
      : [makeButton(ui.quitArm ? "本当にやめる？" : "やめる", askQuit, `small speed-quit${ui.quitArm ? " speed-armed" : ""}`)]));
  }
  function draw() {
    if (!game) return;
    const rects = capture();
    [0, 1].forEach(s => { drawSlots(s, rects); drawSide(s); });
    [0, 1].forEach(p => drawPile(p, rects));
    drawCenter();
  }
  function setCall(text) {
    ui = { ...ui, call: text };
    el.call.textContent = text;
    if (text) Fx.pop(el.call);
    if (!match.cpu && game) [0, 1].forEach(s => { el.msgs[s].textContent = sideMsg(s, R.cardsLeft(game, s)); });
  }

  /* ---------- flow ---------- */
  function openTable() {
    el.table.hidden = false;
    el.table.classList.toggle("speed-duo", !match.cpu);
    document.body.classList.add("arena-open");
    drawnButtons = "";
    slots.flat().forEach(n => { n.dataset.cid = ""; n.replaceChildren(); });
    el.piles.forEach(n => n.replaceChildren());
    [0, 1].forEach(s => { el.who[s].textContent = match.names[s]; });
  }
  function closeTable() {
    el.table.hidden = true;
    document.body.classList.remove("arena-open");
  }
  function start() {
    Sound.ensure();
    Awake.keep();
    clearTimers();
    /* The button that started the game stays focused under the table; Enter or Space would restart it. */
    if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
    const duo = settings.vs === "duo" ? Duo.read(el.nameInputs) : null;
    match = { cpu: !duo, level: settings.level, hints: settings.hints, names: duo || ["あなた", "CPU"] };
    game = R.deal();
    ui = { phase: "ready", sel: [null, null], call: "", quitArm: false };
    openTable();
    draw();
    Sound.sfx("confirm");
    countIn();
  }
  /* 3, 2, 1, せーの！ in the middle of the table, on our own timers so やめる or leaving stops it at once. */
  function countIn() {
    ["3", "2", "1"].forEach((n, i) => later(() => { setCall(n); Sound.sfx("count"); }, COUNT_LEAD_MS + i * COUNT_MS));
    later(() => { setCall("せーの！"); Sound.sfx("go"); begin(); }, COUNT_LEAD_MS + 3 * COUNT_MS);
  }
  function begin() {
    ui = { ...ui, phase: "play" };
    Music.play("rush");
    doFlip();
  }
  function doFlip() {
    game = R.flip(game);
    soundFlip(game.last.moves);
    ui = { ...ui, phase: "play", sel: [null, null] };
    draw();
    later(() => { if (ui.phase === "play" && ui.call) setCall(""); }, CALL_CLEAR_MS);
    afterChange();
  }
  /* Runs after every play or flip: end, deadlock, or let the CPU look again. */
  function afterChange() {
    if (game.over) {
      finish();
      return;
    }
    if ([0, 1].some(s => R.cardsLeft(game, s) <= FEW_LEFT)) Music.intensify();
    if (R.isStuck(game)) {
      stuck();
      return;
    }
    scheduleCpu();
  }
  /* Nobody can play: a short look at the table (the last 「の！」 stays readable), then 「せーの」 and a new flip. */
  function stuck() {
    cancelCpu();
    ui = { ...ui, phase: "seno", sel: [null, null] };
    draw();
    later(() => { setCall("出せるカードなし"); soundStuck(); }, LOOK_MS);
    later(() => { setCall("せー"); Sound.sfx("count"); }, LOOK_MS + STUCK_MS);
    later(() => { setCall("の！"); soundNo(); doFlip(); }, LOOK_MS + STUCK_MS + SENO_MS);
  }
  function doPlay(side, slot, pile) {
    const card = game.sides[side].field[slot];
    try {
      game = R.play(game, side, slot, pile);
    } catch (e) {
      console.error("スピード: カードを出せませんでした", e);
      nope(side, slot);
      return;
    }
    soundPlay(card);
    const keep = (s, v) => (s !== side && v !== null && R.pilesFor(game, s, v).length ? v : null);
    ui = { ...ui, call: "", sel: ui.sel.map((v, s) => keep(s, v)) };
    draw();
    if (isHuman(side)) nudgeCpu();
    afterChange();
  }
  function nope(side, slot) {
    soundNope();
    Fx.replay(slots[side][slot], "speed-nope");
  }
  function finish() {
    clearTimers();
    Music.stop();
    const w = game.winner;
    const call = w === null ? "引き分け！" : match.cpu ? (w === CPU ? "CPUの勝ち…" : "あなたの勝ち！") : `${match.names[w]}の勝ち！`;
    ui = { ...ui, phase: "over", sel: [null, null], quitArm: false, call };
    draw();
    Fx.pop(el.call);
    if (match.cpu) saveRecord(w);
    if (w === null) Sound.sfx("reveal");
    else if (match.cpu && w === CPU) {
      Sound.sfx("lose");
      Fx.shake(el.table);
    } else {
      Sound.sfx(match.cpu ? "victory" : "fanfare");
      stopConfetti = Fx.confetti() || null;
    }
  }
  function askQuit() {
    if (ui.quitArm) {
      quit();
      return;
    }
    ui = { ...ui, quitArm: true };
    drawCenter();
    later(() => {
      if (!ui.quitArm) return;
      ui = { ...ui, quitArm: false };
      drawCenter();
    }, QUIT_ARM_MS);
  }
  function quit() {
    clearTimers();
    Music.stop();
    ui = { phase: "idle", sel: [null, null], call: "", quitArm: false };
    closeTable();
    renderSetup();
  }

  /* ---------- CPU ---------- */
  function armCpu(ms) {
    cpuDue = performance.now() + ms;
    cpuTimer = later(cpuAct, ms);
  }
  function scheduleCpu() {
    if (!match.cpu || ui.phase !== "play" || cpuTimer || document.hidden) return;
    if (R.legalPlays(game, CPU).length === 0) return;
    armCpu(R.cpuDelay(match.level));
  }
  /* The player just put a card down: a CPU reaction that was about to fire waits until the CPU could have seen it. */
  function nudgeCpu() {
    if (!cpuTimer) return;
    const left = cpuDue - performance.now();
    const wait = R.cpuRewait(match.level, left);
    if (wait <= left) return;
    cancelCpu();
    armCpu(wait);
  }
  function cpuAct() {
    cpuTimer = 0;
    if (ui.phase !== "play") return;
    const move = R.cpuChoose(game, CPU, match.level);
    if (move) doPlay(CPU, move.slot, move.pile);
    else scheduleCpu();
  }

  /* ---------- input ---------- */
  /* A refilled card is still sliding in face down: a quick second tap on the same spot must not play it unseen. */
  const settling = (side, slot) => performance.now() - Number(slots[side][slot].dataset.at || 0) < SLIDE_MS;
  function tapSlot(side, slot) {
    if (ui.phase !== "play" || !isHuman(side) || !game.sides[side].field[slot] || settling(side, slot)) return;
    if (ui.sel[side] === slot) {
      ui = { ...ui, sel: ui.sel.map((v, s) => (s === side ? null : v)) };
      draw();
      return;
    }
    const piles = R.pilesFor(game, side, slot);
    if (piles.length === 0) nope(side, slot);
    else if (piles.length === 1) doPlay(side, slot, piles[0]);
    else {
      soundSelect();
      ui = { ...ui, sel: ui.sel.map((v, s) => (s === side ? slot : v)) };
      draw();
    }
  }
  function playSelected(side, pile) {
    const slot = ui.sel[side];
    if (ui.phase !== "play" || slot === null || !R.pilesFor(game, side, slot).includes(pile)) return;
    doPlay(side, slot, pile);
  }
  /* A pile tap goes to whoever has a card waiting for it; if both do, the half of the pile that was tapped decides. */
  function tapPile(pile, y) {
    if (ui.phase !== "play") return;
    const ready = [0, 1].filter(s => isHuman(s) && ui.sel[s] !== null && R.pilesFor(game, s, ui.sel[s]).includes(pile));
    if (ready.length === 0) return;
    const r = el.piles[pile].getBoundingClientRect();
    playSelected(ready.length === 1 ? ready[0] : y < r.top + r.height / 2 ? 1 : 0, pile);
  }
  function onKey(e) {
    if (el.table.hidden || e.repeat) return;
    if (e.key === "Escape") quit();
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= R.FIELD) tapSlot(0, n - 1);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") playSelected(0, e.key === "ArrowLeft" ? 1 : 0);
  }

  /* ---------- setup ---------- */
  function renderSetup() {
    const cpu = settings.vs === "cpu";
    View.chips($("spVsChips"), VS, settings.vs, v => update({ vs: v }));
    el.levelOpt.hidden = !cpu;
    View.chips($("spLevelChips"), R.LEVELS.map(l => ({ value: l, label: LEVEL_LABEL[l] })), settings.level, v => update({ level: v }));
    el.namesBox.hidden = cpu;
    View.chips($("spHintChips"), HINTS, settings.hints, v => update({ hints: v }));
    View.list($("spRules"), [
      cpu ? "赤26枚があなた、黒26枚がCPU。手元に4枚ならべて、残りは山札"
        : "スマホを2人の間に平らに置く。下側が赤、上側が黒の26枚ずつ。手元に4枚ならべて、残りは山札",
      ...RULES_TAIL
    ]);
    View.text(el.record, cpu ? recordText() : "");
    el.actions.replaceChildren(makeButton("はじめる", start, "primary"));
  }
  function renderDemo() {
    el.demo.replaceChildren(...DEMO.map(([suit, rank, deg, y]) => {
      const c = Cards.el({ suit, rank, id: `demo-${suit}${rank}` }, { size: "sm" });
      c.style.transform = `translateY(${y}px) rotate(${deg}deg)`;
      return c;
    }));
  }
  function buildSlots(side) {
    const row = Array.from({ length: R.FIELD }, (_, i) => {
      const node = document.createElement("div");
      node.className = "speed-slot speed-empty";
      node.setAttribute("role", "button");
      node.dataset.cid = "";
      node.addEventListener("pointerdown", (e) => { e.preventDefault(); tapSlot(side, i); });
      return node;
    });
    el.slotRows[side].replaceChildren(...row);
    return row;
  }

  function init() {
    settings = normalize(Store.load(KEY, {}) || {});
    slots = [0, 1].map(buildSlots);
    el.decks.forEach(d => d.prepend(Cards.el(null, { faceDown: true })));
    el.sides.forEach((s, i) => { s.querySelector(".speed-suit").innerHTML = Cards.suitSvg(i === 0 ? "H" : "S"); });
    el.piles.forEach((node, p) => node.addEventListener("pointerdown", (e) => { e.preventDefault(); tapPile(p, e.clientY); }));
    el.table.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelCpu(); else scheduleCpu(); });
    Duo.fill(el.nameInputs);
    renderDemo();
    renderSetup();
  }
  function onShow() {
    Duo.fill(el.nameInputs);
    renderSetup();
  }
  function leave() {
    if (ui.phase !== "idle" || !el.table.hidden) quit();
    else clearTimers();
  }

  return { init, onShow, leave };
})();

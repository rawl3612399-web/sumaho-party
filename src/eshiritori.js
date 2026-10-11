/* 絵しりとり screen: pass the phone, look only at the previous drawing, draw the next word, then reveal the chain together. */
const Eshiritori = (() => {
  const R = EshiritoriRules;
  const KEY = "eshiritori.settings";
  const URGENT_SEC = 10;
  const TICK_SEC = 5;
  const REPLAY_MS = 1700;
  const DRUM_MS = 1600;
  const LINK_DELAY_MS = 420;
  const GUARD_MS = 450;
  const PAD_PHASES = ["look", "draw", "answer", "show", "judge"];
  const MOOD_PHASES = ["start", "pass", "look", "draw", "answer"];
  const SIZE_LABELS = Object.freeze({ thin: "細い", thick: "太い" });
  const ERASER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 20 3.8 15.3a1.5 1.5 0 0 1 0-2.1L12.6 4.4a1.5 1.5 0 0 1 2.1 0l4.9 4.9a1.5 1.5 0 0 1 0 2.1L11.5 20z"/><path d="M8.6 8.5l6.9 6.9M8.5 20H20"/></svg>';

  const el = {
    setup: $("eSetup"), play: $("ePlay"), label: $("eLabel"), title: $("eTitle"), card: $("eCard"),
    hint: $("eHint"), actions: $("eActions"), head: $("eHead"), prevBox: $("ePrevBox"), prev: $("ePrev"),
    prevWord: $("ePrevWord"), whoName: $("eWhoName"), whoNote: $("eWhoNote"), clock: $("eClock"),
    pad: $("ePad"), canvas: $("eCanvas"), stamp: $("eStamp"), link: $("eLink"), tools: $("eTools"),
    palette: $("ePalette"), sizes: $("eSizes"), undo: $("eUndo"), clear: $("eClear"),
    answerBox: $("eAnswerBox"), answer: $("eAnswer"), note: $("eNote"), list: $("eList")
  };
  const base = document.createElement("canvas");

  let settings = { players: 4, count: 6, seconds: 60 };
  let ui = { phase: "setup", index: 0, linkShown: false, guard: 0, paused: false };
  let game = null;
  let result = null;
  let usedStarts = [];
  let sketch = { strokes: [], current: null, pointer: null, locked: false, peeking: false };
  let pen = { tool: "pen", color: "--ink", size: "thin" };
  let clock = { endAt: 0, left: 0, timer: 0, lastSec: null };
  let replay = { frame: 0, count: 0, soundAt: 0 };
  let frame = 0;
  let baseFor = { strokes: null, size: 0, theme: 0 };
  let theme = 0;
  let timers = [];

  const S = (i) => View.seat(R.seatOf(game, i));
  const later = (fn, ms) => { timers = [...timers, setTimeout(fn, ms)]; };
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  /* A double tap must not also press the button that appears in the same place on the next screen. */
  const act = (fn) => () => { if (performance.now() >= ui.guard) fn(); };
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isLast = () => game.turns.length + 1 >= game.count;

  function normalizeSettings(s) {
    const src = s && typeof s === "object" ? s : {};
    return {
      players: Number.isInteger(src.players) && src.players >= R.PLAYERS.min && src.players <= R.PLAYERS.max ? src.players : 4,
      count: R.COUNTS.includes(src.count) ? src.count : 6,
      seconds: R.TIMES.includes(src.seconds) ? src.seconds : 60
    };
  }
  function update(patch) {
    settings = normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(patch) {
    const moved = patch.phase !== undefined && patch.phase !== ui.phase;
    ui = { ...ui, ...patch, ...(moved ? { guard: performance.now() + GUARD_MS } : {}) };
    render();
  }

  /* ---------- canvas ---------- */
  const dpr = () => Math.min(window.devicePixelRatio || 1, 3);
  const sizeOf = (canvas) => Math.max(1, Math.round(canvas.clientWidth * dpr()));
  const colors = () => Object.fromEntries(R.PALETTE.map(p => [p.token, token(p.token)]));
  function trace(g, s, size, c) {
    const color = (s.tool === "pen" && c[s.color]) || c["--ink"];
    g.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = Math.max(1.3 * dpr(), s.width * size);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    R.pathOf(s.points).forEach(([cmd, ...v]) => {
      const [a, b, x, y] = v.map(n => n * size);
      if (cmd === "D") g.arc(a, b, g.lineWidth / 2, 0, Math.PI * 2);
      else if (cmd === "M") g.moveTo(a, b);
      else if (cmd === "L") g.lineTo(a, b);
      else g.quadraticCurveTo(a, b, x, y);
    });
    if (s.points.length === 1) g.fill(); else g.stroke();
    g.globalCompositeOperation = "source-over";
  }
  function paintInto(canvas, size, strokes) {
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const g = canvas.getContext("2d");
    const c = colors();
    g.clearRect(0, 0, size, size);
    strokes.forEach(s => trace(g, s, size, c));
  }
  const paint = (canvas, strokes) => paintInto(canvas, sizeOf(canvas), strokes);

  /* While drawing: finished strokes are cached in an offscreen canvas; only the live stroke is redrawn. */
  function paintLive() {
    const size = sizeOf(el.canvas);
    if (baseFor.strokes !== sketch.strokes || baseFor.size !== size || baseFor.theme !== theme) {
      paintInto(base, size, sketch.strokes);
      baseFor = { strokes: sketch.strokes, size, theme };
    }
    if (el.canvas.width !== size) { el.canvas.width = size; el.canvas.height = size; }
    const g = el.canvas.getContext("2d");
    g.clearRect(0, 0, size, size);
    g.drawImage(base, 0, 0);
    if (sketch.current) trace(g, sketch.current, size, colors());
  }
  function padStrokes() {
    if (ui.phase === "look" || sketch.peeking) return game.turns[ui.index - 1].strokes;
    if (ui.phase === "show" || ui.phase === "judge") return game.turns[ui.index].strokes;
    return sketch.strokes;
  }
  function renderPad() {
    if (el.pad.hidden || replay.frame || !game) return;
    if (ui.phase === "draw" && !sketch.peeking) paintLive();
    else paint(el.canvas, padStrokes());
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderPad(); });
  }

  /* Replays a drawing stroke by stroke, with a soft pencil sound. */
  function startReplay(strokes) {
    stopReplay();
    if (reduced() || strokes.length === 0) return;
    const t0 = performance.now();
    const step = () => {
      const now = performance.now();
      const shown = R.strokesAt(strokes, (now - t0) / REPLAY_MS);
      const sound = shown.length > replay.count && now - replay.soundAt > 80;
      if (sound) scribble();
      paint(el.canvas, shown);
      const next = now - t0 < REPLAY_MS ? requestAnimationFrame(step) : 0;
      replay = { frame: next, count: shown.length, soundAt: sound ? now : replay.soundAt };
    };
    replay = { frame: requestAnimationFrame(step), count: 0, soundAt: 0 };
  }
  function stopReplay() {
    cancelAnimationFrame(replay.frame);
    replay = { frame: 0, count: 0, soundAt: 0 };
  }
  const scribble = () => Sound.hiss({ dur: 0.07, vol: 0.05, type: "bandpass", freq: 2200, to: 4200, q: 1.4 });

  /* ---------- drawing input ---------- */
  const canDraw = () => ui.phase === "draw" && !sketch.locked && !sketch.peeking;
  function pointsFrom(e) {
    const r = el.canvas.getBoundingClientRect();
    const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    return (list.length ? list : [e]).map(ev => [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]);
  }
  function onDown(e) {
    if (!canDraw() || sketch.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    try { el.canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    const [x, y] = pointsFrom(e)[0];
    sketch = { ...sketch, current: R.newStroke(pen.tool, pen.color, pen.size, x, y), pointer: e.pointerId };
    scribble();
    schedule();
  }
  function onMove(e) {
    if (!sketch.current || e.pointerId !== sketch.pointer) return;
    e.preventDefault();
    const current = pointsFrom(e).reduce((s, [x, y]) => R.extendStroke(s, x, y), sketch.current);
    if (current === sketch.current) return;
    sketch = { ...sketch, current };
    schedule();
  }
  function onUp(e) {
    if (sketch.current && e.pointerId === sketch.pointer) commitStroke();
  }
  function commitStroke() {
    if (!sketch.current) return;
    sketch = { ...sketch, strokes: R.addStroke(sketch.strokes, sketch.current), current: null, pointer: null };
    render();
  }
  function setPen(patch) {
    pen = { ...pen, ...patch };
    renderTools();
  }
  function undo() {
    if (!canDraw() || sketch.strokes.length === 0) return;
    sketch = { ...sketch, strokes: R.undoStroke(sketch.strokes) };
    Sound.sfx("back");
    render();
  }
  function clearAll() {
    if (!canDraw() || sketch.strokes.length === 0) return;
    sketch = { ...sketch, strokes: [] };
    Sound.sfx("whoosh");
    render();
  }
  function peek(on) {
    if (ui.phase !== "draw" || ui.index === 0 || sketch.peeking === on) return;
    if (on) commitStroke();
    sketch = { ...sketch, peeking: on };
    if (on) Sound.sfx("flip");
    renderParts();
  }

  /* ---------- clock ---------- */
  function startClock(ms) {
    stopClock();
    if (!game.seconds || sketch.locked) return;
    clock = { endAt: performance.now() + ms, left: ms, timer: setInterval(tick, 200), lastSec: null };
    tick();
  }
  function stopClock() {
    const left = clock.timer ? Math.max(0, clock.endAt - performance.now()) : clock.left;
    clearInterval(clock.timer);
    clock = { ...clock, timer: 0, left };
  }
  function showClock() {
    const sec = Math.ceil(clock.left / 1000);
    el.clock.textContent = View.clock(sec);
    el.clock.style.setProperty("--left", (clock.left / (game.seconds * 1000)).toFixed(3));
    el.clock.classList.toggle("urgent", sec <= URGENT_SEC);
  }
  function tick() {
    const left = Math.max(0, clock.endAt - performance.now());
    const sec = Math.ceil(left / 1000);
    if (sec !== clock.lastSec && sec <= TICK_SEC && sec > 0) Sound.sfx("tick", sec % 2 === 0);
    if (sec <= URGENT_SEC) Music.intensify();
    clock = { ...clock, left, lastSec: sec };
    showClock();
    if (left <= 0) timeUp();
  }
  function timeUp() {
    stopClock();
    commitStroke();
    sketch = { ...sketch, locked: true, peeking: false };
    Music.stop();
    Sound.sfx("buzz");
    render();
  }

  /* ---------- flow ---------- */
  function pickStart() {
    const next = R.nextStart(usedStarts);
    usedStarts = next.used;
    game = R.newGame(settings.players, settings.count, settings.seconds, next.word);
  }
  function start() {
    Sound.ensure();
    Awake.keep();
    stopAll();
    pickStart();
    result = null;
    Sound.sfx("confirm");
    Music.play("think");
    go({ phase: "start", index: 0 });
    Fx.pop(el.card);
  }
  function changeStart() {
    pickStart();
    Sound.sfx("flip");
    render();
    Fx.pop(el.card);
  }
  function beginTurn() {
    Sound.sfx("flip");
    go({ phase: "look" });
    Fx.pop(el.pad);
  }
  function startDrawing() {
    sketch = { strokes: [], current: null, pointer: null, locked: false, peeking: false };
    pen = { tool: "pen", color: "--ink", size: "thin" };
    el.answer.value = "";
    clock = { ...clock, left: game.seconds * 1000 };
    Sound.sfx("go");
    if (game.seconds) Music.play("draw");
    go({ phase: "draw" });
    startClock(clock.left);
  }
  function finishDrawing() {
    commitStroke();
    stopClock();
    Sound.sfx("pop");
    Music.play("think");
    go({ phase: "answer" });
    el.answer.focus();
  }
  function backToDrawing() {
    Sound.sfx("back");
    if (game.seconds) Music.play("draw");
    go({ phase: "draw" });
    startClock(clock.left);
  }
  function submitAnswer() {
    if (ui.phase !== "answer" || R.answerError(el.answer.value)) return;
    game = R.addTurn(game, el.answer.value, sketch.strokes);
    el.answer.value = "";
    el.note.textContent = "";
    el.answer.blur();
    Sound.sfx("whoosh");
    if (R.isComplete(game)) {
      result = R.judgeChain(game.start, R.answersOf(game));
      Music.stop();
      go({ phase: "ready", index: 0 });
    } else {
      go({ phase: "pass", index: game.turns.length });
    }
    Fx.pop(el.card);
  }
  function showDrawing(index) {
    stopReplay();
    Sound.sfx(index === 0 ? "reveal" : "whoosh");
    go({ phase: "show", index, linkShown: false });
    startReplay(game.turns[index].strokes);
    Fx.pop(el.pad);
  }
  function revealAnswer() {
    stopReplay();
    Sound.sfx("flip");
    go({ phase: "judge" });
    Fx.pop(el.card);
    later(showLink, LINK_DELAY_MS);
  }
  function showLink() {
    if (ui.phase !== "judge" || ui.linkShown) return;
    const link = result.links[ui.index];
    go({ linkShown: true });
    Fx.pop(el.link);
    Sound.sfx(link.ok ? "coin" : "wrong");
    if (!link.ok) Fx.shake();
    if (link.ok && link.endsN) later(() => { Sound.sfx("wrong"); Fx.shake(); }, 380);
  }
  function nextReveal() {
    if (ui.index + 1 < game.turns.length) showDrawing(ui.index + 1);
    else tally();
  }
  function tally() {
    go({ phase: "tally" });
    Sound.sfx("drumroll", DRUM_MS / 1000);
    later(() => {
      if (ui.phase !== "tally") return;
      const v = R.verdict(result);
      if (v === "perfect") { Sound.sfx("victory"); Fx.confetti(); } else Sound.sfx(v === "good" ? "fanfare" : "lose");
      go({ phase: "done" });
      Fx.pop(el.title);
    }, DRUM_MS);
  }
  function stopAll() {
    stopClock();
    stopReplay();
    clearTimers();
    sketch = { ...sketch, current: null, pointer: null, peeking: false };
  }
  function toSetup() {
    stopAll();
    Music.stop();
    go({ phase: "setup" });
  }
  function moodMusic() {
    if (!MOOD_PHASES.includes(ui.phase)) return;
    Music.play(ui.phase === "draw" && game.seconds && !sketch.locked ? "draw" : "think");
  }

  /* ---------- screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", act(start), "primary")] }),
    start: () => ({
      label: "はじめの言葉",
      card: { main: game.start, sub: `「${R.lastKana(game.start)}」から始まるものを描こう` },
      hint: `${S(0)}さんにスマホを渡してね。描いた絵と答えは、ほかの人に見せないで`,
      actions: [
        makeButton("設定", act(toSetup), "small"),
        makeButton("別の言葉", act(changeStart), "small"),
        makeButton(`${S(0)}さんが描く`, act(startDrawing), "primary")
      ]
    }),
    pass: () => ({
      label: `${ui.index + 1} / ${game.count}枚目`,
      title: `${S(ui.index)}さんの番`,
      card: { main: "？", back: true },
      hint: `${S(ui.index)}さんにスマホを渡してね。ほかの人は画面を見ないで`,
      actions: [makeButton(`${S(ui.index)}さんが見る`, act(beginTurn), "primary")]
    }),
    look: () => ({
      label: `${S(ui.index - 1)}さんの絵`,
      title: "これは何の絵？",
      hint: "答えは心の中で決めてね（口に出さない）。その言葉のさいごの文字から始まるものを描こう",
      actions: [makeButton("決めた！ 描く", act(startDrawing), "primary")]
    }),
    draw: () => ({
      actions: [makeButton(sketch.locked ? "答えを入れる" : "描けた！", act(finishDrawing), "primary", !sketch.locked && !R.hasInk(sketch.strokes))]
    }),
    answer: () => ({
      title: "何を描いた？",
      hint: "ひらがなで入れてね。次の人には見えません",
      actions: [
        ...(sketch.locked ? [] : [makeButton("描き直す", act(backToDrawing), "small")]),
        makeButton(isLast() ? "答え合わせへ" : "次の人へ", act(submitAnswer), "primary", Boolean(R.answerError(el.answer.value)))
      ]
    }),
    ready: () => ({
      label: "全員描けた！",
      title: "答え合わせ",
      card: { main: game.start, sub: "はじめの言葉" },
      hint: "みんなで画面を見よう。1枚ずつ「何に見えた？」を言い合ってから答えを見てね",
      actions: [makeButton("答え合わせスタート", act(() => showDrawing(0)), "primary")]
    }),
    show: () => ({
      label: `${ui.index + 1} / ${game.count}枚目・${S(ui.index)}さんの絵`,
      title: "これは何？",
      hint: ui.index + 1 < game.count ? `次の${S(ui.index + 1)}さんは、何だと思って描いた？` : "みんなは何だと思う？",
      actions: [makeButton("答えを見る", act(revealAnswer), "primary")]
    }),
    judge: () => {
      const link = result.links[ui.index];
      const note = ui.linkShown ? `${R.linkNote(link)}${link.endsN ? " しかも「ん」で終わっちゃった！" : ""}` : "";
      return {
        label: `${ui.index + 1} / ${game.count}枚目・${S(ui.index)}さんの絵`,
        card: { main: link.to, sub: link.endsN ? "「ん」で終わる言葉！" : `${S(ui.index)}さんの答え`, cls: `eshiritori-compact${link.endsN ? " eshiritori-n" : ""}` },
        hint: note,
        actions: [makeButton(ui.index + 1 < game.count ? "次の絵へ" : "結果を見る", act(nextReveal), "primary", !ui.linkShown)]
      };
    },
    tally: () => ({ label: "結果", title: "しりとりは…", card: { main: "？", back: true }, actions: [] }),
    done: () => ({
      label: "結果",
      ...doneText(),
      actions: [makeButton("設定", act(toSetup), "small"), makeButton("もう一回", act(start), "primary")]
    })
  };
  function doneText() {
    if (result.perfect) return { title: "全部つながった！", hint: "はじめの言葉から最後まで、絵だけでつながりました！" };
    if (result.endsN && result.held === result.total) {
      return { title: "おしい！最後が「ん」", hint: "絵は全部つながったのに、最後の言葉が「ん」で終わっちゃった" };
    }
    return { title: `${result.total}か所中${result.held}か所つながった`, hint: "×のところで読みちがいがあったみたい。どこでずれたか話してみよう" };
  }

  /* ---------- rendering ---------- */
  function renderHead() {
    if (ui.phase !== "draw") return;
    const first = ui.index === 0;
    el.whoName.textContent = `${S(ui.index)}さんの番　${ui.index + 1}/${game.count}`;
    el.whoNote.textContent = first ? `「${R.lastKana(game.start)}」から始まるもの` : "前の絵は長押しで大きく";
    el.prevBox.disabled = first;
    el.prevBox.classList.toggle("is-peeking", sketch.peeking);
    el.prev.hidden = first;
    el.prevWord.hidden = !first;
    el.prevWord.textContent = game.start;
    el.clock.hidden = !game.seconds;
    if (game.seconds) showClock();
    if (!first) paint(el.prev, game.turns[ui.index - 1].strokes);
  }
  function renderTools() {
    if (ui.phase !== "draw") return;
    const off = sketch.locked;
    [...el.palette.children].forEach(b => {
      const on = b.dataset.color === "eraser" ? pen.tool === "eraser" : pen.tool === "pen" && pen.color === b.dataset.color;
      b.setAttribute("aria-pressed", String(on));
      b.disabled = off;
    });
    [...el.sizes.children].forEach(b => {
      b.setAttribute("aria-pressed", String(pen.size === b.dataset.size));
      b.disabled = off;
    });
    el.undo.disabled = off || sketch.strokes.length === 0;
    el.clear.disabled = off || sketch.strokes.length === 0;
  }
  function renderAnswer() {
    if (ui.phase !== "answer") return;
    const value = el.answer.value;
    const err = value.trim() ? R.answerError(value) : null;
    el.note.textContent = !value.trim() ? "" : err || `さいごの文字は「${R.lastKana(value)}」`;
    el.note.classList.toggle("is-bad", Boolean(err));
  }
  function linkSide(word, kana) {
    const side = document.createElement("span");
    side.className = "eshiritori-side";
    side.innerHTML = '<small></small><b class="eshiritori-kana"></b>';
    side.querySelector("small").textContent = word;
    side.querySelector("b").textContent = kana || "？";
    return side;
  }
  function renderLink() {
    const show = ui.phase === "judge" && ui.linkShown;
    el.link.hidden = !show;
    if (!show) return;
    const link = result.links[ui.index];
    el.link.classList.toggle("is-ok", link.ok);
    el.link.classList.toggle("is-ng", !link.ok);
    const arrow = document.createElement("span");
    arrow.className = "eshiritori-arrow";
    arrow.setAttribute("aria-label", link.ok ? "つながった" : "切れた");
    el.link.replaceChildren(linkSide(link.from, link.last), arrow, linkSide(link.to, link.first));
  }
  function listRow({ word, note, linkText = "", mark = "", cls = "", thumb = true }) {
    const li = document.createElement("li");
    li.className = cls;
    const lead = thumb ? '<canvas class="eshiritori-mini" aria-hidden="true"></canvas>' : '<span class="eshiritori-mini eshiritori-flag">スタート</span>';
    li.innerHTML = `${lead}<span class="eshiritori-row-word"><b></b><small></small></span><span class="eshiritori-row-link"></span><span class="mark"></span>`;
    li.querySelector("b").textContent = word;
    li.querySelector("small").textContent = note;
    li.querySelector(".eshiritori-row-link").textContent = linkText;
    li.querySelector(".mark").textContent = mark;
    return li;
  }
  function renderList() {
    const show = ui.phase === "done";
    el.list.hidden = !show;
    if (!show) return;
    const rows = result.links.map((l, i) => listRow({
      word: l.to,
      note: `${S(i)}さん${l.endsN ? "・「ん」で終わり" : ""}`,
      linkText: `${l.last || "？"}→${l.first || "？"}`,
      mark: l.ok ? "○" : "×",
      cls: `${l.ok ? "ok" : "ng"}${l.endsN ? " eshiritori-endn" : ""}`
    }));
    const head = listRow({ word: game.start, note: "はじめの言葉", cls: "eshiritori-start", thumb: false });
    el.list.replaceChildren(head, ...rows);
    rows.forEach((li, i) => paint(li.querySelector("canvas"), game.turns[i].strokes));
  }
  function renderParts() {
    const p = ui.phase;
    el.head.hidden = p !== "draw";
    el.tools.hidden = p !== "draw";
    el.answerBox.hidden = p !== "answer";
    el.pad.hidden = !PAD_PHASES.includes(p);
    el.pad.classList.toggle("is-small", p === "answer");
    el.pad.classList.toggle("is-mid", p === "judge");
    el.pad.classList.toggle("is-live", canDraw());
    el.pad.classList.toggle("is-peek", p === "draw" && sketch.peeking);
    el.stamp.hidden = !(p === "draw" && sketch.locked);
    renderHead();
    renderTools();
    renderAnswer();
    renderLink();
    renderList();
    renderPad();
  }
  function renderSetup() {
    const range = Array.from({ length: R.PLAYERS.max - R.PLAYERS.min + 1 }, (_, i) => R.PLAYERS.min + i);
    View.chips($("ePlayerChips"), View.options(range, n => `${n}人`), settings.players, n => update({ players: n }));
    View.chips($("eCountChips"), View.options(R.COUNTS, n => `${n}枚`), settings.count, n => update({ count: n }));
    View.chips($("eTimeChips"), View.options(R.TIMES, n => (n ? `${n}秒` : "なし")), settings.seconds, n => update({ seconds: n }));
    View.list($("eRules"), [
      "はじめの言葉から、絵だけでしりとりをつなぐ。しゃべるのは禁止",
      "自分の番では前の人の絵だけを見て、何の絵か心の中で決める",
      "その言葉のさいごの文字から始まるものを描いて、答えをひらがなで入れる",
      "最後に1枚ずつ答え合わせ。全部つながったら、みんなの勝ち！",
      "「ー」はその前の文字、小さい「ゃ」は「や」でつなぐ。濁点はあってもなくてもOK。「ん」で終わったらアウト"
    ]);
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    el.play.dataset.phase = ui.phase;
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase !== "setup") renderParts();
  }

  /* ---------- setup ---------- */
  function toolButton(cls, label, inner, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.setAttribute("aria-label", label);
    b.innerHTML = inner;
    b.addEventListener("click", onClick);
    return b;
  }
  function buildTools() {
    const swatches = R.PALETTE.map(p => {
      const b = toolButton("eshiritori-swatch", `ペン：${p.label}`, '<span class="eshiritori-dot"></span>', () => setPen({ tool: "pen", color: p.token }));
      b.dataset.color = p.token;
      b.style.setProperty("--sw", `var(${p.token})`);
      return b;
    });
    const eraser = toolButton("eshiritori-swatch eshiritori-eraser", "消しゴム", `<span class="eshiritori-dot">${ERASER_ICON}</span>`, () => setPen({ tool: "eraser" }));
    eraser.dataset.color = "eraser";
    el.palette.replaceChildren(...swatches, eraser);
    el.sizes.replaceChildren(...Object.entries(SIZE_LABELS).map(([size, label]) => {
      const b = toolButton("eshiritori-size", `太さ：${label}`, `<i aria-hidden="true"></i>${label}`, () => setPen({ size }));
      b.dataset.size = size;
      return b;
    }));
    el.undo.addEventListener("click", undo);
    el.clear.addEventListener("click", clearAll);
  }
  function bindPad() {
    el.canvas.addEventListener("pointerdown", onDown);
    el.canvas.addEventListener("pointermove", onMove);
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(t => el.canvas.addEventListener(t, onUp));
    el.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    el.prevBox.addEventListener("pointerdown", (e) => { e.preventDefault(); peek(true); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(t => el.prevBox.addEventListener(t, () => peek(false)));
    el.prevBox.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); peek(true); } });
    el.prevBox.addEventListener("keyup", () => peek(false));
    if ("ResizeObserver" in window) new ResizeObserver(() => renderPad()).observe(el.canvas);
    else window.addEventListener("resize", renderPad);
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (dark && dark.addEventListener) dark.addEventListener("change", () => { theme += 1; render(); });
  }
  function fixAnswer() {
    const fixed = R.toHiragana(el.answer.value);
    if (fixed !== el.answer.value) {
      const caret = el.answer.selectionStart;
      el.answer.value = fixed;
      if (caret !== null) el.answer.setSelectionRange(Math.min(caret, fixed.length), Math.min(caret, fixed.length));
    }
    if (ui.phase === "answer") render();
  }
  function bindAnswer() {
    el.answer.addEventListener("input", (e) => { if (!e.isComposing) fixAnswer(); });
    el.answer.addEventListener("compositionend", fixAnswer);
    el.answer.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submitAnswer();
    });
  }

  function init() {
    settings = normalizeSettings(Store.load(KEY, {}));
    buildTools();
    bindPad();
    bindAnswer();
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }
  /* The drawing clock stops while the game is not on screen (game list, another app, screen off). */
  function pauseClock() {
    if (ui.phase !== "draw" || !clock.timer) return;
    stopClock();
    ui = { ...ui, paused: true };
  }
  function resumeClock() {
    if (ui.phase !== "draw" || !ui.paused) return;
    ui = { ...ui, paused: false };
    startClock(clock.left);
  }
  function onVisibility() {
    if (document.hidden) pauseClock();
    else if (!el.play.closest(".mode").hidden) {
      resumeClock();
      render();
    }
  }
  function leave() {
    stopReplay();
    clearTimers();
    cancelAnimationFrame(frame);
    frame = 0;
    if (ui.phase === "draw") {
      commitStroke();
      sketch = { ...sketch, peeking: false };
      pauseClock();
    }
    if (ui.phase === "judge") ui = { ...ui, linkShown: true };
    if (ui.phase === "tally") ui = { ...ui, phase: "done" };
  }
  function onShow() {
    if (ui.phase === "setup") return;
    moodMusic();
    resumeClock();
    render();
  }

  return { init, leave, onShow };
})();

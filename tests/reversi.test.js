const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/reversi-rules.js");
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1; // CI machines are slower; the deploy workflow raises this

const { BLACK: B, WHITE: W } = R;

/* Repeatable random source (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* 8 strings of 8 chars: x = black, o = white, anything else empty. */
const boardOf = (rows) => rows.join("").split("").map(ch => (ch === "x" ? B : ch === "o" ? W : 0));
const sq = (name) => (Number(name[1]) - 1) * 8 + "abcdefgh".indexOf(name[0]);
const diffFor = (s, me) => {
  const c = R.counts(s.board);
  return me === B ? c.black - c.white : c.white - c.black;
};
const winnerAfter = (s, m) => {
  const a = R.play(s, m);
  return a.over ? R.result(a).winner : null;
};

/* Plays random games and yields every position where the side to move has a move (optionally filtered). */
function* positions(seed, games, keep = () => true) {
  const r = rng(seed);
  for (let g = 0; g < games; g++) {
    let s = R.newGame();
    while (!s.over) {
      if (R.mustPass(s)) { s = R.pass(s); continue; }
      if (keep(s)) yield s;
      const moves = R.legalMoves(s);
      s = R.play(s, moves[Math.floor(r() * moves.length)]);
    }
  }
}
/* Only near the end or when one side is almost wiped out can a game end at once. */
const nearEnd = (empties, few) => (s) => {
  const c = R.counts(s.board);
  return c.empty <= empties || Math.min(c.black, c.white) <= few;
};
/* Perfect-play final disc difference for `me` (small endgames only). */
function exact(s, me) {
  if (s.over) return diffFor(s, me);
  if (R.mustPass(s)) return exact(R.pass(s), me);
  const vals = R.legalMoves(s).map(m => exact(R.play(s, m), me));
  return s.turn === me ? Math.max(...vals) : Math.min(...vals);
}
/* After `m`, can the opponent end the game at once with a win? (or does `m` itself lose) */
function opensLoss(s, m) {
  const a = R.play(s, m);
  const opp = R.opponent(s.turn);
  if (a.over) return R.result(a).winner === opp;
  if (R.mustPass(a)) return false;
  return R.legalMoves(a).some(x => winnerAfter(a, x) === opp);
}

/* ---------- rules ---------- */
test("reversi: start position, black first, four legal moves", () => {
  const s = R.newGame();
  assert.equal(s.turn, B);
  assert.equal(s.board[sq("d4")], W);
  assert.equal(s.board[sq("e5")], W);
  assert.equal(s.board[sq("d5")], B);
  assert.equal(s.board[sq("e4")], B);
  assert.deepEqual(R.counts(s.board), { black: 2, white: 2, empty: 60 });
  assert.deepEqual(R.legalMoves(s), ["d3", "c4", "f5", "e6"].map(sq).sort((a, b) => a - b));
  assert.equal(R.mustPass(s), false);
  assert.equal(s.over, false);
});

test("reversi: a move flips the sandwiched stone and passes the turn", () => {
  const s = R.newGame();
  const a = R.play(s, sq("d3"));
  assert.equal(a.board[sq("d3")], B);
  assert.equal(a.board[sq("d4")], B);
  assert.deepEqual(a.flipped, [sq("d4")]);
  assert.equal(a.last, sq("d3"));
  assert.equal(a.turn, W);
  assert.deepEqual(R.counts(a.board), { black: 4, white: 1, empty: 59 });
});

test("reversi: one move can flip in all eight directions, and only closed lines flip", () => {
  const s = R.fromBoard(boardOf([
    "........",
    ".x.x.x..",
    "..ooo...",
    ".xo.ox.o",
    "..ooo...",
    ".x.x.x..",
    "........",
    "........"
  ]), B);
  const a = R.play(s, sq("d4"));
  assert.equal(a.flipped.length, 8);
  ["c3", "d3", "e3", "c4", "e4", "c5", "d5", "e5"].forEach(n => assert.equal(a.board[sq(n)], B, n));
  assert.equal(a.board[sq("h4")], W, "a stone outside the line stays");
});

test("reversi: illegal moves are refused with a message", () => {
  const s = R.newGame();
  assert.throws(() => R.play(s, sq("d4")), /置けません/);
  assert.throws(() => R.play(s, sq("a1")), /置けません/);
  assert.throws(() => R.play(s, 64), /マス/);
  assert.throws(() => R.play(s, 2.5), /マス/);
  assert.throws(() => R.play(s, "19"), /マス/);
  assert.equal(R.isLegal(s, sq("d3")), true);
  assert.equal(R.isLegal(s, sq("d6")), false);
  assert.deepEqual(R.flipsAt(s.board, sq("d6"), B), []);
});

test("reversi: bad states and levels are rejected", () => {
  assert.throws(() => R.play({ board: [], turn: B }, 0), /盤面/);
  assert.throws(() => R.play({ board: Array(64).fill(3), turn: B }, 0), /盤面/);
  assert.throws(() => R.play({ ...R.newGame(), turn: 0 }, sq("d3")), /手番/);
  assert.throws(() => R.cpuMove(R.newGame(), "oni"), /強さ/);
  assert.throws(() => R.fromBoard(Array(10).fill(0), B), /盤面/);
});

test("reversi: no move means pass; the other side moves again", () => {
  const s = R.fromBoard(boardOf(["xo......", "o.......", "........", "........", "........", "........", "........", "........"]), B);
  const a = R.play(s, sq("c1"));
  assert.equal(a.turn, W);
  assert.equal(a.over, false);
  assert.equal(R.mustPass(a), true);
  assert.deepEqual(R.legalMoves(a), []);
  const p = R.pass(a);
  assert.equal(p.turn, B);
  assert.equal(p.passed, W);
  assert.equal(p.last, sq("c1"), "the last move mark stays after a pass");
  const end = R.play(p, sq("a3"));
  assert.equal(end.over, true);
  assert.deepEqual(R.result(end), { black: 5, white: 0, empty: 59, winner: B, over: true });
  assert.throws(() => R.pass(R.newGame()), /パス/);
  assert.throws(() => R.play(end, sq("h8")), /終わ/);
});

test("reversi: game ends when neither side can move; most stones wins, equal is a draw", () => {
  const stuck = R.fromBoard(boardOf(["x.......", "........", "........", "........", "........", "........", "........", ".......o"]), W);
  assert.equal(stuck.over, true);
  assert.equal(R.mustPass(stuck), false);
  assert.equal(R.result(stuck).winner, R.EMPTY);
  const full = R.fromBoard(Array.from({ length: 64 }, (_, i) => (i < 32 ? B : W)), B);
  assert.equal(full.over, true);
  assert.equal(R.result(full).winner, R.EMPTY);
  const more = R.fromBoard(Array.from({ length: 64 }, (_, i) => (i < 31 ? B : W)), B);
  assert.equal(R.result(more).winner, W);
});

test("reversi: states are frozen and never changed by play, pass or cpuMove", () => {
  const s = R.newGame();
  const before = JSON.stringify(s);
  R.play(s, sq("d3"));
  R.cpuMove(s, "hard", rng(1));
  assert.equal(JSON.stringify(s), before);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.board));
  assert.throws(() => { "use strict"; s.board[0] = B; });
  const a = R.fromBoard(boardOf(["xo......", "o.......", "........", "........", "........", "........", "........", "........"]), B);
  const afterMove = R.play(a, sq("c1"));
  const frozen = JSON.stringify(afterMove);
  R.pass(afterMove);
  assert.equal(JSON.stringify(afterMove), frozen);
});

test("reversi: random games always end within 60 moves with legal play", () => {
  const r = rng(7);
  for (let g = 0; g < 40; g++) {
    let s = R.newGame();
    let moves = 0;
    let passes = 0;
    while (!s.over) {
      if (R.mustPass(s)) { s = R.pass(s); passes++; continue; }
      const legal = R.legalMoves(s);
      s = R.play(s, legal[Math.floor(r() * legal.length)]);
      moves++;
      assert.ok(passes <= moves + 1);
    }
    const c = R.counts(s.board);
    assert.ok(moves <= 60);
    assert.equal(c.black + c.white, moves + 4);
    assert.equal(R.legalMoves(s).length, 0);
  }
});

/* Square-by-square reference for flips: walk each of the 8 directions with row/column bounds. */
function refFlips(board, at, me) {
  if (board[at]) return [];
  const out = [];
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
    const line = [];
    let r = (at >> 3) + dr;
    let c = (at & 7) + dc;
    for (; inside(r, c) && board[r * 8 + c] === 3 - me; r += dr, c += dc) line.push(r * 8 + c);
    if (line.length && inside(r, c) && board[r * 8 + c] === me) out.push(...line);
  }
  return out.sort((a, b) => a - b);
}
const refMoves = (board, me) => [...Array(64).keys()].filter(i => refFlips(board, i, me).length);

test("reversi: moves, flips, passes and the end match a square-by-square reference", () => {
  const r = rng(77);
  let samePlayerPassedTwice = 0;
  for (let g = 0; g < 120; g++) {
    let s = R.newGame();
    let lastPass = null;
    for (;;) {
      const mine = refMoves(s.board, s.turn);
      assert.equal(s.over, !mine.length && !refMoves(s.board, 3 - s.turn).length);
      if (s.over) break;
      assert.deepEqual(R.legalMoves(s), mine);
      assert.equal(R.mustPass(s), !mine.length);
      if (!mine.length) {
        if (lastPass === s.turn) samePlayerPassedTwice++;
        lastPass = s.turn;
        s = R.pass(s);
        continue;
      }
      const m = mine[Math.floor(r() * mine.length)];
      const want = refFlips(s.board, m, s.turn);
      const a = R.play(s, m);
      assert.deepEqual([...a.flipped].sort((x, y) => x - y), want);
      assert.deepEqual([...a.board], s.board.map((v, i) => (i === m || want.includes(i) ? s.turn : v)));
      s = a;
    }
    const c = R.counts(s.board);
    assert.equal(R.result(s).winner, c.black > c.white ? B : c.white > c.black ? W : R.EMPTY);
  }
  assert.ok(samePlayerPassedTwice > 0, "no game where one side passed twice");
});

test("reversi: lines never wrap around the board edge", () => {
  /* g1 east runs into h1 then off the board (a2 is next in memory), g1 south-east into h2 then off (a4 next),
     b5 west into a5 then off (h4 is next in memory). None of these may flip. */
  const s = R.fromBoard(boardOf([".......o", "x......o", "........", "x......x", "o.......", "........", "........", "........"]), B);
  for (const n of ["g1", "b5"]) {
    assert.deepEqual(R.flipsAt(s.board, sq(n), B), [], n);
    assert.equal(R.isLegal(s, sq(n)), false, n);
  }
});

test("reversi: the last empty square decides the game; 32-32 is a draw", () => {
  /* a1 is the only empty square; black takes it and flips just b1 (a2, b2 and c1 are black). */
  const last = (extraBlack) => {
    const fixed = { 0: R.EMPTY, 1: W, 2: B, 8: B, 9: B };
    let left = extraBlack;
    return R.fromBoard(Array.from({ length: 64 }, (_, i) => (i in fixed ? fixed[i] : left-- > 0 ? B : W)), B);
  };
  const draw = R.play(last(27), sq("a1"));
  assert.deepEqual(draw.flipped, [sq("b1")]);
  assert.equal(draw.over, true);
  assert.deepEqual(R.result(draw), { black: 32, white: 32, empty: 0, winner: R.EMPTY, over: true });
  const win = R.play(last(28), sq("a1"));
  assert.deepEqual(R.result(win), { black: 33, white: 31, empty: 0, winner: B, over: true });
});

/* ---------- CPU ---------- */
/* A clock that never moves: the node budget alone bounds the search, so results do not depend on machine load. */
const NO_CLOCK = { now: () => 0 };

test("cpu: every level returns a legal move on many positions", () => {
  let n = 0;
  for (const s of positions(3, 12, () => (n++ % 3 === 0))) {
    for (const level of R.LEVELS) assert.ok(R.isLegal(s, R.cpuMove(s, level, rng(n))), `${level} at position ${n}`);
  }
  assert.ok(n > 300);
});

test("cpu: every level takes a move that wins on the spot", () => {
  let found = 0;
  for (const s of positions(13, 1500, nearEnd(6, 4))) {
    const moves = R.legalMoves(s);
    const wins = moves.filter(m => winnerAfter(s, m) === s.turn);
    if (!wins.length || wins.length === moves.length) continue;
    found++;
    for (const level of R.LEVELS) assert.ok(wins.includes(R.cpuMove(s, level, rng(found))), `${level} missed a win`);
  }
  const wipe = R.fromBoard(boardOf(["........", "xoo.....", "..x.....", "........", "........", "........", "........", "........"]), B);
  assert.deepEqual(R.legalMoves(wipe), ["a1", "c1", "d2"].map(sq));
  assert.equal(winnerAfter(wipe, sq("d2")), B);
  R.LEVELS.forEach(level => assert.equal(R.cpuMove(wipe, level, () => 0), sq("d2")));
  assert.ok(found >= 5, `only ${found} positions`);
});

test("cpu: ふつう and つよい avoid a move that lets the opponent win at once", () => {
  let found = 0;
  let hardChecked = 0;
  for (const s of positions(21, 300, nearEnd(12, 5))) {
    const moves = R.legalMoves(s);
    const bad = moves.filter(m => opensLoss(s, m));
    const safe = moves.filter(m => !bad.includes(m));
    if (!bad.length || !safe.length) continue;
    found++;
    assert.ok(safe.includes(R.cpuMove(s, "normal", rng(found))), "normal walked into a loss");
    if (R.counts(s.board).empty > 6) continue;
    if (Math.max(...safe.map(m => exact(R.play(s, m), s.turn))) < 0) continue;
    hardChecked++;
    assert.ok(safe.includes(R.cpuMove(s, "hard", rng(found), NO_CLOCK)), "hard walked into a loss");
  }
  assert.ok(found >= 5 && hardChecked >= 3, `found ${found}, hard ${hardChecked}`);
});

test("cpu: つよい plays the endgame perfectly", () => {
  let checked = 0;
  for (const s of positions(31, 200)) {
    if (R.counts(s.board).empty !== 6) continue;
    const moves = R.legalMoves(s);
    if (moves.length < 2 || moves.some(m => winnerAfter(s, m) === s.turn)) continue;
    const best = Math.max(...moves.map(m => exact(R.play(s, m), s.turn)));
    const pick = R.cpuMove(s, "hard", rng(checked), NO_CLOCK);
    assert.equal(exact(R.play(s, pick), s.turn), best);
    if (++checked >= 25) break;
  }
  assert.ok(checked >= 10, `only ${checked} endgames`);
});

test("cpu: levels are clearly different in strength", () => {
  const play = (black, white, r) => {
    let s = R.newGame();
    while (!s.over) s = R.mustPass(s) ? R.pass(s) : R.play(s, R.cpuMove(s, s.turn === B ? black : white, r, NO_CLOCK));
    return R.result(s).winner;
  };
  const series = (strong, weak, games, seed) => {
    const r = rng(seed);
    let wins = 0;
    for (let g = 0; g < games; g++) {
      const strongIsBlack = g % 2 === 0;
      const w = strongIsBlack ? play(strong, weak, r) : play(weak, strong, r);
      if (w === (strongIsBlack ? B : W)) wins++;
    }
    return wins;
  };
  assert.ok(series("normal", "easy", 20, 5) >= 15);
  assert.ok(series("hard", "normal", 6, 6) >= 5);
});

test("cpu: the time guard stops the search early and still returns a legal move", () => {
  let t = 0;
  const now = () => (t += 1000);
  for (const s of [...positions(41, 2)].filter((_, i) => i % 9 === 4)) {
    assert.ok(R.isLegal(s, R.cpuMove(s, "hard", rng(2), { now, ms: 1 })));
  }
});

test("cpu: つよい thinks under 150 ms in the worst case", (t) => {
  const r = rng(99);
  const list = [];
  for (const s of positions(51, 30)) if (r() < 0.25) list.push(s);
  for (const s of positions(52, 120)) if (R.counts(s.board).empty === 10 || R.counts(s.board).empty === 11) list.push(s);
  R.cpuMove(R.newGame(), "hard", rng(1));
  /* CPU time of this process (best of two runs), so a busy test machine pausing the process is not counted as thinking. */
  const think = (s, i) => {
    const t0 = process.cpuUsage();
    R.cpuMove(s, "hard", rng(i));
    const used = process.cpuUsage(t0);
    return (used.user + used.system) / 1000;
  };
  const worst = Math.max(...list.map((s, i) => Math.min(think(s, i), think(s, i))));
  assert.ok(list.length >= 150, `only ${list.length} positions`);
  t.diagnostic(`つよい worst ${worst.toFixed(1)} ms of CPU over ${list.length} positions (best of 2 runs each)`);
  assert.ok(worst < 150 * TIMING_SLACK, `worst ${worst.toFixed(1)} ms`);
});

/* ---------- screen flow (src/reversi.js on a tiny fake DOM with a manual clock) ---------- */
function screen(settings) {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const src = (f) => fs.readFileSync(require("node:path").join(__dirname, "../src", f), "utf8");
  class El {
    constructor() {
      Object.assign(this, { kids: [], up: null, cls: new Set(), dataset: {}, on: {}, hidden: false, disabled: false, value: "", text: "" });
      this.style = { setProperty() {} };
    }
    get classList() {
      const c = this.cls;
      return { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x), toggle: (x, v = !c.has(x)) => ((v ? c.add(x) : c.delete(x)), v) };
    }
    get className() { return [...this.cls].join(" "); }
    set className(v) { this.cls = new Set(String(v).split(" ").filter(Boolean)); }
    get textContent() { return this.text + this.kids.map(k => k.textContent).join(""); }
    set textContent(v) { this.text = String(v); this.kids = []; }
    get firstChild() { return this.kids[0]; }
    get offsetWidth() { return 1; }
    setAttribute() {}
    appendChild(k) { k.up = this; this.kids.push(k); return k; }
    replaceChildren(...ks) { this.kids = []; this.text = ""; ks.forEach(k => this.appendChild(k)); }
    addEventListener(type, fn) { (this.on[type] ||= []).push(fn); }
    closest(sel) { for (let n = this; n; n = n.up) if (n.cls.has(sel.slice(1))) return n; return null; }
    click() {
      if (this.disabled) return;
      let stop = false;
      const ev = { target: this, stopPropagation: () => { stop = true; } };
      for (let n = this; n && !stop; n = n.up) (n.on.click || []).forEach(fn => fn(ev));
    }
  }
  const ids = new Map([...src("partials/reversi.html").matchAll(/\sid="([^"]+)"/g)].map(([, id]) => [id, new El()]));
  const timers = new Map();
  let clock = 0;
  let seq = 0;
  const noop = () => {};
  const ctx = vm.createContext({
    console, Math, JSON, Map, Set, Array, Object, Number, String, Error, Int8Array, Int16Array, Int32Array, Infinity,
    Date: { now: () => clock },
    document: { getElementById: (id) => ids.get(id) ?? null, createElement: () => new El(), addEventListener: noop },
    window: { matchMedia: () => ({ matches: true }) }, navigator: {},
    localStorage: { getItem: (k) => (k === "reversi.settings" ? JSON.stringify(settings) : null), setItem: noop },
    setTimeout: (fn, ms) => { timers.set(++seq, { at: clock + ms, fn }); return seq; },
    clearTimeout: (id) => timers.delete(id),
    Sound: { ensure: noop, ctx: () => null, sfx: noop }, Music: { play: noop, stop: noop }, Fx: { pop: noop, replay: noop, confetti: noop }
  });
  ["shared.js", "reversi-rules.js", "reversi.js"].forEach(f => vm.runInContext(src(f), ctx, { filename: f }));
  const game = vm.runInContext("Reversi", ctx);
  const $ = (id) => ids.get(id);
  const cells = () => $("vBoard").kids;
  const advance = (ms) => {
    const end = clock + ms;
    for (let due; (due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]);) {
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
    }
    clock = end;
  };
  game.init();
  game.onShow();
  return {
    game, $, advance, timers,
    button: (label) => $("vActions").kids.find(b => b.textContent === label),
    tap: (i) => cells()[i].firstChild.click(),
    hints: () => cells().flatMap((c, i) => (c.cls.has("v-can") ? [i] : [])),
    stones: () => cells().filter(c => c.firstChild.cls.has("v-b") || c.firstChild.cls.has("v-w")).length
  };
}
const CPU_FIRST = { vs: "cpu", level: "easy", side: "white", hints: true };

test("screen: taps wait for the CPU, and a double tap places one stone", () => {
  const ui = screen(CPU_FIRST);
  ui.button("はじめる").click();
  ui.tap(sq("d3"));
  assert.equal(ui.stones(), 4, "a tap while the CPU thinks is ignored");
  ui.advance(449);
  assert.equal(ui.stones(), 4);
  ui.advance(2000);
  assert.equal(ui.stones(), 5);
  const [a, b] = ui.hints();
  ui.tap(a);
  ui.tap(a);
  ui.tap(b);
  assert.equal(ui.stones(), 6);
  ui.advance(5000);
  assert.equal(ui.stones(), 7);
  assert.equal(ui.$("vTitle").textContent, "あなたの番");
});

test("screen: the resign question pauses the CPU instead of letting it move behind the dialog", () => {
  const ui = screen(CPU_FIRST);
  ui.button("はじめる").click();
  ui.button("投了").click();
  assert.equal(ui.timers.size, 0);
  ui.advance(3000);
  assert.equal(ui.stones(), 4);
  assert.equal(ui.$("vTitle").textContent, "投了しますか？");
  ui.button("つづける").click();
  ui.advance(3000);
  assert.equal(ui.stones(), 5);
  ui.button("投了").click();
  ui.button("投了する").click();
  assert.equal(ui.timers.size, 0);
  assert.match(ui.$("vTitle").textContent, /CPUの勝ち/);
  ui.button("もう一回").click();
  ui.advance(3000);
  assert.equal(ui.stones(), 5, "a fresh game where the CPU opened again");
});

test("screen: leaving mid-move stops every timer; coming back resumes; undo returns to your turn", () => {
  const ui = screen({ ...CPU_FIRST, side: "black" });
  ui.button("はじめる").click();
  ui.tap(ui.hints()[0]);
  ui.advance(100);
  ui.game.leave();
  assert.equal(ui.timers.size, 0);
  ui.advance(5000);
  assert.equal(ui.stones(), 5, "nothing happens while away");
  ui.game.onShow();
  ui.advance(5000);
  assert.equal(ui.stones(), 6, "the CPU replied after coming back");
  ui.button("1手もどす").click();
  assert.equal(ui.stones(), 4);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.button("1手もどす").disabled, true);
});

test("screen: 2-player pass needs つぎへ, and a quick second tap there cannot undo a move", () => {
  const ui = screen({ vs: "duo", level: "normal", side: "black", hints: true });
  ui.button("はじめる").click();
  for (const n of ["d3", "c3", "e6", "d2", "d1", "e1", "b2", "c1"]) {
    ui.tap(sq(n));
    ui.advance(1000);
  }
  assert.equal(ui.$("vBanner").hidden, false, "black has no move after c1");
  ui.advance(5000);
  assert.equal(ui.$("vBanner").hidden, false, "2-player waits for つぎへ");
  ui.button("つぎへ").click();
  assert.equal(ui.$("vBanner").hidden, true);
  ui.button("1手もどす").click();
  assert.equal(ui.stones(), 12, "the double tap on つぎへ was ignored");
  ui.advance(700);
  ui.button("1手もどす").click();
  assert.equal(ui.stones(), 11, "white's c1 is taken back");
  assert.equal(ui.$("vTitle").textContent, "プレイヤー2の番");
});

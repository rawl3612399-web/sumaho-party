const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../src/dots-rules.js");

/* Slower CI machines scale the think-time limit (the deploy workflow sets TIMING_SLACK=3). */
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1;

/* Repeatable random sources. */
const fixed = (v) => () => v;
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/* Line numbers: horizontal (r, c) and vertical (r, c) on an n x n board. */
const h = (n, r, c) => r * n + c;
const v = (n, r, c) => (n + 1) * n + r * (n + 1) + c;
const allLines = (n) => Array.from({ length: D.lineCount(n) }, (_, i) => i);
/* A game where every line except `open` was drawn (in number order). */
const leaving = (n, open) => D.fromMoves(n, allLines(n).filter(l => !open.includes(l)));
const randomGame = (n, r, stop = Infinity) => {
  let s = D.newGame(n);
  while (!D.isOver(s) && s.moves.length < stop) s = D.play(s, D.cpuMove(s, "easy", r));
  return s;
};
/* Positions reached by mixed-level play, stopped before the end. */
function positions(count, seed) {
  const r = lcg(seed);
  const levels = ["easy", "normal", "hard"];
  return Array.from({ length: count }, (_, g) => {
    const n = D.SIZES[g % 3];
    const mix = [levels[g % 3], levels[Math.floor(g / 3) % 3]];
    const stop = Math.floor(r() * D.lineCount(n));
    let s = D.newGame(n);
    while (!D.isOver(s) && s.moves.length < stop) s = D.play(s, D.cpuMove(s, mix[s.turn], r));
    return s;
  }).filter(s => !D.isOver(s));
}
function playOut(n, levels, r) {
  let s = D.newGame(n);
  while (!D.isOver(s)) s = D.play(s, D.cpuMove(s, levels[s.turn], r));
  return s;
}

/* ---------- board geometry ---------- */
test("dots: line and box counts for every board size", () => {
  assert.deepEqual(D.SIZES, [3, 4, 5]);
  assert.deepEqual(D.SIZES.map(D.lineCount), [24, 40, 60]);
  assert.deepEqual(D.SIZES.map(D.boxCount), [9, 16, 25]);
  [2, 6, 4.5, "4", null].forEach(n => assert.throws(() => D.newGame(n), /大きさ/));
});

test("dots: lines are numbered horizontal first, then vertical", () => {
  assert.deepEqual(D.lineInfo(4, 0), { dir: "h", r: 0, c: 0 });
  assert.deepEqual(D.lineInfo(4, 19), { dir: "h", r: 4, c: 3 });
  assert.deepEqual(D.lineInfo(4, 20), { dir: "v", r: 0, c: 0 });
  assert.deepEqual(D.lineInfo(4, 39), { dir: "v", r: 3, c: 4 });
  assert.deepEqual(D.lineEnds(4, h(4, 2, 1)), { x1: 1, y1: 2, x2: 2, y2: 2 });
  assert.deepEqual(D.lineEnds(4, v(4, 1, 3)), { x1: 3, y1: 1, x2: 3, y2: 2 });
  [-1, 40, 1.5, "3", null].forEach(l => assert.throws(() => D.lineInfo(4, l), /線の番号/));
});

test("dots: each box has four sides and each line touches one or two boxes", () => {
  assert.deepEqual(D.linesOfBox(3, 4), [h(3, 1, 1), h(3, 2, 1), v(3, 1, 1), v(3, 1, 2)]);
  assert.deepEqual(D.boxesOfLine(3, h(3, 0, 1)), [1]);
  assert.deepEqual(D.boxesOfLine(3, h(3, 1, 1)), [1, 4]);
  assert.deepEqual(D.boxesOfLine(3, v(3, 2, 3)), [8]);
  D.SIZES.forEach(n => {
    const touches = Array(D.lineCount(n)).fill(0);
    for (let b = 0; b < D.boxCount(n); b++) D.linesOfBox(n, b).forEach(l => { touches[l]++; });
    allLines(n).forEach(l => assert.equal(touches[l], D.boxesOfLine(n, l).length));
  });
  assert.throws(() => D.linesOfBox(3, 9), /箱の番号/);
});

test("dots: a touch point picks the line whose diamond holds it", () => {
  assert.equal(D.lineNear(4, 0.5, 0), h(4, 0, 0));
  assert.equal(D.lineNear(4, 0, 0.5), v(4, 0, 0));
  assert.equal(D.lineNear(4, 0.5, 0.3), h(4, 0, 0));
  assert.equal(D.lineNear(4, 0.3, 0.5), v(4, 0, 0));
  assert.equal(D.lineNear(4, -0.3, 0.5), v(4, 0, 0), "a little outside the edge still counts");
  assert.equal(D.lineNear(4, 2.5, 4.4), h(4, 4, 2));
  assert.equal(D.lineNear(4, -0.6, 0.5), -1);
  assert.equal(D.lineNear(4, 2, -0.7), -1);
  assert.equal(D.lineNear(4, NaN, 1), -1);
  const r = lcg(11);
  for (let i = 0; i < 500; i++) {
    const x = r() * 5;
    const y = r() * 5;
    const e = D.lineEnds(5, D.lineNear(5, x, y));
    const dist = Math.abs(x - (e.x1 + e.x2) / 2) + Math.abs(y - (e.y1 + e.y2) / 2);
    assert.ok(dist <= 0.5 + 1e-9, `(${x}, ${y}) is ${dist} from its line`);
  }
});

/* ---------- moves and boxes ---------- */
test("dots: a new game is empty and the first player moves", () => {
  const s = D.newGame();
  assert.equal(s.size, 4);
  assert.ok(s.lines.every(x => x === null));
  assert.ok(s.boxes.every(x => x === null));
  assert.deepEqual(s.scores, [0, 0]);
  assert.equal(s.turn, 0);
  assert.equal(D.legalMoves(s).length, 40);
  assert.equal(D.isOver(s), false);
});

test("dots: a line that finishes nothing passes the turn", () => {
  const s = D.play(D.newGame(3), h(3, 0, 0));
  assert.equal(s.lines[h(3, 0, 0)], 0);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.claimed, []);
  assert.equal(D.extraTurn(s), false);
  assert.equal(s.last, h(3, 0, 0));
  assert.equal(D.play(s, h(3, 3, 2)).lines[h(3, 3, 2)], 1);
});

test("dots: the fourth side claims the box and the same player draws again", () => {
  const s = D.fromMoves(3, [h(3, 0, 0), v(3, 0, 0), h(3, 1, 0)]);
  assert.equal(s.turn, 1);
  assert.equal(D.sides(s, 0), 3);
  const t = D.play(s, v(3, 0, 1));
  assert.deepEqual(t.claimed, [0]);
  assert.equal(t.boxes[0], 1);
  assert.deepEqual(t.scores, [0, 1]);
  assert.equal(t.turn, 1, "box taker draws again");
  assert.equal(D.extraTurn(t), true);
  const u = D.play(t, h(3, 3, 2));
  assert.equal(u.turn, 0);
  assert.deepEqual(u.claimed, []);
});

test("dots: one line can finish two boxes at once", () => {
  const s = D.fromMoves(3, [h(3, 0, 0), h(3, 0, 1), h(3, 1, 0), h(3, 1, 1), v(3, 0, 0), v(3, 0, 2)]);
  const p = s.turn;
  const t = D.play(s, v(3, 0, 1));
  assert.deepEqual(t.claimed, [0, 1]);
  assert.equal(t.scores[p], 2);
  assert.equal(t.turn, p);
});

test("dots: drawn lines, bad numbers and broken states are refused", () => {
  const s = D.play(D.newGame(3), 5);
  assert.equal(D.canPlay(s, 5), false);
  assert.match(D.moveError(s, 5), /もう引かれて/);
  assert.throws(() => D.play(s, 5), /もう引かれて/);
  [-1, 24, 2.5, "3", null, undefined].forEach(l => {
    assert.equal(D.canPlay(s, l), false);
    assert.throws(() => D.play(s, l), /線の番号/);
  });
  [null, {}, { ...s, size: 7 }, { ...s, lines: [] }, { ...s, turn: 2 }].forEach(bad => {
    assert.throws(() => D.play(bad, 0), /盤面/);
    assert.throws(() => D.cpuMove(bad, "normal"), /盤面/);
  });
  assert.throws(() => D.fromMoves(3, "012"), /手順/);
});

test("dots: the game ends when every line is drawn; more boxes wins, equal is a draw", () => {
  const full = D.fromMoves(3, allLines(3));
  assert.equal(D.isOver(full), true);
  assert.equal(full.scores[0] + full.scores[1], 9);
  assert.equal(full.winner, full.scores[0] > full.scores[1] ? 0 : 1);
  assert.equal(full.draw, false);
  assert.match(D.moveError(full, 0), /勝負/);
  assert.deepEqual(D.legalMoves(full), []);
  assert.throws(() => D.cpuMove(full, "hard"), /勝負/);
  const even = D.fromMoves(4, allLines(4));
  assert.equal(even.scores[0] + even.scores[1], 16);
  const r = lcg(3);
  let draws = 0;
  for (let i = 0; i < 60; i++) {
    const end = randomGame(4, r);
    assert.equal(end.scores[0] + end.scores[1], 16);
    assert.ok(end.boxes.every(b => b === 0 || b === 1));
    if (end.scores[0] === end.scores[1]) {
      draws++;
      assert.equal(end.draw, true);
      assert.equal(end.winner, null);
    } else {
      assert.equal(end.winner, end.scores[0] > end.scores[1] ? 0 : 1);
    }
  }
  assert.ok(draws > 0, "8-8 happens on a 4x4 board");
});

test("dots: the turn passes exactly when a line claims nothing; scores match the boxes", () => {
  const r = lcg(21);
  D.SIZES.forEach(n => {
    let s = D.newGame(n);
    while (!D.isOver(s)) {
      const next = D.play(s, D.cpuMove(s, "easy", r));
      if (!D.isOver(next)) assert.equal(next.turn, next.claimed.length ? s.turn : 1 - s.turn);
      [0, 1].forEach(p => assert.equal(next.scores[p], next.boxes.filter(b => b === p).length));
      next.claimed.forEach(b => assert.equal(D.sides(next, b), 4));
      s = next;
    }
  });
});

test("dots: undo replays the game without the last lines", () => {
  const s = D.fromMoves(3, [h(3, 0, 0), v(3, 0, 0), h(3, 1, 0), v(3, 0, 1), 20]);
  assert.deepEqual(D.undo(s).moves, [h(3, 0, 0), v(3, 0, 0), h(3, 1, 0), v(3, 0, 1)]);
  const back = D.undo(s, 2);
  assert.deepEqual(back.scores, [0, 0]);
  assert.equal(back.boxes[0], null);
  assert.equal(back.turn, 1);
  assert.throws(() => D.undo(s, 6), /もどせる/);
  assert.throws(() => D.undo(s, 0), /もどせる/);
  /* Player 1 drew lines 4 and 5 (a box, then another line): undo to before player 1's latest line. */
  assert.deepEqual(s.movers, [0, 1, 0, 1, 1]);
  assert.deepEqual(D.undoLastBy(s, 1).moves, s.moves.slice(0, 4));
  assert.deepEqual(D.undoLastBy(s, 0).moves, s.moves.slice(0, 2));
  assert.throws(() => D.undoLastBy(D.newGame(3), 0), /もどせる/);
});

test("dots: capture, safe and give-away lines are told apart", () => {
  const s = D.fromMoves(3, [h(3, 0, 0), v(3, 0, 0), h(3, 1, 0)]);
  assert.deepEqual(D.captureMoves(s), [v(3, 0, 1)]);
  assert.equal(D.safeMoves(s).includes(v(3, 0, 1)), false);
  assert.equal(D.safeMoves(s).includes(h(3, 0, 2)), true);
  assert.equal(D.safeMoves(s).includes(v(3, 1, 0)), true, "a second side is still safe");
  const t = D.fromMoves(3, [h(3, 0, 0), v(3, 0, 0)]);
  assert.equal(D.safeMoves(t).includes(h(3, 1, 0)), false, "a third side is not");
  assert.equal(D.safeMoves(t).includes(v(3, 0, 1)), false);
  assert.equal(D.givesAway(t, h(3, 1, 0)), true, "third side of box 0");
  assert.equal(D.givesAway(t, h(3, 3, 2)), false);
  assert.equal(D.givesAway(s, v(3, 0, 1)), false, "finishing a box is not giving one away");
  assert.equal(D.givesAway(s, h(3, 0, 0)), false, "a drawn line gives nothing");
  assert.equal(D.sides(s, 0), 3);
  assert.equal(D.sides(s, 8), 0);
  [-1, 9, 1.5, "0", null].forEach(b => assert.throws(() => D.sides(s, b), /箱の番号/));
  assert.throws(() => D.sides({ ...s, size: 7 }, 0), /盤面/);
});

/* ---------- immutability ---------- */
test("dots: states are frozen and never changed by play, undo or the CPU", () => {
  const s = D.fromMoves(4, [0, 20, 4, 21, 1]);
  const snapshot = JSON.stringify(s);
  [s, s.lines, s.boxes, s.moves, s.movers, s.scores, s.claimed].forEach(x => assert.ok(Object.isFrozen(x)));
  D.play(s, 30);
  D.undo(s);
  D.undoLastBy(s, 0);
  D.LEVELS.forEach(level => D.cpuMove(s, level, lcg(2)));
  D.captureMoves(s);
  D.safeMoves(s);
  assert.equal(JSON.stringify(s), snapshot);
  assert.throws(() => { "use strict"; s.lines[3] = 1; }, TypeError);
  assert.ok(Object.isFrozen(D.lineInfo(4, 3)));
  assert.ok(Object.isFrozen(D.linesOfBox(4, 3)));
});

/* ---------- CPU ---------- */
test("dots CPU: every level always draws a legal line", () => {
  const list = positions(120, 7);
  D.LEVELS.forEach(level => list.forEach((s, i) => {
    const line = D.cpuMove(s, level, lcg(i + 1));
    assert.ok(D.canPlay(s, line), `${level} drew ${line}`);
  }));
  assert.throws(() => D.cpuMove(D.newGame(3), "oni"), /強さ/);
  [0.5, "random", null].forEach(bad => assert.throws(() => D.cpuMove(D.newGame(3), "easy", bad), /乱数/));
});

test("dots CPU: ふつう and つよい always take a free box; よわい only about half the time", () => {
  const s = D.fromMoves(3, [h(3, 0, 0), v(3, 0, 0), h(3, 1, 0)]);
  ["normal", "hard"].forEach(level => {
    for (let seed = 1; seed <= 8; seed++) assert.equal(D.cpuMove(s, level, lcg(seed)), v(3, 0, 1), level);
  });
  assert.equal(D.cpuMove(s, "easy", fixed(0.2)), v(3, 0, 1));
  const misses = Array.from({ length: 60 }, (_, i) => D.cpuMove(s, "easy", lcg(i * 2654435761))).filter(l => l !== v(3, 0, 1));
  assert.ok(misses.length > 15 && misses.length < 45, `easy skipped the box ${misses.length} times out of 60`);
});

test("dots CPU: ふつう never draws a third side while a safe line is left", () => {
  const list = positions(150, 31).filter(s => D.captureMoves(s).length === 0 && D.safeMoves(s).length > 0);
  assert.ok(list.length > 30);
  list.forEach((s, i) => {
    const line = D.cpuMove(s, "normal", lcg(i + 5));
    assert.ok(D.safeMoves(s).includes(line), `normal gave a box away with ${line}`);
  });
});

/* Exact value of every open line for the player to move (net boxes from here on), by plain search over all lines.
 * Only for small positions: the memo holds one entry per set of drawn lines. */
function exactValues(s) {
  const n = s.size;
  const boxLines = Array.from({ length: D.boxCount(n) }, (_, b) => D.linesOfBox(n, b));
  const touching = allLines(n).map(l => D.boxesOfLine(n, l));
  const memo = new Map();
  const has = (mask, l) => (mask >>> l) & 1;
  const gain = (mask, l) => touching[l].filter(b => boxLines[b].every(x => has(mask, x))).length;
  const after = (mask, l) => {
    const next = (mask | (1 << l)) >>> 0;
    const got = gain(next, l);
    return got > 0 ? got + value(next) : -value(next);
  };
  function value(mask) {
    if (memo.has(mask)) return memo.get(mask);
    const open = allLines(n).filter(l => !has(mask, l));
    const v = open.length ? Math.max(...open.map(l => after(mask, l))) : 0;
    memo.set(mask, v);
    return v;
  }
  const start = s.lines.reduce((m, owner, l) => (owner === null ? m : (m | (1 << l)) >>> 0), 0);
  return new Map(D.legalMoves(s).map(l => [l, after(start, l)]));
}

test("dots CPU: つよい plays perfectly once no safe line is left (checked by full search)", () => {
  const r = lcg(77);
  let checked = 0;
  for (let g = 0; g < 400 && checked < 60; g++) {
    let s = D.newGame(3);
    while (!D.isOver(s) && (D.safeMoves(s).length > 0 || D.legalMoves(s).length > 13)) {
      s = D.play(s, D.cpuMove(s, r() < 0.5 ? "normal" : "easy", r));
    }
    if (D.isOver(s)) continue;
    checked++;
    const values = exactValues(s);
    const best = Math.max(...values.values());
    const line = D.cpuMove(s, "hard", lcg(g));
    assert.equal(values.get(line), best, `moves ${JSON.stringify(s.moves)}: hard drew ${line}`);
  }
  assert.ok(checked >= 40, `only ${checked} endgames`);
});

test("dots CPU: つよい gives a box away when the last safe line would lose control", () => {
  /* 3x3, player 0 to move: the only safe line (16) leaves a junction whose short arm the opponent hands over,
   * after which the CPU must open a 6-box chain (net -5). Giving box 4 away now (17 or 18) nets +1. */
  const s = D.fromMoves(3, [21, 6, 4, 7, 14, 20, 9, 2, 23, 0, 22, 10, 12, 19]);
  assert.deepEqual(D.safeMoves(s), [16]);
  const values = exactValues(s);
  assert.equal(values.get(16), -5);
  assert.equal(Math.max(...values.values()), 1);
  for (let seed = 1; seed <= 6; seed++) {
    assert.ok([17, 18].includes(D.cpuMove(s, "hard", lcg(seed))), `seed ${seed}`);
    assert.equal(D.cpuMove(s, "normal", lcg(seed)), 16, "ふつう just plays the safe line");
  }
});

test("dots CPU: with no safe line, ふつう and つよい open the smallest chain", () => {
  /* 3x3: the top row is a 3-box chain, the bottom-left corner a 1-box chain, the rest is taken. */
  const s = leaving(3, [v(3, 0, 0), v(3, 0, 1), v(3, 0, 2), v(3, 0, 3), v(3, 2, 0), h(3, 3, 0)]);
  assert.deepEqual(D.safeMoves(s), []);
  ["normal", "hard"].forEach(level => {
    for (let seed = 1; seed <= 6; seed++) assert.ok([v(3, 2, 0), h(3, 3, 0)].includes(D.cpuMove(s, level, lcg(seed))), level);
  });
});

test("dots CPU: つよい opens a two-box chain in the middle so it cannot be declined", () => {
  /* 4x4: a 4-box chain on top, a 2-box chain in the bottom-left corner, everything else taken. */
  const s = leaving(4, [v(4, 0, 0), v(4, 0, 1), v(4, 0, 2), v(4, 0, 3), v(4, 0, 4), v(4, 3, 0), v(4, 3, 1), h(4, 4, 1)]);
  for (let seed = 1; seed <= 6; seed++) assert.equal(D.cpuMove(s, "hard", lcg(seed)), v(4, 3, 1));
});

test("dots CPU: つよい declines the last two boxes to keep control; ふつう takes everything", () => {
  /* 4x4: every horizontal line drawn, so each row is a 4-box chain. Player 0 opens the top row. */
  let s = D.play(D.fromMoves(4, allLines(4).slice(0, 20)), v(4, 0, 0));
  assert.equal(s.turn, 1);
  s = D.play(s, D.cpuMove(s, "hard", lcg(1)));
  s = D.play(s, D.cpuMove(s, "hard", lcg(1)));
  assert.deepEqual(s.scores, [0, 2]);
  assert.equal(D.cpuMove(s, "hard", lcg(1)), v(4, 0, 4), "draws the far end, leaving two boxes");
  assert.equal(D.cpuMove(s, "normal", lcg(1)), v(4, 0, 3));
  const declined = D.play(s, v(4, 0, 4));
  assert.equal(declined.turn, 0, "the opponent must take the two boxes and open the next row");
});

test("dots CPU: つよい takes all of the last chain", () => {
  const s = D.play(leaving(4, [v(4, 0, 0), v(4, 0, 1), v(4, 0, 2), v(4, 0, 3), v(4, 0, 4)]), v(4, 0, 0));
  let t = s;
  const taker = s.turn;
  while (!D.isOver(t)) {
    assert.equal(t.turn, taker);
    t = D.play(t, D.cpuMove(t, "hard", lcg(4)));
  }
  assert.equal(t.scores[taker] - s.scores[taker], 4);
});

test("dots CPU: つよい declines all four boxes of an opened loop when long chains remain", () => {
  /* 5x5: a 4-box loop in the top-left corner, three 5-box chains below, the rest taken. */
  const open = [v(5, 0, 1), v(5, 1, 1), h(5, 1, 0), h(5, 1, 1)];
  [2, 3, 4].forEach(r => [0, 1, 2, 3, 4, 5].forEach(c => open.push(v(5, r, c))));
  const s = D.play(leaving(5, open), h(5, 1, 0));
  assert.deepEqual(D.safeMoves(s), []);
  assert.equal(D.cpuMove(s, "hard", lcg(1)), h(5, 1, 1));
  assert.ok([v(5, 0, 1), v(5, 1, 1)].includes(D.cpuMove(s, "normal", lcg(1))));
  /* With nothing else left, the loop is simply eaten. */
  const lone = D.play(leaving(5, open.slice(0, 4)), h(5, 1, 0));
  assert.ok([v(5, 0, 1), v(5, 1, 1)].includes(D.cpuMove(lone, "hard", lcg(1))));
});

test("dots CPU: the levels are clearly different in strength", () => {
  const r = lcg(5);
  const score = (strong, weak, n, games) => Array.from({ length: games }, (_, i) => {
    const seat = i % 2;
    const end = playOut(n, seat === 0 ? [strong, weak] : [weak, strong], r);
    return end.draw ? "draw" : end.winner === seat ? "win" : "loss";
  });
  const count = (list, k) => list.filter(x => x === k).length;
  const normalVsEasy = score("normal", "easy", 4, 12);
  const hardVsNormal = score("hard", "normal", 4, 12);
  const hardVsNormal5 = score("hard", "normal", 5, 6);
  assert.ok(count(normalVsEasy, "win") >= 10, normalVsEasy.join(","));
  assert.ok(count(hardVsNormal, "win") >= 9, hardVsNormal.join(","));
  assert.ok(count(hardVsNormal5, "win") >= 4, hardVsNormal5.join(","));
});

/* Think time is measured as this process's CPU time, so other programs busy on the same machine do not count;
 * wall-clock time is logged next to it. */
test("dots CPU: つよい thinks under 150 ms in the worst case", () => {
  const list = positions(300, 99);
  list.slice(0, 40).forEach((s, i) => D.cpuMove(s, "hard", lcg(i)));
  let worstCpu = 0;
  let worstWall = 0;
  list.forEach((s, i) => {
    const c0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    D.cpuMove(s, "hard", lcg(i + 1));
    const c = process.cpuUsage(c0);
    worstWall = Math.max(worstWall, Number(process.hrtime.bigint() - t0) / 1e6);
    worstCpu = Math.max(worstCpu, (c.user + c.system) / 1000);
  });
  assert.ok(worstCpu < 150 * TIMING_SLACK, `worst ${worstCpu.toFixed(1)} ms`);
  console.log(`# dots hard CPU worst think time: ${worstCpu.toFixed(1)} ms CPU (${worstWall.toFixed(1)} ms wall) over ${list.length} positions`);
});

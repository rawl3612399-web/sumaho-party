const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/connect4-rules.js");
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1; // CI machines are slower; the deploy workflow raises this

/* Repeatable random sources. */
const fixed = (v) => () => v;
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/* A clock that never moves: つよい then always reads to its node cap, so seeded games repeat exactly
 * however busy the machine is. */
const stillClock = () => 0;
const moves = (text) => text.split("").map(Number);
const at = (s, col, row) => s.board[C.index(col, row)];

/* Positions reached by random and easy-CPU play, stopped before the game ends. */
function positions(count, seed) {
  const r = lcg(seed);
  return Array.from({ length: count }, (_, g) => {
    let s = C.newGame();
    const target = g % 36;
    for (let i = 0; i < target; i++) {
      const legal = C.legalMoves(s);
      const col = g % 2 ? C.cpuMove(s, "easy", r) : legal[Math.floor(r() * legal.length)];
      const next = C.play(s, col);
      if (C.isOver(next)) break;
      s = next;
    }
    return s;
  });
}

function playOut(levels, opening, r) {
  let s = C.fromMoves(opening);
  while (!C.isOver(s)) s = C.play(s, C.cpuMove(s, levels[s.turn], r, stillClock));
  return s;
}

/* ---------- moves ---------- */
test("connect4: a new game is empty and red moves first", () => {
  const s = C.newGame();
  assert.equal(s.board.length, 42);
  assert.ok(s.board.every(v => v === null));
  assert.equal(s.turn, 0);
  assert.deepEqual(C.legalMoves(s), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(s.winner, null);
  assert.equal(s.draw, false);
});

test("connect4: discs fall to the lowest empty cell and turns alternate", () => {
  const s = C.fromMoves([3, 3, 3]);
  assert.equal(at(s, 3, 0), 0);
  assert.equal(at(s, 3, 1), 1);
  assert.equal(at(s, 3, 2), 0);
  assert.equal(at(s, 3, 3), null);
  assert.deepEqual(s.heights, [0, 0, 0, 3, 0, 0, 0]);
  assert.deepEqual(s.last, { col: 3, row: 2 });
  assert.equal(s.turn, 1);
  assert.deepEqual(C.counts(s), [2, 1]);
});

test("connect4: full columns and bad column numbers are refused", () => {
  const s = C.fromMoves([0, 0, 0, 0, 0, 0]);
  assert.equal(C.canDrop(s, 0), false);
  assert.deepEqual(C.legalMoves(s), [1, 2, 3, 4, 5, 6]);
  assert.match(C.moveError(s, 0), /いっぱい/);
  assert.throws(() => C.play(s, 0), /いっぱい/);
  [-1, 7, 1.5, "3", null, undefined].forEach(col => {
    assert.equal(C.canDrop(s, col), false);
    assert.throws(() => C.play(s, col), /列の番号/);
  });
  assert.throws(() => C.play({}, 0), /盤面/);
  assert.throws(() => C.fromMoves("0123"), /手順/);
});

/* ---------- win and draw ---------- */
test("connect4: four in a row wins in every direction", () => {
  const cases = [
    ["0011223", [0, 1, 2, 3]],
    ["0101010", [0, 7, 14, 21]],
    ["01122323363", [0, 8, 16, 24]],
    ["32211010060", [3, 9, 15, 21]]
  ];
  cases.forEach(([seq, line]) => {
    const s = C.fromMoves(moves(seq));
    assert.equal(s.winner, 0, seq);
    assert.deepEqual([...s.line], line, seq);
    assert.equal(C.isOver(s), true);
    assert.deepEqual(C.legalMoves(s), []);
    assert.throws(() => C.play(s, 4), /勝負/);
  });
});

test("connect4: yellow can win too, and a long line is marked in full", () => {
  const y = C.fromMoves(moves("01010161"));
  assert.equal(y.winner, 1);
  assert.deepEqual([...y.line], [1, 8, 15, 22]);
  const six = C.fromMoves(moves("00114455263"));
  assert.equal(six.winner, 0);
  assert.deepEqual([...six.line], [0, 1, 2, 3, 4, 5]);
});

test("connect4: a full board without four is a draw", () => {
  const before = C.fromMoves(moves("60223020434300302361356415112216615565445"));
  assert.equal(before.draw, false);
  assert.equal(before.winner, null);
  const s = C.play(before, 4);
  assert.equal(s.draw, true);
  assert.equal(s.winner, null);
  assert.deepEqual([...s.line], []);
  assert.equal(C.isOver(s), true);
  assert.deepEqual(C.counts(s), [21, 21]);
  assert.throws(() => C.play(s, 0));
});

test("connect4: four made with the 42nd and last disc is a win, not a draw", () => {
  const s = C.fromMoves(moves("243126531322251630320044406605536464510151"));
  assert.equal(s.moves.length, 42);
  assert.equal(s.winner, 1);
  assert.equal(s.draw, false);
  assert.deepEqual([...s.line], [36, 37, 38, 39]);
  assert.deepEqual(C.lineKinds(s), ["row"]);
});

/* Regression: the result text used to call a single 5-long diagonal "一度に2方向". */
test("connect4: lineKinds names each direction of the winning line", () => {
  const longDiagonal = C.fromMoves(moves("100441113450220150140362"));
  assert.deepEqual([...longDiagonal.line], [4, 10, 16, 22, 28]);
  assert.deepEqual(C.lineKinds(longDiagonal), ["anti"]);
  assert.deepEqual(C.lineKinds(C.fromMoves(moves("0011223"))), ["row"]);
  assert.deepEqual(C.lineKinds(C.fromMoves(moves("0101010"))), ["col"]);
  assert.deepEqual(C.lineKinds(C.fromMoves(moves("01122323363"))), ["diag"]);
  const both = C.fromMoves(moves("26416126351301420464050"));
  assert.equal(both.winner, 0);
  assert.deepEqual(C.lineKinds(both), ["col", "anti"]);
  assert.deepEqual([...both.line], [0, 3, 7, 9, 14, 15, 21]);
  assert.deepEqual(C.lineKinds(C.fromMoves([3, 3])), []);
  assert.throws(() => C.lineKinds({}), /盤面/);
});

test("connect4: winningMoves finds the columns that make four right now", () => {
  const s = C.fromMoves(moves("232"));
  assert.deepEqual(C.winningMoves(s, 0), []);
  const t = C.fromMoves(moves("22334"));
  assert.deepEqual(C.winningMoves(t, 0), [1, 5]);
  assert.deepEqual(C.winningMoves(t, 1), []);
  assert.throws(() => C.winningMoves(t, 2), /プレイヤー/);
});

/* ---------- undo and immutability ---------- */
test("connect4: undo takes back moves by replaying the rest", () => {
  const s = C.fromMoves([3, 2, 4, 4]);
  assert.deepEqual(C.undo(s, 1), C.fromMoves([3, 2, 4]));
  assert.deepEqual(C.undo(s, 2), C.fromMoves([3, 2]));
  assert.deepEqual(C.undo(s, 4), C.newGame());
  assert.throws(() => C.undo(s, 5), /もどせる/);
  assert.throws(() => C.undo(s, 0), /もどせる/);
  const won = C.fromMoves(moves("0011223"));
  assert.equal(C.undo(won, 1).winner, null);
});

test("connect4: states are frozen and never changed by play, undo or the CPU", () => {
  const s = C.fromMoves([3, 3, 2]);
  const snapshot = JSON.stringify(s);
  [s, s.board, s.heights, s.moves, s.line, s.last].forEach(part => assert.ok(Object.isFrozen(part)));
  C.play(s, 4);
  C.undo(s, 1);
  C.LEVELS.forEach(level => C.cpuMove(s, level, lcg(1)));
  assert.equal(JSON.stringify(s), snapshot);
  assert.throws(() => { "use strict"; s.board[0] = 1; });
});

/* ---------- CPU ---------- */
test("connect4 CPU: always returns a legal column", () => {
  positions(60, 7).forEach(s => {
    C.LEVELS.forEach(level => {
      const col = C.cpuMove(s, level, lcg(s.moves.length + 1));
      assert.ok(C.canDrop(s, col), `${level} at ${s.moves.join("")} -> ${col}`);
    });
  });
});

test("connect4 CPU: refuses bad input", () => {
  assert.throws(() => C.cpuMove(C.newGame(), "oni"), /CPUの強さ/);
  assert.throws(() => C.cpuMove(C.fromMoves(moves("0011223")), "hard"), /勝負/);
  assert.throws(() => C.cpuMove(null, "easy"), /盤面/);
  assert.throws(() => C.cpuMove(C.newGame(), "hard", 0.5), /設定/);
  assert.throws(() => C.cpuMove(C.newGame(), "hard", Math.random, 0), /設定/);
});

test("connect4 CPU: つよい stops reading deeper when time runs out, but still plays well", () => {
  let now = 0;
  const lateClock = () => (now += 1000); /* every look at the clock is a second later */
  positions(36, 400).forEach((s, i) => assert.ok(C.canDrop(s, C.cpuMove(s, "hard", lcg(i + 1), lateClock))));
  const s = C.fromMoves(moves("2636"));
  for (let seed = 1; seed <= 4; seed++) assert.ok([1, 4].includes(C.cpuMove(s, "hard", lcg(seed), lateClock)));
  assert.notEqual(C.cpuMove(C.fromMoves(moves("01206152")), "hard", lcg(1), lateClock), 3);
});

test("connect4 CPU: every level takes an immediate win, even over blocking", () => {
  const s = C.fromMoves(moves("010101"));
  C.LEVELS.forEach(level => {
    [0, 0.3, 0.6, 0.99].forEach(v => assert.equal(C.cpuMove(s, level, fixed(v)), 0, level));
  });
  const y = C.fromMoves(moves("1010106"));
  C.LEVELS.forEach(level => assert.equal(C.cpuMove(y, level, fixed(0.7)), 0, level));
});

test("connect4 CPU: ふつう and つよい always block an immediate loss", () => {
  const s = C.fromMoves(moves("06060"));
  ["normal", "hard"].forEach(level => {
    [0, 0.5, 0.99].forEach(v => assert.equal(C.cpuMove(s, level, fixed(v)), 0, level));
  });
  const row = C.fromMoves(moves("06162"));
  ["normal", "hard"].forEach(level => assert.equal(C.cpuMove(row, level, lcg(3)), 3, level));
});

test("connect4 CPU: よわい blocks only half the time", () => {
  const s = C.fromMoves(moves("06060"));
  assert.equal(C.cpuMove(s, "easy", fixed(0.2)), 0);
  const misses = Array.from({ length: 40 }, (_, i) => C.cpuMove(s, "easy", lcg(i * 2654435761))).filter(c => c !== 0);
  assert.ok(misses.length > 5, `easy missed the block ${misses.length} times out of 40`);
});

test("connect4 CPU: ふつう and つよい do not play under the opponent's winning cell", () => {
  const s = C.fromMoves(moves("01206152"));
  assert.deepEqual(C.winningMoves(s, 1), []);
  ["normal", "hard"].forEach(level => {
    for (let seed = 1; seed <= 8; seed++) assert.notEqual(C.cpuMove(s, level, lcg(seed)), 3, level);
  });
});

test("connect4 CPU: ふつう and つよい set up an unstoppable double threat", () => {
  const s = C.fromMoves(moves("2636"));
  ["normal", "hard"].forEach(level => {
    for (let seed = 1; seed <= 6; seed++) assert.ok([1, 4].includes(C.cpuMove(s, level, lcg(seed), stillClock)), level);
  });
});

test("connect4 CPU: the levels are clearly different in strength", () => {
  const r = lcg(5);
  const openings = [[], [3], [2, 4], [0, 6], [3, 3], [1, 5]];
  const score = (strong, weak) => openings.reduce((acc, opening, i) => {
    const strongSeat = i % 2;
    const levels = strongSeat === 0 ? [strong, weak] : [weak, strong];
    const end = playOut(levels, opening, r);
    if (end.draw) return { ...acc, draws: acc.draws + 1 };
    return end.winner === strongSeat ? { ...acc, wins: acc.wins + 1 } : { ...acc, losses: acc.losses + 1 };
  }, { wins: 0, losses: 0, draws: 0 });
  const normalVsEasy = score("normal", "easy");
  const hardVsEasy = score("hard", "easy");
  const hardVsNormal = score("hard", "normal");
  assert.ok(normalVsEasy.wins >= 5, JSON.stringify(normalVsEasy));
  assert.ok(hardVsEasy.wins >= 5, JSON.stringify(hardVsEasy));
  assert.ok(hardVsNormal.wins > hardVsNormal.losses, JSON.stringify(hardVsNormal));
});

/* The time this process spends computing (process.cpuUsage), so other programs busy on the same machine do not
 * count. A slow position is measured up to three times and its fastest run kept: a real slowdown repeats. */
function thinkMs(s, level, seed) {
  let best = { cpu: Infinity, wall: Infinity };
  for (let tries = 0; tries < 3 && best.cpu >= 50; tries++) {
    const c0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    C.cpuMove(s, level, lcg(seed));
    const used = process.cpuUsage(c0);
    const run = { cpu: (used.user + used.system) / 1000, wall: Number(process.hrtime.bigint() - t0) / 1e6 };
    if (run.cpu < best.cpu) best = run;
  }
  return best;
}

test("connect4 CPU: つよい thinks under 150 ms in the worst case", () => {
  const list = positions(150, 99);
  C.cpuMove(list[10], "hard", lcg(1));
  const worst = list.reduce((max, s, i) => {
    const t = thinkMs(s, "hard", i + 1);
    return { cpu: Math.max(max.cpu, t.cpu), wall: Math.max(max.wall, t.wall) };
  }, { cpu: 0, wall: 0 });
  assert.ok(worst.cpu < 150 * TIMING_SLACK, `worst ${worst.cpu.toFixed(1)} ms`);
  console.log(`# connect4 hard CPU worst think time: ${worst.cpu.toFixed(1)} ms of CPU (${worst.wall.toFixed(1)} ms wall) over ${list.length} positions`);
});

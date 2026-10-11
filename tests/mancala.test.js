const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/mancala-rules.js");
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1; // CI machines are slower; the deploy workflow raises this

/* Repeatable random source (linear congruential). */
function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/* A state from a hand-made board: pits 0-5 = player 0 (bottom), 6 = store 0, 7-12 = player 1 (top), 13 = store 1. */
const board = (pits, turn = 0) => ({ pits, turn, first: 0, seeds: 4, over: false, winner: null, moves: 0, last: null });
const total = (s) => s.pits.reduce((a, b) => a + b, 0);

function randomPosition(r, maxPlies = 40) {
  let s = M.newGame(r() < 0.5 ? 3 : 4, r() < 0.5 ? 0 : 1);
  const plies = Math.floor(r() * maxPlies);
  for (let k = 0; k < plies && !s.over; k++) {
    const moves = M.legalMoves(s);
    s = M.move(s, moves[Math.floor(r() * moves.length)]);
  }
  return s;
}

/* ---------- setup and legality ---------- */
test("mancala: new game puts the same stones in every pit and empty stores", () => {
  const g = M.newGame(4, 1);
  assert.deepEqual(g.pits, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(g.turn, 1);
  assert.equal(g.over, false);
  assert.deepEqual(M.newGame(3).pits.filter((_, i) => i !== 6 && i !== 13), Array(12).fill(3));
  assert.equal(M.newGame().seeds, 4);
  assert.throws(() => M.newGame(5), /石の数/);
  assert.throws(() => M.newGame(4, 2), /先攻/);
});

test("mancala: only your own non-empty pits are legal", () => {
  const g = M.newGame(4, 0);
  assert.deepEqual(M.legalMoves(g), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(M.legalMoves({ ...g, turn: 1 }), [7, 8, 9, 10, 11, 12]);
  const s = board([0, 3, 0, 0, 0, 1, 5, 2, 0, 0, 0, 0, 4, 9]);
  assert.deepEqual(M.legalMoves(s), [1, 5]);
  assert.equal(M.isLegal(s, 0), false, "empty pit");
  assert.equal(M.isLegal(s, 7), false, "other side");
  assert.equal(M.isLegal(s, 6), false, "store");
  assert.equal(M.isLegal(s, 1.5), false, "not an index");
  assert.throws(() => M.move(s, 0), /選べません/);
  assert.throws(() => M.move(s, 7), /選べません/);
  assert.throws(() => M.move(s, 6), /選べません/);
  assert.throws(() => M.move(s, -1), /選べません/);
  assert.throws(() => M.move(s, "1"), /選べません/);
});

test("mancala: broken states are rejected", () => {
  assert.throws(() => M.move(null, 0), /盤面/);
  assert.throws(() => M.move(board([4, 4, 4]), 0), /盤面/);
  assert.throws(() => M.move(board([4, -1, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]), 0), /盤面/);
  assert.throws(() => M.move(board(M.newGame().pits, 2), 0), /盤面/);
  assert.throws(() => M.cpuMove(board([4, 4]), "hard"), /盤面/);
});

/* ---------- sowing ---------- */
test("mancala: sowing goes counter-clockwise one stone per pit and passes the turn", () => {
  const g = M.move(M.newGame(4, 0), 0);
  assert.deepEqual(g.pits, [0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(g.turn, 1);
  assert.deepEqual(g.last.path, [1, 2, 3, 4]);
  assert.equal(g.last.count, 4);
  assert.equal(g.last.extra, false);
  assert.equal(g.moves, 1);
  const h = M.move(g, 12);
  assert.deepEqual(h.last.path, [13, 0, 1, 2], "player 2 sows from the top row into their store, then the bottom row");
  assert.equal(h.pits[13], 1);
  assert.equal(h.pits[0], 1);
});

test("mancala: the opponent's store is skipped, your own store is not", () => {
  const s0 = board([0, 0, 1, 0, 0, 10, 0, 1, 1, 1, 1, 1, 1, 0]);
  const g0 = M.move(s0, 5);
  assert.deepEqual(g0.last.path, [6, 7, 8, 9, 10, 11, 12, 0, 1, 2]);
  assert.equal(g0.pits[13], 0);
  assert.equal(g0.pits[6], 1);
  const s1 = board([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 10, 0], 1);
  const g1 = M.move(s1, 12);
  assert.deepEqual(g1.last.path, [13, 0, 1, 2, 3, 4, 5, 7, 8, 9]);
  assert.equal(g1.pits[6], 0);
});

test("mancala: last stone in your own store gives another turn", () => {
  const g = M.move(M.newGame(4, 0), 2);
  assert.deepEqual(g.last.path, [3, 4, 5, 6]);
  assert.equal(g.last.extra, true);
  assert.equal(g.turn, 0);
  const h = M.move({ ...M.newGame(3, 1) }, 10);
  assert.equal(h.last.extra, true);
  assert.equal(h.turn, 1);
});

/* ---------- captures ---------- */
test("mancala: landing in your own empty pit captures the pit across", () => {
  const s = board([0, 2, 0, 0, 1, 1, 3, 1, 1, 5, 1, 1, 1, 4]);
  const g = M.move(s, 1);
  assert.deepEqual(g.last.capture, { pit: 3, opposite: 9, count: 6 });
  assert.equal(g.pits[3], 0);
  assert.equal(g.pits[9], 0);
  assert.equal(g.pits[6], 9);
  assert.equal(g.turn, 1);
  assert.equal(total(g), total(s), "no stones are lost");
});

test("mancala: no capture when the pit across is empty, or on the other side", () => {
  const empty = M.move(board([0, 2, 0, 0, 1, 1, 3, 1, 1, 0, 1, 1, 1, 4]), 1);
  assert.equal(empty.last.capture, null);
  assert.equal(empty.pits[3], 1);
  const theirs = M.move(board([1, 0, 0, 0, 0, 3, 3, 1, 0, 1, 1, 1, 1, 4]), 5);
  assert.equal(theirs.last.end, 8);
  assert.equal(theirs.last.capture, null, "landing in an empty pit on the other side never captures");
  const top = M.move(board([1, 1, 7, 1, 1, 1, 0, 1, 1, 0, 2, 1, 1, 0], 1), 8);
  assert.deepEqual(top.last.capture, { pit: 9, opposite: 3, count: 2 });
  assert.equal(top.pits[13], 2);
});

test("mancala: a full lap of 13 stones lands back in the start pit and captures", () => {
  const s = board([13, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 2, 0]);
  const g = M.move(s, 0);
  assert.equal(g.last.path.length, 13);
  assert.equal(g.last.end, 0);
  assert.deepEqual(g.last.capture, { pit: 0, opposite: 12, count: 4 });
  assert.equal(g.pits[6], 5);
  assert.equal(g.pits[13], 0);
});

test("mancala: long sowings lap the board, skip the other store every time and can still end in your store", () => {
  /* 19 = 5 pits + store + 6 pits + 6 pits + store: the last stone is the second one into your own store. */
  const g = M.move(board([19, 1, 1, 1, 1, 1, 0, 2, 2, 2, 2, 2, 2, 0]), 0);
  assert.deepEqual([...g.pits], [1, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 0]);
  assert.equal(g.last.extra, true);
  assert.equal(g.turn, 0);
  const two = M.move(board([32, 1, 1, 1, 1, 1, 0, 2, 2, 2, 2, 2, 2, 0]), 0);
  assert.equal(two.last.path.includes(13), false, "the other store is never sown into");
  assert.equal(two.last.end, 6);
  assert.equal(two.last.extra, true);
  const top = M.move(board([2, 2, 2, 2, 2, 2, 0, 19, 1, 1, 1, 1, 1, 0], 1), 7);
  assert.equal(top.last.end, 13);
  assert.equal(top.pits[6], 0);
  assert.equal(top.turn, 1);
  assert.equal(total(top), total(board([2, 2, 2, 2, 2, 2, 0, 19, 1, 1, 1, 1, 1, 0])));
});

/* ---------- end of game ---------- */
test("mancala: when one side is empty the other side keeps its stones and the bigger store wins", () => {
  const s = board([0, 0, 0, 0, 0, 1, 20, 2, 3, 0, 0, 1, 0, 21]);
  const g = M.move(s, 5);
  assert.equal(g.over, true);
  assert.equal(g.last.extra, false, "no extra turn once the game is over");
  assert.deepEqual(g.last.sweep, [0, 6]);
  assert.deepEqual(M.scores(g), [21, 27]);
  assert.equal(g.winner, 1);
  assert.deepEqual(M.legalMoves(g), []);
  assert.throws(() => M.move(g, 7), /決着/);
  assert.throws(() => M.cpuMove(g, "easy"), /動かせる/);
});

test("mancala: emptying the opponent's side also ends the game", () => {
  /* Pit 1 lands in empty pit 2 and captures pit 10, the last stones on the top row. */
  const g = M.move(board([0, 1, 0, 0, 0, 0, 10, 0, 0, 0, 4, 0, 0, 11]), 1);
  assert.deepEqual(g.last.capture, { pit: 2, opposite: 10, count: 5 });
  assert.equal(g.over, true);
  assert.deepEqual(g.last.sweep, [0, 0]);
  assert.deepEqual(M.scores(g), [15, 11]);
  assert.equal(g.winner, 0);
});

test("mancala: a capture that empties your own row ends the game, and the other row goes to its owner", () => {
  /* Pit 1 is the last stone on the bottom row; it lands in empty pit 2 and captures pit 10. */
  const g = M.move(board([0, 1, 0, 0, 0, 0, 10, 0, 0, 3, 4, 2, 0, 9]), 1);
  assert.deepEqual(g.last.capture, { pit: 2, opposite: 10, count: 5 });
  assert.equal(g.over, true);
  assert.deepEqual(g.last.sweep, [0, 5]);
  assert.deepEqual(M.scores(g), [15, 14]);
  assert.equal(g.winner, 0, "the game is won on the last move");
});

test("mancala: equal stores is a draw", () => {
  const g = M.move(board([0, 0, 0, 0, 0, 1, 23, 0, 0, 0, 0, 0, 1, 23]), 5);
  assert.equal(g.over, true);
  assert.deepEqual(M.scores(g), [24, 24]);
  assert.equal(g.winner, null);
});

/* ---------- immutability ---------- */
test("mancala: moves and the CPU never change the state they were given", () => {
  const g = M.newGame(4, 0);
  const snapshot = JSON.stringify(g);
  const next = M.move(g, 2);
  assert.equal(JSON.stringify(g), snapshot);
  assert.notEqual(next.pits, g.pits);
  assert.ok(Object.isFrozen(g) && Object.isFrozen(g.pits));
  assert.ok(Object.isFrozen(next) && Object.isFrozen(next.pits) && Object.isFrozen(next.last.path));
  const plain = board([0, 2, 0, 0, 1, 1, 3, 1, 1, 5, 1, 1, 1, 4]);
  const before = JSON.stringify(plain);
  M.move(plain, 1);
  M.LEVELS.forEach(level => M.cpuMove({ ...plain, turn: 1 }, level, lcg(1)));
  assert.equal(JSON.stringify(plain), before);
});

test("mancala: random games always keep every stone and end with a full count", () => {
  const r = lcg(42);
  for (let n = 0; n < 200; n++) {
    let s = M.newGame(n % 2 ? 3 : 4, n % 3 ? 0 : 1);
    const stones = total(s);
    while (!s.over) {
      const moves = M.legalMoves(s);
      s = M.move(s, moves[Math.floor(r() * moves.length)]);
      assert.equal(total(s), stones);
    }
    assert.equal(s.pits[6] + s.pits[13], stones, "every stone ends in a store");
  }
});

/* ---------- CPU ---------- */
test("mancala cpu: always returns a legal move at every level", () => {
  const r = lcg(7);
  for (let n = 0; n < 120; n++) {
    const s = randomPosition(r);
    if (s.over) continue;
    M.LEVELS.forEach(level => assert.ok(M.isLegal(s, M.cpuMove(s, level, r)), `${level} at ${s.pits}`));
  }
  assert.throws(() => M.cpuMove(M.newGame(), "oni"), /強さ/);
});

test("mancala cpu: every level takes a move that wins on the spot", () => {
  /* Top row to move. Pit 8 lands in empty pit 9 and captures pit 3: the bottom row is then empty and the game ends. */
  const s = board([0, 0, 0, 5, 0, 0, 20, 0, 1, 0, 2, 3, 1, 14], 1);
  const win = M.move(s, 8);
  assert.equal(win.over, true);
  assert.equal(win.winner, 1);
  M.LEVELS.forEach(level => {
    for (let k = 0; k < 10; k++) assert.equal(M.cpuMove(s, level, lcg(k)), 8, level);
  });
  /* A capture that puts more than half of all stones in the store decides the game too. */
  const big = board([2, 1, 0, 10, 1, 2, 10, 0, 1, 0, 2, 3, 1, 15], 1);
  M.LEVELS.forEach(level => assert.equal(M.cpuMove(big, level, lcg(3)), 8, level));
});

/* True when the side to move (the CPU) can finish its turn without letting the opponent win with one move. */
function safeTurn(s, cpu) {
  if (s.over) return s.winner !== 1 - cpu;
  if (s.pits[M.STORES[cpu]] * 2 > total(s)) return true;
  if (s.turn === cpu) return M.legalMoves(s).some(m => safeTurn(M.move(s, m), cpu));
  return M.legalMoves(s).every(m => {
    const t = M.move(s, m);
    return !(t.over && t.winner === 1 - cpu) && !(t.pits[M.STORES[1 - cpu]] * 2 > total(t));
  });
}

test("mancala cpu: ふつう and つよい stop a capture that would lose the game", () => {
  /* Bottom threatens pit 1 -> empty pit 3, capturing the 12 stones in pit 9. Moving pit 9 away is safe. */
  const s = board([0, 2, 1, 0, 1, 1, 15, 1, 1, 12, 0, 1, 1, 10], 1);
  const safe = M.legalMoves(s).filter(m => safeTurn(M.move(s, m), 1));
  assert.ok(safe.includes(9));
  assert.ok(!safe.includes(7) && !safe.includes(11), "doing nothing loses");
  ["normal", "hard"].forEach(level => {
    for (let k = 0; k < 10; k++) assert.ok(safe.includes(M.cpuMove(s, level, lcg(k))), level);
  });
});

test("mancala cpu: ふつう and つよい never allow an immediate loss when a safe move exists", (t) => {
  const r = lcg(2024);
  let checked = 0;
  for (let n = 0; n < 4000 && checked < 40; n++) {
    const s = randomPosition(r, 60);
    if (s.over) continue;
    const cpu = s.turn;
    const verdicts = M.legalMoves(s).map(m => safeTurn(M.move(s, m), cpu));
    if (verdicts.every(Boolean) || !verdicts.some(Boolean)) continue;
    const safe = M.legalMoves(s).filter((_, i) => verdicts[i]);
    ["normal", "hard"].forEach(level => assert.ok(safe.includes(M.cpuMove(s, level, r)), `${level} at ${s.pits}`));
    checked += 1;
  }
  t.diagnostic(`checked ${checked} positions with both safe and losing moves`);
  assert.ok(checked >= 10, `found ${checked} test positions`);
});

test("mancala cpu: extra turns are searched as the same player's moves", () => {
  /* Playing pit 12 first (into the store) keeps the turn, then pit 11 lands in the store again. Pit 11 first wastes it. */
  const s = board([2, 2, 2, 2, 2, 2, 8, 3, 0, 0, 0, 2, 1, 8], 1);
  ["normal", "hard"].forEach(level => assert.equal(M.cpuMove(s, level, lcg(5)), 12, level));
});

test("mancala cpu: levels are clearly different in strength", () => {
  const r = lcg(9);
  const play = (a, b, first) => {
    let s = M.newGame(4, first);
    const levels = [a, b];
    while (!s.over) s = M.move(s, M.cpuMove(s, levels[s.turn], r));
    return s.winner;
  };
  const wins = (a, b) => Array.from({ length: 10 }, (_, i) => play(a, b, i % 2)).filter(w => w === 0).length;
  assert.ok(wins("normal", "easy") >= 8, "ふつう beats よわい");
  assert.ok(wins("hard", "normal") >= 6, "つよい beats ふつう");
  assert.ok(wins("hard", "easy") >= 9, "つよい beats よわい");
});

/* Regression: the search past depth 8 used a 50,000-node budget, which left too little margin for phones.
 * Time is measured as this process's CPU time, so other work on the machine does not make the test flaky. */
test("mancala cpu: つよい thinks in under 150 ms in the worst case", (t) => {
  const r = lcg(31);
  const positions = [M.newGame(3, 0), M.newGame(4, 0), M.newGame(3, 1), M.newGame(4, 1)];
  while (positions.length < 300) {
    const s = randomPosition(r, 60);
    if (!s.over) positions.push(s);
  }
  let g = M.newGame(4, 0);
  while (!g.over) {
    positions.push(g);
    g = M.move(g, M.cpuMove(g, "hard", r));
  }
  M.cpuMove(positions[0], "hard", r);
  let worst = 0;
  positions.forEach(s => {
    const start = process.cpuUsage();
    const m = M.cpuMove(s, "hard", r);
    const used = process.cpuUsage(start);
    worst = Math.max(worst, (used.user + used.system) / 1000);
    assert.ok(M.isLegal(s, m));
  });
  t.diagnostic(`worst ${worst.toFixed(1)} ms of CPU time over ${positions.length} positions`);
  assert.ok(worst < 150 * TIMING_SLACK, `worst ${worst.toFixed(1)} ms`);
});

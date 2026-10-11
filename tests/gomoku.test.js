const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/gomoku-rules.js");
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1; // CI machines are slower; the deploy workflow raises this

const { BLACK, WHITE, EMPTY, SIZE, CELLS } = G;
const P = (r, c) => r * SIZE + c;

/* Repeatable random source (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deepFreeze(o) {
  Object.values(o).forEach(v => { if (v && typeof v === "object") deepFreeze(v); });
  return Object.freeze(o);
}
/* A position from stone lists. Moves are interleaved black/white, so black needs as many stones as white
 * (black to move) or one more (white to move). */
function position(blacks, whites) {
  assert.ok(blacks.length === whites.length || blacks.length === whites.length + 1, "stone counts");
  const moves = blacks.flatMap((b, k) => (k < whites.length ? [P(...b), P(...whites[k])] : [P(...b)]));
  return G.fromMoves(moves);
}
/* Far-away white stones that make no shape, to balance stone counts. */
const FILLER = [[0, 0], [0, 14], [14, 0], [14, 14], [0, 7], [14, 7], [7, 0], [7, 14]];

/* ---------- moves ---------- */
test("gomoku: new game is an empty 15x15 board, black first", () => {
  const g = G.newGame();
  assert.equal(g.board.length, 225);
  assert.ok(g.board.every(v => v === EMPTY));
  assert.equal(g.turn, BLACK);
  assert.equal(g.over, false);
});

test("gomoku: play places a stone, passes the turn and never changes the old state", () => {
  const g0 = deepFreeze(G.newGame());
  const g1 = G.play(g0, G.CENTER);
  assert.equal(g1.board[G.CENTER], BLACK);
  assert.equal(g1.turn, WHITE);
  assert.deepEqual(g1.moves, [G.CENTER]);
  assert.equal(g0.board[G.CENTER], EMPTY);
  assert.deepEqual(g0.moves, []);
  const g2 = G.play(g1, P(6, 6));
  assert.equal(g2.board[P(6, 6)], WHITE);
  assert.equal(g2.turn, BLACK);
  assert.equal(G.lastMove(g2), P(6, 6));
  assert.deepEqual(G.counts(g2), { black: 1, white: 1 });
});

test("gomoku: occupied points, off-board points and finished games are refused", () => {
  const g = G.play(G.newGame(), G.CENTER);
  assert.throws(() => G.play(g, G.CENTER), /石があります/);
  [-1, CELLS, 3.5, "7", null].forEach(i => assert.throws(() => G.play(g, i), /盤の外/));
  assert.equal(G.isLegal(g, G.CENTER), false);
  assert.equal(G.isLegal(g, 0), true);
  const won = position([[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]], [[0, 0], [0, 2], [0, 4], [0, 6]]);
  assert.equal(won.over, true);
  assert.throws(() => G.play(won, P(10, 10)), /決着/);
  assert.throws(() => G.play({ board: [] }, 0), /盤面/);
});

/* ---------- win and draw ---------- */
test("gomoku: five in a row wins in every direction", () => {
  const lines = [
    [[2, 2], [2, 3], [2, 4], [2, 5], [2, 6]],
    [[2, 9], [3, 9], [4, 9], [5, 9], [6, 9]],
    [[6, 2], [7, 3], [8, 4], [9, 5], [10, 6]],
    [[6, 13], [7, 12], [8, 11], [9, 10], [10, 9]]
  ];
  lines.forEach(line => {
    const g = position(line, [[14, 0], [14, 2], [14, 4], [14, 6]]);
    assert.equal(g.winner, BLACK);
    assert.equal(g.over, true);
    assert.deepEqual(g.line, line.map(rc => P(...rc)).sort((a, b) => a - b));
  });
  const four = position([[2, 2], [2, 3], [2, 4], [2, 5]], [[14, 0], [14, 2], [14, 4]]);
  assert.equal(four.over, false);
});

test("gomoku: free rule - an overline of six wins, and a five blocked at both ends still wins", () => {
  const six = position([[7, 1], [7, 2], [7, 3], [7, 5], [7, 6], [7, 4]], [[0, 0], [0, 2], [0, 4], [0, 6], [0, 8]]);
  assert.equal(six.winner, BLACK);
  assert.equal(six.line.length, 6);
  const blocked = position([[7, 2], [7, 8], [0, 0], [0, 2], [0, 4]], [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]]);
  assert.equal(blocked.winner, WHITE);
  assert.equal(blocked.line.length, 5);
});

test("gomoku: a full board with no five is a draw", () => {
  const color = (r, c) => ((Math.floor(c / 2) + r) % 2 === 0 ? BLACK : WHITE);
  const cells = Array.from({ length: CELLS }, (_, i) => i);
  const blacks = cells.filter(i => color(Math.floor(i / SIZE), i % SIZE) === BLACK);
  const whites = cells.filter(i => color(Math.floor(i / SIZE), i % SIZE) === WHITE);
  assert.equal(blacks.length, 113);
  const moves = blacks.flatMap((b, k) => (k < whites.length ? [b, whites[k]] : [b]));
  const g = G.fromMoves(moves);
  assert.equal(g.draw, true);
  assert.equal(g.over, true);
  assert.equal(g.winner, EMPTY);
  assert.throws(() => G.cpuMove(g, "hard"), /決着/);
});

test("gomoku: lines never wrap around the board edge", () => {
  // Index-consecutive cells that cross from one row to the next are not a line.
  const across = position([[0, 12], [0, 13], [0, 14], [1, 0], [1, 1]], [[14, 0], [14, 2], [14, 4], [14, 6]]);
  assert.equal(across.over, false);
  const diag = position([[0, 13], [1, 14], [3, 0], [4, 1], [5, 2]], [[14, 0], [14, 2], [14, 4], [14, 6]]);
  assert.equal(diag.over, false);
  const anti = position([[0, 1], [1, 0], [1, 14], [2, 13], [3, 12]], [[14, 0], [14, 2], [14, 4], [14, 6]]);
  assert.equal(anti.over, false);
  // Lines that end on the edge and in the corner do count.
  const corner = position([[10, 10], [11, 11], [12, 12], [13, 13], [14, 14]], [[0, 0], [0, 2], [0, 4], [0, 6]]);
  assert.equal(corner.winner, BLACK);
  const side = position([[0, 14], [1, 13], [2, 12], [3, 11], [4, 10]], [[14, 0], [14, 2], [14, 4], [14, 6]]);
  assert.equal(side.winner, BLACK);
});

test("gomoku: a five made with the 225th stone is a win, not a draw", () => {
  // The draw pattern from above, changed so the last empty point (0,4) finishes an overline (0,0)-(0,5).
  const color = (r, c) => ((Math.floor(c / 2) + r) % 2 === 0 ? BLACK : WHITE);
  const b = Array.from({ length: CELLS }, (_, i) => color(Math.floor(i / SIZE), i % SIZE));
  [P(0, 2), P(0, 3)].forEach(i => { b[i] = BLACK; });
  [P(3, 2), P(3, 6)].forEach(i => { b[i] = WHITE; });
  const last = P(0, 4);
  const blacks = b.map((v, i) => (v === BLACK && i !== last ? i : -1)).filter(i => i >= 0);
  const whites = b.map((v, i) => (v === WHITE ? i : -1)).filter(i => i >= 0);
  assert.equal(blacks.length, 112);
  assert.equal(whites.length, 112);
  const before = G.fromMoves(blacks.flatMap((x, k) => [x, whites[k]]));
  assert.equal(before.over, false);
  G.LEVELS.forEach(level => assert.equal(G.cpuMove(before, level, rng(1)), last, `${level} plays the only point`));
  const g = G.play(before, last);
  assert.equal(g.moves.length, CELLS);
  assert.equal(g.winner, BLACK);
  assert.equal(g.draw, false);
  assert.equal(g.over, true);
  assert.deepEqual(g.line, [0, 1, 2, 3, 4, 5].map(c => P(0, c)));
});

/* ---------- undo and resign ---------- */
test("gomoku: undoTurn takes moves back to that player's turn", () => {
  const g = G.fromMoves([P(7, 7), P(6, 6), P(7, 8), P(6, 7)]);
  const forBlack = G.undoTurn(g, BLACK);
  assert.deepEqual(forBlack.moves, [P(7, 7), P(6, 6)]);
  assert.equal(forBlack.turn, BLACK);
  const forWhite = G.undoTurn(g, WHITE);
  assert.deepEqual(forWhite.moves, [P(7, 7), P(6, 6), P(7, 8)]);
  assert.equal(forWhite.turn, WHITE);
  assert.equal(g.moves.length, 4, "original kept");
  const one = G.fromMoves([P(7, 7)]);
  assert.equal(G.undoTurn(one, WHITE), one, "nothing to take back");
  const won = position([[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]], [[0, 0], [0, 2], [0, 4], [0, 6]]);
  const reopened = G.undoTurn(won, BLACK);
  assert.equal(reopened.over, false);
  assert.equal(reopened.turn, BLACK);
});

test("gomoku: resigning gives the win to the other color", () => {
  const g = G.fromMoves([P(7, 7)]);
  const r = G.resign(g, WHITE);
  assert.equal(r.over, true);
  assert.equal(r.winner, BLACK);
  assert.equal(r.resigned, WHITE);
  assert.equal(g.over, false);
  assert.throws(() => G.resign(r, BLACK), /決着/);
  assert.throws(() => G.resign(g, 3), /色/);
});

/* ---------- shapes and threats ---------- */
test("gomoku: line shapes - open/broken/closed threes, fours, open fours, fives", () => {
  const board = (blacks, whites = []) => {
    const b = Array(CELLS).fill(EMPTY);
    blacks.forEach(rc => { b[P(...rc)] = BLACK; });
    whites.forEach(rc => { b[P(...rc)] = WHITE; });
    return b;
  };
  const across = (b, rc) => G.shapesAt(b, P(...rc), BLACK)[0];
  assert.equal(across(board([[7, 6], [7, 7]]), [7, 8]), "three");
  assert.equal(across(board([[7, 5], [7, 7]]), [7, 8]), "three", "broken three");
  assert.equal(across(board([[7, 5], [7, 6]], [[7, 4]]), [7, 7]), "closed3");
  assert.equal(across(board([[7, 5], [7, 6]], [[7, 3], [7, 9]]), [7, 7]), "closed3", "no room for an open four");
  assert.equal(across(board([[7, 5], [7, 6], [7, 7]], [[7, 4]]), [7, 8]), "four");
  assert.equal(across(board([[7, 5], [7, 6], [7, 8]]), [7, 9]), "four", "four with a gap");
  assert.equal(across(board([[7, 5], [7, 6], [7, 7]]), [7, 8]), "open4");
  assert.equal(across(board([[7, 5], [7, 6], [7, 7], [7, 8]]), [7, 9]), "five");
  assert.equal(across(board([]), [7, 7]), "one");
  assert.equal(across(board([[7, 1]]), [7, 0]), "closed2", "the edge blocks one side");
  assert.equal(across(board([], [[7, 1]]), [7, 0]), "none", "no room for five at the edge");
  assert.throws(() => G.shapesAt(board([]), -1, BLACK));
});

test("gomoku: threat reports fours and open threes of the player who just moved", () => {
  const three = position([[7, 5], [7, 6], [7, 7]], [[0, 0], [0, 2]]);
  assert.deepEqual(G.threat(three), { color: BLACK, kind: "three" });
  const four = position([[7, 5], [7, 6], [7, 7], [7, 8]], [[7, 4], [0, 2], [0, 4]]);
  assert.deepEqual(G.threat(four), { color: BLACK, kind: "four" });
  assert.equal(G.threat(G.fromMoves([P(7, 7), P(6, 6)])), null);
  assert.equal(G.threat(G.newGame()), null);
});

test("gomoku: an open four is reported as open4, so the hint does not say it can still be blocked", () => {
  const open = position([[7, 5], [7, 6], [7, 7], [7, 8]], [[0, 0], [0, 2], [0, 4]]);
  assert.deepEqual(G.threat(open), { color: BLACK, kind: "open4" });
  // Two separate fours at once are just as unstoppable.
  const double = position([[7, 4], [7, 5], [7, 6], [4, 7], [5, 7], [6, 7], [7, 7]], [[7, 3], [3, 7], [0, 0], [0, 2], [0, 4], [0, 6]]);
  assert.deepEqual(G.threat(double), { color: BLACK, kind: "open4" });
});

/* ---------- CPU ---------- */
/* Snapshots from messy games (CPU moves mixed with random ones), from the opening to crowded boards. */
function randomPositions(games, seed) {
  const r = rng(seed);
  const out = [];
  for (let k = 0; k < games; k++) {
    let g = G.newGame();
    const noise = 0.15 + r() * 0.5;
    while (!g.over && g.moves.length < 170) {
      if (g.moves.length >= 2 && r() < 0.3) out.push(g);
      const spot = P(2 + Math.floor(r() * 11), 2 + Math.floor(r() * 11));
      const pick = r() < noise && G.isLegal(g, spot) ? spot : G.cpuMove(g, r() < 0.5 ? "normal" : "easy", r);
      g = G.play(g, pick);
    }
  }
  return out;
}

/* Crowded boards: random stones (no five yet), the hardest case for the CPU's search. */
function crowdedPositions(count, seed) {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    let g = G.newGame();
    const target = 40 + Math.floor(r() * 150);
    for (let tries = 0; g.moves.length < target && tries < 2000; tries++) {
      const spot = Math.floor(r() * CELLS);
      if (!G.isLegal(g, spot)) continue;
      const next = G.play(g, spot);
      if (!next.over) g = next;
    }
    return g;
  });
}

test("gomoku cpu: always returns a legal move and never changes the state", () => {
  const positions = randomPositions(8, 11).map(deepFreeze);
  assert.ok(positions.length >= 40);
  positions.forEach((g, k) => G.LEVELS.forEach(level => {
    const before = JSON.stringify(g);
    const m = G.cpuMove(g, level, rng(k));
    assert.ok(G.isLegal(g, m), `${level} on position ${k}`);
    assert.equal(JSON.stringify(g), before);
  }));
  G.LEVELS.forEach(level => assert.ok(G.isLegal(G.newGame(), G.cpuMove(G.newGame(), level, rng(1)))));
  assert.equal(G.cpuMove(G.newGame(), "hard"), G.CENTER);
});

test("gomoku cpu: rejects a bad level or a finished game", () => {
  assert.throws(() => G.cpuMove(G.newGame(), "oni"), /強さ/);
  assert.throws(() => G.cpuMove({ ...G.newGame(), turn: 3 }, "normal"), /盤面/);
  assert.throws(() => G.cpuMove({ board: Array(10).fill(0), moves: [], turn: 1 }, "normal"), /盤面/);
  const won = position([[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]], [[0, 0], [0, 2], [0, 4], [0, 6]]);
  assert.throws(() => G.cpuMove(won, "normal"), /決着/);
});

test("gomoku cpu: every level takes an immediate win, even when the other side also has a four", () => {
  // Black (to move) has a closed four, white has an open four.
  const g = position([[7, 4], [7, 5], [7, 6], [7, 7], [2, 2], [12, 12]], [[7, 3], [10, 5], [10, 6], [10, 7], [10, 8], [0, 14]]);
  assert.equal(g.turn, BLACK);
  G.LEVELS.forEach(level => {
    for (let s = 0; s < 20; s++) assert.equal(G.cpuMove(g, level, rng(s)), P(7, 8), level);
  });
  // A four with a gap, white to move.
  const w = position([[0, 0], [0, 2], [0, 4], [9, 9], [12, 1], [13, 13]], [[4, 4], [5, 5], [6, 6], [8, 8], [3, 12]]);
  assert.equal(w.turn, WHITE);
  G.LEVELS.forEach(level => assert.equal(G.cpuMove(w, level, rng(3)), P(7, 7), level));
});

test("gomoku cpu: ふつう and つよい block a four", () => {
  // White has XXXX with one open end; black (CPU) has nothing.
  const g = position([[7, 3], [2, 2], [12, 12], [2, 12]], [[7, 4], [7, 5], [7, 6], [7, 7]]);
  assert.equal(g.turn, BLACK);
  ["normal", "hard"].forEach(level => {
    for (let s = 0; s < 10; s++) assert.equal(G.cpuMove(g, level, rng(s)), P(7, 8), level);
  });
});

test("gomoku cpu: ふつう and つよい block a four that runs into the board edge", () => {
  // White (0,10)-(0,13), blocked by black at (0,9): the only point left is the corner side (0,14).
  const g = position([[0, 9], [7, 7], [12, 2], [10, 12]], [[0, 10], [0, 11], [0, 12], [0, 13]]);
  assert.equal(g.turn, BLACK);
  ["normal", "hard"].forEach(level => {
    for (let s = 0; s < 5; s++) assert.equal(G.cpuMove(g, level, rng(s)), P(0, 14), level);
  });
});

test("gomoku cpu: ふつう and つよい stop an open three", () => {
  const g = position([[3, 3], [11, 11], [3, 11]], [[7, 6], [7, 7], [7, 8]]);
  assert.equal(g.turn, BLACK);
  ["normal", "hard"].forEach(level => {
    for (let s = 0; s < 10; s++) assert.ok([P(7, 5), P(7, 9)].includes(G.cpuMove(g, level, rng(s))), level);
  });
});

test("gomoku cpu: makes its own open four instead of blocking a three", () => {
  const g = position([[4, 5], [4, 6], [4, 7], [12, 2]], [[9, 6], [9, 7], [9, 8], [0, 14]]);
  assert.equal(g.turn, BLACK);
  ["normal", "hard"].forEach(level => {
    const m = G.cpuMove(g, level, rng(5));
    assert.ok(G.shapesAt(g.board, m, BLACK).includes("open4"), level);
  });
});

test("gomoku cpu: つよい plays the four-three that wins", () => {
  // Black: closed three across (blocked by white on the left) and two stones going down to the same point.
  const g = position([[7, 4], [7, 5], [7, 6], [5, 7], [6, 7]], [[7, 3], ...FILLER.slice(0, 4)]);
  assert.equal(g.turn, BLACK);
  const m = G.cpuMove(g, "hard", rng(2));
  assert.equal(m, P(7, 7));
  const s = G.shapesAt(g.board, m, BLACK);
  assert.ok(s.includes("four") && s.includes("three"));
});

test("gomoku cpu: つよい defends against a three-three", () => {
  // White threatens (7,7), which would make two open threes at once. After black's move, no white point
  // may give a double threat any more.
  const g = position([[2, 2], [12, 12], [2, 12], [12, 2]], [[7, 5], [7, 6], [5, 7], [6, 7]]);
  assert.equal(g.turn, BLACK);
  for (let s = 0; s < 5; s++) {
    const after = G.play(g, G.cpuMove(g, "hard", rng(s)));
    after.board.forEach((v, q) => {
      if (v !== EMPTY) return;
      const sh = G.shapesAt(after.board, q, WHITE);
      const threes = sh.filter(x => x === "three").length;
      const fours = sh.filter(x => x === "four").length;
      assert.ok(threes < 2 && !(fours && threes) && !sh.includes("open4"), `white double threat at ${q}`);
    });
  }
});

test("gomoku cpu: よわい makes real mistakes - it sometimes misses a four and mostly ignores open threes", () => {
  const four = position([[7, 3], [2, 2], [12, 12], [2, 12]], [[7, 4], [7, 5], [7, 6], [7, 7]]);
  const three = position([[3, 3], [11, 11], [3, 11]], [[7, 6], [7, 7], [7, 8]]);
  const runs = 200;
  let blockedFour = 0, blockedThree = 0;
  for (let s = 0; s < runs; s++) {
    if (G.cpuMove(four, "easy", rng(s)) === P(7, 8)) blockedFour++;
    if ([P(7, 5), P(7, 9)].includes(G.cpuMove(three, "easy", rng(1000 + s)))) blockedThree++;
  }
  assert.ok(blockedFour > runs * 0.5 && blockedFour < runs * 0.95, `four blocked ${blockedFour}/${runs}`);
  assert.ok(blockedThree < runs * 0.6, `three blocked ${blockedThree}/${runs}`);
});

test("gomoku cpu: levels are clearly different in CPU-vs-CPU games", () => {
  const play = (black, white, seed) => {
    const r = rng(seed);
    let g = G.fromMoves([G.CENTER, P(6, 6 + (seed % 3))]);
    while (!g.over) g = G.play(g, G.cpuMove(g, g.turn === BLACK ? black : white, r));
    return g.winner;
  };
  let hardWins = 0, normalWins = 0, hardOverEasy = 0;
  for (let s = 0; s < 6; s++) {
    if (play("hard", "normal", s) === BLACK) hardWins++;
    if (play("normal", "hard", s) === WHITE) hardWins++;
    if (play("normal", "easy", s) === BLACK) normalWins++;
    if (play("easy", "normal", s) === WHITE) normalWins++;
    if (play("hard", "easy", s) === BLACK) hardOverEasy++;
    if (play("easy", "hard", s) === WHITE) hardOverEasy++;
  }
  assert.ok(hardWins >= 9, `つよい won ${hardWins}/12 against ふつう`);
  assert.ok(normalWins >= 9, `ふつう won ${normalWins}/12 against よわい`);
  assert.ok(hardOverEasy >= 11, `つよい won ${hardOverEasy}/12 against よわい`);
});

/* Scattered stones with room between them (a child tapping all over the board): every empty point is a
 * candidate and nothing is forced, so these are the slowest boards for the search. */
function scatteredPositions(count, seed) {
  const r = rng(seed);
  const gap = (a, b) => Math.max(Math.abs(G.rowOf(a) - G.rowOf(b)), Math.abs(G.colOf(a) - G.colOf(b)));
  return Array.from({ length: count }, () => {
    let g = G.newGame();
    const target = 2 + Math.floor(r() * 40);
    for (let tries = 0; g.moves.length < target && tries < 5000; tries++) {
      const spot = Math.floor(r() * CELLS);
      if (!G.isLegal(g, spot) || (g.moves.some(j => gap(j, spot) < 3) && r() < 0.85)) continue;
      const next = G.play(g, spot);
      if (!next.over) g = next;
    }
    return g;
  });
}

test("gomoku cpu: つよい thinks well under 150 ms in the worst case, scattered boards included", () => {
  const positions = [...randomPositions(60, 99), ...crowdedPositions(80, 7), ...scatteredPositions(120, 3)];
  assert.ok(positions.length >= 300, `${positions.length} positions`);
  assert.ok(positions.some(g => g.moves.length > 80), "some crowded boards");
  positions.slice(0, 30).forEach((g, k) => G.cpuMove(g, "hard", rng(k))); // let the JIT warm up
  // CPU time of this process, so other programs running on the machine do not count.
  const cpuMs = (g, k) => {
    const t = process.cpuUsage();
    G.cpuMove(g, "hard", rng(k));
    const d = process.cpuUsage(t);
    return (d.user + d.system) / 1000;
  };
  let worst = 0;
  positions.forEach((g, k) => {
    const first = cpuMs(g, k);
    // A slow reading is taken once more, so a one-off pause (garbage collection) does not count.
    worst = Math.max(worst, first > 25 ? Math.min(first, cpuMs(g, k)) : first);
  });
  const most = Math.max(...positions.map(g => g.moves.length));
  console.log(`gomoku hard: worst ${worst.toFixed(1)} ms over ${positions.length} positions (up to ${most} stones)`);
  assert.ok(worst < 50 * TIMING_SLACK, `worst ${worst.toFixed(1)} ms (a phone can be 3x slower than this machine)`);
});

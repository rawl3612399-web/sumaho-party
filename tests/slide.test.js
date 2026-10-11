const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/slide-rules.js");

/* Repeatable random source. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}
/* Small seeded generator for longer random runs. */
function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const key = (t) => t.join(",");
const SOLVED4 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0];

/* All boards reachable from the solved one, by breadth-first search over single-tile moves. */
function reachable(n) {
  const seen = new Set([key(S.solved(n))]);
  let frontier = [[...S.solved(n)]];
  while (frontier.length) {
    const next = [];
    frontier.forEach(t => {
      const gap = t.indexOf(0);
      [gap - n, gap + n, gap - 1, gap + 1].forEach(i => {
        if (i < 0 || i >= t.length || (Math.abs(i - gap) === 1 && Math.floor(i / n) !== Math.floor(gap / n))) return;
        const moved = S.slide(t, i).tiles;
        if (seen.has(key(moved))) return;
        seen.add(key(moved));
        next.push(moved);
      });
    });
    frontier = next;
  }
  return seen;
}
function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((v, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [v, ...p]));
}

/* ---------- board basics ---------- */
test("slide: solved board reads in order with the gap bottom-right", () => {
  assert.deepEqual([...S.solved(3)], [1, 2, 3, 4, 5, 6, 7, 8, 0]);
  assert.deepEqual([...S.solved(4)], SOLVED4);
  assert.equal(S.solved(5).length, 25);
  assert.equal(S.isSolved(S.solved(5)), true);
  assert.equal(S.isSolved([1, 2, 3, 4, 5, 6, 7, 0, 8]), false);
  assert.equal(S.isSolved([0, 1, 2, 3, 4, 5, 6, 7, 8]), false);
  assert.ok(Object.isFrozen(S.solved(3)));
  assert.throws(() => S.solved(1));
  assert.throws(() => S.solved(9));
  assert.throws(() => S.solved(3.5));
});

test("slide: boards are validated", () => {
  assert.equal(S.sizeOf(SOLVED4), 4);
  assert.throws(() => S.sizeOf("1,2,3"));
  assert.throws(() => S.sizeOf([1, 2, 3, 4, 5, 6, 7, 0]), /盤の形/);
  assert.throws(() => S.sizeOf([1, 1, 3, 4, 5, 6, 7, 8, 0]), /並び/);
  assert.throws(() => S.sizeOf([1, 2, 3, 4, 5, 6, 7, 9, 0]), /並び/);
  assert.throws(() => S.sizeOf(["1", 2, 3, 4, 5, 6, 7, 8, 0]), /並び/);
  assert.throws(() => S.isSolved([0]));
});

test("slide: home count marks tiles already in place", () => {
  assert.equal(S.homeCount(S.solved(4)), 15);
  assert.equal(S.homeCount([1, 2, 3, 4, 5, 6, 7, 0, 8]), 7);
  assert.equal(S.homeCount([8, 7, 6, 5, 4, 3, 2, 1, 0]), 0);
  assert.equal(S.atHome([1, 2, 3, 4, 5, 6, 7, 0, 8], 7), false, "the gap is never at home");
});

/* ---------- moves ---------- */
test("slide: only tiles in the gap's row or column can move", () => {
  const t = [1, 2, 3, 4, 0, 5, 6, 7, 8]; // gap in the middle
  assert.deepEqual(S.legalMoves(t), [1, 3, 5, 7]);
  assert.equal(S.directionOf(t, 3), "right");
  assert.equal(S.directionOf(t, 5), "left");
  assert.equal(S.directionOf(t, 1), "down");
  assert.equal(S.directionOf(t, 7), "up");
  assert.equal(S.directionOf(t, 0), null);
  assert.equal(S.directionOf(t, 4), null, "the gap itself");
  assert.equal(S.directionOf(t, 9), null);
  assert.equal(S.directionOf(t, -1), null);
  assert.equal(S.canSlide(t, 8), false);
  assert.deepEqual(S.legalMoves(SOLVED4), [3, 7, 11, 12, 13, 14]);
});

test("slide: one tile slides into the gap without changing the input", () => {
  const t = [...S.solved(3)];
  const out = S.slide(t, 7);
  assert.deepEqual(out.tiles, [1, 2, 3, 4, 5, 6, 7, 0, 8]);
  assert.equal(out.count, 1);
  assert.equal(out.dir, "right");
  assert.deepEqual(t, [...S.solved(3)]);
});

test("slide: a far tile pushes the whole row or column", () => {
  const row = S.slide(SOLVED4, 12);
  assert.deepEqual(row.tiles, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 13, 14, 15]);
  assert.equal(row.count, 3);
  assert.equal(row.dir, "right");
  const col = S.slide(SOLVED4, 3);
  assert.deepEqual(col.tiles, [1, 2, 3, 0, 5, 6, 7, 4, 9, 10, 11, 8, 13, 14, 15, 12]);
  assert.equal(col.count, 3);
  assert.equal(col.dir, "down");
  const back = S.slide(row.tiles, 15);
  assert.deepEqual(back.tiles, SOLVED4, "sliding the other way undoes it");
  assert.equal(back.dir, "left");
  const up = S.slide(col.tiles, 15);
  assert.deepEqual(up.tiles, SOLVED4);
  assert.equal(up.dir, "up");
  assert.equal(S.slide(col.tiles, 11).count, 2);
  assert.throws(() => S.slide(SOLVED4, 0), /動かせません/);
  assert.throws(() => S.slide(SOLVED4, 15), /動かせません/);
});

test("slide: swipes move the gap's neighbour on the far side", () => {
  const t = [1, 2, 3, 4, 0, 5, 6, 7, 8];
  assert.equal(S.swipeIndex(t, "left"), 5);
  assert.equal(S.swipeIndex(t, "right"), 3);
  assert.equal(S.swipeIndex(t, "up"), 7);
  assert.equal(S.swipeIndex(t, "down"), 1);
  assert.equal(S.swipeIndex(SOLVED4, "left"), -1, "nothing right of a gap on the edge");
  assert.equal(S.swipeIndex(SOLVED4, "up"), -1);
  assert.equal(S.swipeIndex(SOLVED4, "right"), 14);
  assert.equal(S.swipeIndex(SOLVED4, "down"), 11);
  assert.equal(S.swipeIndex([1, 2, 0, 3, 4, 5, 6, 7, 8], "right"), 1);
  assert.equal(S.swipeIndex([1, 2, 0, 3, 4, 5, 6, 7, 8], "left"), -1, "no wrap to the next row");
  assert.throws(() => S.swipeIndex(t, "back"));
});

/* ---------- shuffle ---------- */
test("slide: shuffles are legal, solvable and never already solved", () => {
  [3, 4, 5].forEach(n => {
    for (let s = 1; s <= 30; s++) {
      const t = S.shuffle(n, lcg(s * 7919));
      assert.equal(S.sizeOf(t), n);
      assert.equal(S.isSolvable(t), true);
      assert.equal(S.isSolved(t), false);
    }
  });
});

test("slide: shuffle uses the given random source and step count", () => {
  assert.deepEqual(S.shuffle(4, lcg(42)), S.shuffle(4, lcg(42)));
  assert.notDeepEqual(S.shuffle(4, lcg(42)), S.shuffle(4, lcg(43)));
  const one = S.shuffle(3, () => 0, 1);
  assert.equal(S.homeCount(one), 7, "one step moves exactly one tile");
  assert.equal(S.isSolved(S.shuffle(3, () => 0, 4)), false);
  assert.equal(S.isSolved(S.shuffle(3, seq(0.99, 0.01), 12)), false, "even a walk that comes back is not solved");
  assert.throws(() => S.shuffle(1));
  assert.throws(() => S.shuffle(4, Math.random, 0));
  assert.throws(() => S.shuffle(4, Math.random, 2.5));
});

test("slide: default shuffles can leave the gap on any square", () => {
  // A walk with a fixed even step count always ends with the gap on a square of the bottom-right colour,
  // so half of all solvable boards (and on 3x3 the four edge-middle gap squares) could never appear.
  [3, 4, 5].forEach(n => {
    const gaps = new Set();
    const parity = new Set();
    for (let s = 1; s <= 300; s++) {
      const gap = S.shuffle(n, lcg(s * 104729)).indexOf(0);
      gaps.add(gap);
      parity.add((Math.floor(gap / n) + (gap % n)) % 2);
    }
    assert.equal(parity.size, 2, `${n}x${n}: gap on both square colours`);
    if (n === 3) assert.equal(gaps.size, 9, "3x3: the gap can start on every square");
  });
  assert.equal(S.homeCount(S.shuffle(3, () => 0, 1)), 7, "an explicit step count is used as given");
});

test("slide: shuffles mix the board well", () => {
  const n = 4;
  const runs = 40;
  const misplaced = Array.from({ length: runs }, (_, s) => 15 - S.homeCount(S.shuffle(n, lcg(s + 11)))).reduce((a, b) => a + b, 0) / runs;
  assert.ok(misplaced > 12, `about all tiles leave home (${misplaced})`);
});

/* ---------- solvability ---------- */
test("slide: the famous 14-15 swap cannot be solved", () => {
  assert.equal(S.isSolvable(SOLVED4), true);
  assert.equal(S.isSolvable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 14, 0]), false);
  assert.equal(S.isSolvable([1, 2, 3, 4, 5, 6, 8, 7, 0]), false);
  assert.equal(S.isSolvable([1, 2, 3, 4, 5, 6, 7, 0, 8]), true);
  assert.equal(S.inversions([2, 1, 3, 0]), 1);
});

test("slide: parity check matches every reachable 2x2 board exactly", () => {
  const seen = reachable(2);
  assert.equal(seen.size, 12);
  permutations([0, 1, 2, 3]).forEach(p => assert.equal(S.isSolvable(p), seen.has(key(p)), key(p)));
});

test("slide: parity check matches reachability on the whole 3x3 puzzle", () => {
  const seen = reachable(3);
  assert.equal(seen.size, 181440, "half of 9! boards");
  const rnd = lcg(7);
  for (let k = 0; k < 400; k++) {
    const p = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(v => ({ v, w: rnd() })).sort((a, b) => a.w - b.w).map(x => x.v);
    assert.equal(S.isSolvable(p), seen.has(key(p)), key(p));
  }
});

test("slide: swapping two tiles flips solvability on every size", () => {
  [3, 4, 5].forEach(n => {
    const t = S.shuffle(n, lcg(n));
    const [a, b] = t.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    const swapped = t.map((v, i) => (i === a ? t[b] : i === b ? t[a] : v));
    assert.equal(S.isSolvable(swapped), !S.isSolvable(t));
  });
});

/* ---------- a game ---------- */
test("slide: moves count every tile that slides; solving ends the game", () => {
  let g = S.newGame(3, lcg(5));
  assert.equal(g.moves, 0);
  assert.equal(g.solved, false);
  assert.throws(() => S.newGame(2));
  assert.throws(() => S.newGame(6));
  g = { ...g, tiles: [1, 2, 3, 4, 5, 6, 0, 7, 8] };
  g = S.play(g, 8);
  assert.equal(g.moves, 2);
  assert.deepEqual(g.last, { index: 8, dir: "left", count: 2 });
  assert.equal(g.solved, true);
  assert.throws(() => S.play(g, 5), /そろって/);
  assert.throws(() => S.play(null, 0));
});

test("slide: an illegal tap leaves the game unchanged", () => {
  const g = { n: 3, tiles: [1, 2, 3, 4, 5, 6, 7, 0, 8], moves: 4, solved: false, last: null };
  assert.throws(() => S.play(g, 0));
  assert.equal(g.moves, 4);
  assert.deepEqual(g.tiles, [1, 2, 3, 4, 5, 6, 7, 0, 8]);
});

/* ---------- records ---------- */
test("slide: stored records are cleaned", () => {
  const empty = S.normalizeRecords(null);
  assert.deepEqual(empty, { 3: { ms: null, moves: null }, 4: { ms: null, moves: null }, 5: { ms: null, moves: null } });
  const raw = { 3: { ms: 12000, moves: 30 }, 4: { ms: -5, moves: 2.5 }, 5: "x", 6: { ms: 1, moves: 1 } };
  assert.deepEqual(S.normalizeRecords(raw), { 3: { ms: 12000, moves: 30 }, 4: { ms: null, moves: null }, 5: { ms: null, moves: null } });
  assert.deepEqual(S.normalizeRecords([1, 2]), empty);
  assert.deepEqual(S.normalizeRecords(JSON.parse(JSON.stringify({ 4: { ms: 9e15, moves: 10 } })))[4], { ms: null, moves: null });
});

test("slide: a stored record with only one valid half is dropped", () => {
  // Both halves are always saved together; a half record used to show as "0:05.0・null手" and fake a first clear.
  assert.deepEqual(S.normalizeRecords({ 3: { ms: 5000 } })[3], { ms: null, moves: null });
  assert.deepEqual(S.normalizeRecords({ 3: { moves: 30 } })[3], { ms: null, moves: null });
  assert.deepEqual(S.normalizeRecords({ 3: { ms: 5000, moves: "30" } })[3], { ms: null, moves: null });
  const out = S.addRecord({ 3: { moves: 30 } }, 3, 9000, 40);
  assert.deepEqual([out.first, out.newTime, out.newMoves], [true, true, true]);
});

test("slide: clampRecord keeps a very long or very busy game recordable", () => {
  assert.deepEqual(S.clampRecord(0.3, 12), { ms: 1, moves: 12 });
  assert.deepEqual(S.clampRecord(5 * 24 * 60 * 60 * 1000, 2e6), { ms: S.MAX_MS, moves: S.MAX_MOVES });
  const { ms, moves } = S.clampRecord(5 * 24 * 60 * 60 * 1000, 2e6);
  assert.doesNotThrow(() => S.addRecord(null, 4, ms, moves));
  assert.throws(() => S.clampRecord(NaN, 3));
  assert.throws(() => S.clampRecord(1000, 0));
});

test("slide: best time and fewest moves are kept separately", () => {
  let out = S.addRecord(null, 4, 90000, 120);
  assert.deepEqual([out.first, out.newTime, out.newMoves], [true, true, true]);
  out = S.addRecord(out.records, 4, 80000, 150);
  assert.deepEqual([out.first, out.newTime, out.newMoves], [false, true, false]);
  assert.deepEqual(out.records[4], { ms: 80000, moves: 120 });
  out = S.addRecord(out.records, 4, 95000, 100);
  assert.deepEqual([out.newTime, out.newMoves], [false, true]);
  assert.deepEqual(out.records[4], { ms: 80000, moves: 100 });
  out = S.addRecord(out.records, 4, 80000, 100);
  assert.deepEqual([out.newTime, out.newMoves], [false, false], "a tie is not a new record");
  assert.deepEqual(out.records[3], { ms: null, moves: null });
  const before = out.records;
  S.addRecord(before, 3, 5000, 20);
  assert.deepEqual(before[3], { ms: null, moves: null }, "input records are not changed");
  assert.throws(() => S.addRecord(null, 6, 1000, 10));
  assert.throws(() => S.addRecord(null, 4, 0, 10));
  assert.throws(() => S.addRecord(null, 4, 1000, 0));
});

test("slide: times read as minutes, seconds and tenths", () => {
  assert.equal(S.timeText(0), "0:00.0");
  assert.equal(S.timeText(83456), "1:23.4");
  assert.equal(S.timeText(9999), "0:09.9");
  assert.equal(S.timeText(600000), "10:00.0");
  assert.throws(() => S.timeText(-1));
  assert.throws(() => S.timeText(NaN));
});

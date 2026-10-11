const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/colorhunt-rules.js");

/* Repeatable random source. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}
/* Simple seeded generator for long runs. */
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/* Plays a full run of boards for one seed, each board generated from the previous one. */
function playSeed(seed, lastScore) {
  const r = lcg(seed);
  const boards = [];
  let prev = null;
  for (let score = 0; score <= lastScore; score++) {
    prev = R.makeBoard(score, r, prev);
    boards.push(prev);
  }
  return boards;
}
const ROUNDING = 0.6;
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/* ---------- constants ---------- */
test("colorhunt: round settings", () => {
  assert.equal(R.ROUND_MS, 60000);
  assert.equal(R.PENALTY_MS, 3000);
  assert.equal(R.JND, 2);
  [R.SIZE_STEPS, R.DELTA, R.BASE, R.VIEW, R.RANKS].forEach(x => assert.ok(Object.isFrozen(x)));
});

/* ---------- grid size ---------- */
test("colorhunt: grid grows from 2x2 to 8x8, one step at a time", () => {
  assert.equal(R.sizeFor(0), 2);
  assert.equal(R.sizeFor(1), 3);
  assert.equal(R.sizeFor(2), 3);
  assert.equal(R.sizeFor(3), 4);
  assert.equal(R.sizeFor(6), 5);
  assert.equal(R.sizeFor(10), 6);
  assert.equal(R.sizeFor(15), 7);
  assert.equal(R.sizeFor(20), 7);
  assert.equal(R.sizeFor(21), 8);
  assert.equal(R.sizeFor(R.MAX_SCORE), 8);
  for (let s = 1; s <= 100; s++) {
    const step = R.sizeFor(s) - R.sizeFor(s - 1);
    assert.ok(step === 0 || step === 1, `score ${s}`);
    assert.equal(R.sizeUp(s), step === 1, `sizeUp ${s}`);
  }
  assert.equal(R.sizeUp(0), false);
});

/* ---------- difference schedule ---------- */
test("colorhunt: difference starts big, never grows, and stays above zero", () => {
  assert.equal(R.deltaFor(0), R.DELTA.start);
  for (let s = 1; s <= 500; s++) {
    assert.ok(R.deltaFor(s) <= R.deltaFor(s - 1), `non-increasing at ${s}`);
    assert.ok(R.deltaFor(s) > 0, `positive at ${s}`);
    assert.ok(R.deltaFor(s) >= R.DELTA.floor, `floor at ${s}`);
  }
  assert.ok(R.deltaFor(R.MAX_SCORE) > 0);
  assert.ok(R.DELTA.floor >= 1.5 * R.JND, "the hardest board is still above the noticeable limit");
});

test("colorhunt: difference stays clearly visible until about stage 30", () => {
  for (let s = 0; s <= 30; s++) assert.ok(R.deltaFor(s) >= 2.5 * R.JND, `stage ${s}: ${R.deltaFor(s)}`);
  assert.ok(R.deltaFor(10) >= 10, "stage 10 is still easy-ish");
  assert.ok(R.deltaFor(40) < R.deltaFor(20), "later stages really are harder");
});

/* ---------- boards ---------- */
test("colorhunt: every board has exactly one odd tile inside the grid", () => {
  for (let seed = 1; seed <= 40; seed++) {
    playSeed(seed, 45).forEach(b => {
      assert.equal(b.size, R.sizeFor(b.score));
      assert.ok(Number.isInteger(b.oddIndex) && b.oddIndex >= 0 && b.oddIndex < b.size * b.size);
      const odd = Array.from({ length: b.size * b.size }, (_, i) => i).filter(i => R.isOdd(b, i));
      assert.deepEqual(odd, [b.oddIndex]);
      assert.notDeepEqual(b.base, b.odd, "the odd tile really differs");
    });
  }
});

test("colorhunt: the shown difference matches the schedule (after 8-bit rounding)", () => {
  for (let seed = 1; seed <= 40; seed++) {
    playSeed(seed, 60).forEach(b => {
      const d = R.distance(b.base, b.odd);
      assert.ok(Math.abs(d - R.deltaFor(b.score)) <= ROUNDING, `seed ${seed} score ${b.score}: ${d} vs ${b.delta}`);
      assert.ok(d >= 1.5 * R.JND, `never imperceptible (seed ${seed} score ${b.score})`);
      if (b.score < 30) assert.ok(d >= 2 * R.JND, `clearly visible before stage 30 (seed ${seed} score ${b.score})`);
    });
  }
});

test("colorhunt: tile colors stay inside the band that shows on light and dark backgrounds", () => {
  for (let seed = 1; seed <= 40; seed++) {
    playSeed(seed, 40).forEach(b => {
      [b.base, b.odd].forEach(c => {
        c.forEach(v => assert.ok(Number.isInteger(v) && v >= 0 && v <= 255));
        const L = R.lightness(c);
        assert.ok(L >= R.VIEW.min - 0.005 && L <= R.VIEW.max + 0.005, `lightness ${L}`);
      });
      const L = R.lightness(b.base);
      assert.ok(L >= R.BASE.look[0] - 0.005 && L <= R.BASE.look[1] + 0.005, `base lightness ${L}`);
    });
  }
});

test("colorhunt: next board changes hue clearly and never repeats the odd spot on the same grid", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const boards = playSeed(seed, 40);
    boards.slice(1).forEach((b, i) => {
      const prev = boards[i];
      assert.ok(hueGap(b.hue, prev.hue) >= R.HUE_GAP - 1e-9, `hue gap ${b.hue} / ${prev.hue}`);
      if (b.size === prev.size) assert.notEqual(b.oddIndex, prev.oddIndex);
    });
  }
});

test("colorhunt: random source edges still give valid boards", () => {
  [0, 0.5, 0.9999999].forEach(v => {
    const first = R.makeBoard(0, () => v);
    const next = R.makeBoard(25, () => v, first);
    [first, next].forEach(b => assert.ok(b.oddIndex >= 0 && b.oddIndex < b.size * b.size));
    assert.ok(Math.abs(R.distance(next.base, next.odd) - R.deltaFor(25)) <= ROUNDING);
  });
  const same = R.makeBoard(5, () => 0, { hue: 10, size: 4, oddIndex: 0 });
  assert.notEqual(same.oddIndex, 0);
});

test("colorhunt: boards are repeatable with the same random source and do not change the previous board", () => {
  const prev = Object.freeze(R.makeBoard(3, lcg(9)));
  const a = R.makeBoard(4, lcg(42), prev);
  const b = R.makeBoard(4, lcg(42), prev);
  assert.deepEqual(a, b);
  assert.deepEqual(R.makeBoard(0, seq(0.25, 0.5, 0.75, 0.1, 0.9)), R.makeBoard(0, seq(0.25, 0.5, 0.75, 0.1, 0.9)));
});

test("colorhunt: bad input is rejected", () => {
  assert.throws(() => R.makeBoard(-1), /スコア/);
  assert.throws(() => R.makeBoard(1.5), /スコア/);
  assert.throws(() => R.makeBoard("3"), /スコア/);
  assert.throws(() => R.makeBoard(0, "random"), /乱数/);
  assert.throws(() => R.makeBoard(0, () => 1), /乱数/);
  assert.throws(() => R.makeBoard(0, () => NaN), /乱数/);
  assert.throws(() => R.makeBoard(1, Math.random, { hue: "red" }), /前の盤面/);
  assert.throws(() => R.sizeFor(R.MAX_SCORE + 1), /スコア/);
  assert.throws(() => R.deltaFor(-3), /スコア/);
  const b = R.makeBoard(0, lcg(3));
  assert.throws(() => R.isOdd(b, 4), /マス/);
  assert.throws(() => R.isOdd(b, -1), /マス/);
  assert.throws(() => R.isOdd(b, 0.5), /マス/);
});

/* ---------- scoring ---------- */
test("colorhunt: taps update score, misses and streaks without touching the old run", () => {
  const board = R.makeBoard(0, lcg(5));
  const wrong = (board.oddIndex + 1) % 4;
  const start = Object.freeze(R.newRun());
  let res = R.tap(start, board, board.oddIndex);
  assert.equal(res.correct, true);
  assert.deepEqual(res.run, { score: 1, misses: 0, streak: 1, bestStreak: 1 });
  assert.deepEqual(start, { score: 0, misses: 0, streak: 0, bestStreak: 0 });
  res = R.tap(R.hit(res.run), board, wrong);
  assert.equal(res.correct, false);
  assert.deepEqual(res.run, { score: 2, misses: 1, streak: 0, bestStreak: 2 });
  assert.deepEqual(R.hit(res.run), { score: 3, misses: 1, streak: 1, bestStreak: 2 });
  assert.throws(() => R.hit({ score: -1, misses: 0, streak: 0, bestStreak: 0 }), /記録/);
  assert.throws(() => R.miss(null), /記録/);
});

test("colorhunt: summary gives accuracy and seconds per stage", () => {
  assert.deepEqual(R.summary(R.newRun()), { score: 0, misses: 0, bestStreak: 0, accuracy: null, avgSec: null });
  const run = { score: 18, misses: 2, streak: 4, bestStreak: 9 };
  assert.deepEqual(R.summary(run), { score: 18, misses: 2, bestStreak: 9, accuracy: 90, avgSec: 3 });
  assert.equal(R.summary({ score: 7, misses: 0, streak: 7, bestStreak: 7 }).avgSec, 8.6);
  assert.equal(R.summary({ score: 0, misses: 25, streak: 0, bestStreak: 0 }).accuracy, 0);
  assert.equal(R.summary({ score: 3, misses: 19, streak: 0, bestStreak: 1 }).avgSec, 1, "only the time actually left counts");
  assert.equal(R.summary({ score: 3, misses: 25, streak: 0, bestStreak: 1 }).avgSec, null);
});

test("colorhunt: the average uses the time the clock really ran when the screen measured it", () => {
  /* Regression: the last miss with 1 second left took only 1 second, but the average assumed the full 3,
   * e.g. 25 stages, 19 misses, real play 4.8 s was shown as 0.1 s per stage. */
  const run = { score: 25, misses: 19, streak: 0, bestStreak: 25 };
  assert.equal(R.summary(run).avgSec, 0.1, "without a measured time: nominal 3 s per miss");
  assert.equal(R.summary(run, 4800).avgSec, 0.2);
  assert.equal(R.summary({ score: 20, misses: 2, streak: 3, bestStreak: 9 }, 55000).avgSec, 2.8);
  assert.equal(R.summary({ score: 20, misses: 0, streak: 3, bestStreak: 9 }, R.ROUND_MS).avgSec, 3);
  assert.equal(R.summary({ score: 0, misses: 20, streak: 0, bestStreak: 0 }, 0).avgSec, null);
  assert.throws(() => R.summary(run, -1), /プレイ時間/);
  assert.throws(() => R.summary(run, R.ROUND_MS + 1), /プレイ時間/);
  assert.throws(() => R.summary(run, NaN), /プレイ時間/);
  assert.throws(() => R.summary(null, 1000), /記録/);
});

/* ---------- ranks ---------- */
test("colorhunt: rank titles follow the thresholds", () => {
  const titles = R.RANKS.map(r => r.title);
  assert.equal(new Set(titles).size, titles.length);
  R.RANKS.slice(1).forEach((r, i) => assert.ok(r.min > R.RANKS[i].min));
  assert.equal(R.RANKS[0].min, 0);
  assert.equal(R.rankFor(0).title, "モグラ級");
  assert.equal(R.rankFor(4).title, "モグラ級");
  assert.equal(R.rankFor(5).title, "イヌ級");
  assert.equal(R.rankFor(10).title, "ヒト級");
  assert.equal(R.rankFor(16).title, "タカ級");
  assert.equal(R.rankFor(22).title, "ハチドリ級");
  assert.equal(R.rankFor(28).title, "チョウ級");
  assert.equal(R.rankFor(35).title, "シャコ級");
  assert.equal(R.rankFor(500).title, "シャコ級");
  R.RANKS.forEach(r => assert.ok(r.note.length > 0 && !r.note.endsWith("。")));
  assert.throws(() => R.rankFor(-1), /スコア/);
});

test("colorhunt: next rank says how many more stages are needed", () => {
  assert.deepEqual(R.nextRank(0), { title: "イヌ級", need: 5 });
  assert.deepEqual(R.nextRank(14), { title: "タカ級", need: 2 });
  assert.deepEqual(R.nextRank(34), { title: "シャコ級", need: 1 });
  assert.equal(R.nextRank(35), null);
});

/* ---------- records ---------- */
test("colorhunt: records are validated on load", () => {
  assert.deepEqual(R.normalizeRecords(null), { best: 0 });
  assert.deepEqual(R.normalizeRecords("12"), { best: 0 });
  assert.deepEqual(R.normalizeRecords([5]), { best: 0 });
  assert.deepEqual(R.normalizeRecords({ best: -2 }), { best: 0 });
  assert.deepEqual(R.normalizeRecords({ best: 3.5 }), { best: 0 });
  assert.deepEqual(R.normalizeRecords({ best: "9" }), { best: 0 });
  assert.deepEqual(R.normalizeRecords({ best: R.MAX_SCORE + 1 }), { best: 0 });
  assert.deepEqual(R.normalizeRecords({ best: 23, extra: true }), { best: 23 });
});

test("colorhunt: a new best is detected without changing the old records", () => {
  const old = Object.freeze({ best: 12 });
  assert.deepEqual(R.applyRecord(old, 15), { records: { best: 15 }, isNew: true, previous: 12 });
  assert.deepEqual(R.applyRecord(old, 12), { records: { best: 12 }, isNew: false, previous: 12 });
  assert.deepEqual(R.applyRecord(old, 3), { records: { best: 12 }, isNew: false, previous: 12 });
  assert.deepEqual(old, { best: 12 });
  assert.equal(R.applyRecord(null, 0).isNew, false, "zero is not a record");
  assert.equal(R.applyRecord({ best: "x" }, 1).isNew, true);
  assert.throws(() => R.applyRecord(old, -1), /スコア/);
});

/* ---------- css output ---------- */
test("colorhunt: css colors are plain rgb()", () => {
  assert.equal(R.toCss([12, 200, 255]), "rgb(12, 200, 255)");
  const b = R.makeBoard(8, lcg(11));
  assert.match(R.toCss(b.base), /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
  assert.equal(R.distance([10, 20, 30], [10, 20, 30]), 0);
  assert.ok(Math.abs(R.distance([0, 0, 0], [255, 255, 255]) - 100) < 0.1, "black to white is 100");
});

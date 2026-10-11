const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../src/aim-rules.js");

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
const FIELDS = [{ w: 305, h: 380 }, { w: 305, h: 300 }, { w: 490, h: 620 }, { w: 640, h: 300 }, { w: 280, h: 300 }];
const inside = (t, b) => t.x - t.r >= A.PAD - 1e-9 && t.x + t.r <= b.w - A.PAD + 1e-9 &&
  t.y - t.r >= A.PAD - 1e-9 && t.y + t.r <= b.h - A.PAD + 1e-9;
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + A.GAP - 1e-9;
const play = (mode, rings, endMs) => rings.reduce((run, ring, i) => A.hit(run, ring, ((i + 1) * endMs) / rings.length), A.newRun(mode));

/* ---------- constants ---------- */
test("aim: modes, rings and ranks are fixed and frozen", () => {
  assert.deepEqual([...A.MODE_IDS], ["count30", "score30", "move"]);
  assert.deepEqual(A.MODE_IDS.map(id => A.MODES[id].label), ["30個タイムアタック", "30秒スコア", "動く的"]);
  assert.equal(A.TARGET_COUNT, 30);
  assert.equal(A.DURATION_MS, 30000);
  assert.deepEqual([...A.RING_POINTS], [30, 20, 10]);
  [A.MODE_IDS, A.MODES, A.SIZE, A.SPEED, A.RING_POINTS, A.RANK_TITLES, A.RANK_LIMITS].forEach(x => assert.ok(Object.isFrozen(x)));
  A.MODE_IDS.forEach(id => assert.equal(A.RANK_LIMITS[id].length, A.RANK_TITLES.length - 1, id));
});

test("aim: rank limits get easier step by step", () => {
  const time = A.RANK_LIMITS.count30;
  time.slice(1).forEach((l, i) => assert.ok(l > time[i], "time limits grow"));
  ["score30", "move"].forEach(m => A.RANK_LIMITS[m].slice(1).forEach((l, i) => assert.ok(l < A.RANK_LIMITS[m][i], m)));
});

/* ---------- size schedule ---------- */
test("aim: base radius follows the short side and stays in its range", () => {
  assert.equal(A.baseRadius({ w: 300, h: 500 }), 33);
  assert.equal(A.baseRadius({ w: 100, h: 100 }), A.SIZE.min);
  assert.equal(A.baseRadius({ w: 2000, h: 2000 }), A.SIZE.max);
  assert.throws(() => A.baseRadius({ w: 0, h: 100 }));
  assert.throws(() => A.baseRadius(null));
});

test("aim: only 30秒スコア shrinks, smoothly down to half size", () => {
  const b = { w: 305, h: 400 };
  const base = A.baseRadius(b);
  [0, 10000, 29000, 60000].forEach(ms => {
    assert.equal(A.radiusAt("count30", ms, b), base);
    assert.equal(A.radiusAt("move", ms, b), base);
  });
  assert.equal(A.radiusAt("score30", 0, b), base);
  assert.ok(Math.abs(A.radiusAt("score30", 30000, b) - base * A.SIZE.shrinkTo) < 1e-9);
  assert.equal(A.radiusAt("score30", 90000, b), A.radiusAt("score30", 30000, b), "stops shrinking after the end");
  let last = Infinity;
  for (let ms = 0; ms <= 30000; ms += 1000) {
    const r = A.radiusAt("score30", ms, b);
    assert.ok(r < last && r >= A.SIZE.floor, `shrinks at ${ms}`);
    last = r;
  }
  assert.throws(() => A.radiusAt("nope", 0, b));
  assert.throws(() => A.radiusAt("score30", -1, b));
  assert.throws(() => A.radiusAt("score30", NaN, b));
});

test("aim: moving targets speed up per hit, up to a cap", () => {
  const b = { w: 300, h: 400 };
  assert.ok(Math.abs(A.speedFor(0, b) - 300 * A.SPEED.start) < 1e-9);
  assert.ok(A.speedFor(10, b) > A.speedFor(5, b));
  assert.equal(A.speedFor(500, b), 300 * A.SPEED.max);
  assert.throws(() => A.speedFor(-1, b));
  assert.throws(() => A.speedFor(1.5, b));
});

/* ---------- placement ---------- */
test("aim: targets always land fully inside the field and never overlap the previous one", () => {
  FIELDS.forEach((b, f) => {
    const r = lcg(f + 11);
    A.MODE_IDS.forEach(mode => {
      let prev = null;
      for (let i = 0; i < 600; i++) {
        const t = A.spawn({ mode, hits: i % 40, elapsedMs: (i * 97) % 31000, bounds: b, prev }, r);
        assert.ok(inside(t, b), `inside ${mode} ${JSON.stringify(b)}`);
        if (prev) assert.ok(apart(t, prev), `apart ${mode} ${JSON.stringify(b)}`);
        prev = t;
      }
    });
  });
});

test("aim: placement falls back to the farthest corner when random spots keep landing on the old target", () => {
  const b = { w: 300, h: 400 };
  const prev = { x: 150, y: 200, r: 33 };
  const p = A.place(b, 33, prev, () => 0.5);
  assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) >= 33 + 33 + A.GAP);
  assert.ok([33 + A.PAD, 300 - 33 - A.PAD].includes(p.x));
  assert.ok([33 + A.PAD, 400 - 33 - A.PAD].includes(p.y));
});

test("aim: placement rejects bad input and fields that are too small", () => {
  assert.throws(() => A.place({ w: 50, h: 400 }, 33));
  assert.throws(() => A.place({ w: 300, h: 400 }, 0));
  assert.throws(() => A.place({ w: 300, h: 400 }, 33, { x: "a", y: 1, r: 2 }));
  assert.throws(() => A.spawn({ mode: "x", hits: 0, elapsedMs: 0, bounds: { w: 300, h: 300 } }));
});

test("aim: only 動く的 gets a velocity, with the scheduled speed", () => {
  const b = { w: 305, h: 380 };
  const still = A.spawn({ mode: "count30", hits: 3, elapsedMs: 0, bounds: b }, seq(0.3, 0.6, 0.1));
  assert.equal(still.vx, 0);
  assert.equal(still.vy, 0);
  assert.equal(still.r, A.baseRadius(b));
  const moving = A.spawn({ mode: "move", hits: 7, elapsedMs: 0, bounds: b }, seq(0.3, 0.6, 0.1));
  assert.ok(Math.abs(Math.hypot(moving.vx, moving.vy) - A.speedFor(7, b)) < 1e-9);
  const late = A.spawn({ mode: "score30", hits: 0, elapsedMs: 15000, bounds: b }, seq(0.5));
  assert.equal(late.r, A.radiusAt("score30", 15000, b));
});

/* ---------- motion ---------- */
test("aim: drifting targets move, bounce off the walls and stay inside", () => {
  const b = { w: 305, h: 380 };
  const t0 = { x: 100, y: 100, r: 30, vx: 200, vy: -50 };
  const t1 = A.drift(t0, 100, b);
  assert.deepEqual(t0, { x: 100, y: 100, r: 30, vx: 200, vy: -50 }, "input is not changed");
  assert.ok(Math.abs(t1.x - 120) < 1e-9 && Math.abs(t1.y - 95) < 1e-9);
  const wall = A.drift({ x: 260, y: 200, r: 30, vx: 300, vy: 0 }, 100, b);
  assert.ok(wall.vx < 0, "bounced off the right wall");
  assert.ok(wall.x <= b.w - 30 - A.PAD);
  const top = A.drift({ x: 150, y: 40, r: 30, vx: 0, vy: -400 }, 50, b);
  assert.ok(top.vy > 0 && top.y >= 30 + A.PAD, "bounced off the top wall");
  assert.deepEqual(A.drift(t0, 0, b), t0);
  const r = lcg(5);
  let t = A.spawn({ mode: "move", hits: 40, elapsedMs: 0, bounds: b }, r);
  for (let i = 0; i < 3000; i++) {
    t = A.drift(t, 1 + r() * 49, b);
    assert.ok(inside(t, b), `step ${i}`);
  }
  assert.throws(() => A.drift(t0, -5, b));
  assert.throws(() => A.drift({ x: 1 }, 5, b));
});

test("aim: clampInto pulls a target back into a smaller field", () => {
  const t = A.clampInto({ x: 400, y: 500, r: 30, vx: 0, vy: 0 }, { w: 300, h: 300 });
  assert.ok(inside(t, { w: 300, h: 300 }));
});

/* ---------- hit testing ---------- */
test("aim: hit test scores rings by distance from the center", () => {
  const t = { x: 100, y: 100, r: 30, vx: 0, vy: 0 };
  assert.deepEqual(A.hitTest(t, 100, 100), { hit: true, ring: 0, dist: 0, points: 30 });
  assert.equal(A.hitTest(t, 110, 100).ring, 0, "exactly one third is still the center");
  assert.equal(A.hitTest(t, 111, 100).ring, 1);
  assert.equal(A.hitTest(t, 100, 120).ring, 1);
  assert.equal(A.hitTest(t, 100, 121).ring, 2);
  assert.equal(A.hitTest(t, 130, 100).hit, true, "the edge counts");
  const out = A.hitTest(t, 131, 100);
  assert.equal(out.hit, false);
  assert.equal(out.points, 0);
  assert.equal(out.ring, null);
  const finger = A.hitTest(t, 136, 100, 8);
  assert.equal(finger.hit, true, "finger margin");
  assert.equal(finger.ring, 2);
  assert.equal(A.hitTest(t, 139, 100, 8).hit, false);
  assert.throws(() => A.hitTest(t, NaN, 1));
  assert.throws(() => A.hitTest(t, 1, 1, -1));
  assert.throws(() => A.hitTest(null, 1, 1));
});

/* ---------- run and scoring ---------- */
test("aim: hits and misses update a new run object", () => {
  const r0 = A.newRun("score30");
  const r1 = A.hit(r0, 0, 400);
  assert.equal(r0.hits, 0, "input is not changed");
  assert.deepEqual(r1, { mode: "score30", hits: 1, misses: 0, score: 30, bulls: 1, streak: 1, bestStreak: 1, lastHitMs: 400 });
  const r2 = A.miss(A.hit(r1, 2, 900));
  assert.equal(r2.score, 40);
  assert.equal(r2.streak, 0);
  assert.equal(r2.bestStreak, 2);
  assert.equal(r2.misses, 1);
  assert.equal(A.accuracy(r2), 67);
  assert.equal(A.accuracy(r0), null);
  assert.throws(() => A.hit(r0, 3, 10));
  assert.throws(() => A.newRun("x"));
  assert.throws(() => A.miss({ mode: "move" }));
});

test("aim: time attack ends at 30 hits; timed modes end at 30 seconds", () => {
  const done = play("count30", Array(30).fill(1), 15000);
  assert.equal(A.isOver(done, 15000), true);
  assert.equal(A.remaining(done, 15000), 0);
  assert.equal(A.remaining(A.newRun("count30"), 5000), 30);
  assert.throws(() => A.hit(done, 0, 16000), /終わって/);
  const timed = A.newRun("move");
  assert.equal(A.isOver(timed, 29999), false);
  assert.equal(A.isOver(timed, 30000), true);
  assert.equal(A.remaining(timed, 12500), 17500);
  assert.equal(A.remaining(timed, 45000), 0);
  assert.throws(() => A.hit(timed, 0, 30000));
});

test("aim: summary gives the value, average and rank for each mode", () => {
  const ta = A.summary(play("count30", Array(30).fill(2), 16500), 16500);
  assert.equal(ta.value, 16500);
  assert.equal(ta.avgMs, 550);
  assert.equal(ta.accuracy, 100);
  assert.equal(ta.rank.title, "チーター級");
  const sc = A.summary(play("score30", [0, 0, 1, 2], 20000), 30000);
  assert.equal(sc.value, 90);
  assert.equal(sc.bulls, 2);
  assert.equal(sc.avgMs, 5000);
  const mv = A.summary(A.miss(play("move", [1, 1, 1], 9000)), 30000);
  assert.equal(mv.value, 3);
  assert.equal(mv.accuracy, 75);
  const none = A.summary(A.newRun("move"), 30000);
  assert.equal(none.value, 0);
  assert.equal(none.avgMs, null);
  assert.equal(none.accuracy, null);
  assert.throws(() => A.summary(A.newRun("count30"), 5000), /まだ/);
  assert.throws(() => A.summary(A.newRun("score30"), 1000));
});

/* ---------- ranks ---------- */
test("aim: rank titles follow the thresholds and point to the next title", () => {
  assert.equal(A.rankFor("count30", 11000).title, "伝説のスナイパー");
  assert.equal(A.rankFor("count30", 12000).title, "伝説のスナイパー");
  assert.equal(A.rankFor("count30", 12001).title, "ハヤブサ級");
  assert.equal(A.rankFor("count30", 40000).title, "カメ級");
  assert.deepEqual(A.rankFor("count30", 15840).next, { title: "ハヤブサ級", gap: 840 });
  assert.equal(A.rankFor("count30", 9000).next, null);
  assert.equal(A.rankFor("score30", 1300).level, 0);
  assert.equal(A.rankFor("score30", 999).title, "チーター級");
  assert.deepEqual(A.rankFor("score30", 999).next, { title: "ハヤブサ級", gap: 1 });
  assert.equal(A.rankFor("score30", 0).title, "カメ級");
  assert.equal(A.rankFor("move", 25).title, "チーター級");
  assert.equal(A.rankFor("move", 10).level, 5);
  assert.throws(() => A.rankFor("move", -1));
  assert.throws(() => A.rankFor("move", 2.5));
});

test("aim: every value gets exactly one title and better values never rank lower", () => {
  A.MODE_IDS.forEach(mode => {
    const values = mode === "count30" ? Array.from({ length: 200 }, (_, i) => 40000 - i * 200) : Array.from({ length: 200 }, (_, i) => i * (mode === "score30" ? 8 : 1));
    values.reduce((prevLevel, v) => {
      const r = A.rankFor(mode, v);
      assert.ok(A.RANK_TITLES.includes(r.title));
      assert.ok(r.level <= prevLevel, `${mode} ${v}`);
      return r.level;
    }, Infinity);
  });
});

test("aim: values are shown with their units", () => {
  assert.equal(A.formatValue("count30", 15420), "15.42秒");
  assert.equal(A.formatValue("score30", 860), "860点");
  assert.equal(A.formatValue("move", 27), "27個");
  assert.deepEqual(A.valueParts("count30", 840), { num: "0.84", unit: "秒" });
  assert.throws(() => A.formatValue("nope", 1));
});

/* ---------- records and settings ---------- */
test("aim: records load safely from storage", () => {
  const empty = { count30: null, score30: null, move: null };
  [null, undefined, "x", 5, [], { count30: -1, score30: "9", move: 2.5 }].forEach(raw => assert.deepEqual(A.normalizeRecords(raw), empty));
  assert.deepEqual(A.normalizeRecords({ count30: 15000, score30: 800, move: 0, extra: 1 }), { count30: 15000, score30: 800, move: null });
  assert.equal(A.normalizeRecords({ count30: 99999999 }).count30, null);
});

test("aim: a new best depends on the mode direction; zero is never saved", () => {
  const first = A.applyRecord(null, "count30", 16000);
  assert.equal(first.isNew, true);
  assert.equal(first.previous, null);
  const slower = A.applyRecord(first.records, "count30", 17000);
  assert.equal(slower.isNew, false);
  assert.equal(slower.records.count30, 16000);
  const faster = A.applyRecord(first.records, "count30", 15000);
  assert.equal(faster.isNew, true);
  assert.equal(faster.previous, 16000);
  assert.equal(first.records.count30, 16000, "old records are not changed");
  const more = A.applyRecord({ score30: 500 }, "score30", 600);
  assert.equal(more.isNew, true);
  assert.equal(A.applyRecord({ score30: 500 }, "score30", 500).isNew, false, "a tie is not a new record");
  assert.equal(A.applyRecord(null, "move", 0).isNew, false);
  assert.equal(A.applyRecord(null, "move", 0).records.move, null);
  assert.equal(A.isBetter("move", 3, null), true);
  assert.throws(() => A.applyRecord(null, "move", -2));
  assert.throws(() => A.applyRecord(null, "zzz", 2));
});

test("aim: settings fall back to time attack", () => {
  assert.deepEqual(A.normalizeSettings(null), { mode: "count30" });
  assert.deepEqual(A.normalizeSettings({ mode: "zzz" }), { mode: "count30" });
  assert.deepEqual(A.normalizeSettings({ mode: "move", junk: 1 }), { mode: "move" });
});

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/mole-rules.js");

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
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
const clone = (v) => JSON.parse(JSON.stringify(v));

/* A game with one mole placed by hand. */
function withMole(hole, kind, upAt = 1000, downAt = 2000, base = M.newGame(30)) {
  const entry = { id: 99, kind, upAt, downAt, hitAt: null, gone: false };
  return { ...base, holes: base.holes.map((e, i) => (i === hole ? entry : e)) };
}

/* Runs a whole round at 60 fps with random taps; returns every spawn and the final state. */
function simulate(seconds, seed, tapChance = 0.05) {
  const r = rng(seed);
  const taps = rng(seed + 1000);
  let s = M.newGame(seconds);
  const spawns = [];
  const checks = [];
  for (let t = 0; t <= s.durationMs + 500; t += 16) {
    const before = s;
    const out = M.step(s, t, r);
    s = out.state;
    out.events.filter(ev => ev.type === "spawn").forEach(ev => spawns.push({ ...ev, t, before: before.holes[ev.hole] }));
    checks.push({ t, active: M.activeCount(s, t), p: M.progressAt(s, t) });
    if (taps() < tapChance) s = M.whack(s, Math.floor(taps() * M.HOLES), t).state;
  }
  return { s, spawns, checks };
}

/* ---------- difficulty curve ---------- */
test("curve: moles come faster, stay shorter and crowd more as time goes on", () => {
  const ps = Array.from({ length: 21 }, (_, i) => i / 20);
  ps.slice(1).forEach((p, i) => {
    assert.ok(M.spawnInterval(p) <= M.spawnInterval(ps[i]), `interval at ${p}`);
    M.KINDS.forEach(k => assert.ok(M.upTime(k, p) <= M.upTime(k, ps[i]), `${k} up time at ${p}`));
    assert.ok(M.maxUp(p) >= M.maxUp(ps[i]), `max up at ${p}`);
  });
  assert.ok(M.spawnInterval(0) >= 2 * M.spawnInterval(1));
  assert.equal(M.maxUp(0), 1);
  assert.equal(M.maxUp(1), 3);
  ps.forEach(p => {
    assert.ok(M.upTime("gold", p) < M.upTime("normal", p), "gold is faster");
    assert.ok(M.upTime("bomb", p) > M.upTime("normal", p), "bombs linger");
  });
  assert.throws(() => M.upTime("cat", 0));
});

test("curve: kind chances add up, gold stays rare, bombs only after the start and growing", () => {
  [0, 0.05, 0.2, 0.5, 0.9, 1].forEach(p => {
    const c = M.kindChances(p);
    assert.ok(Math.abs(c.gold + c.bomb + c.normal - 1) < 1e-9);
    assert.ok(c.gold > 0 && c.gold < 0.15);
    assert.ok(c.normal > 0.6);
  });
  assert.equal(M.kindChances(0).bomb, 0);
  assert.ok(M.kindChances(1).bomb > M.kindChances(0.2).bomb);
  assert.equal(M.pickKind(0.5, () => 0), "gold");
  assert.equal(M.pickKind(0.5, () => 0.1), "bomb");
  assert.equal(M.pickKind(0.5, () => 0.99), "normal");
  assert.equal(M.pickKind(0, () => 0.1), "normal", "no bombs right at the start");
});

/* ---------- spawning ---------- */
test("newGame: only 30 or 60 seconds, empty field", () => {
  assert.throws(() => M.newGame(45));
  assert.throws(() => M.newGame("30"));
  const s = M.newGame(60);
  assert.equal(s.durationMs, 60000);
  assert.deepEqual(s.holes, Array(9).fill(null));
  assert.equal(s.score, 0);
});

test("step: nothing before the first spawn, then one mole with a valid hole and kind", () => {
  const s = M.newGame(30);
  assert.deepEqual(M.step(s, 100, () => 0.5).events, []);
  const out = M.step(s, 500, seq(0, 0.5, 0.5));
  assert.equal(out.events.length, 1);
  const ev = out.events[0];
  assert.equal(ev.type, "spawn");
  assert.equal(ev.hole, 0);
  assert.equal(ev.kind, "normal");
  assert.deepEqual(M.holeView(out.state, 0, 500), { phase: "up", kind: "normal", id: ev.id });
  assert.equal(s.holes[0], null, "input state is not changed");
  assert.throws(() => M.step(s, -1));
  assert.throws(() => M.step({}, 10));
});

test("step: never two moles in the same hole, never more up than the curve allows", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const seconds = seed % 2 ? 30 : 60;
    const { spawns, checks } = simulate(seconds, seed);
    spawns.forEach(sp => {
      const prev = sp.before;
      if (!prev) return;
      const done = prev.hitAt !== null ? prev.hitAt + M.HIT_LINGER_MS : prev.downAt;
      assert.ok(done + M.COOLDOWN_MS <= sp.t, `seed ${seed}: hole ${sp.hole} reused too early at ${sp.t}`);
    });
    checks.forEach(c => assert.ok(c.active <= M.maxUp(c.p), `seed ${seed}: ${c.active} up at ${c.t}`));
    const ids = spawns.map(sp => sp.id);
    assert.equal(new Set(ids).size, ids.length, "unique mole ids");
  }
});

test("step: the spawn rate rises over the round and stops just before the end", () => {
  let early = 0;
  let late = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { s, spawns } = simulate(30, seed, 0);
    early += spawns.filter(sp => sp.t < 10000).length;
    late += spawns.filter(sp => sp.t >= 20000).length;
    assert.ok(spawns.every(sp => sp.t < s.durationMs - M.END_QUIET_MS), "no late spawns");
    assert.ok(spawns.length >= 30 && spawns.length <= 80, `seed ${seed}: ${spawns.length} moles`);
  }
  assert.ok(late > early * 1.5, `late ${late} vs early ${early}`);
});

test("step: every kind shows up over many rounds; gold is the rarest", () => {
  const count = { normal: 0, gold: 0, bomb: 0 };
  for (let seed = 1; seed <= 20; seed++) simulate(30, seed, 0).spawns.forEach(sp => { count[sp.kind] += 1; });
  assert.ok(count.gold > 0 && count.bomb > 0);
  assert.ok(count.gold < count.bomb && count.bomb < count.normal);
});

test("step: a mole nobody hits escapes once; bombs do not count as escaped", () => {
  const s = withMole(4, "normal", 1000, 2000);
  const mid = M.step(s, 2000 + M.GRACE_MS - 1, () => 0.5);
  assert.equal(mid.events.filter(e => e.type === "escape").length, 0);
  const out = M.step(s, 2000 + M.GRACE_MS, () => 0.5);
  assert.deepEqual(out.events.filter(e => e.type === "escape").map(e => e.hole), [4]);
  assert.equal(out.state.escaped, 1);
  const again = M.step(out.state, 2200, () => 0.5);
  assert.equal(again.events.filter(e => e.type === "escape").length, 0);
  const bomb = M.step(withMole(2, "bomb", 1000, 2000), 2500, () => 0.5);
  assert.equal(bomb.state.escaped, 0);
});

/* ---------- taps ---------- */
test("whack: normal +1, gold +5, the input is not changed", () => {
  const s = withMole(3, "normal");
  const before = clone(s);
  const out = M.whack(s, 3, 1200);
  assert.deepEqual(out.result, { type: "hit", kind: "normal", points: 1, base: 1, bonus: 0, combo: 1 });
  assert.equal(out.state.score, 1);
  assert.equal(out.state.hits, 1);
  assert.deepEqual(s, before);
  assert.equal(M.holeView(out.state, 3, 1300).phase, "hit");
  assert.equal(M.holeView(out.state, 3, 1200 + M.HIT_LINGER_MS).phase, "down");
  const gold = M.whack(withMole(0, "gold"), 0, 1100);
  assert.equal(gold.result.points, 5);
  assert.equal(gold.state.golds, 1);
});

test("whack: a bomb costs 3 points (never below 0) and breaks the combo", () => {
  const rich = { ...withMole(5, "bomb"), score: 10, combo: 4, lastHitAt: 900 };
  const out = M.whack(rich, 5, 1100);
  assert.equal(out.result.type, "bomb");
  assert.equal(out.result.points, -3);
  assert.equal(out.state.score, 7);
  assert.equal(out.state.combo, 0);
  assert.equal(out.state.bombs, 1);
  const poor = { ...withMole(5, "bomb"), score: 1 };
  assert.equal(M.whack(poor, 5, 1100).state.score, 0);
});

test("whack: empty hole is a miss; a bonked mole and the time after the end are ignored", () => {
  const s = { ...withMole(1, "normal"), combo: 3, lastHitAt: 900 };
  const miss = M.whack(s, 8, 1000);
  assert.equal(miss.result.type, "miss");
  assert.equal(miss.state.misses, 1);
  assert.equal(miss.state.combo, 0);
  const hit = M.whack(s, 1, 1100).state;
  assert.equal(M.whack(hit, 1, 1150).result.type, "none", "double tap on the same mole");
  assert.equal(M.whack(hit, 1, 1100 + M.HIT_LINGER_MS + 1).result.type, "miss");
  assert.equal(M.whack(withMole(1, "normal", 29500, 30500), 1, 30000).result.type, "none");
  assert.equal(M.whack(s, 1, 999).result.type, "miss", "before it pops up");
  assert.equal(M.whack(s, 1, 2000 + M.GRACE_MS - 1).result.type, "hit", "grace while ducking");
  assert.equal(M.whack(s, 1, 2000 + M.GRACE_MS).result.type, "miss");
  assert.throws(() => M.whack(s, 9, 1000));
  assert.throws(() => M.whack(s, 1.5, 1000));
  assert.throws(() => M.whack(s, 1, NaN));
});

test("combo: quick hits chain, every 5th gives a bonus, a long gap starts over", () => {
  assert.deepEqual([1, 4, 5, 6, 10, 15, 20, 25, 50].map(M.comboBonus), [0, 0, 2, 0, 4, 6, 8, 10, 10]);
  let s = M.newGame(30);
  const results = [];
  for (let k = 0; k < 10; k++) {
    const t = 1000 + k * 500;
    s = { ...s, holes: withMole(k % 9, "normal", t - 100, t + 400, s).holes.map((e, i) => (i === k % 9 ? { ...e, id: k } : e)) };
    const out = M.whack(s, k % 9, t);
    s = out.state;
    results.push(out.result);
  }
  assert.deepEqual(results.map(r => r.combo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(results[4].bonus, 2);
  assert.equal(results[9].bonus, 4);
  assert.equal(s.score, 10 + 2 + 4);
  assert.equal(s.maxCombo, 10);
  const slow = M.whack(withMole(0, "normal", 6000, 12000, s), 0, 5500 + M.COMBO_WINDOW_MS + 1);
  assert.equal(slow.result.combo, 1, "too slow: the chain starts over");
  const quick = M.whack(withMole(0, "normal", 6000, 12000, s), 0, 5500 + M.COMBO_WINDOW_MS);
  assert.equal(quick.result.combo, 11);
});

test("combo: the shown combo drops to 0 once the chain window has passed (regression: HUD kept a dead combo)", () => {
  const hit = M.whack(withMole(2, "normal", 1000, 3000), 2, 1200).state;
  const two = M.whack(withMole(5, "normal", 1300, 3000, hit), 5, 1500).state;
  assert.equal(M.comboAt(two, 1500), 2);
  assert.equal(M.comboAt(two, 1500 + M.COMBO_WINDOW_MS), 2, "still alive at the edge of the window");
  assert.equal(M.comboAt(two, 1500 + M.COMBO_WINDOW_MS + 1), 0, "dead after the window");
  assert.equal(two.combo, 2, "the state itself is not changed");
  assert.equal(M.comboAt(M.newGame(30), 0), 0);
  const missed = M.whack(two, 0, 1600).state;
  assert.equal(M.comboAt(missed, 1600), 0, "a miss breaks it");
});

/* ---------- results ---------- */
test("summary: accuracy counts misses and bombs as bad taps", () => {
  const s = { ...M.newGame(30), hits: 6, misses: 1, bombs: 1, score: 9 };
  const sum = M.summary(s);
  assert.equal(sum.taps, 8);
  assert.equal(sum.accuracy, 75);
  assert.equal(M.summary(M.newGame(30)).accuracy, 0);
});

test("rank: thresholds per 30 seconds, top title only for near-perfect play", () => {
  const titles = M.RANKS.map(r => r.title);
  assert.equal(new Set(titles).size, titles.length);
  M.RANKS.slice(1).forEach((r, i) => assert.ok(r.min < M.RANKS[i].min));
  assert.equal(M.rankFor(0, 30).title, titles[titles.length - 1]);
  assert.equal(M.rankFor(85, 30).title, "伝説のハンマー");
  assert.equal(M.rankFor(84, 30).title, "もぐら名人");
  assert.equal(M.rankFor(170, 60).title, "伝説のハンマー");
  assert.equal(M.rankFor(169, 60).title, "もぐら名人");
  assert.equal(M.rankFor(45, 30).title, "たたきの達人");
  assert.equal(M.rankFor(12, 30).title, "見習いハンマー");
  assert.equal(M.rankFor(11, 30).title, "もぐらの友だち");
  assert.deepEqual(M.nextRank(40, 30), { title: "たたきの達人", need: 5 });
  assert.deepEqual(M.nextRank(40, 60), { title: "なかなかの腕前", need: 16 });
  assert.equal(M.nextRank(90, 30), null);
  assert.throws(() => M.rankFor(10, 45));
});

test("rank: the simulated perfect player tops out, a lazy one does not", () => {
  const r = rng(7);
  let s = M.newGame(30);
  for (let t = 0; t <= 30000; t += 16) {
    const out = M.step(s, t, r);
    s = out.state;
    s.holes.forEach((e, i) => {
      if (e && e.kind !== "bomb" && M.holeView(s, i, t).phase === "up" && t - e.upAt >= 200) s = M.whack(s, i, t).state;
    });
  }
  assert.equal(M.rankFor(s.score, 30).title, "伝説のハンマー", `perfect scored ${s.score}`);
  assert.equal(M.summary(s).accuracy, 100);
  assert.notEqual(M.rankFor(Math.floor(s.score / 5), 30).title, "伝説のハンマー");
});

/* ---------- records and settings ---------- */
test("records: junk from storage is dropped; only a higher score is a new best", () => {
  assert.deepEqual(M.normalizeRecords(null), { 30: null, 60: null });
  assert.deepEqual(M.normalizeRecords([1, 2]), { 30: null, 60: null });
  const raw = { 30: { score: 40, maxCombo: 9, accuracy: 88, extra: 1 }, 60: { score: -2, maxCombo: 1, accuracy: 50 } };
  assert.deepEqual(M.normalizeRecords(raw), { 30: { score: 40, maxCombo: 9, accuracy: 88 }, 60: null });
  assert.deepEqual(M.normalizeRecords({ 30: { score: 40, maxCombo: 9, accuracy: 101 } })[30], null);
  const before = clone(raw);
  const sum = { score: 41, maxCombo: 3, accuracy: 70 };
  const better = M.applyRecord(raw, 30, sum);
  assert.equal(better.isNew, true);
  assert.equal(better.previous.score, 40);
  assert.deepEqual(better.records[30], { score: 41, maxCombo: 3, accuracy: 70 });
  assert.deepEqual(raw, before, "input untouched");
  assert.equal(M.applyRecord(raw, 30, { ...sum, score: 40 }).isNew, false);
  assert.equal(M.applyRecord({}, 60, { ...sum, score: 0 }).isNew, false, "zero is never a record");
  assert.equal(M.applyRecord({}, 60, sum).isNew, true);
  assert.throws(() => M.applyRecord({}, 45, sum));
  assert.throws(() => M.applyRecord({}, 30, { score: -1 }));
});

test("settings: only known round lengths", () => {
  assert.deepEqual(M.normalizeSettings(null), { seconds: 30 });
  assert.deepEqual(M.normalizeSettings({ seconds: 60 }), { seconds: 60 });
  assert.deepEqual(M.normalizeSettings({ seconds: 45 }), { seconds: 30 });
  assert.deepEqual(M.normalizeSettings("60"), { seconds: 30 });
});

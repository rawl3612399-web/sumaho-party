const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../src/anzan-rules.js");

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

/* ---------- constants ---------- */
test("anzan: setting options match the setup chips", () => {
  assert.deepEqual([...A.DIGITS], [1, 2, 3]);
  assert.deepEqual([...A.COUNTS], [3, 5, 10, 15]);
  assert.deepEqual(A.SPEED_IDS.map(id => A.SPEEDS[id].label), ["ゆっくり", "ふつう", "はやい"]);
  assert.deepEqual(A.SPEED_IDS.map(id => A.SPEEDS[id].ms), [1200, 800, 450]);
  assert.deepEqual([...A.MODES], ["free", "dan"]);
  [A.DIGITS, A.COUNTS, A.SPEED_IDS, A.SPEEDS, A.MODES, A.LADDER, A.NOTES, A.STREAK_TITLES, A.DEFAULTS].forEach(x => assert.ok(Object.isFrozen(x)));
});

/* ---------- number generation ---------- */
test("anzan: every number has exactly the right digits, never 0, never the same twice in a row (many seeds)", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = lcg(seed);
    A.DIGITS.forEach(d => {
      A.COUNTS.forEach(c => {
        const nums = A.generate(d, c, r);
        assert.equal(nums.length, c);
        nums.forEach((n, i) => {
          assert.ok(Number.isInteger(n), "integer");
          assert.ok(n > 0, "no zero-only numbers");
          assert.equal(String(n).length, d, `${n} has ${d} digits`);
          if (i > 0) assert.notEqual(n, nums[i - 1], "no consecutive duplicates");
        });
      });
    });
  }
});

test("anzan: generation reaches both ends of each range and stays inside it", () => {
  A.DIGITS.forEach(d => {
    const { min, max } = A.range(d);
    const seen = new Set();
    for (let seed = 1; seed <= 300; seed++) A.generate(d, 15, lcg(seed)).forEach(n => seen.add(n));
    assert.ok(seen.has(min) || d === 3, `min ${min} appears`);
    assert.ok([...seen].every(n => n >= min && n <= max));
    if (d === 1) assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  assert.deepEqual(A.range(1), { min: 1, max: 9 });
  assert.deepEqual(A.range(2), { min: 10, max: 99 });
  assert.deepEqual(A.range(3), { min: 100, max: 999 });
});

test("anzan: extreme random values still avoid repeats (no endless loop)", () => {
  [() => 0, () => 0.999999, seq(0.5), seq(0, 0.999999)].forEach(r => {
    A.DIGITS.forEach(d => {
      const nums = A.generate(d, 30, r);
      const { min, max } = A.range(d);
      nums.forEach((n, i) => {
        assert.ok(n >= min && n <= max);
        if (i > 0) assert.notEqual(n, nums[i - 1]);
      });
    });
  });
  assert.deepEqual(A.generate(1, 4, () => 0), [1, 2, 1, 2]);
  assert.deepEqual(A.generate(1, 3, () => 0.999999), [9, 8, 9]);
});

test("anzan: generation is fair enough (every 1-digit number shows up often)", () => {
  const counts = new Map();
  const r = lcg(7);
  for (let i = 0; i < 2000; i++) A.generate(1, 10, r).forEach(n => counts.set(n, (counts.get(n) || 0) + 1));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  for (let n = 1; n <= 9; n++) {
    const share = counts.get(n) / total;
    assert.ok(share > 0.08 && share < 0.14, `${n}: ${share}`);
  }
});

test("anzan: generation rejects bad input", () => {
  assert.throws(() => A.generate(0, 5), /けた数/);
  assert.throws(() => A.generate(4, 5), /けた数/);
  assert.throws(() => A.generate("2", 5), /けた数/);
  assert.throws(() => A.generate(2, 1), /口数/);
  assert.throws(() => A.generate(2, 31), /口数/);
  assert.throws(() => A.generate(2, 2.5), /口数/);
  assert.throws(() => A.generate(2, 5, "x"), /乱数/);
  assert.throws(() => A.generate(2, 5, () => 1), /乱数/);
  assert.throws(() => A.generate(2, 5, () => NaN), /乱数/);
});

/* ---------- totals, timing, answers ---------- */
test("anzan: totals add every number", () => {
  assert.equal(A.sum([1, 2, 3]), 6);
  assert.equal(A.sum([999, 998, 999]), 2996);
  assert.throws(() => A.sum([]));
  assert.throws(() => A.sum([0, 1]));
  assert.throws(() => A.sum([1000]));
  assert.throws(() => A.sum("123"));
  for (let seed = 1; seed <= 50; seed++) {
    const p = A.newProblem({ digits: 2, count: 10, ms: 800 }, lcg(seed));
    assert.equal(p.total, p.numbers.reduce((a, b) => a + b, 0));
    assert.equal(p.numbers.length, 10);
  }
});

test("anzan: each number shows, then a short blank; the two add up to one slot", () => {
  A.SPEED_IDS.forEach(id => {
    const ms = A.SPEEDS[id].ms;
    const t = A.timing(ms);
    assert.equal(t.on + t.gap, ms);
    assert.ok(t.gap >= A.GAP.min && t.gap <= A.GAP.max);
    assert.ok(t.on > t.gap, "number is visible longer than the blank");
  });
  assert.deepEqual(A.timing(1200), { on: 1000, gap: 200 });
  assert.deepEqual(A.timing(450), { on: 351, gap: 99 });
  assert.deepEqual(A.timing(300), { on: 230, gap: 70 });
  assert.throws(() => A.timing(100), /スピード/);
  assert.throws(() => A.timing(5000), /スピード/);
  assert.throws(() => A.timing(800.5), /スピード/);
});

test("anzan: new problems carry their timing and validate the spec", () => {
  const p = A.newProblem({ digits: 3, count: 5, ms: 450 }, lcg(3));
  assert.equal(p.digits, 3);
  assert.equal(p.count, 5);
  assert.equal(p.ms, 450);
  assert.equal(p.on + p.gap, 450);
  assert.throws(() => A.newProblem(null), /設定/);
  assert.throws(() => A.newProblem({ digits: 2, count: 5, ms: 10 }), /スピード/);
  assert.throws(() => A.newProblem({ digits: 9, count: 5, ms: 800 }), /けた数/);
});

test("anzan: the flash schedule shows every number once, in order, with a blank after each", () => {
  for (let seed = 1; seed <= 60; seed++) {
    A.DIGITS.forEach(d => A.COUNTS.forEach(c => {
      const p = A.newProblem({ digits: d, count: c, ms: 450 }, lcg(seed));
      const steps = A.schedule(p, 380);
      assert.equal(steps.length, 1 + c * 2);
      assert.deepEqual(steps[0], { n: -1, passed: -1, ms: 380 });
      const shown = steps.filter(s => s.n >= 0).map(s => s.n);
      assert.deepEqual(shown, Array.from({ length: c }, (_, i) => i), "each number exactly once, in order");
      steps.slice(1).forEach((s, i) => {
        const k = Math.floor(i / 2);
        if (i % 2 === 0) assert.deepEqual(s, { n: k, passed: k, ms: p.on });
        else assert.deepEqual(s, { n: -1, passed: k, ms: p.gap });
      });
      assert.equal(steps.reduce((a, s) => a + s.ms, 0), 380 + c * 450);
    }));
  }
  assert.ok(Object.isFrozen(A.schedule({ numbers: [1, 2], ms: 800 })));
  assert.throws(() => A.schedule(null), /問題/);
  assert.throws(() => A.schedule({ numbers: [1], ms: 800 }, -5), /待ち時間/);
});

test("anzan: answers are checked as plain numbers", () => {
  const p = { total: 245 };
  assert.equal(A.isCorrect(p, "245"), true);
  assert.equal(A.isCorrect(p, 245), true);
  assert.equal(A.isCorrect(p, "244"), false);
  assert.equal(A.isCorrect(p, ""), false);
  assert.equal(A.isCorrect(p, "24a"), false);
  assert.equal(A.isCorrect(p, "-245"), false);
  assert.equal(A.isCorrect(p, null), false);
  assert.equal(A.parseAnswer("007"), 7);
  assert.equal(A.parseAnswer("123456789"), null);
  assert.throws(() => A.isCorrect(null, "1"), /問題/);
});

test("anzan: the keypad allows exactly enough digits for the biggest total", () => {
  assert.equal(A.answerLength(1, 3), 2);
  assert.equal(A.answerLength(1, 15), 3);
  assert.equal(A.answerLength(2, 15), 4);
  assert.equal(A.answerLength(3, 15), 5);
  for (let seed = 1; seed <= 100; seed++) {
    A.DIGITS.forEach(d => A.COUNTS.forEach(c => {
      const p = A.newProblem({ digits: d, count: c, ms: 800 }, lcg(seed));
      assert.ok(String(p.total).length <= A.answerLength(d, c));
    }));
  }
});

/* ---------- settings ---------- */
test("anzan: settings loaded from storage are validated", () => {
  assert.deepEqual(A.normalizeSettings(null), { ...A.DEFAULTS });
  assert.deepEqual(A.normalizeSettings("junk"), { ...A.DEFAULTS });
  assert.deepEqual(A.normalizeSettings({ mode: "dan", digits: 3, count: 15, speed: "fast" }), { mode: "dan", digits: 3, count: 15, speed: "fast" });
  assert.deepEqual(A.normalizeSettings({ mode: "x", digits: 4, count: 7, speed: "warp" }), { ...A.DEFAULTS });
  assert.deepEqual(A.specFor({ digits: 2, count: 10, speed: "slow" }), { digits: 2, count: 10, ms: 1200 });
  assert.equal(A.describe({ digits: 2, count: 5, ms: 450 }), "2けた 5口 0.45秒");
  assert.equal(A.describe({ digits: 1, count: 3, ms: 1000 }), "1けた 3口 1秒");
});

/* ---------- ladder ---------- */
test("anzan: the ladder runs 10級 → 1級 → 初段 → 十段 and every step is valid", () => {
  const titles = A.LADDER.map(s => s.title);
  assert.equal(titles.length, 20);
  assert.equal(titles[0], "10級");
  assert.equal(titles[9], "1級");
  assert.equal(titles[10], "初段");
  assert.equal(titles[19], "十段");
  assert.equal(new Set(titles).size, titles.length, "titles are unique");
  A.LADDER.forEach(s => {
    const p = A.newProblem(s, lcg(1));
    assert.equal(p.numbers.length, s.count);
  });
});

test("anzan: the ladder never gets easier", () => {
  A.LADDER.slice(1).forEach((b, i) => {
    const a = A.LADDER[i];
    assert.ok(b.digits >= a.digits, `${b.title} digits`);
    if (b.digits === a.digits) {
      assert.ok(b.count >= a.count && b.ms <= a.ms, `${b.title} not easier than ${a.title}`);
      assert.ok(b.count > a.count || b.ms < a.ms, `${b.title} harder than ${a.title}`);
    }
  });
});

test("anzan: rank titles and notes follow the thresholds", () => {
  assert.equal(A.danTitle(0), "無級");
  assert.equal(A.danTitle(1), "10級");
  assert.equal(A.danTitle(11), "初段");
  assert.equal(A.danTitle(20), "十段");
  assert.equal(A.danNote(0), "まずは10級をめざそう");
  assert.equal(A.danNote(1), "そろばん教室デビュー");
  assert.equal(A.danNote(6), "そろばん教室デビュー");
  assert.equal(A.danNote(7), "なかなかの暗算力");
  assert.equal(A.danNote(11), "有段者の仲間入り");
  assert.equal(A.danNote(16), "暗算の達人");
  assert.equal(A.danNote(20), "伝説の暗算王");
  assert.throws(() => A.danTitle(21), /段位/);
  assert.throws(() => A.danNote(-1), /段位/);
  assert.equal(A.streakTitle(0), "正解！");
  assert.equal(A.streakTitle(2), "正解！");
  assert.equal(A.streakTitle(3), "いい調子！");
  assert.equal(A.streakTitle(5), "ノッてきた！");
  assert.equal(A.streakTitle(10), "暗算マシーン！");
  assert.throws(() => A.streakTitle(-1));
});

/* ---------- records ---------- */
test("anzan: record keys only exist for real settings", () => {
  assert.equal(A.recordKey(2, 5, "normal"), "2-5-normal");
  assert.throws(() => A.recordKey(4, 5, "normal"), /記録/);
  assert.throws(() => A.recordKey(2, 7, "normal"), /記録/);
  assert.throws(() => A.recordKey(2, 5, "warp"), /記録/);
});

test("anzan: records from storage are cleaned", () => {
  assert.deepEqual(A.normalizeRecords(null), { free: {}, dan: 0 });
  assert.deepEqual(A.normalizeRecords([]), { free: {}, dan: 0 });
  const raw = { free: { "2-5-normal": 4, "9-5-normal": 3, "1-3-fast": -1, "1-3-slow": 2.5, "3-15-fast": 12 }, dan: 25 };
  assert.deepEqual(A.normalizeRecords(raw), { free: { "2-5-normal": 4, "3-15-fast": 12 }, dan: 0 });
  assert.deepEqual(A.normalizeRecords({ free: [1, 2], dan: 7 }), { free: {}, dan: 7 });
});

test("anzan: best streaks per setting only go up and never mutate the input", () => {
  const start = A.normalizeRecords(null);
  const a = A.addFree(start, "2-5-normal", 3);
  assert.equal(a.isNew, true);
  assert.equal(A.freeBest(a.records, "2-5-normal"), 3);
  assert.deepEqual(start, { free: {}, dan: 0 });
  const b = A.addFree(a.records, "2-5-normal", 2);
  assert.equal(b.isNew, false);
  assert.equal(A.freeBest(b.records, "2-5-normal"), 3);
  const c = A.addFree(b.records, "1-3-fast", 1);
  assert.deepEqual(c.records.free, { "2-5-normal": 3, "1-3-fast": 1 });
  assert.equal(A.addFree(c.records, "1-3-fast", 0).isNew, false);
  assert.throws(() => A.addFree(start, "2-5-normal", -1));
  assert.throws(() => A.addFree(start, "bad", 1), /記録/);
});

test("anzan: the best dan only goes up", () => {
  const a = A.addDan(null, 5);
  assert.deepEqual(a, { records: { free: {}, dan: 5 }, isNew: true });
  assert.equal(A.addDan(a.records, 4).isNew, false);
  assert.equal(A.addDan(a.records, 5).isNew, false);
  assert.equal(A.addDan(a.records, 20).records.dan, 20);
  assert.throws(() => A.addDan(a.records, 21), /段位/);
});

/* ---------- 自由に: streaks and when to celebrate ---------- */
test("anzan: a new try after a miss celebrates when it beats the best set earlier in the same visit", () => {
  const play = (state, results, bestOf) => results.reduce((acc, ok) => {
    const best = Math.max(bestOf.value, acc.state.streak);
    const next = A.freeStep(acc.state, ok, best);
    if (ok) bestOf.value = Math.max(bestOf.value, next.streak);
    const { cheer, ...rest } = next;
    return { state: rest, cheers: [...acc.cheers, cheer] };
  }, { state, cheers: [] });
  /* No record yet: the first record is saved quietly. After a miss, beating it is a real 新記録. */
  const best = { value: 0 };
  const a = play({ streak: 0, startBest: 0, celebrated: false }, [true, true, false, true, true, true], best);
  assert.deepEqual(a.cheers, [false, false, false, false, false, true]);
  assert.equal(best.value, 3);
  /* With an earlier best of 2: one celebration per try, not one per answer. */
  const best2 = { value: 2 };
  const b = play({ streak: 0, startBest: 2, celebrated: false }, [true, true, true, true, false, true, true, true, true, true], best2);
  assert.deepEqual(b.cheers, [false, false, true, false, false, false, false, false, false, true]);
  const frozen = Object.freeze({ streak: 1, startBest: 1, celebrated: false });
  assert.deepEqual(A.freeStep(frozen, true, 0), { streak: 2, startBest: 1, celebrated: true, cheer: true });
  assert.deepEqual(frozen, { streak: 1, startBest: 1, celebrated: false }, "input is not changed");
  assert.deepEqual(A.freeStep(frozen, false, 4), { streak: 0, startBest: 4, celebrated: false, cheer: false });
  assert.throws(() => A.freeStep(null, true, 0), /状態/);
  assert.throws(() => A.freeStep({ streak: -1, startBest: 0 }, true, 0), /状態/);
  assert.throws(() => A.freeStep(frozen, false, -2), /自己ベスト/);
});

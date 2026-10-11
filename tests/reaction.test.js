const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/reaction-rules.js");

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
/* Plays a whole round with the given reaction times. */
function play(trials, mode, times) {
  return times.reduce((round, ms) => T.tap(round, ms, () => 0.5).round, T.newRound(trials, mode, () => 0.5));
}

/* ---------- constants ---------- */
test("reaction: options, modes and limits", () => {
  assert.deepEqual([...T.TRIAL_OPTIONS], [3, 5, 10]);
  assert.deepEqual([...T.MODE_IDS], ["eye", "ear"]);
  assert.deepEqual(T.MODE_IDS.map(id => T.MODES[id].label), ["目で反応", "耳で反応"]);
  assert.deepEqual({ ...T.DEFAULT_SETTINGS }, { trials: 5, mode: "eye" });
  assert.deepEqual({ ...T.WAIT }, { min: 1500, max: 5000 });
  assert.equal(T.GUESS_MS, 100);
  assert.equal(T.TIMEOUT_MS, 3000);
  [T.TRIAL_OPTIONS, T.MODE_IDS, T.MODES, T.WAIT, T.RANKS, ...T.RANKS].forEach(x => assert.ok(Object.isFrozen(x)));
});

/* ---------- waits ---------- */
test("reaction: waits stay between 1.5 and 5 seconds and follow the random source", () => {
  assert.equal(T.planWait(() => 0), 1500);
  assert.equal(T.planWait(() => 0.999999), 5000);
  assert.equal(T.planWait(() => 0.5), 3250);
  const r = lcg(7);
  const waits = Array.from({ length: 2000 }, () => T.planWait(r));
  waits.forEach(w => assert.ok(Number.isInteger(w) && w >= 1500 && w <= 5000, String(w)));
  assert.ok(new Set(waits).size > 500, "waits are spread out, not predictable");
  assert.ok(Math.min(...waits) < 1700 && Math.max(...waits) > 4800, "the whole range is used");
});

test("reaction: new round checks its settings", () => {
  const round = T.newRound(5, "eye", () => 0);
  assert.deepEqual(round, { trials: 5, mode: "eye", times: [], fouls: 0, wait: 1500 });
  assert.equal(T.newRound(10, "ear", () => 0.999999).wait, 5000);
  assert.throws(() => T.newRound(4, "eye"), /回数/);
  assert.throws(() => T.newRound("5", "eye"), /回数/);
  assert.throws(() => T.newRound(5, "nose"), /合図/);
  assert.throws(() => T.newRound(5, undefined), /合図/);
});

/* ---------- taps ---------- */
test("reaction: judging a tap", () => {
  assert.deepEqual(T.judge(null), { kind: "early" });
  assert.deepEqual(T.judge(undefined), { kind: "early" });
  assert.deepEqual(T.judge(-30), { kind: "early" });
  assert.deepEqual(T.judge(0), { kind: "guess" });
  assert.deepEqual(T.judge(99.9), { kind: "guess" });
  assert.deepEqual(T.judge(100), { kind: "ok", ms: 100 });
  assert.deepEqual(T.judge(231.6), { kind: "ok", ms: 232 });
  assert.deepEqual(T.judge(3000), { kind: "ok", ms: 3000 });
  assert.deepEqual(T.judge(3000.5), { kind: "late" });
  assert.throws(() => T.judge(NaN), /時間/);
  assert.throws(() => T.judge(Infinity), /時間/);
  assert.equal(T.isFoul("early"), true);
  assert.equal(T.isFoul("guess"), true);
  assert.equal(T.isFoul("late"), false);
  assert.equal(T.isFoul("ok"), false);
});

test("reaction: a good tap is recorded and the next wait is planned", () => {
  const start = T.newRound(3, "eye", () => 0);
  const { round, outcome } = T.tap(start, 245.4, () => 0.5);
  assert.deepEqual(outcome, { kind: "ok", ms: 245 });
  assert.deepEqual(round.times, [245]);
  assert.equal(round.wait, 3250);
  assert.equal(round.fouls, 0);
  assert.deepEqual(start.times, [], "input round is not changed");
  assert.equal(start.wait, 1500);
  assert.equal(T.trialNumber(start), 1);
  assert.equal(T.trialNumber(round), 2);
});

test("reaction: a false start replays the same trial with a new wait", () => {
  const start = T.newRound(5, "eye", () => 0);
  const early = T.tap(start, null, () => 0.999999);
  assert.equal(early.outcome.kind, "early");
  assert.deepEqual(early.round.times, []);
  assert.equal(early.round.fouls, 1);
  assert.equal(early.round.wait, 5000, "a fresh wait so the timing cannot be learned");
  assert.equal(T.trialNumber(early.round), 1);
  const guess = T.tap(early.round, 40, () => 0);
  assert.equal(guess.outcome.kind, "guess");
  assert.equal(guess.round.fouls, 2);
  assert.deepEqual(guess.round.times, []);
  assert.equal(start.fouls, 0, "input round is not changed");
});

test("reaction: a late tap or a retry replays the trial without a foul", () => {
  const start = T.newRound(5, "ear", () => 0);
  const late = T.tap(start, 4000, () => 0.5);
  assert.equal(late.outcome.kind, "late");
  assert.equal(late.round.fouls, 0);
  assert.deepEqual(late.round.times, []);
  assert.equal(late.round.wait, 3250);
  const again = T.retry(start, () => 0.999999);
  assert.equal(again.wait, 5000);
  assert.equal(again.fouls, 0);
  assert.equal(start.wait, 1500);
});

test("reaction: a round finishes after the chosen number of good taps", () => {
  let round = T.newRound(3, "eye", () => 0.2);
  round = T.tap(round, 300, () => 0.1).round;
  round = T.tap(round, null, () => 0.1).round;
  round = T.tap(round, 250, () => 0.1).round;
  assert.equal(T.finished(round), false);
  const last = T.tap(round, 200, () => 0.1);
  assert.equal(T.finished(last.round), true);
  assert.equal(last.round.wait, null);
  assert.deepEqual(last.round.times, [300, 250, 200]);
  assert.equal(last.round.fouls, 1);
  assert.equal(T.trialNumber(last.round), 3);
  assert.throws(() => T.tap(last.round, 200), /終わって/);
  assert.throws(() => T.retry(last.round), /終わって/);
});

test("reaction: taps reject broken rounds", () => {
  assert.throws(() => T.tap(null, 200), /ラウンド/);
  assert.throws(() => T.tap({ trials: 5, mode: "eye" }, 200), /ラウンド/);
  assert.throws(() => T.tap({ trials: 7, mode: "eye", times: [], fouls: 0 }, 200), /回数/);
  assert.throws(() => T.tap(T.newRound(5, "eye"), NaN), /時間/);
});

/* ---------- scoring ---------- */
test("reaction: average, best and worst", () => {
  assert.equal(T.average([200, 300]), 250);
  assert.equal(T.average([201, 202]), 202, "rounded");
  assert.equal(T.average([]), null);
  assert.equal(T.best([310, 205, 260]), 205);
  assert.equal(T.worst([310, 205, 260]), 310);
  assert.equal(T.best([]), null);
  assert.equal(T.worst([]), null);
  assert.throws(() => T.average([200, "x"]), /タイム/);
  assert.throws(() => T.best([-1]), /タイム/);
  assert.throws(() => T.worst(null), /タイム/);
});

test("reaction: rank title thresholds", () => {
  const title = (ms) => T.rankFor(ms).title;
  assert.equal(title(0), "チーター級");
  assert.equal(title(199), "チーター級");
  assert.equal(title(199.9), "チーター級");
  assert.equal(title(200), "ハヤブサ級");
  assert.equal(title(249), "ハヤブサ級");
  assert.equal(title(250), "ネコ級");
  assert.equal(title(299), "ネコ級");
  assert.equal(title(300), "イヌ級");
  assert.equal(title(399), "イヌ級");
  assert.equal(title(400), "カメ級");
  assert.equal(title(2999), "カメ級");
  assert.deepEqual(T.RANKS.map(r => r.under), [200, 250, 300, 400, Infinity]);
  T.RANKS.forEach(r => assert.ok(r.title && r.note && r.id));
  assert.throws(() => T.rankFor(-5), /タイム/);
  assert.throws(() => T.rankFor(NaN), /タイム/);
});

test("reaction: how far to the next title", () => {
  assert.equal(T.nextRank(150), null);
  assert.equal(T.nextRank(199), null);
  assert.deepEqual(T.nextRank(200), { rank: T.RANKS[0], gap: 1 });
  assert.deepEqual(T.nextRank(262), { rank: T.RANKS[1], gap: 13 });
  assert.deepEqual(T.nextRank(400), { rank: T.RANKS[3], gap: 1 });
  assert.deepEqual(T.nextRank(520), { rank: T.RANKS[3], gap: 121 });
  for (let ms = 100; ms <= 3000; ms += 7) {
    const next = T.nextRank(ms);
    if (next) assert.equal(T.rankFor(ms - next.gap), next.rank, `${ms} - ${next.gap}`);
  }
});

test("reaction: per-trial badge only goes to a trial that is strictly the fastest so far", () => {
  assert.equal(T.trialBadge([240], null), null, "first tap ever: nothing to compare with");
  assert.equal(T.trialBadge([240], 250), "record");
  assert.equal(T.trialBadge([240], 240), null, "a tie with the stored best is not a new best");
  assert.equal(T.trialBadge([260, 240], null), "round");
  /* Regression: a slower trial that still beat the stored best used to say 自己ベスト更新 a second time. */
  assert.equal(T.trialBadge([220, 230], 250), null);
  /* Regression: a tie with an earlier trial used to say 今回のベスト. */
  assert.equal(T.trialBadge([233, 234, 233], null), null);
  assert.equal(T.trialBadge([220, 230, 210], 250), "record");
  assert.equal(T.trialBadge([300, 280], 200), "round");
  assert.throws(() => T.trialBadge([], null), /タイム/);
  assert.throws(() => T.trialBadge([200, "x"], null), /タイム/);
  assert.throws(() => T.trialBadge([200], NaN), /自己ベスト/);
});

test("reaction: round summary", () => {
  const round = play(5, "ear", [240, 210, 330, 190, 280]);
  const s = T.summary(round);
  assert.deepEqual(s.times, [240, 210, 330, 190, 280]);
  assert.equal(s.average, 250);
  assert.equal(s.best, 190);
  assert.equal(s.worst, 330);
  assert.equal(s.rank.title, "ネコ級");
  assert.equal(s.mode, "ear");
  assert.equal(s.trials, 5);
  assert.equal(s.fouls, 0);
  const empty = T.summary(T.newRound(3, "eye"));
  assert.equal(empty.average, null);
  assert.equal(empty.rank, null);
});

/* ---------- records ---------- */
test("reaction: records are validated on load", () => {
  const empty = T.normalizeRecords(null);
  assert.deepEqual(empty.eye, { single: null, avg: { 3: null, 5: null, 10: null } });
  assert.deepEqual(empty.ear, { single: null, avg: { 3: null, 5: null, 10: null } });
  const messy = T.normalizeRecords({
    eye: { single: 180, avg: { 3: 220, 5: "250", 10: -4, 7: 100 } },
    ear: { single: 50, avg: [1, 2] },
    nose: { single: 1 }
  });
  assert.equal(messy.eye.single, 180);
  assert.deepEqual(messy.eye.avg, { 3: 220, 5: null, 10: null });
  assert.equal(messy.ear.single, null, "faster than a human is not kept");
  assert.deepEqual(messy.ear.avg, { 3: null, 5: null, 10: null });
  assert.equal(messy.nose, undefined);
  assert.deepEqual(T.normalizeRecords([1, 2]), empty);
  assert.deepEqual(T.normalizeRecords("x"), empty);
  assert.deepEqual(T.normalizeRecords({ eye: { single: 200.5 } }).eye.single, null);
  assert.deepEqual(T.normalizeRecords(JSON.parse(JSON.stringify(messy))), messy, "survives a JSON round trip");
});

test("reaction: first round sets both records", () => {
  const round = play(3, "eye", [260, 240, 250]);
  const res = T.applyRecords(null, round);
  assert.equal(res.newAverage, true);
  assert.equal(res.newSingle, true);
  assert.deepEqual(res.previous, { average: null, single: null });
  assert.equal(res.records.eye.avg[3], 250);
  assert.equal(res.records.eye.single, 240);
  assert.equal(res.records.eye.avg[5], null);
  assert.equal(res.records.ear.single, null);
  assert.deepEqual(T.bestOf(res.records, "eye", 3), { average: 250, single: 240 });
});

test("reaction: only better results replace records; the input is untouched", () => {
  const first = T.applyRecords(null, play(3, "eye", [260, 240, 250])).records;
  const frozen = JSON.stringify(first);
  const slower = T.applyRecords(first, play(3, "eye", [300, 230, 310]));
  assert.equal(slower.newAverage, false);
  assert.equal(slower.newSingle, true);
  assert.equal(slower.records.eye.avg[3], 250);
  assert.equal(slower.records.eye.single, 230);
  assert.deepEqual(slower.previous, { average: 250, single: 240 });
  const tie = T.applyRecords(slower.records, play(3, "eye", [250, 250, 250]));
  assert.equal(tie.newAverage, false, "a tie is not a new record");
  const other = T.applyRecords(slower.records, play(5, "eye", [400, 400, 400, 400, 400]));
  assert.equal(other.newAverage, true, "each trial count keeps its own average");
  assert.equal(other.newSingle, false);
  assert.equal(other.records.eye.avg[3], 250);
  assert.equal(other.records.eye.avg[5], 400);
  const ear = T.applyRecords(other.records, play(3, "ear", [500, 500, 500]));
  assert.equal(ear.newSingle, true, "each mode keeps its own best");
  assert.equal(ear.records.eye.single, 230);
  assert.equal(JSON.stringify(first), frozen);
});

test("reaction: records need a finished round", () => {
  assert.throws(() => T.applyRecords(null, T.newRound(3, "eye")), /終わって/);
  assert.throws(() => T.applyRecords(null, null), /ラウンド/);
  assert.throws(() => T.bestOf(null, "nose", 3), /合図/);
  assert.throws(() => T.bestOf(null, "eye", 4), /回数/);
});

test("reaction: many random rounds always produce consistent results", () => {
  const r = lcg(42);
  for (let n = 0; n < 300; n++) {
    const trials = T.TRIAL_OPTIONS[n % 3];
    let round = T.newRound(trials, T.MODE_IDS[n % 2], r);
    let fouls = 0;
    let guard = 0;
    while (!T.finished(round) && guard++ < 200) {
      const x = r();
      const since = x < 0.15 ? null : x < 0.2 ? r() * 99 : x < 0.25 ? 3001 + r() * 2000 : 100 + r() * 600;
      const res = T.tap(round, since, r);
      if (T.isFoul(res.outcome.kind)) fouls++;
      round = res.round;
      if (!T.finished(round)) assert.ok(round.wait >= 1500 && round.wait <= 5000);
    }
    assert.equal(round.times.length, trials);
    assert.equal(round.fouls, fouls);
    const s = T.summary(round);
    assert.ok(s.best <= s.average && s.average <= s.worst);
    assert.equal(s.rank, T.rankFor(s.average));
    const rec = T.applyRecords(null, round);
    assert.equal(rec.records[round.mode].avg[trials], s.average);
    assert.equal(rec.records[round.mode].single, s.best);
  }
});

/* ---------- settings ---------- */
test("reaction: settings are validated on load", () => {
  assert.deepEqual(T.normalizeSettings(null), { trials: 5, mode: "eye" });
  assert.deepEqual(T.normalizeSettings({ trials: 10, mode: "ear" }), { trials: 10, mode: "ear" });
  assert.deepEqual(T.normalizeSettings({ trials: "10", mode: "nose" }), { trials: 5, mode: "eye" });
  assert.deepEqual(T.normalizeSettings([3]), { trials: 5, mode: "eye" });
});

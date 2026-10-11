const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rhythm-rules.js");

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

/* ---------- constants and word lists ---------- */
test("rhythm: games, tempos and speed-up settings", () => {
  assert.deepEqual([...R.GAME_IDS], ["koko", "banana", "shiri"]);
  assert.deepEqual(R.GAME_IDS.map(id => R.GAMES[id].label), ["古今東西", "マジカルバナナ", "しりとり"]);
  assert.deepEqual(R.TEMPO_IDS.map(id => R.TEMPOS[id].bpm), [90, 110, 130]);
  assert.deepEqual(R.TEMPO_IDS.map(id => R.TEMPOS[id].label), ["ゆっくり", "ふつう", "はやい"]);
  assert.deepEqual({ ...R.SPEEDUP }, { step: 6, every: 8, max: 40 });
  assert.equal(R.BEATS_PER_BAR, 4);
});

test("rhythm: lists are frozen, unique and non-empty", () => {
  [R.THEMES, R.BANANA_WORDS, R.SHIRITORI_WORDS, R.GAME_IDS, R.GAMES, R.TEMPOS].forEach(x => assert.ok(Object.isFrozen(x)));
  assert.ok(R.THEMES.length >= 55, "about 60 themes");
  assert.ok(R.BANANA_WORDS.length >= 20);
  assert.ok(R.SHIRITORI_WORDS.length >= 20);
  [R.THEMES, R.BANANA_WORDS, R.SHIRITORI_WORDS].forEach(list => {
    assert.equal(new Set(list).size, list.length, "no duplicates");
    list.forEach(w => assert.ok(typeof w === "string" && w.trim() === w && w.length > 0));
  });
  ["果物", "赤いもの", "国の名前", "スポーツ", "文房具"].forEach(t => assert.ok(R.THEMES.includes(t), t));
});

test("rhythm: しりとり start words are hiragana and never end with ん", () => {
  R.SHIRITORI_WORDS.forEach(w => {
    assert.match(w, /^[ぁ-ゖー]+$/, w);
    assert.notEqual(R.nextKana(w), "ん", w);
  });
});

/* ---------- tempo ---------- */
test("rhythm: tempo goes up 6 BPM every 8 bars, capped at +40", () => {
  for (let bar = 0; bar < 8; bar++) assert.equal(R.tempoAt(110, bar), 110);
  assert.equal(R.tempoAt(110, 8), 116);
  assert.equal(R.tempoAt(110, 15), 116);
  assert.equal(R.tempoAt(110, 16), 122);
  assert.equal(R.tempoAt(90, 48), 126);
  assert.equal(R.tempoAt(90, 56), 130, "+42 is capped at +40");
  assert.equal(R.tempoAt(130, 1000), 170);
});

test("rhythm: tempo stays put without speed-up and during the count-in", () => {
  [0, 8, 64, 500].forEach(bar => assert.equal(R.tempoAt(110, bar, false), 110));
  assert.equal(R.tempoAt(130, -1), 130);
  assert.equal(R.tempoAt(130, -1, true), 130);
});

test("rhythm: tempo rejects bad input", () => {
  [0, -10, NaN, Infinity, "110", null, undefined, 1000].forEach(b => assert.throws(() => R.tempoAt(b, 0), Error));
  [1.5, -2, "3", NaN, null].forEach(bar => assert.throws(() => R.tempoAt(110, bar), Error));
});

test("rhythm: speed-up bars", () => {
  const ups = Array.from({ length: 80 }, (_, bar) => bar).filter(bar => R.isSpeedUp(110, bar));
  assert.deepEqual(ups, [8, 16, 24, 32, 40, 48, 56]);
  assert.equal(R.isSpeedUp(110, 8, false), false);
  assert.equal(R.isSpeedUp(110, 0), false);
  assert.equal(R.isSpeedUp(110, -1), false);
});

/* ---------- beat positions ---------- */
test("rhythm: beats run count-in, then loop bars, each step one beat long", () => {
  let pos = R.firstBeat(120, 10);
  assert.deepEqual(pos, { bar: -1, step: 0, t: 10, bpm: 120 });
  const seen = [];
  for (let i = 0; i < 9; i++) {
    seen.push([pos.bar, pos.step]);
    pos = R.nextBeat(pos, 120, true);
  }
  assert.deepEqual(seen, [[-1, 0], [-1, 1], [-1, 2], [-1, 3], [0, 0], [0, 1], [0, 2], [0, 3], [1, 0]]);
  assert.ok(Math.abs(pos.t - (10 + 9 * 0.5)) < 1e-9);
});

test("rhythm: the beat gets shorter when the tempo goes up", () => {
  let pos = { bar: 7, step: 3, t: 0, bpm: 100 };
  pos = R.nextBeat(pos, 100, true);
  assert.deepEqual([pos.bar, pos.step, pos.bpm], [8, 0, 106]);
  assert.ok(Math.abs(pos.t - 0.6) < 1e-9, "the last beat of bar 7 still uses 100 BPM");
  const after = R.nextBeat(pos, 100, true);
  assert.ok(Math.abs(after.t - pos.t - 60 / 106) < 1e-9);
  assert.equal(R.nextBeat({ bar: 7, step: 3, t: 0, bpm: 100 }, 100, false).bpm, 100);
});

test("rhythm: nextBeat does not change its input and rejects bad positions", () => {
  const pos = Object.freeze({ bar: 0, step: 1, t: 2, bpm: 110 });
  const next = R.nextBeat(pos, 110);
  assert.notEqual(next, pos);
  assert.deepEqual(pos, { bar: 0, step: 1, t: 2, bpm: 110 });
  assert.throws(() => R.nextBeat(null, 110));
  assert.throws(() => R.nextBeat({ bar: 0, step: 4, t: 0, bpm: 110 }, 110));
  assert.throws(() => R.nextBeat({ bar: 0, step: 0, t: NaN, bpm: 110 }, 110));
  assert.throws(() => R.nextBeat({ bar: 0, step: 0, t: 0, bpm: 0 }, 110));
  assert.throws(() => R.nextBeat({ bar: -3, step: 0, t: 0, bpm: 110 }, 110));
});

test("rhythm: cues for the count-in and the clap-clap-say loop", () => {
  assert.deepEqual([0, 1, 2, 3].map(s => R.cueFor(-1, s).text), ["3", "2", "1", "はい！"]);
  assert.ok([0, 1, 2, 3].every(s => R.cueFor(-1, s).kind === "count" && !R.cueFor(-1, s).answer));
  assert.deepEqual([0, 1, 2, 3].map(s => R.cueFor(5, s).text), ["パン", "パン", "いま！", "いま！"]);
  assert.deepEqual([0, 1, 2, 3].map(s => R.cueFor(5, s).kind), ["clap", "clap", "now", "now"]);
  assert.deepEqual([0, 1, 2, 3].map(s => R.cueFor(0, s).answer), [false, false, true, false], "one answer per bar");
  assert.deepEqual([0, 1, 2, 3].map(s => R.cueFor(0, s).soft), [false, false, false, true]);
  assert.throws(() => R.cueFor(0, 4));
  assert.throws(() => R.cueFor(0, -1));
  assert.throws(() => R.cueFor(-2, 0));
});

/* ---------- prompts ---------- */
test("rhythm: pickTheme uses the injected random source", () => {
  assert.equal(R.pickTheme([], () => 0).theme, R.THEMES[0]);
  assert.equal(R.pickTheme([], () => 0.999999).theme, R.THEMES[R.THEMES.length - 1]);
  assert.equal(R.pickTheme([R.THEMES[0]], () => 0).theme, R.THEMES[1], "skips used ones");
  assert.equal(R.pickTheme([], () => 0, "banana").theme, R.BANANA_WORDS[0]);
  assert.equal(R.pickTheme([], () => 0, "shiri").theme, R.SHIRITORI_WORDS[0]);
});

test("rhythm: no theme repeats until every one was used", () => {
  R.GAME_IDS.forEach(game => {
    const pool = { koko: R.THEMES, banana: R.BANANA_WORDS, shiri: R.SHIRITORI_WORDS }[game];
    const r = lcg(42);
    let used = [];
    const seen = [];
    for (let i = 0; i < pool.length; i++) {
      const next = R.pickTheme(used, r, game);
      used = next.used;
      seen.push(next.theme);
    }
    assert.equal(new Set(seen).size, pool.length, game);
    assert.deepEqual([...seen].sort(), [...pool].sort());
    const again = R.pickTheme(used, () => 0, game);
    assert.deepEqual(again.used, [again.theme], "starts over");
    assert.notEqual(again.theme, used[used.length - 1], "never the same as the last one");
  });
});

test("rhythm: pickTheme does not change the used list and ignores unknown entries", () => {
  const used = Object.freeze(["果物", "存在しないお題"]);
  const next = R.pickTheme(used, seq(0.5));
  assert.deepEqual(used, ["果物", "存在しないお題"]);
  assert.notEqual(next.theme, "果物");
  assert.deepEqual(next.used, ["果物", "存在しないお題", next.theme]);
});

test("rhythm: pickTheme rejects bad input", () => {
  [null, undefined, "果物", { length: 0 }].forEach(u => assert.throws(() => R.pickTheme(u), Error));
  assert.throws(() => R.pickTheme([], Math.random, "uno"), Error);
});

test("rhythm: nextKana handles long vowels, small kana and katakana", () => {
  assert.equal(R.nextKana("りんご"), "ご");
  assert.equal(R.nextKana("しりとり"), "り");
  assert.equal(R.nextKana("でんしゃ"), "や");
  assert.equal(R.nextKana("きっぷっ"), "つ");
  assert.equal(R.nextKana("ちーずー"), "ず");
  assert.equal(R.nextKana("コーヒー"), "ひ");
  assert.equal(R.nextKana("スキー"), "き");
  assert.equal(R.nextKana(" ねこ "), "こ");
  assert.equal(R.nextKana("らーめん"), "ん");
  ["", "   ", "ー", "ーー", 12, null].forEach(w => assert.throws(() => R.nextKana(w), Error));
});

test("rhythm: prompt text for each game", () => {
  const k = R.promptView("koko", "果物");
  assert.equal(k.label, "古今東西");
  assert.equal(k.main, "果物");
  assert.match(k.sub, /古今東西/);
  const b = R.promptView("banana", "バナナ");
  assert.equal(b.main, "バナナ");
  assert.match(b.sub, /◯◯といったら△△/);
  assert.equal(b.title, "バナナといったら…");
  const s = R.promptView("shiri", "りんご");
  assert.equal(s.main, "りんご");
  assert.match(s.sub, /「ご」から/);
  assert.match(s.title, /「ご」/);
  assert.throws(() => R.promptView("uno", "a"));
  assert.throws(() => R.promptView("koko", ""));
  assert.throws(() => R.promptView("koko", 3));
});

/* ---------- results and records ---------- */
test("rhythm: answer beats heard so far, by beat position", () => {
  assert.deepEqual([0, 1, 2, 3].map(s => R.answersAt(-1, s)), [0, 0, 0, 0], "none in the count-in");
  assert.deepEqual([0, 1, 2, 3].map(s => R.answersAt(0, s)), [0, 0, 1, 1]);
  assert.deepEqual([0, 1, 2, 3].map(s => R.answersAt(5, s)), [5, 5, 6, 6]);
  [[-2, 0], [0, 4], [0, -1], [1.5, 0], ["1", 0], [0, null]].forEach(([bar, step]) => assert.throws(() => R.answersAt(bar, step), Error));
});

test("rhythm: answersAt matches counting the answer cues beat by beat", () => {
  let pos = R.firstBeat(110, 0);
  let counted = 0;
  for (let i = 0; i < 4 * 40; i++) {
    if (R.cueFor(pos.bar, pos.step).answer) counted++;
    assert.equal(R.answersAt(pos.bar, pos.step), counted, `bar ${pos.bar} step ${pos.step}`);
    pos = R.nextBeat(pos, 110, true);
  }
});

test("rhythm: the live bar counter equals the result at every beat (regression)", () => {
  /* The screen used to show the bar number at the start of each bar, so an アウト during パン・パン of bar 2
   * showed 2 on screen but gave 1 in the result. Both now come from survived(answersAt(...)). */
  assert.equal(R.survived(R.answersAt(2, 0)), 1, "during パン of bar 2");
  assert.equal(R.survived(R.answersAt(2, 1)), 1);
  assert.equal(R.survived(R.answersAt(2, 2)), 2, "from いま！ of bar 2");
  assert.equal(R.survived(R.answersAt(0, 3)), 0);
  assert.equal(R.survived(R.answersAt(-1, 3)), 0);
});

test("rhythm: アウト is not accepted during the count-in (regression)", () => {
  /* A double tap on スタート used to land on the アウト button and end the run during "3・2・1". */
  assert.equal(R.outAllowed(-1), false);
  [0, 1, 8, 99].forEach(bar => assert.equal(R.outAllowed(bar), true));
  [-2, 1.5, "0", null].forEach(bar => assert.throws(() => R.outAllowed(bar), Error));
  assert.ok(Number.isInteger(R.INPUT_LOCK_MS) && R.INPUT_LOCK_MS >= 300 && R.INPUT_LOCK_MS <= 700, "long enough to swallow a double tap");
});

test("rhythm: survived bars do not count the missed answer", () => {
  assert.equal(R.survived(0), 0);
  assert.equal(R.survived(1), 0);
  assert.equal(R.survived(2), 1);
  assert.equal(R.survived(13), 12);
  [-1, 1.5, "3", NaN, null].forEach(n => assert.throws(() => R.survived(n), Error));
});

test("rhythm: records load safely from anything", () => {
  const zero = { koko: 0, banana: 0, shiri: 0 };
  [null, undefined, 5, "x", [], [3, 4]].forEach(raw => assert.deepEqual(R.normalizeRecords(raw), zero));
  assert.deepEqual(
    R.normalizeRecords({ koko: 12, banana: -3, shiri: 2.5, extra: 99 }),
    { koko: 12, banana: 0, shiri: 0 }
  );
  assert.deepEqual(R.normalizeRecords({ koko: "12", banana: 1e9, shiri: 4 }), { koko: 0, banana: R.MAX_RECORD, shiri: 4 });
});

test("rhythm: a longer run is a new record; equal or shorter is not", () => {
  const before = Object.freeze({ koko: 10, banana: 3, shiri: 0 });
  const better = R.applyRecord(before, "koko", 11);
  assert.equal(better.isNew, true);
  assert.equal(better.previous, 10);
  assert.deepEqual(better.records, { koko: 11, banana: 3, shiri: 0 });
  assert.deepEqual(before, { koko: 10, banana: 3, shiri: 0 }, "input untouched");
  const same = R.applyRecord(before, "koko", 10);
  assert.equal(same.isNew, false);
  assert.deepEqual(same.records, { koko: 10, banana: 3, shiri: 0 });
  assert.equal(R.applyRecord(before, "banana", 1).isNew, false);
  assert.equal(R.applyRecord(before, "shiri", 0).isNew, false, "zero bars is never a record");
  assert.equal(R.applyRecord(before, "shiri", 1).isNew, true);
});

test("rhythm: records are kept per game and validated", () => {
  const r = R.applyRecord({ koko: "bad" }, "shiri", 7);
  assert.deepEqual(r.records, { koko: 0, banana: 0, shiri: 7 });
  assert.equal(R.applyRecord(null, "banana", 20000).records.banana, R.MAX_RECORD);
  assert.throws(() => R.applyRecord({}, "uno", 3), Error);
  [-1, 2.5, "3", null].forEach(b => assert.throws(() => R.applyRecord({}, "koko", b), Error));
});

test("rhythm: settings load safely", () => {
  const def = { game: "koko", tempo: "normal", accel: true };
  [null, undefined, "x", 3, []].forEach(raw => assert.deepEqual(R.normalizeSettings(raw), def));
  assert.deepEqual(R.normalizeSettings({ game: "shiri", tempo: "fast", accel: false }), { game: "shiri", tempo: "fast", accel: false });
  assert.deepEqual(R.normalizeSettings({ game: "uno", tempo: 110, accel: "no" }), def);
  const raw = Object.freeze({ game: "banana", tempo: "slow", accel: false, junk: 1 });
  const s = R.normalizeSettings(raw);
  assert.deepEqual(s, { game: "banana", tempo: "slow", accel: false });
  assert.notEqual(s, raw);
});

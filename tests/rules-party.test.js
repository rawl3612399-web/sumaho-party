const test = require("node:test");
const assert = require("node:assert/strict");
const Rand = require("../src/random.js");
const W = require("../src/wordwolf-rules.js");
const B = require("../src/bomb-rules.js");
const A = require("../src/atekko-rules.js");
const K = require("../src/kachikan-rules.js");
const T = require("../src/stop-rules.js");
const N = require("../src/numbomb-rules.js");

/* Repeatable random source. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("random: shuffle keeps every item and does not change the input", () => {
  const input = [1, 2, 3, 4, 5];
  const out = Rand.shuffle(input, seq(0.1, 0.9, 0.5, 0.3));
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
  assert.equal(Rand.between(10, 20, () => 0), 10);
  assert.equal(Rand.between(10, 20, () => 0.999999), 20);
});

/* ---------- word wolf ---------- */
test("wordwolf: wolves get the other word; everyone else shares one", () => {
  const r = W.newRound(5, 1, ["犬", "猫"], seq(0.2, 0.7, 0.1, 0.4, 0.9));
  assert.equal(r.words.length, 5);
  assert.equal(r.wolves.length, 1);
  r.words.forEach((w, i) => assert.equal(w, r.wolves.includes(i) ? r.minority : r.majority));
  assert.notEqual(r.majority, r.minority);
});

test("wordwolf: player and wolf limits", () => {
  assert.throws(() => W.newRound(2, 1, ["a", "b"]));
  assert.throws(() => W.newRound(9, 1, ["a", "b"]));
  assert.throws(() => W.newRound(5, 2, ["a", "b"]));
  assert.equal(W.newRound(6, 2, ["a", "b"]).wolves.length, 2);
});

test("wordwolf: pairs are not repeated until all are used", () => {
  let used = [];
  const seen = new Set();
  for (let i = 0; i < W.PAIRS.length; i++) {
    const next = W.nextPair(used);
    used = next.used;
    seen.add(next.pair.join("/"));
  }
  assert.equal(seen.size, W.PAIRS.length);
  assert.equal(W.nextPair(used).used.length, 1);
  assert.equal(new Set(W.PAIRS.map(p => p.join("/"))).size, W.PAIRS.length, "no duplicate pairs");
});

/* ---------- bomb ---------- */
test("bomb: fuse stays in its range; ticks speed up", () => {
  Object.keys(B.FUSES).forEach(k => {
    assert.equal(B.fuseMs(k, () => 0), B.FUSES[k].min);
    assert.equal(B.fuseMs(k, () => 0.999999), B.FUSES[k].max);
  });
  assert.throws(() => B.fuseMs("forever"));
  assert.equal(B.tickInterval(0), 700);
  assert.equal(B.tickInterval(1), 150);
  assert.ok(B.tickInterval(0.5) < B.tickInterval(0.2));
  assert.equal(B.tickInterval(2), 150);
});

test("bomb: prompt kinds", () => {
  assert.equal(B.makePrompt("kana").kind, "kana");
  assert.match(B.makePrompt("kana").text, /^「.」で始まる言葉$/);
  assert.equal(B.makePrompt("genre").kind, "genre");
  assert.throws(() => B.makePrompt("other"));
});

/* ---------- forehead quiz ---------- */
test("atekko: answers move through the deck and count correct ones", () => {
  let s = A.newRound(["a", "b", "c", "a"], () => 0.5);
  assert.equal(s.deck.length, 3);
  const first = A.current(s);
  s = A.answer(s, true);
  s = A.answer(s, false);
  assert.equal(A.score(s), 1);
  assert.equal(s.results[0].word, first);
  s = A.answer(A.answer(s, true), true);
  assert.equal(A.current(s), s.deck[1], "wraps around after the last word");
  assert.throws(() => A.newRound([]));
});

/* ---------- value numbers ---------- */
test("kachikan: dealt numbers are unique and in range", () => {
  const d = K.deal(8);
  assert.equal(new Set(d.numbers).size, 8);
  d.numbers.forEach(n => assert.ok(n >= 1 && n <= 100));
  assert.throws(() => K.deal(1));
  assert.throws(() => K.deal(9));
});

test("kachikan: judge marks rows smaller than the one before", () => {
  const numbers = [40, 10, 90, 60];
  const perfect = K.judgeOrder(numbers, [1, 0, 3, 2]);
  assert.equal(perfect.perfect, true);
  const wrong = K.judgeOrder(numbers, [1, 3, 0, 2]);
  assert.equal(wrong.perfect, false);
  assert.equal(wrong.misses, 1);
  assert.deepEqual(wrong.rows.map(r => r.ok), [true, true, false, true]);
  assert.throws(() => K.judgeOrder(numbers, [1, 1, 0, 2]));
  assert.throws(() => K.judgeOrder(numbers, [1, 0]));
});

/* ---------- stop at 10 ---------- */
test("stop: records turns and ranks by distance to the target", () => {
  let g = T.newGame(3, 10);
  g = T.record(g, 10400);
  g = T.record(g, 9950);
  g = T.record(g, 10050);
  assert.equal(T.finished(g), true);
  assert.throws(() => T.record(g, 10000));
  const r = T.ranking(g);
  assert.deepEqual(r.map(x => x.seat), [1, 2, 0]);
  assert.deepEqual(r.map(x => x.rank), [1, 1, 3], "equal distance shares the rank");
  assert.equal(r[0].diff, -50);
  assert.throws(() => T.newGame(3, 7));
  assert.throws(() => T.newGame(0, 10));
});

/* ---------- number bomb ---------- */
test("numbomb: the range closes in around the bomb", () => {
  let g = { ...N.newGame(100), secret: 42 };
  g = N.call(g, 50);
  assert.deepEqual([g.low, g.high], [1, 49]);
  g = N.call(g, 10);
  assert.deepEqual([g.low, g.high], [11, 49]);
  assert.match(N.callError(g, 50), /11〜49/);
  assert.throws(() => N.call(g, 5));
  g = N.call(N.call(g, 41), 43);
  assert.equal(N.cornered(g), true);
  g = N.call(g, 42);
  assert.equal(g.exploded, true);
  assert.throws(() => N.call(g, 42));
  assert.throws(() => N.newGame(77));
});

test("numbomb: secret is always inside the range", () => {
  N.MAXES.forEach(max => {
    assert.equal(N.newGame(max, () => 0).secret, 1);
    assert.equal(N.newGame(max, () => 0.999999).secret, max);
  });
});

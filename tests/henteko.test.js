const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../src/henteko-rules.js");

/* Repeatable random sources. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const snapshot = (v) => JSON.parse(JSON.stringify(v));
const countOf = (list, v) => list.filter(x => x === v).length;

/* Plays a whole game with random but repeatable decisions. Returns every state on the way. */
function playOut(players, kinds, seed) {
  const r = lcg(seed);
  let s = H.newGame(players, kinds, r);
  const states = [s];
  while (!H.isOver(s)) {
    if (s.phase === "flip") s = H.flip(s);
    else if (s.phase === "name") s = H.named(s);
    else s = r() < 0.3 ? H.nobody(s) : H.award(s, Math.floor(r() * players));
    states.push(s);
  }
  return states;
}

/* Sets up a game with a known deck order. */
const withDeck = (deck, players = 3) => ({ ...H.newGame(players, 6, lcg(1)), deck });

/* ---------- creatures ---------- */
test("henteko: a creature is the same for the same seed", () => {
  [0, 1, 42, 123456789, 0xffffffff].forEach(seed => {
    assert.deepEqual(H.generateCreature(seed), H.generateCreature(seed));
    assert.equal(H.generateCreature(seed).seed, seed);
  });
  const looks = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify({ ...H.generateCreature(i), seed: 0 })));
  assert.ok(looks.size >= 45, "different seeds give different creatures");
});

test("henteko: creature parts always come from the allowed lists", () => {
  for (let seed = 0; seed < 600; seed++) {
    const c = H.generateCreature(seed * 7919);
    assert.ok(H.BODIES.includes(c.body));
    assert.ok(H.COLORS.includes(c.color));
    assert.ok(H.COLORS.includes(c.accent));
    assert.notEqual(c.accent, c.color, "accessories use another color");
    assert.ok([1, 2, 3].includes(c.eyes.count));
    assert.ok(H.EYE_STYLES.includes(c.eyes.style));
    assert.ok(H.LOOKS.includes(c.eyes.look));
    assert.ok(H.MOUTHS.includes(c.mouth));
    assert.ok(H.TOPS.includes(c.top));
    assert.ok(H.ARMS.includes(c.arms));
    assert.ok(H.LEGS.includes(c.legs));
    assert.ok(H.PATTERNS.includes(c.pattern));
    assert.equal(typeof c.cheeks, "boolean");
    if (c.body === "ghost") assert.equal(c.legs, "none", "ghosts float");
  }
});

test("henteko: every body, eye count and part shows up across seeds", () => {
  const all = Array.from({ length: 3000 }, (_, i) => H.generateCreature(i));
  H.BODIES.forEach(b => assert.ok(all.some(c => c.body === b), b));
  H.COLORS.forEach(c => assert.ok(all.some(x => x.color === c), c));
  [1, 2, 3].forEach(n => assert.ok(all.some(c => c.eyes.count === n), `eyes ${n}`));
  H.TOPS.forEach(t => assert.ok(all.some(c => c.top === t), t));
  H.MOUTHS.forEach(m => assert.ok(all.some(c => c.mouth === m), m));
});

test("henteko: creatures are frozen and the color list uses game tokens only", () => {
  const c = H.generateCreature(5);
  assert.ok(Object.isFrozen(c));
  assert.ok(Object.isFrozen(c.eyes));
  assert.throws(() => { "use strict"; c.body = "round"; });
  H.COLORS.forEach(t => assert.match(t, /^--c-[a-z]+$/));
  assert.equal(new Set(H.COLORS).size, H.COLORS.length);
});

test("henteko: bad seeds are refused", () => {
  [-1, 1.5, NaN, "3", null, undefined, 2 ** 32].forEach(seed => assert.throws(() => H.generateCreature(seed), Error));
});

/* ---------- kinds in one game ---------- */
test("henteko: kinds in one game look clearly different", () => {
  H.KIND_COUNTS.forEach(count => {
    for (let seed = 1; seed <= 60; seed++) {
      const kinds = H.makeKinds(count, lcg(seed));
      assert.equal(kinds.length, count);
      assert.equal(new Set(kinds.map(k => k.color)).size, count, "no color twice");
      assert.equal(new Set(kinds.map(k => `${k.body}/${k.top}`)).size, count, "no silhouette twice");
      assert.equal(new Set(kinds.map(k => k.seed)).size, count, "no seed twice");
      kinds.forEach(k => assert.ok(H.COLORS.slice(0, count).includes(k.color), "uses the easy-to-tell colors first"));
      const cap = Math.ceil(count / H.BODIES.length);
      H.BODIES.forEach(b => assert.ok(countOf(kinds.map(k => k.body), b) <= cap, `body ${b} at most ${cap}`));
      kinds.forEach((a, i) => kinds.slice(i + 1).forEach(b => assert.ok(H.difference(a, b) >= H.MIN_DIFF)));
    }
  });
});

test("henteko: kinds are deterministic and each one can be rebuilt from its seed", () => {
  assert.deepEqual(H.makeKinds(8, lcg(99)), H.makeKinds(8, lcg(99)));
  assert.notDeepEqual(H.makeKinds(8, lcg(99)), H.makeKinds(8, lcg(100)));
  H.makeKinds(12, lcg(7)).forEach(k => assert.deepEqual(H.generateCreature(k.seed), k));
});

test("henteko: difference counts visible features", () => {
  const a = H.generateCreature(10);
  assert.equal(H.difference(a, a), 0);
  const b = { ...a, body: a.body === "round" ? "tall" : "round", mouth: a.mouth === "o" ? "smile" : "o" };
  assert.equal(H.difference(a, b), 2);
  assert.equal(H.difference(a, { ...a, seed: 1, cheeks: !a.cheeks }), 0, "seed and cheeks are not counted");
});

test("henteko: kind counts are checked", () => {
  [0, 13, 2.5, "8", null].forEach(n => assert.throws(() => H.makeKinds(n, lcg(1)), Error));
  assert.equal(H.makeKinds(1, lcg(1)).length, 1);
  assert.equal(new Set(H.makeKinds(3, lcg(2)).map(k => k.body)).size, 3, "3 kinds get 3 different bodies");
});

/* ---------- deck ---------- */
test("henteko: the deck holds each kind exactly 4 times", () => {
  assert.deepEqual(H.buildDeck(3), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
  assert.deepEqual(H.buildDeck(2, 2), [0, 0, 1, 1]);
  [0, -1, 1.5, "6"].forEach(n => assert.throws(() => H.buildDeck(n), Error));
  assert.throws(() => H.buildDeck(6, 0), Error);
  H.KIND_COUNTS.forEach(k => {
    const g = H.newGame(4, k, lcg(k));
    assert.equal(g.deck.length, k * H.COPIES);
    for (let kind = 0; kind < k; kind++) assert.equal(countOf(g.deck, kind), H.COPIES);
  });
});

test("henteko: shuffling is repeatable with the same random source", () => {
  const a = H.newGame(4, 12, lcg(5));
  const b = H.newGame(4, 12, lcg(5));
  const c = H.newGame(4, 12, lcg(6));
  assert.deepEqual(a.deck, b.deck);
  assert.deepEqual(a.kinds, b.kinds);
  assert.notDeepEqual(a.deck, c.deck);
  assert.notDeepEqual(a.deck, H.buildDeck(12), "the deck is shuffled");
});

/* ---------- new game ---------- */
test("henteko: a new game starts empty with seat A to flip", () => {
  const g = H.newGame(5, 8, lcg(3));
  assert.equal(g.players, 5);
  assert.equal(g.kinds.length, 8);
  assert.deepEqual(g.scores, [0, 0, 0, 0, 0]);
  assert.deepEqual(g.seen, Array(8).fill(0));
  assert.deepEqual(g.pile, []);
  assert.equal(g.next, 0);
  assert.equal(g.turn, 0);
  assert.equal(g.phase, "flip");
  assert.equal(g.card, null);
  assert.equal(H.remaining(g), 32);
});

test("henteko: player and kind limits", () => {
  [1, 9, 0, 2.5, "4", null].forEach(p => assert.throws(() => H.newGame(p, 8, lcg(1)), Error));
  [5, 7, 10, 13, "8", null].forEach(k => assert.throws(() => H.newGame(4, k, lcg(1)), Error));
  assert.equal(H.newGame(2, 6, lcg(1)).players, 2);
  assert.equal(H.newGame(8, 12, lcg(1)).players, 8);
});

/* ---------- flipping, naming, racing ---------- */
test("henteko: first sight asks for a name, the next sight starts a race", () => {
  let g = withDeck([2, 4, 2, 2, 4, 1]);
  g = H.flip(g);
  assert.equal(g.phase, "name");
  assert.deepEqual(g.card, { kind: 2, count: 1, first: true, by: 0 });
  assert.deepEqual(g.pile, [2]);
  assert.throws(() => H.flip(g), Error, "cannot flip before naming");
  assert.throws(() => H.award(g, 0), Error, "cannot take cards while naming");
  g = H.named(g);
  assert.equal(g.phase, "flip");
  assert.equal(g.turn, 1);
  g = H.named(H.flip(g));
  g = H.flip(g);
  assert.equal(g.phase, "race");
  assert.deepEqual(g.card, { kind: 2, count: 2, first: false, by: 2 });
  assert.deepEqual(g.pile, [2, 4, 2]);
  assert.throws(() => H.named(g), Error, "a known creature is not named again");
});

test("henteko: the winner of a race takes the whole pile", () => {
  let g = withDeck([0, 1, 0, 1, 2, 2]);
  g = H.named(H.flip(g));
  g = H.named(H.flip(g));
  g = H.award(H.flip(g), 2);
  assert.deepEqual(g.scores, [0, 0, 3]);
  assert.deepEqual(g.pile, []);
  assert.deepEqual(g.last, { type: "award", seat: 2, cards: 3 });
  assert.equal(g.phase, "flip");
  g = H.award(H.flip(g), 2);
  assert.deepEqual(g.scores, [0, 0, 4], "a pile of one card is still taken");
});

test("henteko: when nobody remembers, the pile stays and grows", () => {
  let g = withDeck([0, 0, 1, 1, 3, 3]);
  g = H.named(H.flip(g));
  g = H.nobody(H.flip(g));
  assert.deepEqual(g.pile, [0, 0]);
  assert.deepEqual(g.last, { type: "nobody", cards: 2 });
  assert.deepEqual(g.scores, [0, 0, 0]);
  g = H.named(H.flip(g));
  g = H.award(H.flip(g), 1);
  assert.deepEqual(g.scores, [0, 4, 0], "the next winner takes everything that piled up");
});

test("henteko: award checks the seat and the moment", () => {
  const race = H.flip(H.named(H.flip(withDeck([3, 3, 1, 1, 0, 0]))));
  assert.equal(race.phase, "race");
  [-1, 3, 1.5, "0", null].forEach(seat => assert.throws(() => H.award(race, seat), Error));
  assert.throws(() => H.nobody(withDeck([3, 3])), Error, "no pass before a race");
  assert.throws(() => H.flip(null), Error);
  assert.throws(() => H.flip({ phase: "flip" }), Error);
});

test("henteko: turns go around the table and wrap", () => {
  let g = withDeck(H.buildDeck(6).sort((a, b) => a - b), 2);
  const flippers = [];
  for (let i = 0; i < 5; i++) {
    g = H.flip(g);
    flippers.push(g.card.by);
    g = g.phase === "name" ? H.named(g) : H.nobody(g);
  }
  assert.deepEqual(flippers, [0, 1, 0, 1, 0]);
});

test("henteko: rules never change the state they are given", () => {
  const g0 = H.newGame(3, 6, lcg(11));
  const before = snapshot(g0);
  const g1 = H.flip(g0);
  assert.deepEqual(snapshot(g0), before);
  const s1 = snapshot(g1);
  const g2 = g1.phase === "name" ? H.named(g1) : H.award(g1, 0);
  assert.deepEqual(snapshot(g1), s1);
  assert.notEqual(g2, g1);
  const r = H.flip(H.named(H.flip(withDeck([5, 5, 0, 0]))));
  const rs = snapshot(r);
  H.award(r, 1);
  H.nobody(r);
  assert.deepEqual(snapshot(r), rs);
  assert.ok(Object.isFrozen(g0.kinds));
});

/* ---------- whole games ---------- */
test("henteko: whole games keep every card accounted for", () => {
  [[2, 6], [4, 8], [8, 12], [3, 12], [5, 6]].forEach(([players, kinds], n) => {
    const states = playOut(players, kinds, 100 + n);
    states.forEach(s => {
      const taken = s.scores.reduce((a, b) => a + b, 0);
      assert.equal(taken + s.pile.length, s.next, "cards revealed = cards taken + cards on the pile");
      assert.equal(s.seen.reduce((a, b) => a + b, 0), s.next);
      s.seen.forEach(v => assert.ok(v >= 0 && v <= H.COPIES));
    });
    const end = states[states.length - 1];
    assert.equal(end.phase, "over");
    assert.equal(H.remaining(end), 0);
    assert.deepEqual(end.seen, Array(kinds).fill(H.COPIES));
    assert.throws(() => H.flip(end), Error, "no flipping after the end");
  });
});

test("henteko: each kind is named exactly once per game", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const states = playOut(4, 8, seed);
    const firsts = states.filter((s, i) => i > 0 && s.phase === "name").map(s => s.card.kind);
    assert.equal(firsts.length, 8);
    assert.equal(new Set(firsts).size, 8, "no kind is new twice");
    const races = states.filter(s => s.phase === "race");
    assert.equal(races.length, 8 * (H.COPIES - 1));
  }
});

test("henteko: the last card ends the game whatever happens to it", () => {
  const resolve = (s) => (s.phase === "name" ? H.named(s) : H.nobody(s));
  const last = (deck, act) => {
    let g = withDeck(deck);
    while (H.remaining(g) > 1) g = resolve(H.flip(g));
    return act(H.flip(g));
  };
  assert.equal(last([0, 1], H.named).phase, "over");
  assert.equal(last([0, 0], g => H.award(g, 0)).phase, "over");
  const left = last([0, 0, 0], H.nobody);
  assert.equal(left.phase, "over");
  assert.equal(left.pile.length, 3, "a pile left at the end belongs to nobody");
});

/* ---------- ranking ---------- */
test("henteko: ranking puts the most cards first and shares tied ranks", () => {
  const g = { ...H.newGame(4, 6, lcg(1)), scores: [5, 9, 5, 0] };
  assert.deepEqual(H.ranking(g), [
    { seat: 1, cards: 9, rank: 1 },
    { seat: 0, cards: 5, rank: 2 },
    { seat: 2, cards: 5, rank: 2 },
    { seat: 3, cards: 0, rank: 4 }
  ]);
  assert.deepEqual(H.winners(g), [1]);
  assert.deepEqual(H.winners({ ...g, scores: [7, 2, 7, 1] }), [0, 2]);
  assert.deepEqual(H.winners({ ...g, scores: [0, 0, 0, 0] }), [], "nobody wins with no cards");
  assert.deepEqual(g.scores, [5, 9, 5, 0], "ranking does not reorder the scores");
});

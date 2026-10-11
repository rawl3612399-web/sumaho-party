const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../src/klondike-rules.js");
/* Slower machines (CI sets 3) get proportionally more time in the timing test. */
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1;

/* "10H" -> { suit: "H", rank: "10", id: "H10-0" }, the same shape as Cards.newDeck(). */
const card = (code) => ({ suit: code.slice(-1), rank: code.slice(0, -1), id: `${code.slice(-1)}${code.slice(0, -1)}-0` });
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const upTo = (suit, n) => RANKS.slice(0, n).map(r => r + suit);
const mv = (from, to, count = 1) => ({ type: "move", from, to, count });
const DRAW = { type: "draw" };

/* Builds a (possibly partial) state. cols: [{ down: [...codes], up: [...codes] }], found: 4 lists in S H D C order. */
function make({ draw = 1, stock = [], waste = [], found = [[], [], [], []], cols = [], moves = 0 } = {}) {
  const tableau = Array.from({ length: 7 }, (_, i) => {
    const c = cols[i] || {};
    const down = (c.down || []).map(card);
    return { cards: [...down, ...(c.up || []).map(card)], hidden: down.length };
  });
  return { draw, stock: stock.map(card), waste: waste.map(card), foundations: found.map(f => f.map(card)), tableau, moves, recycles: 0 };
}
const ids = (list) => list.map(c => c.id);
const deepCopy = (x) => JSON.parse(JSON.stringify(x));

/* Plays random legal actions from seeded deals and yields every position on the way. */
function* positions(seed, games, steps) {
  const r = K.seeded(seed);
  for (let g = 0; g < games; g++) {
    let s = K.deal(g % 2 ? 3 : 1, r);
    for (let i = 0; i < steps && !K.isWon(s); i++) {
      yield s;
      const all = K.legalActions(s);
      const moves = all.filter(a => a.type === "move");
      const pool = moves.length && r() < 0.75 ? moves : all;
      if (!pool.length) break;
      s = K.step(s, pool[Math.floor(r() * pool.length)]);
    }
  }
}

/* Follows hints until there is none (or the game is won). */
function playHints(state, cap = 3000) {
  let s = state;
  for (let i = 0; i < cap; i++) {
    if (K.isWon(s)) return { s, won: true, steps: i };
    const plan = K.finishPlan(s);
    if (plan) return { s: plan.reduce(K.step, s), won: true, steps: i + plan.length };
    const h = K.hint(s);
    if (!h) return { s, won: false, steps: i };
    s = K.step(s, h);
  }
  return { s, won: false, steps: cap, capped: true };
}

/* ---------- deal ---------- */
test("seeded: same seed gives the same numbers in [0, 1)", () => {
  const a = K.seeded(7);
  const b = K.seeded(7);
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b()));
  xs.forEach(x => assert.ok(x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, K.seeded(8)));
  assert.throws(() => K.seeded(1.5), /整数/);
});

test("deal: 7 columns of 1..7 cards, only the top face up, 24 in the stock", () => {
  const s = K.deal(1, K.seeded(42));
  s.tableau.forEach((c, i) => {
    assert.equal(c.cards.length, i + 1);
    assert.equal(c.hidden, i);
  });
  assert.equal(s.stock.length, 24);
  assert.deepEqual(s.waste, []);
  assert.deepEqual(s.foundations, [[], [], [], []]);
  assert.equal(new Set(ids([...s.stock, ...s.tableau.flatMap(c => c.cards)])).size, 52);
  assert.equal(s.moves, 0);
  assert.deepEqual(K.deal(1, K.seeded(42)), s, "same seed, same deal");
  assert.notDeepEqual(K.deal(1, K.seeded(43)), s);
  assert.equal(K.deal(3, K.seeded(1)).draw, 3);
  assert.throws(() => K.deal(2), /1枚か3枚/);
  assert.ok(K.restore(s));
});

test("deal: cards go out row by row, like at a real table", () => {
  const s = K.deal(1, () => 0.9999999); /* no swaps: deck stays S A..K, H, D, C */
  const deck = ["S", "H", "D", "C"].flatMap(suit => RANKS.map(r => r + suit));
  assert.deepEqual(ids(s.tableau[1].cards), ["S2-0", "S8-0"]);
  s.tableau.forEach((c, col) => c.cards.forEach((x, row) => assert.equal(deck[K.dealStep(col, row)] , x.rank + x.suit)));
  assert.equal(s.stock[s.stock.length - 1].id, "CK-0", "the last card dealt is the top of the stock");
  assert.equal(K.dealStep(6, 6), 27);
  assert.throws(() => K.dealStep(2, 3));
});

/* ---------- stock and waste ---------- */
test("draw: one card at a time in 1-card mode", () => {
  let s = make({ stock: ["AS", "2S", "3S"] });
  s = K.step(s, DRAW);
  assert.deepEqual(ids(s.waste), ["S3-0"]);
  assert.deepEqual(ids(s.stock), ["SA-0", "S2-0"]);
  assert.equal(s.moves, 1);
});

test("draw: 3-card mode flips three as a packet; the deepest one ends on top", () => {
  let s = make({ draw: 3, stock: ["AS", "2S", "3S", "4S", "5S"] });
  s = K.step(s, DRAW);
  assert.deepEqual(ids(s.waste), ["S5-0", "S4-0", "S3-0"]);
  s = K.step(s, DRAW);
  assert.deepEqual(ids(s.waste), ["S5-0", "S4-0", "S3-0", "S2-0", "SA-0"], "fewer than 3 left: take the rest");
  assert.equal(s.stock.length, 0);
});

test("draw: an empty stock turns the waste over, as often as you like", () => {
  const start = make({ draw: 3, stock: ["AS", "2S", "3S", "4S", "5S", "6S", "7S"] });
  let s = start;
  for (let pass = 1; pass <= 3; pass++) {
    while (s.stock.length) s = K.step(s, DRAW);
    s = K.step(s, DRAW);
    assert.deepEqual(s.stock, start.stock, "the stock comes back in its original order");
    assert.equal(s.waste.length, 0);
    assert.equal(s.recycles, pass);
  }
  assert.throws(() => K.step(make(), DRAW), /山札/);
  assert.equal(K.canDraw(make()), false);
  assert.equal(K.canDraw(make({ waste: ["AS"] })), true);
});

/* ---------- foundations ---------- */
test("foundation: A first, then the next rank of the same suit", () => {
  let s = make({ waste: ["AH"], cols: [{ up: ["2H"] }, { up: ["3H"] }, { up: ["AS"] }] });
  assert.match(K.moveError(s, mv("waste", "f0")), /Aから順/, "hearts do not go on the spade pile");
  s = K.step(s, mv("waste", "f1"));
  assert.match(K.moveError(s, mv("t1", "f1")), /Aから順/, "3 cannot skip the 2");
  s = K.step(K.step(s, mv("t0", "f1")), mv("t1", "f1"));
  assert.deepEqual(ids(s.foundations[1]), ["HA-0", "H2-0", "H3-0"]);
  assert.equal(K.foundationOf(card("QC")), "f3");
});

test("foundation: only one card at a time, and it can come back down", () => {
  const s = make({ found: [upTo("S", 5), [], [], []], cols: [{ up: ["7H", "6S"] }, { up: ["6D"] }] });
  assert.match(K.moveError(s, mv("t0", "f0", 2)), /1枚ずつ/);
  assert.equal(K.moveError(s, mv("f0", "t1")), null, "5 of spades onto the red 6");
  const back = K.step(s, mv("f0", "t1"));
  assert.deepEqual(ids(back.tableau[1].cards), ["D6-0", "S5-0"]);
  assert.equal(back.foundations[0].length, 4);
  assert.match(K.moveError(make({ waste: ["AS"] }), mv("f0", "t0")), /動かせません/, "empty foundation");
});

/* ---------- tableau ---------- */
test("tableau: one rank lower in the other color", () => {
  const s = make({ waste: ["6S"], cols: [{ up: ["7H"] }, { up: ["7C"] }, { up: ["8H"] }, { up: ["6D"] }] });
  assert.equal(K.moveError(s, mv("waste", "t0")), null);
  assert.match(K.moveError(s, mv("waste", "t1")), /色ちがい/, "black on black");
  assert.match(K.moveError(s, mv("waste", "t2")), /色ちがい/, "skips a rank");
  assert.match(K.moveError(s, mv("t3", "t0")), /色ちがい/, "red on red");
  assert.equal(K.moveError(s, mv("t3", "t1")), null);
});

test("tableau: only a K (or a run led by a K) may fill an empty column", () => {
  const s = make({ waste: ["QS"], cols: [{}, { down: ["2C"], up: ["KH", "QS", "JH"] }, { up: ["KD"] }] });
  assert.match(K.moveError(s, mv("waste", "t0")), /Kだけ/);
  assert.equal(K.moveError(s, mv("t1", "t0", 3)), null);
  assert.match(K.moveError(s, mv("t1", "t0", 2)), /Kだけ/);
  assert.equal(K.moveError(s, mv("t2", "t0")), null, "legal, even if it changes nothing");
});

test("tableau: moving a run keeps its order and turns up the card underneath", () => {
  const s = make({ cols: [{ down: ["AS", "4C"], up: ["9H", "8S", "7D"] }, { up: ["10C"] }, { up: ["8C"] }] });
  assert.match(K.moveError(s, mv("t0", "t1", 4)), /動かせません/, "face-down cards never move");
  const after = K.step(s, mv("t0", "t1", 3));
  assert.deepEqual(ids(after.tableau[1].cards), ["C10-0", "H9-0", "S8-0", "D7-0"]);
  assert.deepEqual(after.tableau[0], { cards: [card("AS"), card("4C")], hidden: 1 }, "the 4 of clubs turns face up");
  assert.equal(after.moves, 1);
  const partial = K.step(s, mv("t0", "t2", 1));
  assert.equal(partial.tableau[0].hidden, 2, "nothing to turn while face-up cards remain");
});

test("moves: bad input is rejected with a message", () => {
  const s = make({ waste: ["AS"], cols: [{ up: ["2H"] }] });
  assert.match(K.moveError(s, mv("x9", "f0")), /場所/);
  assert.match(K.moveError(s, mv("t0", "t0")), /同じ/);
  assert.match(K.moveError(s, mv("waste", "f0", 0)), /枚数/);
  assert.match(K.moveError(s, mv("waste", "f0", 2)), /動かせません/);
  assert.match(K.moveError(s, mv("t0", "waste")), /置けません/);
  assert.match(K.moveError(s, mv("stock", "t0")), /置けません/);
  assert.throws(() => K.step(s, { type: "jump" }), /操作/);
  assert.throws(() => K.step(s, null), /操作/);
  assert.throws(() => K.step(s, mv("t0", "f0")), /Aから順/);
});

/* ---------- history ---------- */
test("undo: unlimited, back to the exact earlier states", () => {
  let g = K.newGame(1, K.seeded(5));
  const seen = [g.state];
  for (let i = 0; i < 30; i++) {
    g = K.play(g, K.hint(g.state) || DRAW);
    seen.push(g.state);
  }
  assert.equal(g.history.length, 30);
  for (let i = 29; i >= 0; i--) {
    g = K.undo(g);
    assert.equal(g.state, seen[i]);
  }
  assert.equal(K.canUndo(g), false);
  assert.throws(() => K.undo(g), /もどせる手/);
});

test("immutability: nothing changes the state it was given", () => {
  for (const s of positions(11, 6, 80)) {
    const before = deepCopy(s);
    K.legalActions(s).forEach(a => K.step(s, a));
    K.hint(s);
    K.finishPlan(s);
    K.targets(s, "waste", 1);
    K.restore(s);
    assert.deepEqual(s, before);
  }
  const g = K.newGame(3, K.seeded(2));
  const copy = deepCopy(g);
  K.undo(K.play(g, DRAW));
  assert.deepEqual(g, copy);
});

/* ---------- tap to move ---------- */
test("targets: foundation first for a single card, then columns to the right, then one empty column", () => {
  const s = make({
    waste: ["AH"],
    found: [upTo("S", 6), [], [], []],
    cols: [{ down: ["3C"], up: ["7S"] }, {}, { up: ["8H"] }, {}, { up: ["8D"] }, { up: ["2C"] }, { up: ["KC"] }]
  });
  assert.deepEqual(K.targets(s, "t0", 1), ["f0", "t2", "t4"]);
  assert.deepEqual(K.targets(s, "waste", 1), ["f1", "t5"]);
  assert.deepEqual(K.targets(s, "t4", 1), [], "8 of diamonds has nowhere to go");
  assert.deepEqual(K.targets(s, "t6", 1), [], "a lone K never hops to another empty column");
  const king = make({ cols: [{}, { down: ["2C"], up: ["KH"] }, {}] });
  assert.deepEqual(K.targets(king, "t1", 1), ["t2"], "only the first empty column, starting right of the source");
});

/* ---------- finishing ---------- */
test("win: all 52 cards on the foundations", () => {
  const s = make({ found: [upTo("S", 13), upTo("H", 13), upTo("D", 13), upTo("C", 12)], cols: [{ up: ["KC"] }] });
  assert.equal(K.isWon(s), false);
  const won = K.step(s, mv("t0", "f3"));
  assert.equal(K.isWon(won), true);
  assert.equal(K.canFinish(won), false, "nothing left to finish");
});

test("finishPlan: once every card is face up, the plan sends them all home", () => {
  const s = make({
    stock: ["QS", "10C"],
    waste: ["JC"],
    found: [upTo("S", 9), upTo("H", 10), upTo("D", 11), upTo("C", 9)],
    cols: [{ up: ["KS", "QD", "JS"] }, { up: ["KH", "QC", "JH", "10S"] }, { up: ["KD"] }, { up: ["KC", "QH"] }]
  });
  assert.ok(K.restore(s), "a complete, legal position");
  const plan = K.finishPlan(s);
  assert.ok(plan && plan.length > 0);
  assert.equal(K.isWon(plan.reduce(K.step, s)), true);
  assert.equal(K.canFinish(s), true);
  assert.deepEqual(plan[0], mv("t1", "f0"), "the lowest card flies first");
  assert.ok(plan.some(a => a.type === "draw"), "draws from the stock on the way");
});

test("finishPlan: not offered while a card is still face down", () => {
  const hidden = make({ found: [upTo("S", 11), upTo("H", 13), upTo("D", 13), upTo("C", 13)], cols: [{ down: ["QS"], up: ["KS"] }] });
  assert.equal(K.finishPlan(hidden), null);
  assert.equal(K.canFinish(hidden), false);
});

test("finishPlan: a 3-card stock that loops forever gets a card laid on the tableau first", () => {
  /* K, J, Q left: turning three at a time always brings the K up, never the J. */
  const loop = make({ draw: 3, stock: ["KS", "JS", "QS"], found: [upTo("S", 10), upTo("H", 13), upTo("D", 13), upTo("C", 13)] });
  const plan = K.finishPlan(loop);
  assert.ok(plan, "park the K in an empty column, then the J and Q come up");
  assert.ok(plan.some(a => a.type === "move" && a.from === "waste" && a.to[0] === "t"));
  assert.equal(K.isWon(plan.reduce(K.step, loop)), true);
  assert.deepEqual(K.hint(K.step(loop, DRAW)), mv("waste", "t0"), "the hint finds the same way out");
});

test("finishPlan: pulls cards back down from the foundations when that is the only way out", () => {
  /* The waste always shows the J of spades; the 9 underneath it never comes up. The K of hearts goes to an empty
   * column, the Q of hearts onto the K of spades, then the J of spades can leave the waste, and so on. */
  const s = make({
    draw: 3,
    waste: ["9S", "QD", "JS"],
    found: [upTo("S", 8), upTo("H", 13), upTo("D", 10), upTo("C", 13)],
    cols: [{}, { up: ["KS"] }, { up: ["KD", "QS", "JD", "10S"] }]
  });
  assert.ok(K.restore(s), "a complete, legal position");
  assert.equal(K.hint(s), null, "the plain hint sees no way");
  const plan = K.finishPlan(s);
  assert.ok(plan);
  assert.deepEqual(plan.slice(0, 3), [mv("f1", "t0"), mv("f1", "t1"), mv("waste", "t1")]);
  assert.equal(K.isWon(plan.reduce(K.step, s)), true);
});

test("finishPlan: a dead end with every card face up offers nothing", () => {
  /* Only the 10 and J of spades ever come up, and no column or foundation can take them. */
  const s = make({
    draw: 3,
    stock: ["JS", "10S", "9S", "8C"],
    found: [upTo("S", 8), upTo("H", 13), upTo("D", 13), upTo("C", 7)],
    cols: ["KS", "QS", "KC", "QC", "JC", "10C", "9C"].map(c => ({ up: [c] }))
  });
  assert.ok(K.restore(s));
  assert.equal(K.finishPlan(s), null);
  assert.equal(K.hint(s), null);
});

test("finishPlan: every plan on the way through real games is legal and wins", () => {
  let checked = 0;
  for (let seed = 1; seed <= 120; seed++) {
    let s = K.deal(seed % 3 ? 3 : 1, K.seeded(seed * 104729));
    for (let i = 0; i < 400 && !K.isWon(s); i++) {
      const plan = K.finishPlan(s);
      if (plan) {
        checked++;
        assert.equal(K.isWon(plan.reduce(K.step, s)), true, `seed ${seed}`);
        break;
      }
      const h = K.hint(s);
      if (!h) break;
      s = K.step(s, h);
    }
  }
  assert.ok(checked >= 30, `${checked} plans checked`);
});

/* ---------- loading saved games ---------- */
test("restore: accepts real games (also after JSON), rejects broken ones", () => {
  for (const s of positions(3, 4, 60)) {
    const back = K.restore(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(back, s);
  }
  const s = K.deal(1, K.seeded(9));
  const notAce = s.stock.find(c => c.id !== "SA-0");
  const broken = [
    null, "x", 42, {}, { ...s, draw: 2 }, { ...s, moves: -1 }, { ...s, stock: s.stock.slice(1) },
    { ...s, stock: [...s.stock.slice(1), s.stock[1]] },
    { ...s, tableau: s.tableau.slice(1) },
    { ...s, tableau: s.tableau.map((c, i) => (i === 3 ? { ...c, hidden: 4 } : c)) },
    { ...s, tableau: s.tableau.map((c, i) => (i === 3 ? { ...c, hidden: 1.5 } : c)) },
    { ...s, foundations: [[notAce], [], [], []], stock: s.stock.filter(c => c !== notAce) },
    { ...s, stock: [{ suit: "X", rank: "A", id: "XA-0" }, ...s.stock.slice(1)] },
    { ...s, stock: [{ suit: "S", rank: "toString", id: "StoString-0" }, ...s.stock.slice(1)] }
  ];
  broken.forEach((b, i) => assert.equal(K.restore(b), null, `case ${i}`));
  const plain = K.deal(1, () => 0.9999999);
  assert.ok(K.restore(plain));
  const badRun = { ...plain, tableau: plain.tableau.map((c, i) => (i === 1 ? { ...c, hidden: 0 } : c)) };
  assert.equal(K.restore(badRun), null, "2 and 8 of spades are not a run");
});

test("records: wins, best time and fewest moves per draw mode; junk from storage is ignored", () => {
  assert.deepEqual(K.readRecord("junk"), { 1: { wins: 0, time: null, moves: null }, 3: { wins: 0, time: null, moves: null } });
  assert.deepEqual(K.readRecord({ 1: { wins: -2, time: 0, moves: 1.5 }, 3: null })[1], { wins: 0, time: null, moves: null });
  const first = K.addWin(null, 1, 300, 120);
  assert.equal(first.best, false, "the first win is not a new best");
  assert.deepEqual(first.record[1], { wins: 1, time: 300, moves: 120 });
  const slower = K.addWin(JSON.parse(JSON.stringify(first.record)), 1, 400, 100);
  assert.equal(slower.best, true, "fewer moves counts as a new best");
  assert.deepEqual(slower.record[1], { wins: 2, time: 300, moves: 100 });
  assert.deepEqual(slower.record[3], { wins: 0, time: null, moves: null });
  assert.equal(K.addWin(slower.record, 1, 500, 200).best, false);
  assert.throws(() => K.addWin({}, 2, 10, 10), /記録/);
  assert.throws(() => K.addWin({}, 1, 0, 10), /記録/);
});

/* ---------- hints ---------- */
test("hint: always a legal action, never a pull from the foundations", () => {
  let count = 0;
  for (const s of positions(21, 16, 120)) {
    const h = K.hint(s);
    if (!h) continue;
    count++;
    assert.equal(K.actionError(s, h), null);
    if (h.type === "move") assert.notEqual(h.from[0], "f");
  }
  assert.ok(count > 600);
});

test("hint: aces first, then turning up hidden cards", () => {
  const ace = make({ stock: ["5D"], cols: [{ up: ["AC"] }, { down: ["3S"], up: ["9H"] }, { up: ["10S"] }] });
  assert.deepEqual(K.hint(ace), mv("t0", "f3"));
  const reveal = make({ stock: ["5D"], waste: ["4C"], cols: [{ down: ["3S"], up: ["9H"] }, { up: ["10S"] }, { down: ["2D", "2C"], up: ["9D"] }, { up: ["10C"] }] });
  assert.deepEqual(K.hint(reveal), mv("t2", "t1"), "prefers the column with more hidden cards");
});

test("hint: draws only when a card in the stock can be used, otherwise says it is stuck", () => {
  const useful = make({ stock: ["AD", "9C"], cols: [{ up: ["KH"] }] });
  assert.deepEqual(K.hint(useful), DRAW);
  const useless = make({ stock: ["9C", "4H"], waste: ["7C"], cols: [{ up: ["KH"] }] });
  assert.equal(K.hint(useless), null);
  assert.equal(K.hint(make({ cols: [{ up: ["KH"] }] })), null);
});

test("hint: a run moves off a card that can go home", () => {
  const s = make({
    stock: ["9C"],
    found: [upTo("S", 7), [], [], []],
    cols: [{ up: ["8S", "7H"] }, { up: ["8C"] }, { up: ["KH"] }]
  });
  assert.deepEqual(K.hint(s), mv("t0", "t1"));
});

test("hint quality: following hints always ends, and wins a fair share of deals", () => {
  const results = { 1: [], 3: [] };
  for (let seed = 1; seed <= 60; seed++) {
    [1, 3].forEach(draw => {
      const res = playHints(K.deal(draw, K.seeded(seed * 7919)));
      assert.ok(!res.capped, `seed ${seed} draw ${draw} looped`);
      results[draw].push(res.won);
    });
  }
  const rate = (list) => list.filter(Boolean).length / list.length;
  assert.ok(rate(results[1]) >= 0.3, `1-card win rate ${rate(results[1])}`);
  assert.ok(rate(results[3]) >= 0.07, `3-card win rate ${rate(results[3])}`);
});

/* Every position met while following hints in 3-card deals, so the endgames where the stock loops are timed too. */
function hintPath(seed) {
  const out = [];
  let s = K.deal(3, K.seeded(seed));
  for (let i = 0; i < 400 && !K.isWon(s); i++) {
    out.push(s);
    const h = K.hint(s);
    if (!h) break;
    s = K.step(s, h);
  }
  return out;
}

test("timing: hint, targets and finishPlan stay far under 150 ms on any position", () => {
  const endgames = Array.from({ length: 60 }, (_, i) => hintPath(i + 1)).flat().filter(K.allFaceUp);
  const all = [...positions(99, 24, 150), ...endgames];
  const think = (s) => {
    K.hint(s);
    K.finishPlan(s);
    K.targets(s, "waste", 1);
    s.tableau.forEach((_, i) => K.targets(s, `t${i}`, 1));
  };
  const timed = (s) => {
    const t0 = process.hrtime.bigint();
    think(s);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  all.slice(0, 200).forEach(think); /* warm up the JIT */
  /* A slow reading is timed twice more and the best is kept, so a garbage-collection pause is not counted. */
  const worst = Math.max(...all.map(s => {
    const once = timed(s);
    return once < 5 ? once : Math.min(once, timed(s), timed(s));
  }));
  assert.ok(all.length > 3000);
  assert.ok(endgames.length > 20, `${endgames.length} endgames`);
  assert.ok(worst < 50 * TIMING_SLACK, `worst ${worst.toFixed(2)} ms (3x margin under 150 ms)`);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/blackjack-rules.js");
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1; // CI machines are slower; the deploy workflow raises this

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
let serial = 0;
const card = (rank, suit = "S") => ({ suit, rank, id: `${suit}${rank}-t${serial++}` });
const cards = (...ranks) => ranks.map(r => card(String(r)));
/* Shoe in dealing order: player, dealer up, player, dealer hole, then every later card. Padded so it never runs out. */
const stacked = (...ranks) => R.shoeFrom([...cards(...ranks), ...cards(...Array(40).fill("5"))]);
const start = (ranks, bet = 100, chips = 1000) => R.startRound({ shoe: stacked(...ranks), chips, bet });
const snapshot = (x) => JSON.parse(JSON.stringify(x));
const up = (rank) => card(String(rank), "H");

/* ---------- totals ---------- */
test("hand values count aces as 1 or 11 and show soft totals", () => {
  assert.deepEqual(R.handValue(cards("A", 6)), { total: 17, hard: 7, soft: true, bust: false });
  assert.deepEqual(R.handValue(cards("A", 6, 10)), { total: 17, hard: 17, soft: false, bust: false });
  assert.equal(R.handValue(cards("A", "A")).total, 12);
  assert.equal(R.handValue(cards("A", "A", 9)).total, 21);
  assert.equal(R.handValue(cards("A", "A", "A", "A")).total, 14);
  assert.equal(R.handValue(cards("K", "Q", 2)).bust, true);
  assert.equal(R.handValue(cards("J", "Q")).total, 20);
  assert.equal(R.totalLabel(cards("A", 6)), "7 / 17");
  assert.equal(R.totalLabel(cards("A", "A", "A")), "3 / 13");
  assert.equal(R.totalLabel(cards("A", 5, 5)), "21");
  assert.equal(R.totalLabel(cards("A", "K")), "21");
  assert.equal(R.totalLabel(cards(10, 7)), "17");
  assert.equal(R.totalLabel(cards("A", 6, 10)), "17");
  assert.equal(R.cardValue(card("K")), 10);
  assert.equal(R.cardValue(card("A")), 1);
  assert.equal(R.cardValue(card("7")), 7);
});

test("a finished hand shows one total, not the soft pair (regression: split A+5 showed 「6 / 16」 at the end)", () => {
  assert.equal(R.totalLabel(cards("A", 5)), "6 / 16");
  assert.equal(R.totalLabel(cards("A", 5), true), "16");
  assert.equal(R.totalLabel(cards("A", 6), true), "17", "the dealer standing on soft 17 shows 17");
  assert.equal(R.totalLabel(cards(10, 7), true), "17");
  assert.equal(R.totalLabel(cards("A", "K"), true), "21");
  assert.equal(R.totalLabel(cards(10, 8, 9), true), "27");
});

test("blackjack is a two-card 21 only; 21 after a split is not a natural", () => {
  assert.equal(R.isBlackjack(cards("A", "K")), true);
  assert.equal(R.isBlackjack(cards("10", "A")), true);
  assert.equal(R.isBlackjack(cards(5, 6, "K")), false);
  assert.equal(R.isNatural({ cards: cards("A", "Q"), split: false }), true);
  assert.equal(R.isNatural({ cards: cards("A", "Q"), split: true }), false);
});

test("dealer stands on all 17s, soft 17 included", () => {
  assert.equal(R.dealerShouldHit(cards(10, 6)), true);
  assert.equal(R.dealerShouldHit(cards("A", 5)), true);
  assert.equal(R.dealerShouldHit(cards("A", 6)), false);
  assert.equal(R.dealerShouldHit(cards(10, 7)), false);
  assert.equal(R.dealerShouldHit(cards(2, 3, "A")), true);
  assert.equal(R.dealerShouldHit(cards(2, 3, "A", "A")), false, "A+A+2+3 is a soft 17");
  assert.equal(R.canPeek(card("A")), true);
  assert.equal(R.canPeek(card("Q")), true);
  assert.equal(R.canPeek(card("9")), false);
});

/* ---------- shoe ---------- */
test("shoe: 6 shuffled decks, drawn without changing the old shoe, reshuffled at 75%", () => {
  const shoe = R.newShoe(rng(1));
  assert.equal(shoe.cards.length, 312);
  assert.equal(new Set(shoe.cards.map(c => c.id)).size, 312);
  assert.equal(shoe.cards.filter(c => c.rank === "A").length, 24);
  assert.equal(R.remaining(shoe), 312);
  const d = R.draw(shoe);
  assert.equal(shoe.next, 0);
  assert.equal(d.shoe.next, 1);
  assert.equal(d.card, shoe.cards[0]);
  assert.equal(R.needsShuffle({ ...shoe, next: 233 }), false);
  assert.equal(R.needsShuffle({ ...shoe, next: 234 }), true);
  assert.throws(() => R.draw({ ...shoe, next: 312 }), /山札/);
  assert.throws(() => R.shoeFrom([]), /山札/);
  assert.throws(() => R.shoeFrom([{ suit: "X", rank: "A" }]), /山札/);
  assert.notDeepEqual(R.newShoe(rng(2)).cards.map(c => c.id), shoe.cards.map(c => c.id));
});

test("a new round shuffles a fresh shoe at the start and after 75% is dealt", () => {
  const first = R.startRound({ shoe: null, chips: 1000, bet: 10 }, rng(3));
  assert.equal(first.shuffled, true);
  assert.equal(R.remaining(first.shoe), 308);
  const mid = R.startRound({ shoe: { ...first.shoe, next: 200 }, chips: 1000, bet: 10 }, rng(3));
  assert.equal(mid.shuffled, false);
  assert.equal(mid.shoe.next, 204);
  const late = R.startRound({ shoe: { ...first.shoe, next: 240 }, chips: 1000, bet: 10 }, rng(3));
  assert.equal(late.shuffled, true);
  assert.equal(R.remaining(late.shoe), 308);
});

test("a long session reshuffles exactly at the cut and never runs the shoe dry", () => {
  const r = rng(4);
  let shoe = null;
  let shuffles = 0;
  for (let i = 0; i < 4000; i++) {
    const before = shoe;
    let round = R.startRound({ shoe, chips: 1e6, bet: 10 }, r);
    if (round.shuffled) {
      shuffles++;
      assert.ok(!before || before.next >= 234, "shuffled too early");
    } else {
      assert.ok(before.next < 234, "missed the cut card");
    }
    while (round.phase === "player") round = R.act(round, R.recommend(round));
    round = R.playDealer(round);
    shoe = round.shoe;
    assert.ok(R.remaining(shoe) > 0);
  }
  assert.ok(shuffles > 30, `only ${shuffles} shuffles`);
});

/* ---------- dealing and naturals ---------- */
test("deal order is player, dealer up card, player, dealer hole card; the bet leaves the chips", () => {
  const r = start([9, 7, 8, 10]);
  assert.deepEqual(r.hands[0].cards.map(c => c.rank), ["9", "8"]);
  assert.deepEqual(r.dealer.map(c => c.rank), ["7", "10"]);
  assert.equal(r.phase, "player");
  assert.equal(r.chips, 900);
  assert.equal(r.bet, 100);
  assert.equal(r.peeked, false);
  assert.equal(R.staked(r), 100);
});

test("bets must be 10 to 5000, in steps of 10, and within the chips", () => {
  assert.throws(() => start([9, 7, 8, 10], 5), /賭け/);
  assert.throws(() => start([9, 7, 8, 10], 15), /賭け/);
  assert.throws(() => start([9, 7, 8, 10], 1010, 1000), /賭け/);
  assert.throws(() => start([9, 7, 8, 10], 5010, 99999), /賭け/);
  assert.throws(() => start([9, 7, 8, 10], "100"), /賭け/);
  assert.throws(() => R.startRound({ shoe: null, chips: -10, bet: 10 }), /賭け/);
  assert.equal(start([9, 7, 8, 10], 1000, 1000).chips, 0);
  assert.equal(start([9, 7, 8, 10], 5000, 99999).chips, 94999);
});

test("player blackjack pays 3:2 at once", () => {
  const r = start(["A", 9, "K", 7], 100);
  assert.equal(r.phase, "done");
  assert.deepEqual(r.results, [{ outcome: "blackjack", bet: 100, ret: 250, net: 150 }]);
  assert.equal(r.chips, 1150);
  assert.equal(R.roundNet(r), 150);
  assert.deepEqual(R.legalActions(r), []);
  assert.equal(start(["A", 9, "K", 7], 10).chips, 1015);
  assert.equal(start(["A", 9, "K", 7], 50).results[0].net, 75);
});

test("dealer peeks with an ace or ten up: dealer blackjack ends the round before you act", () => {
  const lose = start([10, "A", "Q", "K"], 100);
  assert.equal(lose.peeked, true);
  assert.equal(lose.phase, "done");
  assert.equal(lose.results[0].outcome, "lose");
  assert.equal(lose.chips, 900);
  const tenUp = start([10, "K", 9, "A"], 100);
  assert.equal(tenUp.phase, "done");
  assert.equal(tenUp.results[0].outcome, "lose");
  const both = start(["A", "A", "K", "Q"], 100);
  assert.equal(both.results[0].outcome, "push");
  assert.equal(both.chips, 1000);
  const noBj = start([10, "A", 9, 9], 100);
  assert.equal(noBj.peeked, true);
  assert.equal(noBj.phase, "player");
  const noPeek = start([10, 9, 9, "A"], 100);
  assert.equal(noPeek.peeked, false);
  assert.equal(noPeek.phase, "player");
});

/* ---------- player actions ---------- */
test("legal actions: double on two cards, split on the same rank only, never after the player phase", () => {
  assert.deepEqual(R.legalActions(start([9, 7, 8, 10])), ["hit", "stand", "double"]);
  assert.deepEqual(R.legalActions(start([8, 7, 8, 10])), ["hit", "stand", "double", "split"]);
  assert.deepEqual(R.legalActions(start(["K", 7, "Q", 10])), ["hit", "stand", "double"]);
  assert.deepEqual(R.legalActions(start([8, 7, 8, 10], 600, 1000)), ["hit", "stand"]);
  const hit = R.act(start([2, 7, 3, 10, 4]), "hit");
  assert.deepEqual(R.legalActions(hit), ["hit", "stand"]);
  assert.throws(() => R.act(hit, "double"), /できません/);
  assert.throws(() => R.act(hit, "surrender"), /操作/);
  assert.deepEqual(R.legalActions(null), []);
});

test("hitting to a bust ends the round without the dealer drawing", () => {
  let r = start([10, 7, 6, 9, "K", 5]);
  r = R.act(r, "hit");
  assert.equal(r.phase, "done");
  assert.equal(r.dealer.length, 2);
  assert.equal(r.results[0].outcome, "bust");
  assert.equal(r.chips, 900);
  assert.throws(() => R.act(r, "hit"), /できません/);
});

test("reaching 21 stands automatically and hands over to the dealer", () => {
  const r = R.act(start([5, 7, 6, 10, "K"]), "hit");
  assert.equal(r.phase, "dealer");
  assert.equal(R.handValue(r.hands[0].cards).total, 21);
  const done = R.playDealer(r);
  assert.equal(done.results[0].outcome, "win");
  assert.equal(done.chips, 1100);
});

test("double: twice the bet, exactly one card, then the dealer", () => {
  const r = R.act(start([6, 6, 5, 10, "K", 9]), "double");
  assert.equal(r.hands[0].cards.length, 3);
  assert.equal(r.hands[0].bet, 200);
  assert.equal(r.hands[0].doubled, true);
  assert.equal(r.chips, 800);
  assert.equal(r.phase, "dealer");
  const done = R.playDealer(r);
  assert.deepEqual(done.dealer.map(c => c.rank), ["6", "10", "9"]);
  assert.equal(done.results[0].outcome, "win");
  assert.equal(done.results[0].net, 200);
  assert.equal(done.chips, 1200);
  const bust = R.act(start([10, 9, 2, 8, "K"]), "double");
  assert.equal(bust.phase, "done");
  assert.equal(bust.results[0].outcome, "bust");
  assert.equal(bust.chips, 800);
});

test("split: two hands with their own bets, second card dealt when each hand starts", () => {
  let r = start([8, 6, 8, 10, 3, "K", 2, 9, "K"]);
  r = R.act(r, "split");
  assert.equal(r.hands.length, 2);
  assert.deepEqual(r.hands.map(h => h.cards.map(c => c.rank)), [["8", "3"], ["8"]]);
  assert.equal(r.chips, 800);
  assert.equal(R.staked(r), 200);
  assert.equal(r.active, 0);
  assert.deepEqual(R.legalActions(r), ["hit", "stand", "double"]);
  r = R.act(r, "hit");
  assert.deepEqual(r.hands[0].cards.map(c => c.rank), ["8", "3", "K"]);
  assert.equal(r.active, 1, "21 stands and moves on");
  assert.deepEqual(r.hands[1].cards.map(c => c.rank), ["8", "2"]);
  r = R.act(r, "double");
  assert.equal(r.hands[1].bet, 200);
  assert.equal(r.chips, 700);
  assert.equal(r.phase, "dealer");
  const done = R.playDealer(r);
  assert.deepEqual(done.results.map(x => x.outcome), ["win", "win"]);
  assert.equal(done.chips, 700 + 200 + 400);
});

test("split only once; a new pair after a split cannot be split again", () => {
  const r = R.act(start([8, 6, 8, 10, 8, "K"]), "split");
  assert.deepEqual(r.hands[0].cards.map(c => c.rank), ["8", "8"]);
  assert.equal(R.legalActions(r).includes("split"), false);
});

test("split aces get one card each, and ace plus ten is 21 paid 1:1", () => {
  let r = start(["A", 7, "A", 10, "K", 5]);
  r = R.act(r, "split");
  assert.equal(r.phase, "dealer");
  assert.deepEqual(r.hands.map(h => h.cards.map(c => c.rank)), [["A", "K"], ["A", "5"]]);
  assert.ok(r.hands.every(h => h.done));
  assert.deepEqual(R.legalActions(r), []);
  const done = R.playDealer(r);
  assert.deepEqual(done.results.map(x => x.outcome), ["win", "lose"]);
  assert.equal(done.results[0].ret, 200, "not paid 3:2");
  assert.equal(done.chips, 1000);
});

test("split hands that both bust skip the dealer", () => {
  let r = start([9, 7, 9, 10, 5, "K", 4, "Q"]);
  r = R.act(r, "split");
  r = R.act(r, "hit");
  assert.equal(r.active, 1);
  r = R.act(r, "hit");
  assert.equal(r.phase, "done");
  assert.deepEqual(r.results.map(x => x.outcome), ["bust", "bust"]);
  assert.equal(r.dealer.length, 2);
  assert.equal(r.chips, 800);
});

/* ---------- dealer and payouts ---------- */
test("dealer draws to 17 and stands on soft 17", () => {
  const soft = R.playDealer(R.act(start([10, "A", 9, 6]), "stand"));
  assert.equal(soft.dealer.length, 2);
  assert.equal(soft.results[0].outcome, "win");
  const softStop = R.playDealer(R.act(start([10, 5, 8, "A", "A", 4]), "stand"));
  assert.deepEqual(softStop.dealer.map(c => c.rank), ["5", "A", "A"], "A+A+5 is a soft 17: stop");
  assert.equal(softStop.results[0].outcome, "win");
  const draws = R.playDealer(R.act(start([10, 2, 8, 3, 4, 2, 6, 9]), "stand"));
  assert.deepEqual(draws.dealer.map(c => c.rank), ["2", "3", "4", "2", "6"]);
  assert.equal(R.handValue(draws.dealer).total, 17);
  assert.equal(draws.results[0].outcome, "win");
  const beat = R.playDealer(R.act(start([10, 9, 7, 9]), "stand"));
  assert.equal(beat.results[0].outcome, "lose");
  const bust = R.playDealer(R.act(start([10, 6, 2, 10, "K"]), "stand"));
  assert.equal(bust.results[0].outcome, "win", "12 wins when the dealer busts");
  assert.throws(() => R.dealerStep(start([10, 6, 2, 10])), /ディーラー/);
});

test("equal totals push and return the bet", () => {
  const r = R.playDealer(R.act(start([10, 10, 8, 8]), "stand"));
  assert.deepEqual(r.results[0], { outcome: "push", bet: 100, ret: 100, net: 0 });
  assert.equal(r.chips, 1000);
});

test("chips are conserved: final chips = starting chips + net", () => {
  const r = rng(5);
  let shoe = null;
  let chips = 1e6;
  for (let i = 0; i < 1500; i++) {
    const bet = 10 * (1 + Math.floor(r() * 50));
    let round = R.startRound({ shoe, chips, bet }, r);
    while (round.phase === "player") {
      const legal = R.legalActions(round);
      round = R.act(round, legal[Math.floor(r() * legal.length)]);
    }
    round = R.playDealer(round);
    assert.equal(round.chips, chips + R.roundNet(round));
    round.results.forEach(x => assert.ok(["blackjack", "win", "lose", "push", "bust"].includes(x.outcome)));
    chips = round.chips;
    shoe = round.shoe;
  }
});

test("rules never change the round they are given", () => {
  const rounds = [start([8, 6, 8, 10, 3, "K", 2, 9]), start([5, 7, 6, 10, "K"]), start(["A", 7, "A", 10, "K", 5])];
  rounds.forEach(r0 => {
    const before = snapshot(r0);
    R.legalActions(r0);
    R.recommend(r0);
    const next = R.act(r0, R.legalActions(r0).includes("split") ? "split" : "hit");
    assert.deepEqual(snapshot(r0), before);
    if (next.phase === "dealer") {
      const mid = snapshot(next);
      R.playDealer(next);
      assert.deepEqual(snapshot(next), mid);
    }
  });
  const shoe = R.newShoe(rng(6));
  const ids = shoe.cards.map(c => c.id);
  R.startRound({ shoe, chips: 1000, bet: 10 });
  assert.deepEqual(shoe.cards.map(c => c.id), ids);
  assert.equal(shoe.next, 0);
});

/* ---------- chips ---------- */
test("chip helpers: stacks, limits, repeat bet, broke, stored data", () => {
  assert.deepEqual(R.chipStack(160), [100, 50, 10]);
  assert.deepEqual(R.chipStack(1070), [500, 500, 50, 10, 10]);
  assert.deepEqual(R.chipStack(0), []);
  assert.throws(() => R.chipStack(-10), /チップ/);
  assert.equal(R.maxBet(1000), 1000);
  assert.equal(R.maxBet(99999), 5000);
  assert.equal(R.maxBet(25), 20);
  assert.equal(R.canAddChip(950, 50, 1000), true);
  assert.equal(R.canAddChip(960, 50, 1000), false);
  assert.equal(R.canAddChip(0, 25, 1000), false);
  assert.equal(R.repeatBet(500, 300), 300);
  assert.equal(R.repeatBet(100, 1000), 100);
  assert.equal(R.repeatBet(0, 1000), 0);
  assert.equal(R.isBroke(9), true);
  assert.equal(R.isBroke(10), false);
  assert.deepEqual(R.normalizeBank(null), { chips: 1000, last: 0, best: 1000 });
  assert.deepEqual(R.normalizeBank({ chips: "lots", last: 7, best: -1 }), { chips: 1000, last: 0, best: 1000 });
  assert.deepEqual(R.normalizeBank({ chips: 2500, last: 200, best: 4000 }), { chips: 2500, last: 200, best: 4000 });
  assert.deepEqual(R.normalizeBank({ chips: 0, last: 100, best: 1200 }), { chips: 0, last: 100, best: 1200 });
  assert.equal(R.normalizeBank({ chips: 3000, best: 2000 }).best, 3000);
  assert.equal(R.normalizeBank({ chips: 1.5 }).chips, 1000);
});

/* ---------- basic strategy ---------- */
const advise = (ranks, dealer, opts = { double: true, split: true }) => R.strategy(cards(...ranks), up(dealer), opts);

test("strategy: hard totals (S17, multi-deck)", () => {
  assert.equal(advise([10, 6], 10), "hit");
  assert.equal(advise([10, 6], 6), "stand");
  assert.equal(advise([10, 5], "A"), "hit");
  assert.equal(advise([10, 2], 2), "hit");
  assert.equal(advise([10, 2], 3), "hit");
  assert.equal(advise([10, 2], 4), "stand");
  assert.equal(advise([10, 2], 7), "hit");
  assert.equal(advise([10, 3], 2), "stand");
  assert.equal(advise([6, 5], 10), "double");
  assert.equal(advise([6, 5], "A"), "hit", "S17: 11 against an ace is a hit");
  assert.equal(advise([6, 4], 9), "double");
  assert.equal(advise([6, 4], 10), "hit");
  assert.equal(advise([5, 4], 2), "hit");
  assert.equal(advise([5, 4], 3), "double");
  assert.equal(advise([5, 4], 7), "hit");
  assert.equal(advise([5, 3], 6), "hit");
  assert.equal(advise([10, 7], "A"), "stand");
  assert.equal(advise([10, "Q"], 6), "stand");
});

test("strategy: soft totals", () => {
  assert.equal(advise(["A", 7], 2), "stand", "S17: soft 18 stands against 2");
  assert.equal(advise(["A", 7], 3), "double");
  assert.equal(advise(["A", 7], 6), "double");
  assert.equal(advise(["A", 7], 7), "stand");
  assert.equal(advise(["A", 7], 8), "stand");
  assert.equal(advise(["A", 7], 9), "hit");
  assert.equal(advise(["A", 7], "A"), "hit");
  assert.equal(advise(["A", 8], 6), "stand", "S17: soft 19 always stands");
  assert.equal(advise(["A", 6], 2), "hit");
  assert.equal(advise(["A", 6], 3), "double");
  assert.equal(advise(["A", 5], 3), "hit");
  assert.equal(advise(["A", 5], 4), "double");
  assert.equal(advise(["A", 4], 4), "double");
  assert.equal(advise(["A", 3], 4), "hit");
  assert.equal(advise(["A", 3], 5), "double");
  assert.equal(advise(["A", 2], 6), "double");
  assert.equal(advise(["A", 2], 7), "hit");
});

test("strategy: pairs (double after split allowed)", () => {
  ["2", "6", "10", "A"].forEach(d => assert.equal(advise(["A", "A"], d), "split"));
  ["2", "9", "10", "A"].forEach(d => assert.equal(advise([8, 8], d), "split"));
  assert.equal(advise([10, 10], 6), "stand");
  assert.equal(advise(["K", "K"], 5), "stand");
  assert.equal(advise([9, 9], 6), "split");
  assert.equal(advise([9, 9], 7), "stand");
  assert.equal(advise([9, 9], 8), "split");
  assert.equal(advise([9, 9], 10), "stand");
  assert.equal(advise([7, 7], 7), "split");
  assert.equal(advise([7, 7], 8), "hit");
  assert.equal(advise([6, 6], 2), "split");
  assert.equal(advise([6, 6], 7), "hit");
  assert.equal(advise([5, 5], 9), "double");
  assert.equal(advise([5, 5], 10), "hit");
  assert.equal(advise([4, 4], 4), "hit");
  assert.equal(advise([4, 4], 5), "split");
  assert.equal(advise([3, 3], 2), "split");
  assert.equal(advise([3, 3], 8), "hit");
  assert.equal(advise([2, 2], 7), "split");
  assert.equal(advise([2, 2], 8), "hit");
});

test("strategy: falls back when doubling or splitting is not allowed", () => {
  const none = { double: false, split: false };
  assert.equal(R.strategy(cards("A", 3, 4), up(4), none), "stand", "soft 18: double else stand");
  assert.equal(R.strategy(cards(3, 4, 4), up(6), none), "hit", "11: double else hit");
  assert.equal(advise([8, 8], 10, none), "hit");
  assert.equal(advise([8, 8], 6, none), "stand");
  assert.equal(advise(["A", "A"], 6, none), "hit");
  assert.equal(R.strategy(cards(2, 3, 4, 3), up(10), none), "hit");
  assert.equal(R.strategy(cards(4, 5, 4, 3), up(10), none), "hit");
  assert.throws(() => R.strategy(cards(10), up(6)), /カード/);
  assert.throws(() => R.strategy(cards(10, 6), { suit: "S", rank: "Z" }), /カード/);
});

/* ---------- advisor (the "CPU" of this game) ---------- */
/* Plays many rounds with a chooser; returns the average result per chip bet. */
function session(chooser, seed, rounds) {
  const r = rng(seed);
  let shoe = null;
  let net = 0;
  for (let i = 0; i < rounds; i++) {
    let round = R.startRound({ shoe, chips: 1e6, bet: 10 }, r);
    while (round.phase === "player") round = R.act(round, chooser(round, r));
    round = R.playDealer(round);
    net += R.roundNet(round);
    shoe = round.shoe;
  }
  return net / (rounds * 10);
}
const basic = (round) => R.recommend(round);
const mimicDealer = (round) => (R.handValue(R.activeHand(round).cards).total < 17 ? "hit" : "stand");
const neverBust = (round) => (R.handValue(R.activeHand(round).cards).total < 12 ? "hit" : "stand");
const randomLegal = (round, r) => {
  const legal = R.legalActions(round);
  return legal[Math.floor(r() * legal.length)];
};

test("advisor always suggests a legal action", () => {
  const r = rng(7);
  let shoe = null;
  let checked = 0;
  for (let i = 0; i < 3000; i++) {
    let round = R.startRound({ shoe, chips: 30 + 10 * Math.floor(r() * 30), bet: 10 }, r);
    while (round.phase === "player") {
      const rec = R.recommend(round);
      assert.ok(R.legalActions(round).includes(rec), `${rec} is not legal`);
      checked++;
      round = R.act(round, r() < 0.7 ? rec : randomLegal(round, r));
    }
    assert.equal(R.recommend(round), null);
    shoe = R.playDealer(round).shoe;
  }
  assert.ok(checked > 3000);
});

test("advisor plays close to break-even and clearly beats naive play", () => {
  const rounds = 40000;
  const book = session(basic, 11, rounds);
  const mimic = session(mimicDealer, 11, rounds);
  const timid = session(neverBust, 11, rounds);
  const random = session(randomLegal, 11, rounds);
  assert.ok(book > -0.03 && book < 0.025, `basic strategy returned ${book.toFixed(4)}`);
  assert.ok(book > mimic + 0.02, `basic ${book.toFixed(4)} vs mimic-the-dealer ${mimic.toFixed(4)}`);
  assert.ok(book > timid + 0.02, `basic ${book.toFixed(4)} vs never-bust ${timid.toFixed(4)}`);
  assert.ok(book > random + 0.1, `basic ${book.toFixed(4)} vs random ${random.toFixed(4)}`);
});

test("advisor and dealer stay under 150 ms in the worst case", () => {
  const r = rng(13);
  let shoe = null;
  let worst = 0;
  let positions = 0;
  for (let i = 0; i < 2000; i++) {
    let round = R.startRound({ shoe, chips: 1e6, bet: 10 * (1 + Math.floor(r() * 100)) }, r);
    while (round.phase === "player") {
      const t0 = performance.now();
      const rec = R.recommend(round);
      worst = Math.max(worst, performance.now() - t0);
      positions++;
      round = R.act(round, r() < 0.8 ? rec : randomLegal(round, r));
    }
    const t1 = performance.now();
    round = R.playDealer(round);
    worst = Math.max(worst, performance.now() - t1);
    shoe = round.shoe;
  }
  assert.ok(positions >= 2000, `only ${positions} positions`);
  assert.ok(worst < 150 * TIMING_SLACK, `worst ${worst.toFixed(2)} ms`);
});

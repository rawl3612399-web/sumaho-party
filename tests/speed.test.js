const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const S = require("../src/speed-rules.js");
const Cards = require("../src/cards.js");
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
/* "H5" -> heart 5, "S10" -> spade 10, "CK" -> club K. null stays null. */
const card = (code) => (code ? { suit: code[0], rank: code.slice(1), id: `${code}-0` } : null);
const cards = (codes) => codes.map(card);
/* Builds a state from short codes. */
function stateOf({ f0 = [], d0 = [], f1 = [], d1 = [], p0 = [], p1 = [] }) {
  const field = (list) => Array.from({ length: S.FIELD }, (_, i) => card(list[i] || null));
  return {
    sides: [{ field: field(f0), deck: cards(d0) }, { field: field(f1), deck: cards(d1) }],
    piles: [cards(p0), cards(p1)], over: false, winner: null, step: 0, flips: 0, last: { type: "deal" }
  };
}
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};
const allCards = (s) => [...s.sides.flatMap(x => [...x.field.filter(Boolean), ...x.deck]), ...s.piles.flat()];
const codes = (list) => list.map(c => (c ? c.suit + c.rank : null));

/* Event-driven race between two CPU sides, the way the screen runs it: each side reacts after its delay. */
function race(levels, seed, delays = null) {
  const r = rng(seed);
  let s = S.deal(r);
  let now = 0;
  let due = [null, null];
  let steps = 0;
  while (!s.over) {
    if (++steps > 5000) throw new Error("game did not finish");
    if (S.isStuck(s)) {
      s = S.flip(s);
      due = [null, null];
      continue;
    }
    due = due.map((d, i) => (d === null && S.legalPlays(s, i).length ? now + (delays ? delays[i] : S.cpuDelay(levels[i], r)) : d));
    const side = due[0] === null ? 1 : due[1] === null ? 0 : due[0] <= due[1] ? 0 : 1;
    now = due[side];
    due = due.map((d, i) => (i === side ? null : d));
    const move = S.cpuChoose(s, side, levels[side], r);
    if (move) s = S.play(s, side, move.slot, move.pile);
  }
  return s;
}
/* Positions reached in random games (both sides playing random legal cards). */
function* positions(seed, games) {
  const r = rng(seed);
  for (let g = 0; g < games; g++) {
    let s = S.deal(r);
    while (!s.over) {
      if (S.isStuck(s)) { s = S.flip(s); continue; }
      yield s;
      const side = S.legalPlays(s, 0).length && (r() < 0.5 || !S.legalPlays(s, 1).length) ? 0 : 1;
      const plays = S.legalPlays(s, side);
      const m = plays[Math.floor(r() * plays.length)];
      s = S.play(s, side, m.slot, m.pile);
    }
  }
}

/* ---------- deal ---------- */
test("speed deal: 26 red cards for side 0, 26 black for side 1, 4 face up each", () => {
  const s = S.deal(rng(1));
  assert.equal(s.sides[0].field.length, 4);
  assert.equal(s.sides[0].deck.length, 22);
  assert.equal(s.sides[1].deck.length, 22);
  assert.ok([...s.sides[0].field, ...s.sides[0].deck].every(c => Cards.isRed(c)));
  assert.ok([...s.sides[1].field, ...s.sides[1].deck].every(c => !Cards.isRed(c)));
  assert.deepEqual(s.piles, [[], []]);
  assert.equal(s.over, false);
  assert.equal(s.winner, null);
  assert.equal(new Set(allCards(s).map(c => c.id)).size, 52);
  assert.equal(S.cardsLeft(s, 0), 26);
  assert.equal(S.cardsLeft(s, 1), 26);
});

test("speed deal: same random source gives the same deal, different ones differ", () => {
  assert.deepEqual(S.deal(rng(7)), S.deal(rng(7)));
  assert.notDeepEqual(codes(S.deal(rng(7)).sides[0].deck), codes(S.deal(rng(8)).sides[0].deck));
});

/* ---------- ranks ---------- */
test("speed connects: one apart either way, K and A wrap, suits do not matter", () => {
  assert.ok(S.connects(card("H5"), card("S6")));
  assert.ok(S.connects(card("H6"), card("D5")));
  assert.ok(S.connects(card("HK"), card("CA")));
  assert.ok(S.connects(card("SA"), card("DK")));
  assert.ok(S.connects(card("HQ"), card("HK")));
  assert.ok(S.connects(card("HA"), card("H2")));
  assert.ok(S.connects(card("H10"), card("SJ")));
  assert.ok(!S.connects(card("H5"), card("S7")));
  assert.ok(!S.connects(card("H5"), card("S5")));
  assert.ok(!S.connects(card("HK"), card("S2")));
  assert.ok(!S.connects(card("HQ"), card("SA")));
  assert.ok(!S.connects(card("H5"), null));
});

test("speed connects: every rank has exactly two neighbours", () => {
  Cards.RANKS.forEach(rank => {
    const n = Cards.RANKS.filter(other => S.connects({ suit: "H", rank }, { suit: "S", rank: other })).length;
    assert.equal(n, 2, rank);
  });
});

/* ---------- refill ---------- */
test("speed refill: gaps fill left to right from the top of the deck", () => {
  const side = { field: cards([null, "H2", null, "H4"]), deck: cards(["H9", "HJ", "HQ"]) };
  const out = S.refill(side);
  assert.deepEqual(codes(out.field), ["H9", "H2", "HJ", "H4"]);
  assert.deepEqual(codes(out.deck), ["HQ"]);
  assert.deepEqual(codes(side.field), [null, "H2", null, "H4"], "input untouched");
  const dry = S.refill({ field: cards([null, "H2", null, null]), deck: [] });
  assert.deepEqual(codes(dry.field), [null, "H2", null, null]);
  assert.throws(() => S.refill(null), /手元/);
});

/* ---------- legal plays ---------- */
test("speed legal plays: field cards one apart from either pile top", () => {
  const s = stateOf({ f0: ["H5", "H9", "HA", "HQ"], f1: ["S7", "S3", null, "SJ"], p0: ["C6"], p1: ["DK"] });
  assert.deepEqual(S.pilesFor(s, 0, 0), [0]);
  assert.deepEqual(S.pilesFor(s, 0, 1), []);
  assert.deepEqual(S.pilesFor(s, 0, 2), [1]);
  assert.deepEqual(S.pilesFor(s, 0, 3), [1]);
  assert.deepEqual(S.legalPlays(s, 0), [{ slot: 0, pile: 0 }, { slot: 2, pile: 1 }, { slot: 3, pile: 1 }]);
  assert.deepEqual(S.legalPlays(s, 1), [{ slot: 0, pile: 0 }]);
  assert.deepEqual(S.pilesFor(s, 1, 2), [], "empty slot");
  const both = stateOf({ f0: ["H5"], p0: ["C6"], p1: ["D4"] });
  assert.deepEqual(S.pilesFor(both, 0, 0), [0, 1]);
});

test("speed legal plays: nothing is playable before the first flip", () => {
  const s = S.deal(rng(3));
  assert.deepEqual(S.legalPlays(s, 0), []);
  assert.deepEqual(S.legalPlays(s, 1), []);
  assert.equal(S.isStuck(s), true);
});

/* ---------- play ---------- */
test("speed play: card goes on the pile and the gap refills from the deck", () => {
  const s = stateOf({ f0: ["H5", "H9", "HA", "HQ"], d0: ["H3", "H8"], f1: ["S2"], p0: ["C6"], p1: ["DK"] });
  const a = S.play(s, 0, 0, 0);
  assert.deepEqual(codes(a.piles[0]), ["C6", "H5"]);
  assert.deepEqual(codes(a.sides[0].field), ["H3", "H9", "HA", "HQ"]);
  assert.deepEqual(codes(a.sides[0].deck), ["H8"]);
  assert.equal(a.step, 1);
  assert.deepEqual({ ...a.last, card: a.last.card.id, refill: a.last.refill.id }, { type: "play", side: 0, slot: 0, pile: 0, card: "H5-0", refill: "H3-0" });
  assert.equal(S.cardsLeft(a, 0), 5);
  const b = S.play(a, 0, 2, 1);
  assert.deepEqual(codes(b.piles[1]), ["DK", "HA"]);
  assert.deepEqual(codes(b.sides[0].field), ["H3", "H9", "H8", "HQ"]);
  assert.equal(b.sides[0].deck.length, 0);
});

test("speed play: with an empty deck the gap stays empty", () => {
  const s = stateOf({ f0: ["H5", "H9"], f1: ["S2"], p0: ["C6"], p1: ["DK"] });
  const a = S.play(s, 0, 0, 0);
  assert.deepEqual(codes(a.sides[0].field), [null, "H9", null, null]);
  assert.equal(a.last.refill, null);
  assert.equal(a.over, false);
});

test("speed play: either side may use either pile", () => {
  const s = stateOf({ f0: ["H5", "H7"], d0: ["H2"], f1: ["S7", "S5"], d1: ["S2"], p0: ["C6"], p1: ["D6"] });
  assert.equal(S.play(s, 1, 0, 0).piles[0].length, 2);
  assert.equal(S.play(s, 1, 1, 1).piles[1].length, 2);
  assert.equal(S.play(s, 0, 1, 1).piles[1].length, 2);
});

test("speed play: illegal plays throw short Japanese errors", () => {
  const s = stateOf({ f0: ["H5", "H9"], d0: ["H2"], f1: ["S2"], p0: ["C6"], p1: ["DK"] });
  assert.throws(() => S.play(s, 0, 1, 0), /出せません/);
  assert.throws(() => S.play(s, 0, 2, 0), /カードがありません/);
  assert.throws(() => S.play(s, 2, 0, 0), /プレイヤー/);
  assert.throws(() => S.play(s, 0, 4, 0), /場札/);
  assert.throws(() => S.play(s, 0, 1.5, 0), /場札/);
  assert.throws(() => S.play(s, 0, 0, 2), /台札/);
  assert.throws(() => S.play(null, 0, 0, 0), /状態/);
  assert.throws(() => S.play({ sides: [], piles: [] }, 0, 0, 0), /状態/);
  assert.throws(() => S.play({ ...s, over: true }, 0, 0, 0), /終わって/);
});

test("speed play: emptying field and deck wins at once", () => {
  const s = stateOf({ f0: ["H5"], f1: ["S2", "S9"], d1: ["S4"], p0: ["C6"], p1: ["DK"] });
  const a = S.play(s, 0, 0, 0);
  assert.equal(a.over, true);
  assert.equal(a.winner, 0);
  assert.equal(S.cardsLeft(a, 0), 0);
  assert.deepEqual(S.legalPlays(a, 1), []);
  assert.equal(S.isStuck(a), false);
  assert.throws(() => S.play(a, 1, 0, 0), /終わって/);
  assert.throws(() => S.flip(a), /終わって/);
});

/* ---------- stuck and flip ---------- */
test("speed stuck: only when neither side can play", () => {
  assert.equal(S.isStuck(stateOf({ f0: ["H9"], d0: ["H2"], f1: ["S2"], d1: ["S3"], p0: ["C6"], p1: ["DK"] })), true);
  assert.equal(S.isStuck(stateOf({ f0: ["H9"], d0: ["H2"], f1: ["SA"], d1: ["S3"], p0: ["C6"], p1: ["DK"] })), false);
  assert.equal(S.isStuck(stateOf({ f0: ["H7"], d0: ["H2"], f1: ["S2"], d1: ["S3"], p0: ["C6"], p1: ["DK"] })), false);
});

test("speed flip: both flip the top of their deck onto their own pile", () => {
  const s = stateOf({ f0: ["H9"], d0: ["H2", "H3"], f1: ["S2"], d1: ["SJ", "SQ"], p0: ["C6"], p1: ["DK"] });
  const a = S.flip(s);
  assert.deepEqual(codes(a.piles[0]), ["C6", "H2"]);
  assert.deepEqual(codes(a.piles[1]), ["DK", "SJ"]);
  assert.deepEqual(codes(a.sides[0].deck), ["H3"]);
  assert.deepEqual(codes(a.sides[1].deck), ["SQ"]);
  assert.equal(a.flips, 1);
  assert.equal(a.last.type, "flip");
  assert.deepEqual(a.last.moves.map(m => [m.side, m.from, m.slot, m.card.id]), [[0, "deck", null, "H2-0"], [1, "deck", null, "SJ-0"]]);
});

test("speed flip: the first 「せーの」 starts both piles", () => {
  const s = S.flip(S.deal(rng(5)));
  assert.equal(s.piles[0].length, 1);
  assert.equal(s.piles[1].length, 1);
  assert.ok(Cards.isRed(s.piles[0][0]));
  assert.ok(!Cards.isRed(s.piles[1][0]));
  assert.equal(S.cardsLeft(s, 0), 25);
  assert.equal(S.cardsLeft(s, 1), 25);
});

test("speed flip: refused while someone can still play", () => {
  const s = stateOf({ f0: ["H7"], d0: ["H2"], f1: ["S2"], d1: ["S3"], p0: ["C6"], p1: ["DK"] });
  assert.throws(() => S.flip(s), /まだ出せる/);
});

test("speed flip: with no deck, the leftmost field card goes out instead", () => {
  const s = stateOf({ f0: [null, "H9", "H4"], f1: ["S2"], d1: ["S3"], p0: ["C6"], p1: ["DK"] });
  const a = S.flip(s);
  assert.deepEqual(codes(a.piles[0]), ["C6", "H9"]);
  assert.deepEqual(codes(a.sides[0].field), [null, null, "H4", null]);
  assert.deepEqual(a.last.moves[0].from, "field");
  assert.equal(a.last.moves[0].slot, 1);
  assert.equal(a.over, false);
});

test("speed flip: flipping your last card wins; both at once is a draw", () => {
  const win = S.flip(stateOf({ f0: ["H9"], f1: ["S2"], d1: ["S3"], p0: ["C6"], p1: ["DK"] }));
  assert.equal(win.over, true);
  assert.equal(win.winner, 0);
  const draw = S.flip(stateOf({ f0: ["H9"], f1: ["S2"], p0: ["C6"], p1: ["DK"] }));
  assert.equal(draw.over, true);
  assert.equal(draw.winner, null);
});

/* ---------- immutability ---------- */
test("speed rules never change the state they are given", () => {
  const s = deepFreeze(S.flip(S.deal(rng(11))));
  const before = JSON.stringify(s);
  const plays = [0, 1].flatMap(side => S.legalPlays(s, side).map(p => ({ side, ...p })));
  plays.forEach(p => {
    const a = S.play(s, p.side, p.slot, p.pile);
    assert.equal(a.piles[p.pile].length, s.piles[p.pile].length + 1);
    assert.notEqual(a.sides[p.side], s.sides[p.side]);
  });
  S.cpuChoose(s, 1, "hard", rng(1));
  assert.equal(JSON.stringify(s), before);
  const stuck = deepFreeze(stateOf({ f0: [null, "H9"], f1: ["S2"], d1: ["S3"], p0: ["C6"], p1: ["DK"] }));
  const was = JSON.stringify(stuck);
  const f = S.flip(stuck);
  assert.equal(JSON.stringify(stuck), was);
  assert.notEqual(f.piles, stuck.piles);
});

/* ---------- whole games ---------- */
test("speed games: cards are conserved and every game ends with the right winner", () => {
  for (let g = 0; g < 60; g++) {
    const r = rng(100 + g);
    let s = S.deal(r);
    let steps = 0;
    while (!s.over) {
      assert.ok(++steps < 2000, "game must end");
      if (S.isStuck(s)) s = S.flip(s);
      else {
        const side = r() < 0.5 ? 0 : 1;
        const plays = S.legalPlays(s, side);
        if (plays.length) s = S.play(s, side, plays[0].slot, plays[0].pile);
      }
      const all = allCards(s);
      assert.equal(all.length, 52);
      assert.equal(new Set(all.map(c => c.id)).size, 52);
      [0, 1].forEach(side => assert.ok(S.cardsLeft(s, side) <= 26));
    }
    if (s.winner === null) assert.ok([0, 1].every(side => S.cardsLeft(s, side) === 0));
    else assert.equal(S.cardsLeft(s, s.winner), 0);
  }
});

test("speed games: every card played on a pile connects to the card below it (except flips)", () => {
  const r = rng(77);
  let s = S.deal(r);
  while (!s.over) {
    if (S.isStuck(s)) { s = S.flip(s); continue; }
    const side = S.legalPlays(s, 0).length ? 0 : 1;
    const [m] = S.legalPlays(s, side);
    const below = S.top(s, m.pile);
    s = S.play(s, side, m.slot, m.pile);
    assert.ok(S.connects(below, S.top(s, m.pile)));
  }
});

/* ---------- CPU ---------- */
test("speed cpu: always returns a legal play or null, at every level", () => {
  let checked = 0;
  for (const s of positions(21, 25)) {
    S.LEVELS.forEach(level => {
      [0, 1].forEach(side => {
        const m = S.cpuChoose(s, side, level, rng(checked));
        if (m === null) return;
        assert.ok(S.pilesFor(s, side, m.slot).includes(m.pile), `${level} side ${side}`);
        checked++;
      });
    });
  }
  assert.ok(checked > 1000, `checked ${checked}`);
});

test("speed cpu: null when it has nothing to play", () => {
  const s = stateOf({ f0: ["H9"], d0: ["H2"], f1: ["S2"], d1: ["S3"], p0: ["C6"], p1: ["DK"] });
  S.LEVELS.forEach(level => assert.equal(S.cpuChoose(s, 1, level, () => 0.5), null));
  assert.equal(S.cpuChoose(S.deal(rng(2)), 0, "hard"), null);
});

test("speed cpu: よわい sometimes looks away; つよい never does", () => {
  const s = stateOf({ f1: ["S7"], d1: ["S3"], f0: ["H2"], p0: ["C6"], p1: ["DK"] });
  const count = (level) => {
    const r = rng(9);
    let misses = 0;
    for (let i = 0; i < 2000; i++) if (S.cpuChoose(s, 1, level, r) === null) misses++;
    return misses;
  };
  assert.equal(count("hard"), 0);
  assert.ok(count("easy") > 300, "easy misses about 1 in 5");
  assert.ok(count("normal") < count("easy"));
});

test("speed cpu: つよい starts the longest run of its own cards", () => {
  /* Both the 7 and the 5 fit the 6 (the K pile is dead). Playing 5 opens 4 -> 3; playing 7 leads nowhere. */
  const s = stateOf({ f1: ["S7", "S5", "S4", "S3"], d1: ["S9"], f0: ["H9"], d0: ["H2"], p0: ["C6"], p1: ["DK"] });
  for (let i = 0; i < 20; i++) assert.deepEqual(S.cpuChoose(s, 1, "hard", rng(i)), { slot: 1, pile: 0 });
});

test("speed cpu: つよい picks the pile that keeps the opponent blocked", () => {
  /* The 8 fits both piles (7 and 9). Covering the 7 removes the opponent's 6. */
  const s = stateOf({ f1: ["S8"], d1: ["S2"], f0: ["H6", "HK"], d0: ["H2"], p0: ["C7"], p1: ["D9"] });
  for (let i = 0; i < 20; i++) assert.deepEqual(S.cpuChoose(s, 1, "hard", rng(i)), { slot: 0, pile: 0 });
});

test("speed cpu: ふつう prefers a play that leads to another one", () => {
  /* The 5 and the 7 both fit the 6; only the 5 lets the 4 follow. */
  const s = stateOf({ f1: ["S5", "S7", "S4"], d1: ["S9"], f0: ["H9"], d0: ["H2"], p0: ["C6"], p1: ["DK"] });
  const r = rng(4);
  let hits = 0;
  for (let i = 0; i < 200; i++) {
    const m = S.cpuChoose(s, 1, "normal", r);
    if (m && m.slot === 0) hits++;
  }
  assert.ok(hits > 150, `hits ${hits}`);
});

test("speed cpu: reaction times by level stay in range and get faster", () => {
  const range = (level) => [S.cpuDelay(level, () => 0), S.cpuDelay(level, () => 0.999999)];
  assert.deepEqual(range("easy"), [1200, 2000]);
  assert.deepEqual(range("normal"), [750, 1250]);
  assert.deepEqual(range("hard"), [450, 750]);
  const r = rng(3);
  for (let i = 0; i < 500; i++) {
    const d = S.cpuDelay("normal", r);
    assert.ok(d >= 750 && d <= 1250);
  }
  assert.throws(() => S.cpuDelay("oni"), /CPUの強さ/);
  assert.throws(() => S.cpuChoose(S.deal(rng(1)), 1, "oni"), /CPUの強さ/);
});

test("speed cpu: つよい beats よわい almost always; ふつう beats よわい most of the time", () => {
  const wins = (a, b, games) => {
    let n = 0;
    for (let g = 0; g < games; g++) if (race([a, b], 500 + g).winner === 0) n++;
    return n;
  };
  assert.ok(wins("hard", "easy", 60) >= 55);
  assert.ok(wins("normal", "easy", 60) >= 45);
  assert.ok(wins("hard", "normal", 60) >= 40);
});

test("speed cpu: at the same speed, つよい's choices still win more often than よわい's", () => {
  let hard = 0;
  const games = 200;
  for (let g = 0; g < games; g++) if (race(["hard", "easy"], 900 + g, [800, 800]).winner === 0) hard++;
  assert.ok(hard > games * 0.55, `hard won ${hard}/${games}`);
});

test("speed cpu: thinks well under 150 ms in the worst case", () => {
  /* Each position is timed 3 times and the fastest kept, so a GC pause or a busy machine does not count as think time. */
  const timeOf = (s, side) => Math.min(...[0, 1, 2].map(() => {
    const t0 = performance.now();
    S.cpuChoose(s, side, "hard", () => 0.5);
    return performance.now() - t0;
  }));
  let worst = 0;
  let count = 0;
  for (const s of positions(31, 40)) {
    [0, 1].forEach(side => {
      worst = Math.max(worst, timeOf(s, side));
      count++;
    });
  }
  /* Worst case by construction: 4 field cards forming a long run with both piles open. */
  const full = stateOf({ f1: ["S5", "S4", "S6", "S3"], d1: ["S9"], f0: ["H5", "H7", "H4", "H6"], p0: ["C6"], p1: ["D4"] });
  for (let i = 0; i < 50; i++) worst = Math.max(worst, timeOf(full, 1));
  assert.ok(count > 1000);
  assert.ok(worst < 50 * TIMING_SLACK, `worst ${worst.toFixed(2)} ms (needs a 3x margin under 150 ms)`);
});

/* ---------- rules: CPU reaction floor ---------- */
test("speed cpu: after the other side plays, the CPU waits at least long enough to see the card", () => {
  S.LEVELS.forEach(level => {
    assert.equal(S.cpuRewait(level, 0), S.SEE_MS[level]);
    assert.equal(S.cpuRewait(level, -40), S.SEE_MS[level], "an overdue reaction still waits");
    assert.equal(S.cpuRewait(level, 5000), 5000, "a later reaction is left alone");
    assert.ok(S.SEE_MS[level] <= S.cpuDelay(level, () => 0), "a fresh reaction is never faster than seeing");
  });
  assert.ok(S.SEE_MS.easy > S.SEE_MS.normal && S.SEE_MS.normal > S.SEE_MS.hard);
  assert.throws(() => S.cpuRewait("oni", 0), /CPUの強さ/);
  assert.throws(() => S.cpuRewait("hard", NaN), /待ち時間/);
});

/* ---------- screen (src/speed.js) on a tiny fake DOM with a fake clock ---------- */
const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

function fakeClock() {
  let now = 0;
  let seq = 0;
  let timers = new Map();
  const next = () => [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  return {
    setTimeout: (fn, ms = 0) => { seq += 1; timers = new Map([...timers, [seq, { at: now + ms, fn }]]); return seq; },
    clearTimeout: (id) => { timers = new Map([...timers].filter(([k]) => k !== id)); },
    now: () => now,
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (let n = next(); n && n[1].at <= end; n = next()) {
        timers = new Map([...timers].filter(([k]) => k !== n[0]));
        now = n[1].at;
        n[1].fn();
      }
      now = end;
    }
  };
}

function fakeNode(tag) {
  const classes = new Set();
  const node = {
    tagName: tag, children: [], parent: null, hidden: false, dataset: {}, style: {}, attrs: {}, listeners: {},
    textContent: "", value: "", innerHTML: "",
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : Boolean(on); if (want) classes.add(c); else classes.delete(c); return want; }
    },
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    setAttribute(k, v) { node.attrs[k] = String(v); },
    getAttribute: (k) => node.attrs[k] ?? null,
    addEventListener(type, fn) { node.listeners[type] = [...(node.listeners[type] || []), fn]; },
    fire(type, ev = {}) { (node.listeners[type] || []).forEach(fn => fn({ preventDefault() {}, clientY: 0, ...ev })); },
    click() { node.fire("click"); },
    appendChild(k) { k.parent = node; node.children = [...node.children, k]; return k; },
    prepend(k) { k.parent = node; node.children = [k, ...node.children]; },
    replaceChildren(...kids) { node.children = []; kids.forEach(k => node.appendChild(k)); },
    remove() { if (node.parent) node.parent.children = node.parent.children.filter(x => x !== node); node.parent = null; },
    querySelector(sel) {
      const cls = sel.replace(/^\./, "");
      for (const k of node.children) { if (k.classList.contains(cls)) return k; const d = k.querySelector(sel); if (d) return d; }
      return null;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 50, height: 70 }),
    blur() {}
  };
  return node;
}

/* Loads the real screen with its real rules and cards; everything else in the app is a small spy. */
function loadScreen(seed = 1) {
  const clock = fakeClock();
  const ids = [...(read("partials/speed.html") + read("partials/speed-overlay.html")).matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const byId = new Map(ids.map(id => [id, fakeNode("div")]));
  ["spSide0", "spSide1"].forEach(id => { const s = fakeNode("span"); s.className = "speed-suit"; byId.get(id).appendChild(s); });
  byId.get("spTable").hidden = true;
  const log = { sfx: [], music: [], countdown: 0, confetti: 0 };
  const document = {
    createElement: fakeNode, getElementById: (id) => byId.get(id), body: fakeNode("body"),
    addEventListener() {}, hidden: false, activeElement: null
  };
  const makeButton = (label, onClick, cls = "") => { const b = fakeNode("button"); b.textContent = label; b.className = `btn ${cls}`; b.addEventListener("click", onClick); return b; };
  const ctx = vm.createContext({
    document, window: { matchMedia: () => ({ matches: false }) }, console,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, performance: { now: clock.now },
    requestAnimationFrame: (fn) => { fn(0); return 0; },
    $: (id) => byId.get(id),
    Store: (() => { let m = new Map(); return { load: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), save: (k, v) => { m = new Map([...m, [k, JSON.stringify(v)]]); } }; })(),
    Awake: { keep() {} }, makeButton,
    View: {
      text(e, v) { e.textContent = v ?? ""; e.hidden = !v; },
      list(e, lines) { e.replaceChildren(...lines.map(t => { const li = fakeNode("li"); li.textContent = t; return li; })); },
      chips(e, options, current, onPick) { e.replaceChildren(...options.map(o => makeButton(o.label, () => onPick(o.value)))); }
    },
    Duo: { fill() {}, read: () => ["ハル", "ナツ"] },
    Sound: { ensure() {}, ctx: () => null, sfx: (n) => log.sfx.push(n), tone() {}, hiss() {}, hz: () => 440 },
    Music: { play: (t) => log.music.push(`play:${t}`), stop: () => log.music.push("stop"), intensify: () => log.music.push("intensify") },
    Fx: {
      pop() {}, replay() {}, shake() {},
      countdown: () => { log.countdown += 1; return new Promise(() => {}); },
      confetti: () => { log.confetti += 1; return () => { log.confetti -= 1; }; }
    }
  });
  ctx.seeded = rng(seed);
  vm.runInContext("Math.random = seeded;", ctx);
  ["random.js", "cards.js", "speed-rules.js", "speed.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const Speed = vm.runInContext("Speed", ctx);
  const $ = (id) => byId.get(id);
  const button = (box, text) => $(box).children.find(b => b.textContent.includes(text));
  const slot = (side, i) => $(`spSlots${side}`).children[i];
  const leftOf = (side) => Number($(`spLeft${side}`).textContent.replace(/\D/g, ""));
  return { Speed, clock, log, $, button, slot, leftOf, chip: (box, text) => button(box, text), body: document.body };
}

/* Plays one side like a quick human: taps a lit card, and a lit pile when the card fits both. Says what it tapped. */
function humanTap(t, side = 0) {
  const sel = [0, 1, 2, 3].find(i => t.slot(side, i).classList.contains("speed-sel"));
  if (sel !== undefined) {
    const pile = [1, 0].find(p => t.$(`spPile${p}`).classList.contains("speed-target"));
    t.$(`spPile${pile}`).fire("pointerdown", { clientY: side === 1 ? 0 : 999 });
    return "pile";
  }
  const i = [0, 1, 2, 3].find(k => t.slot(side, k).classList.contains("speed-ok"));
  if (i === undefined) return "";
  t.slot(side, i).fire("pointerdown");
  return "card";
}

test("speed screen: every id the screen looks up is in the partials, and every id is prefixed", () => {
  const html = read("partials/speed.html") + read("partials/speed-overlay.html");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  ids.forEach(id => assert.ok(id === "modeSpeed" || /^sp[A-Z]/.test(id), id));
  const used = [...read("speed.js").matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]);
  assert.ok(used.length > 20);
  used.forEach(id => assert.ok(ids.includes(id), `missing #${id}`));
});

test("speed screen: leaving during the opening count stops every timer and closes the table", () => {
  const t = loadScreen();
  t.Speed.init();
  t.button("spActions", "はじめる").click();
  assert.equal(t.$("spTable").hidden, false);
  assert.ok(t.body.classList.contains("arena-open"));
  t.clock.advance(1300);
  assert.equal(t.$("spCall").textContent, "2", "the count runs inside the table");
  t.Speed.leave();
  assert.equal(t.clock.pending(), 0);
  assert.equal(t.$("spTable").hidden, true);
  assert.ok(!t.body.classList.contains("arena-open"));
  assert.equal(t.log.countdown, 0, "no full-screen countdown that would outlive the table");
  t.clock.advance(10000);
  assert.equal(t.log.music.filter(m => m.startsWith("play")).length, 0, "the game never started after leaving");
});

/* Plays one match against the CPU; returns how soon the CPU ever answered a card the player had just put down. */
function cpuMatch(t, level) {
  t.chip("spLevelChips", level).click();
  t.button("spActions", "はじめる").click();
  let lastHuman = -Infinity;
  let cpuLeft = 26;
  let closest = Infinity;
  for (let ms = 0; ms < 600000 && t.$("spTable").dataset.phase !== "over"; ms += 50) {
    t.clock.advance(50);
    if (t.leftOf(1) < cpuLeft) {
      closest = Math.min(closest, t.clock.now() - lastHuman);
      cpuLeft = t.leftOf(1);
    }
    if (ms % 700 === 0 && t.$("spTable").dataset.phase === "play") {
      const before = t.leftOf(0);
      humanTap(t);
      if (t.leftOf(0) < before) lastHuman = t.clock.now();
    }
  }
  return closest;
}

test("speed screen: matches against the CPU end cleanly at every level, and もう一回 starts a fresh one", () => {
  [["よわい", "easy", 11], ["ふつう", "normal", 12], ["つよい", "hard", 13]].forEach(([label, level, seed]) => {
    const t = loadScreen(seed);
    t.Speed.init();
    const closest = cpuMatch(t, label);
    assert.equal(t.$("spTable").dataset.phase, "over", label);
    assert.ok(closest >= S.SEE_MS[level], `${label}: CPU answered ${closest} ms after the player`);
    assert.equal(t.clock.pending(), 0, "no timers after the match ends");
  });
  const t = loadScreen(5);
  t.Speed.init();
  cpuMatch(t, "つよい");
  assert.equal(t.$("spTable").dataset.phase, "over");
  assert.ok(t.log.music.includes("play:rush") && t.log.music.at(-1) === "stop");
  assert.ok(["victory", "lose", "reveal"].some(n => t.log.sfx.includes(n)));
  t.button("spButtons", "もう一回").click();
  assert.equal(t.$("spTable").dataset.phase, "ready");
  assert.equal(t.leftOf(0) + t.leftOf(1), 52);
  t.clock.advance(5000);
  assert.ok(["play", "seno"].includes(t.$("spTable").dataset.phase));
  t.Speed.leave();
  assert.equal(t.clock.pending(), 0);
});

test("speed screen: two players race to the end; やめる needs two taps and leaves nothing running", () => {
  const t = loadScreen();
  t.Speed.init();
  t.chip("spVsChips", "2人で").click();
  t.button("spActions", "はじめる").click();
  t.clock.advance(1300);
  assert.deepEqual([t.$("spMsg0").textContent, t.$("spMsg1").textContent], ["2", "2"], "the player across can read the count");
  t.clock.advance(2700);
  assert.equal(t.$("spTable").dataset.phase, "play");
  t.button("spButtons", "やめる").click();
  assert.ok(t.button("spButtons", "本当に"), "first tap only asks");
  t.clock.advance(3000);
  assert.ok(t.button("spButtons", "やめる") && !t.button("spButtons", "本当に"), "the question goes away");
  let pileTaps = 0;
  for (let ms = 0; ms < 600000 && t.$("spTable").dataset.phase !== "over"; ms += 100) {
    t.clock.advance(100);
    const side = (ms / 100) % 2;
    const before = t.leftOf(side);
    if (t.$("spTable").dataset.phase === "play" && humanTap(t, side) === "pile") {
      assert.equal(t.leftOf(side), before - 1, "tapping the lit pile plays the lifted card");
      pileTaps++;
    }
  }
  assert.ok(pileTaps > 0, "a card that fits both piles was played with a second tap");
  assert.equal(t.$("spTable").dataset.phase, "over");
  assert.equal(t.clock.pending(), 0);
  assert.ok(t.log.sfx.includes("fanfare") && t.log.confetti === 1, "a 2-player win gets fanfare and confetti");
  t.button("spButtons", "もう一回").click();
  assert.equal(t.log.confetti, 0, "starting again clears the confetti");
  t.clock.advance(800);
  t.button("spButtons", "やめる").click();
  t.button("spButtons", "本当に").click();
  assert.equal(t.$("spTable").hidden, true);
  assert.equal(t.clock.pending(), 0);
});

test("speed screen: a quick double tap plays one card, never the refill that is still sliding in", () => {
  const t = loadScreen(3);
  t.Speed.init();
  t.chip("spVsChips", "2人で").click();
  t.button("spActions", "はじめる").click();
  let risky = 0;
  /* Taps come 300 ms apart, after each new card has slid in, so every first tap counts. */
  for (let ms = 0; ms < 600000 && t.$("spTable").dataset.phase !== "over"; ms += 300) {
    t.clock.advance(300);
    const side = (ms / 300) % 2;
    const i = [0, 1, 2, 3].find(k => t.slot(side, k).classList.contains("speed-ok"));
    if (t.$("spTable").dataset.phase !== "play" || i === undefined) continue;
    const before = t.leftOf(side);
    t.slot(side, i).fire("pointerdown");
    if (t.slot(side, i).classList.contains("speed-sel")) {
      t.slot(side, i).fire("pointerdown");
      assert.ok(!t.slot(side, i).classList.contains("speed-sel"), "a second tap on a lifted card puts it back");
      humanTap(t, side);
      assert.equal(humanTap(t, side), "pile");
      continue;
    }
    if (t.slot(side, i).classList.contains("speed-ok")) risky++;
    t.slot(side, i).fire("pointerdown");
    assert.equal(t.leftOf(side), before - 1, "only the first tap plays");
  }
  assert.equal(t.$("spTable").dataset.phase, "over");
  assert.ok(risky > 0, "some refills could have been played by the second tap");
});

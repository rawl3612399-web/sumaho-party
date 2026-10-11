"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/sevens-rules.js");
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1; // CI machines are slower; the deploy workflow raises this

/* Card keys from names like "S7", "H10", "DA", "CK". */
const k = (name) => S.keyOf({ suit: name[0], rank: name.slice(1) });
const ks = (...names) => names.map(k);
const nm = (key) => `${S.cardOf(key).suit}${S.cardOf(key).rank}`;
const ALL = S.DECK.map((_, i) => i);

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
function deepFreeze(o) {
  Object.values(o).forEach(v => { if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v); });
  return Object.freeze(o);
}
/* A full 13-card deal: the listed cards go to their seats, the rest fill the hands in deck order. */
function deal(fixed) {
  const hands = fixed.map(list => ks(...list));
  const used = new Set(hands.flat());
  const rest = ALL.filter(i => !used.has(i));
  let next = 0;
  return hands.map(h => [...h, ...rest.slice(next, (next += 13 - h.length))]);
}
/* Position where every card not in a hand is on the board. */
function spot(hands, extra = {}) {
  const held = new Set(hands.flat().map(k));
  return S.position({ hands: hands.map(h => ks(...h)), board: ALL.filter(i => !held.has(i)), ...extra });
}
const boardOf = (...names) => ALL.map(i => names.map(k).includes(i));
const act = (s, m) => (m.type === "play" ? S.play(s, m.key) : S.pass(s));
function playGame(levels, seed, tunnel = false, opts = { ms: Infinity, playouts: 200 }) {
  const r = rng(seed);
  let s = S.newGame({ tunnel }, r);
  const seen = [];
  for (let guard = 0; !s.over; guard++) {
    assert.ok(guard < 200, "game must end");
    const m = S.cpuMove(s, levels[s.turn], r, opts);
    seen.push({ s, m });
    s = act(s, m);
  }
  return { end: s, seen };
}

/* ---------- deal and setup ---------- */
test("sevens: deal gives 13 each, puts every 7 on the board, and the 7 of diamonds starts", () => {
  const s = S.fromHands(deal([["SA", "S2"], ["H7", "C7"], ["D7", "S7"], ["HK"]]));
  assert.deepEqual(S.SEVENS.map(x => s.board[x]), [true, true, true, true]);
  assert.equal(s.board.filter(Boolean).length, 4);
  assert.deepEqual(s.hands.map(h => h.length), [13, 11, 11, 13]);
  assert.equal(s.starter, 2);
  assert.equal(s.turn, 2);
  s.hands.flat().forEach(x => assert.ok(!S.SEVENS.includes(x), "no 7 left in a hand"));
  s.hands.forEach(h => assert.deepEqual(h, [...h].sort((a, b) => a - b)));
});

test("sevens: newGame deals all 52 cards, is repeatable with a seed, and checks options", () => {
  const a = S.newGame({}, rng(9));
  const b = S.newGame({}, rng(9));
  assert.deepEqual(a, b);
  assert.equal(new Set([...a.hands.flat(), ...ALL.filter(i => a.board[i])]).size, 52);
  assert.equal(a.tunnel, false);
  assert.equal(S.newGame({ tunnel: true }, rng(1)).tunnel, true);
  assert.equal(S.newGame({ tunnel: "yes" }, rng(1)).tunnel, false);
  const starter = a.starter;
  assert.ok(S.isActive(a, starter));
  assert.throws(() => S.newGame(null), /設定/);
  assert.throws(() => S.fromHands([[1], [2]]), /4人/);
  assert.throws(() => S.fromHands(deal([[], [], [], []]).map((h, i) => (i ? h : [...h.slice(1), h[1]]))), /同じカード/);
  assert.throws(() => S.keyOf({ suit: "X", rank: "7" }), /カード/);
  assert.throws(() => S.keyOf(52), /カード/);
});

/* ---------- adjacency ---------- */
test("sevens: at the start only the 6s and 8s can be played", () => {
  const s = S.newGame({}, rng(3));
  assert.deepEqual(S.openKeys(s).map(nm), ["S6", "S8", "H6", "H8", "D6", "D8", "C6", "C8"]);
});

test("sevens: cards join next to a placed card of the same suit, A and K are dead ends", () => {
  const b = boardOf("S7", "S6", "H7", "D7", "C7");
  assert.equal(S.isPlayable(b, k("S5")), true);
  assert.equal(S.isPlayable(b, k("S4")), false);
  assert.equal(S.isPlayable(b, k("S6")), false, "already on the board");
  assert.equal(S.isPlayable(b, k("H5")), false, "other suit");
  const low = boardOf("S2", "S3", "S4", "S5", "S6", "S7", "H7", "D7", "C7");
  assert.equal(S.isPlayable(low, k("SA")), true);
  assert.equal(S.isPlayable(low, k("SK")), false, "no tunnel");
});

test("sevens: tunnel joins A and K once one of them is on the board", () => {
  const high = boardOf("S7", "S8", "S9", "S10", "SJ", "SQ", "SK", "H7", "D7", "C7");
  assert.equal(S.isPlayable(high, k("SA"), false), false);
  assert.equal(S.isPlayable(high, k("SA"), true), true);
  const low = boardOf("SA", "S2", "S3", "S4", "S5", "S6", "S7", "H7", "D7", "C7");
  assert.equal(S.isPlayable(low, k("SK"), true), true);
  assert.equal(S.isPlayable(low, k("SQ"), true), false);
  const start = boardOf("S7", "H7", "D7", "C7");
  assert.equal(S.isPlayable(start, k("SA"), true), false, "the tunnel needs an A or K first");
  assert.equal(S.isPlayable(start, k("SK"), true), false);
});

/* ---------- moves ---------- */
test("sevens: play checks the hand and adjacency, then passes the turn clockwise", () => {
  const s = S.fromHands(deal([["S6"], ["S5"], ["D7", "H8"], ["S4"]]));
  assert.equal(s.turn, 2);
  assert.throws(() => S.play(s, k("S6")), /手札/);
  assert.throws(() => S.play(s, s.hands[2].find(x => !S.isPlayable(s.board, x))), /出せません/);
  const a = S.play(s, k("H8"));
  assert.equal(a.turn, 3);
  assert.equal(a.board[k("H8")], true);
  assert.ok(!a.hands[2].includes(k("H8")));
  assert.deepEqual(a.last, { seat: 2, kind: "play", key: k("H8"), placed: [k("H8")], finished: false });
  const b = S.play(S.pass(a), k("S6"));
  assert.equal(b.turn, 1);
  assert.ok(S.legalKeys(b, 1).includes(k("S5")));
  assert.ok(!S.legalKeys(b, 3).includes(k("S4")), "S4 waits for S5");
});

test("sevens: play and pass never change the state they are given", () => {
  let seed = 4;
  while (S.legalKeys(S.newGame({}, rng(seed))).length === 0) seed++;
  const s = deepFreeze(S.newGame({}, rng(seed)));
  const snap = JSON.stringify(s);
  const legal = S.legalKeys(s);
  S.play(s, legal[0]);
  S.pass(s);
  S.cpuMove(s, "easy", rng(1));
  S.cpuMove(s, "normal", rng(1));
  S.cpuMove(s, "hard", rng(1), { playouts: 60 });
  S.ranking(s);
  assert.equal(JSON.stringify(s), snap);
  const out = deepFreeze(spot([["S6", "H8"], ["S5", "H9"], ["S4", "H10"], ["S3", "HJ"]], { passes: [3, 0, 0, 0] }));
  const before = JSON.stringify(out);
  S.pass(out);
  assert.equal(JSON.stringify(out), before);
});

test("sevens: three passes are allowed, the fourth knocks you out and lays your hand out", () => {
  const hands = [["SJ", "H5"], ["S6", "S9"], ["S8", "SQ"], ["S10", "H8"]];
  [0, 1, 2].forEach(used => {
    const s = S.pass(spot(hands, { passes: [used, 0, 0, 0] }));
    assert.equal(s.passes[0], used + 1);
    assert.equal(S.passesLeft(s, 0), 2 - used);
    assert.deepEqual(s.last, { seat: 0, kind: "pass", key: -1, placed: [], finished: false });
    assert.deepEqual(s.outs, []);
    assert.equal(s.turn, 1);
  });
  const out = S.pass(spot(hands, { passes: [3, 0, 0, 0] }));
  assert.equal(out.last.kind, "out");
  assert.deepEqual(out.last.placed.map(nm), ["SJ", "H5"]);
  assert.deepEqual(out.hands[0], []);
  assert.deepEqual(out.outs, [0]);
  assert.equal(out.board[k("SJ")] && out.board[k("H5")], true);
  assert.equal(S.isActive(out, 0), false);
  assert.equal(out.turn, 1);
  assert.ok(S.openKeys(out).includes(k("S10")) && S.openKeys(out).includes(k("SQ")), "cards next to the laid-out J open up");
  assert.equal(S.passesLeft(out, 0), 0);
  const later = S.pass(S.pass(S.pass(out)));
  assert.equal(later.turn, 1, "the knocked-out player is skipped");
});

test("sevens: emptying your hand finishes you and the turn skips you", () => {
  const s = spot([["S6"], ["S5", "H9"], ["S4", "H10"], ["S3", "HJ", "HQ"]]);
  const a = S.play(s, k("S6"));
  assert.deepEqual(a.done, [0]);
  assert.equal(a.last.finished, true);
  assert.equal(a.turn, 1);
  const b = S.pass(S.pass(S.pass(a)));
  assert.equal(b.turn, 1);
  assert.equal(b.over, false);
});

test("sevens: the game ends when one player is left; nothing can be played after", () => {
  const s = spot([["S6"], [], ["S5", "S4"], []], { done: [1], outs: [3], turn: 0 });
  const end = S.play(s, k("S6"));
  assert.equal(end.over, true);
  assert.equal(end.turn, -1);
  assert.throws(() => S.play(end, k("S5")), /終わって/);
  assert.throws(() => S.pass(end), /終わって/);
  assert.throws(() => S.cpuMove(end, "normal"), /終わって/);
  assert.deepEqual(S.ranking(end).map(r => [r.seat, r.place, r.how]), [[1, 1, "done"], [0, 2, "done"], [2, 3, "last"], [3, 4, "out"]]);
});

test("sevens: ranking puts finishers first, the last player next, and the first one knocked out at the bottom", () => {
  const plain = spot([[], [], ["S6"], []], { done: [3, 0, 1] });
  assert.equal(plain.over, true);
  assert.deepEqual(S.ranking(plain).map(r => [r.seat, r.place, r.how]), [[3, 1, "done"], [0, 2, "done"], [1, 3, "done"], [2, 4, "last"]]);
  const twoOut = spot([[], ["S6"], [], []], { done: [3], outs: [0, 2] });
  assert.deepEqual(S.ranking(twoOut).map(r => [r.seat, r.place]), [[3, 1], [1, 2], [2, 3], [0, 4]]);
});

test("sevens: position rejects broken setups", () => {
  assert.throws(() => S.position(null), /局面/);
  assert.throws(() => S.position({ hands: [["S6"], [], [], []].map(h => ks(...h)), board: [] }), /そろって/);
  const all = ALL.filter(i => i !== k("S6") && i !== k("S7"));
  assert.throws(() => S.position({ hands: [[k("S6"), k("S7")], [], [], []], board: all }), /7は/);
  const fine = { hands: [[k("S6")], [k("S5")], [], []], board: ALL.filter(i => i !== k("S6") && i !== k("S5")) };
  assert.throws(() => S.position({ ...fine, passes: [5, 0, 0, 0] }), /パス/);
  assert.throws(() => S.position({ ...fine, done: [1] }), /手札は空/);
  assert.throws(() => S.position({ ...fine, done: [2, 2] }), /席/);
  assert.throws(() => S.position({ ...fine, done: [2], turn: 2 }), /手番/);
  assert.throws(() => S.position({ ...fine, turn: "1" }), /席/);
  assert.throws(() => S.position({ ...fine, done: "2" }), /局面/);
});

test("sevens: a knocked-out A opens its run, and with the tunnel also the K", () => {
  const hands = [["SA", "H5"], ["S2", "S3", "S4", "S5", "S6", "S8", "S9", "S10", "SJ", "SQ", "SK"], ["H4"], ["H3"]];
  const plain = S.pass(spot(hands, { passes: [3, 0, 0, 0] }));
  assert.ok(S.openKeys(plain).includes(k("S2")), "S2 sits next to the laid-out A");
  assert.ok(!S.openKeys(plain).includes(k("SK")), "no tunnel: K still waits for Q");
  const tunnel = S.pass(spot(hands, { passes: [3, 0, 0, 0], tunnel: true }));
  assert.ok(S.openKeys(tunnel).includes(k("SK")), "tunnel: K joins the laid-out A");
  assert.ok(S.legalKeys(tunnel, 1).includes(k("SK")));
});

test("sevens: a knockout that leaves one player ends the game, and three knockouts make the survivor 1st", () => {
  const end = S.pass(spot([["S5"], ["S6"], [], []], { done: [2, 3], passes: [3, 0, 0, 0] }));
  assert.equal(end.over, true);
  assert.deepEqual(S.ranking(end).map(r => [r.seat, r.place, r.how]), [[2, 1, "done"], [3, 2, "done"], [1, 3, "last"], [0, 4, "out"]]);
  let s = spot([["S5"], ["S4"], ["S3"], ["S6", "H8"]], { passes: [3, 3, 3, 0] });
  s = S.pass(S.pass(S.pass(s)));
  assert.equal(s.over, true);
  assert.deepEqual(S.ranking(s).map(r => [r.seat, r.place, r.how]), [[3, 1, "last"], [2, 2, "out"], [1, 3, "out"], [0, 4, "out"]]);
});

test("sevens cpu: with no passes left every level plays a card instead of dropping out", () => {
  const hands = [["H8", "S4"], ["S6", "S5", "S3", "S2", "SA", "S8", "S9"], ["S10", "SJ", "SQ", "SK", "H9", "H10", "HJ"],
    ["HQ", "HK", "H6", "H5", "H4", "H3", "H2", "HA"]];
  [false, true].forEach(tunnel => {
    const s = spot(hands, { passes: [3, 0, 0, 0], tunnel });
    ["easy", "normal", "hard"].forEach(level => {
      for (let i = 0; i < 5; i++) assert.equal(nm(S.cpuMove(s, level, rng(i), { playouts: 120 }).key), "H8", `${level} tunnel=${tunnel}`);
    });
  });
});

/* ---------- whole games ---------- */
test("sevens: random games keep every card, only legal moves, and a full ranking", () => {
  ["easy", "normal", "hard"].forEach((level, li) => {
    for (let g = 0; g < (level === "hard" ? 6 : 40); g++) {
      const { end, seen } = playGame([level, "easy", "normal", level], 100 * li + g, g % 2 === 1);
      seen.forEach(({ s, m }) => {
        if (m.type === "play") assert.ok(S.legalKeys(s).includes(m.key));
        else assert.ok(S.passesLeft(s, s.turn) > 0 || S.legalKeys(s).length === 0, "never drops out with a card to play");
      });
      assert.equal(end.hands.filter(h => h.length).length <= 1, true);
      assert.equal(end.board.filter(Boolean).length + end.hands.flat().length, 52);
      const ranks = S.ranking(end);
      assert.deepEqual(ranks.map(r => r.place), [1, 2, 3, 4]);
      assert.deepEqual([...ranks.map(r => r.seat)].sort(), [0, 1, 2, 3]);
      end.outs.forEach(seat => assert.ok(ranks.find(r => r.seat === seat).place > 4 - end.outs.length));
      end.passes.forEach(p => assert.ok(p <= S.MAX_PASSES + 1));
    }
  });
});

/* ---------- CPU ---------- */
test("sevens cpu: rejects a bad level and passes when nothing can be played", () => {
  const s = S.newGame({}, rng(2));
  assert.throws(() => S.cpuMove(s, "oni"), /強さ/);
  const stuck = spot([["S4"], ["S6", "S5"], ["H8"], ["H6", "S3"]]);
  ["easy", "normal", "hard"].forEach(level => assert.deepEqual(S.cpuMove(stuck, level, rng(1)), { type: "pass" }));
});

test("sevens cpu: よわい picks any playable card at random and never passes by choice", () => {
  const s = spot([["S6", "S8", "H8", "D6", "C2"], ["S5", "S9", "H9"], ["D5", "H10", "C6"], ["S4", "C8", "C3", "CA"]]);
  const picked = new Set();
  for (let i = 0; i < 200; i++) {
    const m = S.cpuMove(s, "easy", rng(i));
    assert.equal(m.type, "play");
    picked.add(nm(m.key));
  }
  assert.deepEqual([...picked].sort(), ["D6", "H8", "S6", "S8"]);
});

/* Me: a run of spades to clear (S6 S5 S4) and a lone H8 that blocks all the high hearts. */
const RUN_OR_BLOCK = [["S6", "S5", "S4", "H8"], ["S3", "S2", "SA", "H9"], ["H10", "HJ", "S8", "S9"],
  ["HQ", "HK", "S10", "SJ", "SQ", "SK", "H6", "H5", "H4", "H3", "H2", "HA"]];

test("sevens cpu: ふつう and つよい open their own run and keep the blocker", () => {
  const s = spot(RUN_OR_BLOCK);
  for (let i = 0; i < 20; i++) assert.equal(nm(S.cpuMove(s, "normal", rng(i)).key), "S6");
  for (let i = 0; i < 3; i++) assert.equal(nm(S.cpuMove(s, "hard", rng(i), { ms: Infinity }).key), "S6");
});

test("sevens cpu: ふつう plays a card that opens nothing before a card that helps others", () => {
  const s = spot([["SA", "H8"], ["H9", "H10"], ["HJ", "HQ"], ["HK", "H6", "H5", "H4", "H3", "H2", "HA"]]);
  for (let i = 0; i < 20; i++) assert.equal(nm(S.cpuMove(s, "normal", rng(i)).key), "SA");
});

test("sevens cpu: ふつう passes to hold a lone blocker, but not with its last pass", () => {
  const hands = [["H8", "S4"], ["S6", "S5", "S3", "S2", "SA", "S8", "S9"], ["S10", "SJ", "SQ", "SK", "H9", "H10", "HJ"],
    ["HQ", "HK", "H6", "H5", "H4", "H3", "H2", "HA"]];
  const fresh = spot(hands);
  for (let i = 0; i < 20; i++) assert.equal(S.cpuMove(fresh, "normal", rng(i)).type, "pass");
  const last = spot(hands, { passes: [2, 0, 0, 0] });
  for (let i = 0; i < 20; i++) assert.equal(nm(S.cpuMove(last, "normal", rng(i)).key), "H8");
});

test("sevens cpu: つよい takes the card that empties its hand", () => {
  const s = spot([["S6"], ["S5", "H9", "H10"], ["S4", "HJ"], ["S3", "HQ", "HK"]]);
  for (let i = 0; i < 5; i++) assert.equal(nm(S.cpuMove(s, "hard", rng(i), { ms: Infinity }).key), "S6");
});

test("sevens cpu: ふつう beats よわい and つよい beats ふつう over many deals", () => {
  const avg = (a, b, games, seed) => {
    let mine = 0;
    let others = 0;
    for (let g = 0; g < games; g++) {
      const seat = g % 4;
      const levels = [0, 1, 2, 3].map(i => (i === seat ? a : b));
      S.ranking(playGame(levels, seed + g, g % 3 === 0).end).forEach(r => {
        if (r.seat === seat) mine += r.place;
        else others += r.place;
      });
    }
    return { mine: mine / games, others: others / (3 * games) };
  };
  const normal = avg("normal", "easy", 300, 1000);
  assert.ok(normal.mine < 2.2 && normal.mine < normal.others - 0.3, `normal ${normal.mine.toFixed(2)} vs easy ${normal.others.toFixed(2)}`);
  const hard = avg("hard", "normal", 120, 5000);
  assert.ok(hard.mine < 2.45 && hard.mine < hard.others - 0.1, `hard ${hard.mine.toFixed(2)} vs normal ${hard.others.toFixed(2)}`);
  console.log(`# sevens: normal ${normal.mine.toFixed(2)} vs easy ${normal.others.toFixed(2)}; hard ${hard.mine.toFixed(2)} vs normal ${hard.others.toFixed(2)}`);
});

test("sevens cpu: つよい thinks under 150 ms in the worst case (3x margin, CPU time)", () => {
  const positions = [];
  for (let g = 0; g < 10; g++) {
    playGame(["normal", "normal", "normal", "normal"], 700 + g, g % 2 === 1).seen.forEach(({ s }) => {
      if (S.legalKeys(s).length > 0) positions.push(s);
    });
  }
  S.cpuMove(positions[0], "hard", rng(1)); /* warm up */
  let worst = 0;
  positions.forEach((s, i) => {
    const t0 = process.cpuUsage();
    const m = S.cpuMove(s, "hard", rng(i));
    const used = process.cpuUsage(t0);
    worst = Math.max(worst, (used.user + used.system) / 1000);
    assert.ok(m.type === "pass" || S.legalKeys(s).includes(m.key));
  });
  console.log(`# sevens hard CPU worst think time: ${worst.toFixed(1)} ms over ${positions.length} positions`);
  assert.ok(worst < 50 * TIMING_SLACK, `worst ${worst.toFixed(1)} ms`);
});

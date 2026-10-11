const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/memory-rules.js");
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
const clone = (v) => JSON.parse(JSON.stringify(v));
const RED = new Set(["H", "D"]);

/* Positions of the two cards of each pair key. */
function pairsOf(s) {
  const map = new Map();
  s.cards.forEach((c, i) => map.set(c.key, [...(map.get(c.key) || []), i]));
  return [...map.values()];
}
/* Two positions that do not match (both still on the table). */
function missPair(s) {
  const open = M.closed(s);
  for (const a of open) for (const b of open) if (a < b && !M.isMatch(s.cards[a], s.cards[b])) return [a, b];
  return null;
}
const play2 = (s, a, b) => M.resolve(M.flip(M.flip(s, a), b));

/* ---------- dealing ---------- */
test("deal: every pair is the same rank and the same color, ids unique", () => {
  M.PAIR_COUNTS.forEach((n, k) => {
    const cards = M.deal(n, rng(10 + k));
    assert.equal(cards.length, n * 2);
    assert.equal(new Set(cards.map(c => c.id)).size, n * 2, "unique ids");
    const groups = new Map();
    cards.forEach(c => groups.set(c.key, [...(groups.get(c.key) || []), c]));
    assert.equal(groups.size, n, "n distinct pairs");
    groups.forEach(([a, b, extra]) => {
      assert.equal(extra, undefined);
      assert.equal(a.rank, b.rank);
      assert.equal(RED.has(a.suit), RED.has(b.suit));
      assert.notEqual(a.suit, b.suit);
      assert.ok(M.isMatch(a, b));
    });
  });
});

test("deal: up to 13 pairs never repeat a rank; 16 pairs reuse only 3 ranks in the other color", () => {
  for (let seed = 0; seed < 50; seed++) {
    const ranks12 = M.deal(12, rng(seed)).map(c => c.rank);
    assert.equal(new Set(ranks12).size, 12);
    const cards16 = M.deal(16, rng(seed));
    const perRank = new Map();
    cards16.forEach(c => perRank.set(c.rank, (perRank.get(c.rank) || 0) + 1));
    assert.equal(perRank.size, 13);
    assert.equal([...perRank.values()].filter(v => v === 4).length, 3);
  }
});

test("deal: shuffled differently by the random source; bad pair counts throw", () => {
  const a = M.deal(12, rng(1)).map(c => c.id).join();
  const b = M.deal(12, rng(2)).map(c => c.id).join();
  assert.notEqual(a, b);
  assert.equal(M.deal(12, rng(7)).map(c => c.id).join(), M.deal(12, rng(7)).map(c => c.id).join());
  [0, 7, 10, 13, 26, "12", null, undefined].forEach(n => assert.throws(() => M.deal(n), /ペアの数/));
});

test("pairs: same rank but different color is not a pair", () => {
  assert.ok(M.isMatch({ suit: "S", rank: "7", id: "S7" }, { suit: "C", rank: "7", id: "C7" }));
  assert.ok(M.isMatch({ suit: "H", rank: "Q", id: "HQ" }, { suit: "D", rank: "Q", id: "DQ" }));
  assert.ok(!M.isMatch({ suit: "S", rank: "7", id: "S7" }, { suit: "H", rank: "7", id: "H7" }));
  assert.ok(!M.isMatch({ suit: "S", rank: "7", id: "S7" }, { suit: "C", rank: "8", id: "C8" }));
  assert.ok(!M.isMatch({ suit: "S", rank: "7", id: "S7" }, { suit: "S", rank: "7", id: "S7" }), "a card is not its own pair");
  assert.ok(!M.isMatch(null, { suit: "S", rank: "7", id: "S7" }));
});

/* ---------- new game ---------- */
test("newGame: starting state and input checks", () => {
  const s = M.newGame({ pairs: 8, players: 3, first: 2 }, rng(3));
  assert.equal(s.cards.length, 16);
  assert.deepEqual(s.scores, [0, 0, 0]);
  assert.equal(s.turn, 2);
  assert.equal(s.tries, 0);
  assert.equal(s.over, false);
  assert.ok(s.owner.every(o => o === M.NONE));
  assert.equal(M.remaining(s), 8);
  assert.equal(M.closed(s).length, 16);
  assert.equal(M.newGame({ pairs: 12 }).players, 1);
  [0, 5, 1.5, "2"].forEach(p => assert.throws(() => M.newGame({ pairs: 8, players: p }), /人数/));
  [-1, 2, 0.5].forEach(f => assert.throws(() => M.newGame({ pairs: 8, players: 2, first: f }), /先に/));
  assert.throws(() => M.newGame({ pairs: 9, players: 2 }), /ペア/);
});

/* ---------- flipping ---------- */
test("flip: legality of every kind of tap", () => {
  const s = M.newGame({ pairs: 8, players: 2 }, rng(4));
  [-1, 16, 2.5, "3", null].forEach(i => assert.throws(() => M.flip(s, i), /ありません/));
  const one = M.flip(s, 3);
  assert.deepEqual(one.open, [3]);
  assert.throws(() => M.flip(one, 3), /もうめくって/);
  const [a, b] = pairsOf(s)[0];
  const two = M.flip(M.flip(s, a), b);
  const third = M.closed(two)[0];
  assert.throws(() => M.flip(two, third), /結果を待って/);
  assert.equal(M.flipError(two, third), "2枚めくったら、結果を待ってね");
  const taken = M.resolve(two);
  assert.throws(() => M.flip(taken, a), /取られて/);
  assert.ok(!M.canFlip(taken, b));
  assert.ok(M.canFlip(taken, third));
  assert.equal(M.pending(s), null);
  assert.equal(M.pending(one), null);
  assert.throws(() => M.resolve(one), /2枚めくって/);
});

test("match: the player keeps the pair, scores 1 and goes again", () => {
  const s = M.newGame({ pairs: 8, players: 2 }, rng(5));
  const [a, b] = pairsOf(s)[0];
  const two = M.flip(M.flip(s, a), b);
  assert.equal(M.pending(two), "match");
  const after = M.resolve(two);
  assert.deepEqual(after.scores, [1, 0]);
  assert.equal(after.turn, 0, "same player again");
  assert.equal(after.owner[a], 0);
  assert.equal(after.owner[b], 0);
  assert.deepEqual(after.open, []);
  assert.equal(after.tries, 1);
  assert.equal(after.chain, 1);
  assert.deepEqual(after.last, { a, b, match: true, by: 0 });
  assert.equal(M.remaining(after), 7);
  const [c, d] = pairsOf(s)[1];
  const again = play2(after, c, d);
  assert.equal(again.chain, 2);
  assert.deepEqual(again.scores, [2, 0]);
});

test("miss: cards stay on the table, nobody scores, the turn passes and wraps", () => {
  let s = M.newGame({ pairs: 8, players: 3 }, rng(6));
  const turns = [];
  for (let k = 0; k < 4; k++) {
    const [a, b] = missPair(s);
    const two = M.flip(M.flip(s, a), b);
    assert.equal(M.pending(two), "miss");
    s = M.resolve(two);
    assert.equal(s.owner[a], M.NONE);
    assert.equal(s.chain, 0);
    assert.deepEqual(s.last, { a, b, match: false, by: turns.length ? (turns[turns.length - 1]) : 0 });
    turns.push(s.turn);
  }
  assert.deepEqual(turns, [1, 2, 0, 1]);
  assert.deepEqual(s.scores, [0, 0, 0]);
  assert.equal(s.tries, 4);
});

test("miss after a streak resets the chain", () => {
  const s = M.newGame({ pairs: 8, players: 2 }, rng(8));
  const [a, b] = pairsOf(s)[0];
  const hit = play2(s, a, b);
  const [x, y] = missPair(hit);
  const miss = play2(hit, x, y);
  assert.equal(miss.chain, 0);
  assert.equal(miss.turn, 1);
  assert.deepEqual(miss.scores, [1, 0]);
});

test("solo: a miss keeps the same (only) player; a perfect game takes exactly `pairs` tries", () => {
  const s = M.newGame({ pairs: 12, players: 1 }, rng(9));
  const [x, y] = missPair(s);
  assert.equal(play2(s, x, y).turn, 0);
  const done = pairsOf(s).reduce((g, [a, b]) => play2(g, a, b), s);
  assert.equal(done.over, true);
  assert.equal(done.tries, 12);
  assert.deepEqual(done.scores, [12]);
  assert.equal(M.remaining(done), 0);
  assert.deepEqual(M.closed(done), []);
  assert.throws(() => M.flip(done, 0), /終わって/);
});

test("end: the game ends only when the last pair is taken; most pairs wins", () => {
  let s = M.newGame({ pairs: 8, players: 2 }, rng(11));
  const pairs = pairsOf(s);
  pairs.slice(0, 5).forEach(([a, b]) => { s = play2(s, a, b); });
  const [x, y] = missPair(s);
  s = play2(s, x, y);
  pairs.slice(5).forEach(([a, b], k) => {
    assert.equal(s.over, false);
    s = play2(s, a, b);
    assert.equal(s.over, k === 2);
  });
  assert.deepEqual(s.scores, [5, 3]);
  const st = M.standings(s);
  assert.deepEqual(st.winners, [0]);
  assert.equal(st.tie, false);
  assert.deepEqual(st.order.map(o => [o.player, o.rank]), [[0, 1], [1, 2]]);
});

test("standings: ties are shared", () => {
  const base = M.newGame({ pairs: 8, players: 4 }, rng(12));
  const st = M.standings({ ...base, scores: [3, 1, 3, 1] });
  assert.deepEqual(st.winners, [0, 2]);
  assert.equal(st.tie, true);
  assert.equal(st.best, 3);
  assert.deepEqual(st.order.map(o => [o.player, o.rank]), [[0, 1], [2, 1], [1, 3], [3, 3]]);
  assert.deepEqual(M.standings({ ...base, players: 2, scores: [4, 4] }).winners, [0, 1]);
});

/* ---------- immutability ---------- */
test("immutability: no function changes the state, memory or options it was given", () => {
  const options = { pairs: 8, players: 2, first: 1 };
  const optCopy = clone(options);
  const s = M.newGame(options, rng(13));
  assert.deepEqual(options, optCopy);
  const before = clone(s);
  const one = M.flip(s, 0);
  assert.deepEqual(s, before);
  const oneCopy = clone(one);
  const mem = { 5: s.cards[5].key };
  const memCopy = clone(mem);
  const learned = M.observe(mem, one, [0], "hard", () => 0);
  assert.deepEqual(mem, memCopy);
  assert.deepEqual(one, oneCopy);
  assert.notEqual(learned, mem);
  M.cpuPick(one, learned, rng(1));
  assert.deepEqual(one, oneCopy);
  const two = M.flip(one, M.closed(one)[0]);
  const twoCopy = clone(two);
  M.resolve(two);
  M.standings(two);
  assert.deepEqual(two, twoCopy);
});

/* ---------- CPU memory ---------- */
test("observe: remembers with the level's chance, only face-up cards, and forgets taken cards", () => {
  const s = M.newGame({ pairs: 8, players: 2 }, rng(14));
  const one = M.flip(s, 4);
  assert.deepEqual(M.observe({}, one, [4], "easy", () => 0.5), {}, "35% misses at 0.5");
  assert.deepEqual(M.observe({}, one, [4], "normal", () => 0.5), { 4: s.cards[4].key });
  assert.deepEqual(M.observe({}, one, [4], "hard", () => 0.9), { 4: s.cards[4].key });
  assert.deepEqual(M.observe({}, one, [4], "normal", () => 0.7), {});
  assert.deepEqual(M.observe({}, one, [5, 6], "hard", () => 0), {}, "face-down cards cannot be learned");
  const [a, b] = pairsOf(s)[0];
  const taken = play2(s, a, b);
  const mem = { [a]: s.cards[a].key, [b]: s.cards[b].key, 99: "x" };
  assert.deepEqual(M.observe(mem, taken, [], "hard"), {});
  assert.throws(() => M.observe({}, one, [4], "oni"), /強さ/);
  assert.throws(() => M.observe(null, one, [4], "easy"), /記憶/);
  assert.deepEqual(M.RECALL, { easy: 0.35, normal: 0.65, hard: 0.95 });
});

test("cpu: takes a pair it remembers", () => {
  const s = M.newGame({ pairs: 12, players: 2 }, rng(15));
  const [a, b] = pairsOf(s)[3];
  const memory = { [a]: s.cards[a].key, [b]: s.cards[b].key };
  const first = M.cpuPick(s, memory, rng(1));
  assert.ok([a, b].includes(first));
  const second = M.cpuPick(M.flip(s, first), memory, rng(2));
  assert.equal(second, first === a ? b : a);
});

test("cpu: matches the open card from memory, otherwise tries a card it has not seen", () => {
  const s = M.newGame({ pairs: 12, players: 2 }, rng(16));
  const [a, b] = pairsOf(s)[0];
  const one = M.flip(s, a);
  assert.equal(M.cpuPick(one, { [b]: s.cards[b].key }), b);
  const [c] = pairsOf(s)[1];
  const [d] = pairsOf(s)[2];
  const memory = { [c]: s.cards[c].key, [d]: s.cards[d].key };
  for (let seed = 0; seed < 100; seed++) {
    const pick = M.cpuPick(one, memory, rng(seed));
    assert.ok(![a, c, d].includes(pick), "never a known non-match or the open card");
    assert.ok(M.canFlip(one, pick));
  }
});

test("cpu: never peeks — face-down cards it does not remember cannot change its choice", () => {
  for (let seed = 0; seed < 200; seed++) {
    const r = rng(seed);
    let s = M.newGame({ pairs: 12, players: 2 }, r);
    const pairs = pairsOf(s);
    pairs.slice(0, 3).forEach(([a, b]) => { s = play2(s, a, b); });
    const hidden = M.closed(s);
    const seenPos = hidden.slice(0, 5);
    const memory = Object.fromEntries(seenPos.map(p => [p, s.cards[p].key]));
    const withOpen = seed % 2 ? M.flip(s, hidden[7]) : s;
    const unknown = M.closed(withOpen).filter(p => !(p in memory));
    const shuffled = [...unknown].sort(() => r() - 0.5);
    const cards = withOpen.cards.map((c, i) => (unknown.includes(i) ? withOpen.cards[shuffled[unknown.indexOf(i)]] : c));
    const swapped = { ...withOpen, cards };
    assert.equal(M.cpuPick(swapped, memory, rng(seed + 1)), M.cpuPick(withOpen, memory, rng(seed + 1)));
  }
});

test("cpu: errors on a finished game or a full turn", () => {
  const s = M.newGame({ pairs: 8, players: 2 }, rng(17));
  const [x, y] = missPair(s);
  assert.throws(() => M.cpuPick(M.flip(M.flip(s, x), y), {}), /めくれません/);
  assert.throws(() => M.cpuPick({ ...s, over: true }, {}), /めくれません/);
  assert.throws(() => M.cpuPick(s, null), /記憶/);
});

/* Plays a whole game; seat 0 and seat 1 are CPUs with the given levels (null = a player who forgets everything). */
function cpuGame(levels, pairs, seed) {
  const r = rng(seed);
  let s = M.newGame({ pairs, players: levels.length, first: seed % levels.length }, r);
  let memories = levels.map(() => ({}));
  let guard = 0;
  while (!s.over) {
    assert.ok(guard++ < 2000, "game must end");
    const me = s.turn;
    for (let k = 0; k < 2; k++) {
      const pick = M.cpuPick(s, levels[me] ? memories[me] : {}, r);
      assert.equal(M.flipError(s, pick), null, "cpu move must be legal");
      s = M.flip(s, pick);
      memories = memories.map((m, i) => (levels[i] ? M.observe(m, s, [pick], levels[i], r) : m));
    }
    s = M.resolve(s);
  }
  return s;
}

test("cpu: always legal and every game ends, at every level and size", () => {
  M.PAIR_COUNTS.forEach(pairs => M.LEVELS.forEach((level, k) => {
    for (let seed = 0; seed < 12; seed++) {
      const s = cpuGame([level, M.LEVELS[(k + 1) % 3]], pairs, seed * 31 + pairs);
      assert.equal(s.scores[0] + s.scores[1], pairs);
    }
  }));
});

test("cpu: higher levels clear a solo game in fewer tries", () => {
  const avg = (level) => {
    let sum = 0;
    for (let seed = 0; seed < 120; seed++) sum += cpuGame([level], 12, seed).tries;
    return sum / 120;
  };
  const [easy, normal, hard] = M.LEVELS.map(avg);
  assert.ok(hard < normal && normal < easy, `easy ${easy} normal ${normal} hard ${hard}`);
  assert.ok(easy - hard > 6, "levels feel clearly different");
});

test("cpu: つよい beats よわい most of the time", () => {
  let hardWins = 0;
  let easyWins = 0;
  for (let seed = 0; seed < 200; seed++) {
    const s = cpuGame(["hard", "easy"], 12, seed);
    if (s.scores[0] > s.scores[1]) hardWins++;
    if (s.scores[1] > s.scores[0]) easyWins++;
  }
  assert.ok(hardWins > easyWins * 2, `hard ${hardWins} easy ${easyWins}`);
});

test("cpu: worst-case think time stays under 150 ms (with a 3x margin)", () => {
  /* Collect many varied positions from real games: every size, level and stage of the game. */
  const positions = [];
  for (let seed = 0; seed < 300; seed++) {
    const r = rng(seed);
    const level = M.LEVELS[seed % 3];
    let s = M.newGame({ pairs: M.PAIR_COUNTS[seed % 3], players: 2 }, r);
    let memory = {};
    while (!s.over) {
      for (let k = 0; k < 2; k++) {
        positions.push({ s, memory, level });
        const pick = M.cpuPick(s, memory, r);
        s = M.flip(s, pick);
        memory = M.observe(memory, s, [pick], level, r);
      }
      s = M.resolve(s);
    }
  }
  /* Best of 3 runs per position, so a garbage-collection pause is not counted as thinking. */
  const think = ({ s, memory, level }, seed) => {
    const t0 = performance.now();
    const pick = M.cpuPick(s, memory, rng(seed));
    M.observe(memory, M.flip(s, pick), [pick], level, rng(seed));
    return performance.now() - t0;
  };
  let worst = 0;
  positions.forEach((p, i) => {
    worst = Math.max(worst, Math.min(think(p, i), think(p, i), think(p, i)));
  });
  assert.ok(positions.length > 5000, `only ${positions.length} positions`);
  assert.ok(worst < 150 * TIMING_SLACK / 3, `worst ${worst.toFixed(2)} ms`);
});

/* ---------- records ---------- */
test("records: storage values are validated; fewer tries, then faster time, is better", () => {
  const empty = { 8: null, 12: null, 16: null };
  [null, undefined, 3, "x", [], { 8: "a" }].forEach(raw => assert.deepEqual(M.normalizeRecords(raw), empty));
  const raw = { 8: { tries: 10, ms: 30000 }, 12: { tries: 5, ms: 1000 }, 16: { tries: 20.5, ms: 1 }, 99: { tries: 1, ms: 1 } };
  assert.deepEqual(M.normalizeRecords(raw), { 8: { tries: 10, ms: 30000 }, 12: null, 16: null });
  assert.deepEqual(M.normalizeRecords({ 12: { tries: 20, ms: -1 } })[12], null);
  assert.deepEqual(M.normalizeRecords({ "16": { tries: 30, ms: 90000, extra: 1 } })[16], { tries: 30, ms: 90000 });
  assert.ok(M.isBetter({ tries: 20, ms: 99999 }, null));
  assert.ok(M.isBetter({ tries: 19, ms: 99999 }, { tries: 20, ms: 1 }));
  assert.ok(M.isBetter({ tries: 20, ms: 1000 }, { tries: 20, ms: 2000 }));
  assert.ok(!M.isBetter({ tries: 20, ms: 2000 }, { tries: 20, ms: 2000 }));
  assert.ok(!M.isBetter({ tries: 21, ms: 1 }, { tries: 20, ms: 99999 }));
});

/* ---------- layout ---------- */
test("layout: 8 and 12 pairs fit a 375px phone without scrolling; 16 pairs keep tappable cards", () => {
  const width = 375 - 32 - 5 - 16;
  [300, 337, 400, 482, 560].forEach(height => {
    [8, 12].forEach(pairs => {
      const L = M.gridLayout(pairs * 2, width, height);
      assert.equal(L.scroll, false, `${pairs} pairs at ${height}`);
      assert.ok(L.w >= 46, `${pairs} pairs at ${height}: ${L.w}px`);
      assert.ok(L.cols * L.w + (L.cols - 1) * 6 <= width, "fits the width");
      assert.ok(L.rows * L.w * 7 / 5 + (L.rows - 1) * 6 <= height, "fits the height");
      assert.ok(L.cols * L.rows >= pairs * 2);
    });
    const L16 = M.gridLayout(32, width, height);
    assert.ok(L16.w >= 46 && L16.cols * L16.w + (L16.cols - 1) * 6 <= width);
  });
  assert.deepEqual(M.gridLayout(16, width, 482), { cols: 4, rows: 4, w: 76, scroll: false });
  assert.ok(M.gridLayout(16, 600, 2000).w <= 84, "capped on big screens");
  assert.throws(() => M.gridLayout(0, 300, 300), /枚数/);
  assert.throws(() => M.gridLayout(16, 0, 300), /画面/);
  assert.throws(() => M.gridLayout(16, 300, NaN), /画面/);
});

/* ---------- seats and table talk ---------- */
test("seating: solo, CPU first or second, and 2-4 named players", () => {
  assert.deepEqual(M.seating("solo"), { mode: "solo", names: ["あなた"], first: 0, cpuSeat: M.NONE });
  assert.deepEqual(M.seating("cpu", 2, true), { mode: "cpu", names: ["あなた", "CPU"], first: 0, cpuSeat: 1 });
  assert.equal(M.seating("cpu", 2, false).first, 1);
  assert.deepEqual(M.seating("group", 3).names, ["Aさん", "Bさん", "Cさん"]);
  assert.equal(M.seating("group", 4).names.length, 4);
  [1, 5, 2.5, undefined].forEach(n => assert.throws(() => M.seating("group", n), /2〜4人/));
  assert.throws(() => M.seating("online"), /遊び方/);
  M.MODES.forEach(mode => {
    const seats = M.seating(mode, 2, true);
    assert.doesNotThrow(() => M.newGame({ pairs: 8, players: seats.names.length, first: seats.first }));
  });
});

test("status: what the screen says at every step", () => {
  const seats = M.seating("cpu", 2, true);
  const s = M.newGame({ pairs: 8, players: 2 }, rng(21));
  assert.deepEqual(M.status(s, seats, null), { title: "あなたの番", hint: "2枚めくろう（のこり8組）" });
  assert.equal(M.status(M.flip(s, 0), seats, null).hint, "もう1枚めくろう");
  assert.equal(M.status(s, seats, "cpu").title, "CPUが考え中…");
  assert.equal(M.status(s, seats, "deal").title, "カードを配っています");
  const [a, b] = pairsOf(s)[0];
  const two = M.flip(M.flip(s, a), b);
  assert.deepEqual(M.status(two, seats, "match"), { title: "ペア！", hint: "あなたはもう1回めくれます" });
  const hit = M.resolve(two);
  assert.equal(M.status(hit, seats, "fly").title, "ペア！");
  assert.equal(M.status(hit, seats, null).hint, "続けてめくれます（のこり7組）");
  const [c, d] = pairsOf(s)[1];
  assert.equal(M.status(M.flip(M.flip(hit, c), d), seats, "match").title, "2連続でペア！");
  const [x, y] = missPair(hit);
  assert.deepEqual(M.status(M.flip(M.flip(hit, x), y), seats, "miss"), { title: "ざんねん…", hint: "次はCPUの番" });
  const cpuTurn = { ...two, turn: 1 };
  assert.equal(M.status(cpuTurn, seats, "match").hint, "CPUがもう1回めくります");
  const solo = M.seating("solo");
  const one = M.newGame({ pairs: 12 }, rng(22));
  assert.deepEqual(M.status(one, solo, null), { title: "ペアを探そう", hint: "2枚めくろう（のこり12組）" });
  assert.equal(M.status(one, solo, "miss").hint, "どこに何があったか覚えておこう");
  const group = M.seating("group", 3);
  const g = M.newGame({ pairs: 8, players: 3, first: 2 }, rng(23));
  assert.equal(M.status(g, group, null).title, "Cさんの番");
  assert.equal(M.status(g, group, "miss").hint, "次はAさんの番");
});

test("status: the last pair does not promise another turn", () => {
  const seats = M.seating("cpu", 2, true);
  let s = M.newGame({ pairs: 8, players: 2 }, rng(26));
  const pairs = pairsOf(s);
  pairs.slice(0, 7).forEach(([a, b]) => { s = play2(s, a, b); });
  const [a, b] = pairs[7];
  const last = M.flip(M.flip(s, a), b);
  const matchMsg = M.status(last, seats, "match");
  assert.doesNotMatch(matchMsg.hint, /もう1回/);
  assert.equal(matchMsg.hint, "これで全部そろいました");
  const done = M.resolve(last);
  assert.equal(done.over, true);
  assert.equal(M.status(done, seats, "fly").hint, "これで全部そろいました");
  assert.equal(M.status({ ...last, turn: 1 }, seats, "match").hint, "これで全部そろいました");
  assert.equal(M.status(M.newGame({ pairs: 8 }, rng(27)), M.seating("solo"), null).hint, "2枚めくろう（のこり8組）");
});

test("rulesText: 3-5 concrete lines per mode, card count from the pair count", () => {
  M.MODES.forEach(mode => M.PAIR_COUNTS.forEach(pairs => {
    const lines = M.rulesText(mode, pairs);
    assert.ok(lines.length >= 3 && lines.length <= 5, `${mode} ${pairs}`);
    assert.ok(lines[0].startsWith(`${pairs * 2}枚`));
    assert.ok(lines.some(l => l.includes("同じ色")));
  }));
  assert.ok(M.rulesText("cpu", 12).some(l => l.includes("CPU")));
  assert.ok(!M.rulesText("group", 12).some(l => l.includes("CPU")));
  assert.throws(() => M.rulesText("online", 12), /遊び方/);
  assert.throws(() => M.rulesText("solo", 10), /ペア/);
});

test("layout: when the grid must scroll, it keeps the fewest rows with the biggest cards (no lone last card)", () => {
  const L = M.gridLayout(16, 267, 236);
  assert.equal(L.scroll, true);
  assert.deepEqual([L.cols, L.rows], [4, 4], "4x4, not 5 columns with one card left over");
  assert.ok(L.w > 48);
  const L32 = M.gridLayout(32, 322, 300);
  assert.equal(L32.scroll, true);
  assert.equal(L32.cols, 6, "the most rows saved on a 375px phone");
  assert.ok(L32.w >= 46);
});

test("layout: tiny grids do not crash", () => {
  [1, 2, 3].forEach(count => {
    const L = M.gridLayout(count, 322, 400);
    assert.ok(L.cols >= count && L.rows === 1 && L.w >= 46, `${count} cards`);
  });
});

test("verdict: a full draw has no winners, so nobody is marked as the winner", () => {
  const base = M.newGame({ pairs: 8, players: 2 }, rng(28));
  assert.deepEqual(M.verdict({ ...base, scores: [4, 4] }, M.seating("cpu", 2, true)).winners, []);
  assert.deepEqual(M.verdict({ ...base, scores: [4, 4] }, M.seating("group", 2)).winners, []);
  const four = M.newGame({ pairs: 8, players: 4 }, rng(29));
  assert.deepEqual(M.verdict({ ...four, scores: [2, 2, 2, 2] }, M.seating("group", 4)).winners, []);
  assert.deepEqual(M.verdict({ ...four, scores: [3, 1, 3, 1] }, M.seating("group", 4)).winners, [0, 2], "shared 1st place still wins");
  assert.deepEqual(M.verdict({ ...base, scores: [3, 5] }, M.seating("cpu", 2, true)).winners, [1]);
});

test("verdict: clear winner, shared first place, and draws", () => {
  const base = M.newGame({ pairs: 8, players: 2 }, rng(24));
  const cpu = M.seating("cpu", 2, true);
  assert.deepEqual(M.verdict({ ...base, scores: [5, 3] }, cpu), { title: "あなたの勝ち！", hint: "あなた 5 対 3 CPU", mood: "win", winners: [0] });
  assert.equal(M.verdict({ ...base, scores: [3, 5] }, cpu).mood, "lose");
  assert.equal(M.verdict({ ...base, scores: [4, 4] }, cpu).title, "引き分け！");
  const four = M.newGame({ pairs: 8, players: 4 }, rng(25));
  const group = M.seating("group", 4);
  assert.deepEqual(M.verdict({ ...four, scores: [1, 4, 2, 1] }, group), { title: "Bさんの勝ち！", hint: "ペアを多く取った人の勝ち", mood: "cheer", winners: [1] });
  assert.equal(M.verdict({ ...four, scores: [3, 1, 3, 1] }, group).title, "AさんとCさんが同点で1位！");
  assert.equal(M.verdict({ ...four, scores: [2, 2, 2, 2] }, group).mood, "draw");
  assert.equal(M.verdict({ ...four, scores: [2, 2, 2, 2] }, group).title, "全員同点！ 引き分け");
  assert.equal(M.verdict({ ...base, scores: [4, 4] }, M.seating("group", 2)).title, "同点！ 引き分け");
});

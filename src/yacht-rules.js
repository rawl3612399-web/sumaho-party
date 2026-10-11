/* Yacht (世界のアソビ大全51): roll 5 dice up to 3 times a turn, then fill one of 12 boxes. 12 turns each; 63+ in the upper six gives +35. */
const YachtRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const DICE = 5;
  const FACES = 6;
  const ROLLS = 3;
  const PLAYERS = Object.freeze({ min: 1, max: 4 });
  const BONUS = Object.freeze({ line: 63, points: 35 });
  const PRIZE = Object.freeze({ sstraight: 15, lstraight: 30, yacht: 50 });
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);

  const cat = (id, name, note, face = 0) => Object.freeze({ id, name, note, face });
  const CATEGORIES = Object.freeze([
    cat("ones", "1の目", "1の目の合計", 1),
    cat("twos", "2の目", "2の目の合計", 2),
    cat("threes", "3の目", "3の目の合計", 3),
    cat("fours", "4の目", "4の目の合計", 4),
    cat("fives", "5の目", "5の目の合計", 5),
    cat("sixes", "6の目", "6の目の合計", 6),
    cat("choice", "チョイス", "5個の合計"),
    cat("four", "フォーダイス", "4個同じ・合計"),
    cat("full", "フルハウス", "3個+2個・合計"),
    cat("sstraight", "S.ストレート", "4つ連続・15点"),
    cat("lstraight", "B.ストレート", "5つ連続・30点"),
    cat("yacht", "ヨット", "5個同じ・50点")
  ]);
  const IDS = Object.freeze(CATEGORIES.map(c => c.id));
  const UPPER = Object.freeze(CATEGORIES.filter(c => c.face).map(c => c.id));
  const TURNS = CATEGORIES.length;
  const BY_ID = Object.freeze(Object.fromEntries(CATEGORIES.map(c => [c.id, c])));
  const NO_HOLD = Object.freeze(Array(DICE).fill(false));
  const EMPTY_SHEET = Object.freeze(Object.fromEntries(IDS.map(id => [id, null])));

  /* ---------- validation ---------- */
  function checkDice(dice) {
    const ok = Array.isArray(dice) && dice.length === DICE && dice.every(d => Number.isInteger(d) && d >= 1 && d <= FACES);
    if (!ok) throw new Error("サイコロの目が正しくありません");
  }
  function checkCat(id) {
    if (!IDS.includes(id)) throw new Error("そのマスはありません");
  }
  function checkState(s) {
    const ok = s && typeof s === "object" && Array.isArray(s.sheets) && s.sheets.length === s.players
      && Number.isInteger(s.turn) && s.turn >= 0 && s.turn < s.players && Number.isInteger(s.rolls)
      && s.rolls >= 0 && s.rolls <= ROLLS && Array.isArray(s.held) && s.held.length === DICE;
    if (!ok) throw new Error("ゲームの状態が正しくありません");
    if (s.rolls > 0) checkDice(s.dice);
  }
  function checkLive(s) {
    checkState(s);
    if (s.over) throw new Error("ゲームは終わっています");
  }

  /* ---------- scoring ---------- */
  const countsOf = (dice) => Array.from({ length: FACES }, (_, f) => dice.filter(d => d === f + 1).length);
  const sumOf = (dice) => dice.reduce((a, d) => a + d, 0);
  const longestRun = (counts) => counts.reduce(([best, cur], n) => (n ? [Math.max(best, cur + 1), cur + 1] : [best, 0]), [0, 0])[0];

  const SCORERS = Object.freeze({
    choice: (d) => sumOf(d),
    four: (d, c) => (Math.max(...c) >= 4 ? sumOf(d) : 0),
    full: (d, c) => (c.includes(3) && c.includes(2) ? sumOf(d) : 0),
    sstraight: (d, c) => (longestRun(c) >= 4 ? PRIZE.sstraight : 0),
    lstraight: (d, c) => (longestRun(c) >= 5 ? PRIZE.lstraight : 0),
    yacht: (d, c) => (c.includes(DICE) ? PRIZE.yacht : 0)
  });
  const scoreFor = (id, dice, counts = countsOf(dice)) => {
    const face = BY_ID[id].face;
    return face ? face * counts[face - 1] : SCORERS[id](dice, counts);
  };
  function score(id, dice) {
    checkCat(id);
    checkDice(dice);
    return scoreFor(id, dice);
  }
  function scoreAll(dice) {
    checkDice(dice);
    const counts = countsOf(dice);
    return Object.freeze(Object.fromEntries(IDS.map(id => [id, scoreFor(id, dice, counts)])));
  }
  const isYacht = (dice) => Array.isArray(dice) && dice.length === DICE && dice.every(d => d === dice[0]) && dice[0] >= 1;

  /* ---------- sheets ---------- */
  const openCats = (sheet) => IDS.filter(id => sheet[id] === null);
  const upperSum = (sheet) => UPPER.reduce((a, id) => a + (sheet[id] ?? 0), 0);
  const bonusOf = (sheet) => (upperSum(sheet) >= BONUS.line ? BONUS.points : 0);
  const totalOf = (sheet) => IDS.reduce((a, id) => a + (sheet[id] ?? 0), 0) + bonusOf(sheet);
  function bonusInfo(sheet) {
    const subtotal = upperSum(sheet);
    const room = UPPER.filter(id => sheet[id] === null).reduce((a, id) => a + BY_ID[id].face * DICE, 0);
    return Object.freeze({
      subtotal, need: Math.max(0, BONUS.line - subtotal), reached: subtotal >= BONUS.line, possible: subtotal + room >= BONUS.line
    });
  }

  /* ---------- game state ---------- */
  function newGame(players) {
    if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) {
      throw new Error(`人数は${PLAYERS.min}〜${PLAYERS.max}人です`);
    }
    return Object.freeze({
      players, sheets: Object.freeze(Array.from({ length: players }, () => EMPTY_SHEET)),
      turn: 0, round: 1, dice: null, held: NO_HOLD, rolls: 0, over: false, last: null
    });
  }
  const canRoll = (s) => !s.over && s.rolls < ROLLS && (s.rolls === 0 || s.held.some(h => !h));
  const canHold = (s) => !s.over && s.rolls > 0 && s.rolls < ROLLS;
  const canScore = (s, id) => !s.over && s.rolls > 0 && IDS.includes(id) && s.sheets[s.turn][id] === null;
  const rollsLeft = (s) => ROLLS - s.rolls;

  /* The first roll of a turn throws all five dice; later rolls keep the held ones. */
  function roll(state, r = Math.random) {
    checkLive(state);
    if (state.rolls >= ROLLS) throw new Error("この番はもうふれません");
    const fresh = state.rolls === 0;
    if (!fresh && state.held.every(Boolean)) throw new Error("全部キープしています");
    const held = fresh ? NO_HOLD : state.held;
    const face = () => Math.min(FACES, 1 + Math.floor(r() * FACES));
    const dice = Object.freeze(Array.from({ length: DICE }, (_, i) => (held[i] ? state.dice[i] : face())));
    return Object.freeze({ ...state, dice, held, rolls: state.rolls + 1 });
  }
  function setHeld(state, held) {
    checkLive(state);
    if (!Array.isArray(held) || held.length !== DICE || !held.every(h => typeof h === "boolean")) {
      throw new Error("キープの指定が正しくありません");
    }
    if (!canHold(state)) throw new Error("いまはキープできません");
    return Object.freeze({ ...state, held: Object.freeze([...held]) });
  }
  function toggleHold(state, i) {
    if (!Number.isInteger(i) || i < 0 || i >= DICE) throw new Error("サイコロの番号が正しくありません");
    checkLive(state);
    return setHeld(state, state.held.map((h, k) => (k === i ? !h : h)));
  }
  function choose(state, id) {
    checkLive(state);
    checkCat(id);
    if (state.rolls === 0) throw new Error("先にサイコロをふってね");
    const before = state.sheets[state.turn];
    if (before[id] !== null) throw new Error("そのマスはもう記入ずみです");
    const points = scoreFor(id, state.dice);
    const sheet = Object.freeze({ ...before, [id]: points });
    const sheets = Object.freeze(state.sheets.map((s, p) => (p === state.turn ? sheet : s)));
    const over = sheets.every(s => openCats(s).length === 0);
    const next = over ? state.turn : (state.turn + 1) % state.players;
    const round = !over && next === 0 ? state.round + 1 : state.round;
    const bonus = !bonusInfo(before).reached && bonusInfo(sheet).reached;
    const last = Object.freeze({ player: state.turn, cat: id, points, bonus, yacht: isYacht(state.dice) });
    return Object.freeze({ ...state, sheets, turn: next, round, dice: null, held: NO_HOLD, rolls: 0, over, last });
  }
  /* What the current dice would score in each open box of the player on turn (null before the first roll). */
  function previews(state) {
    checkState(state);
    if (state.rolls === 0 || state.over) return null;
    const all = scoreAll(state.dice);
    return Object.freeze(Object.fromEntries(openCats(state.sheets[state.turn]).map(id => [id, all[id]])));
  }
  /* Players by total, best first. Equal totals share a rank. */
  function ranking(state) {
    checkState(state);
    const totals = state.sheets.map(totalOf);
    const rows = totals.map((total, player) => Object.freeze({ player, total, rank: 1 + totals.filter(t => t > total).length }));
    return Object.freeze([...rows].sort((a, b) => a.rank - b.rank || a.player - b.player));
  }
  const winners = (state) => Object.freeze(ranking(state).filter(row => row.rank === 1).map(row => row.player));

  /* ---------- CPU: a cheap value per box, used to pick boxes and to judge which dice to keep ---------- */
  /* Tuned by self-play (solo average about 184 for つよい). */
  const BASE = Object.freeze({
    ones: 2, twos: 5, threes: 6.5, fours: 11, fives: 11, sixes: 17, choice: 24, four: 11, full: 13, sstraight: 15, lstraight: 18, yacht: 7
  });
  const WEIGHT = Object.freeze({ par: 0.6, reach: 20, lose: 9 });

  /* Returns (box, points) => value for this sheet: points over a typical result, plus the effect on the +35 bonus. */
  function valueModel(sheet) {
    const info = bonusInfo(sheet);
    const live = !info.reached && info.possible;
    const roomBut = (id) => UPPER.filter(u => u !== id && sheet[u] === null).reduce((a, u) => a + BY_ID[u].face * DICE, 0);
    const room = Object.fromEntries(UPPER.map(id => [id, roomBut(id)]));
    return (id, points) => {
      const face = BY_ID[id].face;
      const base = points - BASE[id];
      if (!face || !live) return base;
      const after = info.subtotal + points;
      if (after >= BONUS.line) return base + WEIGHT.reach;
      if (after + room[id] < BONUS.line) return base - WEIGHT.lose;
      return base + WEIGHT.par * (points - 3 * face);
    };
  }
  function bestBox(sheet, dice) {
    const value = valueModel(sheet);
    const counts = countsOf(dice);
    const rated = openCats(sheet).map(id => [id, value(id, scoreFor(id, dice, counts))]);
    return rated.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
  }
  function rawBestBox(sheet, dice, r) {
    const counts = countsOf(dice);
    const rated = openCats(sheet).map(id => [id, scoreFor(id, dice, counts)]);
    const top = Math.max(...rated.map(x => x[1]));
    return R.pick(rated.filter(x => x[1] === top).map(x => x[0]), r);
  }

  /* ---------- CPU: exact dice search over all 252 hands (つよい) ----------
     A multiset of dice is coded as sum(count[f] * 6^f), so keep + outcome = code + code. Tables are built once, lazily. */
  const POW = Object.freeze([1, 6, 36, 216, 1296, 7776]);
  const FACT = Object.freeze([1, 1, 2, 6, 24, 120]);
  const CODES = POW[FACES - 1] * FACES;
  const keyOf = (counts) => counts.reduce((a, c, i) => a + c * POW[i], 0);
  const chance = (counts, n) => FACT[n] / counts.reduce((a, c) => a * FACT[c], 1) / Math.pow(FACES, n);
  let tablesCache = null;

  /* Every count vector with at most five dice, fewest dice first. */
  function allVectors() {
    const out = [];
    const walk = (face, left, counts) => {
      if (face === FACES) return out.push(counts);
      for (let n = 0; n <= left; n++) walk(face + 1, left - n, [...counts, n]);
      return out.length;
    };
    walk(0, DICE, []);
    const rows = out.map(counts => ({ counts, code: keyOf(counts), size: counts.reduce((a, n) => a + n, 0) }));
    return rows.sort((a, b) => a.size - b.size || a.code - b.code);
  }
  function subCodes(counts) {
    let codes = [0];
    for (let f = 0; f < FACES; f++) {
      const next = [];
      for (const c of codes) for (let n = 0; n <= counts[f]; n++) next.push(c + n * POW[f]);
      codes = next;
    }
    return codes;
  }
  /* Packs lists of [index, weight] pairs into flat typed arrays for fast loops. */
  function pack(lists) {
    const start = new Int32Array(lists.length + 1);
    lists.forEach((list, i) => { start[i + 1] = start[i] + list.length; });
    const at = new Int32Array(start[lists.length]);
    const p = new Float64Array(start[lists.length]);
    lists.forEach((list, i) => list.forEach(([a, w], k) => { at[start[i] + k] = a; p[start[i] + k] = w; }));
    return Object.freeze({ start, at, p });
  }
  function buildTables() {
    const vecs = allVectors();
    const hands = vecs.filter(v => v.size === DICE);
    const handAt = new Int32Array(CODES).fill(-1);
    const keepAt = new Int32Array(CODES).fill(-1);
    hands.forEach((h, i) => { handAt[h.code] = i; });
    vecs.forEach((v, i) => { keepAt[v.code] = i; });
    const bySize = Array.from({ length: DICE + 1 }, (_, m) => vecs.filter(v => v.size === m).map(v => [v.code, chance(v.counts, m)]));
    const trans = pack(vecs.map(k => bySize[DICE - k.size].map(([code, w]) => [handAt[k.code + code], w])));
    const subs = pack(hands.map(h => subCodes(h.counts).map(code => [keepAt[code], 0])));
    const scores = hands.map(h => {
      const dice = h.counts.flatMap((n, f) => Array(n).fill(f + 1));
      return IDS.map(id => scoreFor(id, dice, h.counts));
    });
    return Object.freeze({ vecs, handAt, keepAt, trans, subs, scores });
  }
  function tables() {
    if (!tablesCache) tablesCache = buildTables();
    return tablesCache;
  }
  /* Builds the search tables ahead of time (about 20-30 ms once), so no CPU turn pays for it. */
  const warmUp = () => { tables(); };
  /* E[keep] = expected value of rolling the other dice once, given hand values W. */
  function expectAll(T, W) {
    const { start, at, p } = T.trans;
    const E = new Float64Array(start.length - 1);
    for (let k = 0; k < E.length; k++) {
      let sum = 0;
      for (let j = start[k]; j < start[k + 1]; j++) sum += p[j] * W[at[j]];
      E[k] = sum;
    }
    return E;
  }
  /* W[hand] = value of the best keep for that hand. */
  function improveAll(T, E) {
    const { start, at } = T.subs;
    const W = new Float64Array(start.length - 1);
    for (let h = 0; h < W.length; h++) {
      let best = -Infinity;
      for (let j = start[h]; j < start[h + 1]; j++) best = Math.max(best, E[at[j]]);
      W[h] = best;
    }
    return W;
  }

  /* Best dice to keep (as counts) with `left` rolls to go, or null when scoring now is best. */
  function searchKeep(sheet, dice, left) {
    const T = tables();
    const value = valueModel(sheet);
    const open = openCats(sheet).map(id => IDS.indexOf(id));
    const now = Float64Array.from(T.scores, row => open.reduce((m, i) => Math.max(m, value(IDS[i], row[i])), -Infinity));
    const E = Array.from({ length: left - 1 }).reduce(prev => expectAll(T, improveAll(T, prev)), expectAll(T, now));
    const code = keyOf(countsOf(dice));
    const h = T.handAt[code];
    const full = T.keepAt[code];
    const ks = Array.from(T.subs.at.subarray(T.subs.start[h], T.subs.start[h + 1]));
    const best = ks.reduce((b, k) => (k !== full && E[k] > b.v + 1e-9 ? { k, v: E[k] } : b), { k: -1, v: now[h] });
    return best.k < 0 ? null : T.vecs[best.k].counts;
  }

  /* ---------- CPU: rule-of-thumb keeps (ふつう) and the simple habit (よわい) ---------- */
  function runKeep(counts) {
    const ends = counts.map((n, f) => (n ? f : -1));
    const runAt = (f) => (counts[f] ? 1 + (f > 0 ? runAt(f - 1) : 0) : 0);
    const len = longestRun(counts);
    const end = ends.find(f => f >= 0 && runAt(f) === len);
    return counts.map((_, f) => (f > end - len && f <= end ? 1 : 0));
  }
  function favoriteFace(sheet, counts) {
    const rate = (f) => counts[f] * 10 + (sheet[UPPER[f]] === null ? 4 : 0) + f;
    return counts.reduce((best, _, f) => (rate(f) > rate(best) ? f : best), 0);
  }
  function normalKeep(sheet, dice) {
    const c = countsOf(dice);
    const open = (id) => sheet[id] === null;
    const run = longestRun(c);
    const top = Math.max(...c);
    const value = valueModel(sheet);
    const bestNow = Math.max(...openCats(sheet).map(id => value(id, scoreFor(id, dice, c))));
    const madeFull = c.includes(3) && c.includes(2) && open("full");
    const madeStraight = (run === 5 && open("lstraight")) || (run >= 4 && open("sstraight") && !open("lstraight"));
    if ((top === DICE && open("yacht")) || madeFull || madeStraight) return null;
    if (top === DICE - 1 && open("yacht")) return c.map(n => (n === top ? n : 0));
    if (bestNow >= 10) return null;
    if ((open("lstraight") || open("sstraight")) && top <= 2 && run >= 3) return runKeep(c);
    if (open("full") && c.filter(n => n === 2).length === 2) return c.map(n => (n === 2 ? 2 : 0));
    const face = favoriteFace(sheet, c);
    if (c[face] >= 2 || !open("choice")) return c.map((n, f) => (f === face ? n : 0));
    return c.map((n, f) => (f >= 4 ? n : 0));
  }
  function easyKeep(sheet, dice) {
    const c = countsOf(dice);
    const best = Math.max(...openCats(sheet).map(id => scoreFor(id, dice, c)));
    if (best >= 25) return null;
    const top = Math.max(...c);
    const face = c.lastIndexOf(top);
    return c.map((n, f) => (f === face ? n : 0));
  }
  const KEEPERS = Object.freeze({
    easy: (sheet, dice) => easyKeep(sheet, dice),
    normal: (sheet, dice) => normalKeep(sheet, dice),
    hard: (sheet, dice, left) => searchKeep(sheet, dice, left)
  });
  const CHOOSERS = Object.freeze({
    easy: (sheet, dice, r) => rawBestBox(sheet, dice, r),
    normal: (sheet, dice) => bestBox(sheet, dice),
    hard: (sheet, dice) => bestBox(sheet, dice)
  });
  /* Turns kept counts into held flags, holding the first dice of each kept face. */
  function heldFor(dice, keep) {
    const used = Array(FACES).fill(0);
    return Object.freeze(dice.map(d => {
      const take = used[d - 1] < keep[d - 1];
      used[d - 1] += take ? 1 : 0;
      return take;
    }));
  }

  /* One CPU step: { action: "roll", held } or { action: "score", cat }. */
  function cpuPlan(state, level, r = Math.random) {
    checkLive(state);
    if (!LEVELS.includes(level)) throw new Error("CPUの強さが正しくありません");
    if (state.rolls === 0) return Object.freeze({ action: "roll", held: NO_HOLD });
    const sheet = state.sheets[state.turn];
    const keep = state.rolls >= ROLLS ? null : KEEPERS[level](sheet, state.dice, rollsLeft(state), r);
    if (!keep || keep.reduce((a, n) => a + n, 0) >= DICE) {
      return Object.freeze({ action: "score", cat: CHOOSERS[level](sheet, state.dice, r) });
    }
    return Object.freeze({ action: "roll", held: heldFor(state.dice, keep) });
  }

  return {
    DICE, FACES, ROLLS, TURNS, PLAYERS, BONUS, PRIZE, LEVELS, CATEGORIES, IDS, UPPER, BY_ID,
    score, scoreAll, isYacht, openCats, upperSum, bonusOf, totalOf, bonusInfo,
    newGame, canRoll, canHold, canScore, rollsLeft, roll, setHeld, toggleHold, choose, previews, ranking, winners,
    cpuPlan, warmUp
  };
})();

if (typeof module !== "undefined") module.exports = YachtRules;

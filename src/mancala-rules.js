/* Mancala (Kalah) rules: 6 pits and a store per side. Sow counter-clockwise, skip the other store, land in your
 * store to go again, land in your own empty pit to capture the pit across. When one side is empty the game ends
 * and the other side keeps its stones. Also holds the CPU (random / minimax / alpha-beta with extra turns). */
const MancalaRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const PITS = 6;
  const SIZE = 14;
  const STORES = Object.freeze([6, 13]);
  const SIDES = Object.freeze([Object.freeze([0, 1, 2, 3, 4, 5]), Object.freeze([7, 8, 9, 10, 11, 12])]);
  const SEEDS = Object.freeze([3, 4]);
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);

  /* CPU tuning. Scores are from the mover's view: store difference, or WIN for a decided game (sooner is better). */
  const WIN = 100000;
  const PLY = 100;
  const NORMAL_DEPTH = 4;
  const HARD_MIN_DEPTH = 8;
  const HARD_MAX_DEPTH = 14;
  const HARD_NODE_BUDGET = 30000;
  const EASY_EXTRA_CHANCE = 0.5;

  const opposite = (i) => 12 - i;
  const sideOf = (i) => (i >= 0 && i <= 5 ? 0 : i >= 7 && i <= 12 ? 1 : -1);
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  /* Plain loops below: these run hundreds of thousands of times inside the CPU search. */
  function sideTotal(pits, player) {
    const base = player === 0 ? 0 : 7;
    let total = 0;
    for (let i = base; i < base + PITS; i++) total += pits[i];
    return total;
  }

  /* ---------- validation ---------- */
  function checkState(s) {
    const ok = s && Array.isArray(s.pits) && s.pits.length === SIZE &&
      s.pits.every(n => Number.isInteger(n) && n >= 0) && (s.turn === 0 || s.turn === 1) && typeof s.over === "boolean";
    if (!ok) throw new Error("盤面が正しくありません");
  }

  /* ---------- core move (pure: returns a fresh array, never touches the input) ---------- */
  /* Ends the game when a side is empty. Only ever called on sowCore's private copy of the board. */
  function sweepIfDone(p) {
    const left = [sideTotal(p, 0), sideTotal(p, 1)];
    if (left[0] > 0 && left[1] > 0) return null;
    for (let i = 0; i < SIZE; i++) {
      if (!STORES.includes(i)) p[i] = 0;
    }
    p[STORES[0]] += left[0];
    p[STORES[1]] += left[1];
    return left;
  }

  function sowCore(pits, player, pit, trace) {
    const p = pits.slice();
    const own = STORES[player];
    const skip = STORES[1 - player];
    const path = trace ? [] : null;
    let hand = p[pit];
    let at = pit;
    p[pit] = 0;
    while (hand > 0) {
      at = (at + 1) % SIZE;
      if (at === skip) continue;
      p[at] += 1;
      hand -= 1;
      if (path) path.push(at);
    }
    const extra = at === own;
    let capture = null;
    if (!extra && sideOf(at) === player && p[at] === 1 && p[opposite(at)] > 0) {
      capture = { pit: at, opposite: opposite(at), count: p[opposite(at)] + 1 };
      p[own] += capture.count;
      p[at] = 0;
      p[opposite(at)] = 0;
    }
    const sweep = sweepIfDone(p);
    return { pits: p, end: at, extra, capture, sweep, path, over: sweep !== null };
  }

  /* ---------- public game API ---------- */
  function newGame(seeds = 4, first = 0) {
    if (!SEEDS.includes(seeds)) throw new Error("石の数は3個か4個です");
    if (first !== 0 && first !== 1) throw new Error("先攻の指定が正しくありません");
    const pits = Object.freeze(Array.from({ length: SIZE }, (_, i) => (STORES.includes(i) ? 0 : seeds)));
    return Object.freeze({ pits, turn: first, first, seeds, over: false, winner: null, moves: 0, last: null });
  }

  const isLegal = (s, pit) => Number.isInteger(pit) && !s.over && sideOf(pit) === s.turn && s.pits[pit] > 0;
  const legalMoves = (s) => (s.over ? [] : SIDES[s.turn].filter(i => s.pits[i] > 0));
  const scores = (s) => [s.pits[STORES[0]], s.pits[STORES[1]]];

  function winnerOf(pits) {
    const [a, b] = [pits[STORES[0]], pits[STORES[1]]];
    return a > b ? 0 : b > a ? 1 : null;
  }

  function move(s, pit) {
    checkState(s);
    if (s.over) throw new Error("もう決着しています");
    if (!isLegal(s, pit)) throw new Error("その穴は選べません");
    const r = sowCore(s.pits, s.turn, pit, true);
    const extra = r.extra && !r.over;
    const last = Object.freeze({
      player: s.turn, pit, count: s.pits[pit], path: Object.freeze(r.path), end: r.end, extra,
      capture: r.capture ? Object.freeze(r.capture) : null, sweep: r.sweep ? Object.freeze(r.sweep) : null
    });
    return Object.freeze({
      ...s, pits: Object.freeze(r.pits), turn: r.over || extra ? s.turn : 1 - s.turn,
      over: r.over, winner: r.over ? winnerOf(r.pits) : null, moves: s.moves + 1, last
    });
  }

  /* ---------- CPU ---------- */
  const diffFor = (p, me) => p[STORES[me]] - p[STORES[1 - me]];

  /* A finished game, or a store holding more than half of all stones (that side can no longer lose). */
  function decided(p, me, total, ply, over) {
    const diff = diffFor(p, me);
    const doom = WIN - ply * PLY;
    if (over) return diff > 0 ? doom + diff : diff < 0 ? -doom + diff : 0;
    if (p[STORES[me]] * 2 > total) return doom + diff;
    if (p[STORES[1 - me]] * 2 > total) return -doom + diff;
    return null;
  }

  /* Extra-turn moves first, then captures, then the rest (pits nearer the store first). */
  function rank(p, me, i) {
    const n = p[i];
    const dist = STORES[me] - i;
    if (n === dist || n === dist + 13) return 1000;
    const land = i + n;
    if (n < dist && p[land] === 0 && p[opposite(land)] > 0) return 500 + p[opposite(land)];
    return i;
  }
  function ordered(p, me) {
    const list = [];
    const keys = [];
    for (const i of SIDES[me]) {
      if (p[i] === 0) continue;
      const k = rank(p, me, i);
      let j = list.length;
      while (j > 0 && keys[j - 1] < k) {
        list[j] = list[j - 1];
        keys[j] = keys[j - 1];
        j -= 1;
      }
      list[j] = i;
      keys[j] = k;
    }
    return list;
  }

  function child(p, me, m, depth, alpha, beta, ply, ctx) {
    const r = sowCore(p, me, m, false);
    const fixed = decided(r.pits, me, ctx.total, ply + 1, r.over);
    if (fixed !== null) return fixed;
    if (depth <= 1) return diffFor(r.pits, me);
    if (r.extra) return negamax(r.pits, me, depth - 1, alpha, beta, ply + 1, ctx);
    return -negamax(r.pits, 1 - me, depth - 1, -beta, -alpha, ply + 1, ctx);
  }

  function negamax(p, me, depth, alpha, beta, ply, ctx) {
    ctx.nodes += 1;
    if (ctx.nodes > ctx.budget) {
      ctx.aborted = true;
      return 0;
    }
    let best = -Infinity;
    let a = alpha;
    for (const m of ordered(p, me)) {
      const v = child(p, me, m, depth, a, beta, ply, ctx);
      if (v > best) best = v;
      if (v > a) a = v;
      if (a >= beta || ctx.aborted) break;
    }
    return best;
  }

  /* Exact scores for the best root moves (window just below the best keeps ties exact). */
  function searchRoot(s, moves, depth, ctx) {
    let best = -Infinity;
    const scored = moves.map(m => {
      const v = child(s.pits, s.turn, m, depth, best === -Infinity ? -Infinity : best - 1, Infinity, 0, ctx);
      if (v > best) best = v;
      return { m, v };
    });
    return { best, scored };
  }

  function pickBest(result, r) {
    const top = result.scored.filter(x => x.v === result.best).map(x => x.m);
    return R.pick(top, r);
  }

  function deepen(s, moves, r) {
    const ctx = { nodes: 0, budget: Infinity, aborted: false, total: sum(s.pits) };
    let order = moves;
    let done = null;
    for (let depth = 1; depth <= HARD_MAX_DEPTH; depth++) {
      if (depth > HARD_MIN_DEPTH) ctx.budget = HARD_NODE_BUDGET;
      const result = searchRoot(s, order, depth, ctx);
      if (ctx.aborted) break;
      done = result;
      if (Math.abs(result.best) > WIN / 2) break;
      order = [...result.scored].sort((x, y) => y.v - x.v).map(x => x.m);
    }
    return pickBest(done, r);
  }

  function winsNow(s, m) {
    const r = sowCore(s.pits, s.turn, m, false);
    const v = decided(r.pits, s.turn, sum(s.pits), 1, r.over);
    return v !== null && v > WIN / 2;
  }

  function easyMove(s, moves, r) {
    const win = moves.find(m => winsNow(s, m));
    if (win !== undefined) return win;
    const extras = moves.filter(m => {
      const res = sowCore(s.pits, s.turn, m, false);
      return res.extra && !res.over;
    });
    if (extras.length && r() < EASY_EXTRA_CHANCE) return R.pick(extras, r);
    return R.pick(moves, r);
  }

  /* Returns the pit index the CPU plays for whoever's turn it is. */
  function cpuMove(s, level, r = Math.random) {
    checkState(s);
    if (!LEVELS.includes(level)) throw new Error("CPUの強さが正しくありません");
    const moves = legalMoves(s);
    if (!moves.length) throw new Error("動かせる穴がありません");
    if (moves.length === 1) return moves[0];
    if (level === "easy") return easyMove(s, moves, r);
    if (level === "normal") {
      const ctx = { nodes: 0, budget: Infinity, aborted: false, total: sum(s.pits) };
      return pickBest(searchRoot(s, moves, NORMAL_DEPTH, ctx), r);
    }
    return deepen(s, moves, r);
  }

  return {
    PITS, SIZE, STORES, SIDES, SEEDS, LEVELS,
    newGame, isLegal, legalMoves, move, scores, opposite, sideOf, cpuMove
  };
})();

if (typeof module !== "undefined") module.exports = MancalaRules;

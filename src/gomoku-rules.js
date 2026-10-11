/* Gomoku, free style (フリー五目): 15x15, black first, five or more in a row wins, no forbidden moves, full board
 * is a draw. CPU: pattern scoring; hard adds a four-chain (VCF) search and a shallow alpha-beta search. */
const GomokuRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const SIZE = 15, CELLS = SIZE * SIZE, CENTER = 7 * SIZE + 7;
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);
  const STARS = Object.freeze([3 * SIZE + 3, 3 * SIZE + 11, CENTER, 11 * SIZE + 3, 11 * SIZE + 11]);
  const DIRS = Object.freeze([[0, 1], [1, 0], [1, 1], [1, -1]]);

  const other = (c) => 3 - c;
  const colorOfMove = (n) => (n % 2 === 0 ? BLACK : WHITE);
  const isIndex = (i) => Number.isInteger(i) && i >= 0 && i < CELLS;
  const rowOf = (i) => Math.floor(i / SIZE);
  const colOf = (i) => i % SIZE;
  const at = (r, c) => (r >= 0 && r < SIZE && c >= 0 && c < SIZE ? r * SIZE + c : -1);

  /* ---------- game ---------- */
  function newGame() {
    return { board: Array(CELLS).fill(EMPTY), turn: BLACK, moves: [], winner: EMPTY, line: [], draw: false, over: false, resigned: EMPTY };
  }
  function checkState(state) {
    const ok = state && Array.isArray(state.board) && state.board.length === CELLS && Array.isArray(state.moves)
      && (state.turn === BLACK || state.turn === WHITE);
    if (!ok) throw new Error("盤面のデータが正しくありません");
  }
  function moveError(state, i) {
    checkState(state);
    if (state.over) return "もう決着がついています";
    if (!isIndex(i)) return "盤の外です";
    if (state.board[i] !== EMPTY) return "そこにはもう石があります";
    return null;
  }
  const isLegal = (state, i) => moveError(state, i) === null;

  /* Every stone of a run of five or more through i (an overline counts too). */
  function winLine(board, i) {
    const color = board[i];
    if (color === EMPTY) return [];
    const walk = (dr, dc) => {
      const out = [];
      for (let j = at(rowOf(i) + dr, colOf(i) + dc); j >= 0 && board[j] === color; j = at(rowOf(j) + dr, colOf(j) + dc)) out.push(j);
      return out;
    };
    const cells = DIRS.flatMap(([dr, dc]) => {
      const run = [i, ...walk(dr, dc), ...walk(-dr, -dc)];
      return run.length >= 5 ? run : [];
    });
    return [...new Set(cells)].sort((a, b) => a - b);
  }
  function play(state, i) {
    const err = moveError(state, i);
    if (err) throw new Error(err);
    const color = state.turn;
    const board = state.board.map((v, k) => (k === i ? color : v));
    const moves = [...state.moves, i];
    const line = winLine(board, i);
    const won = line.length > 0;
    const draw = !won && moves.length === CELLS;
    return { ...state, board, moves, turn: other(color), winner: won ? color : EMPTY, line, draw, over: won || draw };
  }
  function fromMoves(moves) {
    if (!Array.isArray(moves)) throw new Error("手順のデータが正しくありません");
    return moves.reduce(play, newGame());
  }
  /* Takes moves back until one of `color`'s moves is gone, so it is that player's turn again. */
  function undoTurn(state, color) {
    checkState(state);
    const last = state.moves.map((_, n) => n).filter(n => colorOfMove(n) === color).pop();
    return last === undefined ? state : fromMoves(state.moves.slice(0, last));
  }
  function resign(state, color) {
    checkState(state);
    if (state.over) throw new Error("もう決着がついています");
    if (color !== BLACK && color !== WHITE) throw new Error("色が正しくありません");
    return { ...state, over: true, winner: other(color), resigned: color, line: [] };
  }

  const counts = (state) => ({ black: state.board.filter(v => v === BLACK).length, white: state.board.filter(v => v === WHITE).length });
  const lastMove = (state) => (state.moves.length ? state.moves[state.moves.length - 1] : -1);

  /* ---------- geometry, precomputed once ---------- */
  const OFFSETS = [-4, -3, -2, -1, 1, 2, 3, 4];
  const NEIGH = new Int16Array(CELLS * 32); // (i * 4 + dir) * 8 + k -> cell, or -1 off the board
  const RUNS = [];                           // every line of 5 cells on the board
  for (let i = 0; i < CELLS; i++) {
    DIRS.forEach(([dr, dc], d) => {
      OFFSETS.forEach((s, k) => { NEIGH[(i * 4 + d) * 8 + k] = at(rowOf(i) + dr * s, colOf(i) + dc * s); });
      const run = [0, 1, 2, 3, 4].map(s => at(rowOf(i) + dr * s, colOf(i) + dc * s));
      if (!run.includes(-1)) RUNS.push(run);
    });
  }
  const NRUNS = RUNS.length, RUN_CELLS = Int16Array.from(RUNS.flat());
  const ALL_RUNS = Int16Array.from(RUNS.map((_, w) => w));
  const RUNS_AT = Array.from({ length: CELLS }, () => []);
  RUNS.forEach((run, w) => run.forEach(i => RUNS_AT[i].push(w)));
  const AROUND = Array.from({ length: CELLS }, (_, i) => {
    const out = [];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const j = at(rowOf(i) + dr, colOf(i) + dc);
      if (j >= 0 && j !== i) out.push(j);
    }
    return Int16Array.from(out);
  });
  const CENTRAL = Float32Array.from({ length: CELLS }, (_, i) => (7 - Math.max(Math.abs(rowOf(i) - 7), Math.abs(colOf(i) - 7))) * 0.5);

  /* ---------- line shapes ---------- */
  /* A shape is what one direction through a point looks like once our stone is on it. Nine cells
   * (4 each side) are coded base 3: 0 empty, 1 ours, 2 blocked (their stone or the edge). */
  const NONE = 0, ONE = 1, CLOSED2 = 2, TWO = 3, CLOSED3 = 4, THREE = 5, FOUR = 6, OPEN4 = 7, FIVE = 8;
  const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187];
  const GROW = [NONE, ONE, ONE, ONE, CLOSED2, TWO, CLOSED3, THREE, THREE]; // shape one stone short of each
  const SHAPES = new Int8Array(6561).fill(-1);

  function decode(code) {
    const w = [];
    for (let d = 0, k = code; d < 8; d++, k = Math.floor(k / 3)) w.push(k % 3);
    w.splice(4, 0, 1);
    return w;
  }
  /* Empty cells that would finish a five through the centre; null when it already is five. */
  function completions(w) {
    const pts = [];
    for (let s = 0; s <= 4; s++) {
      const run = w.slice(s, s + 5);
      if (run.includes(2)) continue;
      const gaps = run.filter(v => v === 0).length;
      if (gaps === 0) return null;
      if (gaps === 1 && !pts.includes(s + run.indexOf(0))) pts.push(s + run.indexOf(0));
    }
    return pts;
  }
  function shapeOf(code) {
    if (SHAPES[code] >= 0) return SHAPES[code];
    const w = decode(code);
    const pts = completions(w);
    let shape;
    if (pts === null) shape = FIVE;
    else if (pts.length) shape = pts.length >= 2 ? OPEN4 : FOUR;
    else {
      let best = NONE;
      w.forEach((v, p) => { if (v === 0) best = Math.max(best, shapeOf(code + POW3[p < 4 ? p : p - 1])); });
      shape = GROW[best];
    }
    SHAPES[code] = shape;
    return shape;
  }
  for (let code = 0; code < SHAPES.length; code++) shapeOf(code);

  /* Shapes through i in the 4 directions for c (slots 0-3) and for the other color (slots 4-7), read in one
   * pass. The result is a shared buffer: use it before the next call. */
  const SH = new Int8Array(8);
  function shapes(b, i, c) {
    const o = other(c);
    for (let d = 0; d < 4; d++) {
      let mine = 0, theirs = 0;
      for (let k = 7, base = (i * 4 + d) * 8; k >= 0; k--) {
        const j = NEIGH[base + k], v = j < 0 ? -1 : b[j];
        mine = mine * 3 + (v === EMPTY ? 0 : v === c ? 1 : 2);
        theirs = theirs * 3 + (v === EMPTY ? 0 : v === o ? 1 : 2);
      }
      SH[d] = SHAPES[mine];
      SH[d + 4] = SHAPES[theirs];
    }
    return SH;
  }

  /* ---------- point scores ---------- */
  //            NONE ONE CLOSED2 TWO CLOSED3 THREE FOUR  OPEN4   FIVE
  const VALUE = [0, 4, 30, 200, 260, 1500, 2600, 100000, 10000000];
  const SOFT_DEFENSE = [0, 2, 8, 25, 30, 40, 50, 60, 900]; // よわい barely notices the other side's threats
  const SURE = 1000000, FOUR_THREE = 300000, THREE_THREE = 40000;

  /* Value of the shapes sh[from..from+3]. With combos, double threats (four-four, four-three, three-three)
   * count extra. pointValue: the value of putting c on i. */
  function score(sh, from, combos, table) {
    let sum = 0, fours = 0, threes = 0, top = NONE;
    for (let d = from; d < from + 4; d++) {
      const s = sh[d];
      sum += table[s];
      if (s === FOUR) fours++;
      if (s === THREE) threes++;
      if (s > top) top = s;
    }
    if (!combos || top === FIVE) return sum;
    if (top === OPEN4 || fours >= 2) return sum + SURE;
    if (fours && threes) return sum + FOUR_THREE;
    return threes >= 2 ? sum + THREE_THREE : sum;
  }
  const pointValue = (b, i, c, combos, table = VALUE) => score(shapes(b, i, c), 0, combos, table);

  /* ---------- CPU scratch board ---------- */
  /* The CPU works on its own typed-array copy, built fresh for each call; game states are never changed.
   * cnt holds, for every run of 5, how many black and white stones it has. near counts stones within 2. */
  function scratch(board) {
    const x = { b: new Int8Array(CELLS), cnt: new Int8Array(NRUNS * 2), near: new Uint8Array(CELLS), mark: new Int32Array(CELLS), stamp: 0 };
    board.forEach((v, i) => { if (v === BLACK || v === WHITE) put(x, i, v); });
    return x;
  }
  function put(x, i, c) {
    x.b[i] = c;
    for (const w of RUNS_AT[i]) x.cnt[w * 2 + c - 1]++;
    for (const j of AROUND[i]) x.near[j]++;
  }
  function take(x, i, c) {
    x.b[i] = EMPTY;
    for (const w of RUNS_AT[i]) x.cnt[w * 2 + c - 1]--;
    for (const j of AROUND[i]) x.near[j]--;
  }
  /* Empty cells inside runs holding `need` stones of c and none of the other color.
   * need 4: points where c makes five. need 3: points where c makes a four. */
  function runGaps(x, c, need, runs = ALL_RUNS) {
    const out = [];
    const stamp = ++x.stamp;
    for (let n = 0; n < runs.length; n++) {
      const w = runs[n];
      if (x.cnt[w * 2 + c - 1] !== need || x.cnt[w * 2 + 2 - c] !== 0) continue;
      for (let k = w * 5; k < w * 5 + 5; k++) {
        const j = RUN_CELLS[k];
        if (x.b[j] === EMPTY && x.mark[j] !== stamp) { x.mark[j] = stamp; out.push(j); }
      }
    }
    return out;
  }
  function hasFivePoint(x, c, runs = ALL_RUNS) {
    for (let n = 0; n < runs.length; n++) {
      const w = runs[n];
      if (x.cnt[w * 2 + c - 1] === 4 && x.cnt[w * 2 + 2 - c] === 0) return true;
    }
    return false;
  }

  /* Candidate points near the stones, best first. Keeps only the best `limit`; ties stay in board order. */
  function ranked(x, c, o, limit = CELLS) {
    const list = [];
    for (let i = 0; i < CELLS; i++) {
      if (x.b[i] !== EMPTY || x.near[i] === 0) continue;
      const sh = shapes(x.b, i, c);
      const atk = score(sh, 0, o.combos, VALUE);
      const v = atk + score(sh, 4, o.combos, o.table || VALUE) * o.defense + CENTRAL[i];
      if (list.length === limit && v <= list[limit - 1].v) continue;
      let k = Math.min(list.length, limit - 1);
      for (; k > 0 && list[k - 1].v < v; k--) list[k] = list[k - 1];
      list[k] = { i, atk, v };
    }
    return list;
  }

  /* ---------- levels ---------- */
  const EASY = { combos: false, defense: 0.7, table: SOFT_DEFENSE };
  const NORMAL = { combos: false, defense: 0.85 };
  const HARD = { combos: true, defense: 0.6 };
  const EASY_BLOCK = 0.7, EASY_NOTICE = 0.3; // chance よわい blocks a four / takes threes seriously this move

  function easyMove(x, c, r) {
    const list = ranked(x, c, r() < EASY_NOTICE ? NORMAL : EASY, 12);
    return list.reduce((best, m) => {
      const v = m.v * (0.3 + 1.4 * r()) + r() * 60;
      return v > best.v ? { i: m.i, v } : best;
    }, { i: list[0].i, v: -Infinity }).i;
  }
  function normalMove(x, c, r) {
    const list = ranked(x, c, NORMAL);
    const close = list.filter(m => m.v >= list[0].v * 0.92);
    return R.pick(close, r).i;
  }

  /* ---------- hard: VCF (win by continuous fours) ---------- */
  const VCF_DEPTH = 10, VCF_BUDGET = 1500;
  /* First move of a forced win made only of fours, or -1. Assumes the other side has no four on the board. */
  function findVcf(x, c, depth, budget) {
    if (depth <= 0 || budget.left <= 0) return -1;
    const o = other(c);
    for (const q of runGaps(x, c, 3)) {
      if (--budget.left < 0) return -1;
      put(x, q, c);
      const fives = runGaps(x, c, 4, RUNS_AT[q]);
      let win = fives.length >= 2;
      if (fives.length === 1) {
        put(x, fives[0], o);
        win = !hasFivePoint(x, o, RUNS_AT[fives[0]]) && findVcf(x, c, depth - 1, budget) >= 0;
        take(x, fives[0], o);
      }
      take(x, q, c);
      if (win) return q;
    }
    return -1;
  }

  /* ---------- hard: shallow alpha-beta ---------- */
  const WIN = 1e9, SOON = 1e8, TUPLE = [0, 1, 12, 90, 0, 0];
  const DEPTH = 4, K_ROOT = 12, K_INNER = 8, MAX_PLY = 14;
  const NODE_BUDGET = 320; // searched (non-forced) positions per move: caps the think time on any board

  /* Static value for side s to move (no five points for either side here). */
  function leafEval(x, s) {
    const o = other(s);
    let mine = 0, theirs = 0;
    for (let w = 0; w < NRUNS; w++) {
      const a = x.cnt[w * 2 + s - 1], z = x.cnt[w * 2 + o - 1];
      if (a && !z) mine += TUPLE[a];
      else if (z && !a) theirs += TUPLE[z];
    }
    for (const j of runGaps(x, s, 3)) {
      const v = pointValue(x.b, j, s, true);
      if (v >= SURE) return SOON;
      if (v >= FOUR_THREE) return SOON / 2;
    }
    return mine * 1.2 - theirs;
  }

  function negamax(x, s, depth, alpha, beta, ply, budget) {
    const o = other(s);
    if (hasFivePoint(x, s)) return WIN - ply;
    const blocks = runGaps(x, o, 4);
    if (blocks.length >= 2) return -(WIN - ply - 1);
    if ((blocks.length === 0 && (depth <= 0 || budget.left <= 0)) || ply >= MAX_PLY) return leafEval(x, s);
    if (!blocks.length) budget.left--;
    const moves = blocks.length ? blocks : ranked(x, s, HARD, K_INNER).map(m => m.i);
    if (!moves.length) return 0;
    let best = -Infinity;
    for (const m of moves) {
      put(x, m, s);
      const v = -negamax(x, o, depth - 1, -beta, -alpha, ply + 1, budget);
      take(x, m, s);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }
  function hardMove(x, c, r) {
    const cands = ranked(x, c, HARD, K_ROOT)
      .map(m => ({ ...m, v: m.v * (1 + 0.03 * r()) })).sort((p, q) => q.v - p.v);
    if (cands[0].atk >= SURE) return cands[0].i;
    const vcf = findVcf(x, c, VCF_DEPTH, { left: VCF_BUDGET });
    if (vcf >= 0) return vcf;
    let best = -Infinity, choice = cands[0].i;
    const budget = { left: NODE_BUDGET };
    for (const m of cands) {
      put(x, m.i, c);
      const v = -negamax(x, other(c), DEPTH - 1, -Infinity, -best, 1, budget);
      take(x, m.i, c);
      if (v > best) { best = v; choice = m.i; }
    }
    return choice;
  }

  /* ---------- CPU entry ---------- */
  const firstMove = (level, r) => (level !== "easy" ? CENTER
    : R.pick([CENTER, CENTER - 1, CENTER + 1, CENTER - SIZE, CENTER + SIZE, CENTER - SIZE - 1, CENTER + SIZE + 1], r));
  function cpuMove(state, level, r = Math.random) {
    checkState(state);
    if (state.over) throw new Error("もう決着がついています");
    if (!LEVELS.includes(level)) throw new Error("CPUの強さが正しくありません");
    const c = state.turn;
    if (!state.board.some(v => v !== EMPTY)) return firstMove(level, r);
    const x = scratch(state.board);
    const wins = runGaps(x, c, 4);
    if (wins.length) return wins[0];
    const blocks = runGaps(x, other(c), 4);
    if (blocks.length && (level !== "easy" || r() < EASY_BLOCK)) {
      return ranked(x, c, HARD).find(m => blocks.includes(m.i))?.i ?? blocks[0];
    }
    if (!x.near.some((n, i) => n > 0 && x.b[i] === EMPTY)) return state.board.indexOf(EMPTY);
    if (level === "easy") return easyMove(x, c, r);
    if (level === "normal") return normalMove(x, c, r);
    return hardMove(x, c, r);
  }

  /* Shape names in the 4 directions through i if c played there (for tests and hints). */
  const SHAPE_NAMES = Object.freeze(["none", "one", "closed2", "two", "closed3", "three", "four", "open4", "five"]);
  function shapesAt(board, i, c) {
    if (!isIndex(i) || (c !== BLACK && c !== WHITE)) throw new Error("位置か色が正しくありません");
    return Array.from(shapes(Int8Array.from(board), i, c).subarray(0, 4), s => SHAPE_NAMES[s]);
  }

  /* What the player who just moved threatens: "open4" (two points that make five, cannot be stopped),
   * "four" (wins next move unless blocked), "three" (can make an open four). */
  function threat(state) {
    checkState(state);
    if (state.over || !state.moves.length) return null;
    const c = colorOfMove(state.moves.length - 1);
    const x = scratch(state.board);
    const fives = runGaps(x, c, 4).length;
    if (fives) return { color: c, kind: fives >= 2 ? "open4" : "four" };
    const open = runGaps(x, c, 3).some(j => shapes(x.b, j, c).subarray(0, 4).includes(OPEN4));
    return open ? { color: c, kind: "three" } : null;
  }

  return {
    SIZE, CELLS, EMPTY, BLACK, WHITE, CENTER, LEVELS, STARS,
    other, colorOfMove, rowOf, colOf, at,
    newGame, moveError, isLegal, play, fromMoves, undoTurn, resign, counts, lastMove, winLine,
    cpuMove, threat, shapesAt, SHAPE_NAMES
  };
})();

if (typeof module !== "undefined") module.exports = GomokuRules;

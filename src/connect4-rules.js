/* Connect Four (四目並べ): 7 columns x 6 rows. Discs fall to the lowest empty cell; four in a row in any
 * direction wins, a full board without four is a draw. Player 0 is red and always moves first, player 1 is yellow.
 * Also holds the CPU: よわい (easy), ふつう (normal, alpha-beta depth 4), つよい (hard, depth 7 and deeper). */
const Connect4Rules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const COLS = 7;
  const ROWS = 6;
  const SIZE = COLS * ROWS;
  const NEED = 4;
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);
  const CENTER_ORDER = Object.freeze([3, 2, 4, 1, 5, 0, 6]);
  const CENTER_WEIGHTS = Object.freeze([1, 2, 3, 4, 3, 2, 1]);
  const DC = Object.freeze([1, 0, 1, 1]);
  const DR = Object.freeze([0, 1, 1, -1]);
  const KINDS = Object.freeze(["row", "col", "diag", "anti"]); /* names for the four directions above */
  const EMPTY = -1;

  /* row 0 is the bottom row. */
  const index = (col, row) => row * COLS + col;
  const isPlayer = (p) => p === 0 || p === 1;
  const validState = (s) => !!s && Array.isArray(s.board) && s.board.length === SIZE && Array.isArray(s.heights);

  function freezeState(s) {
    return Object.freeze({
      ...s,
      board: Object.freeze(s.board), heights: Object.freeze(s.heights), moves: Object.freeze(s.moves),
      line: Object.freeze(s.line), last: s.last ? Object.freeze(s.last) : null
    });
  }

  function newGame() {
    return freezeState({
      board: Array(SIZE).fill(null), heights: Array(COLS).fill(0), turn: 0, moves: [],
      last: null, winner: null, line: [], draw: false
    });
  }

  const isOver = (s) => s.winner !== null || s.draw;
  const canDrop = (s, col) => Number.isInteger(col) && col >= 0 && col < COLS && s.heights[col] < ROWS && !isOver(s);
  const legalMoves = (s) => (isOver(s) ? [] : Array.from({ length: COLS }, (_, c) => c).filter(c => s.heights[c] < ROWS));

  function moveError(s, col) {
    if (!validState(s)) return "盤面が正しくありません";
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return "列の番号が正しくありません";
    if (isOver(s)) return "もう勝負がついています";
    if (s.heights[col] >= ROWS) return "その列はもういっぱいです";
    return null;
  }

  /* Counts same-colored discs from (col,row) in one direction, not counting the start cell. */
  function run(cells, col, row, dc, dr, p) {
    let n = 0;
    for (let k = 1; k < NEED; k++) {
      const c = col + dc * k;
      const r = row + dr * k;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS || cells[r * COLS + c] !== p) break;
      n++;
    }
    return n;
  }

  /* Would a disc of player p at (col,row) make four? */
  function connects(cells, col, row, p) {
    for (let d = 0; d < 4; d++) {
      if (1 + run(cells, col, row, DC[d], DR[d], p) + run(cells, col, row, -DC[d], -DR[d], p) >= NEED) return true;
    }
    return false;
  }

  /* Every cell of every line of four or more through (col,row), or [] when there is none. */
  function lineThrough(board, col, row) {
    const p = board[index(col, row)];
    const cells = new Set();
    for (let d = 0; d < 4; d++) {
      const fwd = run(board, col, row, DC[d], DR[d], p);
      const back = run(board, col, row, -DC[d], -DR[d], p);
      if (1 + fwd + back < NEED) continue;
      for (let k = -back; k <= fwd; k++) cells.add(index(col + DC[d] * k, row + DR[d] * k));
    }
    return [...cells].sort((a, b) => a - b);
  }

  function play(s, col) {
    const err = moveError(s, col);
    if (err) throw new Error(err);
    const row = s.heights[col];
    const at = index(col, row);
    const board = s.board.map((v, i) => (i === at ? s.turn : v));
    const heights = s.heights.map((h, c) => (c === col ? h + 1 : h));
    const line = lineThrough(board, col, row);
    const moves = [...s.moves, col];
    const winner = line.length ? s.turn : null;
    return freezeState({
      board, heights, moves, line, winner,
      turn: 1 - s.turn, last: { col, row }, draw: winner === null && moves.length === SIZE
    });
  }

  function fromMoves(moves) {
    if (!Array.isArray(moves)) throw new Error("手順が正しくありません");
    return moves.reduce((s, col) => play(s, col), newGame());
  }

  /* Takes back the last n moves. */
  function undo(s, n = 1) {
    if (!validState(s)) throw new Error("盤面が正しくありません");
    if (!Number.isInteger(n) || n < 1 || n > s.moves.length) throw new Error("もどせる手がありません");
    return fromMoves(s.moves.slice(0, -n));
  }

  /* Columns where player p would make four right now. */
  function winningMoves(s, p) {
    if (!isPlayer(p)) throw new Error("プレイヤーが正しくありません");
    return legalMoves(s).filter(c => connects(s.board, c, s.heights[c], p));
  }

  /* Which ways the winning line runs: "row" (ヨコ), "col" (タテ), "diag" (up-right) or "anti" (down-right).
   * More than one when the last disc finished two lines at once; [] when nobody has won. */
  function lineKinds(s) {
    if (!validState(s)) throw new Error("盤面が正しくありません");
    if (s.winner === null || !s.last) return [];
    const { col, row } = s.last;
    const p = s.board[index(col, row)];
    return KINDS.filter((_, d) => 1 + run(s.board, col, row, DC[d], DR[d], p) + run(s.board, col, row, -DC[d], -DR[d], p) >= NEED);
  }

  const counts = (s) => [0, 1].map(p => s.board.filter(v => v === p).length);
  const centerMost = (cols) => CENTER_ORDER.find(c => cols.includes(c));

  /* ---------- CPU search ---------- */

  /* Every line of four cells on the board, and for each cell the lines that pass through it. */
  const WINDOWS = (() => {
    const out = [];
    for (let cell = 0; cell < SIZE; cell++) {
      const col = cell % COLS;
      const row = Math.floor(cell / COLS);
      for (let d = 0; d < 4; d++) {
        const endC = col + DC[d] * (NEED - 1);
        const endR = row + DR[d] * (NEED - 1);
        if (endC >= 0 && endC < COLS && endR >= 0 && endR < ROWS) {
          out.push(Int8Array.from({ length: NEED }, (_, k) => index(col + DC[d] * k, row + DR[d] * k)));
        }
      }
    }
    return Object.freeze(out);
  })();
  const CELL_WINDOWS = Object.freeze(Array.from({ length: SIZE }, (_, cell) =>
    Int16Array.from(WINDOWS.map((w, i) => (w.includes(cell) ? i : -1)).filter(i => i >= 0))));

  /* Fixed pseudo-random keys for hashing positions (xorshift with a fixed seed, so the CPU stays repeatable). */
  const ZOBRIST = (() => {
    let x = 0x9e3779b9 | 0;
    const next = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x | 0; };
    const keys = () => Int32Array.from({ length: SIZE }, next);
    return Object.freeze([0, 1].map(() => Object.freeze([keys(), keys()])));
  })();

  const WIN_SCORE = 1000000;
  const MATE_ZONE = WIN_SCORE - 100;
  const INF = 1e9;
  const ABORT = Object.freeze({ abort: true });
  const CLOCK_EVERY = 1023; /* look at the clock once every 1024 nodes */
  const LINE_WEIGHTS = Object.freeze([0, 1, 4, 12, 0]);
  const CENTER_BONUS = 3;
  /* Threat parity (つよい only): red profits from open threes on odd rows (1st, 3rd, 5th), yellow on even rows. */
  const PARITY_BONUS = 6;
  const TABLE_BITS = 16;
  const TABLE_MASK = (1 << TABLE_BITS) - 1;
  const EXACT = 0;
  const LOWER = 1;
  const UPPER = 2;
  const ORDERS = Object.freeze(Array.from({ length: COLS }, (_, first) =>
    Object.freeze([first, ...CENTER_ORDER.filter(c => c !== first)])));

  function newTable() {
    const n = 1 << TABLE_BITS;
    return { key: new Int32Array(n), depth: new Int8Array(n), flag: new Int8Array(n), score: new Int32Array(n), move: new Int8Array(n) };
  }

  /* The search plays and takes back moves on its own scratch board (for speed), keeping the window counts,
   * the heuristic score (from red's view) and the position hash up to date. The game state is never touched. */
  function searchContext(s, opts) {
    const ctx = {
      cells: new Int8Array(SIZE).fill(EMPTY), heights: new Int8Array(COLS),
      lines: [new Int8Array(WINDOWS.length), new Int8Array(WINDOWS.length)],
      score: 0, count: 0, nodes: 0, limit: Infinity, deadline: Infinity, clock: opts.clock, parity: opts.parity, hash: 0, check: 0,
      table: opts.table ? newTable() : null
    };
    s.moves.forEach((col, i) => shift(ctx, col, i % 2, 1));
    return ctx;
  }

  function gapOf(ctx, w) {
    const cells = WINDOWS[w];
    for (let k = 0; k < NEED; k++) if (ctx.cells[cells[k]] === EMPTY) return cells[k];
    return -1;
  }
  const parityBonus = (cell, p) => ((Math.floor(cell / COLS) % 2 === 0) === (p === 0) ? PARITY_BONUS : 0);

  /* What one window adds to the score (red's view): open lines count, mixed lines are dead. */
  function windowValue(ctx, w) {
    const red = ctx.lines[0][w];
    const yellow = ctx.lines[1][w];
    if (red && yellow) return 0;
    if (red) return LINE_WEIGHTS[red] + (ctx.parity && red === 3 ? parityBonus(gapOf(ctx, w), 0) : 0);
    if (yellow) return -LINE_WEIGHTS[yellow] - (ctx.parity && yellow === 3 ? parityBonus(gapOf(ctx, w), 1) : 0);
    return 0;
  }

  /* Drops (step 1) or lifts (step -1) a disc of player p in column col on the scratch board. */
  function shift(ctx, col, p, step) {
    const row = step > 0 ? ctx.heights[col] : ctx.heights[col] - 1;
    const at = index(col, row);
    const ws = CELL_WINDOWS[at];
    const own = ctx.lines[p];
    for (let i = 0; i < ws.length; i++) ctx.score -= windowValue(ctx, ws[i]);
    ctx.cells[at] = step > 0 ? p : EMPTY;
    ctx.heights[col] += step;
    ctx.count += step;
    for (let i = 0; i < ws.length; i++) {
      own[ws[i]] += step;
      ctx.score += windowValue(ctx, ws[i]);
    }
    if (col === 3) ctx.score += (p === 0 ? CENTER_BONUS : -CENTER_BONUS) * step;
    ctx.hash ^= ZOBRIST[p][0][at];
    ctx.check ^= ZOBRIST[p][1][at];
  }

  /* Would p make four by dropping into col right now? */
  function winsAt(ctx, col, p) {
    const h = ctx.heights[col];
    if (h >= ROWS) return false;
    const ws = CELL_WINDOWS[index(col, h)];
    const own = ctx.lines[p];
    for (let i = 0; i < ws.length; i++) if (own[ws[i]] === NEED - 1) return true;
    return false;
  }

  /* The only column p must play to stop an immediate loss: -1 when there is no threat, -2 when there are two or more. */
  function forcedColumn(ctx, p) {
    let forced = -1;
    for (let c = 0; c < COLS; c++) {
      if (!winsAt(ctx, c, 1 - p)) continue;
      if (forced >= 0) return -2;
      forced = c;
    }
    return forced;
  }

  /* Win scores are stored relative to the node so they stay right at any ply. */
  const toTable = (v, ply) => (v > MATE_ZONE ? v + ply : v < -MATE_ZONE ? v - ply : v);
  const fromTable = (v, ply) => (v > MATE_ZONE ? v - ply : v < -MATE_ZONE ? v + ply : v);

  /* A stored result that settles this node, or null. */
  function tableCut(ctx, slot, depth, alpha, beta, ply) {
    const t = ctx.table;
    if (!t || t.depth[slot] - 1 < depth || t.key[slot] !== ctx.check) return null;
    const v = fromTable(t.score[slot], ply);
    const flag = t.flag[slot];
    if (flag === EXACT || (flag === LOWER && v >= beta) || (flag === UPPER && v <= alpha)) return v;
    return null;
  }
  function tableMove(ctx, slot) {
    const t = ctx.table;
    return t && t.depth[slot] && t.key[slot] === ctx.check ? t.move[slot] : -1;
  }
  function tableStore(ctx, slot, entry) {
    const t = ctx.table;
    if (!t) return;
    t.key[slot] = ctx.check;
    t.depth[slot] = entry.depth + 1;
    t.flag[slot] = entry.flag;
    t.score[slot] = toTable(entry.score, entry.ply);
    t.move[slot] = entry.move;
  }

  function negamax(ctx, p, depth, alpha, beta, ply) {
    ctx.nodes++;
    if (ctx.nodes > ctx.limit) throw ABORT;
    if ((ctx.nodes & CLOCK_EVERY) === 0 && ctx.clock() > ctx.deadline) throw ABORT;
    if (ctx.count >= SIZE) return 0;
    for (let c = 0; c < COLS; c++) if (winsAt(ctx, c, p)) return WIN_SCORE - ply;
    const forced = forcedColumn(ctx, p);
    if (forced === -2) return -(WIN_SCORE - ply - 1);
    if (depth <= 0) return p === 0 ? ctx.score : -ctx.score;
    const slot = ctx.hash & TABLE_MASK;
    const cut = tableCut(ctx, slot, depth, alpha, beta, ply);
    if (cut !== null) return cut;
    const hint = tableMove(ctx, slot);
    const order = forced >= 0 ? [forced] : hint >= 0 ? ORDERS[hint] : CENTER_ORDER;
    const nextDepth = forced >= 0 ? depth : depth - 1;
    const alpha0 = alpha;
    let best = -INF;
    let move = -1;
    for (let i = 0; i < order.length && alpha < beta; i++) {
      const c = order[i];
      if (ctx.heights[c] >= ROWS) continue;
      shift(ctx, c, p, 1);
      const score = -negamax(ctx, 1 - p, nextDepth, -beta, -alpha, ply + 1);
      shift(ctx, c, p, -1);
      if (score > best) { best = score; move = c; }
      if (best > alpha) alpha = best;
    }
    const flag = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
    tableStore(ctx, slot, { depth, flag, score: best, move, ply });
    return best;
  }

  /* Scores every root move; ties with the best are scored exactly so the CPU can vary its play.
   * An ABORT thrown from below leaves the scratch board half-played; the caller then drops the context. */
  function searchRoot(ctx, p, depth, order) {
    let alpha = -INF;
    let best = [];
    for (const c of order) {
      shift(ctx, c, p, 1);
      const score = -negamax(ctx, 1 - p, depth - 1, -INF, -(alpha - 1), 1);
      shift(ctx, c, p, -1);
      if (score > alpha) {
        alpha = score;
        best = [c];
      } else if (score === alpha) {
        best = [...best, c];
      }
    }
    return { score: alpha, best };
  }

  /* Node caps bound the think time (about 0.6 microseconds per node in Node, a few times more on a phone).
   * Up to sureDepth only the safety cap applies; deeper iterations stop at nodeCap (counted from the start of
   * the search) or once deepMs have passed, whichever comes first, so a slow phone simply reads less deep.
   * A stopped iteration is thrown away and the deepest finished one decides. */
  const NORMAL = Object.freeze({ sureDepth: 4, maxDepth: 4, safetyCap: Infinity, nodeCap: Infinity, deepMs: Infinity, parity: false, table: false });
  const HARD = Object.freeze({ sureDepth: 7, maxDepth: SIZE, safetyCap: 100000, nodeCap: 45000, deepMs: 70, parity: true, table: true });

  function searchMove(s, opts, r) {
    const started = opts.clock();
    const ctx = searchContext(s, opts);
    const p = s.turn;
    let order = CENTER_ORDER.filter(c => s.heights[c] < ROWS);
    let result = { score: 0, best: order };
    for (let depth = 1; depth <= Math.min(opts.maxDepth, SIZE - s.moves.length); depth++) {
      const deep = depth > opts.sureDepth;
      ctx.limit = deep ? opts.nodeCap : opts.safetyCap;
      ctx.deadline = deep ? started + opts.deepMs : Infinity;
      try {
        result = searchRoot(ctx, p, depth, order);
      } catch (e) {
        if (e !== ABORT) throw e;
        break;
      }
      order = [...result.best, ...order.filter(c => !result.best.includes(c))];
      if (Math.abs(result.score) > MATE_ZONE) break;
    }
    return R.pick(result.best, r);
  }

  /* よわい: random, but drawn to the center. */
  function weightedCenter(cols, r) {
    const total = cols.reduce((sum, c) => sum + CENTER_WEIGHTS[c], 0);
    let roll = r() * total;
    for (const c of cols) {
      roll -= CENTER_WEIGHTS[c];
      if (roll < 0) return c;
    }
    return cols[cols.length - 1];
  }

  /* よわい: wins at once if it can, blocks a direct threat half the time, otherwise plays loosely.
   * ふつう / つよい: win at once, else block a direct threat, else search.
   * clock (milliseconds) is read only by つよい, to stop reading past 7 moves on a slow phone. */
  function cpuMove(s, level, r = Math.random, clock = Date.now) {
    if (!LEVELS.includes(level)) throw new Error("CPUの強さが正しくありません");
    if (typeof r !== "function" || typeof clock !== "function") throw new Error("CPUの設定が正しくありません");
    if (!validState(s)) throw new Error("盤面が正しくありません");
    if (isOver(s)) throw new Error("もう勝負がついています");
    const me = s.turn;
    const wins = winningMoves(s, me);
    if (wins.length) return centerMost(wins);
    const threats = winningMoves(s, 1 - me);
    if (level === "easy") {
      if (threats.length && r() < 0.5) return centerMost(threats);
      return weightedCenter(legalMoves(s), r);
    }
    if (threats.length) return centerMost(threats);
    return searchMove(s, { ...(level === "hard" ? HARD : NORMAL), clock }, r);
  }

  return {
    COLS, ROWS, SIZE, NEED, LEVELS, index,
    newGame, play, fromMoves, undo, canDrop, legalMoves, moveError, isOver,
    winningMoves, lineKinds, counts, cpuMove
  };
})();

if (typeof module !== "undefined") module.exports = Connect4Rules;

/* Reversi rules: 8x8, black first, a move must flip at least one line; no move means pass; both stuck ends the game. */
const ReversiRules = (() => {
  const SIZE = 8;
  const CELLS = 64;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);
  const CORNERS = Object.freeze([0, 7, 56, 63]);
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const WIN = 100000;
  const SEARCH = Object.freeze({ depth: 5, endgame: 10, nodes: 12000, endNodes: 30000, ms: 80 });

  /* Corners high, X and C squares (next to empty corners) negative. */
  const WEIGHTS = Object.freeze([
    100, -20, 10, 5, 5, 10, -20, 100,
    -20, -50, -2, -2, -2, -2, -50, -20,
    10, -2, -1, -1, -1, -1, -2, 10,
    5, -2, -1, -1, -1, -1, -2, 5,
    5, -2, -1, -1, -1, -1, -2, 5,
    10, -2, -1, -1, -1, -1, -2, 10,
    -20, -50, -2, -2, -2, -2, -50, -20,
    100, -20, 10, 5, 5, 10, -20, 100
  ]);
  /* Squares whose penalty disappears once their corner is taken. */
  const CORNER_NEAR = Object.freeze([[0, [1, 8, 9]], [7, [6, 14, 15]], [56, [48, 49, 57]], [63, [54, 55, 62]]]);

  /* Flat ray tables: rays SQ_RAYS[sq]..SQ_RAYS[sq + 1] start at sq and walk outward; ray k covers RAY_SQ[RAY_BEGIN[k]..RAY_END[k]). */
  const { RAY_SQ, RAY_BEGIN, RAY_END, SQ_RAYS } = (() => {
    const squares = [];
    const begin = [];
    const end = [];
    const bySq = [];
    for (let sq = 0; sq < CELLS; sq++) {
      bySq.push(begin.length);
      for (const [dr, dc] of DIRS) {
        const ray = [];
        for (let r = Math.floor(sq / SIZE) + dr, c = (sq % SIZE) + dc; r >= 0 && r < SIZE && c >= 0 && c < SIZE; r += dr, c += dc) ray.push(r * SIZE + c);
        if (ray.length < 2) continue;
        begin.push(squares.length);
        squares.push(...ray);
        end.push(squares.length);
      }
    }
    bySq.push(begin.length);
    return { RAY_SQ: Int8Array.from(squares), RAY_BEGIN: Int16Array.from(begin), RAY_END: Int16Array.from(end), SQ_RAYS: Int16Array.from(bySq) };
  })();

  const opponent = (color) => 3 - color;
  const name = (sq) => `${"abcdefgh"[sq % SIZE]}${Math.floor(sq / SIZE) + 1}`;

  /* ---------- board helpers (work on plain arrays and typed arrays) ---------- */
  /* Index in RAY_SQ of the first own stone closing ray k, or -1 when the ray flips nothing. */
  function closer(board, k, color) {
    const opp = 3 - color;
    let p = RAY_BEGIN[k];
    if (board[RAY_SQ[p]] !== opp) return -1;
    const end = RAY_END[k];
    p++;
    while (p < end && board[RAY_SQ[p]] === opp) p++;
    return p < end && board[RAY_SQ[p]] === color ? p : -1;
  }
  function flipsAt(board, sq, color) {
    if (board[sq] !== EMPTY) return [];
    const out = [];
    for (let k = SQ_RAYS[sq]; k < SQ_RAYS[sq + 1]; k++) {
      const stop = closer(board, k, color);
      for (let p = RAY_BEGIN[k]; p < stop; p++) out.push(RAY_SQ[p]);
    }
    return out;
  }
  function canPlay(board, sq, color) {
    if (board[sq] !== EMPTY) return false;
    for (let k = SQ_RAYS[sq]; k < SQ_RAYS[sq + 1]; k++) if (closer(board, k, color) >= 0) return true;
    return false;
  }
  function movesOf(board, color) {
    const list = [];
    for (let sq = 0; sq < CELLS; sq++) if (canPlay(board, sq, color)) list.push(sq);
    return list;
  }
  function countMoves(board, color) {
    let n = 0;
    for (let sq = 0; sq < CELLS; sq++) if (canPlay(board, sq, color)) n++;
    return n;
  }
  function hasMove(board, color) {
    for (let sq = 0; sq < CELLS; sq++) if (canPlay(board, sq, color)) return true;
    return false;
  }
  function counts(board) {
    let black = 0;
    let white = 0;
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === BLACK) black++;
      else if (board[i] === WHITE) white++;
    }
    return { black, white, empty: CELLS - black - white };
  }

  /* ---------- game state ---------- */
  function checkState(s) {
    if (!s || !Array.isArray(s.board) || s.board.length !== CELLS || s.board.some(v => v !== EMPTY && v !== BLACK && v !== WHITE)) {
      throw new Error("盤面が正しくありません");
    }
    if (s.turn !== BLACK && s.turn !== WHITE) throw new Error("手番が正しくありません");
  }
  function make(board, turn, extra) {
    return Object.freeze({ board: Object.freeze(board), turn, last: null, flipped: Object.freeze([]), passed: null, over: false, ...extra });
  }

  /* d4/e5 white, d5/e4 black; black moves first. */
  function newGame() {
    const board = Array(CELLS).fill(EMPTY);
    board[27] = WHITE;
    board[36] = WHITE;
    board[28] = BLACK;
    board[35] = BLACK;
    return make(board, BLACK, {});
  }
  /* For tests and puzzles: a state from a 64-entry board and the side to move. */
  function fromBoard(board, turn) {
    const s = { board: [...board], turn };
    checkState(s);
    return make(s.board, turn, { over: !hasMove(s.board, BLACK) && !hasMove(s.board, WHITE) });
  }
  function legalMoves(state) {
    checkState(state);
    return state.over ? [] : movesOf(state.board, state.turn);
  }
  const isLegal = (state, sq) => Number.isInteger(sq) && sq >= 0 && sq < CELLS && legalMoves(state).includes(sq);
  const mustPass = (state) => !state.over && !hasMove(state.board, state.turn);

  function play(state, sq) {
    checkState(state);
    if (state.over) throw new Error("もう終わっています");
    if (!Number.isInteger(sq) || sq < 0 || sq >= CELLS) throw new Error("マスが正しくありません");
    const flipped = flipsAt(state.board, sq, state.turn);
    if (!flipped.length) throw new Error("そこには置けません");
    const hit = new Set([sq, ...flipped]);
    const board = state.board.map((v, i) => (hit.has(i) ? state.turn : v));
    const next = 3 - state.turn;
    const over = !hasMove(board, next) && !hasMove(board, state.turn);
    return make(board, next, { last: sq, flipped: Object.freeze(flipped), over });
  }
  function pass(state) {
    checkState(state);
    if (!mustPass(state)) throw new Error("置ける場所があるのでパスできません");
    return Object.freeze({ ...state, turn: 3 - state.turn, flipped: Object.freeze([]), passed: state.turn });
  }
  /* winner: BLACK, WHITE, or EMPTY for a draw (only meaningful once over). */
  function result(state) {
    const c = counts(state.board);
    const winner = c.black > c.white ? BLACK : c.white > c.black ? WHITE : EMPTY;
    return { ...c, winner, over: state.over };
  }

  /* ---------- CPU ---------- */
  function discDiff(board, me) {
    const c = counts(board);
    return me === BLACK ? c.black - c.white : c.white - c.black;
  }
  function terminal(board, me) {
    const diff = discDiff(board, me);
    return diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0;
  }
  function positional(board, me) {
    let score = 0;
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === me) score += WEIGHTS[i];
      else if (board[i] !== EMPTY) score -= WEIGHTS[i];
    }
    return score;
  }
  function pickBest(scored) {
    return scored.reduce((a, b) => (b.score > a.score ? b : a)).sq;
  }

  /* A move that ends the game with the mover ahead (largest margin first). */
  function immediateWin(state, moves) {
    const wins = moves.map(sq => ({ sq, after: play(state, sq) }))
      .filter(m => m.after.over && result(m.after).winner === state.turn)
      .map(m => ({ sq: m.sq, score: terminal(m.after.board, state.turn) }));
    return wins.length ? pickBest(wins) : null;
  }

  /* よわい: random, weighted toward moves that flip more stones. */
  function weakMove(state, moves, r) {
    const weights = moves.map(sq => flipsAt(state.board, sq, state.turn).length);
    let x = r() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < moves.length; i++) {
      x -= weights[i];
      if (x < 0) return moves[i];
    }
    return moves[moves.length - 1];
  }

  /* ふつう: weight table, looking one reply ahead. */
  function replyScore(after, me) {
    if (after.over) return terminal(after.board, me);
    if (mustPass(after)) return positional(after.board, me) + 30;
    return Math.min(...movesOf(after.board, after.turn).map(sq => {
      const next = play(after, sq);
      return next.over ? terminal(next.board, me) : positional(next.board, me);
    }));
  }
  function normalMove(state, moves, r) {
    return pickBest(moves.map(sq => ({ sq, score: replyScore(play(state, sq), state.turn) + r() * 0.9 })));
  }

  /* つよい: alpha-beta on a scratch board (make/unmake), then an exact endgame solve. */
  function searcher(board, opts) {
    const now = typeof opts.now === "function" ? opts.now : Date.now;
    const ms = Number.isFinite(opts.ms) && opts.ms > 0 ? opts.ms : SEARCH.ms;
    return {
      b: Int8Array.from(board), bufs: Array.from({ length: 72 }, () => new Int8Array(24)), hist: new Int32Array(CELLS),
      nodes: 0, limit: 0, aborted: false, now, start: now(), ms, deadline: 0
    };
  }
  function tick(s) {
    s.nodes++;
    if (s.nodes > s.limit || ((s.nodes & 511) === 0 && s.now() > s.deadline)) s.aborted = true;
    return s.aborted;
  }
  function doMove(b, sq, me, buf) {
    let n = 0;
    for (let k = SQ_RAYS[sq]; k < SQ_RAYS[sq + 1]; k++) {
      const stop = closer(b, k, me);
      for (let p = RAY_BEGIN[k]; p < stop; p++) {
        b[RAY_SQ[p]] = me;
        buf[n++] = RAY_SQ[p];
      }
    }
    b[sq] = me;
    return n;
  }
  function undoMove(b, sq, me, buf, n) {
    b[sq] = EMPTY;
    for (let j = 0; j < n; j++) b[buf[j]] = 3 - me;
  }
  function evaluate(b, me) {
    let score = positional(b, me);
    for (const [corner, near] of CORNER_NEAR) {
      if (b[corner] === EMPTY) continue;
      const sign = b[corner] === me ? 1 : -1;
      score += sign * 35;
      for (const sq of near) if (b[sq] !== EMPTY) score -= (b[sq] === me ? 1 : -1) * WEIGHTS[sq];
    }
    return score + 9 * mobility(b, me);
  }
  /* My legal move count minus the opponent's, in one pass. */
  function mobility(b, me) {
    let diff = 0;
    for (let sq = 0; sq < CELLS; sq++) {
      if (b[sq] !== EMPTY) continue;
      if (canPlay(b, sq, me)) diff++;
      if (canPlay(b, sq, 3 - me)) diff--;
    }
    return diff;
  }

  function negamax(s, me, depth, alpha, beta, ply) {
    if (tick(s)) return 0;
    const b = s.b;
    if (depth === 0) return evaluate(b, me);
    const moves = movesOf(b, me);
    if (!moves.length) {
      if (!hasMove(b, 3 - me)) return terminal(b, me);
      return -negamax(s, 3 - me, depth - 1, -beta, -alpha, ply + 1);
    }
    moves.sort((x, y) => s.hist[y] - s.hist[x] || WEIGHTS[y] - WEIGHTS[x]);
    let best = -Infinity;
    for (const sq of moves) {
      const n = doMove(b, sq, me, s.bufs[ply]);
      const v = -negamax(s, 3 - me, depth - 1, -beta, -alpha, ply + 1);
      undoMove(b, sq, me, s.bufs[ply], n);
      if (s.aborted) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        s.hist[sq] += depth * depth;
        break;
      }
    }
    return best;
  }

  /* Exact final disc difference with perfect play (fastest-first ordering while many squares are empty). */
  function solve(s, me, alpha, beta, ply, empties) {
    if (tick(s)) return 0;
    const b = s.b;
    const moves = movesOf(b, me);
    if (!moves.length) {
      if (!hasMove(b, 3 - me)) return discDiff(b, me);
      return -solve(s, 3 - me, -beta, -alpha, ply + 1, empties);
    }
    if (empties > 5 && moves.length > 1) orderFastest(s, moves, me, ply);
    let best = -Infinity;
    for (const sq of moves) {
      const n = doMove(b, sq, me, s.bufs[ply]);
      const v = -solve(s, 3 - me, -beta, -alpha, ply + 1, empties - 1);
      undoMove(b, sq, me, s.bufs[ply], n);
      if (s.aborted) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }
  function orderFastest(s, moves, me, ply) {
    const key = new Map(moves.map(sq => {
      const n = doMove(s.b, sq, me, s.bufs[ply]);
      const k = countMoves(s.b, 3 - me) * 4 - (WEIGHTS[sq] > 50 ? 8 : 0);
      undoMove(s.b, sq, me, s.bufs[ply], n);
      return [sq, k];
    }));
    moves.sort((a, b) => key.get(a) - key.get(b));
  }

  /* One root pass; returns moves best-first, or null if the budget ran out. */
  function rootPass(s, me, order, child) {
    let alpha = -Infinity;
    const out = [];
    for (const sq of order) {
      const n = doMove(s.b, sq, me, s.bufs[0]);
      const v = -child(-Infinity, -alpha);
      undoMove(s.b, sq, me, s.bufs[0], n);
      if (s.aborted) return null;
      out.push({ sq, score: v });
      if (v > alpha) alpha = v;
    }
    return out.sort((a, b) => b.score - a.score).map(m => m.sq);
  }
  function endgameMove(s, me, order, empties) {
    s.limit = SEARCH.endNodes;
    s.deadline = s.start + s.ms / 2;
    const ranked = rootPass(s, me, order, (a, b) => solve(s, 3 - me, a, b, 1, empties - 1));
    return ranked ? ranked[0] : null;
  }
  /* Leaf cost grows with the empty squares, so busy early boards get fewer nodes. */
  function deepen(s, me, order, empties) {
    let best = order[0];
    let ranked = order;
    s.limit = s.nodes + Math.round(SEARCH.nodes * Math.min(1, 30 / empties));
    s.deadline = s.start + s.ms;
    for (let depth = 1; depth <= SEARCH.depth; depth++) {
      const next = rootPass(s, me, ranked, (a, b) => negamax(s, 3 - me, depth - 1, a, b, 1));
      if (!next) break;
      ranked = next;
      best = next[0];
    }
    return best;
  }
  function strongMove(state, moves, r, opts) {
    const s = searcher(state.board, opts);
    const order = moves.map(sq => ({ sq, k: WEIGHTS[sq] + r() })).sort((a, b) => b.k - a.k).map(m => m.sq);
    const empties = counts(state.board).empty;
    if (empties <= SEARCH.endgame) {
      const exact = endgameMove(s, state.turn, order, empties);
      if (exact !== null) return exact;
      s.b = Int8Array.from(state.board);
      s.aborted = false;
    }
    return deepen(s, state.turn, order, empties);
  }

  /* Pure: the CPU's square for the side to move. opts.now / opts.ms let tests control the time guard. */
  function cpuMove(state, level = "normal", r = Math.random, opts = {}) {
    checkState(state);
    if (!LEVELS.includes(level)) throw new Error("強さが正しくありません");
    const moves = legalMoves(state);
    if (!moves.length) throw new Error("置ける場所がありません");
    if (moves.length === 1) return moves[0];
    const win = immediateWin(state, moves);
    if (win !== null) return win;
    if (level === "easy") return weakMove(state, moves, r);
    if (level === "normal") return normalMove(state, moves, r);
    return strongMove(state, moves, r, opts || {});
  }

  return {
    SIZE, CELLS, EMPTY, BLACK, WHITE, LEVELS, CORNERS, WEIGHTS,
    opponent, name, flipsAt, movesOf, counts,
    newGame, fromBoard, legalMoves, isLegal, mustPass, play, pass, result, cpuMove
  };
})();

if (typeof module !== "undefined") module.exports = ReversiRules;

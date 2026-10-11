/* Dots and Boxes (ドット&ボックス): a square of N x N boxes (N = 3, 4 or 5). Players take turns drawing one line
 * between two neighboring dots. Whoever draws the fourth side of a box claims it and must draw again.
 * When every line is drawn, more boxes wins; equal is a draw. Player 0 moves first.
 * Lines are numbered: horizontal lines row by row (r = 0..N, c = 0..N-1), then vertical ones (r = 0..N-1, c = 0..N).
 * Also holds the CPU: よわい (takes boxes half the time, else random), ふつう (always takes, avoids third sides,
 * gives away the least), つよい (chain and loop endgame solver with the all-but-two decline to keep control, and
 * box sacrifices to win the fight over who must open the first long chain). */
const DotsBoxesRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const SIZES = Object.freeze([3, 4, 5]);
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);
  const GROUND = -1;

  /* ---------- geometry (built once per size; typed arrays stay private) ---------- */
  const geoms = new Map();
  function xorshift(seed) {
    let x = seed | 0;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x | 0; };
  }
  function buildGeometry(n) {
    const hCount = (n + 1) * n;
    const lines = 2 * n * (n + 1);
    const boxes = n * n;
    const sides = new Int16Array(lines * 2);
    for (let l = 0; l < lines; l++) {
      const h = l < hCount;
      const k = h ? l : l - hCount;
      const w = h ? n : n + 1;
      const r = Math.floor(k / w);
      const c = k % w;
      sides[l * 2] = h ? (r > 0 ? (r - 1) * n + c : GROUND) : (c > 0 ? r * n + c - 1 : GROUND);
      sides[l * 2 + 1] = h ? (r < n ? r * n + c : GROUND) : (c < n ? r * n + c : GROUND);
    }
    const boxLines = new Int16Array(boxes * 4);
    for (let b = 0; b < boxes; b++) {
      const r = Math.floor(b / n);
      const c = b % n;
      const left = hCount + r * (n + 1) + c;
      boxLines.set([r * n + c, (r + 1) * n + c, left, left + 1], b * 4);
    }
    const next = xorshift(0x2545f491 + n * 7919);
    return { n, hCount, lines, boxes, sides, boxLines, z1: Int32Array.from({ length: lines }, next), z2: Int32Array.from({ length: lines }, next) };
  }
  function geometry(size) {
    if (!SIZES.includes(size)) throw new Error("盤の大きさが正しくありません");
    if (!geoms.has(size)) geoms.set(size, buildGeometry(size));
    return geoms.get(size);
  }
  const isLine = (g, line) => Number.isInteger(line) && line >= 0 && line < g.lines;
  function checkLine(g, line) {
    if (!isLine(g, line)) throw new Error("線の番号が正しくありません");
  }
  const sidesOf = (g, line) => [g.sides[line * 2], g.sides[line * 2 + 1]].filter(b => b !== GROUND);

  const lineCount = (size) => geometry(size).lines;
  const boxCount = (size) => geometry(size).boxes;
  function lineInfo(size, line) {
    const g = geometry(size);
    checkLine(g, line);
    const h = line < g.hCount;
    const k = h ? line : line - g.hCount;
    const w = h ? g.n : g.n + 1;
    return Object.freeze({ dir: h ? "h" : "v", r: Math.floor(k / w), c: k % w });
  }
  /* The two dots a line joins, in dot units (x = column, y = row). */
  function lineEnds(size, line) {
    const { dir, r, c } = lineInfo(size, line);
    return Object.freeze(dir === "h" ? { x1: c, y1: r, x2: c + 1, y2: r } : { x1: c, y1: r, x2: c, y2: r + 1 });
  }
  function boxesOfLine(size, line) {
    const g = geometry(size);
    checkLine(g, line);
    return Object.freeze(sidesOf(g, line));
  }
  /* [top, bottom, left, right] */
  function linesOfBox(size, box) {
    const g = geometry(size);
    if (!Number.isInteger(box) || box < 0 || box >= g.boxes) throw new Error("箱の番号が正しくありません");
    return Object.freeze(Array.from(g.boxLines.subarray(box * 4, box * 4 + 4)));
  }
  /* The line whose diamond-shaped touch area holds the point (x, y) in dot units, or -1. The diamonds (each line,
   * its two dots and the centers of the boxes beside it) tile the board, so every point inside picks one line. */
  function lineNear(size, x, y) {
    const n = geometry(size).n;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    const hr = Math.round(y);
    const hc = Math.floor(x);
    const vc = Math.round(x);
    const vr = Math.floor(y);
    const dh = hr >= 0 && hr <= n && hc >= 0 && hc < n ? Math.abs(x - hc - 0.5) + Math.abs(y - hr) : Infinity;
    const dv = vc >= 0 && vc <= n && vr >= 0 && vr < n ? Math.abs(x - vc) + Math.abs(y - vr - 0.5) : Infinity;
    if (Math.min(dh, dv) > 0.5 + 1e-9) return -1;
    return dh <= dv ? hr * n + hc : (n + 1) * n + vr * (n + 1) + vc;
  }

  /* ---------- game state ---------- */
  function freezeState(s) {
    return Object.freeze({
      ...s, lines: Object.freeze(s.lines), boxes: Object.freeze(s.boxes), moves: Object.freeze(s.moves),
      movers: Object.freeze(s.movers), scores: Object.freeze(s.scores), claimed: Object.freeze(s.claimed)
    });
  }
  function validState(s) {
    if (!s || typeof s !== "object" || !SIZES.includes(s.size)) return false;
    const g = geometry(s.size);
    return Array.isArray(s.lines) && s.lines.length === g.lines && Array.isArray(s.boxes) && s.boxes.length === g.boxes
      && Array.isArray(s.moves) && Array.isArray(s.movers) && Array.isArray(s.scores) && (s.turn === 0 || s.turn === 1);
  }
  function checkState(s) {
    if (!validState(s)) throw new Error("盤面が正しくありません");
  }

  function newGame(size = 4) {
    const g = geometry(size);
    return freezeState({
      size, lines: Array(g.lines).fill(null), boxes: Array(g.boxes).fill(null), turn: 0, moves: [], movers: [],
      scores: [0, 0], last: null, claimed: [], winner: null, draw: false
    });
  }
  const isOver = (s) => s.moves.length === geometry(s.size).lines;
  function drawnSides(g, lines, box) {
    let n = 0;
    for (let k = box * 4; k < box * 4 + 4; k++) if (lines[g.boxLines[k]] !== null) n++;
    return n;
  }

  function moveError(s, line) {
    if (!validState(s)) return "盤面が正しくありません";
    if (!isLine(geometry(s.size), line)) return "線の番号が正しくありません";
    if (isOver(s)) return "もう勝負がついています";
    if (s.lines[line] !== null) return "その線はもう引かれています";
    return null;
  }
  const canPlay = (s, line) => moveError(s, line) === null;

  /* Draws a line for the player to move. Boxes it finishes go to that player, who then draws again. */
  function play(s, line) {
    const err = moveError(s, line);
    if (err) throw new Error(err);
    const g = geometry(s.size);
    const p = s.turn;
    const lines = s.lines.map((v, i) => (i === line ? p : v));
    const claimed = sidesOf(g, line).filter(b => drawnSides(g, lines, b) === 4);
    const scores = s.scores.map((v, i) => (i === p ? v + claimed.length : v));
    const moves = [...s.moves, line];
    const over = moves.length === g.lines;
    const winner = over && scores[0] !== scores[1] ? (scores[0] > scores[1] ? 0 : 1) : null;
    return freezeState({
      size: s.size, lines, scores, moves, claimed, winner,
      boxes: s.boxes.map((v, b) => (claimed.includes(b) ? p : v)),
      movers: [...s.movers, p], last: line, turn: claimed.length > 0 || over ? p : 1 - p, draw: over && winner === null
    });
  }
  /* True when the last line finished a box and the same player draws again. */
  const extraTurn = (s) => s.claimed.length > 0 && !isOver(s);

  function fromMoves(size, moves) {
    if (!Array.isArray(moves)) throw new Error("手順が正しくありません");
    return moves.reduce((s, line) => play(s, line), newGame(size));
  }
  /* Takes back the last n lines. */
  function undo(s, n = 1) {
    checkState(s);
    if (!Number.isInteger(n) || n < 1 || n > s.moves.length) throw new Error("もどせる手がありません");
    return fromMoves(s.size, s.moves.slice(0, -n));
  }
  /* Goes back to just before the latest line drawn by `player` (taking back everything after it too). */
  function undoLastBy(s, player) {
    checkState(s);
    const at = s.movers.lastIndexOf(player);
    if (at < 0) throw new Error("もどせる手がありません");
    return fromMoves(s.size, s.moves.slice(0, at));
  }

  function legalMoves(s) {
    checkState(s);
    return s.lines.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0);
  }
  /* How many sides of the box are drawn (0 to 4). */
  function sides(s, box) {
    checkState(s);
    const g = geometry(s.size);
    if (!Number.isInteger(box) || box < 0 || box >= g.boxes) throw new Error("箱の番号が正しくありません");
    return drawnSides(g, s.lines, box);
  }
  /* Open lines that finish at least one box, the ones finishing two first. */
  function captureMoves(s) {
    const g = geometry(s.size);
    const gain = (l) => sidesOf(g, l).filter(b => drawnSides(g, s.lines, b) === 3).length;
    return legalMoves(s).filter(l => gain(l) > 0).sort((a, b) => gain(b) - gain(a));
  }
  /* Open lines that neither finish a box nor leave a box with three sides. */
  function safeMoves(s) {
    const g = geometry(s.size);
    return legalMoves(s).filter(l => sidesOf(g, l).every(b => drawnSides(g, s.lines, b) <= 1));
  }
  /* Would this line hand the opponent a box (a third side, finishing nothing)? */
  function givesAway(s, line) {
    if (!canPlay(s, line)) return false;
    const g = geometry(s.size);
    const counts = sidesOf(g, line).map(b => drawnSides(g, s.lines, b));
    return !counts.includes(3) && counts.includes(2);
  }

  /* ---------- CPU: scratch board ---------- */
  /* The CPU draws and erases lines on its own scratch board: deg[b] is how many sides of box b are still open and
   * loose counts boxes with exactly one open side (ready to take). The game state is never touched. */
  function scratch(s, tableBits = 0, sacrificeAt = 0) {
    const g = geometry(s.size);
    const ctx = {
      g, drawn: new Uint8Array(g.lines), deg: new Int8Array(g.boxes).fill(4), left: g.lines, loose: 0, sacrificeAt,
      h1: 0, h2: 0, nodes: 0, limit: Infinity, table: tableBits ? newTable(tableBits) : null,
      seen: new Int32Array(g.lines), stamp: 0, stack: new Int16Array(g.lines), sp: 0
    };
    s.lines.forEach((v, l) => { if (v !== null) draw(ctx, l); });
    return ctx;
  }
  function touch(ctx, b, step) {
    const was = ctx.deg[b];
    const now = was + step;
    ctx.deg[b] = now;
    ctx.loose += (now === 1 ? 1 : 0) - (was === 1 ? 1 : 0);
    return now;
  }
  function draw(ctx, l) {
    const g = ctx.g;
    ctx.drawn[l] = 1;
    ctx.left--;
    ctx.h1 ^= g.z1[l];
    ctx.h2 ^= g.z2[l];
    const a = g.sides[l * 2];
    const b = g.sides[l * 2 + 1];
    return (a >= 0 && touch(ctx, a, -1) === 0 ? 1 : 0) + (b >= 0 && touch(ctx, b, -1) === 0 ? 1 : 0);
  }
  function erase(ctx, l) {
    const g = ctx.g;
    ctx.drawn[l] = 0;
    ctx.left++;
    ctx.h1 ^= g.z1[l];
    ctx.h2 ^= g.z2[l];
    if (g.sides[l * 2] >= 0) touch(ctx, g.sides[l * 2], 1);
    if (g.sides[l * 2 + 1] >= 0) touch(ctx, g.sides[l * 2 + 1], 1);
  }
  const across = (g, l, b) => (g.sides[l * 2] === b ? g.sides[l * 2 + 1] : g.sides[l * 2]);
  function openSide(ctx, b, except) {
    for (let k = b * 4; k < b * 4 + 4; k++) {
      const l = ctx.g.boxLines[k];
      if (!ctx.drawn[l] && l !== except) return l;
    }
    return -1;
  }
  function eraseAll(ctx, lines) {
    for (let i = lines.length - 1; i >= 0; i--) erase(ctx, lines[i]);
  }

  /* A box ready to take whose last line hands nothing new to anyone: taking it is always right. */
  function freeCapture(ctx) {
    if (!ctx.loose) return -1;
    for (let b = 0; b < ctx.g.boxes; b++) {
      if (ctx.deg[b] !== 1) continue;
      const l = openSide(ctx, b, -1);
      const o = across(ctx.g, l, b);
      if (o === GROUND || ctx.deg[o] !== 2) return l;
    }
    return -1;
  }
  /* The all-but-two decline (all-but-four in a loop): draw the far side of the next box instead of taking it,
   * so the opponent gets the last boxes but must move next. Only offered at the very end of what is being eaten. */
  function declineLine(ctx, a) {
    const { g, deg } = ctx;
    const l = openSide(ctx, a, -1);
    const b = across(g, l, a);
    if (b === GROUND || deg[b] !== 2) return -1;
    const t = openSide(ctx, b, l);
    const o = across(g, t, b);
    if (ctx.loose === 1 && (o === GROUND || deg[o] >= 3)) return t;
    if (ctx.loose === 2 && o !== GROUND && deg[o] === 2) {
      const d = across(g, openSide(ctx, o, t), o);
      if (d !== GROUND && deg[d] === 1) return t;
    }
    return -1;
  }
  /* Every loose box leads into a chain or loop being eaten: take one, or decline at the very end. */
  function captureChoices(ctx) {
    const out = [];
    let first = -1;
    for (let b = 0; b < ctx.g.boxes; b++) {
      if (ctx.deg[b] !== 1) continue;
      const l = openSide(ctx, b, -1);
      if (!out.includes(l)) out.push(l);
      if (first < 0) first = b;
    }
    const t = declineLine(ctx, first);
    return t >= 0 ? [...out, t] : out;
  }
  function isSafe(ctx, l) {
    const a = ctx.g.sides[l * 2];
    const b = ctx.g.sides[l * 2 + 1];
    return (a === GROUND || ctx.deg[a] >= 3) && (b === GROUND || ctx.deg[b] >= 3);
  }
  function openLines(ctx, keep) {
    const out = [];
    for (let l = 0; l < ctx.g.lines; l++) if (!ctx.drawn[l] && keep(l)) out.push(l);
    return out;
  }
  const safeLines = (ctx) => openLines(ctx, l => isSafe(ctx, l));
  /* With nothing to take, every other open line hands the opponent at least one box. */
  const sacrificeLines = (ctx) => openLines(ctx, l => !isSafe(ctx, l));

  /* ---------- CPU: chains and loops ---------- */
  /* Follows boxes with two open sides, starting across line l0 into box `from`, and marks the lines it passes. */
  function walk(ctx, l0, from, stamp) {
    let boxes = 0;
    let line = l0;
    let b = from;
    while (b !== GROUND && ctx.deg[b] === 2) {
      boxes++;
      line = openSide(ctx, b, line);
      if (line === l0) return { boxes, end: b, last: l0, loop: true };
      ctx.seen[line] = stamp;
      b = across(ctx.g, line, b);
    }
    return { boxes, end: b, last: line, loop: false };
  }
  /* One chain or loop through line l0: its end lines, box count, and whether it runs edge to edge. */
  function trace(ctx, l0, stamp) {
    const g = ctx.g;
    ctx.seen[l0] = stamp;
    const fwd = walk(ctx, l0, g.sides[l0 * 2 + 1], stamp);
    if (fwd.loop) return { first: l0, last: l0, boxes: fwd.boxes, loop: true, simple: true };
    const back = walk(ctx, l0, g.sides[l0 * 2], stamp);
    return { first: back.last, last: fwd.last, boxes: back.boxes + fwd.boxes, loop: false, simple: back.end === GROUND && fwd.end === GROUND };
  }
  /* The openings worth trying in one chain or loop: one line of a loop, every line of a chain of one or two
   * boxes (a two-box chain can be opened in the middle), the two ends of a longer chain. */
  function openings(ctx, seg) {
    if (seg.loop || (seg.boxes >= 3 && seg.simple)) return [seg.first];
    if (seg.boxes !== 2) return [seg.first, seg.last];
    const g = ctx.g;
    const a = g.sides[seg.first * 2];
    const inner = a !== GROUND && ctx.deg[a] === 2 ? a : g.sides[seg.first * 2 + 1];
    return [seg.first, openSide(ctx, inner, seg.first), seg.last];
  }
  /* With no safe line and nothing to take, the open lines split into chains and loops (smallest first). */
  function traceAll(ctx) {
    const stamp = ++ctx.stamp;
    const list = [];
    for (let l0 = 0; l0 < ctx.g.lines; l0++) {
      if (!ctx.drawn[l0] && ctx.seen[l0] !== stamp) list.push(trace(ctx, l0, stamp));
    }
    return list.sort((a, b) => a.boxes - b.boxes);
  }
  const allOpenings = (ctx) => traceAll(ctx).flatMap(s => openings(ctx, s));
  /* `simple` means every chain runs edge to edge (no junction boxes), so the exact value has a formula;
   * otherwise `picks` lists the openings to search. */
  function segments(ctx) {
    const list = traceAll(ctx);
    if (!list.every(s => s.simple)) return { simple: false, picks: list.flatMap(s => openings(ctx, s)) };
    const sizes = (loop) => list.filter(s => s.loop === loop).map(s => s.boxes);
    return { simple: true, chains: sizes(false), loops: sizes(true) };
  }

  /* Net boxes for the player who must open next in a simple endgame (chains sorted, loops sorted). The other player
   * takes short chains; of a long chain they take all, or all but two to keep control (all but four of a loop). */
  const loonyMemo = new Map(); /* a pure cache: the same chains and loops always give the same value */
  const without = (list, i) => list.filter((_, k) => k !== i);
  function loonyValue(chains, loops) {
    if (!chains.length && !loops.length) return 0;
    const key = `${chains.join(".")}|${loops.join(".")}`;
    const known = loonyMemo.get(key);
    if (known !== undefined) return known;
    let best = -Infinity;
    chains.forEach((k, i) => {
      if (i > 0 && chains[i - 1] === k) return;
      const rest = loonyValue(without(chains, i), loops);
      best = Math.max(best, -(k <= 2 ? k + rest : Math.max(k + rest, k - 4 - rest)));
    });
    loops.forEach((k, i) => {
      if (i > 0 && loops[i - 1] === k) return;
      const rest = loonyValue(chains, without(loops, i));
      best = Math.max(best, -Math.max(k + rest, k - 8 - rest));
    });
    if (loonyMemo.size > 50000) loonyMemo.clear();
    loonyMemo.set(key, best);
    return best;
  }

  /* ---------- CPU: exact search ---------- */
  const ABORT = Object.freeze({ abort: true });
  const EXACT = 1;
  const LOWER = 2;
  const UPPER = 3;
  function newTable(bits) {
    const n = 1 << bits;
    return { mask: n - 1, key: new Int32Array(n), flag: new Int8Array(n), value: new Int8Array(n), move: new Int8Array(n) };
  }
  function probe(ctx, slot, alpha, beta) {
    const t = ctx.table;
    if (!t || !t.flag[slot] || t.key[slot] !== ctx.h2) return null;
    const v = t.value[slot];
    const f = t.flag[slot];
    return f === EXACT || (f === LOWER && v >= beta) || (f === UPPER && v <= alpha) ? v : null;
  }
  function store(ctx, slot, value, flag, move = -1) {
    const t = ctx.table;
    if (!t) return;
    t.key[slot] = ctx.h2;
    t.flag[slot] = flag;
    t.value[slot] = value;
    t.move[slot] = move;
  }
  /* The best line found here before (searched first, which makes cutoffs come sooner), or -1. */
  function hintMove(ctx, slot) {
    const t = ctx.table;
    return t && t.flag[slot] && t.key[slot] === ctx.h2 ? t.move[slot] : -1;
  }

  /* Net boxes (mover minus the other player) from here on, with best play. Free boxes are taken first. */
  function solve(ctx, alpha, beta) {
    if (++ctx.nodes > ctx.limit) throw ABORT;
    const base = ctx.sp;
    let gain = 0;
    for (let l = freeCapture(ctx); l >= 0; l = freeCapture(ctx)) {
      gain += draw(ctx, l);
      ctx.stack[ctx.sp++] = l;
    }
    const value = gain + (ctx.left > 0 ? choose(ctx, alpha - gain, beta - gain) : 0);
    while (ctx.sp > base) erase(ctx, ctx.stack[--ctx.sp]);
    return value;
  }
  /* The lines worth trying here, or the exact value of a simple endgame (then moves is null). While safe lines are
   * left only they are tried, unless at most ctx.sacrificeAt remain: then giving a box away (to win the fight over
   * who must open the first long chain) is tried too. */
  function options(ctx) {
    if (ctx.loose) return { moves: captureChoices(ctx), value: 0 };
    const safe = safeLines(ctx);
    if (safe.length) return { moves: safe.length <= ctx.sacrificeAt ? [...safe, ...sacrificeLines(ctx)] : safe, value: 0 };
    const seg = segments(ctx);
    return seg.simple ? { moves: null, value: loonyValue(seg.chains, seg.loops) } : { moves: seg.picks, value: 0 };
  }
  /* A line that finishes a box keeps the turn; any other line passes it. */
  function tryLine(ctx, m, alpha, beta) {
    const got = draw(ctx, m);
    const score = got > 0 ? got + solve(ctx, alpha - got, beta - got) : -solve(ctx, -beta, -alpha);
    erase(ctx, m);
    return score;
  }
  function choose(ctx, alpha, beta) {
    const slot = ctx.h1 & (ctx.table ? ctx.table.mask : 0);
    const hit = probe(ctx, slot, alpha, beta);
    if (hit !== null) return hit;
    const plan = options(ctx);
    if (!plan.moves) {
      store(ctx, slot, plan.value, EXACT);
      return plan.value;
    }
    const hint = hintMove(ctx, slot);
    const moves = hint >= 0 && plan.moves.includes(hint) ? [hint, ...plan.moves.filter(m => m !== hint)] : plan.moves;
    const alpha0 = alpha;
    let best = -Infinity;
    let bestMove = -1;
    for (let i = 0; i < moves.length && alpha < beta; i++) {
      const score = tryLine(ctx, moves[i], alpha, beta);
      if (score > best) {
        best = score;
        bestMove = moves[i];
      }
      alpha = Math.max(alpha, best);
    }
    store(ctx, slot, best, best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT, bestMove);
    return best;
  }
  /* The first best root line and its value, beating `start` only when strictly better (the caller shuffles the
   * lines to vary its play). */
  function searchRoot(ctx, moves, start = { move: moves[0], value: -Infinity }) {
    return moves.reduce((best, m) => {
      const value = tryLine(ctx, m, best.value, Infinity);
      return value > best.value ? { move: m, value } : best;
    }, start);
  }
  /* Runs a search within `limit` nodes in all (counted on ctx); null when it runs out. */
  function bounded(ctx, limit, run) {
    ctx.limit = limit;
    try {
      return run();
    } catch (e) {
      if (e !== ABORT) throw e;
      return null;
    }
  }

  /* ---------- CPU: levels ---------- */
  /* The node budget bounds the think time (about 1.2 microseconds per node in Node, a few times more on a phone).
   * Above safeMax safe lines the CPU plays like ふつう. With at most deepSafe safe lines, a first search (deepNodes)
   * lets both sides give boxes away once at most sacrificeAt safe lines remain; if it runs out, the plain search
   * (nobody gives a box away while a safe line is left, except the CPU right now) gets the rest of the budget. */
  const HARD = Object.freeze({
    nodes: 25000, deepNodes: 8000, deepSafe: 10, sacrificeAt: 3, tableBits: 16,
    safeMax: Object.freeze({ 3: 17, 4: 15, 5: 13 })
  });

  function anyLoose(ctx) {
    if (!ctx.loose) return -1;
    for (let b = 0; b < ctx.g.boxes; b++) if (ctx.deg[b] === 1) return openSide(ctx, b, -1);
    return -1;
  }
  /* How many boxes the next player gets by taking everything they can. */
  function greedyTake(ctx) {
    const taken = [];
    let boxes = 0;
    for (let l = anyLoose(ctx); l >= 0; l = anyLoose(ctx)) {
      boxes += draw(ctx, l);
      taken.push(l);
    }
    eraseAll(ctx, taken);
    return boxes;
  }
  /* With no safe line left: the line that hands over the fewest boxes (the smallest chain). */
  function leastGiveaway(s, r) {
    const ctx = scratch(s);
    const scored = legalMoves(s).map(l => {
      draw(ctx, l);
      const lost = greedyTake(ctx);
      erase(ctx, l);
      return { l, lost };
    });
    const min = Math.min(...scored.map(x => x.lost));
    return R.pick(scored.filter(x => x.lost === min).map(x => x.l), r);
  }
  function easyMove(s, r) {
    const takes = captureMoves(s);
    if (takes.length && r() < 0.5) return R.pick(takes, r);
    return R.pick(legalMoves(s), r);
  }
  function normalMove(s, r) {
    const takes = captureMoves(s);
    if (takes.length) return takes[0];
    const safe = safeMoves(s);
    return safe.length ? R.pick(safe, r) : leastGiveaway(s, r);
  }
  function rootMoves(ctx) {
    if (ctx.loose) return { kind: "take", moves: captureChoices(ctx) };
    const safe = safeLines(ctx);
    if (safe.length) return { kind: "safe", moves: safe };
    return { kind: "open", moves: allOpenings(ctx) };
  }
  /* Taking is listed before declining, so a tie takes: it looks natural and costs nothing. */
  const firstLines = (root, r) => (root.kind === "take" ? root.moves : R.shuffle(root.moves, r));
  /* The best first line (run inside `bounded`): a safe line, or giving a box away now when that is strictly better. */
  function searchAll(ctx, root, r) {
    const best = searchRoot(ctx, firstLines(root, r));
    return root.kind === "safe" ? searchRoot(ctx, R.shuffle(sacrificeLines(ctx), r), best) : best;
  }
  function deepSearch(s, root, r) {
    const ctx = scratch(s, HARD.tableBits, HARD.sacrificeAt);
    const found = bounded(ctx, HARD.deepNodes, () => searchAll(ctx, root, r));
    return { move: found ? found.move : -1, nodes: ctx.nodes };
  }
  /* The plain search keeps its best safe line when the give-away lines do not fit the budget. */
  function plainSearch(ctx, root, r, limit) {
    const best = bounded(ctx, limit, () => searchRoot(ctx, firstLines(root, r)));
    if (!best || root.kind !== "safe") return best ? best.move : -1;
    const better = bounded(ctx, limit, () => searchRoot(ctx, R.shuffle(sacrificeLines(ctx), r), best));
    return (better || best).move;
  }
  /* つよい: free boxes at once; otherwise search exactly (chains, loops, the all-but-two decline, and the fight over
   * who must open the first long chain, giving boxes away to win it) when it fits the node budget; else ふつう. */
  function hardMove(s, r) {
    const ctx = scratch(s, HARD.tableBits);
    const free = freeCapture(ctx);
    if (free >= 0) return free;
    const root = rootMoves(ctx);
    if (root.moves.length === 1 && root.kind !== "safe") return root.moves[0];
    const safe = safeLines(ctx).length;
    if (safe > HARD.safeMax[s.size]) return normalMove(s, r);
    const deep = root.kind !== "open" && safe <= HARD.deepSafe ? deepSearch(s, root, r) : { move: -1, nodes: 0 };
    if (deep.move >= 0) return deep.move;
    const move = plainSearch(ctx, root, r, HARD.nodes - deep.nodes);
    return move >= 0 ? move : normalMove(s, r);
  }

  function cpuMove(s, level, r = Math.random) {
    if (!LEVELS.includes(level)) throw new Error("CPUの強さが正しくありません");
    if (typeof r !== "function") throw new Error("乱数の関数が正しくありません");
    checkState(s);
    if (isOver(s)) throw new Error("もう勝負がついています");
    if (level === "easy") return easyMove(s, r);
    return level === "normal" ? normalMove(s, r) : hardMove(s, r);
  }

  return {
    SIZES, LEVELS, lineCount, boxCount, lineInfo, lineEnds, boxesOfLine, linesOfBox, lineNear,
    newGame, play, fromMoves, undo, undoLastBy, canPlay, moveError, isOver, extraTurn,
    legalMoves, captureMoves, safeMoves, givesAway, sides, cpuMove
  };
})();

if (typeof module !== "undefined") module.exports = DotsBoxesRules;

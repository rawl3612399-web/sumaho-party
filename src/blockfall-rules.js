/* Falling-block puzzle rules: seven pieces from a 7-bag, SRS rotation with wall kicks, hold, gravity,
 * lock delay with a move-reset limit, line clears, scoring, levels, rank titles and records. */
const BlockfallRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const WIDTH = 10;
  const HEIGHT = 20;
  const HIDDEN = 2;
  const ROWS = HEIGHT + HIDDEN;
  const PIECES = Object.freeze(["I", "J", "L", "O", "S", "T", "Z"]);
  const NEXT_COUNT = 3;
  const QUEUE_MIN = 7;
  const LOCK_MS = 500;
  const MAX_RESETS = 15;
  const SOFT_DROP_MS = 40;
  const SPAWN_Y = 0;
  const LINE_POINTS = Object.freeze([0, 100, 300, 500, 800]);
  const LINES_PER_LEVEL = 10;
  const MAX_LEVEL = 99;
  const START_LEVELS = Object.freeze([1, 5, 10]);
  const INTENSE_AFTER = 3;
  const MAX_SCORE = 99999999;
  const DAS_MS = 170;
  const ARR_MS = 50;
  const TAP_MS = 280;
  const TAP_PX = 12;
  const FLICK_MS = 380;
  const GRAVITY_MS = Object.freeze([1000, 850, 720, 610, 520, 440, 370, 310, 260, 215, 180, 150, 125, 105, 90, 78, 68, 60, 52, 45]);
  const RANKS = Object.freeze([
    { min: 100000, title: "伝説の積み師" },
    { min: 40000, title: "ライン消しの達人" },
    { min: 15000, title: "積みの名人" },
    { min: 5000, title: "ブロック職人" },
    { min: 1000, title: "見習い職人" },
    { min: 0, title: "はじめの一歩" }
  ].map(Object.freeze));

  /* Spawn orientation of each piece inside its box (x right, y down). The other states are rotations of the box. */
  const SHAPES = {
    I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
    O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }
  };
  const SPAWN_X = Object.freeze({ I: 3, J: 3, L: 3, O: 4, S: 3, T: 3, Z: 3 });

  const sortCells = (cells) => [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const turn = (cells, size) => cells.map(([x, y]) => [size - 1 - y, x]);
  function buildStates({ size, cells }) {
    const states = [cells];
    for (let i = 1; i < 4; i++) states.push(turn(states[i - 1], size));
    return Object.freeze(states.map(s => Object.freeze(sortCells(s).map(c => Object.freeze(c)))));
  }
  const STATES = Object.freeze(Object.fromEntries(PIECES.map(p => [p, buildStates(SHAPES[p])])));

  /* SRS kick tests as published (y up), converted to this board's y-down coordinates. Key "from>to", 0=spawn, 1=R, 2=180, 3=L. */
  const JLSTZ_UP = {
    "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };
  const I_UP = {
    "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };
  const toDown = (table) => Object.freeze(Object.fromEntries(Object.entries(table)
    .map(([k, list]) => [k, Object.freeze(list.map(([x, y]) => Object.freeze([x, 0 - y])))])));
  const KICKS = Object.freeze({ JLSTZ: toDown(JLSTZ_UP), I: toDown(I_UP) });

  /* ---------- board and pieces ---------- */
  const emptyRow = () => Array(WIDTH).fill(null);
  const emptyBoard = () => Array.from({ length: ROWS }, emptyRow);

  /* Builds a board from text rows aligned to the bottom: "." empty, any other letter a filled cell. */
  function boardFromText(lines) {
    if (!Array.isArray(lines) || lines.length > ROWS) throw new Error("盤面の行数が正しくありません");
    const rows = lines.map(line => {
      if (typeof line !== "string" || line.length !== WIDTH) throw new Error("盤面の幅が正しくありません");
      return [...line].map(ch => (ch === "." ? null : ch));
    });
    return [...Array.from({ length: ROWS - rows.length }, emptyRow), ...rows];
  }

  function cells(type, rot) {
    if (!STATES[type]) throw new Error("ブロックの種類が正しくありません");
    if (!Number.isInteger(rot) || rot < 0 || rot > 3) throw new Error("向きが正しくありません");
    return STATES[type][rot];
  }
  const cellsOf = (p) => cells(p.type, p.rot).map(([x, y]) => [p.x + x, p.y + y]);
  const blocked = (board, x, y) => x < 0 || x >= WIDTH || y < 0 || y >= ROWS || board[y][x] !== null;
  const collides = (board, piece) => cellsOf(piece).some(([x, y]) => blocked(board, x, y));

  function tryMove(board, piece, dx, dy) {
    const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
    return collides(board, moved) ? null : moved;
  }
  const onGround = (board, piece) => tryMove(board, piece, 0, 1) === null;

  /* Rotates with SRS wall kicks. dir 1 = clockwise, -1 = counter-clockwise. Returns { piece, kick } or null. */
  function tryRotate(board, piece, dir) {
    if (dir !== 1 && dir !== -1) throw new Error("回転の向きが正しくありません");
    const to = (piece.rot + dir + 4) % 4;
    if (piece.type === "O") {
      const turned = { ...piece, rot: to };
      return collides(board, turned) ? null : { piece: turned, kick: 0 };
    }
    const tests = KICKS[piece.type === "I" ? "I" : "JLSTZ"][`${piece.rot}>${to}`];
    const kick = tests.findIndex(([dx, dy]) => !collides(board, { ...piece, rot: to, x: piece.x + dx, y: piece.y + dy }));
    if (kick < 0) return null;
    const [dx, dy] = tests[kick];
    return { piece: { ...piece, rot: to, x: piece.x + dx, y: piece.y + dy }, kick };
  }

  function ghost(board, piece) {
    let p = piece;
    for (let down = tryMove(board, p, 0, 1); down; down = tryMove(board, p, 0, 1)) p = down;
    return p;
  }

  function place(board, piece) {
    const filled = cellsOf(piece);
    return board.map((row, y) => (filled.some(c => c[1] === y)
      ? row.map((v, x) => (filled.some(c => c[0] === x && c[1] === y) ? piece.type : v))
      : row));
  }

  /* Removes full rows. Returns the new board and the indexes of the rows that were cleared. */
  function clearLines(board) {
    const isFull = (row) => row.every(v => v !== null);
    const rows = board.map((row, y) => (isFull(row) ? y : -1)).filter(y => y >= 0);
    if (rows.length === 0) return { board, rows };
    const kept = board.filter(row => !isFull(row));
    return { board: [...Array.from({ length: rows.length }, emptyRow), ...kept], rows };
  }

  /* Rows from the floor up to the highest filled cell. */
  function stackHeight(board) {
    const top = board.findIndex(row => row.some(v => v !== null));
    return top < 0 ? 0 : ROWS - top;
  }

  /* ---------- randomizer, scoring, speed ---------- */
  const newBag = (r = Math.random) => R.shuffle(PIECES, r);
  function fillQueue(queue, r = Math.random) {
    let q = queue;
    while (q.length < QUEUE_MIN) q = [...q, ...newBag(r)];
    return q;
  }
  function lineScore(count, level) {
    if (!Number.isInteger(count) || count < 0 || count > 4) throw new Error("消した列の数が正しくありません");
    if (!Number.isInteger(level) || level < 1) throw new Error("レベルが正しくありません");
    return LINE_POINTS[count] * level;
  }
  const levelFor = (startLevel, lines) => Math.min(MAX_LEVEL, startLevel + Math.floor(lines / LINES_PER_LEVEL));
  const gravityMs = (level) => GRAVITY_MS[Math.min(Math.max(Math.floor(level) || 1, 1), GRAVITY_MS.length) - 1];
  const isIntense = (s) => s.level >= s.startLevel + INTENSE_AFTER;
  const rankFor = (score) => RANKS.find(r => score >= r.min).title;

  /* ---------- game state ---------- */
  const fresh = (s) => ({ ...s, events: [] });
  const playable = (s) => !s.over && s.active !== null;

  function newGame(startLevel = 1, r = Math.random) {
    if (!Number.isInteger(startLevel) || startLevel < 1 || startLevel > GRAVITY_MS.length) throw new Error("スタートレベルが正しくありません");
    return spawnNext({
      board: emptyBoard(), active: null, hold: null, canHold: true, queue: [], score: 0, lines: 0,
      level: startLevel, startLevel, pieces: 0, quads: 0, fallAcc: 0, lockTimer: 0, resets: 0, lowestY: 0,
      over: false, events: []
    }, r);
  }

  /* Puts a piece at the top. Blocked spawn = game over. Otherwise it drops one row at once so it shows on the field. */
  function enter(s, type) {
    const piece = { type, rot: 0, x: SPAWN_X[type], y: SPAWN_Y };
    if (collides(s.board, piece)) return { ...s, active: null, over: true, events: [...s.events, { kind: "over", reason: "block" }] };
    const active = tryMove(s.board, piece, 0, 1) || piece;
    return { ...s, active, fallAcc: 0, lockTimer: 0, resets: 0, lowestY: active.y, events: [...s.events, { kind: "spawn", piece: type }] };
  }
  function spawnNext(s, r) {
    const filled = fillQueue(s.queue, r);
    return enter({ ...s, queue: fillQueue(filled.slice(1), r), canHold: true }, filled[0]);
  }

  function lockPiece(s, piece, r) {
    const placed = place(s.board, piece);
    const { board, rows } = clearLines(placed);
    const count = rows.length;
    const lines = s.lines + count;
    const level = levelFor(s.startLevel, lines);
    const points = lineScore(count, s.level);
    const pieceCells = cellsOf(piece);
    const events = [
      ...s.events,
      { kind: "lock", piece: piece.type, cells: pieceCells },
      ...(count ? [{ kind: "clear", count, rows, points, colors: rows.map(y => placed[y]) }] : []),
      ...(level > s.level ? [{ kind: "level", level }] : [])
    ];
    const next = {
      ...s, board, active: null, score: Math.min(MAX_SCORE, s.score + points), lines, level,
      pieces: s.pieces + 1, quads: s.quads + (count === 4 ? 1 : 0), events
    };
    const lockOut = count === 0 && pieceCells.every(([, y]) => y < HIDDEN);
    if (lockOut) return { ...next, over: true, events: [...events, { kind: "over", reason: "lock" }] };
    return spawnNext(next, r);
  }

  /* After a successful move or rotation: on the ground the lock timer restarts, at most MAX_RESETS times per new lowest row. */
  function manipulated(s, piece, event) {
    const deeper = piece.y > s.lowestY;
    const base = { ...s, active: piece, lowestY: Math.max(s.lowestY, piece.y), resets: deeper ? 0 : s.resets, events: [...s.events, event] };
    const grounded = s.lockTimer > 0 || onGround(s.board, piece);
    if (!grounded || base.resets >= MAX_RESETS) return base;
    return { ...base, lockTimer: 0, resets: base.resets + 1 };
  }

  function move(s, dx) {
    if (dx !== -1 && dx !== 1) throw new Error("移動の向きが正しくありません");
    const base = fresh(s);
    if (!playable(s)) return base;
    const moved = tryMove(s.board, s.active, dx, 0);
    return moved ? manipulated(base, moved, { kind: "move", dx }) : base;
  }

  function rotate(s, dir) {
    if (dir !== 1 && dir !== -1) throw new Error("回転の向きが正しくありません");
    const base = fresh(s);
    if (!playable(s)) return base;
    const turned = tryRotate(s.board, s.active, dir);
    return turned ? manipulated(base, turned.piece, { kind: "rotate", dir, kick: turned.kick }) : base;
  }

  function softStep(s) {
    const base = fresh(s);
    if (!playable(s)) return base;
    const down = tryMove(s.board, s.active, 0, 1);
    if (!down) return base;
    const deeper = down.y > s.lowestY;
    return {
      ...base, active: down, fallAcc: 0, score: Math.min(MAX_SCORE, s.score + 1),
      lowestY: Math.max(s.lowestY, down.y), resets: deeper ? 0 : s.resets, events: [{ kind: "soft" }]
    };
  }

  function hardDrop(s, r = Math.random) {
    const base = fresh(s);
    if (!playable(s)) return base;
    const to = ghost(s.board, s.active);
    const dist = to.y - s.active.y;
    const dropped = { ...base, score: Math.min(MAX_SCORE, s.score + dist * 2), events: [{ kind: "hard", from: s.active, to, dist }] };
    return lockPiece(dropped, to, r);
  }

  /* Keeps the current piece. Allowed once per drop; the swapped-in piece starts again from the top. */
  function hold(s, r = Math.random) {
    const base = fresh(s);
    if (!playable(s) || !s.canHold) return base;
    const kept = { ...base, hold: s.active.type, canHold: false, events: [{ kind: "hold", piece: s.active.type }] };
    if (s.hold === null) {
      const filled = fillQueue(s.queue, r);
      return enter({ ...kept, queue: fillQueue(filled.slice(1), r) }, filled[0]);
    }
    return enter(kept, s.hold);
  }

  function fall(board, piece, acc, interval) {
    let p = piece;
    let left = acc;
    let rows = 0;
    while (left >= interval) {
      const down = tryMove(board, p, 0, 1);
      if (!down) return { piece: p, acc: 0, rows };
      p = down;
      left -= interval;
      rows += 1;
    }
    return { piece: p, acc: left, rows };
  }

  /* Advances time: gravity (faster while soft drop is held) and the lock delay. */
  function tick(s, dt, soft = false, r = Math.random) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("時間が正しくありません");
    const base = fresh(s);
    if (!playable(s)) return base;
    const interval = soft ? Math.min(gravityMs(s.level), SOFT_DROP_MS) : gravityMs(s.level);
    const f = fall(s.board, s.active, s.fallAcc + dt, interval);
    const wasGrounded = onGround(s.board, s.active);
    const deeper = f.piece.y > s.lowestY;
    const moved = {
      ...base, active: f.piece, fallAcc: f.acc, score: Math.min(MAX_SCORE, s.score + (soft ? f.rows : 0)),
      lowestY: Math.max(s.lowestY, f.piece.y), resets: deeper ? 0 : s.resets
    };
    if (!onGround(s.board, f.piece)) return { ...moved, lockTimer: 0 };
    const landed = wasGrounded ? moved : { ...moved, events: [{ kind: "land" }] };
    const lockTimer = s.lockTimer + dt;
    if (lockTimer >= LOCK_MS || landed.resets >= MAX_RESETS) return lockPiece({ ...landed, lockTimer }, f.piece, r);
    return { ...landed, lockTimer };
  }

  const ghostOf = (s) => (s.active ? ghost(s.board, s.active) : null);
  const nextPieces = (s) => s.queue.slice(0, NEXT_COUNT);

  /* ---------- input and layout helpers for the screen ---------- */
  /* Held left/right: the first step happens on press, repeats start after DAS_MS, then every ARR_MS. */
  function repeatDue(held, now) {
    if (!held || !held.dir || now - held.since < DAS_MS) return false;
    const due = held.last < held.since + DAS_MS ? held.since + DAS_MS : held.last + ARR_MS;
    return now >= due;
  }
  /* A finished touch on the field: "tap", "hard" (quick swipe down), "hold" (quick swipe up) or null. */
  function swipe({ dx, dy, dt, moved, cell }) {
    if (![dx, dy, dt, cell].every(Number.isFinite) || cell <= 0) throw new Error("タッチの値が正しくありません");
    if (!moved && dt < TAP_MS) return "tap";
    const vertical = Math.abs(dy) > Math.abs(dx) * 1.4 && Math.abs(dy) > cell * 2;
    if (!vertical || dt >= FLICK_MS) return null;
    return dy > 0 ? "hard" : "hold";
  }
  /* Columns swept by a hard drop, in visible rows: from where each column's top cell started to where it landed. */
  function trailColumns(piece, dist) {
    const all = cellsOf(piece);
    return [...new Set(all.map(c => c[0]))].sort((a, b) => a - b).map(x => {
      const y = Math.min(...all.filter(c => c[0] === x).map(c => c[1])) - HIDDEN;
      return { x, top: Math.max(0, y - dist), bottom: y };
    });
  }
  /* Cell size that fits a width x height box, and how tall the two pad rows may grow into the spare height. */
  function fitLayout(width, height, keyMin, keyMax) {
    const cell = Math.max(8, Math.floor(Math.min(width / WIDTH, height / HEIGHT)));
    const key = Math.min(keyMax, keyMin + Math.max(0, Math.floor((height - cell * HEIGHT) / 2)));
    return { cell, key };
  }

  /* ---------- settings and records ---------- */
  const cleanInt = (n, max) => (Number.isInteger(n) && n >= 0 ? Math.min(n, max) : 0);
  function normalizeSettings(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return { startLevel: START_LEVELS.includes(src.startLevel) ? src.startLevel : START_LEVELS[0] };
  }
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(START_LEVELS.map(lv => {
      const e = src[lv] && typeof src[lv] === "object" ? src[lv] : {};
      return [String(lv), { score: cleanInt(e.score, MAX_SCORE), lines: cleanInt(e.lines, MAX_SCORE), level: cleanInt(e.level, MAX_LEVEL) }];
    }));
  }
  /* New records object (the input is untouched) and whether this game beat the best score. */
  function applyRecord(records, startLevel, result) {
    if (!START_LEVELS.includes(startLevel)) throw new Error("スタートレベルが正しくありません");
    if (!result || typeof result !== "object") throw new Error("結果が正しくありません");
    const clean = normalizeRecords(records);
    const previous = clean[startLevel];
    const entry = { score: cleanInt(result.score, MAX_SCORE), lines: cleanInt(result.lines, MAX_SCORE), level: cleanInt(result.level, MAX_LEVEL) };
    const isNew = entry.score > previous.score;
    return { records: isNew ? { ...clean, [startLevel]: entry } : clean, isNew, previous };
  }
  /* One line under the result score, comparing it with the previous best for that start level. */
  function bestNote(r) {
    if (!r || typeof r !== "object") throw new Error("結果が正しくありません");
    const { score, previous, isNew } = r;
    if (![score, previous].every(n => Number.isInteger(n) && n >= 0)) throw new Error("点数が正しくありません");
    const fmt = (n) => n.toLocaleString("ja-JP");
    if (isNew) return previous ? `これまでの自己ベストは${fmt(previous)}点` : "はじめての記録！";
    if (previous === 0) return "まだ記録なし。次は1列消してみよう";
    if (score === previous) return "自己ベストと同点！";
    return `自己ベスト${fmt(previous)}点まで、あと${fmt(previous - score)}点`;
  }

  return {
    WIDTH, HEIGHT, HIDDEN, ROWS, PIECES, NEXT_COUNT, LOCK_MS, MAX_RESETS, SOFT_DROP_MS, LINE_POINTS, LINES_PER_LEVEL,
    START_LEVELS, GRAVITY_MS, RANKS, KICKS, SPAWN_X, SPAWN_Y, INTENSE_AFTER, DAS_MS, ARR_MS, TAP_MS, TAP_PX, FLICK_MS,
    emptyBoard, boardFromText, cells, cellsOf, collides, tryMove, tryRotate, onGround, ghost, place, clearLines, stackHeight,
    newBag, fillQueue, lineScore, levelFor, gravityMs, isIntense, rankFor,
    newGame, move, rotate, softStep, hardDrop, hold, tick, ghostOf, nextPieces,
    repeatDue, swipe, trailColumns, fitLayout, normalizeSettings, normalizeRecords, applyRecord, bestNote
  };
})();

if (typeof module !== "undefined") module.exports = BlockfallRules;

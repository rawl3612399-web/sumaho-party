/* Sliding puzzle rules: tiles 1..n²-1 and one gap (0) on an n×n board, solved when they read in order with the gap
 * bottom-right. A tile in the gap's row or column slides toward the gap and pushes the tiles in between; each tile
 * that moves counts as one move. Shuffles are random legal moves from the solved board, so every puzzle can be solved. */
const SlideRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const SIZES = Object.freeze([3, 4, 5]);
  const MIN_N = 2;
  const MAX_N = 8;
  const SHUFFLE_STEPS = Object.freeze({ 3: 200, 4: 600, 5: 1600 });
  const MAX_MS = 24 * 60 * 60 * 1000;
  const MAX_MOVES = 1000000;
  /* Swipe direction -> where the moving tile sits relative to the gap, as [rows, cols]. */
  const FROM = Object.freeze({ left: [0, 1], right: [0, -1], up: [1, 0], down: [-1, 0] });
  const DIRS = Object.freeze(Object.keys(FROM));

  /* ---------- board basics ---------- */
  function checkSize(n) {
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) throw new Error("盤の大きさが正しくありません");
    return n;
  }
  /* Validates a board (every number 0..n²-1 exactly once) and returns its width. */
  function sizeOf(tiles) {
    if (!Array.isArray(tiles)) throw new Error("盤の形が正しくありません");
    const n = Math.round(Math.sqrt(tiles.length));
    if (n * n !== tiles.length) throw new Error("盤の形が正しくありません");
    checkSize(n);
    const sorted = [...tiles].sort((a, b) => a - b);
    if (!sorted.every((v, i) => v === i)) throw new Error("タイルの並びが正しくありません");
    return n;
  }
  function solved(n) {
    checkSize(n);
    return Object.freeze([...Array.from({ length: n * n - 1 }, (_, i) => i + 1), 0]);
  }
  const rowOf = (i, n) => Math.floor(i / n);
  const colOf = (i, n) => i % n;
  const gapOf = (tiles) => tiles.indexOf(0);
  const atHome = (tiles, i) => tiles[i] !== 0 && tiles[i] === i + 1;

  function isSolved(tiles) {
    sizeOf(tiles);
    return tiles.every((v, i) => v === (i === tiles.length - 1 ? 0 : i + 1));
  }
  function homeCount(tiles) {
    sizeOf(tiles);
    return tiles.filter((_, i) => atHome(tiles, i)).length;
  }

  /* ---------- moves ---------- */
  /* Which way the tile at `index` would slide ("left", "right", "up", "down"), or null if it cannot move. */
  function directionOf(tiles, index) {
    const n = sizeOf(tiles);
    if (!Number.isInteger(index) || index < 0 || index >= tiles.length) return null;
    const gap = gapOf(tiles);
    if (index === gap) return null;
    if (rowOf(index, n) === rowOf(gap, n)) return index < gap ? "right" : "left";
    if (colOf(index, n) === colOf(gap, n)) return index < gap ? "down" : "up";
    return null;
  }
  const canSlide = (tiles, index) => directionOf(tiles, index) !== null;
  const legalMoves = (tiles) => tiles.map((_, i) => i).filter(i => canSlide(tiles, i));

  /* Slides the tile at `index` (and every tile between it and the gap) one step toward the gap. */
  function slide(tiles, index) {
    const dir = directionOf(tiles, index);
    if (!dir) throw new Error("そのタイルは動かせません");
    const n = Math.round(Math.sqrt(tiles.length));
    const gap = gapOf(tiles);
    const step = (dir === "left" || dir === "right" ? 1 : n) * (index < gap ? 1 : -1);
    const count = Math.abs(gap - index) / Math.abs(step);
    const shifted = new Map(Array.from({ length: count }, (_, k) => [gap - k * step, tiles[gap - (k + 1) * step]]));
    const next = tiles.map((v, i) => (i === index ? 0 : shifted.has(i) ? shifted.get(i) : v));
    return { tiles: next, count, dir };
  }

  /* The tile a swipe in `dir` would move one step (the gap's neighbour on the far side), or -1 if there is none. */
  function swipeIndex(tiles, dir) {
    if (!DIRS.includes(dir)) throw new Error("向きが正しくありません");
    const n = sizeOf(tiles);
    const gap = gapOf(tiles);
    const row = rowOf(gap, n) + FROM[dir][0];
    const col = colOf(gap, n) + FROM[dir][1];
    return row < 0 || row >= n || col < 0 || col >= n ? -1 : row * n + col;
  }

  /* ---------- shuffle and solvability ---------- */
  function neighbours(gap, n) {
    const row = rowOf(gap, n);
    const col = colOf(gap, n);
    return [[row - 1, col], [row, col - 1], [row, col + 1], [row + 1, col]]
      .filter(([r, c]) => r >= 0 && r < n && c >= 0 && c < n)
      .map(([r, c]) => r * n + c);
  }
  const swapped = (tiles, a, b) => tiles.map((v, i) => (i === a ? tiles[b] : i === b ? tiles[a] : v));

  /* Random walk of single-tile moves from the solved board (never undoing the last one). Never returns a solved board.
   * Each step moves the gap to the other square colour, so a fixed step count would only ever reach half of the
   * solvable boards; the default count gets a random extra step to reach all of them. */
  function shuffle(n, r = Math.random, steps) {
    checkSize(n);
    if (steps === undefined) return shuffle(n, r, (SHUFFLE_STEPS[n] ?? n * n * 30) + (r() < 0.5 ? 1 : 0));
    if (!Number.isInteger(steps) || steps < 1 || steps > 100000) throw new Error("シャッフルの回数が正しくありません");
    let walk = { tiles: [...solved(n)], gap: n * n - 1, prev: -1 };
    for (let k = 0; k < steps; k++) {
      const options = neighbours(walk.gap, n).filter(i => i !== walk.prev);
      const pick = R.pick(options, r) ?? options[0];
      walk = { tiles: swapped(walk.tiles, walk.gap, pick), gap: pick, prev: walk.gap };
    }
    return isSolved(walk.tiles) ? slide(walk.tiles, neighbours(walk.gap, n)[0]).tiles : walk.tiles;
  }

  function inversions(tiles) {
    const list = tiles.filter(v => v !== 0);
    return list.reduce((sum, v, i) => sum + list.slice(i + 1).filter(w => w < v).length, 0);
  }
  /* Inversion parity: odd widths need an even count; even widths add the gap's row counted from the bottom. */
  function isSolvable(tiles) {
    const n = sizeOf(tiles);
    const gapFromBottom = n - 1 - rowOf(gapOf(tiles), n);
    return (inversions(tiles) + (n % 2 === 0 ? gapFromBottom : 0)) % 2 === 0;
  }

  /* ---------- a game ---------- */
  function newGame(n, r = Math.random, steps) {
    if (!SIZES.includes(n)) throw new Error("盤の大きさが正しくありません");
    return { n, tiles: shuffle(n, r, steps), moves: 0, solved: false, last: null };
  }
  function play(game, index) {
    if (!game || game.solved) throw new Error("もうそろっています");
    const out = slide(game.tiles, index);
    return { ...game, tiles: out.tiles, moves: game.moves + out.count, solved: isSolved(out.tiles), last: { index, dir: out.dir, count: out.count } };
  }

  /* ---------- records ---------- */
  const isMs = (v) => Number.isFinite(v) && v > 0 && v <= MAX_MS;
  const isMoves = (v) => Number.isInteger(v) && v > 0 && v <= MAX_MOVES;

  /* Keeps only valid entries: { 3: { ms, moves }, 4: ..., 5: ... } with null for "no record yet".
   * Both halves are saved together on the first clear, so an entry with only one valid half is dropped. */
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(SIZES.map(n => {
      const e = src[n] && typeof src[n] === "object" ? src[n] : {};
      return [n, isMs(e.ms) && isMoves(e.moves) ? { ms: e.ms, moves: e.moves } : { ms: null, moves: null }];
    }));
  }
  /* Brings a finished game's time and move count into the recordable range (a clear in under 1 ms or after a day). */
  function clampRecord(ms, moves) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("時間が正しくありません");
    if (!Number.isInteger(moves) || moves < 1) throw new Error("手数が正しくありません");
    return { ms: Math.min(MAX_MS, Math.max(1, Math.round(ms))), moves: Math.min(MAX_MOVES, moves) };
  }
  /* Best time and fewest moves are kept separately. */
  function addRecord(records, n, ms, moves) {
    if (!SIZES.includes(n)) throw new Error("盤の大きさが正しくありません");
    if (!isMs(ms) || !isMoves(moves)) throw new Error("記録が正しくありません");
    const base = normalizeRecords(records);
    const old = base[n];
    const first = old.ms === null && old.moves === null;
    const newTime = old.ms === null || ms < old.ms;
    const newMoves = old.moves === null || moves < old.moves;
    const entry = { ms: newTime ? ms : old.ms, moves: newMoves ? moves : old.moves };
    return { records: { ...base, [n]: entry }, first, newTime, newMoves };
  }
  /* 83456 -> "1:23.4" */
  function timeText(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("時間が正しくありません");
    const tenths = Math.floor(ms / 100);
    const sec = Math.floor(tenths / 10);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}.${tenths % 10}`;
  }

  return {
    SIZES, DIRS, SHUFFLE_STEPS, MAX_MS, MAX_MOVES, sizeOf, solved, isSolved, homeCount, atHome, directionOf, canSlide,
    legalMoves, slide, swipeIndex, shuffle, inversions, isSolvable, newGame, play, normalizeRecords, clampRecord, addRecord, timeText
  };
})();

if (typeof module !== "undefined") module.exports = SlideRules;

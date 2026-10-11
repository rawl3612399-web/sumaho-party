/* Instant memory rules. 数字: a digit string flashes for a moment, then the player types it back.
 * 位置 (chimpanzee test): numbers 1..n sit on random grid cells; tapping 1 covers the rest, which must be tapped in order.
 * Each success makes the next round one longer, three misses end the game, and the score is the longest length remembered. */
const MemNumRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const MODES = Object.freeze(["digits", "chimp"]);
  const LIVES = 3;
  const START = Object.freeze({ digits: 3, chimp: 4 });
  const MAX = Object.freeze({ digits: 20, chimp: 25 });
  const COLS = 5;
  const ROWS = 6;
  const CELLS = COLS * ROWS;
  const MS_PER_DIGIT = 600;
  const MIN_SHOW_MS = 1200;
  const MAX_RUN = 2; /* the same digit at most twice in a row */
  const DIGITS = Object.freeze(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  const DELETE = "del";

  const freezeList = (list) => Object.freeze(list.map(x => Object.freeze(x)));
  /* Highest threshold first; the first entry whose min the score reaches wins. */
  const RANKS = Object.freeze({
    digits: freezeList([
      { min: 12, title: "記憶の怪物", note: "人間ばなれした記憶力です" },
      { min: 9, title: "天才級", note: "ふつうの大人の限界を軽くこえています" },
      { min: 8, title: "記憶力じまん", note: "ふつうの大人より、ひとつ上" },
      { min: 7, title: "ふつうの大人", note: "人がいちどに覚えられるのは7けた前後と言われます" },
      { min: 5, title: "小学生級", note: "あと少しで大人なみ" },
      { min: 1, title: "ひよっこ", note: "声に出さず、リズムで覚えるのがコツ" },
      { min: 0, title: "ウォーミングアップ中", note: "まずは3けたから、落ち着いていこう" }
    ]),
    chimp: freezeList([
      { min: 15, title: "チンパンジー超え", note: "写真のように場所を覚えています" },
      { min: 12, title: "天才級", note: "ここまで覚えられる人は、なかなかいません" },
      { min: 9, title: "記憶力じまん", note: "自慢していいレベルです" },
      { min: 7, title: "ふつうの大人", note: "数字を道順のようにつなげて覚えるのがコツ" },
      { min: 5, title: "チンパンジー見習い", note: "全体をパッと1枚の絵として見てみよう" },
      { min: 1, title: "ひよっこ", note: "1を押す前に、ゆっくり見ていいよ" },
      { min: 0, title: "ウォーミングアップ中", note: "まずは4個から、落ち着いていこう" }
    ])
  });

  function assertMode(mode) {
    if (!MODES.includes(mode)) throw new Error("モードが正しくありません");
  }
  function assertLength(mode, n) {
    assertMode(mode);
    if (!Number.isInteger(n) || n < 1 || n > MAX[mode]) throw new Error(`長さは1〜${MAX[mode]}です`);
  }
  function assertScore(mode, score) {
    assertMode(mode);
    if (!Number.isInteger(score) || score < 0 || score > MAX[mode]) throw new Error("記録が正しくありません");
  }

  /* ---------- 数字 ---------- */
  function showMs(len) {
    assertLength("digits", len);
    return Math.max(MIN_SHOW_MS, len * MS_PER_DIGIT);
  }

  function makeDigits(len, r = Math.random) {
    assertLength("digits", len);
    return Array.from({ length: len }).reduce((acc) => {
      const tail = acc.slice(-MAX_RUN);
      const blocked = tail.length === MAX_RUN && new Set(tail).size === 1 ? tail[0] : null;
      return acc + R.pick(DIGITS.filter(d => d !== blocked), r);
    }, "");
  }

  /* Keypad: a digit is added while there is room, DELETE removes the last one, anything else is ignored. */
  function enter(entry, key, len) {
    if (typeof entry !== "string" || !/^\d*$/.test(entry)) throw new Error("入力が正しくありません");
    assertLength("digits", len);
    if (key === DELETE) return entry.slice(0, -1);
    if (!DIGITS.includes(key) || entry.length >= len) return entry;
    return entry + key;
  }

  function checkDigits(answer, input) {
    if (typeof answer !== "string" || !/^\d+$/.test(answer)) throw new Error("答えが正しくありません");
    if (typeof input !== "string" || !/^\d*$/.test(input)) throw new Error("入力が正しくありません");
    return { ok: input === answer, marks: answer.split("").map((d, i) => input[i] === d) };
  }

  /* ---------- 位置 (chimpanzee test) ---------- */
  /* cells[i] is the grid cell of number i + 1. */
  function placeNumbers(n, r = Math.random) {
    assertLength("chimp", n);
    return R.shuffle(Array.from({ length: CELLS }, (_, i) => i), r).slice(0, n);
  }

  const isCell = (c) => Number.isInteger(c) && c >= 0 && c < CELLS;

  function newBoard(cells) {
    const valid = Array.isArray(cells) && cells.length >= 1 && cells.length <= MAX.chimp
      && cells.every(isCell) && new Set(cells).size === cells.length;
    if (!valid) throw new Error("盤面が正しくありません");
    return { cells: [...cells], next: 1, covered: false, state: "play", wrong: null };
  }

  /* 0 for an empty cell, otherwise the number on it. */
  const numberAt = (board, cell) => board.cells.indexOf(cell) + 1;

  /* result: "hit" (right number), "done" (last number), "miss" (wrong number), "none" (empty, cleared, or round over). */
  function tap(board, cell) {
    if (!isCell(cell)) throw new Error("マスが正しくありません");
    const num = numberAt(board, cell);
    if (board.state !== "play" || num === 0 || num < board.next) return { board, result: "none" };
    if (num !== board.next) return { board: { ...board, state: "miss", wrong: cell }, result: "miss" };
    const next = board.next + 1;
    const done = next > board.cells.length;
    return { board: { ...board, next, covered: true, state: done ? "done" : "play" }, result: done ? "done" : "hit" };
  }

  /* What one cell shows. reveal = the round has ended and every number is shown again.
   * state: empty | cleared | wrong | expected | answer | covered | number. */
  function cellState(board, cell, reveal = false) {
    const num = numberAt(board, cell);
    const view = (state, shown, tappable = false) => ({ state, num, shown, tappable });
    if (num === 0) return view("empty", false);
    if (num < board.next) return view("cleared", reveal);
    if (board.wrong === cell) return view("wrong", true);
    if (reveal) return view(board.state === "miss" && num === board.next ? "expected" : "answer", true);
    return board.covered ? view("covered", false, true) : view("number", true, true);
  }

  /* ---------- game ---------- */
  function makeRound(mode, level, r = Math.random) {
    assertLength(mode, level);
    return mode === "digits" ? { answer: makeDigits(level, r) } : { cells: placeNumbers(level, r) };
  }

  function newGame(mode, r = Math.random) {
    assertMode(mode);
    const level = START[mode];
    return { mode, level, lives: LIVES, best: 0, history: [], over: false, cleared: false, quit: false, round: makeRound(mode, level, r) };
  }

  /* After a round: success lengthens the next one (or clears the game at the maximum); a miss costs a life. */
  function settle(game, ok, r = Math.random) {
    if (!game || game.over) throw new Error("ゲームは終わっています");
    if (typeof ok !== "boolean") throw new Error("結果が正しくありません");
    const cleared = ok && game.level >= MAX[game.mode];
    const lives = ok ? game.lives : game.lives - 1;
    const level = ok && !cleared ? game.level + 1 : game.level;
    const over = cleared || lives <= 0;
    return {
      ...game, lives, level, over, cleared,
      best: ok ? Math.max(game.best, game.level) : game.best,
      history: [...game.history, { level: game.level, ok }],
      round: over ? null : makeRound(game.mode, level, r)
    };
  }

  function quit(game) {
    if (!game) throw new Error("ゲームがありません");
    return game.over ? game : { ...game, over: true, quit: true, round: null };
  }

  function stats(game) {
    const tries = game.history.length;
    const hits = game.history.filter(h => h.ok).length;
    return { tries, hits, misses: tries - hits, accuracy: tries ? Math.round((hits / tries) * 100) : 0 };
  }

  function rankFor(mode, score) {
    assertScore(mode, score);
    return RANKS[mode].find(x => score >= x.min);
  }

  /* ---------- records ---------- */
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const clean = (mode) => (Number.isInteger(src[mode]) && src[mode] >= 0 && src[mode] <= MAX[mode] ? src[mode] : 0);
    return Object.fromEntries(MODES.map(mode => [mode, clean(mode)]));
  }

  /* New records object (the input is untouched) and whether this score beat the best. */
  function applyRecord(records, mode, score) {
    assertScore(mode, score);
    const clean = normalizeRecords(records);
    const isNew = score > clean[mode];
    return { records: isNew ? { ...clean, [mode]: score } : clean, isNew };
  }

  return {
    MODES, LIVES, START, MAX, COLS, ROWS, CELLS, DELETE, RANKS,
    showMs, makeDigits, enter, checkDigits,
    placeNumbers, newBoard, numberAt, tap, cellState,
    makeRound, newGame, settle, quit, stats, rankFor, normalizeRecords, applyRecord
  };
})();

if (typeof module !== "undefined") module.exports = MemNumRules;

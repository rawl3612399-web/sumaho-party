/* Simon rules: the machine plays a sequence of four pads that grows by one each round; repeat it exactly.
 * Score is the number of rounds cleared. "easy" mode allows one retry per game. Randomness is injectable. */
const SimonRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const PAD_COUNT = 4;
  const PADS = Object.freeze([0, 1, 2, 3]);
  const MODES = Object.freeze(["normal", "easy"]);
  const RETRIES = Object.freeze({ normal: 0, easy: 1 });
  const MAX_ROUNDS = 99;
  const MAX_RUN = 2;

  /* Light time and gap (ms) per step. A new tier starts every 4 rounds. */
  const SPEEDS = Object.freeze([
    { from: 1, on: 560, gap: 170 },
    { from: 5, on: 450, gap: 140 },
    { from: 9, on: 370, gap: 115 },
    { from: 13, on: 300, gap: 95 },
    { from: 17, on: 250, gap: 80 },
    { from: 21, on: 210, gap: 70 }
  ].map(Object.freeze));

  /* Score (rounds cleared) to a fun memory rank. */
  const RANKS = Object.freeze([
    { min: 0, title: "金魚級", note: "まずは3ラウンドをめざそう" },
    { min: 3, title: "ニワトリ級", note: "三歩あるいても、まだ覚えてる" },
    { min: 6, title: "ネコ級", note: "気まぐれだけど、なかなかの記憶力" },
    { min: 9, title: "イヌ級", note: "ちゃんと覚えてる。えらい！" },
    { min: 12, title: "イルカ級", note: "かしこい！ 頭の回転がいい" },
    { min: 16, title: "チンパンジー級", note: "記憶テストで人間に勝つこともある実力" },
    { min: 20, title: "ゾウ級", note: "一度覚えたら忘れない" },
    { min: 26, title: "コンピューター級", note: "もう人間じゃない…！" }
  ].map(Object.freeze));

  const isPad = (p) => Number.isInteger(p) && p >= 0 && p < PAD_COUNT;
  const isScore = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_ROUNDS;

  function checkMode(mode) {
    if (!MODES.includes(mode)) throw new Error("モードが正しくありません");
  }
  function checkGame(g) {
    const ok = g && typeof g === "object" && MODES.includes(g.mode)
      && Array.isArray(g.sequence) && g.sequence.length > 0 && g.sequence.every(isPad)
      && Number.isInteger(g.pos) && g.pos >= 0 && g.pos <= g.sequence.length;
    if (!ok) throw new Error("ゲームの状態が正しくありません");
  }

  /* Next pad for the sequence. Never the same pad three times in a row. */
  function nextPad(sequence, r = Math.random) {
    if (!Array.isArray(sequence) || !sequence.every(isPad)) throw new Error("パッドの並びが正しくありません");
    const roll = r();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error("乱数が正しくありません");
    const tail = sequence.slice(-MAX_RUN);
    const run = tail.length === MAX_RUN && tail.every(p => p === tail[0]);
    const pool = run ? PADS.filter(p => p !== tail[0]) : PADS;
    return R.pick(pool, () => roll);
  }

  function newGame(mode, r = Math.random) {
    checkMode(mode);
    return {
      mode, sequence: [nextPad([], r)], pos: 0, score: 0,
      retriesLeft: RETRIES[mode], misses: 0, over: false, perfect: false
    };
  }

  const isComplete = (g) => !g.over && g.pos === g.sequence.length;
  const expected = (g) => g.sequence[g.pos];

  /* One tap. result: "ok" | "clear" | "perfect" | "retry" | "over"; expected is the pad that was wanted. */
  function press(g, pad) {
    checkGame(g);
    if (!isPad(pad)) throw new Error("パッドの番号が正しくありません");
    if (g.over) throw new Error("ゲームは終わっています");
    if (isComplete(g)) throw new Error("このラウンドはクリア済みです");
    const want = expected(g);
    if (pad === want) return pressRight(g, want);
    const misses = g.misses + 1;
    if (g.retriesLeft > 0) {
      return { game: { ...g, pos: 0, misses, retriesLeft: g.retriesLeft - 1 }, result: "retry", expected: want };
    }
    return { game: { ...g, misses, over: true }, result: "over", expected: want };
  }
  function pressRight(g, want) {
    const pos = g.pos + 1;
    if (pos < g.sequence.length) return { game: { ...g, pos }, result: "ok", expected: want };
    const score = g.sequence.length;
    const perfect = score >= MAX_ROUNDS;
    return { game: { ...g, pos, score, over: perfect, perfect }, result: perfect ? "perfect" : "clear", expected: want };
  }

  /* After a cleared round: one more pad, input starts over. */
  function extend(g, r = Math.random) {
    checkGame(g);
    if (g.over) throw new Error("ゲームは終わっています");
    if (!isComplete(g)) throw new Error("まだ入力の途中です");
    return { ...g, sequence: [...g.sequence, nextPad(g.sequence, r)], pos: 0 };
  }

  function speedFor(length) {
    if (!Number.isInteger(length) || length < 1) throw new Error("並びの長さが正しくありません");
    const index = SPEEDS.reduce((found, s, i) => (s.from <= length ? i : found), 0);
    return { level: index + 1, on: SPEEDS[index].on, gap: SPEEDS[index].gap };
  }
  const isSpeedUp = (length) => length > 1 && SPEEDS.some(s => s.from === length);

  function rankFor(score) {
    if (!isScore(score)) throw new Error("スコアが正しくありません");
    return RANKS.reduce((found, rank) => (rank.min <= score ? rank : found), RANKS[0]);
  }
  const nextRank = (score) => RANKS.find(rank => rank.min > score) || null;

  /* ---------- stored data ---------- */
  function normalizeSettings(raw) {
    return { mode: raw && MODES.includes(raw.mode) ? raw.mode : "normal" };
  }
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return Object.fromEntries(MODES.map(m => [m, isScore(src[m]) ? src[m] : 0]));
  }
  function recordAfter(records, mode, score) {
    checkMode(mode);
    if (!isScore(score)) throw new Error("スコアが正しくありません");
    const clean = normalizeRecords(records);
    const isNew = score > clean[mode];
    return { records: isNew ? { ...clean, [mode]: score } : clean, isNew };
  }

  return {
    PAD_COUNT, MODES, RETRIES, MAX_ROUNDS, SPEEDS, RANKS,
    nextPad, newGame, isComplete, expected, press, extend,
    speedFor, isSpeedUp, rankFor, nextRank,
    normalizeSettings, normalizeRecords, recordAfter
  };
})();

if (typeof module !== "undefined") module.exports = SimonRules;

/* 1〜25タッチ rules (Schulte table): the numbers 1..N are shuffled on a square grid and are tapped in order.
 * A wrong tap adds a one-second penalty. Variants: ふつう (found cells stay, dimmed), シャッフル (the numbers still
 * to find trade places after every correct tap) and 消える (found cells disappear). Also rank titles, time text
 * and personal-best records per board size and variant. */
const SchulteRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const SIZES = Object.freeze([3, 4, 5]);
  const VARIANTS = Object.freeze(["normal", "shuffle", "vanish"]);
  const VARIANT_LABELS = Object.freeze({ normal: "ふつう", shuffle: "シャッフル", vanish: "消える" });
  const DEFAULTS = Object.freeze({ size: 5, variant: "normal" });
  const PENALTY_MS = 1000;
  const MAX_RECORD_MS = 60 * 60 * 1000;
  const MAX_MISTAKES = 9999;

  /* Rank titles, fastest first. perNumberMs is the limit per number on a 5×5 ふつう board; smaller boards and
   * the other variants scale it with SIZE_FACTOR and VARIANT_FACTOR. The last rank has no limit. */
  const RANKS = Object.freeze([
    { id: "god", title: "神の目級", note: "数字のほうから目に飛びこんでくるレベル", perNumberMs: 500 },
    { id: "falcon", title: "ハヤブサ級", note: "見つけるのも押すのもトップクラス", perNumberMs: 700 },
    { id: "cheetah", title: "チーター級", note: "かなり速い。上級者の仲間入り", perNumberMs: 900 },
    { id: "cat", title: "ネコ級", note: "なかなかの反応。まだまだ伸びる", perNumberMs: 1200 },
    { id: "turtle", title: "カメ級", note: "あせらず確実に。慣れると一気に速くなる", perNumberMs: 1700 },
    { id: "sloth", title: "ナマケモノ級", note: "まずは数字の並びに目を慣らそう", perNumberMs: Infinity }
  ].map(rank => Object.freeze(rank)));
  const SIZE_FACTOR = Object.freeze({ 3: 0.6, 4: 0.8, 5: 1 });
  const VARIANT_FACTOR = Object.freeze({ normal: 1, shuffle: 1.3, vanish: 0.9 });

  function checkSize(size) {
    if (!SIZES.includes(size)) throw new Error("マスの数は3×3、4×4、5×5のどれかです");
  }
  function checkVariant(variant) {
    if (!VARIANTS.includes(variant)) throw new Error("ルールの種類が正しくありません");
  }
  function checkMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("時間が正しくありません");
  }

  /* ---------- board ---------- */
  /* The numbers 1..size² in random order, row by row. */
  function newGrid(size, r = Math.random) {
    checkSize(size);
    return R.shuffle(Array.from({ length: size * size }, (_, i) => i + 1), r);
  }

  function newGame(size, variant, r = Math.random) {
    checkVariant(variant);
    const cells = newGrid(size, r);
    return { size, variant, count: cells.length, cells, next: 1, mistakes: 0, marks: [] };
  }

  const isDone = (g, i) => g.cells[i] < g.next;
  const finished = (g) => g.next > g.count;
  const found = (g) => g.next - 1;
  const remaining = (g) => g.count - found(g);

  /* The numbers still to find trade places among their own cells; found cells keep their place and number. */
  function reshuffle(cells, next, r = Math.random) {
    const spots = cells.flatMap((n, i) => (n >= next ? [i] : []));
    const moved = R.shuffle(spots.map(i => cells[i]), r);
    const at = new Map(spots.map((spot, k) => [spot, moved[k]]));
    return cells.map((n, i) => (at.has(i) ? at.get(i) : n));
  }

  function checkTap(g, index, atMs) {
    if (!g || !Array.isArray(g.cells)) throw new Error("ゲームがはじまっていません");
    if (finished(g)) throw new Error("もう全部タッチしました");
    if (!Number.isInteger(index) || index < 0 || index >= g.count) throw new Error("マスの場所が正しくありません");
    checkMs(atMs);
  }

  /* One tap at atMs (time since the start, without penalties). Returns { game, outcome }:
   * "ok" right number, "clear" the last number, "miss" wrong number (+1 second), "done" already found (ignored). */
  function tap(g, index, atMs, r = Math.random) {
    checkTap(g, index, atMs);
    if (isDone(g, index)) return { game: g, outcome: "done" };
    if (g.cells[index] !== g.next) return { game: { ...g, mistakes: g.mistakes + 1 }, outcome: "miss" };
    const next = g.next + 1;
    const clear = next > g.count;
    const cells = g.variant === "shuffle" && !clear ? reshuffle(g.cells, next, r) : g.cells;
    return { game: { ...g, cells, next, marks: [...g.marks, Math.round(atMs)] }, outcome: clear ? "clear" : "ok" };
  }

  /* ---------- time and score ---------- */
  const penaltyMs = (g) => g.mistakes * PENALTY_MS;
  function totalMs(g, elapsedMs) {
    checkMs(elapsedMs);
    return Math.round(elapsedMs) + penaltyMs(g);
  }

  /* Time spent on each number found so far (ms). */
  const splits = (g) => g.marks.map((m, i) => m - (i > 0 ? g.marks[i - 1] : 0));

  /* The number that took longest to find: { n, ms }, or null before the first one. */
  function slowest(g) {
    const s = splits(g);
    if (s.length === 0) return null;
    const i = s.reduce((best, ms, k) => (ms > s[best] ? k : best), 0);
    return { n: i + 1, ms: s[i] };
  }

  /* Share of taps that hit the right number, 0..1. */
  function accuracy(g) {
    const taps = found(g) + g.mistakes;
    return taps === 0 ? 1 : found(g) / taps;
  }

  /* "12.34" under a minute, "1:02.34" after. Hundredths are cut, like a stopwatch. */
  function timeText(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0.00";
    const cs = Math.floor(ms / 10);
    const sec = Math.floor(cs / 100);
    const frac = String(cs % 100).padStart(2, "0");
    if (sec < 60) return `${sec}.${frac}`;
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}.${frac}`;
  }

  /* ---------- ranks ---------- */
  /* Total-time limits (ms) of every rank but the last, for this board. */
  function rankLimits(size, variant) {
    checkSize(size);
    checkVariant(variant);
    const scale = size * size * SIZE_FACTOR[size] * VARIANT_FACTOR[variant];
    return RANKS.slice(0, -1).map(rank => Math.round(rank.perNumberMs * scale));
  }
  function rankFor(ms, size, variant) {
    checkMs(ms);
    const limits = rankLimits(size, variant);
    const hit = limits.findIndex(limit => ms <= limit);
    const index = hit === -1 ? RANKS.length - 1 : hit;
    return { ...RANKS[index], index };
  }
  /* What the next rank up needs: { title, gapMs } (how many ms faster), or null at the top. */
  function nextRank(ms, size, variant) {
    const { index } = rankFor(ms, size, variant);
    if (index === 0) return null;
    return { title: RANKS[index - 1].title, gapMs: ms - rankLimits(size, variant)[index - 1] };
  }

  /* ---------- records and settings ---------- */
  const recordKey = (size, variant) => `${size}-${variant}`;
  const RECORD_KEYS = Object.freeze(SIZES.flatMap(s => VARIANTS.map(v => recordKey(s, v))));

  function validEntry(e) {
    return !!e && typeof e === "object" && Number.isInteger(e.ms) && e.ms > 0 && e.ms <= MAX_RECORD_MS
      && Number.isInteger(e.mistakes) && e.mistakes >= 0 && e.mistakes <= MAX_MISTAKES;
  }
  /* Best { ms, mistakes } per "size-variant" key; anything broken in storage is dropped. */
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(RECORD_KEYS.filter(k => validEntry(src[k]))
      .map(k => [k, { ms: src[k].ms, mistakes: src[k].mistakes }]));
  }
  const bestOf = (records, size, variant) => normalizeRecords(records)[recordKey(size, variant)] || null;

  /* New records object (the input is untouched), whether this run is a new best, and the old best. */
  function applyRecord(records, size, variant, entry) {
    checkSize(size);
    checkVariant(variant);
    if (!validEntry(entry)) throw new Error("記録が正しくありません");
    const clean = normalizeRecords(records);
    const key = recordKey(size, variant);
    const previous = clean[key] || null;
    const isNew = !previous || entry.ms < previous.ms;
    const next = isNew ? { ...clean, [key]: { ms: entry.ms, mistakes: entry.mistakes } } : clean;
    return { records: next, isNew, previous };
  }
  /* For a finished run: like applyRecord, but a run that cannot be stored (over an hour, say) is just not a record. */
  function recordRun(records, size, variant, entry) {
    if (validEntry(entry)) return applyRecord(records, size, variant, entry);
    checkSize(size);
    checkVariant(variant);
    const clean = normalizeRecords(records);
    return { records: clean, isNew: false, previous: clean[recordKey(size, variant)] || null };
  }

  function normalizeSettings(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    return {
      size: SIZES.includes(s.size) ? s.size : DEFAULTS.size,
      variant: VARIANTS.includes(s.variant) ? s.variant : DEFAULTS.variant
    };
  }

  return {
    SIZES, VARIANTS, VARIANT_LABELS, DEFAULTS, PENALTY_MS, RANKS, SIZE_FACTOR, VARIANT_FACTOR, RECORD_KEYS,
    newGrid, newGame, isDone, finished, found, remaining, reshuffle, tap,
    penaltyMs, totalMs, splits, slowest, accuracy, timeText,
    rankLimits, rankFor, nextRank,
    recordKey, normalizeRecords, bestOf, applyRecord, recordRun, normalizeSettings
  };
})();

if (typeof module !== "undefined") module.exports = SchulteRules;

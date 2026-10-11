/* Odd-color hunt rules: a square grid of one color with exactly one tile slightly lighter or darker.
 * The grid grows (2x2 up to 8x8) and the color difference shrinks as the score rises. 60-second round, a wrong tap costs 3 seconds.
 * The difference is measured perceptually (OKLab distance x100; CSS Color 4 treats 2 as "just noticeable"). */
const ColorHuntRules = (() => {
  const ROUND_MS = 60000;
  const PENALTY_MS = 3000;
  const MAX_SCORE = 9999;
  const JND = 2;
  /* Grid size by stages cleared: 2x2 once, then 3x3 ... up to 8x8 from stage 21. */
  const SIZE_STEPS = Object.freeze([
    { from: 0, size: 2 }, { from: 1, size: 3 }, { from: 3, size: 4 }, { from: 6, size: 5 },
    { from: 10, size: 6 }, { from: 15, size: 7 }, { from: 21, size: 8 }
  ].map(Object.freeze));
  /* Difference = floor + (start - floor) * e^(-score / fade): 20 at the start, about 5.3 at stage 30, never below 3.2. */
  const DELTA = Object.freeze({ start: 20, floor: 3.2, fade: 14 });
  /* Base color: picked in HSL (pleasant saturation), with its lightness solved so it looks medium-bright for every hue. */
  const BASE = Object.freeze({ sat: Object.freeze([55, 80]), look: Object.freeze([0.56, 0.74]) });
  /* Every tile stays inside this perceived-lightness band, so it shows on both the light and the dark theme. */
  const VIEW = Object.freeze({ min: 0.42, max: 0.92 });
  const HUE_GAP = 60;
  const RANKS = Object.freeze([
    { min: 0, title: "モグラ級", note: "まずは目をならそう。次はもっといける" },
    { min: 5, title: "イヌ級", note: "見分けられる色は少なめ。鼻でカバー" },
    { min: 10, title: "ヒト級", note: "ふつうの色彩感覚。ここからが勝負" },
    { min: 16, title: "タカ級", note: "するどい目。小さな違いも見のがさない" },
    { min: 22, title: "ハチドリ級", note: "人には見えない色まで見分ける鳥なみ" },
    { min: 28, title: "チョウ級", note: "色のセンサーをたくさん持つチョウなみ" },
    { min: 35, title: "シャコ級", note: "色のセンサーが12種類もある海の生き物なみ" }
  ].map(Object.freeze));

  /* ---------- input checks ---------- */
  function checkScore(score) {
    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) throw new Error("スコアが正しくありません");
  }
  function checkRandom(r) {
    if (typeof r !== "function") throw new Error("乱数の指定が正しくありません");
  }
  const unit = (r) => {
    const v = r();
    if (!Number.isFinite(v) || v < 0 || v >= 1) throw new Error("乱数は0以上1未満にしてください");
    return v;
  };

  /* ---------- color math (pure) ---------- */
  function hslToRgb({ h, s, l }) {
    const S = s / 100;
    const L = l / 100;
    const a = S * Math.min(L, 1 - L);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  /* sRGB channels 0..1 -> OKLab [L, a, b]. */
  function oklab(rgb) {
    const [r, g, b] = rgb.map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }
  const labOfHsl = (c) => oklab(hslToRgb(c));
  const labOf255 = (rgb) => oklab(rgb.map(v => v / 255));
  const gap = (p, q) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  /* Perceived difference between two 0-255 colors (OKLab distance x100). */
  const distance = (rgbA, rgbB) => gap(labOf255(rgbA), labOf255(rgbB));
  /* Perceived lightness (OKLab L, 0..1) of a 0-255 color. */
  const lightness = (rgb) => labOf255(rgb)[0];
  const to255 = (c) => hslToRgb(c).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
  const toCss = (rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

  /* Smallest x in [lo, hi] where the increasing function fn reaches target. */
  function bisect(fn, lo, hi, target) {
    let a = lo;
    let b = hi;
    for (let i = 0; i < 40; i++) {
      const mid = (a + b) / 2;
      if (fn(mid) < target) a = mid; else b = mid;
    }
    return b;
  }
  /* HSL lightness (0..100) that gives this perceived lightness for the hue and saturation. */
  const hslLightFor = (h, s, look) => bisect(l => labOfHsl({ h, s, l })[0], 0, 100, look);

  /* The odd tile: same hue and saturation, HSL lightness moved (dir +1 lighter, -1 darker) until it differs by delta.
   * Returns null when the visible band leaves too little room in that direction. */
  function shiftFor(base, dir, delta) {
    const edge = hslLightFor(base.h, base.s, dir > 0 ? VIEW.max : VIEW.min);
    const room = Math.abs(edge - base.l);
    const lab = labOfHsl(base);
    const diff = (x) => gap(lab, labOfHsl({ ...base, l: base.l + dir * x }));
    if (diff(room) < delta) return null;
    return { ...base, l: base.l + dir * bisect(diff, 0, room, delta) };
  }

  /* ---------- schedule ---------- */
  function sizeFor(score) {
    checkScore(score);
    const reached = SIZE_STEPS.filter(s => score >= s.from);
    return reached[reached.length - 1].size;
  }
  /* True when this score is the first stage on a bigger grid. */
  const sizeUp = (score) => score > 0 && sizeFor(score) > sizeFor(score - 1);
  function deltaFor(score) {
    checkScore(score);
    return DELTA.floor + (DELTA.start - DELTA.floor) * Math.exp(-score / DELTA.fade);
  }

  /* ---------- boards ---------- */
  function pickHue(prev, r) {
    const roll = unit(r);
    if (!prev) return roll * 360;
    return (prev.hue + HUE_GAP + roll * (360 - 2 * HUE_GAP)) % 360;
  }
  /* Never the same spot twice in a row on the same grid, so a lucky double tap cannot score. */
  function pickIndex(cells, prev, size, r) {
    const roll = unit(r);
    if (!prev || prev.size !== size) return Math.floor(roll * cells);
    const i = Math.floor(roll * (cells - 1));
    return i >= prev.oddIndex ? i + 1 : i;
  }
  function checkPrev(prev) {
    if (prev === null || prev === undefined) return;
    const ok = typeof prev === "object" && Number.isFinite(prev.hue) && Number.isInteger(prev.size) && Number.isInteger(prev.oddIndex);
    if (!ok) throw new Error("前の盤面が正しくありません");
  }
  /* One board for the given score. r: random source in [0, 1). prev: the previous board (optional). */
  function makeBoard(score, r = Math.random, prev = null) {
    checkScore(score);
    checkRandom(r);
    checkPrev(prev);
    const size = sizeFor(score);
    const delta = deltaFor(score);
    const h = pickHue(prev, r);
    const s = BASE.sat[0] + unit(r) * (BASE.sat[1] - BASE.sat[0]);
    const look = BASE.look[0] + unit(r) * (BASE.look[1] - BASE.look[0]);
    const base = { h, s, l: hslLightFor(h, s, look) };
    const options = [1, -1].map(dir => shiftFor(base, dir, delta)).filter(Boolean);
    if (options.length === 0) throw new Error("盤面を作れませんでした");
    const odd = options[Math.floor(unit(r) * options.length)];
    const oddIndex = pickIndex(size * size, prev, size, r);
    return { score, size, delta, hue: h, oddIndex, base: to255(base), odd: to255(odd) };
  }
  function checkIndex(board, index) {
    if (!Number.isInteger(index) || index < 0 || index >= board.size * board.size) throw new Error("マスの番号が正しくありません");
  }
  const isOdd = (board, index) => {
    checkIndex(board, index);
    return index === board.oddIndex;
  };

  /* ---------- a run ---------- */
  const newRun = () => ({ score: 0, misses: 0, streak: 0, bestStreak: 0 });
  function checkRun(run) {
    const keys = ["score", "misses", "streak", "bestStreak"];
    if (!run || keys.some(k => !Number.isInteger(run[k]) || run[k] < 0)) throw new Error("プレイの記録が正しくありません");
  }
  function hit(run) {
    checkRun(run);
    const streak = run.streak + 1;
    return { ...run, score: Math.min(MAX_SCORE, run.score + 1), streak, bestStreak: Math.max(run.bestStreak, streak) };
  }
  function miss(run) {
    checkRun(run);
    return { ...run, misses: run.misses + 1, streak: 0 };
  }
  /* Applies one tap: { run, correct }. */
  function tap(run, board, index) {
    const correct = isOdd(board, index);
    return { run: correct ? hit(run) : miss(run), correct };
  }
  /* Result numbers after the clock ran out: accuracy in %, average seconds per stage.
   * playedMs is how long the clock really ran; the screen measures it, because a miss with less than
   * 3 seconds left only takes what was left. Without it, every miss is counted as the full 3 seconds. */
  function summary(run, playedMs) {
    checkRun(run);
    const played = playedMs === undefined ? Math.max(0, ROUND_MS - PENALTY_MS * run.misses) : playedMs;
    if (!Number.isFinite(played) || played < 0 || played > ROUND_MS) throw new Error("プレイ時間が正しくありません");
    const taps = run.score + run.misses;
    return {
      score: run.score,
      misses: run.misses,
      bestStreak: run.bestStreak,
      accuracy: taps === 0 ? null : Math.round((100 * run.score) / taps),
      avgSec: run.score === 0 || played === 0 ? null : Math.round(played / run.score / 100) / 10
    };
  }

  /* ---------- ranks ---------- */
  function rankFor(score) {
    checkScore(score);
    const index = RANKS.filter(r => score >= r.min).length - 1;
    return { ...RANKS[index], index };
  }
  /* The next title up and how many more stages it needs, or null at the top. */
  function nextRank(score) {
    const next = RANKS[rankFor(score).index + 1];
    return next ? { title: next.title, need: next.min - score } : null;
  }

  /* ---------- records ---------- */
  function normalizeRecords(raw) {
    const best = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.best : 0;
    return { best: Number.isInteger(best) && best >= 0 && best <= MAX_SCORE ? best : 0 };
  }
  /* New records object (the input is untouched) and whether this score beat the best. */
  function applyRecord(records, score) {
    checkScore(score);
    const clean = normalizeRecords(records);
    const isNew = score > clean.best;
    return { records: isNew ? { best: score } : clean, isNew, previous: clean.best };
  }

  return {
    ROUND_MS, PENALTY_MS, MAX_SCORE, JND, SIZE_STEPS, DELTA, BASE, VIEW, HUE_GAP, RANKS,
    sizeFor, sizeUp, deltaFor, makeBoard, isOdd, distance, lightness, toCss,
    newRun, hit, miss, tap, summary, rankFor, nextRank, normalizeRecords, applyRecord
  };
})();

if (typeof module !== "undefined") module.exports = ColorHuntRules;

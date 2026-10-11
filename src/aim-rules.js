/* 的当てタップ rules: target placement, size and speed schedules, ring hit testing, scoring, rank titles and records.
 * Distances are CSS pixels inside the play field; times are milliseconds since the run started. */
const AimRules = (() => {
  const MODE_IDS = Object.freeze(["count30", "score30", "move"]);
  const MODES = Object.freeze({
    count30: Object.freeze({ label: "30個タイムアタック", short: "タイムアタック", kind: "count" }),
    score30: Object.freeze({ label: "30秒スコア", short: "30秒スコア", kind: "timed" }),
    move: Object.freeze({ label: "動く的", short: "動く的", kind: "timed" })
  });
  const TARGET_COUNT = 30;
  const DURATION_MS = 30000;
  /* Radius = short side of the field x ratio, kept between min and max. 30秒スコア shrinks it to shrinkTo by the end. */
  const SIZE = Object.freeze({ ratio: 0.11, min: 26, max: 46, shrinkTo: 0.5, floor: 14 });
  /* 動く的 speed in field short sides per second: start + step per hit, up to max. */
  const SPEED = Object.freeze({ start: 0.32, step: 0.035, max: 1.1 });
  const PAD = 4;
  const GAP = 12;
  const TRIES = 40;
  /* Rings by distance from the center as a share of the radius: center, middle, outer. */
  const RING_EDGES = Object.freeze([1 / 3, 2 / 3]);
  const RING_POINTS = Object.freeze([30, 20, 10]);
  const RANK_TITLES = Object.freeze(["伝説のスナイパー", "ハヤブサ級", "チーター級", "ネコ級", "ペンギン級", "カメ級"]);
  /* count30: total ms or less. score30: points or more. move: hits or more. */
  const RANK_LIMITS = Object.freeze({
    count30: Object.freeze([12000, 15000, 19000, 24000, 32000]),
    score30: Object.freeze([1300, 1000, 750, 500, 300]),
    move: Object.freeze([40, 32, 25, 18, 11])
  });
  const RECORD_MAX = Object.freeze({ count30: 3600000, score30: 100000, move: 1000 });
  const DEFAULT_MODE = "count30";

  /* ---------- validation ---------- */
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const isCount = (v) => Number.isInteger(v) && v >= 0;
  function checkMode(mode) {
    if (!MODE_IDS.includes(mode)) throw new Error("モードが正しくありません");
  }
  function checkBounds(b) {
    if (!b || !isNum(b.w) || !isNum(b.h) || b.w <= 0 || b.h <= 0) throw new Error("遊ぶ場所の大きさが正しくありません");
  }
  function checkMs(ms) {
    if (!isNum(ms) || ms < 0) throw new Error("時間が正しくありません");
  }
  function checkTarget(t) {
    if (!t || ![t.x, t.y, t.r, t.vx, t.vy].every(isNum) || t.r <= 0) throw new Error("的が正しくありません");
  }
  function checkRun(run) {
    const counts = run ? [run.hits, run.misses, run.score, run.bulls, run.streak, run.bestStreak] : [];
    if (!run || !MODE_IDS.includes(run.mode) || !counts.every(isCount) || !isNum(run.lastHitMs)) {
      throw new Error("記録中のデータが正しくありません");
    }
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const shortSide = (b) => Math.min(b.w, b.h);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lowerIsBetter = (mode) => mode === "count30";

  /* ---------- size and speed ---------- */
  function baseRadius(bounds) {
    checkBounds(bounds);
    return clamp(shortSide(bounds) * SIZE.ratio, SIZE.min, SIZE.max);
  }
  function radiusAt(mode, elapsedMs, bounds) {
    checkMode(mode);
    checkMs(elapsedMs);
    const base = baseRadius(bounds);
    if (mode !== "score30") return base;
    const p = clamp(elapsedMs / DURATION_MS, 0, 1);
    return Math.max(SIZE.floor, base * (1 - (1 - SIZE.shrinkTo) * p));
  }
  /* Pixels per second for the next moving target. */
  function speedFor(hits, bounds) {
    if (!isCount(hits)) throw new Error("当てた数が正しくありません");
    checkBounds(bounds);
    return shortSide(bounds) * Math.min(SPEED.max, SPEED.start + SPEED.step * hits);
  }

  /* ---------- placement and motion ---------- */
  function area(bounds, radius) {
    const a = { minX: radius + PAD, maxX: bounds.w - radius - PAD, minY: radius + PAD, maxY: bounds.h - radius - PAD };
    if (a.maxX < a.minX || a.maxY < a.minY) throw new Error("的を置く場所がせますぎます");
    return a;
  }
  /* A center fully inside the field that does not overlap `prev` ({x, y, r}). If the field is too small for that,
   * the corner farthest from `prev` is used. */
  function place(bounds, radius, prev = null, r = Math.random) {
    checkBounds(bounds);
    if (!isNum(radius) || radius <= 0) throw new Error("的の大きさが正しくありません");
    if (prev !== null && (!prev || ![prev.x, prev.y, prev.r].every(isNum))) throw new Error("前の的が正しくありません");
    const a = area(bounds, radius);
    const need = prev ? prev.r + radius + GAP : 0;
    for (let i = 0; i < TRIES; i++) {
      const p = { x: a.minX + r() * (a.maxX - a.minX), y: a.minY + r() * (a.maxY - a.minY) };
      if (!prev || dist(p, prev) >= need) return p;
    }
    const corners = [[a.minX, a.minY], [a.maxX, a.minY], [a.minX, a.maxY], [a.maxX, a.maxY]].map(([x, y]) => ({ x, y }));
    return corners.reduce((best, c) => (dist(c, prev) > dist(best, prev) ? c : best));
  }
  /* New target { x, y, r, vx, vy } for the current point of the run. Only 動く的 gets a velocity (px per second). */
  function spawn({ mode, hits, elapsedMs, bounds, prev = null }, r = Math.random) {
    const radius = radiusAt(mode, elapsedMs, bounds);
    const p = place(bounds, radius, prev, r);
    if (mode !== "move") return { x: p.x, y: p.y, r: radius, vx: 0, vy: 0 };
    const speed = speedFor(hits, bounds);
    const angle = r() * Math.PI * 2;
    return { x: p.x, y: p.y, r: radius, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }
  /* One axis: reflect off the walls at lo and hi. */
  function bounce(pos, vel, lo, hi) {
    if (hi <= lo) return { pos: (lo + hi) / 2, vel };
    if (pos < lo) return { pos: clamp(2 * lo - pos, lo, hi), vel: Math.abs(vel) };
    if (pos > hi) return { pos: clamp(2 * hi - pos, lo, hi), vel: -Math.abs(vel) };
    return { pos, vel };
  }
  function drift(target, dtMs, bounds) {
    checkTarget(target);
    checkMs(dtMs);
    checkBounds(bounds);
    const lo = target.r + PAD;
    const sx = bounce(target.x + (target.vx * dtMs) / 1000, target.vx, lo, bounds.w - target.r - PAD);
    const sy = bounce(target.y + (target.vy * dtMs) / 1000, target.vy, lo, bounds.h - target.r - PAD);
    return { ...target, x: sx.pos, y: sy.pos, vx: sx.vel, vy: sy.vel };
  }
  /* Moves a target back inside a field that got smaller. */
  const clampInto = (target, bounds) => drift(target, 0, bounds);

  /* ---------- hit testing ---------- */
  /* `slop` widens the hit circle a little for fingers; taps in that margin count as the outer ring. */
  function hitTest(target, x, y, slop = 0) {
    checkTarget(target);
    if (!isNum(x) || !isNum(y) || !isNum(slop) || slop < 0) throw new Error("タップの位置が正しくありません");
    const d = Math.hypot(x - target.x, y - target.y);
    if (d > target.r + slop) return { hit: false, ring: null, dist: d, points: 0 };
    const share = d / target.r;
    const ring = share <= RING_EDGES[0] ? 0 : share <= RING_EDGES[1] ? 1 : 2;
    return { hit: true, ring, dist: d, points: RING_POINTS[ring] };
  }

  /* ---------- run ---------- */
  function newRun(mode) {
    checkMode(mode);
    return { mode, hits: 0, misses: 0, score: 0, bulls: 0, streak: 0, bestStreak: 0, lastHitMs: 0 };
  }
  function isOver(run, elapsedMs) {
    checkRun(run);
    checkMs(elapsedMs);
    return MODES[run.mode].kind === "count" ? run.hits >= TARGET_COUNT : elapsedMs >= DURATION_MS;
  }
  /* Targets left (タイムアタック) or ms left (timed modes). */
  function remaining(run, elapsedMs) {
    checkRun(run);
    checkMs(elapsedMs);
    return MODES[run.mode].kind === "count" ? Math.max(0, TARGET_COUNT - run.hits) : Math.max(0, DURATION_MS - elapsedMs);
  }
  function hit(run, ring, elapsedMs) {
    if (![0, 1, 2].includes(ring)) throw new Error("的の輪が正しくありません");
    if (isOver(run, elapsedMs)) throw new Error("もう終わっています");
    const streak = run.streak + 1;
    return {
      ...run, hits: run.hits + 1, score: run.score + RING_POINTS[ring], bulls: run.bulls + (ring === 0 ? 1 : 0),
      streak, bestStreak: Math.max(run.bestStreak, streak), lastHitMs: Math.round(elapsedMs)
    };
  }
  function miss(run) {
    checkRun(run);
    return { ...run, misses: run.misses + 1, streak: 0 };
  }
  /* Percent of taps that hit, or null before the first tap. */
  function accuracy(run) {
    checkRun(run);
    const taps = run.hits + run.misses;
    return taps === 0 ? null : Math.round((run.hits / taps) * 100);
  }
  const VALUE_OF = { count30: (run) => run.lastHitMs, score30: (run) => run.score, move: (run) => run.hits };
  function summary(run, elapsedMs) {
    if (!isOver(run, elapsedMs)) throw new Error("まだ終わっていません");
    const value = VALUE_OF[run.mode](run);
    return {
      mode: run.mode, value, hits: run.hits, misses: run.misses, bulls: run.bulls, bestStreak: run.bestStreak,
      accuracy: accuracy(run), avgMs: run.hits ? Math.round(run.lastHitMs / run.hits) : null, rank: rankFor(run.mode, value)
    };
  }

  /* ---------- ranks and display ---------- */
  function checkValue(mode, value) {
    checkMode(mode);
    if (!isCount(value)) throw new Error("記録が正しくありません");
  }
  /* level 0 is the best title. `next` is the title one step up and how far away it is (same unit as value). */
  function rankFor(mode, value) {
    checkValue(mode, value);
    const limits = RANK_LIMITS[mode];
    const found = limits.findIndex(l => (lowerIsBetter(mode) ? value <= l : value >= l));
    const level = found === -1 ? limits.length : found;
    const next = level === 0 ? null : { title: RANK_TITLES[level - 1], gap: Math.abs(value - limits[level - 1]) };
    return { level, title: RANK_TITLES[level], next };
  }
  function valueParts(mode, value) {
    checkValue(mode, value);
    if (mode === "count30") return { num: (value / 1000).toFixed(2), unit: "秒" };
    return { num: String(value), unit: mode === "score30" ? "点" : "個" };
  }
  const formatValue = (mode, value) => {
    const p = valueParts(mode, value);
    return p.num + p.unit;
  };

  /* ---------- records and settings ---------- */
  const validRecord = (mode, v) => Number.isInteger(v) && v > 0 && v <= RECORD_MAX[mode];
  /* Best per mode from storage: { count30: ms | null, score30: points | null, move: hits | null }. */
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(MODE_IDS.map(m => [m, validRecord(m, src[m]) ? src[m] : null]));
  }
  function isBetter(mode, value, best) {
    checkValue(mode, value);
    if (best === null || best === undefined) return true;
    return lowerIsBetter(mode) ? value < best : value > best;
  }
  /* Zero (nothing hit) and out-of-range values are never saved. */
  function applyRecord(records, mode, value) {
    checkValue(mode, value);
    const base = normalizeRecords(records);
    const previous = base[mode];
    if (!validRecord(mode, value) || !isBetter(mode, value, previous)) return { records: base, isNew: false, previous };
    return { records: { ...base, [mode]: value }, isNew: true, previous };
  }
  function normalizeSettings(raw) {
    const mode = raw && typeof raw === "object" && MODE_IDS.includes(raw.mode) ? raw.mode : DEFAULT_MODE;
    return { mode };
  }

  return {
    MODE_IDS, MODES, TARGET_COUNT, DURATION_MS, SIZE, SPEED, PAD, GAP, RING_EDGES, RING_POINTS, RANK_TITLES, RANK_LIMITS, RECORD_MAX,
    baseRadius, radiusAt, speedFor, place, spawn, drift, clampInto, hitTest,
    newRun, isOver, remaining, hit, miss, accuracy, summary,
    rankFor, valueParts, formatValue, normalizeRecords, isBetter, applyRecord, normalizeSettings
  };
})();

if (typeof module !== "undefined") module.exports = AimRules;

/* Whack-a-mole rules: a time-based spawn schedule on a 3x3 field, scoring with combos, rank titles and records. */
const MoleRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const HOLES = 9;
  const TIMES = Object.freeze([30, 60]);
  const KINDS = Object.freeze(["normal", "gold", "bomb"]);
  const POINTS = Object.freeze({ normal: 1, gold: 5, bomb: -3 });

  /* Timing (milliseconds of game time). */
  const FIRST_SPAWN_MS = 400;
  const END_QUIET_MS = 350;        // no new moles this close to the end
  const COOLDOWN_MS = 220;         // a hole stays empty for a moment after a mole leaves
  const HIT_LINGER_MS = 380;       // a bonked mole stays (dizzy) this long before it is gone
  const GRACE_MS = 70;             // a tap just after a mole starts ducking still counts
  const RETRY_MS = 90;             // no free hole: try again soon
  const MAX_SPAWNS_PER_STEP = 3;
  const COMBO_WINDOW_MS = 1500;
  const COMBO_STEP = 5;
  const COMBO_BONUS_MAX = 10;

  /* Difficulty curve endpoints (p = 0 at the start, 1 at the end). */
  const INTERVAL = Object.freeze({ start: 900, end: 380 });
  const UP_TIME = Object.freeze({ start: 1150, end: 600 });
  const UP_SCALE = Object.freeze({ normal: 1, gold: 0.58, bomb: 1.15 });
  const GOLD_CHANCE = 0.08;
  const BOMB_FROM = 0.08;
  const BOMB_CHANCE = Object.freeze({ start: 0.12, end: 0.22 });

  /* Rank titles; thresholds are points per 30 seconds. */
  const RANKS = Object.freeze([
    { min: 85, title: "伝説のハンマー" },
    { min: 65, title: "もぐら名人" },
    { min: 45, title: "たたきの達人" },
    { min: 28, title: "なかなかの腕前" },
    { min: 12, title: "見習いハンマー" },
    { min: 0, title: "もぐらの友だち" }
  ]);
  const MAX_SCORE = 99999;
  const MAX_COUNT = 9999;

  /* ---------- curve ---------- */
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const lerp = (a, b, p) => a + (b - a) * clamp01(p);
  const spawnInterval = (p) => Math.round(lerp(INTERVAL.start, INTERVAL.end, p));
  function upTime(kind, p) {
    if (!KINDS.includes(kind)) throw new Error("もぐらの種類が正しくありません");
    return Math.round(lerp(UP_TIME.start, UP_TIME.end, p) * UP_SCALE[kind]);
  }
  const maxUp = (p) => (p < 0.15 ? 1 : p < 0.55 ? 2 : 3);
  function kindChances(p) {
    const bomb = p < BOMB_FROM ? 0 : lerp(BOMB_CHANCE.start, BOMB_CHANCE.end, p);
    return { gold: GOLD_CHANCE, bomb, normal: 1 - GOLD_CHANCE - bomb };
  }
  function pickKind(p, r = Math.random) {
    const c = kindChances(p);
    const x = r();
    if (x < c.gold) return "gold";
    if (x < c.gold + c.bomb) return "bomb";
    return "normal";
  }
  const comboBonus = (combo) =>
    (Number.isInteger(combo) && combo > 0 && combo % COMBO_STEP === 0 ? Math.min(COMBO_BONUS_MAX, (combo / COMBO_STEP) * 2) : 0);

  /* ---------- state ---------- */
  function newGame(seconds) {
    if (!TIMES.includes(seconds)) throw new Error("時間は30秒か60秒にしてください");
    return {
      seconds, durationMs: seconds * 1000, holes: Array(HOLES).fill(null), nextSpawnAt: FIRST_SPAWN_MS, nextId: 1,
      score: 0, hits: 0, misses: 0, bombs: 0, escaped: 0, golds: 0, combo: 0, maxCombo: 0, lastHitAt: null
    };
  }
  function assertGame(s) {
    if (!s || typeof s !== "object" || !Array.isArray(s.holes) || s.holes.length !== HOLES || !TIMES.includes(s.seconds)) {
      throw new Error("ゲームの状態が正しくありません");
    }
  }
  function assertTime(now) {
    if (!Number.isFinite(now) || now < 0) throw new Error("時間が正しくありません");
  }
  const progressAt = (s, now) => clamp01(now / s.durationMs);
  const timeLeft = (s, now) => Math.max(0, s.durationMs - now);
  const isOver = (s, now) => now >= s.durationMs;
  /* The combo that is still alive at `now`: 0 once the chain window since the last hit has passed. */
  const comboAt = (s, now) => (s.combo > 0 && s.lastHitAt !== null && now - s.lastHitAt <= COMBO_WINDOW_MS ? s.combo : 0);

  /* ---------- holes ---------- */
  const finishedAt = (e) => (e.hitAt !== null ? e.hitAt + HIT_LINGER_MS : e.downAt);
  const isFree = (e, now) => e === null || finishedAt(e) + COOLDOWN_MS <= now;
  const isActive = (e, now) => e !== null && e.hitAt === null && now < e.downAt;
  const freeHoles = (s, now) => s.holes.map((e, i) => (isFree(e, now) ? i : -1)).filter(i => i >= 0);
  const activeCount = (s, now) => s.holes.filter(e => isActive(e, now)).length;

  /* What a hole shows right now: "empty", "up", "hit" or "down" (ducking or gone). */
  function holeView(s, i, now) {
    const e = s.holes[i];
    if (!e) return { phase: "empty", kind: null, id: null };
    const phase = e.hitAt !== null
      ? (now < e.hitAt + HIT_LINGER_MS ? "hit" : "down")
      : (e.upAt <= now && now < e.downAt ? "up" : "down");
    return { phase, kind: e.kind, id: e.id };
  }

  /* ---------- time steps ---------- */
  function collectEscapes(s, now) {
    const due = (e) => e !== null && e.hitAt === null && !e.gone && now >= e.downAt + GRACE_MS;
    const events = s.holes.flatMap((e, i) => (due(e) ? [{ type: "escape", hole: i, kind: e.kind, id: e.id }] : []));
    if (events.length === 0) return { state: s, events };
    const holes = s.holes.map(e => (due(e) ? { ...e, gone: true } : e));
    const escaped = s.escaped + events.filter(ev => ev.kind !== "bomb").length;
    return { state: { ...s, holes, escaped }, events };
  }
  function spawnOnce(s, now, r) {
    const p = progressAt(s, now);
    const free = freeHoles(s, now);
    if (free.length === 0 || activeCount(s, now) >= maxUp(p)) {
      return { state: { ...s, nextSpawnAt: now + RETRY_MS }, event: null };
    }
    const hole = R.pick(free, r);
    const kind = pickKind(p, r);
    const entry = { id: s.nextId, kind, upAt: now, downAt: now + upTime(kind, p), hitAt: null, gone: false };
    const gap = spawnInterval(p) * (0.75 + 0.5 * r());
    const nextSpawnAt = Math.round(Math.max(s.nextSpawnAt + gap, now + gap * 0.5));
    const holes = s.holes.map((e, i) => (i === hole ? entry : e));
    return { state: { ...s, holes, nextSpawnAt, nextId: s.nextId + 1 }, event: { type: "spawn", hole, kind, id: entry.id } };
  }
  /* Advances the field to game time `now`: moles that were not hit escape, new moles pop up on schedule. */
  function step(s, now, r = Math.random) {
    assertGame(s);
    assertTime(now);
    const t = Math.min(now, s.durationMs);
    const escaped = collectEscapes(s, t);
    let state = escaped.state;
    let events = escaped.events;
    for (let n = 0; n < MAX_SPAWNS_PER_STEP && state.nextSpawnAt <= t && t < s.durationMs - END_QUIET_MS; n++) {
      const out = spawnOnce(state, t, r);
      state = out.state;
      if (out.event) events = [...events, out.event];
    }
    return { state, events };
  }

  /* ---------- taps ---------- */
  function hitMole(s, hole, e, now) {
    const holes = s.holes.map((h, i) => (i === hole ? { ...e, hitAt: now, gone: true } : h));
    if (e.kind === "bomb") {
      const score = Math.max(0, s.score + POINTS.bomb);
      return {
        state: { ...s, holes, score, bombs: s.bombs + 1, combo: 0, lastHitAt: null },
        result: { type: "bomb", kind: "bomb", points: score - s.score, base: POINTS.bomb, bonus: 0, combo: 0 }
      };
    }
    const combo = comboAt(s, now) + 1;
    const bonus = comboBonus(combo);
    const points = POINTS[e.kind] + bonus;
    return {
      state: {
        ...s, holes, score: Math.min(MAX_SCORE, s.score + points), hits: s.hits + 1,
        golds: s.golds + (e.kind === "gold" ? 1 : 0), combo, maxCombo: Math.max(s.maxCombo, combo), lastHitAt: now
      },
      result: { type: "hit", kind: e.kind, points, base: POINTS[e.kind], bonus, combo }
    };
  }
  /* A tap on hole `hole` at game time `now`. Result type: "hit", "bomb", "miss" or "none" (ignored). */
  function whack(s, hole, now) {
    assertGame(s);
    assertTime(now);
    if (!Number.isInteger(hole) || hole < 0 || hole >= HOLES) throw new Error("穴の番号が正しくありません");
    const none = { state: s, result: { type: "none" } };
    if (isOver(s, now)) return none;
    const e = s.holes[hole];
    if (e && e.hitAt !== null && now < e.hitAt + HIT_LINGER_MS) return none;
    if (e && e.hitAt === null && e.upAt <= now && now < e.downAt + GRACE_MS) return hitMole(s, hole, e, now);
    return {
      state: { ...s, misses: s.misses + 1, combo: 0, lastHitAt: null },
      result: { type: "miss", combo: 0, points: 0 }
    };
  }

  /* ---------- results ---------- */
  function summary(s) {
    assertGame(s);
    const taps = s.hits + s.misses + s.bombs;
    return {
      seconds: s.seconds, score: s.score, hits: s.hits, misses: s.misses, bombs: s.bombs, escaped: s.escaped,
      golds: s.golds, taps, accuracy: taps ? Math.round((s.hits * 100) / taps) : 0, maxCombo: s.maxCombo
    };
  }
  const per30 = (score, seconds) => (score * 30) / seconds;
  function rankIndex(score, seconds) {
    if (!Number.isFinite(score) || !TIMES.includes(seconds)) throw new Error("スコアが正しくありません");
    const v = per30(score, seconds);
    return RANKS.findIndex(rank => v >= rank.min);
  }
  const rankFor = (score, seconds) => RANKS[Math.max(0, rankIndex(score, seconds))];
  /* The next title up and how many more points it needs, or null at the top. */
  function nextRank(score, seconds) {
    const i = Math.max(0, rankIndex(score, seconds));
    if (i === 0) return null;
    const goal = RANKS[i - 1];
    return { title: goal.title, need: Math.ceil((goal.min * seconds) / 30) - score };
  }

  /* ---------- records and settings ---------- */
  const isCount = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
  function validRecord(rec) {
    return Boolean(rec) && typeof rec === "object" && isCount(rec.score, MAX_SCORE) && rec.score > 0 &&
      isCount(rec.maxCombo, MAX_COUNT) && isCount(rec.accuracy, 100);
  }
  /* Best run per round length from storage: { 30: {score, maxCombo, accuracy} | null, 60: ... }. */
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(TIMES.map(t => [t, validRecord(src[t])
      ? { score: src[t].score, maxCombo: src[t].maxCombo, accuracy: src[t].accuracy } : null]));
  }
  /* New records object (the input is untouched) and whether this run beat the best. */
  function applyRecord(records, seconds, sum) {
    if (!TIMES.includes(seconds) || !sum || !isCount(sum.score, MAX_SCORE)) throw new Error("記録が正しくありません");
    const clean = normalizeRecords(records);
    const previous = clean[seconds];
    const isNew = sum.score > 0 && (!previous || sum.score > previous.score);
    const rec = { score: sum.score, maxCombo: Math.min(sum.maxCombo, MAX_COUNT), accuracy: sum.accuracy };
    return { records: isNew ? { ...clean, [seconds]: rec } : clean, isNew, previous };
  }
  function normalizeSettings(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return { seconds: TIMES.includes(src.seconds) ? src.seconds : TIMES[0] };
  }

  return {
    HOLES, TIMES, KINDS, POINTS, RANKS, COMBO_WINDOW_MS, COMBO_STEP, HIT_LINGER_MS, GRACE_MS, COOLDOWN_MS, END_QUIET_MS,
    spawnInterval, upTime, maxUp, kindChances, pickKind, comboBonus,
    newGame, step, whack, holeView, freeHoles, activeCount, progressAt, timeLeft, isOver, comboAt,
    summary, rankFor, nextRank, normalizeRecords, applyRecord, normalizeSettings
  };
})();

if (typeof module !== "undefined") module.exports = MoleRules;

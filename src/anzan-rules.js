/* Flash mental arithmetic rules: numbers flash one at a time and the player answers their total.
 * Pure functions: number generation, flash timing, the 級/段 ladder, rank notes and personal records. */
const AnzanRules = (() => {
  const DIGITS = Object.freeze([1, 2, 3]);
  const COUNTS = Object.freeze([3, 5, 10, 15]);
  const SPEED_IDS = Object.freeze(["slow", "normal", "fast"]);
  const SPEEDS = Object.freeze({
    slow: Object.freeze({ label: "ゆっくり", ms: 1200 }),
    normal: Object.freeze({ label: "ふつう", ms: 800 }),
    fast: Object.freeze({ label: "はやい", ms: 450 })
  });
  const MODES = Object.freeze(["free", "dan"]);
  const DEFAULTS = Object.freeze({ mode: "free", digits: 1, count: 5, speed: "normal" });
  const LIMITS = Object.freeze({ minCount: 2, maxCount: 30, minMs: 200, maxMs: 3000, maxRecord: 9999 });
  /* Blank between numbers, so the same digits twice in a row would still look like two numbers. */
  const GAP = Object.freeze({ ratio: 0.22, min: 70, max: 200 });

  const step = (title, digits, count, ms) => Object.freeze({ title, digits, count, ms });
  /* 段位チャレンジ: each correct answer moves one step down this list. Never gets easier. */
  const LADDER = Object.freeze([
    step("10級", 1, 3, 1000), step("9級", 1, 4, 900), step("8級", 1, 5, 800), step("7級", 1, 5, 650),
    step("6級", 1, 7, 600), step("5級", 1, 10, 550), step("4級", 2, 3, 900), step("3級", 2, 4, 800),
    step("2級", 2, 5, 700), step("1級", 2, 5, 600), step("初段", 2, 7, 600), step("二段", 2, 10, 550),
    step("三段", 2, 10, 450), step("四段", 2, 15, 400), step("五段", 3, 3, 800), step("六段", 3, 5, 700),
    step("七段", 3, 5, 550), step("八段", 3, 7, 500), step("九段", 3, 10, 400), step("十段", 3, 15, 300)
  ]);
  /* A short comment for how far the ladder was climbed (number of steps cleared). Highest first. */
  const NOTES = Object.freeze([
    Object.freeze({ min: 20, text: "伝説の暗算王" }),
    Object.freeze({ min: 16, text: "暗算の達人" }),
    Object.freeze({ min: 11, text: "有段者の仲間入り" }),
    Object.freeze({ min: 7, text: "なかなかの暗算力" }),
    Object.freeze({ min: 1, text: "そろばん教室デビュー" }),
    Object.freeze({ min: 0, text: "まずは10級をめざそう" })
  ]);
  /* Titles for a run of correct answers in a row (自由に mode). Highest first. */
  const STREAK_TITLES = Object.freeze([
    Object.freeze({ min: 10, text: "暗算マシーン！" }),
    Object.freeze({ min: 5, text: "ノッてきた！" }),
    Object.freeze({ min: 3, text: "いい調子！" }),
    Object.freeze({ min: 0, text: "正解！" })
  ]);

  const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

  function checkDigits(digits) {
    if (!DIGITS.includes(digits)) throw new Error("けた数は1〜3です");
  }
  function checkCount(count) {
    if (!isInt(count, LIMITS.minCount, LIMITS.maxCount)) throw new Error(`口数は${LIMITS.minCount}〜${LIMITS.maxCount}です`);
  }
  function checkMs(ms) {
    if (!isInt(ms, LIMITS.minMs, LIMITS.maxMs)) throw new Error("表示スピードが正しくありません");
  }

  /* Uniform integer in [min, max] from the random source r (returns [0, 1)). */
  function int(min, max, r) {
    const v = r();
    if (typeof v !== "number" || !(v >= 0 && v < 1)) throw new Error("乱数が正しくありません");
    return min + Math.floor(v * (max - min + 1));
  }
  /* Numbers with exactly `digits` digits: 1けた 1〜9, 2けた 10〜99, 3けた 100〜999. Never 0. */
  function range(digits) {
    checkDigits(digits);
    return { min: 10 ** (digits - 1), max: 10 ** digits - 1 };
  }

  /* `count` numbers of `digits` digits; no number is the same as the one right before it. */
  function generate(digits, count, r = Math.random) {
    const { min, max } = range(digits);
    checkCount(count);
    if (typeof r !== "function") throw new Error("乱数が正しくありません");
    return Array.from({ length: count }).reduce((acc) => {
      if (acc.length === 0) return [int(min, max, r)];
      const prev = acc[acc.length - 1];
      const n = int(min, max - 1, r);
      return [...acc, n >= prev ? n + 1 : n];
    }, []);
  }

  function sum(numbers) {
    if (!Array.isArray(numbers) || numbers.length === 0) throw new Error("数字がありません");
    if (!numbers.every(n => isInt(n, 1, 999))) throw new Error("数字が正しくありません");
    return numbers.reduce((a, b) => a + b, 0);
  }

  /* How long each number stays on screen, and the blank after it. on + gap = ms. */
  function timing(ms) {
    checkMs(ms);
    const gap = Math.round(Math.min(GAP.max, Math.max(GAP.min, ms * GAP.ratio)));
    return { on: ms - gap, gap };
  }

  function newProblem(spec, r = Math.random) {
    if (!spec || typeof spec !== "object") throw new Error("問題の設定がありません");
    const { digits, count, ms } = spec;
    checkMs(ms);
    const numbers = generate(digits, count, r);
    return { digits, count, ms, ...timing(ms), numbers, total: sum(numbers) };
  }

  /* The flash as steps in order: a lead-in blank, then each number followed by a blank.
   * n is the number index on screen (-1 = blank); passed is how many numbers have been shown minus one. */
  function schedule(problem, leadMs = 0) {
    if (!problem || !Array.isArray(problem.numbers)) throw new Error("問題がありません");
    if (!isInt(leadMs, 0, LIMITS.maxMs)) throw new Error("待ち時間が正しくありません");
    const { on, gap } = timing(problem.ms);
    const lead = Object.freeze({ n: -1, passed: -1, ms: leadMs });
    const body = problem.numbers.flatMap((_, i) => [Object.freeze({ n: i, passed: i, ms: on }), Object.freeze({ n: -1, passed: i, ms: gap })]);
    return Object.freeze([lead, ...body]);
  }

  /* Longest possible answer, so the keypad can stop accepting digits. */
  function answerLength(digits, count) {
    const { max } = range(digits);
    checkCount(count);
    return String(max * count).length;
  }
  /* The typed answer as a number, or null if it is not a plain positive integer. */
  function parseAnswer(entry) {
    const text = typeof entry === "number" ? String(entry) : entry;
    if (typeof text !== "string" || !/^[0-9]{1,8}$/.test(text)) return null;
    return Number(text);
  }
  function isCorrect(problem, entry) {
    if (!problem || !Number.isInteger(problem.total)) throw new Error("問題がありません");
    return parseAnswer(entry) === problem.total;
  }

  /* ---------- settings ---------- */
  function normalizeSettings(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    return {
      mode: MODES.includes(s.mode) ? s.mode : DEFAULTS.mode,
      digits: DIGITS.includes(s.digits) ? s.digits : DEFAULTS.digits,
      count: COUNTS.includes(s.count) ? s.count : DEFAULTS.count,
      speed: SPEED_IDS.includes(s.speed) ? s.speed : DEFAULTS.speed
    };
  }
  function specFor(settings) {
    const s = normalizeSettings(settings);
    return { digits: s.digits, count: s.count, ms: SPEEDS[s.speed].ms };
  }
  const seconds = (ms) => `${Number((ms / 1000).toFixed(2))}秒`;
  const describe = (spec) => `${spec.digits}けた ${spec.count}口 ${seconds(spec.ms)}`;

  /* ---------- ladder ---------- */
  function checkCleared(cleared) {
    if (!isInt(cleared, 0, LADDER.length)) throw new Error("段位の値が正しくありません");
  }
  function danTitle(cleared) {
    checkCleared(cleared);
    return cleared === 0 ? "無級" : LADDER[cleared - 1].title;
  }
  function danNote(cleared) {
    checkCleared(cleared);
    return NOTES.find(n => cleared >= n.min).text;
  }
  function streakTitle(streak) {
    if (!isInt(streak, 0, LIMITS.maxRecord)) throw new Error("連続正解の数が正しくありません");
    return STREAK_TITLES.find(t => streak >= t.min).text;
  }

  /* 自由に: one answer moves the run { streak, startBest, celebrated }. A miss starts a new try that is measured
   * against the best so far (bestNow). cheer is true the first time a try beats an earlier best; the very first
   * record (no earlier best) is saved quietly. */
  function freeStep(state, ok, bestNow) {
    if (!state || !isInt(state.streak, 0, LIMITS.maxRecord) || !isInt(state.startBest, 0, LIMITS.maxRecord)) {
      throw new Error("連続正解の状態が正しくありません");
    }
    if (!ok) {
      if (!isInt(bestNow, 0, LIMITS.maxRecord)) throw new Error("自己ベストが正しくありません");
      return { streak: 0, startBest: bestNow, celebrated: false, cheer: false };
    }
    const streak = Math.min(state.streak + 1, LIMITS.maxRecord);
    const beats = state.startBest > 0 && streak > state.startBest;
    return { streak, startBest: state.startBest, celebrated: !!state.celebrated || beats, cheer: beats && !state.celebrated };
  }

  /* ---------- records: { free: { "2-5-normal": best streak }, dan: steps cleared } ---------- */
  const KEY_RE = /^([1-3])-([0-9]{1,2})-([a-z]+)$/;
  function isRecordKey(key) {
    const m = typeof key === "string" ? KEY_RE.exec(key) : null;
    return !!m && DIGITS.includes(Number(m[1])) && COUNTS.includes(Number(m[2])) && SPEED_IDS.includes(m[3]);
  }
  function recordKey(digits, count, speed) {
    const key = `${digits}-${count}-${speed}`;
    if (!isRecordKey(key)) throw new Error("記録の設定が正しくありません");
    return key;
  }
  function normalizeRecords(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const free = r.free && typeof r.free === "object" && !Array.isArray(r.free) ? r.free : {};
    const entries = Object.entries(free).filter(([k, v]) => isRecordKey(k) && isInt(v, 1, LIMITS.maxRecord));
    return { free: Object.fromEntries(entries), dan: isInt(r.dan, 0, LADDER.length) ? r.dan : 0 };
  }
  function freeBest(records, key) {
    if (!isRecordKey(key)) throw new Error("記録の設定が正しくありません");
    return normalizeRecords(records).free[key] || 0;
  }
  function addFree(records, key, streak) {
    const prev = freeBest(records, key);
    if (!isInt(streak, 0, LIMITS.maxRecord)) throw new Error("連続正解の数が正しくありません");
    const base = normalizeRecords(records);
    const isNew = streak > prev;
    return { records: isNew ? { ...base, free: { ...base.free, [key]: streak } } : base, isNew };
  }
  function addDan(records, cleared) {
    checkCleared(cleared);
    const base = normalizeRecords(records);
    const isNew = cleared > base.dan;
    return { records: isNew ? { ...base, dan: cleared } : base, isNew };
  }

  return {
    DIGITS, COUNTS, SPEED_IDS, SPEEDS, MODES, DEFAULTS, LIMITS, GAP, LADDER, NOTES, STREAK_TITLES,
    range, generate, sum, timing, newProblem, schedule, answerLength, parseAnswer, isCorrect,
    normalizeSettings, specFor, seconds, describe,
    danTitle, danNote, streakTitle, freeStep,
    recordKey, normalizeRecords, freeBest, addFree, addDan
  };
})();

if (typeof module !== "undefined") module.exports = AnzanRules;

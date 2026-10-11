/* 色と文字 (Stroop test) rules: color words shown in a clashing ink. Answer the ink color (or read the word).
 * Trial generation (about 75% mismatched, no immediate repeats), scoring, time penalty, rank titles and records. */
const StroopRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const COLORS = Object.freeze([
    Object.freeze({ id: "red", word: "あか", token: "--c-red" }),
    Object.freeze({ id: "blue", word: "あお", token: "--c-blue" }),
    Object.freeze({ id: "green", word: "みどり", token: "--c-green" }),
    Object.freeze({ id: "yellow", word: "きいろ", token: "--c-amber" })
  ]);
  const COLOR_IDS = Object.freeze(COLORS.map(c => c.id));
  const MODES = Object.freeze({
    ink: Object.freeze({ label: "文字の色を答える", short: "色", ask: "この文字の色は？" }),
    word: Object.freeze({ label: "文字を読む", short: "読み", ask: "なんて書いてある？" })
  });
  const MODE_IDS = Object.freeze(Object.keys(MODES));
  const DURATIONS = Object.freeze([30, 60]);
  const DEFAULT_SETTINGS = Object.freeze({ mode: "ink", seconds: 30 });
  const INCONGRUENT_RATIO = 0.75;
  const PENALTY_MS = 1000;
  const FIRE_COMBO = 5;
  const MAX_REACTION_MS = 5000;
  const MAX_RECORD = 999;

  /* Rank thresholds: correct answers per 30 seconds when answering the ink color.
   * Reading the word is easier, so that mode needs MODE_PERCENT more. Longer rounds scale up. */
  const RANKS = Object.freeze([
    { min: 42, title: "カメレオン級", note: "色を見ぬく目は、もう達人。" },
    { min: 34, title: "クジャク級", note: "すごい集中力！" },
    { min: 27, title: "インコ級", note: "なかなかの反応！" },
    { min: 20, title: "金魚級", note: "いい調子。まだまだ上をねらえる。" },
    { min: 12, title: "ヒヨコ級", note: "慣れると、ぐんと速くなる。" },
    { min: 0, title: "タマゴ級", note: "まずは1問ずつ、落ち着いて。" }
  ].map(r => Object.freeze(r)));
  const MODE_PERCENT = Object.freeze({ ink: 100, word: 120 });

  /* ---------- validation ---------- */
  function checkMode(mode) {
    if (!MODE_IDS.includes(mode)) throw new Error("答え方が正しくありません");
  }
  function checkSeconds(seconds) {
    if (!DURATIONS.includes(seconds)) throw new Error("時間が正しくありません");
  }
  function checkColor(id) {
    if (!COLOR_IDS.includes(id)) throw new Error("色が正しくありません");
  }
  function checkTrial(t) {
    if (!t || typeof t !== "object") throw new Error("問題が正しくありません");
    checkColor(t.word);
    checkColor(t.ink);
  }
  function checkCount(n) {
    if (!Number.isInteger(n) || n < 0) throw new Error("正解数が正しくありません");
  }

  /* ---------- trials ---------- */
  /* Next card. Word and ink both differ from the previous card, so the screen always visibly changes. */
  function nextTrial(prev = null, r = Math.random) {
    if (prev !== null) checkTrial(prev);
    const congruent = r() >= INCONGRUENT_RATIO;
    if (congruent) {
      const word = R.pick(COLOR_IDS.filter(id => !prev || (id !== prev.word && id !== prev.ink)), r);
      return { word, ink: word, congruent: true };
    }
    const word = R.pick(COLOR_IDS.filter(id => !prev || id !== prev.word), r);
    const ink = R.pick(COLOR_IDS.filter(id => id !== word && (!prev || id !== prev.ink)), r);
    return { word, ink, congruent: false };
  }
  function answerOf(trial, mode) {
    checkTrial(trial);
    checkMode(mode);
    return mode === "ink" ? trial.ink : trial.word;
  }

  /* ---------- a round ---------- */
  function newGame(mode, seconds, r = Math.random) {
    checkMode(mode);
    checkSeconds(seconds);
    return { mode, seconds, trial: nextTrial(null, r), correct: 0, wrong: 0, combo: 0, bestCombo: 0, rtSum: 0, rtCount: 0 };
  }

  /* Returns { ok, state } with the next card already drawn. Reaction times count for correct answers only. */
  function answer(state, colorId, reactionMs, r = Math.random) {
    checkColor(colorId);
    if (!Number.isFinite(reactionMs) || reactionMs < 0) throw new Error("反応時間が正しくありません");
    const ok = colorId === answerOf(state.trial, state.mode);
    const combo = ok ? state.combo + 1 : 0;
    const scored = ok
      ? { correct: state.correct + 1, rtSum: state.rtSum + Math.min(Math.round(reactionMs), MAX_REACTION_MS), rtCount: state.rtCount + 1 }
      : { wrong: state.wrong + 1 };
    return {
      ok,
      state: { ...state, ...scored, combo, bestCombo: Math.max(state.bestCombo, combo), trial: nextTrial(state.trial, r) }
    };
  }

  /* Each mistake takes PENALTY_MS off the clock. */
  function timeLeftMs(state, elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("経過時間が正しくありません");
    return Math.max(0, state.seconds * 1000 - elapsedMs - state.wrong * PENALTY_MS);
  }

  function summary(state) {
    const total = state.correct + state.wrong;
    return {
      correct: state.correct,
      wrong: state.wrong,
      accuracy: total ? Math.round((state.correct / total) * 100) : 0,
      avgMs: state.rtCount ? Math.round(state.rtSum / state.rtCount) : null,
      bestCombo: state.bestCombo
    };
  }

  /* ---------- ranks ---------- */
  const threshold = (rank, seconds, mode) => Math.ceil((rank.min * MODE_PERCENT[mode] * seconds) / 3000);

  /* { index, title, note, next: { title, need } | null } — index 0 is the top rank. */
  function rankFor(correct, seconds, mode) {
    checkCount(correct);
    checkSeconds(seconds);
    checkMode(mode);
    const index = RANKS.findIndex(rank => correct >= threshold(rank, seconds, mode));
    const above = index > 0 ? RANKS[index - 1] : null;
    return {
      index,
      title: RANKS[index].title,
      note: RANKS[index].note,
      next: above ? { title: above.title, need: threshold(above, seconds, mode) - correct } : null
    };
  }

  /* ---------- settings and records ---------- */
  const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  const recordKey = (mode, seconds) => `${mode}-${seconds}`;
  const RECORD_KEYS = Object.freeze(MODE_IDS.flatMap(m => DURATIONS.map(s => recordKey(m, s))));
  const cleanCount = (n) => (Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_RECORD) : 0);

  function normalizeSettings(raw) {
    const s = isObject(raw) ? raw : {};
    return {
      mode: MODE_IDS.includes(s.mode) ? s.mode : DEFAULT_SETTINGS.mode,
      seconds: DURATIONS.includes(s.seconds) ? s.seconds : DEFAULT_SETTINGS.seconds
    };
  }
  function normalizeRecords(raw) {
    const src = isObject(raw) ? raw : {};
    return Object.fromEntries(RECORD_KEYS.map(k => [k, cleanCount(src[k])]));
  }
  /* New records object (the input is untouched), whether this round beat the best, and the old best. */
  function applyRecord(records, mode, seconds, correct) {
    checkMode(mode);
    checkSeconds(seconds);
    checkCount(correct);
    const clean = normalizeRecords(records);
    const key = recordKey(mode, seconds);
    const previous = clean[key];
    const isNew = correct > previous;
    return { records: isNew ? { ...clean, [key]: Math.min(correct, MAX_RECORD) } : clean, isNew, previous };
  }

  return {
    COLORS, COLOR_IDS, MODES, MODE_IDS, DURATIONS, DEFAULT_SETTINGS, INCONGRUENT_RATIO, PENALTY_MS, FIRE_COMBO,
    MAX_REACTION_MS, MAX_RECORD, RANKS, MODE_PERCENT, RECORD_KEYS,
    nextTrial, answerOf, newGame, answer, timeLeftMs, summary, rankFor,
    recordKey, normalizeSettings, normalizeRecords, applyRecord
  };
})();

if (typeof module !== "undefined") module.exports = StroopRules;

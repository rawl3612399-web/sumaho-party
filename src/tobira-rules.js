/* Twenty Questions (20の扉) rules: the keeper knows the word, the others ask yes/no questions.
 * Each reply uses one question; saying the right answer counts as a question too.
 * The guessers win if they get it in time; the keeper wins when questions or time run out. */
const TobiraRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const QUESTIONS = Object.freeze([10, 20, 30]);
  const MINUTES = Object.freeze([3, 5, 0]); /* 0 = no time limit */
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);
  const ANSWERS = Object.freeze(["yes", "no", "unknown"]);
  const DEFAULTS = Object.freeze({ questions: 20, minutes: 0, level: "easy" });
  const LOW_LEFT = 3;
  const URGENT_SEC = 30;
  const HOT_SEC = 10;
  const MAX_USED = 1000;

  /* ---------- settings ---------- */
  function normalizeSettings(raw) {
    const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.freeze({
      questions: QUESTIONS.includes(s.questions) ? s.questions : DEFAULTS.questions,
      minutes: MINUTES.includes(s.minutes) ? s.minutes : DEFAULTS.minutes,
      level: LEVELS.includes(s.level) ? s.level : DEFAULTS.level
    });
  }

  /* ---------- round state ---------- */
  const freeze = (s) => Object.freeze({ ...s, log: Object.freeze([...s.log]) });

  function newRound(word, questions, minutes = 0) {
    if (typeof word !== "string" || word.trim() === "") throw new Error("お題がありません");
    if (!QUESTIONS.includes(questions)) throw new Error(`質問の数は${QUESTIONS.join("・")}から選んでください`);
    if (!MINUTES.includes(minutes)) throw new Error("制限時間が正しくありません");
    return freeze({ word: word.trim(), budget: questions, minutes, log: [], result: null });
  }

  function assertLive(s) {
    if (!s || typeof s !== "object" || !Array.isArray(s.log) || !QUESTIONS.includes(s.budget)) {
      throw new Error("ゲームの状態が正しくありません");
    }
    if (s.result) throw new Error("もう決着がついています");
  }

  const used = (s) => s.log.length;
  const remaining = (s) => Math.max(0, s.budget - s.log.length);
  const isOver = (s) => Boolean(s.result);
  const outcome = (s) => s.result;
  const end = (s, log, winner, reason) => freeze({ ...s, log, result: Object.freeze({ winner, reason, used: log.length }) });

  /* The keeper replies to one question. Using the last question ends the round for the keeper. */
  function ask(s, answer) {
    assertLive(s);
    if (!ANSWERS.includes(answer)) throw new Error("答えは はい・いいえ・わからない のどれかです");
    const log = [...s.log, answer];
    return log.length >= s.budget ? end(s, log, "keeper", "questions") : freeze({ ...s, log });
  }

  /* Someone said the word. That guess uses one question. */
  function solve(s) {
    assertLive(s);
    return end(s, [...s.log, "correct"], "guessers", "solved");
  }

  function undo(s) {
    assertLive(s);
    if (s.log.length === 0) throw new Error("もどせる質問がありません");
    return freeze({ ...s, log: s.log.slice(0, -1) });
  }

  function timeout(s) {
    assertLive(s);
    return end(s, s.log, "keeper", "time");
  }

  function giveUp(s) {
    assertLive(s);
    return end(s, s.log, "keeper", "giveup");
  }

  function tally(s) {
    const count = (kind) => s.log.filter(a => a === kind).length;
    return Object.freeze({ yes: count("yes"), no: count("no"), unknown: count("unknown"), correct: count("correct") });
  }

  /* How well the guessers did: "close" on the very last question, then by share of the budget used. */
  function grade(s) {
    if (!s.result || s.result.winner !== "guessers") return null;
    const n = s.result.used;
    if (n >= s.budget) return "close";
    if (n <= s.budget / 4) return "genius";
    if (n <= s.budget / 2) return "great";
    return "good";
  }

  /* calm -> warm -> hot as questions or seconds run low. `sec` is null when there is no time limit. */
  function pressure(s, sec = null) {
    const left = remaining(s);
    const t = sec === null ? Infinity : sec;
    if (left <= 1 || t <= HOT_SEC) return "hot";
    if (left <= LOW_LEFT || t <= URGENT_SEC) return "warm";
    return "calm";
  }

  /* ---------- timer math (milliseconds from any monotonic clock) ---------- */
  function deadline(startMs, minutes) {
    if (!Number.isFinite(startMs)) throw new Error("開始時刻が正しくありません");
    if (!MINUTES.includes(minutes)) throw new Error("制限時間が正しくありません");
    return minutes === 0 ? null : startMs + minutes * 60000;
  }
  function msLeft(endAt, nowMs) {
    if (endAt === null) return Infinity;
    if (!Number.isFinite(endAt) || !Number.isFinite(nowMs)) throw new Error("時刻が正しくありません");
    return Math.max(0, endAt - nowMs);
  }
  const secondsLeft = (endAt, nowMs) => (endAt === null ? null : Math.ceil(msLeft(endAt, nowMs) / 1000));
  const isTimeUp = (endAt, nowMs) => endAt !== null && msLeft(endAt, nowMs) === 0;

  /* ---------- topics ---------- */
  const uniqueWords = (list) => [...new Set(list.filter(w => typeof w === "string").map(w => w.trim()).filter(Boolean))];

  function cleanUsed(list) {
    return Array.isArray(list) ? uniqueWords(list).slice(-MAX_USED) : [];
  }

  function poolFor(topics, level) {
    if (!LEVELS.includes(level)) throw new Error("お題の難しさが正しくありません");
    const words = topics && Array.isArray(topics[level]) ? uniqueWords(topics[level]) : [];
    if (words.length === 0) throw new Error("お題がありません");
    return words;
  }

  const choose = (list, r) => R.pick(list, r) ?? list[list.length - 1];

  /* Picks a word not used yet. When the pool is used up it starts over (keeping other pools' history)
   * and still avoids repeating the word just played. Returns the new history; `used` is not changed. */
  function pickTopic(pool, used = [], r = Math.random) {
    const words = uniqueWords(Array.isArray(pool) ? pool : []);
    if (words.length === 0) throw new Error("お題がありません");
    const history = cleanUsed(used);
    const fresh = words.filter(w => !history.includes(w));
    if (fresh.length > 0) {
      const word = choose(fresh, r);
      return Object.freeze({ word, used: Object.freeze(cleanUsed([...history, word])) });
    }
    const last = history[history.length - 1];
    const word = choose(words.length > 1 ? words.filter(w => w !== last) : words, r);
    const kept = history.filter(w => !words.includes(w));
    return Object.freeze({ word, used: Object.freeze(cleanUsed([...kept, word])) });
  }

  return {
    QUESTIONS, MINUTES, LEVELS, ANSWERS, DEFAULTS, LOW_LEFT, URGENT_SEC, HOT_SEC, MAX_USED,
    normalizeSettings, newRound, ask, solve, undo, timeout, giveUp,
    used, remaining, isOver, outcome, tally, grade, pressure,
    deadline, msLeft, secondsLeft, isTimeUp,
    cleanUsed, poolFor, pickTopic
  };
})();

if (typeof module !== "undefined") module.exports = TobiraRules;

/* Reaction-time test rules: random waits, false starts, averages, rank titles and personal bests.
 * Pure functions only. Randomness is always injected as r = Math.random so tests can fix it. */
const ReactionRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const TRIAL_OPTIONS = Object.freeze([3, 5, 10]);
  const MODE_IDS = Object.freeze(["eye", "ear"]);
  const MODES = Object.freeze({
    eye: Object.freeze({ id: "eye", label: "目で反応" }),
    ear: Object.freeze({ id: "ear", label: "耳で反応" })
  });
  const DEFAULT_SETTINGS = Object.freeze({ trials: 5, mode: "eye" });
  const WAIT = Object.freeze({ min: 1500, max: 5000 });
  /* Faster than this after the signal is a guess, not a reaction: counted as a false start. */
  const GUESS_MS = 100;
  /* No tap this long after the signal: the trial is replayed. */
  const TIMEOUT_MS = 3000;
  const RANKS = Object.freeze([
    Object.freeze({ id: "cheetah", title: "チーター級", under: 200, note: "人間ばなれの速さ！" }),
    Object.freeze({ id: "falcon", title: "ハヤブサ級", under: 250, note: "かなり速い！ 自慢していいレベル" }),
    Object.freeze({ id: "cat", title: "ネコ級", under: 300, note: "なかなかの反射神経" }),
    Object.freeze({ id: "dog", title: "イヌ級", under: 400, note: "ふつうくらい。まだまだ伸びる" }),
    Object.freeze({ id: "turtle", title: "カメ級", under: Infinity, note: "のんびり屋さん。もう一回！" })
  ]);

  /* ---------- validation ---------- */
  function checkTrials(n) {
    if (!TRIAL_OPTIONS.includes(n)) throw new Error(`回数は${TRIAL_OPTIONS.join("・")}回から選んでください`);
  }
  function checkMode(m) {
    if (!MODE_IDS.includes(m)) throw new Error("合図の種類が正しくありません");
  }
  function checkRound(round) {
    if (!round || typeof round !== "object" || !Array.isArray(round.times)) throw new Error("ラウンドが正しくありません");
    checkTrials(round.trials);
    checkMode(round.mode);
  }
  function checkTimes(times) {
    if (!Array.isArray(times) || times.some(t => !Number.isFinite(t) || t < 0)) throw new Error("タイムが正しくありません");
  }

  /* ---------- round flow ---------- */
  /* Random wait before the signal, in whole ms, always inside WAIT. */
  function planWait(r = Math.random) {
    const ms = R.between(WAIT.min, WAIT.max, r);
    return Math.min(WAIT.max, Math.max(WAIT.min, ms));
  }
  function newRound(trials, mode, r = Math.random) {
    checkTrials(trials);
    checkMode(mode);
    return { trials, mode, times: [], fouls: 0, wait: planWait(r) };
  }
  const finished = (round) => round.times.length >= round.trials;
  const trialNumber = (round) => Math.min(round.times.length + 1, round.trials);

  /* Same trial again with a fresh wait (after a timeout or a pause). Not counted as a false start. */
  function retry(round, r = Math.random) {
    checkRound(round);
    if (finished(round)) throw new Error("もう全部はかり終わっています");
    return { ...round, wait: planWait(r) };
  }

  /* What a tap means. sinceSignalMs is null when the signal has not been given yet. */
  function judge(sinceSignalMs) {
    if (sinceSignalMs === null || sinceSignalMs === undefined) return { kind: "early" };
    if (!Number.isFinite(sinceSignalMs)) throw new Error("時間が正しくありません");
    if (sinceSignalMs < 0) return { kind: "early" };
    if (sinceSignalMs < GUESS_MS) return { kind: "guess" };
    if (sinceSignalMs > TIMEOUT_MS) return { kind: "late" };
    return { kind: "ok", ms: Math.round(sinceSignalMs) };
  }
  const isFoul = (kind) => kind === "early" || kind === "guess";

  /* Applies one tap. Returns the new round and what happened; the input round is untouched. */
  function tap(round, sinceSignalMs, r = Math.random) {
    checkRound(round);
    if (finished(round)) throw new Error("もう全部はかり終わっています");
    const outcome = judge(sinceSignalMs);
    if (outcome.kind === "ok") {
      const times = [...round.times, outcome.ms];
      const done = times.length >= round.trials;
      return { round: { ...round, times, wait: done ? null : planWait(r) }, outcome };
    }
    const fouls = round.fouls + (isFoul(outcome.kind) ? 1 : 0);
    return { round: { ...round, fouls, wait: planWait(r) }, outcome };
  }

  /* ---------- scoring ---------- */
  function average(times) {
    checkTimes(times);
    if (times.length === 0) return null;
    return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  }
  function best(times) {
    checkTimes(times);
    return times.length ? Math.min(...times) : null;
  }
  function worst(times) {
    checkTimes(times);
    return times.length ? Math.max(...times) : null;
  }
  function rankFor(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("タイムが正しくありません");
    return RANKS.find(rank => ms < rank.under);
  }
  /* The next title up and how many ms faster you need to be, or null at the top. */
  function nextRank(ms) {
    const i = RANKS.indexOf(rankFor(ms));
    if (i === 0) return null;
    const target = RANKS[i - 1];
    return { rank: target, gap: Math.round(ms) - (target.under - 1) };
  }
  /* Badge for the trial just measured (the last time in the list): "record" when it beats the stored best single,
   * "round" when it is the fastest of this round so far, otherwise null. Ties with an earlier trial earn nothing. */
  function trialBadge(times, previousSingle) {
    checkTimes(times);
    if (times.length === 0) throw new Error("タイムがありません");
    if (previousSingle !== null && (!Number.isFinite(previousSingle) || previousSingle < 0)) throw new Error("自己ベストが正しくありません");
    const ms = times[times.length - 1];
    const earlier = times.slice(0, -1);
    if (earlier.length > 0 && ms >= Math.min(...earlier)) return null;
    if (previousSingle !== null && ms < previousSingle) return "record";
    return earlier.length > 0 ? "round" : null;
  }
  function summary(round) {
    checkRound(round);
    const avg = average(round.times);
    return {
      trials: round.trials, mode: round.mode, times: [...round.times], fouls: round.fouls,
      average: avg, best: best(round.times), worst: worst(round.times),
      rank: avg === null ? null : rankFor(avg)
    };
  }

  /* ---------- personal bests: per mode, average per trial count plus fastest single tap ---------- */
  const cleanMs = (v) => (Number.isInteger(v) && v >= GUESS_MS && v <= TIMEOUT_MS ? v : null);
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(MODE_IDS.map(mode => {
      const m = src[mode] && typeof src[mode] === "object" && !Array.isArray(src[mode]) ? src[mode] : {};
      const avg = m.avg && typeof m.avg === "object" && !Array.isArray(m.avg) ? m.avg : {};
      return [mode, {
        single: cleanMs(m.single),
        avg: Object.fromEntries(TRIAL_OPTIONS.map(n => [n, cleanMs(avg[n])]))
      }];
    }));
  }
  function bestOf(records, mode, trials) {
    checkMode(mode);
    checkTrials(trials);
    const clean = normalizeRecords(records);
    return { average: clean[mode].avg[trials], single: clean[mode].single };
  }
  const beats = (value, previous) => value !== null && (previous === null || value < previous);

  /* New records object for a finished round (input untouched) and which bests were broken. */
  function applyRecords(records, round) {
    checkRound(round);
    if (!finished(round)) throw new Error("まだ全部はかり終わっていません");
    const clean = normalizeRecords(records);
    const previous = bestOf(clean, round.mode, round.trials);
    const avg = cleanMs(average(round.times));
    const single = cleanMs(best(round.times));
    const newAverage = beats(avg, previous.average);
    const newSingle = beats(single, previous.single);
    const mode = clean[round.mode];
    const next = {
      ...clean,
      [round.mode]: {
        single: newSingle ? single : mode.single,
        avg: { ...mode.avg, [round.trials]: newAverage ? avg : mode.avg[round.trials] }
      }
    };
    return { records: next, newAverage, newSingle, previous };
  }

  function normalizeSettings(raw) {
    const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      trials: TRIAL_OPTIONS.includes(s.trials) ? s.trials : DEFAULT_SETTINGS.trials,
      mode: MODE_IDS.includes(s.mode) ? s.mode : DEFAULT_SETTINGS.mode
    };
  }

  return {
    TRIAL_OPTIONS, MODE_IDS, MODES, DEFAULT_SETTINGS, WAIT, GUESS_MS, TIMEOUT_MS, RANKS,
    planWait, newRound, finished, trialNumber, retry, judge, isFoul, tap,
    average, best, worst, rankFor, nextRank, trialBadge, summary,
    normalizeRecords, bestOf, applyRecords, normalizeSettings
  };
})();

if (typeof module !== "undefined") module.exports = ReactionRules;

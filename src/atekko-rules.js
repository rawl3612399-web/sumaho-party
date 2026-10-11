/* Forehead guessing rules: one player holds the phone to their forehead, the others give hints.
 * Each word is either guessed (correct) or skipped (pass); the score is the number of correct words. */
const AtekkoRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const TIMES = Object.freeze([60, 90, 120]);

  function newRound(pool, r = Math.random) {
    const words = [...new Set(pool)];
    if (words.length === 0) throw new Error("お題がありません");
    return { deck: R.shuffle(words, r), index: 0, results: [] };
  }
  const current = (s) => s.deck[s.index % s.deck.length];
  function answer(s, correct) {
    return { ...s, index: s.index + 1, results: [...s.results, { word: current(s), correct: Boolean(correct) }] };
  }
  const score = (s) => s.results.filter(x => x.correct).length;

  return { TIMES, newRound, current, answer, score };
})();

if (typeof module !== "undefined") module.exports = AtekkoRules;

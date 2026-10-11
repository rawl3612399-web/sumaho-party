/* Number bomb rules: a secret number hides between 1 and the max. Players take turns calling a number inside
 * the remaining range; the range shrinks around the bomb. Whoever calls the bomb's number loses. */
const NumBombRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const MAXES = Object.freeze([30, 50, 100]);

  function newGame(max, r = Math.random) {
    if (!MAXES.includes(max)) throw new Error("数字の範囲が正しくありません");
    return { max, low: 1, high: max, secret: R.between(1, max, r), calls: [], exploded: false };
  }

  function callError(g, n) {
    if (g.exploded) return "もう爆発しています";
    if (!Number.isInteger(n)) return "数字を入れてください";
    if (n < g.low || n > g.high) return `${g.low}〜${g.high}の中で選んでください`;
    return null;
  }

  function call(g, n) {
    const err = callError(g, n);
    if (err) throw new Error(err);
    const hit = n === g.secret;
    const low = !hit && n < g.secret ? n + 1 : g.low;
    const high = !hit && n > g.secret ? n - 1 : g.high;
    return { ...g, low, high, exploded: hit, calls: [...g.calls, { n, hit, low, high }] };
  }

  /* Only the bomb is left: the next caller has no safe choice. */
  const cornered = (g) => !g.exploded && g.low === g.high;

  return { MAXES, newGame, callError, call, cornered };
})();

if (typeof module !== "undefined") module.exports = NumBombRules;

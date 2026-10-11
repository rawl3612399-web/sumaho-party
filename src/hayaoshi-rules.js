/* Quick-press duel rules. Each round: wait for the signal, first tap wins the point.
 * Tapping before the signal (or on a fake signal) is a false start and gives the point to the other player. */
const HayaoshiRules = (() => {
  const TARGET_OPTIONS = Object.freeze([3, 5, 7]);
  const WAIT_MS = Object.freeze({ min: 1500, max: 5000 });
  const FAKE_CHANCE = 0.35;

  function newMatch(names, target, feints) {
    if (!TARGET_OPTIONS.includes(target)) throw new Error("先取数は3・5・7のどれかです");
    return { names: [...names], target, feints: Boolean(feints), scores: [0, 0], log: [], winner: null };
  }

  /* reason: "fast" (pressed first after the signal, ms = reaction time) or "foul" (player pressed too early). */
  function award(m, player, reason, ms = null) {
    if (m.winner !== null) throw new Error("勝負はもう終わっています");
    if (![0, 1].includes(player)) throw new Error("プレイヤーの指定が正しくありません");
    const scorer = reason === "foul" ? 1 - player : player;
    const scores = m.scores.map((s, i) => (i === scorer ? s + 1 : s));
    const log = [...m.log, { scorer, presser: player, reason, ms }];
    const winner = scores[scorer] >= m.target ? scorer : null;
    return { ...m, scores, log, winner };
  }

  /* Plans one round from random numbers in [0, 1): when the real signal comes and whether a fake comes first. */
  function planRound(feints, r1, r2, r3) {
    const span = WAIT_MS.max - WAIT_MS.min;
    const signalAt = WAIT_MS.min + Math.round(r1 * span);
    const hasFake = feints && r2 < FAKE_CHANCE && signalAt > 2200;
    const fakeAt = hasFake ? Math.round(800 + r3 * (signalAt - 1800)) : null;
    return { signalAt, fakeAt };
  }

  const bestTime = (m, player) => {
    const times = m.log.filter(l => l.reason === "fast" && l.scorer === player).map(l => l.ms);
    return times.length ? Math.min(...times) : null;
  };

  return { TARGET_OPTIONS, WAIT_MS, newMatch, award, planRound, bestTime };
})();

if (typeof module !== "undefined") module.exports = HayaoshiRules;

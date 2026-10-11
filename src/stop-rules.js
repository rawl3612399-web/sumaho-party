/* Stop-at-10 rules: each player starts and stops a stopwatch, aiming for the target time exactly.
 * The display disappears after a few seconds, so players have to count in their heads. */
const StopRules = (() => {
  const TARGETS = Object.freeze([5, 10, 30]);
  const HIDE_AFTER_MS = 3000;
  const PLAYERS = Object.freeze({ min: 1, max: 8 });
  const SEATS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H"]);

  function newGame(players, target) {
    if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) {
      throw new Error(`人数は${PLAYERS.min}〜${PLAYERS.max}人です`);
    }
    if (!TARGETS.includes(target)) throw new Error("目標の秒数が正しくありません");
    return { players, target, seats: SEATS.slice(0, players), results: [] };
  }
  const currentSeat = (g) => g.results.length;
  const finished = (g) => g.results.length >= g.players;

  function record(g, elapsedMs) {
    if (finished(g)) throw new Error("全員終わっています");
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("時間が正しくありません");
    const ms = Math.round(elapsedMs);
    const diff = ms - g.target * 1000;
    return { ...g, results: [...g.results, { seat: currentSeat(g), ms, diff }] };
  }

  /* Closest to the target first. Ties share the same rank. */
  function ranking(g) {
    const sorted = [...g.results].sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
    return sorted.map((x, i) => {
      const rank = i > 0 && Math.abs(x.diff) === Math.abs(sorted[i - 1].diff)
        ? null : i + 1;
      return { ...x, rank };
    }).reduce((acc, x) => [...acc, { ...x, rank: x.rank ?? acc[acc.length - 1].rank }], []);
  }

  return { TARGETS, HIDE_AFTER_MS, PLAYERS, SEATS, newGame, currentSeat, finished, record, ranking };
})();

if (typeof module !== "undefined") module.exports = StopRules;

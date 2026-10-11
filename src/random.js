/* Random helpers. Every function takes the random source `r` (returns [0, 1)) so rules stay testable. */
const Rand = (() => {
  function shuffle(list, r = Math.random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  const pick = (list, r = Math.random) => list[Math.floor(r() * list.length)];
  const between = (min, max, r = Math.random) => Math.round(min + r() * (max - min));
  return { shuffle, pick, between };
})();

if (typeof module !== "undefined") module.exports = Rand;

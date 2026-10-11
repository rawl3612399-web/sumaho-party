/* Electric chair balance simulator.
 * Usage: node tools/denki-sim.js [games-per-setting]
 * Plays many games with simple player models and prints how games end for each chair count,
 * win target and shock limit, so the numbers in denki-rules.js can be chosen from data. */
const R = require("../src/denki-rules.js");

const GAMES = Number(process.argv[2]) || 4000;

function weightedPick(items, weightOf, rand) {
  const weights = items.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* Player models. Each returns { trap(g), sit(g) }. */
const MODELS = {
  random: (rand) => ({
    trap: (g) => weightedPick(g.remaining, () => 1, rand),
    sit: (g) => weightedPick(g.remaining, () => 1, rand)
  }),
  greedy: (rand) => ({
    trap: (g) => weightedPick(g.remaining, c => R.valueOf(g, c), rand),
    sit: (g) => weightedPick(g.remaining, c => R.valueOf(g, c), rand)
  }),
  /* Looks for a winning chair, and the setter guards it. Closest to how people actually play. */
  reader: (rand) => {
    const winning = (g) => {
      const d = R.defender(g);
      return g.remaining.filter(c => g.scores[d] + R.valueOf(g, c) >= g.target);
    };
    return {
      trap: (g) => {
        const w = winning(g);
        if (w.length > 0 && rand() < 0.6) return weightedPick(w, () => 1, rand);
        return weightedPick(g.remaining, c => Math.sqrt(R.valueOf(g, c)), rand);
      },
      sit: (g) => {
        const w = winning(g);
        if (w.length > 0 && rand() < 0.7) return weightedPick(w, () => 1, rand);
        return weightedPick(g.remaining, c => Math.sqrt(R.valueOf(g, c)), rand);
      }
    };
  }
};

/* Small seeded RNG so results are repeatable. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playOne(chairs, options, model, rand) {
  const first = rand() < 0.5 ? 0 : 1;
  const bonus = options.bonus ? 1 + Math.floor(rand() * chairs) : null;
  let g = R.newGame(["A", "B"], first, chairs, { target: options.target, maxShocks: options.maxShocks, bonus });
  const player = model(rand);
  for (let guard = 0; guard < 500; guard++) {
    g = R.setTrap(g, player.trap(g));
    g = R.sit(g, player.sit(g));
    if (g.outcome) return { outcome: g.outcome, turns: g.turn + 1, firstWon: g.outcome.winner === first };
    g = R.nextTurn(g);
  }
  throw new Error("game did not end");
}

function measure(chairs, options, modelName, games = GAMES) {
  const rand = mulberry32(chairs * 1000 + (options.target || 0) * 7 + (options.maxShocks || 0));
  const stats = { target: 0, shocks: 0, lastChair: 0, draw: 0, turns: 0, firstWins: 0, decided: 0 };
  for (let i = 0; i < games; i++) {
    const r = playOne(chairs, options, MODELS[modelName], rand);
    stats[r.outcome.reason] += 1;
    if (r.outcome.winner === null) stats.draw += 1; else { stats.decided += 1; if (r.firstWon) stats.firstWins += 1; }
    stats.turns += r.turns;
  }
  return {
    target: stats.target / games,
    shocks: stats.shocks / games,
    lastChair: stats.lastChair / games,
    draw: stats.draw / games,
    turns: stats.turns / games,
    firstWin: stats.decided ? stats.firstWins / stats.decided : 0.5
  };
}

/* Fun score: games should usually end by reaching the target or by shocks (both dramatic),
 * rarely by running out of chairs, stay fair between first and second player, and last long enough. */
function badness(m, chairs) {
  const minTurns = Math.min(7, chairs);
  return Math.abs(m.firstWin - 0.5) * 4
    + Math.max(0, m.lastChair - 0.12) * 4
    + Math.abs(m.shocks - 0.3) * 1.5
    + m.draw * 3
    + Math.max(0, minTurns - m.turns) * 0.25;
}

const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);

function report() {
  console.log(`games per setting: ${GAMES}, model: reader (checked against random and greedy)\n`);
  for (let chairs = R.RULES.minChairs; chairs <= R.RULES.maxChairs; chairs++) {
    const sum = (chairs * (chairs + 1)) / 2;
    const rows = [];
    for (let maxShocks = 2; maxShocks <= 3; maxShocks++) {
      for (let target = Math.ceil(sum * 0.35); target <= Math.ceil(sum * 0.7); target++) {
        const m = measure(chairs, { target, maxShocks }, "reader", GAMES / 2);
        rows.push({ target, maxShocks, m, score: badness(m, chairs) });
      }
    }
    rows.sort((a, b) => a.score - b.score);
    const best = rows[0];
    const current = R.configFor(chairs);
    const now = measure(chairs, current, "reader");
    console.log(`${chairs} chairs (sum ${sum}) best: target ${best.target}, shocks ${best.maxShocks} | in rules: target ${current.target}, shocks ${current.maxShocks}`);
    ["reader", "random", "greedy"].forEach(model => {
      const m = model === "reader" ? now : measure(chairs, current, model);
      console.log(`  ${model.padEnd(6)} target ${pct(m.target)} shocks ${pct(m.shocks)} lastChair ${pct(m.lastChair)} draw ${pct(m.draw)} turns ${m.turns.toFixed(1).padStart(4)} firstWin ${pct(m.firstWin)}`);
    });
    const withBonus = measure(chairs, { ...current, bonus: true }, "reader");
    console.log(`  +bonus target ${pct(withBonus.target)} shocks ${pct(withBonus.shocks)} lastChair ${pct(withBonus.lastChair)} draw ${pct(withBonus.draw)} turns ${withBonus.turns.toFixed(1).padStart(4)} firstWin ${pct(withBonus.firstWin)}`);
  }
}

if (require.main === module) report();
module.exports = { measure, badness, MODELS };

/* Electric chair game rules. Pure functions, no DOM: every move returns a new game object. */
const DenkiRules = (() => {
  const RULES = Object.freeze({ minChairs: 5, maxChairs: 12, defaultChairs: 12, bonusMultiplier: 2 });
  const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

  /* Win target and shock limit per chair count, chosen with tools/denki-sim.js:
   * longest games where fewer than ~20% end by running out of chairs. 2 shocks lose when chairs are few. */
  const CONFIG = Object.freeze({
    5: { target: 7, maxShocks: 2 },
    6: { target: 10, maxShocks: 2 },
    7: { target: 13, maxShocks: 2 },
    8: { target: 15, maxShocks: 3 },
    9: { target: 20, maxShocks: 3 },
    10: { target: 24, maxShocks: 3 },
    11: { target: 28, maxShocks: 3 },
    12: { target: 34, maxShocks: 3 }
  });
  const configFor = (chairs) => CONFIG[chairs];
  const targetFor = (chairs) => CONFIG[chairs].target;
  const shocksFor = (chairs) => CONFIG[chairs].maxShocks;

  /* options.bonus: chair number worth double (null = no bonus chair). options.target / maxShocks override the table (used by the simulator). */
  function newGame(names, first, chairs = RULES.defaultChairs, options = {}) {
    if (!Number.isInteger(chairs) || chairs < RULES.minChairs || chairs > RULES.maxChairs) {
      throw new Error(`イスの数は${RULES.minChairs}〜${RULES.maxChairs}脚で選んでください`);
    }
    const bonus = options.bonus ?? null;
    if (bonus !== null && !(Number.isInteger(bonus) && bonus >= 1 && bonus <= chairs)) {
      throw new Error("ボーナスイスの番号が正しくありません");
    }
    return {
      names: [...names],
      first,
      chairs,
      target: options.target ?? targetFor(chairs),
      maxShocks: options.maxShocks ?? shocksFor(chairs),
      bonus,
      turn: 0,
      scores: [0, 0],
      shocks: [0, 0],
      remaining: range(chairs),
      history: [],
      trap: null,
      last: null,
      outcome: null
    };
  }
  const attacker = (g) => (g.first + g.turn) % 2;
  const defender = (g) => 1 - attacker(g);
  const valueOf = (g, chair) => (chair === g.bonus ? chair * RULES.bonusMultiplier : chair);

  function setTrap(g, chair) {
    if (!g.remaining.includes(chair)) throw new Error(`${chair}番のイスはもうありません`);
    return { ...g, trap: chair };
  }

  function judge(g) {
    const d = g.last.player;
    if (g.scores[d] >= g.target) return { winner: d, reason: "target" };
    if (g.shocks[d] >= g.maxShocks) return { winner: 1 - d, reason: "shocks" };
    if (g.remaining.length <= 1) {
      const [a, b] = g.scores;
      return { winner: a === b ? null : (a > b ? 0 : 1), reason: "lastChair" };
    }
    return null;
  }

  /* A shocked player drops to 0 points and the chair stays; a safe sit scores the chair's value and removes it. */
  function sit(g, chair) {
    if (g.trap === null) throw new Error("まだ電流が仕掛けられていません");
    if (!g.remaining.includes(chair)) throw new Error(`${chair}番のイスはもうありません`);
    const d = defender(g);
    const hit = chair === g.trap;
    const gained = hit ? 0 : valueOf(g, chair);
    const scores = g.scores.map((s, i) => (i !== d ? s : hit ? 0 : s + gained));
    const shocks = g.shocks.map((s, i) => (i === d && hit ? s + 1 : s));
    const remaining = hit ? g.remaining : g.remaining.filter(c => c !== chair);
    const last = { hit, chair, trap: g.trap, player: d, gained, lost: hit ? g.scores[d] : 0 };
    const history = [...g.history, { attacker: attacker(g), trap: g.trap, chair, hit }];
    const next = { ...g, scores, shocks, remaining, history, last };
    return { ...next, outcome: judge(next) };
  }

  function nextTurn(g) {
    return { ...g, turn: g.turn + 1, trap: null, last: null };
  }

  /* ---------- match (several games, first to win `need` games) ---------- */
  function newMatch(bestOf) {
    if (![1, 3, 5].includes(bestOf)) throw new Error("セット数は1・3・5のどれかです");
    return { bestOf, need: Math.ceil(bestOf / 2), wins: [0, 0], draws: 0, played: 0 };
  }
  function recordGame(match, outcome) {
    const wins = match.wins.map((w, i) => (outcome.winner === i ? w + 1 : w));
    const draws = match.draws + (outcome.winner === null ? 1 : 0);
    return { ...match, wins, draws, played: match.played + 1 };
  }
  const matchWinner = (match) => {
    const i = match.wins.findIndex(w => w >= match.need);
    return i === -1 ? null : i;
  };

  return {
    RULES, CONFIG, configFor, targetFor, shocksFor, valueOf,
    newGame, attacker, defender, setTrap, sit, nextTurn,
    newMatch, recordGame, matchWinner
  };
})();

if (typeof module !== "undefined") module.exports = DenkiRules;

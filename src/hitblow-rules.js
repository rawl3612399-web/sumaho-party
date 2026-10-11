/* Hit & Blow rules. Each player hides a number with no repeated digits; players take turns guessing the other's.
 * Hit = right digit in the right place. Blow = right digit in the wrong place.
 * Rounds are even: if the first guesser solves it, the second guesser still gets that round's guess (a draw is possible). */
const HitBlowRules = (() => {
  const DIGIT_OPTIONS = Object.freeze([3, 4]);

  function codeError(code, digits) {
    if (typeof code !== "string" || !/^[0-9]+$/.test(code)) return "数字だけで入力してください";
    if (code.length !== digits) return `${digits}けたで入力してください`;
    if (new Set(code).size !== code.length) return "同じ数字は使えません";
    return null;
  }
  function assertCode(code, digits) {
    const err = codeError(code, digits);
    if (err) throw new Error(err);
  }

  function judge(secret, guess) {
    let hit = 0;
    let blow = 0;
    [...guess].forEach((d, i) => {
      if (secret[i] === d) hit += 1;
      else if (secret.includes(d)) blow += 1;
    });
    return { hit, blow };
  }

  function newGame(names, digits, first) {
    if (!DIGIT_OPTIONS.includes(digits)) throw new Error("けた数は3か4です");
    return {
      names: [...names],
      digits,
      first,
      secrets: [null, null],
      turn: 0,
      history: [[], []],
      solved: [false, false],
      outcome: null
    };
  }

  const guesser = (g) => (g.first + g.turn) % 2;
  const ready = (g) => g.secrets.every(s => s !== null);

  function setSecret(g, player, code) {
    assertCode(code, g.digits);
    const secrets = g.secrets.map((s, i) => (i === player ? code : s));
    return { ...g, secrets };
  }

  function guess(g, code) {
    if (!ready(g)) throw new Error("まだ2人とも数字を決めていません");
    if (g.outcome) throw new Error("勝負はもう終わっています");
    assertCode(code, g.digits);
    const p = guesser(g);
    const result = judge(g.secrets[1 - p], code);
    const history = g.history.map((h, i) => (i === p ? [...h, { code, ...result }] : h));
    const solved = g.solved.map((s, i) => (i === p ? s || result.hit === g.digits : s));
    const roundDone = p !== g.first;
    const outcome = roundDone && solved.some(Boolean)
      ? { winner: solved[0] && solved[1] ? null : solved[0] ? 0 : 1, guesses: history[p].length }
      : null;
    return { ...g, history, solved, outcome, turn: g.turn + 1, last: { player: p, code, ...result } };
  }

  /* True when the first guesser already solved it and the second guesser is taking the last chance. */
  const lastChance = (g) => !g.outcome && g.solved[g.first] && guesser(g) !== g.first;

  return { DIGIT_OPTIONS, codeError, judge, newGame, guesser, ready, setSecret, guess, lastChance };
})();

if (typeof module !== "undefined") module.exports = HitBlowRules;

/* Speed (スピード) rules: two sides race to empty their 4 field cards and deck onto two shared center piles.
 * A card goes on either pile when its rank is one above or below the top card (K and A connect). No turns.
 * When nobody can play, both flip one card onto their own pile (from the deck, or from the field once the deck is gone).
 * First side with no field cards and no deck wins; if both run out on the same flip it is a draw. */
const SpeedRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const C = typeof Cards !== "undefined" ? Cards : require("./cards.js");

  const FIELD = 4;
  const SIDES = Object.freeze([0, 1]);
  const RANK_COUNT = 13;
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);
  const REACTION_MS = Object.freeze({ easy: 1600, normal: 1000, hard: 600 });
  const JITTER = 0.25;
  /* Chance that the CPU looks away when it could play (a real mistake: it just reacts later). */
  const MISS = Object.freeze({ easy: 0.22, normal: 0.06, hard: 0 });
  /* The CPU needs this long to see a card the other side just put down before it can answer it. */
  const SEE_MS = Object.freeze({ easy: 700, normal: 450, hard: 300 });

  /* ---------- validation ---------- */
  function checkState(s) {
    const okSide = (x) => x && Array.isArray(x.field) && x.field.length === FIELD && Array.isArray(x.deck);
    const ok = s && typeof s === "object" && Array.isArray(s.sides) && s.sides.length === 2 && s.sides.every(okSide)
      && Array.isArray(s.piles) && s.piles.length === 2 && s.piles.every(Array.isArray);
    if (!ok) throw new Error("ゲームの状態が正しくありません");
  }
  function checkSide(side) {
    if (!SIDES.includes(side)) throw new Error("プレイヤーの指定が正しくありません");
  }
  function checkSlot(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= FIELD) throw new Error("場札の位置が正しくありません");
  }
  function checkPile(pile) {
    if (!SIDES.includes(pile)) throw new Error("台札の指定が正しくありません");
  }
  function checkLevel(level) {
    if (!LEVELS.includes(level)) throw new Error("CPUの強さが正しくありません");
  }

  /* ---------- cards ---------- */
  /* Ranks one apart connect, and so do K and A. Suits do not matter. */
  function connects(a, b) {
    if (!a || !b) return false;
    const d = Math.abs(C.rankIndex(a) - C.rankIndex(b));
    return d === 1 || d === RANK_COUNT - 1;
  }
  const topOf = (pile) => (pile.length ? pile[pile.length - 1] : null);
  const top = (state, pile) => topOf(state.piles[pile]);
  function pileTop(state, pile) {
    checkState(state);
    checkPile(pile);
    return top(state, pile);
  }
  const withSlot = (field, slot, card) => field.map((c, i) => (i === slot ? card : c));

  /* Fills empty field slots, left to right, from the top of the deck. */
  function refill(side) {
    if (!side || !Array.isArray(side.field) || !Array.isArray(side.deck)) throw new Error("手元の状態が正しくありません");
    return side.field.reduce((acc, card, i) => {
      if (card || acc.deck.length === 0) return acc;
      return { field: withSlot(acc.field, i, acc.deck[0]), deck: acc.deck.slice(1) };
    }, { field: [...side.field], deck: [...side.deck] });
  }

  /* Red suits (H, D) go to side 0, black suits (S, C) to side 1. Each side lays 4 cards face up; the rest is its deck. */
  function deal(r = Math.random) {
    const deck = C.newDeck(1);
    const layout = (cards) => refill({ field: Array(FIELD).fill(null), deck: R.shuffle(cards, r) });
    return {
      sides: [layout(deck.filter(c => C.isRed(c))), layout(deck.filter(c => !C.isRed(c)))],
      piles: [[], []], over: false, winner: null, step: 0, flips: 0, last: { type: "deal" }
    };
  }

  /* ---------- queries ---------- */
  function pilesFor(state, side, slot) {
    checkState(state);
    checkSide(side);
    checkSlot(slot);
    const card = state.sides[side].field[slot];
    if (state.over || !card) return [];
    return SIDES.filter(p => connects(card, top(state, p)));
  }
  function legalPlays(state, side) {
    checkState(state);
    checkSide(side);
    return state.sides[side].field.flatMap((_, slot) => pilesFor(state, side, slot).map(pile => ({ slot, pile })));
  }
  function cardsLeft(state, side) {
    checkState(state);
    checkSide(side);
    const s = state.sides[side];
    return s.field.filter(Boolean).length + s.deck.length;
  }
  /* Nobody can play: time for 「せーの」. Also true before the first flip, when the piles are empty. */
  function isStuck(state) {
    checkState(state);
    return !state.over && SIDES.every(s => legalPlays(state, s).length === 0);
  }
  /* Marks the game over once a side has no cards (both at once = draw, winner null). */
  function settle(state) {
    const out = SIDES.filter(s => cardsLeft(state, s) === 0);
    if (out.length === 0) return state;
    return { ...state, over: true, winner: out.length === 1 ? out[0] : null };
  }

  /* ---------- moves ---------- */
  function play(state, side, slot, pile) {
    checkState(state);
    checkSide(side);
    checkSlot(slot);
    checkPile(pile);
    if (state.over) throw new Error("勝負はもう終わっています");
    const mine = state.sides[side];
    const card = mine.field[slot];
    if (!card) throw new Error("そこにはカードがありません");
    if (!connects(card, top(state, pile))) throw new Error("そのカードはその台札に出せません");
    const next = refill({ ...mine, field: withSlot(mine.field, slot, null) });
    return settle({
      ...state,
      sides: state.sides.map((x, i) => (i === side ? next : x)),
      piles: state.piles.map((p, i) => (i === pile ? [...p, card] : p)),
      step: (state.step || 0) + 1,
      last: { type: "play", side, slot, pile, card, refill: next.field[slot] }
    });
  }

  /* One side's 「せーの」 card: top of the deck, or the leftmost field card when the deck is empty. */
  function flipOne(side, i) {
    if (side.deck.length) return { next: { ...side, deck: side.deck.slice(1) }, move: { side: i, from: "deck", slot: null, card: side.deck[0] } };
    const slot = side.field.findIndex(Boolean);
    if (slot < 0) return { next: side, move: null };
    return { next: { ...side, field: withSlot(side.field, slot, null) }, move: { side: i, from: "field", slot, card: side.field[slot] } };
  }
  /* 「せーの」: both sides put one card on their own pile (side 0 on pile 0, side 1 on pile 1). Only when stuck. */
  function flip(state) {
    checkState(state);
    if (state.over) throw new Error("勝負はもう終わっています");
    if (!isStuck(state)) throw new Error("まだ出せるカードがあります");
    const results = state.sides.map(flipOne);
    return settle({
      ...state,
      sides: results.map(x => x.next),
      piles: state.piles.map((p, i) => (results[i].move ? [...p, results[i].move.card] : p)),
      step: (state.step || 0) + 1,
      flips: (state.flips || 0) + 1,
      last: { type: "flip", moves: results.map(x => x.move) }
    });
  }

  /* ---------- CPU ---------- */
  /* Longest run of own field cards that can go out one after another (no refills: the deck is face down). */
  function longestRun(field, tops) {
    let best = 0;
    field.forEach((card, i) => {
      if (!card) return;
      tops.forEach((t, p) => {
        if (!connects(card, t)) return;
        best = Math.max(best, 1 + longestRun(withSlot(field, i, null), withSlot(tops, p, card)));
      });
    });
    return best;
  }
  function scorePlay(state, side, move, level) {
    const field = state.sides[side].field;
    const card = field[move.slot];
    const tops = SIDES.map(p => (p === move.pile ? card : top(state, p)));
    const run = longestRun(withSlot(field, move.slot, null), tops);
    if (level === "normal") return Math.min(run, 1);
    const theirs = state.sides[1 - side].field.filter(Boolean);
    const opened = theirs.reduce((n, c) => n + tops.filter(t => connects(c, t)).length, 0);
    return run * 10 - opened * 3;
  }
  /* Picks the CPU's next play, or null (no play, or it looked away this time). */
  function cpuChoose(state, side, level, r = Math.random) {
    checkState(state);
    checkSide(side);
    checkLevel(level);
    const plays = legalPlays(state, side);
    if (plays.length === 0 || r() < MISS[level]) return null;
    if (level === "easy") return R.pick(plays, r);
    const scored = plays.map(p => ({ p, score: scorePlay(state, side, p, level) }));
    const best = Math.max(...scored.map(x => x.score));
    return R.pick(scored.filter(x => x.score === best).map(x => x.p), r);
  }
  /* How long the CPU takes to react, in ms: the level's base time ±25%. */
  function cpuDelay(level, r = Math.random) {
    checkLevel(level);
    return Math.round(REACTION_MS[level] * (1 - JITTER + 2 * JITTER * r()));
  }
  /* The other side just played and the CPU's reaction was due in `left` ms: it now waits at least SEE_MS,
   * so it never answers a fresh card faster than a person could. */
  function cpuRewait(level, left) {
    checkLevel(level);
    if (typeof left !== "number" || Number.isNaN(left)) throw new Error("待ち時間が正しくありません");
    return Math.max(left, SEE_MS[level]);
  }

  return {
    FIELD, LEVELS, REACTION_MS, MISS, SEE_MS,
    connects, refill, deal, top: pileTop, pilesFor, legalPlays, cardsLeft, isStuck, play, flip,
    cpuChoose, cpuDelay, cpuRewait
  };
})();

if (typeof module !== "undefined") module.exports = SpeedRules;

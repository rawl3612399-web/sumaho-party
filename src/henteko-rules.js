/* Silly-creature naming rules: a shuffled deck of creature kinds (4 cards each), naming on first sight, a race to shout the name, the pile goes to the winner. */
const HentekoRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const PLAYERS = Object.freeze({ min: 2, max: 8 });
  const KIND_COUNTS = Object.freeze([6, 8, 12]);
  const COPIES = 4;
  const MAX_SEED = 0xffffffff;
  const MIN_DIFF = 4;
  const MAX_TRIES = 50000;

  const BODIES = Object.freeze(["blob", "round", "tall", "spiky", "ghost"]);
  /* Ordered so the first 6 and the first 8 are the easiest to tell apart. */
  const COLORS = Object.freeze([
    "--c-red", "--c-amber", "--c-green", "--c-blue", "--c-pink", "--c-slate",
    "--c-purple", "--c-cyan", "--c-orange", "--c-lime", "--c-brown", "--c-teal"
  ]);
  const EYE_COUNTS = Object.freeze([1, 2, 2, 3]);
  const EYE_STYLES = Object.freeze(["big", "dot", "happy", "googly"]);
  const LOOKS = Object.freeze(["center", "left", "right", "up", "cross"]);
  const MOUTHS = Object.freeze(["smile", "open", "teeth", "tongue", "zigzag", "o"]);
  const TOPS = Object.freeze(["none", "antenna", "horns", "hat", "sprout", "crown"]);
  const ARMS = Object.freeze(["none", "up", "down", "wiggle"]);
  const LEGS = Object.freeze(["none", "two", "many"]);
  const PATTERNS = Object.freeze(["none", "spots", "belly"]);

  /* ---------- creatures ---------- */
  /* Small seeded generator (mulberry32) so a creature is always the same for the same seed. */
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A pure description of one creature kind. The screen draws it as SVG. */
  function generateCreature(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error("生き物の番号は0以上の整数です");
    const r = seeded(seed);
    const body = R.pick(BODIES, r);
    const color = R.pick(COLORS, r);
    const accent = R.pick(COLORS.filter(c => c !== color), r);
    const eyes = Object.freeze({ count: R.pick(EYE_COUNTS, r), style: R.pick(EYE_STYLES, r), look: R.pick(LOOKS, r) });
    const mouth = R.pick(MOUTHS, r);
    const top = R.pick(TOPS, r);
    const arms = R.pick(ARMS, r);
    const legs = R.pick(LEGS, r);
    const pattern = R.pick(PATTERNS, r);
    const cheeks = r() < 0.5;
    return Object.freeze({ seed, body, color, accent, eyes, mouth, top, arms, legs: body === "ghost" ? "none" : legs, pattern, cheeks });
  }

  const FEATURES = [
    c => c.body, c => c.color, c => c.top, c => c.mouth, c => c.arms,
    c => c.legs, c => c.pattern, c => c.eyes.count, c => c.eyes.style
  ];
  /* How many visible features differ between two creatures. */
  const difference = (a, b) => FEATURES.filter(f => f(a) !== f(b)).length;

  /* Same color, same silhouette (body + headwear), too many of one body, or too similar overall: rejected. */
  function fits(kinds, c, palette) {
    if (!palette.includes(c.color)) return false;
    const cap = Math.ceil(palette.length / BODIES.length);
    if (kinds.filter(k => k.body === c.body).length >= cap) return false;
    return kinds.every(k => k.color !== c.color && !(k.body === c.body && k.top === c.top) && difference(k, c) >= MIN_DIFF);
  }

  /* `count` creature kinds that all look clearly different. Deterministic for the same random source. */
  function makeKinds(count, r = Math.random) {
    if (!Number.isInteger(count) || count < 1 || count > COLORS.length) throw new Error(`種類は1〜${COLORS.length}です`);
    const palette = COLORS.slice(0, count);
    const start = Math.floor(r() * (MAX_SEED + 1));
    let kinds = [];
    for (let k = 0; kinds.length < count; k++) {
      if (k >= MAX_TRIES) throw new Error("生き物を作れませんでした");
      const c = generateCreature((start + k) % (MAX_SEED + 1));
      if (fits(kinds, c, palette)) kinds = [...kinds, c];
    }
    return Object.freeze(kinds);
  }

  /* ---------- deck and game ---------- */
  function buildDeck(kindCount, copies = COPIES) {
    if (!Number.isInteger(kindCount) || kindCount < 1) throw new Error("種類の数が正しくありません");
    if (!Number.isInteger(copies) || copies < 1) throw new Error("枚数が正しくありません");
    return Array.from({ length: kindCount * copies }, (_, i) => Math.floor(i / copies));
  }

  function newGame(players, kindCount, r = Math.random) {
    if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) {
      throw new Error(`人数は${PLAYERS.min}〜${PLAYERS.max}人です`);
    }
    if (!KIND_COUNTS.includes(kindCount)) throw new Error(`種類は${KIND_COUNTS.join("・")}から選んでください`);
    const kinds = makeKinds(kindCount, r);
    return {
      players,
      kinds,
      deck: R.shuffle(buildDeck(kindCount), r),
      next: 0,
      pile: [],
      seen: Array(kindCount).fill(0),
      scores: Array(players).fill(0),
      turn: 0,
      phase: "flip",
      card: null,
      last: null
    };
  }

  function expectPhase(s, phase, message) {
    if (!s || !Array.isArray(s.deck) || !Array.isArray(s.pile) || !Array.isArray(s.scores) || !Array.isArray(s.seen)) {
      throw new Error("ゲームの状態が正しくありません");
    }
    if (s.phase !== phase) throw new Error(message);
  }

  /* Turns the next card onto the pile. First sight -> "name", seen before -> "race". */
  function flip(s) {
    expectPhase(s, "flip", "今はめくれません");
    const kind = s.deck[s.next];
    const count = s.seen[kind] + 1;
    return {
      ...s,
      next: s.next + 1,
      pile: [...s.pile, kind],
      seen: s.seen.map((n, i) => (i === kind ? count : n)),
      card: { kind, count, first: count === 1, by: s.turn },
      phase: count === 1 ? "name" : "race"
    };
  }

  /* Ends the current card: the next seat flips, or the game is over when the deck is empty. */
  const settle = (s, patch) => ({
    ...s,
    ...patch,
    turn: (s.turn + 1) % s.players,
    phase: s.next >= s.deck.length ? "over" : "flip"
  });

  function named(s) {
    expectPhase(s, "name", "名前をつける場面ではありません");
    return settle(s, { last: { type: "named", kind: s.card.kind } });
  }

  /* The first player to shout the right name takes the whole pile. */
  function award(s, seat) {
    expectPhase(s, "race", "今はカードをもらえません");
    if (!Number.isInteger(seat) || seat < 0 || seat >= s.players) throw new Error("その席はありません");
    const cards = s.pile.length;
    return settle(s, {
      pile: [],
      scores: s.scores.map((n, i) => (i === seat ? n + cards : n)),
      last: { type: "award", seat, cards }
    });
  }

  /* Nobody remembered: the pile stays and keeps growing. */
  function nobody(s) {
    expectPhase(s, "race", "今はパスできません");
    return settle(s, { last: { type: "nobody", cards: s.pile.length } });
  }

  const remaining = (s) => s.deck.length - s.next;
  const isOver = (s) => s.phase === "over";

  /* Most cards first. Equal cards share the rank. */
  function ranking(s) {
    const order = s.scores
      .map((cards, seat) => ({ seat, cards }))
      .sort((a, b) => b.cards - a.cards || a.seat - b.seat);
    return order.map(row => ({ ...row, rank: 1 + order.filter(o => o.cards > row.cards).length }));
  }

  /* Seats with the most cards; nobody wins when nobody took a single card. */
  function winners(s) {
    const top = Math.max(...s.scores);
    return top > 0 ? s.scores.map((n, seat) => (n === top ? seat : -1)).filter(seat => seat >= 0) : [];
  }

  return {
    PLAYERS, KIND_COUNTS, COPIES, MIN_DIFF, BODIES, COLORS, EYE_COUNTS, EYE_STYLES, LOOKS, MOUTHS, TOPS, ARMS, LEGS, PATTERNS,
    generateCreature, difference, makeKinds, buildDeck, newGame, flip, named, award, nobody, remaining, isOver, ranking, winners
  };
})();

if (typeof module !== "undefined") module.exports = HentekoRules;

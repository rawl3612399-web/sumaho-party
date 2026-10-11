/* Blackjack rules: 6-deck shoe, dealer stands on all 17s, blackjack pays 3:2, double, one split, dealer peeks. */
const BlackjackRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const C = typeof Cards !== "undefined" ? Cards : require("./cards.js");

  const DECKS = 6;
  const PENETRATION = 0.75;
  const START_CHIPS = 1000;
  const MIN_BET = 10;
  const MAX_BET = 5000;
  const MAX_CHIPS = 999999999;
  const CHIP_VALUES = Object.freeze([10, 50, 100, 500]);
  const ACTIONS = Object.freeze(["hit", "stand", "double", "split"]);
  const TENS = Object.freeze(["10", "J", "Q", "K"]);
  const SUIT_IDS = C.SUITS.map(s => s.id);

  /* ---------- cards and totals ---------- */
  const isCard = (c) => Boolean(c) && SUIT_IDS.includes(c.suit) && C.RANKS.includes(c.rank);
  const cardValue = (card) => (card.rank === "A" ? 1 : TENS.includes(card.rank) ? 10 : Number(card.rank));

  /* total: best total; hard: aces as 1; soft: an ace is counted as 11. */
  function handValue(cards) {
    const hard = cards.reduce((sum, c) => sum + cardValue(c), 0);
    const soft = cards.some(c => c.rank === "A") && hard + 10 <= 21;
    const total = soft ? hard + 10 : hard;
    return { total, hard, soft, bust: total > 21 };
  }
  const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
  /* A natural is a two-card 21 on the original hand; 21 after a split is only 21. */
  const isNatural = (hand) => !hand.split && isBlackjack(hand.cards);
  /* "7 / 17" while an ace can still be 1 or 11 and the hand can still draw; a finished hand shows only its total. */
  function totalLabel(cards, finished = false) {
    const v = handValue(cards);
    return v.soft && v.total < 21 && !finished ? `${v.hard} / ${v.total}` : String(v.total);
  }
  const dealerShouldHit = (cards) => handValue(cards).total < 17;
  const canPeek = (up) => up.rank === "A" || cardValue(up) === 10;

  /* ---------- shoe ---------- */
  function shoeFrom(cards) {
    if (!Array.isArray(cards) || cards.length === 0 || !cards.every(isCard)) throw new Error("山札が正しくありません");
    return Object.freeze({ cards: Object.freeze([...cards]), next: 0 });
  }
  const newShoe = (r = Math.random, decks = DECKS) => shoeFrom(R.shuffle(C.newDeck(decks), r));
  const remaining = (shoe) => shoe.cards.length - shoe.next;
  const needsShuffle = (shoe) => shoe.next >= shoe.cards.length * PENETRATION;
  function draw(shoe) {
    if (remaining(shoe) <= 0) throw new Error("山札がありません");
    return { card: shoe.cards[shoe.next], shoe: { ...shoe, next: shoe.next + 1 } };
  }

  /* ---------- chips ---------- */
  const isBroke = (chips) => chips < MIN_BET;
  const maxBet = (chips) => Math.max(0, Math.min(MAX_BET, Math.floor(chips / MIN_BET) * MIN_BET));
  const canAddChip = (bet, value, chips) => CHIP_VALUES.includes(value) && bet + value <= maxBet(chips);
  /* 同じ額: the last bet, lowered to what the chips allow. */
  const repeatBet = (last, chips) => (Number.isInteger(last) && last >= MIN_BET ? Math.min(last, maxBet(chips)) : 0);
  function validBet(chips, bet) {
    return Number.isInteger(chips) && Number.isInteger(bet) && bet >= MIN_BET && bet % MIN_BET === 0 && bet <= maxBet(chips);
  }
  /* Splits an amount into chip values, biggest first (for drawing stacks). */
  function chipStack(amount) {
    if (!Number.isInteger(amount) || amount < 0) throw new Error("チップの数が正しくありません");
    return [...CHIP_VALUES].reverse().reduce((acc, v) => {
      const n = Math.floor(acc.left / v);
      return { left: acc.left - n * v, list: [...acc.list, ...Array(n).fill(v)] };
    }, { left: amount, list: [] }).list;
  }
  /* Checks what was loaded from storage. */
  function normalizeBank(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const ok = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_CHIPS;
    const chips = ok(src.chips) ? src.chips : START_CHIPS;
    const last = ok(src.last) && src.last >= MIN_BET && src.last <= MAX_BET && src.last % MIN_BET === 0 ? src.last : 0;
    const best = Math.max(chips, START_CHIPS, ok(src.best) ? src.best : 0);
    return { chips, last, best };
  }

  /* ---------- round ---------- */
  const newHand = (cards, bet, split = false) => ({ cards, bet, split, doubled: false, done: false });
  const activeHand = (round) => round.hands[round.active];
  const staked = (round) => round.hands.reduce((sum, h) => sum + h.bet, 0);

  /* Deals player, dealer up card, player, dealer hole card. Shuffles a fresh shoe first when 75% is gone. */
  function startRound({ shoe, chips, bet }, r = Math.random) {
    if (!validBet(chips, bet)) throw new Error(`賭けは${MIN_BET}枚から、持っているチップまで（最大${MAX_BET}枚）です`);
    const shuffled = !shoe || needsShuffle(shoe);
    const dealt = [0, 1, 2, 3].reduce((acc) => {
      const d = draw(acc.shoe);
      return { shoe: d.shoe, list: [...acc.list, d.card] };
    }, { shoe: shuffled ? newShoe(r) : shoe, list: [] });
    const [p1, up, p2, hole] = dealt.list;
    const round = {
      phase: "player", shoe: dealt.shoe, chips: chips - bet, bet, shuffled,
      dealer: [up, hole], hands: [newHand([p1, p2], bet)], active: 0,
      splitDone: false, peeked: canPeek(up), results: null
    };
    return isBlackjack(round.dealer) || isNatural(round.hands[0]) ? settle(round) : round;
  }

  function canDouble(round) {
    const h = activeHand(round);
    return round.phase === "player" && h.cards.length === 2 && round.chips >= h.bet;
  }
  function canSplit(round) {
    const h = activeHand(round);
    return round.phase === "player" && !round.splitDone && h.cards.length === 2 &&
      h.cards[0].rank === h.cards[1].rank && round.chips >= h.bet;
  }
  function legalActions(round) {
    if (!round || round.phase !== "player") return [];
    return ["hit", "stand", ...(canDouble(round) ? ["double"] : []), ...(canSplit(round) ? ["split"] : [])];
  }

  const withHand = (round, hand) => ({ ...round, hands: round.hands.map((h, i) => (i === round.active ? hand : h)) });
  function hitHand(hand, shoe) {
    const d = draw(shoe);
    const cards = [...hand.cards, d.card];
    return { hand: { ...hand, cards, done: hand.done || handValue(cards).total >= 21 }, shoe: d.shoe };
  }
  const MOVES = {
    hit: (round) => {
      const d = hitHand(activeHand(round), round.shoe);
      return { ...withHand(round, d.hand), shoe: d.shoe };
    },
    stand: (round) => withHand(round, { ...activeHand(round), done: true }),
    double: (round) => {
      const h = activeHand(round);
      const d = hitHand({ ...h, bet: h.bet * 2, doubled: true, done: true }, round.shoe);
      return { ...withHand(round, d.hand), shoe: d.shoe, chips: round.chips - h.bet };
    },
    split: (round) => {
      const h = activeHand(round);
      const aces = h.cards[0].rank === "A";
      const first = hitHand({ ...newHand([h.cards[0]], h.bet, true), done: aces }, round.shoe);
      const second = aces
        ? hitHand({ ...newHand([h.cards[1]], h.bet, true), done: true }, first.shoe)
        : { hand: newHand([h.cards[1]], h.bet, true), shoe: first.shoe };
      return { ...round, shoe: second.shoe, chips: round.chips - h.bet, hands: [first.hand, second.hand], splitDone: true };
    }
  };

  /* Moves on to the next unfinished hand (dealing its second card), then to the dealer. */
  function advance(round) {
    if (!activeHand(round).done) return round;
    const next = round.hands.findIndex((h, i) => i > round.active && !h.done);
    if (next >= 0) {
      const h = round.hands[next];
      if (h.cards.length >= 2) return advance({ ...round, active: next });
      const d = hitHand(h, round.shoe);
      return advance({ ...round, active: next, shoe: d.shoe, hands: round.hands.map((x, i) => (i === next ? d.hand : x)) });
    }
    const live = round.hands.some(h => !handValue(h.cards).bust);
    return live ? { ...round, phase: "dealer" } : settle(round);
  }

  function act(round, action) {
    if (!ACTIONS.includes(action)) throw new Error("知らない操作です");
    if (!legalActions(round).includes(action)) throw new Error("今はその操作はできません");
    return advance(MOVES[action](round));
  }

  /* One dealer step: draws a card below 17, otherwise settles the round. */
  function dealerStep(round) {
    if (!round || round.phase !== "dealer") throw new Error("ディーラーの番ではありません");
    if (!dealerShouldHit(round.dealer)) return settle(round);
    const d = draw(round.shoe);
    return { ...round, shoe: d.shoe, dealer: [...round.dealer, d.card] };
  }
  function playDealer(round) {
    let r = round;
    while (r.phase === "dealer") r = dealerStep(r);
    return r;
  }

  /* ---------- settlement ---------- */
  const RETURNS = Object.freeze({
    blackjack: (bet) => bet + Math.floor(bet * 3 / 2), win: (bet) => bet * 2, push: (bet) => bet, lose: () => 0, bust: () => 0
  });
  function outcome(hand, dealer) {
    const p = handValue(hand.cards);
    const d = handValue(dealer);
    const natural = isNatural(hand);
    const dealerBj = isBlackjack(dealer);
    if (natural && dealerBj) return "push";
    if (natural) return "blackjack";
    if (dealerBj) return "lose";
    if (p.bust) return "bust";
    if (d.bust || p.total > d.total) return "win";
    return p.total < d.total ? "lose" : "push";
  }
  function settle(round) {
    const results = round.hands.map(h => {
      const kind = outcome(h, round.dealer);
      const ret = RETURNS[kind](h.bet);
      return { outcome: kind, bet: h.bet, ret, net: ret - h.bet };
    });
    const back = results.reduce((sum, x) => sum + x.ret, 0);
    return { ...round, phase: "done", hands: round.hands.map(h => ({ ...h, done: true })), chips: round.chips + back, results };
  }
  const roundNet = (round) => (round.results || []).reduce((sum, x) => sum + x.net, 0);

  /* ---------- basic strategy (4-8 decks, S17, double after split, no surrender) ---------- */
  /* Columns: dealer 2 3 4 5 6 7 8 9 10 A. H hit, S stand, D double else hit, X double else stand, P split. */
  const HARD = Object.freeze({ 9: "HDDDDHHHHH", 10: "DDDDDDDDHH", 11: "DDDDDDDDDH", 12: "HHSSSHHHHH", 13: "SSSSSHHHHH" });
  const SOFT = Object.freeze({ 13: "HHHDDHHHHH", 14: "HHHDDHHHHH", 15: "HHDDDHHHHH", 16: "HHDDDHHHHH", 17: "HDDDDHHHHH", 18: "SXXXXSSHHH" });
  const PAIRS = Object.freeze({
    A: "PPPPPPPPPP", 9: "PPPPPSPPSS", 8: "PPPPPPPPPP", 7: "PPPPPPHHHH",
    6: "PPPPPHHHHH", 4: "HHHPPHHHHH", 3: "PPPPPPHHHH", 2: "PPPPPPHHHH"
  });
  const upColumn = (up) => (up.rank === "A" ? 9 : cardValue(up) - 2);
  function hardCode(total, col) {
    if (total <= 8) return "H";
    if (total >= 17) return "S";
    return HARD[Math.min(total, 13)][col];
  }
  function softCode(total, col) {
    if (total <= 12) return "H";
    return total >= 19 ? "S" : SOFT[total][col];
  }
  /* The book move for these cards; options say whether doubling and splitting are allowed right now. */
  function strategy(cards, up, options = {}) {
    if (!Array.isArray(cards) || cards.length < 2 || !cards.every(isCard) || !isCard(up)) throw new Error("カードが正しくありません");
    const col = upColumn(up);
    const pair = PAIRS[cards[0].rank];
    if (options.split && cards.length === 2 && cards[0].rank === cards[1].rank && pair && pair[col] === "P") return "split";
    const v = handValue(cards);
    const code = v.soft ? softCode(v.total, col) : hardCode(v.total, col);
    if (code === "D") return options.double ? "double" : "hit";
    if (code === "X") return options.double ? "double" : "stand";
    return code === "H" ? "hit" : "stand";
  }
  /* Basic-strategy advice for the hand being played (always a legal action), or null. */
  function recommend(round) {
    const legal = legalActions(round);
    if (!legal.length) return null;
    return strategy(activeHand(round).cards, round.dealer[0], { double: legal.includes("double"), split: legal.includes("split") });
  }

  return {
    DECKS, PENETRATION, START_CHIPS, MIN_BET, MAX_BET, CHIP_VALUES, ACTIONS,
    isCard, cardValue, handValue, isBlackjack, isNatural, totalLabel, dealerShouldHit, canPeek,
    shoeFrom, newShoe, remaining, needsShuffle, draw,
    isBroke, maxBet, canAddChip, repeatBet, validBet, chipStack, normalizeBank,
    startRound, activeHand, staked, legalActions, act, dealerStep, playDealer, outcome, settle, roundNet,
    strategy, recommend
  };
})();

if (typeof module !== "undefined") module.exports = BlackjackRules;

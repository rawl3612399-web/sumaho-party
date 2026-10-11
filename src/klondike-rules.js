/* Klondike solitaire rules: seeded deal, stock/waste/foundation/tableau moves, undo history, tap targets,
 * hints and the auto finish. States are plain objects and never change; every action returns a new state.
 * Piles are named "stock", "waste", "f0".."f3" (one per suit, S H D C) and "t0".."t6". */
const KlondikeRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const C = typeof Cards !== "undefined" ? Cards : require("./cards.js");
  const DRAWS = Object.freeze([1, 3]);
  const COLS = 7;
  const SUITS = Object.freeze(C.SUITS.map(s => s.id));
  const KING = C.RANKS.length - 1;
  const RANK = new Map(C.RANKS.map((r, i) => [r, i]));
  const RED = new Map(C.SUITS.map(s => [s.id, s.red]));
  const TABLEAU = Object.freeze(Array.from({ length: COLS }, (_, i) => `t${i}`));
  const FOUNDATIONS = Object.freeze(SUITS.map((_, i) => `f${i}`));
  const DEALT = (COLS * (COLS + 1)) / 2;

  const rank = (card) => RANK.get(card.rank);
  const top = (list) => list[list.length - 1];
  const fail = (msg) => { throw new Error(msg); };
  const canStack = (card, onto) => rank(onto) === rank(card) + 1 && RED.get(onto.suit) !== RED.get(card.suit);
  const foundationOf = (card) => `f${SUITS.indexOf(card.suit)}`;
  const move = (from, to, count = 1) => ({ type: "move", from, to, count });
  const DRAW = Object.freeze({ type: "draw" });

  /* Small seeded generator (mulberry32), so the same number always gives the same deal. */
  function seeded(seed) {
    if (!Number.isInteger(seed)) fail("シードは整数で指定してください");
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- deal ---------- */
  /* Position in the deal of the card at (column, row): cards go out row by row, left to right. */
  function dealStep(col, row) {
    if (!Number.isInteger(col) || !Number.isInteger(row) || row < 0 || row > col || col >= COLS) fail("配る位置が正しくありません");
    return row * COLS - (row * (row - 1)) / 2 + (col - row);
  }
  function deal(draw = 1, r = Math.random) {
    if (!DRAWS.includes(draw)) fail("めくる枚数は1枚か3枚です");
    const deck = R.shuffle(C.newDeck(), r);
    const tableau = TABLEAU.map((_, col) => ({
      cards: Array.from({ length: col + 1 }, (_, row) => deck[dealStep(col, row)]),
      hidden: col
    }));
    return { draw, stock: deck.slice(DEALT), waste: [], foundations: SUITS.map(() => []), tableau, moves: 0, recycles: 0 };
  }

  /* ---------- piles ---------- */
  function pileOf(id) {
    if (id === "waste" || id === "stock") return { kind: id, index: 0 };
    const m = /^([tf])(\d)$/.exec(typeof id === "string" ? id : "");
    const index = m ? Number(m[2]) : -1;
    if (!m || index >= (m[1] === "t" ? COLS : SUITS.length)) fail("場所の指定が正しくありません");
    return { kind: m[1], index };
  }
  function cardsAt(state, id) {
    const p = pileOf(id);
    if (p.kind === "t") return state.tableau[p.index].cards;
    if (p.kind === "f") return state.foundations[p.index];
    return state[p.kind];
  }
  /* Replaces a pile. A column whose face-up cards are all gone turns its new top card face up. */
  function withPile(state, id, cards) {
    const p = pileOf(id);
    if (p.kind === "t") {
      const hidden = Math.min(state.tableau[p.index].hidden, Math.max(cards.length - 1, 0));
      return { ...state, tableau: state.tableau.map((c, i) => (i === p.index ? { cards, hidden } : c)) };
    }
    if (p.kind === "f") return { ...state, foundations: state.foundations.map((f, i) => (i === p.index ? cards : f)) };
    return { ...state, [p.kind]: cards };
  }
  const faceUp = (state, id) => {
    const p = pileOf(id);
    const cards = cardsAt(state, id);
    return p.kind === "t" ? cards.length - state.tableau[p.index].hidden : Math.min(cards.length, 1);
  };

  /* ---------- legality ---------- */
  function foundationError(state, run, index) {
    if (run.length !== 1) return "組札には1枚ずつ置きます";
    const ok = run[0].suit === SUITS[index] && rank(run[0]) === state.foundations[index].length;
    return ok ? null : "組札にはAから順に、同じマークを置きます";
  }
  function tableauError(state, run, index) {
    const onto = top(state.tableau[index].cards);
    if (!onto) return rank(run[0]) === KING ? null : "空いた列に置けるのはKだけです";
    return canStack(run[0], onto) ? null : "1つ小さい数字で、色ちがいのカードだけ重ねられます";
  }
  function moveError(state, action) {
    const { from, to, count } = action || {};
    let src;
    let dst;
    try {
      src = pileOf(from);
      dst = pileOf(to);
    } catch (e) {
      return e.message;
    }
    if (src.kind === "stock" || dst.kind === "stock" || dst.kind === "waste") return "そこには置けません";
    if (from === to) return "同じ場所です";
    if (!Number.isInteger(count) || count < 1) return "枚数が正しくありません";
    if (count > faceUp(state, from)) return "そのカードは動かせません";
    const pile = cardsAt(state, from);
    const run = pile.slice(pile.length - count);
    if (!run.every((c, i) => i === 0 || canStack(c, run[i - 1]))) return "そのカードは動かせません";
    return dst.kind === "f" ? foundationError(state, run, dst.index) : tableauError(state, run, dst.index);
  }
  const canDraw = (state) => state.stock.length + state.waste.length > 0;
  function actionError(state, action) {
    if (action && action.type === "draw") return canDraw(state) ? null : "山札はもうありません";
    if (action && action.type === "move") return moveError(state, action);
    return "操作が正しくありません";
  }

  /* ---------- actions ---------- */
  function applyMove(state, action) {
    const err = moveError(state, action);
    if (err) fail(err);
    const pile = cardsAt(state, action.from);
    const cut = pile.length - action.count;
    const lifted = withPile(state, action.from, pile.slice(0, cut));
    const placed = withPile(lifted, action.to, [...cardsAt(lifted, action.to), ...pile.slice(cut)]);
    return { ...placed, moves: state.moves + 1 };
  }
  /* Turns up 1 or 3 cards; with the stock empty, turns the whole waste back over (no limit on passes). */
  function draw(state) {
    if (!canDraw(state)) fail("山札はもうありません");
    const { stock, waste } = state;
    if (stock.length === 0) {
      return { ...state, stock: waste.slice().reverse(), waste: [], moves: state.moves + 1, recycles: state.recycles + 1 };
    }
    const n = Math.min(state.draw, stock.length);
    const turned = stock.slice(stock.length - n).reverse();
    return { ...state, stock: stock.slice(0, stock.length - n), waste: [...waste, ...turned], moves: state.moves + 1 };
  }
  function step(state, action) {
    const err = actionError(state, action);
    if (err) fail(err);
    return action.type === "draw" ? draw(state) : applyMove(state, action);
  }

  /* A game keeps every earlier state, so undo is unlimited and exact. */
  const newGame = (drawCount = 1, r = Math.random) => ({ state: deal(drawCount, r), history: [] });
  const play = (game, action) => ({ state: step(game.state, action), history: [...game.history, game.state] });
  const canUndo = (game) => game.history.length > 0;
  function undo(game) {
    if (!canUndo(game)) fail("もどせる手がありません");
    return { state: top(game.history), history: game.history.slice(0, -1) };
  }

  const isWon = (state) => state.foundations.every(f => f.length === C.RANKS.length);
  const allFaceUp = (state) => state.tableau.every(c => c.hidden === 0);

  /* ---------- tap to move ---------- */
  /* Moving a whole column that has nothing hidden into an empty column changes nothing. */
  function isPointless(state, from, count, to) {
    const p = pileOf(from);
    const col = p.kind === "t" ? state.tableau[p.index] : null;
    return Boolean(col) && col.hidden === 0 && count === col.cards.length && to[0] === "t" && cardsAt(state, to).length === 0;
  }
  /* Where a tap sends these cards, best first: home (single cards), then columns to the right, then one empty column. */
  function targets(state, from, count) {
    const src = pileOf(from);
    const pile = cardsAt(state, from);
    if (!pile.length) return [];
    const legal = (to) => !moveError(state, move(from, to, count)) && !isPointless(state, from, count, to);
    const home = count === 1 && src.kind !== "f" ? [foundationOf(top(pile))].filter(legal) : [];
    const start = src.kind === "t" ? src.index + 1 : 0;
    const cols = TABLEAU.map((_, k) => TABLEAU[(start + k) % COLS]).filter(legal);
    const filled = cols.filter(t => cardsAt(state, t).length > 0);
    const empty = cols.filter(t => cardsAt(state, t).length === 0).slice(0, 1);
    return [...home, ...filled, ...empty];
  }

  /* Whether `lead` may land on `to`: a cheap check on the lead card only (moveError does the full check). */
  function fits(state, lead, to) {
    if (to[0] === "f") return foundationOf(lead) === to && rank(lead) === state.foundations[Number(to[1])].length;
    const onto = top(cardsAt(state, to));
    return onto ? canStack(lead, onto) : rank(lead) === KING;
  }
  /* Every legal action, including pulling a card back down from the foundations. */
  function legalActions(state) {
    const sources = ["waste", ...FOUNDATIONS, ...TABLEAU].filter(id => faceUp(state, id) > 0);
    const moves = sources.flatMap(from => {
      const pile = cardsAt(state, from);
      return Array.from({ length: faceUp(state, from) }, (_, k) => k + 1).flatMap(count => {
        const lead = pile[pile.length - count];
        const homes = count === 1 && from[0] !== "f" ? [foundationOf(lead)] : [];
        return [...homes, ...TABLEAU].filter(to => to !== from && fits(state, lead, to)).map(to => move(from, to, count));
      });
    }).filter(a => !moveError(state, a));
    return canDraw(state) ? [...moves, DRAW] : moves;
  }

  /* ---------- hints ---------- */
  const isHome = (a) => a.to[0] === "f";
  const topRank = (state, a) => rank(top(cardsAt(state, a.from)));
  const hiddenUnder = (state, a) => (a.from[0] === "t" ? state.tableau[pileOf(a.from).index].hidden : 0);
  /* Moves the whole face-up part of a column that still hides cards: a new card turns up. */
  const reveals = (state, a) => a.from[0] === "t" && hiddenUnder(state, a) > 0 && a.count === faceUp(state, a.from);
  /* Moves part of a run so that the card left on top can go home. */
  function freesHome(state, a) {
    if (a.from[0] !== "t" || isHome(a) || a.count >= faceUp(state, a.from)) return false;
    const pile = cardsAt(state, a.from);
    const left = pile[pile.length - a.count - 1];
    return rank(left) === state.foundations[SUITS.indexOf(left.suit)].length;
  }
  /* Empties a column while a K (on the waste, or heading a column with hidden cards) is waiting for it. */
  function makesRoom(state, a) {
    if (a.from[0] !== "t" || isHome(a) || hiddenUnder(state, a) > 0 || a.count !== faceUp(state, a.from)) return false;
    if (rank(cardsAt(state, a.from)[0]) === KING) return false;
    const waiting = state.tableau.some(c => c.hidden > 0 && rank(c.cards[c.hidden]) === KING);
    return waiting || (state.waste.length > 0 && rank(top(state.waste)) === KING);
  }
  /* True when turning the stock over (without other moves) brings up a card that can be played. */
  function drawHelps(state) {
    const total = state.stock.length + state.waste.length;
    let s = state;
    for (let i = 0; i < 2 * total + 2 && total > 0; i++) {
      s = draw(s);
      if (s.waste.length && targets(s, "waste", 1).length) return true;
    }
    return false;
  }
  const best = (list, score) => list.reduce((a, b) => (score(b) > score(a) ? b : a));
  /* A useful next action, or null when nothing helps any more. Every suggestion makes progress, so following
   * hints never loops: cards go home, hidden cards turn up, or the stock gets smaller. */
  function hint(state) {
    const moves = legalActions(state).filter(a => a.type === "move" && a.from[0] !== "f" && !isPointless(state, a.from, a.count, a.to));
    const steps = [
      [(a) => isHome(a) && topRank(state, a) <= 1, () => 0],
      [(a) => !isHome(a) && reveals(state, a), (a) => hiddenUnder(state, a)],
      [(a) => isHome(a) && a.from !== "waste", (a) => -topRank(state, a)],
      [(a) => isHome(a), () => 0],
      [(a) => a.from === "waste", (a) => cardsAt(state, a.to).length],
      [(a) => freesHome(state, a), () => 0],
      [(a) => makesRoom(state, a), () => 0]
    ];
    for (const [keep, score] of steps) {
      const hits = moves.filter(keep);
      if (hits.length) return best(hits, score);
    }
    return drawHelps(state) ? DRAW : null;
  }

  /* ---------- auto finish ---------- */
  function homeMoves(state) {
    return ["waste", ...TABLEAU].filter(id => cardsAt(state, id).length > 0)
      .map(from => move(from, foundationOf(top(cardsAt(state, from)))))
      .filter(a => !moveError(state, a));
  }
  /* Sends cards home, lowest first, turning the stock when nothing is ready: { plan, state }. When a whole pass of
   * the stock sends nothing home, it stops at the last card that went home (the turns after it only went round). */
  function sendHome(state) {
    let s = state;
    let plan = [];
    let kept = { plan, state };
    let idle = 0;
    while (!isWon(s)) {
      const ready = homeMoves(s);
      const left = s.stock.length + s.waste.length;
      if (!ready.length && (left === 0 || idle > 2 * left + 2)) return kept;
      const next = ready.length ? best(ready, (a) => -rank(top(cardsAt(s, a.from)))) : DRAW;
      idle = ready.length ? 0 : idle + 1;
      s = step(s, next);
      plan = [...plan, next];
      if (ready.length) kept = { plan, state: s };
    }
    return { plan, state: s };
  }
  /* A finder for a tableau spot for a card, pulling cards back down from the foundations when that opens one
   * (a red Q comes down onto a black K so a black J can go on it, and so on). The finder gives
   * { plan, state, to } or null, and gives up after `budget` lookups so it always stays quick. */
  function roomFinder(budget) {
    let left = budget;
    const pullsFor = (state, card, i) => {
      let way = { plan: [], state, to: null };
      for (let k = state.foundations[i].length - 1; way && k > rank(card); k--) {
        const sub = find(way.state, top(way.state.foundations[i]));
        const pull = sub && move(`f${i}`, sub.to);
        way = sub && { plan: [...way.plan, ...sub.plan, pull], state: step(sub.state, pull), to: sub.to };
      }
      return way && way.to ? way : null;
    };
    function find(state, card) {
      left -= 1;
      if (left < 0) return null;
      const to = TABLEAU.find(t => fits(state, card, t));
      if (to) return { plan: [], state, to };
      if (rank(card) === KING) return null;
      const parents = SUITS.map((_, i) => i).filter(i => RED.get(SUITS[i]) !== RED.get(card.suit));
      return parents.reduce((found, i) => found || pullsFor(state, card, i), null);
    }
    return find;
  }
  /* Goes once round the stock looking for a card that can be laid on the tableau (with help from the foundations).
   * In 3-card mode that changes which cards come up, so a stock that was stuck in a loop moves again. */
  function unstick(state) {
    const total = state.stock.length + state.waste.length;
    const room = roomFinder(400);
    let s = state;
    let draws = [];
    for (let i = 0; i <= 2 * total + 2 && total > 0; i++) {
      const spot = s.waste.length ? room(s, top(s.waste)) : null;
      if (spot) {
        const lay = move("waste", spot.to);
        return { plan: [...draws, ...spot.plan, lay], state: step(spot.state, lay) };
      }
      s = draw(s);
      draws = [...draws, DRAW];
    }
    return null;
  }
  /* With every card face up: the list of actions that sends all cards home (lowest first), or null if it cannot.
   * When the stock goes round without helping, a card from it is laid on the tableau first. */
  function finishPlan(state) {
    if (!allFaceUp(state) || isWon(state)) return null;
    const rounds = state.stock.length + state.waste.length; /* every rescue takes one card out of the stock for good */
    let s = state;
    let plan = [];
    for (let round = 0; round <= rounds; round++) {
      const home = sendHome(s);
      plan = [...plan, ...home.plan];
      if (isWon(home.state)) return plan;
      const way = unstick(home.state);
      if (!way) return null;
      plan = [...plan, ...way.plan];
      s = way.state;
    }
    return null;
  }
  const canFinish = (state) => finishPlan(state) !== null;

  /* ---------- saved games ---------- */
  const isCard = (c) => Boolean(c) && typeof c === "object" && SUITS.includes(c.suit) && RANK.has(c.rank) && c.id === `${c.suit}${c.rank}-0`;
  const cleanCard = (c) => ({ suit: c.suit, rank: c.rank, id: c.id });
  function validColumn(col) {
    if (!col || !Array.isArray(col.cards) || !col.cards.every(isCard) || !Number.isInteger(col.hidden)) return false;
    const n = col.cards.length;
    if (col.hidden < 0 || (n === 0 ? col.hidden !== 0 : col.hidden >= n)) return false;
    const up = col.cards.slice(col.hidden);
    return up.every((c, i) => i === 0 || canStack(c, up[i - 1]));
  }
  function validShape(s) {
    const counts = [s.moves, s.recycles].every(n => Number.isInteger(n) && n >= 0);
    const lists = [s.stock, s.waste, ...(Array.isArray(s.foundations) ? s.foundations : [])];
    return counts && DRAWS.includes(s.draw) && Array.isArray(s.foundations) && s.foundations.length === SUITS.length
      && Array.isArray(s.tableau) && s.tableau.length === COLS && s.tableau.every(validColumn)
      && lists.every(l => Array.isArray(l) && l.every(isCard));
  }
  /* Checks a state loaded from storage and returns a clean copy, or null if anything is off. */
  function restore(raw) {
    if (!raw || typeof raw !== "object" || !validShape(raw)) return null;
    const all = [...raw.stock, ...raw.waste, ...raw.foundations.flat(), ...raw.tableau.flatMap(c => c.cards)];
    if (all.length !== SUITS.length * C.RANKS.length || new Set(all.map(c => c.id)).size !== all.length) return null;
    if (!raw.foundations.every((f, i) => f.every((c, k) => c.suit === SUITS[i] && rank(c) === k))) return null;
    return {
      draw: raw.draw,
      stock: raw.stock.map(cleanCard),
      waste: raw.waste.map(cleanCard),
      foundations: raw.foundations.map(f => f.map(cleanCard)),
      tableau: raw.tableau.map(c => ({ cards: c.cards.map(cleanCard), hidden: c.hidden })),
      moves: raw.moves,
      recycles: raw.recycles
    };
  }

  /* ---------- records ---------- */
  /* Wins, best time (seconds) and fewest moves per draw mode, checked when loaded from storage. */
  function readRecord(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const pos = (n) => (Number.isInteger(n) && n > 0 ? n : null);
    return Object.fromEntries(DRAWS.map(d => {
      const r = src[d] && typeof src[d] === "object" ? src[d] : {};
      return [d, { wins: Number.isInteger(r.wins) && r.wins >= 0 ? r.wins : 0, time: pos(r.time), moves: pos(r.moves) }];
    }));
  }
  /* Adds a win. `best` is true when it beats an earlier time or move count (never on the first win). */
  function addWin(raw, drawCount, time, moves) {
    if (!DRAWS.includes(drawCount) || !Number.isInteger(time) || time < 1 || !Number.isInteger(moves) || moves < 1) fail("記録が正しくありません");
    const record = readRecord(raw);
    const old = record[drawCount];
    const low = (a, b) => (b === null ? a : Math.min(a, b));
    const best = old.wins > 0 && ((old.time !== null && time < old.time) || (old.moves !== null && moves < old.moves));
    return { record: { ...record, [drawCount]: { wins: old.wins + 1, time: low(time, old.time), moves: low(moves, old.moves) } }, best };
  }

  return {
    DRAWS, COLS, SUITS, TABLEAU, FOUNDATIONS, DRAW, seeded, dealStep, deal, newGame, pileOf, cardsAt, rank, foundationOf,
    moveError, actionError, canDraw, step, play, undo, canUndo, isWon, allFaceUp, isPointless, targets, legalActions,
    hint, finishPlan, canFinish, restore, readRecord, addWin
  };
})();

if (typeof module !== "undefined") module.exports = KlondikeRules;

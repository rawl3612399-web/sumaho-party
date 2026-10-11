/* 七並べ rules: 4 players, 13 cards each. The four 7s start on the board and the holder of the 7 of diamonds goes first.
 * On your turn play one card next to a placed card of the same suit, or pass. Three passes are allowed; the fourth
 * knocks you out and your whole hand is placed on the board. Empty your hand first to win. Option: tunnel (A and K join). */
const SevensRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const C = typeof Cards !== "undefined" ? Cards : require("./cards.js");

  const PLAYERS = 4;
  const HAND = 13;
  const RANKS = 13;
  const TOTAL = 52;
  const SEVEN = 6;
  const MAX_PASSES = 3;
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);
  const SUIT_IDS = Object.freeze(C.SUITS.map(s => s.id));
  const DECK = Object.freeze(C.newDeck().map(c => Object.freeze(c))); /* index = key = suit * 13 + rank */
  const SEVENS = Object.freeze(SUIT_IDS.map((_, s) => s * RANKS + SEVEN));
  const START_KEY = SUIT_IDS.indexOf("D") * RANKS + SEVEN;
  const PASS = Object.freeze({ type: "pass" });
  const BOARD = -1;
  const UNSEEN = 9;
  const SEARCH = Object.freeze({ playouts: 900, minSamples: 8, maxSamples: 150, ms: 35 });
  /* Move scoring. next: the card it opens is mine. gift: it opens a card for someone else. own: my cards further out.
   * block: penalty for giving up a pure blocker. free: a card that opens nothing. passLine / reserve: when to pass. */
  const WEIGHTS = Object.freeze({
    normal: Object.freeze({ next: 3, gift: 2, giftPer: 0, own: 1.2, block: 1, blockPer: 0, free: 2, passLine: -2.5, reserve: 2 }),
    hard: Object.freeze({ next: 3.5, gift: 1.5, giftPer: 0.5, own: 1.5, block: 0, blockPer: 0.9, free: 2.5, passLine: -3, reserve: 1 })
  });

  /* STEP[t][d][k]: next key from k toward the lower (d=0) or higher (d=1) rank of the same suit; -1 at the end. t=1: tunnel. */
  const STEP = [false, true].map(tunnel => [-1, 1].map(d => Int8Array.from({ length: TOTAL }, (_, k) => {
    const s = Math.floor(k / RANKS);
    const r = (k % RANKS) + d;
    if (r >= 0 && r < RANKS) return s * RANKS + r;
    return tunnel ? s * RANKS + ((r + RANKS) % RANKS) : -1;
  })));

  /* ---------- cards ---------- */
  function keyOf(card) {
    if (Number.isInteger(card) && card >= 0 && card < TOTAL) return card;
    const s = card && typeof card === "object" ? SUIT_IDS.indexOf(card.suit) : -1;
    const r = s >= 0 ? C.RANKS.indexOf(card.rank) : -1;
    if (r < 0) throw new Error("カードが正しくありません");
    return s * RANKS + r;
  }
  const cardOf = (card) => DECK[keyOf(card)];
  const slotOf = (card) => {
    const k = keyOf(card);
    return { row: Math.floor(k / RANKS), col: k % RANKS };
  };
  const label = (card) => C.label(cardOf(card));
  const sortKeys = (keys) => [...keys].sort((a, b) => a - b);
  const replaceAt = (list, i, value) => list.map((v, j) => (j === i ? value : v));

  /* ---------- state checks ---------- */
  function check(state) {
    const ok = state && Array.isArray(state.board) && state.board.length === TOTAL && Array.isArray(state.hands)
      && state.hands.length === PLAYERS && Array.isArray(state.passes) && Array.isArray(state.done) && Array.isArray(state.outs);
    if (!ok) throw new Error("ゲームの状態が正しくありません");
  }
  function checkLive(state) {
    check(state);
    if (state.over) throw new Error("ゲームはもう終わっています");
  }
  const isActive = (state, seat) => !state.done.includes(seat) && !state.outs.includes(seat);
  const activeSeats = (state) => [0, 1, 2, 3].filter(seat => isActive(state, seat));
  const passesLeft = (state, seat) => Math.max(0, MAX_PASSES - state.passes[seat]);

  /* ---------- adjacency ---------- */
  function isPlayable(board, card, tunnel = false) {
    const k = keyOf(card);
    if (board[k]) return false;
    const t = tunnel ? 1 : 0;
    const lo = STEP[t][0][k];
    const hi = STEP[t][1][k];
    return (lo >= 0 && Boolean(board[lo])) || (hi >= 0 && Boolean(board[hi]));
  }
  function legalKeys(state, seat = state.turn) {
    check(state);
    if (!Number.isInteger(seat) || seat < 0 || seat >= PLAYERS) return [];
    return state.hands[seat].filter(k => isPlayable(state.board, k, state.tunnel));
  }
  /* Every unplaced card that could be played right now, whoever holds it. */
  function openKeys(state) {
    check(state);
    return DECK.map((_, k) => k).filter(k => isPlayable(state.board, k, state.tunnel));
  }

  /* ---------- setup ---------- */
  function checkDeal(hands) {
    if (!Array.isArray(hands) || hands.length !== PLAYERS) throw new Error("手札は4人分必要です");
    const keys = hands.map(h => {
      if (!Array.isArray(h)) throw new Error("手札が正しくありません");
      return h.map(keyOf);
    });
    if (new Set(keys.flat()).size !== keys.flat().length) throw new Error("同じカードが2枚あります");
    return keys;
  }
  /* A full deal of 13 cards each: the 7s go to the board, the holder of the 7 of diamonds starts. */
  function fromHands(hands, opts = {}) {
    if (opts === null || typeof opts !== "object") throw new Error("設定が正しくありません");
    const keys = checkDeal(hands);
    if (keys.some(h => h.length !== HAND)) throw new Error("手札は13枚ずつ配ります");
    const board = Array.from({ length: TOTAL }, (_, k) => SEVENS.includes(k));
    const starter = keys.findIndex(h => h.includes(START_KEY));
    return {
      tunnel: opts.tunnel === true,
      hands: keys.map(h => sortKeys(h.filter(k => !SEVENS.includes(k)))),
      board, passes: [0, 0, 0, 0], done: [], outs: [],
      turn: starter, starter, over: false, last: null, moves: 0
    };
  }
  function newGame(opts = {}, r = Math.random) {
    if (opts === null || typeof opts !== "object") throw new Error("設定が正しくありません");
    const deck = R.shuffle(DECK.map((_, k) => k), r);
    return fromHands(Array.from({ length: PLAYERS }, (_, i) => deck.slice(i * HAND, (i + 1) * HAND)), opts);
  }
  /* Any reachable position (for tests and tools): hands + cards on the board make one full deck. */
  function position(p) {
    if (!p || typeof p !== "object") throw new Error("局面が正しくありません");
    const hands = checkDeal(p.hands);
    const placed = (p.board || []).map(keyOf);
    const all = [...hands.flat(), ...placed];
    if (all.length !== TOTAL || new Set(all).size !== TOTAL) throw new Error("カードがそろっていません");
    if (!SEVENS.every(k => placed.includes(k))) throw new Error("7は場に出ている必要があります");
    const list = (v, fallback) => {
      if (v !== undefined && !Array.isArray(v)) throw new Error("局面が正しくありません");
      return v || fallback;
    };
    const passes = list(p.passes, [0, 0, 0, 0]);
    const done = list(p.done, []);
    const outs = list(p.outs, []);
    const turn = p.turn ?? 0;
    const seats = [...done, ...outs, turn];
    if (seats.some(seat => !Number.isInteger(seat) || seat < 0 || seat >= PLAYERS) || new Set(seats.slice(0, -1)).size !== seats.length - 1) {
      throw new Error("上がった人の席が正しくありません");
    }
    if (passes.length !== PLAYERS || passes.some(n => !Number.isInteger(n) || n < 0 || n > MAX_PASSES + 1)) throw new Error("パスの回数が正しくありません");
    if ([...done, ...outs].some(seat => hands[seat]?.length !== 0)) throw new Error("上がった人の手札は空です");
    const base = { tunnel: p.tunnel === true, hands: hands.map(sortKeys), board: DECK.map((_, k) => placed.includes(k)),
      passes: [...passes], done: [...done], outs: [...outs], turn, starter: turn, over: false, last: null, moves: 0 };
    if (activeSeats(base).length <= 1) return { ...base, over: true, turn: -1 };
    if (!isActive(base, base.turn)) throw new Error("手番の人が正しくありません");
    return base;
  }

  /* ---------- moves ---------- */
  function advance(state, from) {
    const active = activeSeats(state);
    if (active.length <= 1) return { ...state, over: true, turn: -1 };
    let t = from;
    do { t = (t + 1) % PLAYERS; } while (!active.includes(t));
    return { ...state, turn: t };
  }
  function play(state, card) {
    checkLive(state);
    const k = keyOf(card);
    const seat = state.turn;
    if (!state.hands[seat].includes(k)) throw new Error("そのカードは手札にありません");
    if (!isPlayable(state.board, k, state.tunnel)) throw new Error("そのカードはまだ出せません");
    const hand = state.hands[seat].filter(x => x !== k);
    const finished = hand.length === 0;
    return advance({
      ...state,
      hands: replaceAt(state.hands, seat, hand),
      board: replaceAt(state.board, k, true),
      done: finished ? [...state.done, seat] : state.done,
      last: { seat, kind: "play", key: k, placed: [k], finished },
      moves: state.moves + 1
    }, seat);
  }
  /* A pass. The fourth one knocks the player out and puts their whole hand on the board. */
  function pass(state) {
    checkLive(state);
    const seat = state.turn;
    const used = state.passes[seat] + 1;
    const passes = replaceAt(state.passes, seat, used);
    if (used <= MAX_PASSES) {
      return advance({ ...state, passes, last: { seat, kind: "pass", key: -1, placed: [], finished: false }, moves: state.moves + 1 }, seat);
    }
    const placed = state.hands[seat];
    return advance({
      ...state,
      passes,
      hands: replaceAt(state.hands, seat, []),
      board: state.board.map((on, k) => on || placed.includes(k)),
      outs: [...state.outs, seat],
      last: { seat, kind: "out", key: -1, placed, finished: false },
      moves: state.moves + 1
    }, seat);
  }
  /* Finishers in order, then whoever is left, then the knocked-out players (the first one out is last). */
  function ranking(state) {
    check(state);
    const order = [
      ...state.done.map(seat => ({ seat, how: "done" })),
      ...activeSeats(state).map(seat => ({ seat, how: state.over ? "last" : "play" })),
      ...[...state.outs].reverse().map(seat => ({ seat, how: "out" }))
    ];
    return order.map((o, i) => ({ ...o, place: i + 1 }));
  }

  /* ---------- CPU: an owner view has 52 entries of BOARD, a seat number, or UNSEEN ---------- */
  /* How good it is for `me` to play k now. Looks outward from k in each open direction until the run meets the board
   * or the end of the suit (the tunnel only counts for the first step, so a long tail is not counted twice). */
  function scoreMove(owner, me, k, t, w) {
    let s = 0;
    let open = 0;
    for (let d = 0; d < 2; d++) {
      const n = STEP[t][d][k];
      if (n < 0 || owner[n] === BOARD) continue;
      const step = STEP[0][d];
      open++;
      let own = 0;
      let other = 0;
      for (let x = n; x >= 0 && owner[x] !== BOARD; x = step[x]) {
        if (owner[x] === me) own++;
        else other++;
      }
      s += owner[n] === me ? w.next : -(w.gift + w.giftPer * other);
      s += w.own * own;
      if (own === 0) s -= w.block + w.blockPer * other;
    }
    return open ? s : w.free;
  }
  /* True when every card in list[base, base + n) could be played by its owner alone, one after another. */
  function selfClear(owner, list, base, n, t) {
    const lo = STEP[t][0];
    const hi = STEP[t][1];
    const mine = new Uint8Array(TOTAL);
    let left = n;
    for (let progress = true; progress && left > 0;) {
      progress = false;
      for (let i = 0; i < n; i++) {
        const k = list[base + i];
        const a = lo[k];
        const b = hi[k];
        if (mine[k] || !((a >= 0 && (owner[a] === BOARD || mine[a])) || (b >= 0 && (owner[b] === BOARD || mine[b])))) continue;
        mine[k] = 1;
        left--;
        progress = true;
      }
    }
    return left === 0;
  }
  /* Index in list[base, base + n) of the best card for `me`, or -1 to pass: only to hold blockers while passes last,
   * never when the hand can be played out without help, and never with the tunnel (a blocker can be bypassed there). */
  function pickIndex(owner, list, base, n, me, used, t, w, noise, r) {
    const lo = STEP[t][0];
    const hi = STEP[t][1];
    let best = -Infinity;
    let bestI = -1;
    for (let i = 0; i < n; i++) {
      const k = list[base + i];
      const a = lo[k];
      const b = hi[k];
      if (!((a >= 0 && owner[a] === BOARD) || (b >= 0 && owner[b] === BOARD))) continue;
      const s = scoreMove(owner, me, k, t, w) + (noise ? r() * noise : 0);
      if (s > best) {
        best = s;
        bestI = i;
      }
    }
    if (t === 0 && bestI >= 0 && best < w.passLine && MAX_PASSES - used >= w.reserve && !selfClear(owner, list, base, n, t)) return -1;
    return bestI;
  }
  function viewOf(state, me) {
    const v = new Int8Array(TOTAL).fill(UNSEEN);
    state.board.forEach((on, k) => { if (on) v[k] = BOARD; });
    state.hands[me].forEach(k => { v[k] = me; });
    return v;
  }

  /* ---------- playouts for the strong CPU (scratch typed arrays, local to one decision) ---------- */
  function newSim() {
    return { owner: new Int8Array(TOTAL), hand: new Int8Array(PLAYERS * HAND), count: new Int8Array(PLAYERS),
      passes: new Int8Array(PLAYERS), status: new Int8Array(PLAYERS), place: new Int8Array(PLAYERS), turn: 0, active: 0, doneN: 0, outN: 0 };
  }
  function copySim(to, from) {
    ["owner", "hand", "count", "passes", "status", "place"].forEach(f => to[f].set(from[f]));
    to.turn = from.turn;
    to.active = from.active;
    to.doneN = from.doneN;
    to.outN = from.outN;
    return to;
  }
  /* The real position, with the cards `me` cannot see dealt at random to the others (hand sizes kept). */
  function guessWorld(state, me, r, sim) {
    const view = viewOf(state, me);
    const unseen = R.shuffle(DECK.map((_, k) => k).filter(k => view[k] === UNSEEN), r);
    let u = 0;
    sim.owner.set(view);
    state.hands.forEach((h, p) => {
      h.forEach((k, i) => {
        const key = p === me ? k : unseen[u++];
        sim.owner[key] = p;
        sim.hand[p * HAND + i] = key;
      });
      sim.count[p] = h.length;
      sim.passes[p] = state.passes[p];
      sim.status[p] = state.done.includes(p) ? 1 : state.outs.includes(p) ? 2 : 0;
      sim.place[p] = sim.status[p] === 1 ? state.done.indexOf(p) + 1 : sim.status[p] === 2 ? PLAYERS - state.outs.indexOf(p) : 0;
    });
    sim.turn = state.turn;
    sim.doneN = state.done.length;
    sim.outN = state.outs.length;
    sim.active = PLAYERS - sim.doneN - sim.outN;
    return sim;
  }
  function simLeave(sim, p, finished) {
    sim.status[p] = finished ? 1 : 2;
    sim.place[p] = finished ? ++sim.doneN : PLAYERS - sim.outN++;
    sim.active--;
    if (sim.active !== 1) return;
    const last = sim.status.indexOf(0);
    sim.status[last] = 1;
    sim.place[last] = ++sim.doneN;
    sim.active = 0;
  }
  /* i: index of the card in p's hand list, or -1 for a pass. */
  function simAct(sim, p, i) {
    const base = p * HAND;
    if (i >= 0) {
      const last = --sim.count[p];
      sim.owner[sim.hand[base + i]] = BOARD;
      sim.hand[base + i] = sim.hand[base + last];
      if (last === 0) simLeave(sim, p, true);
    } else if (++sim.passes[p] > MAX_PASSES) {
      for (let j = 0; j < sim.count[p]; j++) sim.owner[sim.hand[base + j]] = BOARD;
      sim.count[p] = 0;
      simLeave(sim, p, false);
    }
    if (sim.active <= 1) return;
    let t = p;
    do { t = (t + 1) % PLAYERS; } while (sim.status[t] !== 0);
    sim.turn = t;
  }
  /* Plays on with the ふつう policy for everyone until the place of `me` is settled. */
  function rollout(sim, me, first, t) {
    simAct(sim, me, first);
    for (let guard = 0; sim.active > 1 && sim.status[me] === 0 && guard < 200; guard++) {
      const p = sim.turn;
      simAct(sim, p, pickIndex(sim.owner, sim.hand, p * HAND, sim.count[p], p, sim.passes[p], t, WEIGHTS.normal, 0, null));
    }
    return sim.place[me] || sim.doneN + 1;
  }
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  /* つよい: tries every card (and a pass) against many guesses of the hidden hands and keeps the best average place. */
  function hardMove(state, legal, r, opts) {
    const me = state.turn;
    const t = state.tunnel ? 1 : 0;
    const cands = passesLeft(state, me) > 0 ? [...legal, -1] : legal;
    if (cands.length === 1) return cands[0];
    const index = cands.map(k => (k < 0 ? -1 : state.hands[me].indexOf(k)));
    const budget = Number.isInteger(opts.playouts) && opts.playouts > 0 ? opts.playouts : SEARCH.playouts;
    const samples = Math.max(SEARCH.minSamples, Math.min(SEARCH.maxSamples, Math.floor(budget / cands.length)));
    const limit = typeof opts.ms === "number" && opts.ms > 0 ? opts.ms : SEARCH.ms;
    const world = newSim();
    const scratch = newSim();
    const totals = cands.map(() => 0);
    const t0 = clock();
    for (let n = 0; n < samples; n++) {
      if (n >= SEARCH.minSamples && clock() - t0 > limit) break;
      guessWorld(state, me, r, world);
      index.forEach((i, j) => { totals[j] += rollout(copySim(scratch, world), me, i, t); });
    }
    const view = viewOf(state, me);
    const tie = (k) => (k < 0 ? -1e9 : scoreMove(view, me, k, t, WEIGHTS.hard)); /* on equal places, a card beats a pass */
    const ranked = cands.map((k, j) => ({ k, total: totals[j], tie: tie(k) })).sort((a, b) => a.total - b.total || b.tie - a.tie);
    return ranked[0].k;
  }

  /* Pure: the CPU's move for the player to move. { type: "play", key, card } or { type: "pass" }. */
  function cpuMove(state, level = "normal", r = Math.random, opts = {}) {
    checkLive(state);
    if (!LEVELS.includes(level)) throw new Error("強さが正しくありません");
    const me = state.turn;
    const legal = legalKeys(state, me);
    if (!legal.length) return PASS;
    const t = state.tunnel ? 1 : 0;
    let k;
    if (level === "easy") k = R.pick(legal, r);
    else if (level === "normal") {
      const hand = Int8Array.from(state.hands[me]);
      const i = pickIndex(viewOf(state, me), hand, 0, hand.length, me, state.passes[me], t, WEIGHTS.normal, 0.4, r);
      k = i < 0 ? -1 : hand[i];
    }
    else k = hardMove(state, legal, r, opts || {});
    return k < 0 ? PASS : { type: "play", key: k, card: DECK[k] };
  }

  return {
    PLAYERS, HAND, RANKS, MAX_PASSES, LEVELS, SEVENS, START_KEY, DECK, SEARCH,
    keyOf, cardOf, slotOf, label, isPlayable, legalKeys, openKeys, isActive, activeSeats, passesLeft,
    newGame, fromHands, position, play, pass, ranking, cpuMove
  };
})();

if (typeof module !== "undefined") module.exports = SevensRules;

/* Concentration (神経衰弱): all cards face down; flip two a turn. Same rank and same color (black: spade+club,
 * red: heart+diamond) is a pair: keep it, score 1 and go again. Otherwise the turn passes. Most pairs wins.
 * The CPU only knows cards it has seen face up, and remembers each one with a level-based chance. */
const MemoryRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const C = typeof Cards !== "undefined" ? Cards : require("./cards.js");

  const PAIR_COUNTS = Object.freeze([8, 12, 16]);
  const PLAYERS = Object.freeze({ min: 1, max: 4 });
  const LEVELS = Object.freeze(["easy", "normal", "hard"]);
  const RECALL = Object.freeze({ easy: 0.35, normal: 0.65, hard: 0.95 });
  const SUITS_BY_COLOR = Object.freeze({ black: Object.freeze(["S", "C"]), red: Object.freeze(["H", "D"]) });
  const NONE = -1;
  const MAX_RECORD_MS = 24 * 60 * 60 * 1000;
  const MAX_RECORD_TRIES = 9999;

  const colorOf = (suit) => (suit === "H" || suit === "D" ? "red" : "black");
  const pairKey = (card) => `${card.rank}-${colorOf(card.suit)}`;
  const isMatch = (a, b) => Boolean(a && b) && a.id !== b.id && pairKey(a) === pairKey(b);
  const other = (color) => (color === "black" ? "red" : "black");

  /* ---------- dealing ---------- */
  /* Every rank once (random color) before any rank is used again in its other color. */
  function pickPairs(pairs, r) {
    const ranks = R.shuffle(C.RANKS, r);
    const firstColor = ranks.map(() => (r() < 0.5 ? "black" : "red"));
    return Array.from({ length: pairs }, (_, i) => {
      const k = i % ranks.length;
      return { rank: ranks[k], color: i < ranks.length ? firstColor[k] : other(firstColor[k]) };
    });
  }
  function deal(pairs, r = Math.random) {
    if (!PAIR_COUNTS.includes(pairs)) throw new Error("ペアの数は8・12・16組から選んでください");
    const cards = pickPairs(pairs, r).flatMap(({ rank, color }) =>
      SUITS_BY_COLOR[color].map(suit => ({ suit, rank, id: `${suit}${rank}` })));
    return R.shuffle(cards, r).map(c => ({ ...c, key: pairKey(c) }));
  }

  /* options: { pairs, players = 1, first = 0 } */
  function newGame(options = {}, r = Math.random) {
    const { pairs, players = 1, first = 0 } = options;
    if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) {
      throw new Error(`人数は${PLAYERS.min}〜${PLAYERS.max}人です`);
    }
    if (!Number.isInteger(first) || first < 0 || first >= players) throw new Error("先にめくる人が正しくありません");
    const cards = deal(pairs, r);
    return {
      pairs, players, cards,
      owner: cards.map(() => NONE),
      open: [],
      turn: first,
      scores: Array.from({ length: players }, () => 0),
      tries: 0,
      chain: 0,
      last: null,
      over: false
    };
  }

  /* ---------- playing ---------- */
  function flipError(s, i) {
    if (s.over) return "もう終わっています";
    if (s.open.length >= 2) return "2枚めくったら、結果を待ってね";
    if (!Number.isInteger(i) || i < 0 || i >= s.cards.length) return "そのカードはありません";
    if (s.owner[i] !== NONE) return "そのカードはもう取られています";
    if (s.open.includes(i)) return "そのカードはもうめくっています";
    return null;
  }
  const canFlip = (s, i) => flipError(s, i) === null;

  function flip(s, i) {
    const err = flipError(s, i);
    if (err) throw new Error(err);
    return { ...s, open: [...s.open, i] };
  }

  /* "match" or "miss" once two cards are face up, otherwise null. */
  function pending(s) {
    if (s.open.length < 2) return null;
    return isMatch(s.cards[s.open[0]], s.cards[s.open[1]]) ? "match" : "miss";
  }

  /* Settles the two face-up cards: a match is kept and the same player goes again; a miss passes the turn. */
  function resolve(s) {
    const outcome = pending(s);
    if (!outcome) throw new Error("2枚めくってから判定します");
    const [a, b] = s.open;
    const base = { ...s, open: [], tries: s.tries + 1, last: { a, b, match: outcome === "match", by: s.turn } };
    if (outcome === "miss") return { ...base, turn: (s.turn + 1) % s.players, chain: 0 };
    const owner = s.owner.map((o, k) => (k === a || k === b ? s.turn : o));
    const scores = s.scores.map((v, k) => (k === s.turn ? v + 1 : v));
    return { ...base, owner, scores, chain: s.chain + 1, over: owner.every(o => o !== NONE) };
  }

  /* Face-down cards still on the table. */
  const closed = (s) => s.owner.flatMap((o, i) => (o === NONE && !s.open.includes(i) ? [i] : []));
  const remaining = (s) => s.owner.filter(o => o === NONE).length / 2;

  /* Ranks by pairs taken. Ties share a rank; every player with the top score is a winner. */
  function standings(s) {
    const best = Math.max(...s.scores);
    const winners = s.scores.flatMap((v, i) => (v === best ? [i] : []));
    const order = s.scores
      .map((score, player) => ({ player, score, rank: 1 + s.scores.filter(v => v > score).length }))
      .sort((x, y) => y.score - x.score || x.player - y.player);
    return { best, winners, order, tie: winners.length > 1 };
  }

  /* ---------- seats and table talk (pure, so the wording of every outcome can be tested) ---------- */
  const MODES = Object.freeze(["solo", "group", "cpu"]);
  const SEAT_NAMES = Object.freeze(["Aさん", "Bさん", "Cさん", "Dさん"]);

  /* Who plays. The human is always seat 0; against the CPU, humanFirst decides who flips first. */
  function seating(mode, players, humanFirst) {
    if (mode === "solo") return { mode, names: ["あなた"], first: 0, cpuSeat: NONE };
    if (mode === "cpu") return { mode, names: ["あなた", "CPU"], first: humanFirst ? 0 : 1, cpuSeat: 1 };
    if (mode !== "group") throw new Error("遊び方が正しくありません");
    if (!Number.isInteger(players) || players < 2 || players > PLAYERS.max) throw new Error(`みんなでは2〜${PLAYERS.max}人です`);
    return { mode, names: SEAT_NAMES.slice(0, players), first: 0, cpuSeat: NONE };
  }

  /* The setup screen's rules list for a mode and pair count. */
  const PAIR_RULE = "同じ数字で同じ色（黒どうし・赤どうし）ならペア。例：スペードの7とクラブの7";
  function rulesText(mode, pairs) {
    if (!MODES.includes(mode)) throw new Error("遊び方が正しくありません");
    if (!PAIR_COUNTS.includes(pairs)) throw new Error("ペアの数は8・12・16組から選んでください");
    const n = pairs * 2;
    if (mode === "solo") {
      return [`${n}枚のトランプをふせて並べ、2枚ずつめくる`, PAIR_RULE, "ちがったら元にもどす。どこに何があったか覚えよう",
        "全部そろえるまでの手数とタイムに挑戦。手数が少ないほど高記録"];
    }
    return [`${n}枚のトランプをふせて並べ、順番に2枚ずつめくる`, PAIR_RULE, "ペアなら取って、もう1回めくれる。ちがったら元にもどして次の人へ",
      "全部なくなったら終わり。ペアを多く取った人の勝ち", ...(mode === "cpu" ? ["CPUもめくられたカードを覚える。つよいほど忘れない"] : [])];
  }

  /* Title and hint during play. wait: null | "deal" | "cpu" | "match" | "miss" | "fly" (a pair flying away). */
  function status(s, seats, wait) {
    const name = (i) => seats.names[i];
    const solo = seats.mode === "solo";
    if (wait === "match" || wait === "fly") {
      const chain = wait === "match" ? s.chain + 1 : s.chain;
      const allDone = wait === "match" ? remaining(s) === 1 : s.over;
      const again = s.turn === seats.cpuSeat ? "CPUがもう1回めくります" : `${name(s.turn)}はもう1回めくれます`;
      const hint = allDone ? "これで全部そろいました" : solo ? "その調子！" : again;
      return { title: chain > 1 ? `${chain}連続でペア！` : "ペア！", hint };
    }
    if (wait === "miss") {
      return { title: "ざんねん…", hint: solo ? "どこに何があったか覚えておこう" : `次は${name((s.turn + 1) % s.players)}の番` };
    }
    if (wait === "cpu") return { title: "CPUが考え中…", hint: "" };
    if (wait === "deal") return { title: "カードを配っています", hint: "" };
    const title = solo ? "ペアを探そう" : `${name(s.turn)}の番`;
    const left = `のこり${remaining(s)}組`;
    if (s.open.length === 1) return { title, hint: "もう1枚めくろう" };
    return { title, hint: s.chain > 0 && !solo ? `続けてめくれます（${left}）` : `2枚めくろう（${left}）` };
  }

  /* Final words for a finished 2-4 player game. mood: "win" | "lose" | "draw" (vs CPU) or "cheer" | "draw".
   * winners: the seats to mark as winners; empty when everyone is level (a draw has no winner). */
  function verdict(s, seats) {
    const { winners, tie } = standings(s);
    if (seats.mode === "cpu") {
      const hint = `あなた ${s.scores[0]} 対 ${s.scores[1]} CPU`;
      if (tie) return { title: "引き分け！", hint, mood: "draw", winners: [] };
      const mood = winners[0] === seats.cpuSeat ? "lose" : "win";
      return { title: mood === "lose" ? "CPUの勝ち…" : "あなたの勝ち！", hint, mood, winners };
    }
    const hint = "ペアを多く取った人の勝ち";
    if (winners.length === s.players) {
      return { title: s.players === 2 ? "同点！ 引き分け" : "全員同点！ 引き分け", hint, mood: "draw", winners: [] };
    }
    const names = winners.map(i => seats.names[i]);
    return { title: tie ? `${names.join("と")}が同点で1位！` : `${names[0]}の勝ち！`, hint, mood: "cheer", winners };
  }

  /* ---------- CPU ---------- */
  const newMemory = () => ({});

  /* The CPU sees the given positions face up and remembers each with its level's chance.
   * Only cards that are face up right now can be learned; taken cards are forgotten. */
  function observe(memory, s, positions, level, r = Math.random) {
    if (!LEVELS.includes(level)) throw new Error("CPUの強さが正しくありません");
    if (!memory || typeof memory !== "object") throw new Error("CPUの記憶が正しくありません");
    const kept = Object.fromEntries(Object.entries(memory).filter(([p]) => s.owner[Number(p)] === NONE));
    const seen = positions.filter(p => s.open.includes(p) && s.owner[p] === NONE);
    return seen.reduce((m, p) => (r() < RECALL[level] ? { ...m, [p]: s.cards[p].key } : m), kept);
  }

  function knownPair(known, memory) {
    const first = new Map();
    for (const p of known) {
      const key = memory[p];
      if (first.has(key)) return [first.get(key), p];
      first.set(key, p);
    }
    return null;
  }

  /* Next card for the CPU. Reads face-down cards only through its memory, never from the table. */
  function cpuPick(s, memory, r = Math.random) {
    if (s.over || s.open.length >= 2) throw new Error("今はめくれません");
    if (!memory || typeof memory !== "object") throw new Error("CPUの記憶が正しくありません");
    const hidden = closed(s);
    const known = hidden.filter(p => typeof memory[p] === "string");
    const unknown = hidden.filter(p => typeof memory[p] !== "string");
    const fresh = unknown.length ? unknown : hidden;
    if (s.open.length === 1) {
      const want = s.cards[s.open[0]].key; /* face up: everyone can see it */
      const partner = known.find(p => memory[p] === want);
      return partner !== undefined ? partner : R.pick(fresh, r);
    }
    const pair = knownPair(known, memory);
    return pair ? pair[0] : R.pick(fresh, r);
  }

  /* ---------- solo records ---------- */
  function validRecord(rec, pairs) {
    return Boolean(rec) && typeof rec === "object" &&
      Number.isInteger(rec.tries) && rec.tries >= pairs && rec.tries <= MAX_RECORD_TRIES &&
      Number.isInteger(rec.ms) && rec.ms >= 0 && rec.ms < MAX_RECORD_MS;
  }
  /* Best record per pair count from storage: { 8: {tries, ms} | null, 12: ..., 16: ... }. */
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(PAIR_COUNTS.map(n => [n, validRecord(src[n], n) ? { tries: src[n].tries, ms: src[n].ms } : null]));
  }
  /* Fewer tries wins; the same tries are compared by time. */
  function isBetter(next, best) {
    if (!best) return true;
    return next.tries < best.tries || (next.tries === best.tries && next.ms < best.ms);
  }

  /* ---------- layout ---------- */
  /* Picks columns and card width (5:7 cards) so the grid fits width x height. If nothing fits with cards at
   * least `min` wide, the height limit is dropped (the page scrolls) and cards fill the width instead. */
  function gridLayout(count, width, height, opts = {}) {
    const gap = opts.gap ?? 6;
    const min = opts.min ?? 46;
    const max = opts.max ?? 84;
    if (!Number.isInteger(count) || count < 1) throw new Error("カードの枚数が正しくありません");
    if (![width, height].every(v => Number.isFinite(v) && v > 0)) throw new Error("画面の大きさが正しくありません");
    /* 4 columns always stays a candidate, so a grid of 1-3 cards still gets a plan (one short row). */
    const plans = [4, 5, 6, 7, 8].filter(c => c <= Math.max(4, count)).map(cols => {
      const rows = Math.ceil(count / cols);
      const byW = (width - gap * (cols - 1)) / cols;
      const byH = ((height - gap * (rows - 1)) / rows) * 5 / 7;
      return { cols, rows, byW, w: Math.floor(Math.min(max, byW, byH)), full: count % cols === 0 };
    });
    const score = (p) => p.w + (p.full ? 2 : 0);
    const best = plans.reduce((a, b) => (score(b) > score(a) ? b : a));
    if (best.w >= min) return { cols: best.cols, rows: best.rows, w: best.w, scroll: false };
    /* Scrolling: the fewest rows wins; on a tie the earlier plan (fewer columns, bigger cards) stays. */
    const wide = plans.filter(p => p.byW >= min);
    const pick = wide.length ? wide.reduce((a, b) => (b.rows < a.rows ? b : a)) : plans[0];
    return { cols: pick.cols, rows: pick.rows, w: Math.floor(Math.min(max, pick.byW)), scroll: true };
  }

  return {
    PAIR_COUNTS, PLAYERS, LEVELS, RECALL, NONE, MODES,
    colorOf, pairKey, isMatch, deal, newGame,
    flipError, canFlip, flip, pending, resolve, closed, remaining, standings,
    seating, rulesText, status, verdict,
    newMemory, observe, cpuPick,
    normalizeRecords, isBetter, gridLayout
  };
})();

if (typeof module !== "undefined") module.exports = MemoryRules;

/* Katakana-ban talk rules: players take turns talking on a topic without loanwords.
 * Every katakana word the others catch is a penalty for the speaker. Fewest penalties wins; ties share the rank. */
const KatakanaRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const PLAYERS = Object.freeze({ min: 3, max: 8 });
  const SECONDS = Object.freeze([30, 45, 60]);
  const LEVELS = Object.freeze(["normal", "hard", "all"]);
  const DEFAULTS = Object.freeze({ players: 4, seconds: 45, level: "all" });
  /* Several listeners often tap for the same word; taps closer than this count once. */
  const BUZZ_COOLDOWN_MS = 600;

  /* Topics that make people reach for loanwords. "hard" ones are nearly impossible without them. */
  const TOPICS = Object.freeze({
    normal: Object.freeze([
      "朝ごはん", "休みの日の過ごし方", "旅行の思い出", "好きな飲み物", "好きな食べ物",
      "学校の思い出", "誕生日の過ごし方", "夏休みの思い出", "好きなおやつ", "冬の楽しみ",
      "子どものころの遊び", "好きな動物", "運動会", "得意な料理", "雨の日の過ごし方",
      "家の近所のお店", "寝る前にすること", "家でのくつろぎ方", "好きな果物", "電車の中ですること",
      "冷蔵庫の中身", "お弁当", "朝の準備", "最近買ったもの", "部屋の中にあるもの",
      "好きなテレビ番組", "お祭り"
    ]),
    hard: Object.freeze([
      "スマホの使い方", "コンビニで買うもの", "ファッション", "パソコン", "好きな音楽",
      "好きなスポーツ", "カフェ", "ファストフード", "ゲーム", "好きな映画",
      "遊園地", "ショッピング", "ダイエット", "筋トレ", "野球",
      "サッカー", "クリスマス", "結婚式", "メイク", "車の運転",
      "家電", "好きなパン", "洋食", "会社の一日", "キャンプ",
      "ホテル", "好きなデザート", "SNS", "飛行機の旅", "美容院"
    ])
  });

  /* ---------- settings ---------- */
  function normalize(raw) {
    const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const players = Number.isInteger(s.players) && s.players >= PLAYERS.min && s.players <= PLAYERS.max
      ? s.players : DEFAULTS.players;
    const seconds = SECONDS.includes(s.seconds) ? s.seconds : DEFAULTS.seconds;
    const level = LEVELS.includes(s.level) ? s.level : DEFAULTS.level;
    return { players, seconds, level };
  }

  /* ---------- topics ---------- */
  function topicPool(level) {
    if (!LEVELS.includes(level)) throw new Error("お題の種類が正しくありません");
    return level === "all" ? [...TOPICS.normal, ...TOPICS.hard] : [...TOPICS[level]];
  }

  /* Picks a topic not used yet. Once this level's pool runs out it starts over: other levels' history is kept,
   * and this level's most recent topic is never picked again right away. */
  function pickTopic(used, level, r = Math.random) {
    if (!Array.isArray(used) || !used.every(t => typeof t === "string")) {
      throw new Error("使ったお題の記録が正しくありません");
    }
    const all = topicPool(level);
    const fresh = all.filter(t => !used.includes(t));
    if (fresh.length) {
      const topic = R.pick(fresh, r);
      return { topic, used: [...used, topic] };
    }
    const last = [...used].reverse().find(t => all.includes(t));
    const pool = all.length > 1 ? all.filter(t => t !== last) : all;
    const topic = R.pick(pool, r);
    return { topic, used: [...used.filter(t => !all.includes(t)), topic] };
  }

  /* ---------- game ---------- */
  function newGame(players, seconds) {
    if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) {
      throw new Error(`人数は${PLAYERS.min}〜${PLAYERS.max}人です`);
    }
    if (!SECONDS.includes(seconds)) throw new Error(`1人の時間は${SECONDS.join("・")}秒から選んでください`);
    return { players, seconds, lap: 1, turn: 0, count: 0, penalties: Array(players).fill(0), log: [] };
  }

  function check(g) {
    if (!g || !Array.isArray(g.penalties) || g.penalties.length !== g.players || !Array.isArray(g.log)) {
      throw new Error("ゲームの状態が正しくありません");
    }
    return g;
  }

  /* Each lap starts one seat later, so the first speaker changes: lap 1 = A,B,C…, lap 2 = B,C,…,A. */
  const speakingOrder = (players, lap) => Array.from({ length: players }, (_, i) => (i + lap - 1) % players);
  const lapDone = (g) => check(g).turn >= g.players;
  const speaker = (g) => (lapDone(g) ? null : speakingOrder(g.players, g.lap)[g.turn]);
  const lastTurn = (g) => check(g).log[g.log.length - 1] ?? null;

  function requireSpeaker(g) {
    const seat = speaker(g);
    if (seat === null) throw new Error("全員話し終わっています");
    return seat;
  }
  const addTo = (penalties, seat, delta) => penalties.map((p, i) => (i === seat ? p + delta : p));

  /* The current speaker said a katakana word. */
  function penalize(g) {
    const seat = requireSpeaker(g);
    return { ...g, count: g.count + 1, penalties: addTo(g.penalties, seat, 1) };
  }

  /* Takes back one mistaken tap from this turn. Never goes below what the speaker had before the turn. */
  function undo(g) {
    const seat = requireSpeaker(g);
    if (g.count <= 0) return g;
    return { ...g, count: g.count - 1, penalties: addTo(g.penalties, seat, -1) };
  }

  /* Cancels the turn in progress (for example when leaving mid-talk): its penalties are removed. */
  function resetTurn(g) {
    const seat = requireSpeaker(g);
    return { ...g, count: 0, penalties: addTo(g.penalties, seat, -g.count) };
  }

  function endTurn(g, topic) {
    const seat = requireSpeaker(g);
    if (typeof topic !== "string" || !topic.trim()) throw new Error("お題がありません");
    const entry = { lap: g.lap, seat, topic, count: g.count };
    return { ...g, turn: g.turn + 1, count: 0, log: [...g.log, entry] };
  }

  /* Another lap; penalties keep adding up. */
  function nextLap(g) {
    if (!lapDone(g)) throw new Error("まだ話していない人がいます");
    return { ...g, lap: g.lap + 1, turn: 0, count: 0 };
  }

  /* Fewest penalties first. Equal counts share the rank (1, 1, 3); seat order breaks display ties. */
  function ranking(g) {
    const rows = check(g).penalties.map((penalties, seat) => ({ seat, penalties }));
    const sorted = [...rows].sort((a, b) => a.penalties - b.penalties || a.seat - b.seat);
    return sorted.map(row => ({ ...row, rank: 1 + sorted.filter(o => o.penalties < row.penalties).length }));
  }
  const champions = (g) => ranking(g).filter(row => row.rank === 1).map(row => row.seat);

  function canBuzz(lastAt, now) {
    if (!Number.isFinite(now)) throw new Error("時刻が正しくありません");
    if (lastAt === null || lastAt === undefined) return true;
    if (!Number.isFinite(lastAt)) throw new Error("時刻が正しくありません");
    return now - lastAt >= BUZZ_COOLDOWN_MS;
  }

  return {
    PLAYERS, SECONDS, LEVELS, DEFAULTS, BUZZ_COOLDOWN_MS, TOPICS,
    normalize, topicPool, pickTopic, newGame, speakingOrder, speaker, lapDone, lastTurn,
    penalize, undo, resetTurn, endTurn, nextLap, ranking, champions, canBuzz
  };
})();

if (typeof module !== "undefined") module.exports = KatakanaRules;

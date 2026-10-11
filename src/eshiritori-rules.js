/* Picture shiritori rules: kana helpers (hiragana, small kana, long vowel "ー", "ん"), answer checks,
 * chain judging with reasons, start words, and the stroke data behind the drawing pad. Pure; no DOM. */
const EshiritoriRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const PLAYERS = Object.freeze({ min: 2, max: 8 });
  const COUNTS = Object.freeze([4, 6, 8]);
  const TIMES = Object.freeze([60, 90, 0]); /* seconds per drawing; 0 means no limit */
  const MAX_LEN = 12;

  const STARTS = Object.freeze([
    "りんご", "しりとり", "ねこ", "すいか", "きつね", "くじら", "いちご", "さくら", "とまと", "ぱんだ",
    "こあら", "うさぎ", "めがね", "たまご", "ぶどう", "ばなな", "とけい", "いるか", "ふね", "たこ",
    "くつ", "おにぎり", "ひこうき", "ほし", "ゆきだるま", "ぞう", "つくえ", "えんぴつ", "すずめ", "ろうそく",
    "くま", "かめ", "もも", "たいこ", "おばけ", "こま", "すし", "てがみ", "にわとり", "はさみ",
    "まど", "いす", "かさ", "しか", "はち"
  ]);

  const PALETTE = Object.freeze([
    Object.freeze({ token: "--ink", label: "基本の色" }),
    Object.freeze({ token: "--c-red", label: "赤" }),
    Object.freeze({ token: "--c-blue", label: "青" }),
    Object.freeze({ token: "--c-green", label: "緑" }),
    Object.freeze({ token: "--c-amber", label: "黄" }),
    Object.freeze({ token: "--c-brown", label: "茶" })
  ]);
  /* Line widths as a share of the canvas side, so drawings scale to any size. */
  const PEN = Object.freeze({ thin: 0.012, thick: 0.032 });
  const ERASER = Object.freeze({ thin: 0.05, thick: 0.1 });
  const MIN_STEP = 0.0025;
  const MAX_POINTS = 5000;

  /* ---------- kana ---------- */
  const SMALL = Object.freeze({
    "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お", "っ": "つ",
    "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "ゎ": "わ", "ゕ": "か", "ゖ": "け"
  });
  const VOWEL_ROWS = [
    ["あ", "あかさたなはまやらわがざだばぱぁゃゎゕ"],
    ["い", "いきしちにひみりぎじぢびぴぃゐ"],
    ["う", "うくすつぬふむゆるぐずづぶぷぅっゅゔ"],
    ["え", "えけせてねへめれげぜでべぺぇゖゑ"],
    ["お", "おこそとのほもよろをごぞどぼぽぉょ"]
  ];
  const VOWEL = Object.freeze(Object.fromEntries(VOWEL_ROWS.flatMap(([v, chars]) => [...chars].map(c => [c, v]))));
  const DASHES = /[-‐‑‒–—―−~〜～]/g;
  const KANA = /^[ぁ-ゖー]$/;
  const KANA_ONLY = /^[ぁ-ゖー]+$/;

  /* Katakana (also half-width) to hiragana; dash-like marks become "ー". Other characters are kept.
   * A separate ゛ or ゜ (typed after the kana) is joined to it: か゛ -> が. */
  function toHiragana(text) {
    if (typeof text !== "string") throw new Error("文字で入れてください");
    return text.replace(/゛/g, "゙").replace(/゜/g, "゚").normalize("NFKC")
      .replace(DASHES, "ー")
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  const cleanAnswer = (text) => toHiragana(text).replace(/\s+/g, "");
  const big = (c) => SMALL[c] || c;
  const kanaChars = (word) => [...cleanAnswer(word)].filter(c => KANA.test(c));

  /* Comparison form: small kana made big, each "ー" replaced by the vowel before it (a leading one is dropped). */
  function normalize(word) {
    return kanaChars(word).reduce((out, c) => {
      if (c !== "ー") return out + big(c);
      const vowel = VOWEL[out.slice(-1)];
      return vowel ? out + vowel : out;
    }, "");
  }

  /* The kana the next word must start with. A trailing "ー" is ignored; small kana count as big. */
  function lastKana(word) {
    const core = kanaChars(word).join("").replace(/ー+$/, "");
    return core ? big(core.slice(-1)) : "";
  }
  const firstKana = (word) => normalize(word).charAt(0);
  const endsWithN = (word) => lastKana(word) === "ん";
  const plain = (c) => c.normalize("NFD").replace(/[゙゚]/g, "");

  /* "exact" when equal, "voiced" when they differ only by ゛ or ゜, otherwise null. */
  function matchKana(last, first) {
    if (!last || !first) return null;
    if (last === first) return "exact";
    return plain(last) === plain(first) ? "voiced" : null;
  }

  /* A message for the player, or null when the answer can be used. */
  function answerError(text) {
    if (typeof text !== "string") return "答えを入れてね";
    const word = cleanAnswer(text);
    if (!word) return "答えを入れてね";
    if (!KANA_ONLY.test(word) || !normalize(word)) return "ひらがなで入れてね";
    if ([...word].length > MAX_LEN) return `${MAX_LEN}文字までにしてね`;
    return null;
  }

  /* ---------- chain ---------- */
  function judgeLink(prev, word, earlier) {
    const last = lastKana(prev);
    const first = firstKana(word);
    const base = { from: prev, to: word, last, first, endsN: endsWithN(word) };
    if (last === "ん") return { ...base, ok: false, reason: "after-n" };
    const match = matchKana(last, first);
    if (!match) return { ...base, ok: false, reason: "mismatch" };
    const key = normalize(word);
    if (earlier.some(w => normalize(w) === key)) return { ...base, ok: false, reason: "repeat" };
    return { ...base, ok: true, reason: match };
  }

  /* One link per answer: start → answer 1, answer 1 → answer 2, ... */
  function judgeChain(start, answers) {
    if (typeof start !== "string" || answerError(start)) throw new Error("はじめの言葉が正しくありません");
    if (!Array.isArray(answers) || answers.some(a => answerError(a))) throw new Error("答えが正しくありません");
    const words = [start, ...answers].map(cleanAnswer);
    const links = words.slice(1).map((word, i) => judgeLink(words[i], word, words.slice(0, i + 1)));
    const held = links.filter(l => l.ok).length;
    const endsN = links.length > 0 && links[links.length - 1].endsN;
    return { links, held, total: links.length, endsN, perfect: links.length > 0 && held === links.length && !endsN };
  }

  function verdict(result) {
    if (result.perfect) return "perfect";
    return result.held * 2 >= result.total ? "good" : "bad";
  }

  const NOTES = Object.freeze({
    exact: (l) => `「${l.last}」→「${l.first}」でつながった！`,
    voiced: (l) => `「${l.last}」→「${l.first}」濁点ちがいはOK！`,
    mismatch: (l) => `「${l.last}」のはずが「${l.first}」…ここで切れた`,
    "after-n": () => "前の言葉が「ん」で終わっていた…",
    repeat: (l) => `「${l.to}」はもう出た言葉。同じ言葉はアウト`
  });
  function linkNote(link) {
    const note = link ? NOTES[link.reason] : null;
    if (!note) throw new Error("判定が正しくありません");
    return note(link);
  }

  /* Picks a start word not used yet this session; starts over (avoiding the last one) once all were used. */
  function nextStart(used, r = Math.random) {
    const list = Array.isArray(used) ? used.filter(w => STARTS.includes(w)) : [];
    const fresh = STARTS.filter(w => !list.includes(w));
    const pool = fresh.length ? fresh : STARTS.filter(w => w !== list[list.length - 1]);
    const word = R.pick(pool, r);
    return { word, used: fresh.length ? [...list, word] : [word] };
  }

  /* ---------- game ---------- */
  function newGame(players, count, seconds, start) {
    if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) {
      throw new Error(`人数は${PLAYERS.min}〜${PLAYERS.max}人です`);
    }
    if (!COUNTS.includes(count)) throw new Error(`枚数は${COUNTS.join("・")}枚から選んでね`);
    if (!TIMES.includes(seconds)) throw new Error("制限時間が正しくありません");
    if (typeof start !== "string" || answerError(start)) throw new Error("はじめの言葉が正しくありません");
    return { players, count, seconds, start: cleanAnswer(start), turns: [] };
  }
  const isComplete = (game) => game.turns.length >= game.count;
  function addTurn(game, answer, strokes) {
    if (isComplete(game)) throw new Error("もう全員描き終わっています");
    const err = answerError(answer);
    if (err) throw new Error(err);
    if (!Array.isArray(strokes)) throw new Error("絵のデータが正しくありません");
    return { ...game, turns: [...game.turns, { answer: cleanAnswer(answer), strokes }] };
  }
  const seatOf = (game, index) => index % game.players;
  const answersOf = (game) => game.turns.map(t => t.answer);

  /* ---------- strokes (points are 0..1 of the canvas side) ---------- */
  const unit = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  function toPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("座標が正しくありません");
    return [unit(x), unit(y)];
  }
  function newStroke(tool, color, size, x, y) {
    if (tool !== "pen" && tool !== "eraser") throw new Error("道具が正しくありません");
    if (!Object.prototype.hasOwnProperty.call(PEN, size)) throw new Error("太さが正しくありません");
    if (tool === "pen" && !PALETTE.some(p => p.token === color)) throw new Error("色が正しくありません");
    const width = (tool === "pen" ? PEN : ERASER)[size];
    return { tool, color: tool === "pen" ? color : null, width, points: [toPoint(x, y)] };
  }
  /* Adds a point unless it is too close to the last one (keeps data small, lines smooth). */
  function extendStroke(stroke, x, y) {
    const p = toPoint(x, y);
    const last = stroke.points[stroke.points.length - 1];
    if (stroke.points.length >= MAX_POINTS || Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) return stroke;
    return { ...stroke, points: [...stroke.points, p] };
  }
  const addStroke = (strokes, stroke) => [...strokes, stroke];
  const undoStroke = (strokes) => strokes.slice(0, -1);
  const hasInk = (strokes) => strokes.some(s => s.tool === "pen");

  /* Smooth path: quadratic curves through the midpoints. "D" is a single dot. */
  function pathOf(points) {
    if (points.length === 0) return [];
    if (points.length === 1) return [["D", ...points[0]]];
    const curves = points.slice(1, -1).map((p, i) => {
      const next = points[i + 2];
      return ["Q", p[0], p[1], (p[0] + next[0]) / 2, (p[1] + next[1]) / 2];
    });
    return [["M", ...points[0]], ...curves, ["L", ...points[points.length - 1]]];
  }

  /* The first `progress` (0..1) share of all points, for replaying a drawing stroke by stroke. */
  function strokesAt(strokes, progress) {
    const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
    const total = strokes.reduce((n, s) => n + s.points.length, 0);
    const shown = Math.round(total * p);
    const starts = strokes.reduce((acc, s) => [...acc, acc[acc.length - 1] + s.points.length], [0]);
    return strokes
      .map((s, i) => (shown >= starts[i + 1] ? s : { ...s, points: s.points.slice(0, Math.max(0, shown - starts[i])) }))
      .filter(s => s.points.length > 0);
  }

  return {
    PLAYERS, COUNTS, TIMES, MAX_LEN, STARTS, PALETTE, PEN, ERASER,
    toHiragana, cleanAnswer, normalize, lastKana, firstKana, endsWithN, matchKana, answerError,
    judgeChain, verdict, linkNote, nextStart,
    newGame, addTurn, isComplete, seatOf, answersOf,
    newStroke, extendStroke, addStroke, undoStroke, hasInk, pathOf, strokesAt
  };
})();

if (typeof module !== "undefined") module.exports = EshiritoriRules;

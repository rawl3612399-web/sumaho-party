const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/eshiritori-rules.js");

/* Repeatable random source. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}
const deepCopy = (v) => JSON.parse(JSON.stringify(v));

/* ---------- kana conversion ---------- */
test("toHiragana: katakana, half-width katakana and dashes", () => {
  assert.equal(E.toHiragana("ゴリラ"), "ごりら");
  assert.equal(E.toHiragana("ヴァイオリン"), "ゔぁいおりん");
  assert.equal(E.toHiragana("ヵヶ"), "ゕゖ");
  assert.equal(E.toHiragana("ｺﾞﾘﾗ"), "ごりら", "half-width with dakuten is joined");
  assert.equal(E.toHiragana("ﾊﾟﾝﾀﾞ"), "ぱんだ");
  assert.equal(E.toHiragana("ｺｰﾋｰ"), "こーひー");
  assert.equal(E.toHiragana("こ-ひ〜"), "こーひー", "dash-like marks become ー");
  assert.equal(E.toHiragana("りんご"), "りんご", "hiragana stays");
  assert.equal(E.toHiragana("リンごA"), "りんごA", "other characters are kept");
  assert.equal(E.toHiragana(""), "");
  assert.throws(() => E.toHiragana(null));
  assert.throws(() => E.toHiragana(12));
});

test("toHiragana: a separate ゛ or ゜ joins the kana before it", () => {
  assert.equal(E.toHiragana("か゛"), "が");
  assert.equal(E.toHiragana("ハ゜ンタ゛"), "ぱんだ");
  assert.equal(E.toHiragana("ｶ゛"), "が", "half-width kana with a full-width mark");
  assert.equal(E.answerError("こ゛りら"), null, "an answer typed this way is accepted");
  assert.equal(E.firstKana("こ゛りら"), "ご");
  assert.equal(E.lastKana("りんこ゛"), "ご");
  assert.match(E.answerError("゛"), /ひらがな/, "a mark on its own is not a word");
});

test("cleanAnswer: converts and drops spaces (also full-width)", () => {
  assert.equal(E.cleanAnswer(" ゴ リ　ラ "), "ごりら");
  assert.equal(E.cleanAnswer("ら っ ぱ"), "らっぱ");
});

test("normalize: small kana become big, ー takes the vowel before it", () => {
  assert.equal(E.normalize("きしゃ"), "きしや");
  assert.equal(E.normalize("らーめん"), "らあめん");
  assert.equal(E.normalize("コーヒー"), "こおひい");
  assert.equal(E.normalize("ケーキ"), "けえき");
  assert.equal(E.normalize("スープ"), "すうぷ");
  assert.equal(E.normalize("ボール"), "ぼおる");
  assert.equal(E.normalize("しゃー"), "しやあ", "ー after a small kana uses its vowel");
  assert.equal(E.normalize("にーー"), "にいい", "a run of ー repeats the vowel");
  assert.equal(E.normalize("ーあめ"), "あめ", "a leading ー is dropped");
  assert.equal(E.normalize("ぱんー"), "ぱん", "ー after ん has no vowel");
  assert.equal(E.normalize("ゔぃーな"), "ゔいいな");
  assert.equal(E.normalize("ちょっと"), "ちよつと");
  assert.equal(E.normalize("ゎゕゖ"), "わかけ");
  assert.equal(E.normalize("り ん ご!"), "りんご", "non-kana characters are ignored");
  assert.equal(E.normalize(""), "");
});

test("lastKana: trailing ー is ignored, small kana count as big", () => {
  assert.equal(E.lastKana("りんご"), "ご");
  assert.equal(E.lastKana("コーヒー"), "ひ");
  assert.equal(E.lastKana("ルビー"), "び");
  assert.equal(E.lastKana("ばらーー"), "ら", "several trailing ー");
  assert.equal(E.lastKana("でんしゃ"), "や");
  assert.equal(E.lastKana("きんぎょ"), "よ");
  assert.equal(E.lastKana("ジュース"), "す");
  assert.equal(E.lastKana("パーティー"), "い", "small ぃ before the trailing ー");
  assert.equal(E.lastKana("がっ"), "つ");
  assert.equal(E.lastKana("ｷﾞﾀｰ"), "た");
  assert.equal(E.lastKana("ヴァイオリン"), "ん");
  assert.equal(E.lastKana("ーー"), "");
  assert.equal(E.lastKana(""), "");
});

test("firstKana: skips a leading ー and makes small kana big", () => {
  assert.equal(E.firstKana("ゴリラ"), "ご");
  assert.equal(E.firstKana("シャツ"), "し");
  assert.equal(E.firstKana("ちゃわん"), "ち");
  assert.equal(E.firstKana("ーあめ"), "あ");
  assert.equal(E.firstKana("ゃきゅう"), "や");
  assert.equal(E.firstKana("ヴァイオリン"), "ゔ");
  assert.equal(E.firstKana(" らっぱ"), "ら");
  assert.equal(E.firstKana(""), "");
});

test("endsWithN: words that end in ん, even with a trailing ー", () => {
  assert.equal(E.endsWithN("みかん"), true);
  assert.equal(E.endsWithN("ラーメン"), true);
  assert.equal(E.endsWithN("みかんー"), true);
  assert.equal(E.endsWithN("ん"), true);
  assert.equal(E.endsWithN("りんご"), false);
  assert.equal(E.endsWithN("んま"), false);
  assert.equal(E.endsWithN(""), false);
});

test("matchKana: exact, voiced marks are lenient, others fail", () => {
  assert.equal(E.matchKana("ご", "ご"), "exact");
  assert.equal(E.matchKana("ご", "こ"), "voiced");
  assert.equal(E.matchKana("か", "が"), "voiced");
  assert.equal(E.matchKana("は", "ぱ"), "voiced");
  assert.equal(E.matchKana("ば", "ぱ"), "voiced");
  assert.equal(E.matchKana("う", "ゔ"), "voiced");
  assert.equal(E.matchKana("ら", "な"), null);
  assert.equal(E.matchKana("や", "ゆ"), null);
  assert.equal(E.matchKana("", "あ"), null);
  assert.equal(E.matchKana("あ", ""), null);
});

test("answerError: empty, non-kana, only ー, too long", () => {
  assert.equal(E.answerError("ごりら"), null);
  assert.equal(E.answerError("ゴリラ"), null, "katakana is converted");
  assert.equal(E.answerError("ご り ら"), null, "spaces are ignored");
  assert.equal(E.answerError("こーひー"), null);
  assert.match(E.answerError(""), /入れて/);
  assert.match(E.answerError("   "), /入れて/);
  assert.match(E.answerError("猫"), /ひらがな/);
  assert.match(E.answerError("neko"), /ひらがな/);
  assert.match(E.answerError("ねこ1"), /ひらがな/);
  assert.match(E.answerError("ーー"), /ひらがな/);
  assert.match(E.answerError("あ".repeat(E.MAX_LEN + 1)), /文字まで/);
  assert.equal(E.answerError("あ".repeat(E.MAX_LEN)), null);
  assert.match(E.answerError(null), /入れて/);
  assert.match(E.answerError(5), /入れて/);
});

/* ---------- chain ---------- */
test("judgeChain: a clean chain is perfect", () => {
  const r = E.judgeChain("りんご", ["ごりら", "らっぱ", "ぱんだ"]);
  assert.equal(r.total, 3);
  assert.equal(r.held, 3);
  assert.equal(r.perfect, true);
  assert.equal(r.endsN, false);
  assert.deepEqual(r.links.map(l => l.reason), ["exact", "exact", "exact"]);
  assert.deepEqual(r.links.map(l => [l.last, l.first]), [["ご", "ご"], ["ら", "ら"], ["ぱ", "ぱ"]]);
  assert.deepEqual(r.links.map(l => [l.from, l.to]), [["りんご", "ごりら"], ["ごりら", "らっぱ"], ["らっぱ", "ぱんだ"]]);
});

test("judgeChain: a misread picture breaks one link", () => {
  const r = E.judgeChain("りんご", ["ごりら", "なす", "すいか"]);
  assert.deepEqual(r.links.map(l => l.ok), [true, false, true]);
  assert.equal(r.links[1].reason, "mismatch");
  assert.equal(r.held, 2);
  assert.equal(r.perfect, false);
});

test("judgeChain: long vowels, small kana and katakana follow the rules", () => {
  const r = E.judgeChain("こーひー", ["ヒコウキ", "きしゃ", "やかた", "たんす"]);
  assert.deepEqual(r.links.map(l => l.ok), [true, true, true, true]);
  assert.equal(r.links[0].last, "ひ");
  assert.equal(r.links[2].last, "や");
  assert.equal(r.links[0].to, "ひこうき", "answers are stored as hiragana");
});

test("judgeChain: voiced marks may be added or dropped", () => {
  const r = E.judgeChain("りんご", ["こま", "まど", "とら"]);
  assert.deepEqual(r.links.map(l => l.reason), ["voiced", "exact", "voiced"]);
  assert.equal(r.perfect, true);
});

test("judgeChain: ん in the middle breaks the next link", () => {
  const r = E.judgeChain("りんご", ["ごはん", "んま"]);
  assert.equal(r.links[0].ok, true);
  assert.equal(r.links[0].endsN, true);
  assert.equal(r.links[1].ok, false);
  assert.equal(r.links[1].reason, "after-n");
  assert.equal(r.perfect, false);
});

test("judgeChain: ending in ん spoils a perfect chain", () => {
  const r = E.judgeChain("りんご", ["ごりら", "らいおん"]);
  assert.equal(r.held, 2);
  assert.equal(r.total, 2);
  assert.equal(r.endsN, true);
  assert.equal(r.perfect, false);
  assert.equal(E.verdict(r), "good");
});

test("judgeChain: repeating a word (or the start word) is out", () => {
  const r = E.judgeChain("りんご", ["ごりら", "らっこ", "こあら", "らっこ"]);
  assert.equal(r.links[3].reason, "repeat");
  assert.equal(r.links[3].ok, false);
  const back = E.judgeChain("ごりら", ["らくだ", "だちょう", "うし", "しまうま", "まり", "りす", "すごろく", "くさ", "さごりら"]);
  assert.equal(back.links.every(l => l.ok), true, "a different word with the same ending is fine");
  const start = E.judgeChain("ごま", ["まご", "ごま"]);
  assert.equal(start.links[1].reason, "repeat", "the start word counts");
  const longVowel = E.judgeChain("こま", ["まーく", "くま", "まあく"]);
  assert.equal(longVowel.links[2].reason, "repeat", "まーく and まあく are the same word");
});

test("judgeChain: a mismatch is reported before a repeat", () => {
  const r = E.judgeChain("りんご", ["ごま", "りんご"]);
  assert.equal(r.links[1].reason, "mismatch");
});

test("judgeChain: validates input and does not change it", () => {
  const answers = ["ゴリラ", "らっぱ"];
  const copy = [...answers];
  E.judgeChain("りんご", answers);
  assert.deepEqual(answers, copy);
  assert.throws(() => E.judgeChain("", ["ごりら"]));
  assert.throws(() => E.judgeChain("りんご", "ごりら"));
  assert.throws(() => E.judgeChain("りんご", ["ごりら", "猫"]));
  assert.throws(() => E.judgeChain(null, []));
  const empty = E.judgeChain("りんご", []);
  assert.equal(empty.total, 0);
  assert.equal(empty.perfect, false);
});

test("verdict: perfect, good (at least half), bad", () => {
  assert.equal(E.verdict(E.judgeChain("りんご", ["ごりら", "らっぱ"])), "perfect");
  assert.equal(E.verdict(E.judgeChain("りんご", ["ごりら", "なす"])), "good");
  assert.equal(E.verdict(E.judgeChain("りんご", ["なす", "めだか", "くつ"])), "bad");
});

test("linkNote: a message for every reason", () => {
  const r = E.judgeChain("りんご", ["こま", "まど", "なす", "すし"]);
  assert.match(E.linkNote(r.links[0]), /濁点/);
  assert.match(E.linkNote(r.links[1]), /つながった/);
  assert.match(E.linkNote(r.links[2]), /「ど」のはずが「な」/);
  assert.match(E.linkNote(E.judgeChain("ごはん", ["んま"]).links[0]), /「ん」/);
  assert.match(E.linkNote(E.judgeChain("すし", ["しす", "すし"]).links[1]), /もう出た/);
  assert.throws(() => E.linkNote({ reason: "other" }));
  assert.throws(() => E.linkNote(null));
});

/* ---------- start words ---------- */
test("start words: valid hiragana, unique, never end in ん", () => {
  assert.ok(E.STARTS.length >= 30);
  assert.equal(new Set(E.STARTS).size, E.STARTS.length);
  E.STARTS.forEach(w => {
    assert.equal(E.answerError(w), null, w);
    assert.equal(E.cleanAnswer(w), w, w);
    assert.equal(E.endsWithN(w), false, w);
  });
});

test("nextStart: no repeats until every word was used, then starts over", () => {
  let used = [];
  const seen = new Set();
  for (let i = 0; i < E.STARTS.length; i++) {
    const next = E.nextStart(used, seq(0.37, 0.81, 0.05));
    assert.ok(!used.includes(next.word));
    used = next.used;
    seen.add(next.word);
  }
  assert.equal(seen.size, E.STARTS.length);
  const last = used[used.length - 1];
  const again = E.nextStart(used, () => 0);
  assert.equal(again.used.length, 1);
  assert.notEqual(again.word, last, "the word just used is not picked right away");
});

test("nextStart: deterministic with injected randomness and pure", () => {
  const used = ["りんご"];
  const a = E.nextStart(used, () => 0);
  const b = E.nextStart(used, () => 0);
  assert.deepEqual(a, b);
  assert.equal(a.word, E.STARTS.find(w => w !== "りんご"));
  assert.deepEqual(used, ["りんご"], "input is not changed");
  assert.equal(E.nextStart(used, () => 0.999999).word, E.STARTS[E.STARTS.length - 1]);
  assert.ok(E.STARTS.includes(E.nextStart(null).word), "bad used list is ignored");
  assert.ok(E.STARTS.includes(E.nextStart(["?", 3]).word));
});

/* ---------- game ---------- */
test("newGame: validates settings", () => {
  const g = E.newGame(4, 6, 60, "リンゴ");
  assert.deepEqual(g, { players: 4, count: 6, seconds: 60, start: "りんご", turns: [] });
  assert.equal(E.newGame(2, 4, 0, "ねこ").seconds, 0);
  assert.throws(() => E.newGame(1, 6, 60, "ねこ"));
  assert.throws(() => E.newGame(9, 6, 60, "ねこ"));
  assert.throws(() => E.newGame(4.5, 6, 60, "ねこ"));
  assert.throws(() => E.newGame(4, 5, 60, "ねこ"));
  assert.throws(() => E.newGame(4, 6, 30, "ねこ"));
  assert.throws(() => E.newGame(4, 6, 60, "猫"));
  assert.throws(() => E.newGame(4, 6, 60, ""));
  assert.throws(() => E.newGame(4, 6, 60, null));
});

test("addTurn: returns a new game and never changes the old one", () => {
  const g0 = E.newGame(3, 4, 90, "りんご");
  const before = deepCopy(g0);
  const strokes = [E.newStroke("pen", "--ink", "thin", 0.1, 0.1)];
  const g1 = E.addTurn(g0, "ゴリラ", strokes);
  assert.deepEqual(g0, before);
  assert.notEqual(g1, g0);
  assert.notEqual(g1.turns, g0.turns);
  assert.deepEqual(E.answersOf(g1), ["ごりら"]);
  assert.equal(g1.turns[0].strokes, strokes);
  assert.throws(() => E.addTurn(g1, "", []));
  assert.throws(() => E.addTurn(g1, "らっぱ", null));
  assert.throws(() => E.addTurn(g1, "ラッパ!", []));
});

test("addTurn: the game completes after the set count; seats go around", () => {
  const g = ["ごりら", "らっぱ", "ぱんだ", "だるま"].reduce((acc, a) => E.addTurn(acc, a, []), E.newGame(3, 4, 60, "りんご"));
  assert.equal(E.isComplete(g), true);
  assert.throws(() => E.addTurn(g, "まど", []));
  assert.deepEqual([0, 1, 2, 3, 4].map(i => E.seatOf(g, i)), [0, 1, 2, 0, 1]);
  assert.equal(E.judgeChain(g.start, E.answersOf(g)).perfect, true);
});

/* ---------- strokes ---------- */
test("newStroke: validates tool, color and size; points are clamped", () => {
  const s = E.newStroke("pen", "--c-red", "thick", 1.4, -0.2);
  assert.deepEqual(s, { tool: "pen", color: "--c-red", width: E.PEN.thick, points: [[1, 0]] });
  const er = E.newStroke("eraser", "anything", "thin", 0.5, 0.5);
  assert.equal(er.color, null);
  assert.equal(er.width, E.ERASER.thin);
  assert.throws(() => E.newStroke("brush", "--ink", "thin", 0, 0));
  assert.throws(() => E.newStroke("pen", "--nope", "thin", 0, 0));
  assert.throws(() => E.newStroke("pen", "red", "thin", 0, 0));
  assert.throws(() => E.newStroke("pen", "--ink", "huge", 0, 0));
  assert.throws(() => E.newStroke("pen", "--ink", "toString", 0, 0));
  assert.throws(() => E.newStroke("pen", "--ink", "thin", NaN, 0));
  assert.throws(() => E.newStroke("pen", "--ink", "thin", 0, Infinity));
  E.PALETTE.forEach(p => assert.match(p.token, /^--/));
  assert.equal(E.PALETTE.length, 6);
});

test("extendStroke: adds points immutably, skips tiny moves", () => {
  const s0 = E.newStroke("pen", "--ink", "thin", 0.1, 0.1);
  const s1 = E.extendStroke(s0, 0.2, 0.25);
  assert.deepEqual(s0.points, [[0.1, 0.1]], "original not changed");
  assert.deepEqual(s1.points, [[0.1, 0.1], [0.2, 0.25]]);
  assert.equal(E.extendStroke(s1, 0.2001, 0.2501), s1, "a tiny move is ignored");
  assert.deepEqual(E.extendStroke(s1, 2, 2).points[2], [1, 1], "clamped to the canvas");
  assert.equal(E.extendStroke(s1, 0.123456, 0.5).points[2][0], 0.123, "rounded to keep data small");
});

test("addStroke / undoStroke / hasInk", () => {
  const pen = E.newStroke("pen", "--ink", "thin", 0, 0);
  const er = E.newStroke("eraser", null, "thick", 0, 0);
  const a = E.addStroke([], pen);
  const b = E.addStroke(a, er);
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
  assert.deepEqual(E.undoStroke(b), [pen]);
  assert.equal(b.length, 2, "undo does not change the list");
  assert.deepEqual(E.undoStroke([]), []);
  assert.equal(E.hasInk(b), true);
  assert.equal(E.hasInk([er]), false, "only eraser means nothing drawn");
  assert.equal(E.hasInk([]), false);
});

test("pathOf: dot, line and smooth curve", () => {
  assert.deepEqual(E.pathOf([]), []);
  assert.deepEqual(E.pathOf([[0.5, 0.5]]), [["D", 0.5, 0.5]]);
  assert.deepEqual(E.pathOf([[0, 0], [1, 1]]), [["M", 0, 0], ["L", 1, 1]]);
  assert.deepEqual(E.pathOf([[0, 0], [0.5, 0.5], [1, 0]]), [["M", 0, 0], ["Q", 0.5, 0.5, 0.75, 0.25], ["L", 1, 0]]);
  assert.equal(E.pathOf([[0, 0], [0.1, 0], [0.2, 0], [0.3, 0], [0.4, 0]]).length, 5);
});

test("strokesAt: replays a share of the points without changing the strokes", () => {
  const a = { tool: "pen", color: "--ink", width: 0.01, points: [[0, 0], [0.1, 0], [0.2, 0], [0.3, 0]] };
  const b = { tool: "pen", color: "--c-red", width: 0.01, points: [[0, 1], [0.1, 1], [0.2, 1], [0.3, 1]] };
  const strokes = [a, b];
  const before = deepCopy(strokes);
  assert.deepEqual(E.strokesAt(strokes, 0), []);
  assert.deepEqual(E.strokesAt(strokes, 1), strokes);
  const half = E.strokesAt(strokes, 0.5);
  assert.equal(half.length, 1);
  assert.equal(half[0], a, "complete strokes are reused");
  const more = E.strokesAt(strokes, 0.75);
  assert.equal(more.length, 2);
  assert.equal(more[1].points.length, 2);
  assert.deepEqual(E.strokesAt(strokes, 5), strokes, "progress is clamped");
  assert.deepEqual(E.strokesAt(strokes, NaN), strokes);
  assert.deepEqual(E.strokesAt([], 0.5), []);
  assert.deepEqual(strokes, before);
});

test("constants: settings choices", () => {
  assert.deepEqual([...E.COUNTS], [4, 6, 8]);
  assert.deepEqual([...E.TIMES], [60, 90, 0]);
  assert.deepEqual({ ...E.PLAYERS }, { min: 2, max: 8 });
  assert.ok(Object.isFrozen(E.STARTS) && Object.isFrozen(E.PALETTE) && Object.isFrozen(E.PEN));
});

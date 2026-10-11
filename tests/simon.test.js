const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/simon-rules.js");

/* Repeatable random source (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const deepFreeze = (v) => {
  if (v && typeof v === "object") {
    Object.values(v).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
};
/* Presses the whole current sequence correctly. Returns the last press result. */
function playRound(g) {
  return g.sequence.slice(g.pos).reduce((acc) => S.press(acc.game, S.expected(acc.game)), { game: g, result: "start" });
}
const wrongPad = (g) => (S.expected(g) + 1) % S.PAD_COUNT;

/* ---------- new game and sequence growth ---------- */
test("simon: a new game starts with one valid pad and the mode's retries", () => {
  const g = S.newGame("normal", rng(1));
  assert.equal(g.sequence.length, 1);
  assert.ok(g.sequence[0] >= 0 && g.sequence[0] < S.PAD_COUNT);
  assert.equal(g.pos, 0);
  assert.equal(g.score, 0);
  assert.equal(g.retriesLeft, 0);
  assert.equal(g.over, false);
  assert.equal(S.newGame("easy", rng(1)).retriesLeft, 1);
  assert.throws(() => S.newGame("hard", rng(1)), /モード/);
  assert.throws(() => S.newGame(undefined));
});

test("simon: randomness is injectable and repeatable", () => {
  const grow = (seed) => {
    const r = rng(seed);
    let g = S.newGame("normal", r);
    for (let i = 0; i < 12; i++) g = S.extend(playRound(g).game, r);
    return g.sequence;
  };
  assert.deepEqual(grow(7), grow(7));
  assert.notDeepEqual(grow(7), grow(8));
});

test("simon: extend adds exactly one pad, keeps the old ones, and resets the input", () => {
  const r = rng(3);
  let g = S.newGame("normal", r);
  for (let i = 0; i < 20; i++) {
    const done = deepFreeze(playRound(g).game);
    const next = S.extend(done, r);
    assert.equal(next.sequence.length, done.sequence.length + 1);
    assert.deepEqual(next.sequence.slice(0, -1), done.sequence);
    assert.equal(next.pos, 0);
    g = next;
  }
});

test("simon: extend only after a cleared round", () => {
  const g = S.newGame("normal", rng(4));
  assert.throws(() => S.extend(g, rng(4)), /途中/);
  const over = S.press(g, wrongPad(g)).game;
  assert.throws(() => S.extend(over, rng(4)), /終わって/);
});

test("simon: never the same pad three times in a row, and every pad shows up", () => {
  for (let seed = 1; seed <= 60; seed++) {
    let seq = [];
    for (let i = 0; i < 80; i++) seq = [...seq, S.nextPad(seq, rng(seed * 1000 + i))];
    seq.forEach(p => assert.ok(Number.isInteger(p) && p >= 0 && p < S.PAD_COUNT));
    for (let i = 2; i < seq.length; i++) {
      assert.ok(!(seq[i] === seq[i - 1] && seq[i] === seq[i - 2]), `seed ${seed}: triple at ${i}`);
    }
  }
  const counts = [0, 0, 0, 0];
  const r = rng(99);
  let seq = [];
  for (let i = 0; i < 4000; i++) {
    seq = [...seq.slice(-2), S.nextPad(seq, r)];
    counts[seq[seq.length - 1]] += 1;
  }
  counts.forEach(c => assert.ok(c > 850 && c < 1150, `uneven pads: ${counts}`));
});

test("simon: nextPad edge values of the random source stay in range", () => {
  assert.equal(S.nextPad([], () => 0), 0);
  assert.equal(S.nextPad([], () => 0.999999), 3);
  assert.notEqual(S.nextPad([2, 2], () => 0.6), 2);
  assert.throws(() => S.nextPad([], () => 1), /乱数/);
  assert.throws(() => S.nextPad([], () => NaN), /乱数/);
  assert.throws(() => S.nextPad([0, 9]), /パッド/);
});

/* ---------- input checking ---------- */
test("simon: correct presses move forward; the last one clears the round", () => {
  const r = rng(5);
  let g = S.newGame("normal", r);
  g = S.extend(playRound(g).game, r);
  g = S.extend(playRound(g).game, r);
  assert.equal(g.sequence.length, 3);
  const a = S.press(g, g.sequence[0]);
  assert.equal(a.result, "ok");
  assert.equal(a.game.pos, 1);
  const b = S.press(a.game, g.sequence[1]);
  assert.equal(b.result, "ok");
  const c = S.press(b.game, g.sequence[2]);
  assert.equal(c.result, "clear");
  assert.equal(c.game.score, 3);
  assert.equal(S.isComplete(c.game), true);
  assert.equal(S.expected(c.game), undefined);
});

test("simon: normal mode ends on the first mistake and keeps the score", () => {
  const r = rng(6);
  let g = S.newGame("normal", r);
  g = S.extend(playRound(g).game, r);
  const want = S.expected(g);
  const out = S.press(g, wrongPad(g));
  assert.equal(out.result, "over");
  assert.equal(out.expected, want);
  assert.equal(out.game.over, true);
  assert.equal(out.game.score, 1);
  assert.equal(out.game.misses, 1);
  assert.throws(() => S.press(out.game, 0), /終わって/);
});

test("simon: easy mode allows one retry per game, then ends", () => {
  const r = rng(7);
  let g = S.newGame("easy", r);
  g = S.extend(playRound(g).game, r);
  const half = S.press(g, g.sequence[0]).game;
  const retry = S.press(half, wrongPad(half));
  assert.equal(retry.result, "retry");
  assert.equal(retry.game.pos, 0, "the same sequence starts over");
  assert.deepEqual(retry.game.sequence, g.sequence);
  assert.equal(retry.game.retriesLeft, 0);
  assert.equal(retry.game.over, false);
  const cleared = playRound(retry.game);
  assert.equal(cleared.result, "clear");
  const next = S.extend(cleared.game, r);
  const end = S.press(next, wrongPad(next));
  assert.equal(end.result, "over");
  assert.equal(end.game.score, 2);
  assert.equal(end.game.misses, 2);
});

test("simon: press does not change the game it was given", () => {
  const g = deepFreeze(S.newGame("easy", rng(8)));
  const copy = JSON.parse(JSON.stringify(g));
  S.press(g, S.expected(g));
  S.press(g, wrongPad(g));
  assert.deepEqual(g, copy);
});

test("simon: press rejects bad pads and bad states", () => {
  const g = S.newGame("normal", rng(9));
  assert.throws(() => S.press(g, 4), /パッド/);
  assert.throws(() => S.press(g, -1), /パッド/);
  assert.throws(() => S.press(g, "1"), /パッド/);
  assert.throws(() => S.press(playRound(g).game, 0), /クリア済み/);
  assert.throws(() => S.press({ ...g, sequence: [] }, 0), /状態/);
  assert.throws(() => S.press({ ...g, pos: 5 }, 0), /状態/);
  assert.throws(() => S.press(null, 0), /状態/);
});

test("simon: a perfect game ends at the maximum round", () => {
  const r = rng(10);
  let g = S.newGame("normal", r);
  let last = null;
  for (let round = 1; round <= S.MAX_ROUNDS; round++) {
    last = playRound(g);
    if (round < S.MAX_ROUNDS) {
      assert.equal(last.result, "clear");
      g = S.extend(last.game, r);
    }
  }
  assert.equal(last.result, "perfect");
  assert.equal(last.game.over, true);
  assert.equal(last.game.perfect, true);
  assert.equal(last.game.score, S.MAX_ROUNDS);
});

/* ---------- speed schedule ---------- */
test("simon: speed rises every few rounds and never slows down", () => {
  let prev = S.speedFor(1);
  assert.equal(prev.level, 1);
  for (let n = 2; n <= 60; n++) {
    const s = S.speedFor(n);
    assert.ok(s.on <= prev.on && s.gap <= prev.gap, `round ${n} is slower`);
    assert.ok(s.on >= 150 && s.gap >= 50, "still possible to see");
    assert.equal(S.isSpeedUp(n), s.level > prev.level, `round ${n}`);
    prev = s;
  }
  assert.equal(S.isSpeedUp(1), false);
  assert.equal(S.isSpeedUp(5), true);
  assert.equal(S.speedFor(4).level, 1);
  assert.equal(S.speedFor(5).level, 2);
  assert.ok(S.speedFor(40).level === S.SPEEDS.length);
  assert.throws(() => S.speedFor(0), /長さ/);
  assert.throws(() => S.speedFor(2.5), /長さ/);
});

/* ---------- rank titles ---------- */
test("simon: rank titles follow the thresholds", () => {
  assert.equal(S.RANKS[0].min, 0);
  S.RANKS.forEach((rank, i) => {
    assert.ok(rank.title.endsWith("級"));
    assert.ok(rank.note.length > 0);
    if (i > 0) assert.ok(rank.min > S.RANKS[i - 1].min, "ascending");
    assert.equal(S.rankFor(rank.min), rank);
    if (rank.min > 0) assert.equal(S.rankFor(rank.min - 1), S.RANKS[i - 1]);
  });
  assert.equal(S.rankFor(0).title, "金魚級");
  assert.equal(S.rankFor(9).title, "イヌ級");
  assert.equal(S.rankFor(S.MAX_ROUNDS), S.RANKS[S.RANKS.length - 1]);
  assert.throws(() => S.rankFor(-1), /スコア/);
  assert.throws(() => S.rankFor(1.5), /スコア/);
});

test("simon: next rank tells how far to go", () => {
  assert.equal(S.nextRank(0), S.RANKS[1]);
  assert.equal(S.nextRank(S.RANKS[1].min), S.RANKS[2]);
  assert.equal(S.nextRank(S.RANKS[S.RANKS.length - 1].min), null);
});

/* ---------- records and settings ---------- */
test("simon: records load safely from anything", () => {
  assert.deepEqual(S.normalizeRecords(null), { normal: 0, easy: 0 });
  assert.deepEqual(S.normalizeRecords("x"), { normal: 0, easy: 0 });
  assert.deepEqual(S.normalizeRecords({ normal: 12, easy: -3 }), { normal: 12, easy: 0 });
  assert.deepEqual(S.normalizeRecords({ normal: 2.5, easy: "9" }), { normal: 0, easy: 0 });
  assert.deepEqual(S.normalizeRecords({ normal: 1e9, easy: 4, extra: 5 }), { normal: 0, easy: 4 });
});

test("simon: a record is new only when it beats the best", () => {
  const base = { normal: 5, easy: 0 };
  const same = S.recordAfter(base, "normal", 5);
  assert.equal(same.isNew, false);
  assert.deepEqual(same.records, base);
  const up = S.recordAfter(base, "normal", 6);
  assert.equal(up.isNew, true);
  assert.deepEqual(up.records, { normal: 6, easy: 0 });
  assert.deepEqual(base, { normal: 5, easy: 0 }, "input unchanged");
  assert.equal(S.recordAfter(base, "easy", 0).isNew, false);
  assert.equal(S.recordAfter(base, "easy", 1).isNew, true);
  assert.throws(() => S.recordAfter(base, "hard", 3), /モード/);
  assert.throws(() => S.recordAfter(base, "easy", -1), /スコア/);
});

test("simon: settings fall back to normal mode", () => {
  assert.deepEqual(S.normalizeSettings(null), { mode: "normal" });
  assert.deepEqual(S.normalizeSettings({ mode: "easy" }), { mode: "easy" });
  assert.deepEqual(S.normalizeSettings({ mode: "oni" }), { mode: "normal" });
});

/* ---------- screen regressions: the real screen module on a tiny fake DOM with a fake clock ---------- */
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function simonScreen() {
  const ids = new Map();
  const calls = { scroll: 0 };
  let now = 0;
  let timers = [];
  let nextId = 1;
  class El {
    constructor(tag = "div") {
      const set = new Set();
      Object.assign(this, { tagName: tag.toUpperCase(), children: [], listeners: {}, dataset: {}, style: { setProperty() {} },
        hidden: false, disabled: false, textContent: "", className: "" });
      this.classList = { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)),
        toggle: (c, on = !set.has(c)) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    fire(type, e = {}) {
      if (this.disabled) return;
      (this.listeners[type] || []).forEach(fn => fn({ target: this, button: 0, detail: 1, preventDefault() {}, stopPropagation() {}, ...e }));
    }
    replaceChildren(...c) { this.children = c; }
    append(...c) { this.children.push(...c); }
    setAttribute() {}
    closest(sel) { return this.className.split(" ").includes(sel.slice(1)) ? this : null; }
    querySelectorAll(sel) { return this.children.filter(c => c.closest(sel)); }
  }
  const get = (id) => ids.get(id) || ids.set(id, new El()).get(id);
  get("siBoard").children = [0, 1, 2, 3].map(i => Object.assign(new El(), { className: "simon-pad", dataset: { pad: String(i) } }));
  const store = new Map();
  const ctx = vm.createContext({
    document: { getElementById: get, createElement: (t) => new El(t), addEventListener() {}, hidden: false },
    window: { scrollTo: () => { calls.scroll += 1; } }, navigator: {},
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    performance: { now: () => now },
    setTimeout: (fn, ms = 0) => { timers = [...timers, { id: nextId, at: now + ms, fn }]; return nextId++; },
    clearTimeout: (id) => { timers = timers.filter(t => t.id !== id); },
    Sound: { ensure() {}, sfx() {}, tone() {}, ctx: () => null, hz: (m) => m, vibrate() {} },
    Fx: { pop() {}, shake() {}, flash() {}, confetti() {}, replay() {} }
  });
  ["random.js", "shared.js", "simon-rules.js", "simon.js"].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8"), ctx, { filename: f }));
  vm.runInContext("Math.random = () => 0; Simon.init();", ctx); /* with random 0 the sequence is green, green, red… */
  function advance(ms) {
    const end = now + ms;
    for (let due = timers.find(t => t.at <= end); due; due = [...timers].sort((a, b) => a.at - b.at).find(t => t.at <= end)) {
      timers = timers.filter(t => t !== due);
      now = Math.max(now, due.at);
      due.fn();
    }
    now = end;
  }
  const click = (label) => get("siActions").children.find(b => b.textContent === label).fire("click");
  return { $: get, advance, click, calls, pad: (i) => get("siBoard").children[i] };
}
const statTexts = (h) => h.$("siStats").children.map(li => li.children.map(c => c.textContent).join(""));

test("simon screen: a double tap on はじめる does not also hit the やめる that appears under the finger", () => {
  const h = simonScreen();
  h.advance(1000);
  h.click("はじめる");
  h.advance(120);
  h.click("やめる");
  assert.equal(h.$("siCard").hidden, true, "no 0-round result");
  assert.equal(h.$("siSetup").hidden, true, "the game keeps going");
  assert.equal(h.calls.scroll, 1, "starting scrolls up so the whole board shows on a small phone");
});

test("simon screen: やめる before any cleared round goes back; after a round it shows the score", () => {
  const h = simonScreen();
  h.advance(1000);
  h.click("はじめる");
  h.advance(1000);
  h.click("やめる");
  assert.equal(h.$("siSetup").hidden, false, "nothing cleared yet: back to setup");
  assert.equal(h.$("siCard").hidden, true);

  h.advance(1000);
  h.click("はじめる");
  h.advance(1520 + 1300);
  assert.equal(h.$("siBoard").dataset.state, "input");
  h.pad(0).fire("pointerdown");
  assert.equal(h.$("siBoard").dataset.state, "clear");
  h.advance(1200);
  h.click("やめる");
  assert.equal(h.$("siCard").hidden, false);
  assert.equal(h.$("siCard").children[0].textContent, "1");
  assert.ok(statTexts(h).some(t => t.includes("あと2ラウンドでニワトリ級")), statTexts(h).join(" / "));
});

test("simon screen: a double tap on 設定 does not start a new game", () => {
  const h = simonScreen();
  h.advance(1000);
  h.click("はじめる");
  h.advance(1520 + 1300);
  h.pad(2).fire("pointerdown");
  h.advance(2000);
  assert.equal(h.$("siCard").hidden, false, "a wrong pad ends the game");
  h.advance(500);
  h.click("設定");
  h.advance(120);
  h.click("はじめる");
  assert.equal(h.$("siSetup").hidden, false, "still on setup");
});

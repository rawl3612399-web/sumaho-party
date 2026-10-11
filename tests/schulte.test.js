const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/schulte-rules.js");

/* Seeded random source (mulberry32) so every run is repeatable. */
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
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const sorted = (list) => [...list].sort((a, b) => a - b);
const where = (g, n) => g.cells.indexOf(n);

/* Plays a whole board in order, one correct tap every `stepMs`. */
function playThrough(g, r, stepMs = 500) {
  let game = g;
  const outcomes = [];
  for (let n = 1; n <= g.count; n++) {
    const res = S.tap(game, where(game, n), n * stepMs, r);
    game = res.game;
    outcomes.push(res.outcome);
  }
  return { game, outcomes };
}

/* ---------- board ---------- */
test("schulte: every grid holds each number 1..N exactly once (many seeds, every size)", () => {
  S.SIZES.forEach(size => {
    for (let seed = 1; seed <= 300; seed++) {
      const grid = S.newGrid(size, seeded(seed));
      assert.equal(grid.length, size * size);
      assert.deepEqual(sorted(grid), range(size * size));
    }
  });
});

test("schulte: grids are actually shuffled", () => {
  const seen = new Set(Array.from({ length: 50 }, (_, i) => S.newGrid(5, seeded(i + 1)).join(",")));
  assert.ok(seen.size > 45, "different seeds give different boards");
  assert.notEqual(S.newGrid(5, seeded(7)).join(","), range(25).join(","));
});

test("schulte: newGame starts at 1 with no mistakes; bad input throws", () => {
  const g = S.newGame(4, "normal", seeded(3));
  assert.equal(g.count, 16);
  assert.equal(g.next, 1);
  assert.equal(g.mistakes, 0);
  assert.deepEqual(g.marks, []);
  assert.equal(S.remaining(g), 16);
  assert.throws(() => S.newGame(6, "normal"), /マスの数/);
  assert.throws(() => S.newGame(2, "normal"), /マスの数/);
  assert.throws(() => S.newGame("5", "normal"), /マスの数/);
  assert.throws(() => S.newGame(5, "hard"), /ルール/);
});

/* ---------- tapping ---------- */
test("schulte: the right number advances; wrong numbers count a miss and do not advance", () => {
  const g = S.newGame(3, "normal", seeded(11));
  const ok = S.tap(g, where(g, 1), 400);
  assert.equal(ok.outcome, "ok");
  assert.equal(ok.game.next, 2);
  assert.deepEqual(ok.game.marks, [400]);
  assert.equal(g.next, 1, "the input game is untouched");

  const miss = S.tap(ok.game, where(ok.game, 5), 600);
  assert.equal(miss.outcome, "miss");
  assert.equal(miss.game.mistakes, 1);
  assert.equal(miss.game.next, 2);
  assert.deepEqual(miss.game.marks, [400]);
  assert.equal(ok.game.mistakes, 0, "the input game is untouched");
});

test("schulte: tapping a cell that is already found is ignored (no penalty)", () => {
  const g = S.newGame(5, "normal", seeded(5));
  const after = S.tap(g, where(g, 1), 300).game;
  const again = S.tap(after, where(after, 1), 500);
  assert.equal(again.outcome, "done");
  assert.equal(again.game, after);
  assert.equal(again.game.mistakes, 0);
  assert.equal(S.isDone(after, where(after, 1)), true);
  assert.equal(S.isDone(after, where(after, 2)), false);
});

test("schulte: the last number clears the board; more taps throw", () => {
  S.SIZES.forEach(size => S.VARIANTS.forEach(variant => {
    const r = seeded(size * 10 + variant.length);
    const { game, outcomes } = playThrough(S.newGame(size, variant, r), r);
    assert.equal(outcomes[outcomes.length - 1], "clear");
    assert.ok(outcomes.slice(0, -1).every(o => o === "ok"));
    assert.equal(S.finished(game), true);
    assert.equal(S.remaining(game), 0);
    assert.equal(game.marks.length, size * size);
    assert.throws(() => S.tap(game, 0, 99999), /全部/);
  }));
});

test("schulte: tap rejects bad cells and times", () => {
  const g = S.newGame(3, "normal", seeded(2));
  assert.throws(() => S.tap(g, -1, 0), /マスの場所/);
  assert.throws(() => S.tap(g, 9, 0), /マスの場所/);
  assert.throws(() => S.tap(g, 1.5, 0), /マスの場所/);
  assert.throws(() => S.tap(g, 0, -5), /時間/);
  assert.throws(() => S.tap(g, 0, NaN), /時間/);
  assert.throws(() => S.tap(null, 0, 0), /はじまって/);
});

test("schulte: ふつう and 消える never move numbers", () => {
  ["normal", "vanish"].forEach(variant => {
    const r = seeded(21);
    const g = S.newGame(5, variant, r);
    let game = g;
    for (let n = 1; n <= 10; n++) game = S.tap(game, where(game, n), n * 100, r).game;
    assert.deepEqual(game.cells, g.cells);
  });
});

test("schulte: シャッフル moves only the numbers still to find, and keeps them all (many seeds)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = seeded(seed);
    let game = S.newGame(5, "shuffle", r);
    let moved = 0;
    for (let n = 1; n < game.count; n++) {
      const before = game;
      game = S.tap(game, where(game, n), n * 100, r).game;
      assert.deepEqual(sorted(game.cells), range(25));
      before.cells.forEach((v, i) => {
        if (v <= n) assert.equal(game.cells[i], v, "found cells stay put");
        else assert.ok(game.cells[i] > n, "open cells only get open numbers");
      });
      if (game.cells.some((v, i) => v !== before.cells[i])) moved++;
    }
    assert.ok(moved > 15, "the board really changes during a game");
  }
});

test("schulte: reshuffle does not change its input", () => {
  const cells = [3, 1, 2, 4];
  const out = S.reshuffle(cells, 3, seeded(4));
  assert.deepEqual(cells, [3, 1, 2, 4]);
  assert.equal(out[1], 1);
  assert.equal(out[2], 2);
  assert.deepEqual(sorted([out[0], out[3]]), [3, 4]);
});

/* ---------- time and score ---------- */
test("schulte: each miss adds exactly one second", () => {
  let game = S.newGame(3, "normal", seeded(8));
  assert.equal(S.totalMs(game, 1234.4), 1234);
  const wrong = game.cells.findIndex(v => v !== 1);
  game = S.tap(game, wrong, 100).game;
  game = S.tap(game, wrong, 200).game;
  assert.equal(game.mistakes, 2);
  assert.equal(S.PENALTY_MS, 1000);
  assert.equal(S.penaltyMs(game), 2000);
  assert.equal(S.totalMs(game, 5000), 7000);
  assert.throws(() => S.totalMs(game, -1), /時間/);
});

test("schulte: splits, slowest number and accuracy", () => {
  let game = S.newGame(3, "normal", seeded(9));
  const times = [400, 900, 3100, 3500, 4000, 4300, 4700, 5100, 5600];
  times.forEach((t, i) => { game = S.tap(game, where(game, i + 1), t).game; });
  assert.deepEqual(S.splits(game), [400, 500, 2200, 400, 500, 300, 400, 400, 500]);
  assert.deepEqual(S.slowest(game), { n: 3, ms: 2200 });
  assert.equal(S.accuracy(game), 1);
  assert.equal(S.slowest(S.newGame(3, "normal")), null);
  assert.equal(S.accuracy(S.newGame(3, "normal")), 1);
  const missed = { ...game, mistakes: 3 };
  assert.equal(S.accuracy(missed), 9 / 12);
});

test("schulte: time text shows hundredths, cut not rounded", () => {
  assert.equal(S.timeText(0), "0.00");
  assert.equal(S.timeText(9), "0.00");
  assert.equal(S.timeText(1239), "1.23");
  assert.equal(S.timeText(18420), "18.42");
  assert.equal(S.timeText(59999), "59.99");
  assert.equal(S.timeText(60000), "1:00.00");
  assert.equal(S.timeText(62345), "1:02.34");
  assert.equal(S.timeText(-5), "0.00");
  assert.equal(S.timeText(NaN), "0.00");
});

/* ---------- ranks ---------- */
test("schulte: rank limits for a 5×5 ふつう board", () => {
  assert.deepEqual(S.rankLimits(5, "normal"), [12500, 17500, 22500, 30000, 42500]);
  assert.deepEqual(S.rankLimits(3, "normal"), [2700, 3780, 4860, 6480, 9180]);
  assert.deepEqual(S.rankLimits(4, "normal"), [6400, 8960, 11520, 15360, 21760]);
});

test("schulte: rank titles switch exactly at the limits", () => {
  S.SIZES.forEach(size => S.VARIANTS.forEach(variant => {
    const limits = S.rankLimits(size, variant);
    limits.forEach((limit, i) => {
      assert.equal(S.rankFor(limit, size, variant).index, i);
      assert.equal(S.rankFor(limit + 1, size, variant).index, i + 1);
    });
    assert.equal(S.rankFor(0, size, variant).title, "神の目級");
    assert.equal(S.rankFor(10 * 60 * 1000, size, variant).title, "ナマケモノ級");
  }));
});

test("schulte: limits get stricter on smaller boards; シャッフル is more lenient, 消える stricter", () => {
  S.VARIANTS.forEach(v => {
    const [l3, l4, l5] = S.SIZES.map(s => S.rankLimits(s, v));
    l3.forEach((x, i) => assert.ok(x < l4[i] && l4[i] < l5[i]));
  });
  S.SIZES.forEach(s => {
    const n = S.rankLimits(s, "normal");
    const sh = S.rankLimits(s, "shuffle");
    const va = S.rankLimits(s, "vanish");
    n.forEach((x, i) => assert.ok(va[i] < x && x < sh[i]));
    n.slice(1).forEach((x, i) => assert.ok(x > n[i], "limits rise rank by rank"));
  });
  assert.equal(new Set(S.RANKS.map(r => r.title)).size, S.RANKS.length);
});

test("schulte: next rank tells how much faster to go", () => {
  assert.equal(S.nextRank(12000, 5, "normal"), null);
  assert.deepEqual(S.nextRank(20000, 5, "normal"), { title: "ハヤブサ級", gapMs: 2500 });
  assert.deepEqual(S.nextRank(99999, 5, "normal"), { title: "カメ級", gapMs: 57499 });
  assert.throws(() => S.rankFor(-1, 5, "normal"), /時間/);
  assert.throws(() => S.rankFor(1000, 7, "normal"), /マスの数/);
});

/* ---------- records and settings ---------- */
test("schulte: records keep only valid entries per size and variant", () => {
  assert.deepEqual(S.normalizeRecords(null), {});
  assert.deepEqual(S.normalizeRecords("x"), {});
  assert.deepEqual(S.normalizeRecords([1, 2]), {});
  const clean = S.normalizeRecords({
    "5-normal": { ms: 18000, mistakes: 1, extra: true },
    "3-shuffle": { ms: -3, mistakes: 0 },
    "4-vanish": { ms: 9000.5, mistakes: 0 },
    "4-normal": { ms: 9000, mistakes: "2" },
    "9-normal": { ms: 9000, mistakes: 0 }
  });
  assert.deepEqual(clean, { "5-normal": { ms: 18000, mistakes: 1 } });
  assert.equal(S.RECORD_KEYS.length, 9);
  assert.deepEqual(S.bestOf(clean, 5, "normal"), { ms: 18000, mistakes: 1 });
  assert.equal(S.bestOf(clean, 3, "normal"), null);
});

test("schulte: a faster time is a new record; ties and slower times are not", () => {
  const first = S.applyRecord({}, 5, "normal", { ms: 20000, mistakes: 2 });
  assert.equal(first.isNew, true);
  assert.equal(first.previous, null);
  assert.deepEqual(first.records, { "5-normal": { ms: 20000, mistakes: 2 } });

  const slower = S.applyRecord(first.records, 5, "normal", { ms: 21000, mistakes: 0 });
  assert.equal(slower.isNew, false);
  assert.deepEqual(slower.records, first.records);
  assert.equal(S.applyRecord(first.records, 5, "normal", { ms: 20000, mistakes: 0 }).isNew, false);

  const faster = S.applyRecord(first.records, 5, "normal", { ms: 15000, mistakes: 0 });
  assert.equal(faster.isNew, true);
  assert.deepEqual(faster.previous, { ms: 20000, mistakes: 2 });
  assert.deepEqual(first.records, { "5-normal": { ms: 20000, mistakes: 2 } }, "input untouched");

  const other = S.applyRecord(faster.records, 3, "vanish", { ms: 4000, mistakes: 0 });
  assert.equal(other.isNew, true);
  assert.equal(Object.keys(other.records).length, 2);
  assert.throws(() => S.applyRecord({}, 5, "normal", { ms: 0, mistakes: 0 }), /記録/);
  assert.throws(() => S.applyRecord({}, 5, "normal", null), /記録/);
  assert.throws(() => S.applyRecord({}, 5, "nope", { ms: 10, mistakes: 0 }), /ルール/);
});

test("schulte: settings fall back to 5×5 ふつう", () => {
  assert.deepEqual(S.normalizeSettings(null), { size: 5, variant: "normal" });
  assert.deepEqual(S.normalizeSettings({ size: 3, variant: "vanish" }), { size: 3, variant: "vanish" });
  assert.deepEqual(S.normalizeSettings({ size: 8, variant: "x" }), { size: 5, variant: "normal" });
  assert.deepEqual(S.normalizeSettings({ size: "4", variant: "shuffle" }), { size: 5, variant: "shuffle" });
  assert.equal(S.VARIANT_LABELS.shuffle, "シャッフル");
});

/* Regression: a finished run over an hour (or with absurd misses) made applyRecord throw inside finish(),
 * which left the screen stuck on the board with the clock stopped. recordRun keeps it out of the records instead. */
test("schulte: recordRun never throws for a finished run that is too long to store", () => {
  const base = { "5-normal": { ms: 20000, mistakes: 0 } };
  const long = S.recordRun(base, 5, "normal", { ms: 2 * 60 * 60 * 1000, mistakes: 0 });
  assert.equal(long.isNew, false);
  assert.deepEqual(long.previous, { ms: 20000, mistakes: 0 });
  assert.deepEqual(long.records, base);
  const fresh = S.recordRun({}, 4, "vanish", { ms: 4e6, mistakes: 12000 });
  assert.equal(fresh.isNew, false);
  assert.equal(fresh.previous, null);
  assert.deepEqual(fresh.records, {});
  const ok = S.recordRun(base, 5, "normal", { ms: 15000, mistakes: 1 });
  assert.equal(ok.isNew, true);
  assert.deepEqual(ok.records["5-normal"], { ms: 15000, mistakes: 1 });
  assert.throws(() => S.recordRun({}, 6, "normal", { ms: 4e6, mistakes: 0 }), /マスの数/);
  assert.throws(() => S.applyRecord({}, 5, "normal", { ms: 2 * 60 * 60 * 1000, mistakes: 0 }), /記録/);
});

/* ---------- screen regressions: the real screen module on a tiny fake DOM with a fake clock ---------- */
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function schulteScreen() {
  const ids = new Map();
  const calls = { scroll: 0, countdown: 0, intensify: 0 };
  const pending = [];
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
    appendChild(c) { this.children.push(c); return c; }
    setAttribute() {}
    remove() {}
    closest(sel) { return this.className.split(" ").includes(sel.slice(1)) ? this : null; }
    get firstElementChild() { return this.children[0]; }
  }
  const get = (id) => ids.get(id) || ids.set(id, new El()).get(id);
  get("scProgress").children = [new El("span")];
  const store = new Map();
  const ctx = vm.createContext({
    document: { getElementById: get, createElement: (t) => new El(t), addEventListener() {}, hidden: false },
    window: { scrollTo: () => { calls.scroll += 1; } }, navigator: {},
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    performance: { now: () => now },
    setTimeout: (fn, ms = 0) => { timers = [...timers, { id: nextId, at: now + ms, fn }]; return nextId++; },
    clearTimeout: (id) => { timers = timers.filter(t => t.id !== id); },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    Sound: { ensure() {}, sfx() {}, tone() {}, hiss() {}, ctx: () => null, hz: (m) => m, vibrate() {} },
    Music: { play() {}, stop() {}, intensify: () => { calls.intensify += 1; } },
    Fx: { pop() {}, confetti() {}, replay() {}, countdown: () => { calls.countdown += 1; return new Promise(r => pending.push(r)); } }
  });
  ["random.js", "shared.js", "schulte-rules.js", "schulte.js"].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8"), ctx, { filename: f }));
  const game = vm.runInContext("Schulte.init(); Schulte", ctx);
  function advance(ms) {
    const end = now + ms;
    for (let due = timers.find(t => t.at <= end); due; due = [...timers].sort((a, b) => a.at - b.at).find(t => t.at <= end)) {
      timers = timers.filter(t => t !== due);
      now = Math.max(now, due.at);
      due.fn();
    }
    now = end;
  }
  const flush = () => new Promise(r => setImmediate(r));
  const endCountdown = async () => { pending.shift()(); await flush(); };
  const button = (label) => get("scActions").children.find(b => b.textContent === label);
  const tapNumber = (n) => get("scGrid").fire("pointerdown", { target: get("scGrid").children.find(c => c.textContent === String(n)) });
  const pick = (chips, label) => get(chips).children.find(c => c.textContent === label).fire("click");
  return { $: get, game, advance, flush, endCountdown, button, tapNumber, pick, calls, pending, store };
}
async function smallGame(h) {
  h.advance(1000);
  h.pick("scSizeChips", "3×3");
  h.button("はじめる").fire("click");
  await h.flush();
  await h.endCountdown();
}

test("schulte screen: やめる is off during the countdown, so a double tap on はじめる cannot quit", async () => {
  const h = schulteScreen();
  h.advance(1000);
  h.button("はじめる").fire("click");
  assert.equal(h.button("やめる").disabled, true);
  assert.equal(h.$("scSetup").hidden, true);
  assert.equal(h.calls.scroll, 1, "starting scrolls up so the timer is not under the top bar on a small phone");
});

test("schulte screen: leaving during the countdown and starting again never runs two countdowns at once", async () => {
  const h = schulteScreen();
  h.advance(1000);
  h.button("はじめる").fire("click");
  await h.flush();
  assert.equal(h.pending.length, 1);
  h.game.leave();
  h.advance(1000);
  h.button("はじめる").fire("click");
  await h.flush();
  assert.equal(h.pending.length, 1, "the new countdown waits for the old one to leave the screen");
  await h.endCountdown();
  assert.equal(h.pending.length, 1, "then the new one runs");
  await h.endCountdown();
  assert.equal(h.$("scHint").textContent, "まちがえると1秒プラス");
});

test("schulte screen: a run over an hour still reaches the results (it is just not saved)", async () => {
  const h = schulteScreen();
  await smallGame(h);
  for (let n = 1; n <= 8; n++) h.tapNumber(n);
  h.advance(2 * 60 * 60 * 1000);
  h.tapNumber(9);
  h.advance(600);
  assert.equal(h.$("scCard").hidden, false);
  assert.equal(h.$("scTitle").textContent, "クリア！");
  assert.equal(h.store.get("schulte.records"), undefined);
});

test("schulte screen: a double tap on 設定 does not start a new game; resuming in the last five keeps the music up", async () => {
  const h = schulteScreen();
  await smallGame(h);
  for (let n = 1; n <= 5; n++) h.tapNumber(n);
  assert.equal(h.calls.intensify, 1, "four numbers left");
  h.advance(500);
  h.button("一時停止").fire("click");
  h.advance(500);
  h.button("つづける").fire("click");
  assert.equal(h.calls.intensify, 2, "the restarted music is intense again");
  for (let n = 6; n <= 9; n++) h.tapNumber(n);
  h.advance(600);
  assert.equal(h.$("scTitle").textContent, "新記録！");
  h.advance(500);
  h.button("設定").fire("click");
  h.advance(120);
  h.button("はじめる").fire("click");
  assert.equal(h.$("scSetup").hidden, false);
  assert.equal(h.calls.countdown, 1, "no second game started");
});

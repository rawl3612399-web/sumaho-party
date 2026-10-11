const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/memnum-rules.js");

/* Repeatable random source. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}
/* Seeded generator for long runs (mulberry32). */
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 13);
const snapshot = (x) => JSON.parse(JSON.stringify(x));

/* Types an answer through the keypad rules, then checks it. */
function typeAnswer(answer, len) {
  return answer.split("").reduce((entry, key) => M.enter(entry, key, len), "");
}
/* Taps 1..n in order and returns every tap result. */
function playBoard(cells) {
  let board = M.newBoard(cells);
  const results = cells.map((_, i) => {
    const out = M.tap(board, cells[i]);
    board = out.board;
    return out.result;
  });
  return { board, results };
}

/* ---------- constants ---------- */
test("memnum: modes, lives, start lengths and grid size", () => {
  assert.deepEqual([...M.MODES], ["digits", "chimp"]);
  assert.equal(M.LIVES, 3);
  assert.deepEqual({ ...M.START }, { digits: 3, chimp: 4 });
  assert.ok(M.MAX.digits >= 15 && M.MAX.chimp >= 15);
  assert.equal(M.CELLS, M.COLS * M.ROWS);
  assert.ok(M.MAX.chimp <= M.CELLS, "every number fits on the grid");
  [M.MODES, M.START, M.MAX, M.RANKS, M.RANKS.digits, M.RANKS.chimp].forEach(x => assert.ok(Object.isFrozen(x)));
});

/* ---------- digits ---------- */
test("memnum: show time is 0.6 s per digit with a 1.2 s minimum", () => {
  assert.equal(M.showMs(1), 1200);
  assert.equal(M.showMs(2), 1200);
  assert.equal(M.showMs(3), 1800);
  assert.equal(M.showMs(10), 6000);
  assert.throws(() => M.showMs(0));
  assert.throws(() => M.showMs(M.MAX.digits + 1));
  assert.throws(() => M.showMs(2.5));
});

test("memnum: digit strings have the right length, only digits, no triple repeats (many seeds)", () => {
  SEEDS.forEach(seed => {
    const r = seeded(seed);
    for (let len = 1; len <= M.MAX.digits; len++) {
      const s = M.makeDigits(len, r);
      assert.equal(s.length, len);
      assert.match(s, /^\d+$/);
      assert.doesNotMatch(s, /(\d)\1\1/, `no digit three times in a row: ${s}`);
    }
  });
});

test("memnum: digit generator uses every digit and breaks forced runs", () => {
  const seen = new Set();
  const r = seeded(42);
  for (let i = 0; i < 200; i++) M.makeDigits(10, r).split("").forEach(d => seen.add(d));
  assert.equal(seen.size, 10);
  assert.equal(M.makeDigits(6, () => 0), "001001", "a constant source still avoids a third 0");
  assert.throws(() => M.makeDigits(0));
  assert.throws(() => M.makeDigits("3"));
});

test("memnum: keypad entry appends, deletes and stops at the length", () => {
  assert.equal(M.enter("", "4", 3), "4");
  assert.equal(M.enter("12", "3", 3), "123");
  assert.equal(M.enter("123", "4", 3), "123", "full entry ignores more digits");
  assert.equal(M.enter("123", M.DELETE, 3), "12");
  assert.equal(M.enter("", M.DELETE, 3), "");
  assert.equal(M.enter("1", "x", 3), "1", "unknown keys are ignored");
  assert.equal(M.enter("1", "12", 3), "1");
  assert.throws(() => M.enter("1a", "2", 3));
  assert.throws(() => M.enter(null, "2", 3));
  assert.throws(() => M.enter("", "2", 0));
});

test("memnum: checking a typed answer marks each position", () => {
  assert.deepEqual(M.checkDigits("123", "123"), { ok: true, marks: [true, true, true] });
  assert.deepEqual(M.checkDigits("123", "124"), { ok: false, marks: [true, true, false] });
  assert.deepEqual(M.checkDigits("0705", "07"), { ok: false, marks: [true, true, false, false] });
  assert.deepEqual(M.checkDigits("123", "1234"), { ok: false, marks: [true, true, true] });
  assert.throws(() => M.checkDigits("", "1"));
  assert.throws(() => M.checkDigits("12a", "12"));
  assert.throws(() => M.checkDigits("123", 123));
});

/* ---------- chimp grid ---------- */
test("memnum: numbers are placed on distinct cells inside the grid (many seeds)", () => {
  SEEDS.forEach(seed => {
    const r = seeded(seed);
    for (let n = 1; n <= M.MAX.chimp; n++) {
      const cells = M.placeNumbers(n, r);
      assert.equal(cells.length, n);
      assert.equal(new Set(cells).size, n, "no two numbers share a cell");
      cells.forEach(c => assert.ok(Number.isInteger(c) && c >= 0 && c < M.CELLS));
    }
  });
  assert.throws(() => M.placeNumbers(0));
  assert.throws(() => M.placeNumbers(M.MAX.chimp + 1));
});

test("memnum: placement spreads over the whole grid", () => {
  const used = new Set();
  const r = seeded(7);
  for (let i = 0; i < 200; i++) M.placeNumbers(4, r).forEach(c => used.add(c));
  assert.equal(used.size, M.CELLS);
});

test("memnum: tapping 1 covers the rest; tapping in order clears the board", () => {
  const cells = [10, 3, 27, 0];
  let board = M.newBoard(cells);
  assert.equal(board.covered, false);
  assert.equal(M.numberAt(board, 27), 3);
  assert.equal(M.numberAt(board, 5), 0);
  let out = M.tap(board, 10);
  assert.equal(out.result, "hit");
  assert.equal(out.board.covered, true);
  assert.equal(out.board.next, 2);
  assert.equal(board.covered, false, "old board is untouched");
  board = out.board;
  assert.equal(M.tap(board, 10).result, "none", "a cleared cell does nothing");
  assert.equal(M.tap(board, 5).result, "none", "an empty cell does nothing");
  board = M.tap(board, 3).board;
  board = M.tap(board, 27).board;
  out = M.tap(board, 0);
  assert.equal(out.result, "done");
  assert.equal(out.board.state, "done");
  assert.equal(M.tap(out.board, 0).result, "none", "nothing happens after the round");
});

test("memnum: a wrong number is a miss and remembers the cell", () => {
  const board = M.newBoard([4, 9, 14]);
  const early = M.tap(board, 9);
  assert.equal(early.result, "miss", "starting with 2 is a miss");
  assert.equal(early.board.wrong, 9);
  const mid = M.tap(M.tap(board, 4).board, 14);
  assert.equal(mid.result, "miss");
  assert.equal(mid.board.state, "miss");
  assert.equal(mid.board.next, 2, "the expected number stays visible for the reveal");
  assert.equal(M.tap(mid.board, 9).result, "none");
});

test("memnum: cells show numbers before the first tap and hide them after (many seeds)", () => {
  SEEDS.slice(0, 80).forEach(seed => {
    const cells = M.placeNumbers(9, seeded(seed));
    const fresh = M.newBoard(cells);
    for (let c = 0; c < M.CELLS; c++) {
      const v = M.cellState(fresh, c);
      if (cells.includes(c)) assert.deepEqual(v, { state: "number", num: cells.indexOf(c) + 1, shown: true, tappable: true });
      else assert.deepEqual(v, { state: "empty", num: 0, shown: false, tappable: false });
    }
    const after = M.tap(M.tap(fresh, cells[0]).board, cells[1]).board;
    for (let c = 0; c < M.CELLS; c++) {
      const v = M.cellState(after, c);
      const num = cells.indexOf(c) + 1;
      if (num === 0) assert.equal(v.state, "empty");
      else if (num <= 2) assert.deepEqual([v.state, v.shown, v.tappable], ["cleared", false, false]);
      else assert.deepEqual([v.state, v.shown, v.tappable], ["covered", false, true], "no number leaks while playing");
    }
  });
});

test("memnum: after a miss the reveal marks the wrong cell and the expected one", () => {
  const cells = [0, 6, 12, 18];
  const missed = M.tap(M.tap(M.newBoard(cells), 0).board, 12).board;
  assert.equal(M.cellState(missed, 0, true).state, "cleared");
  assert.equal(M.cellState(missed, 0, true).shown, true);
  assert.equal(M.cellState(missed, 12, true).state, "wrong");
  assert.equal(M.cellState(missed, 6, true).state, "expected");
  assert.equal(M.cellState(missed, 18, true).state, "answer");
  [0, 6, 12, 18].forEach(c => assert.equal(M.cellState(missed, c, true).tappable, false));
  const done = playBoard(cells).board;
  cells.forEach(c => assert.deepEqual(M.cellState(done, c, true).state, "cleared"));
});

test("memnum: board and tap input is validated", () => {
  assert.throws(() => M.newBoard([]));
  assert.throws(() => M.newBoard([1, 1]));
  assert.throws(() => M.newBoard([1, M.CELLS]));
  assert.throws(() => M.newBoard([1.5]));
  assert.throws(() => M.newBoard("1,2"));
  assert.throws(() => M.tap(M.newBoard([1, 2]), -1));
  assert.throws(() => M.tap(M.newBoard([1, 2]), M.CELLS));
});

test("memnum: every generated chimp round is solvable by tapping 1..n (many seeds)", () => {
  SEEDS.forEach(seed => {
    const r = seeded(seed);
    for (let n = M.START.chimp; n <= M.MAX.chimp; n++) {
      const { board, results } = playBoard(M.placeNumbers(n, r));
      assert.deepEqual(results, [...Array(n - 1).fill("hit"), "done"]);
      assert.equal(board.state, "done");
    }
  });
});

/* ---------- game flow ---------- */
test("memnum: a new game starts at the mode's length with 3 lives", () => {
  const d = M.newGame("digits", seeded(1));
  assert.equal(d.level, 3);
  assert.equal(d.lives, 3);
  assert.equal(d.best, 0);
  assert.equal(d.round.answer.length, 3);
  const c = M.newGame("chimp", seeded(1));
  assert.equal(c.level, 4);
  assert.equal(c.round.cells.length, 4);
  assert.throws(() => M.newGame("color"));
});

test("memnum: success adds one; a miss costs a life and repeats the length with new content", () => {
  const r = seeded(3);
  const g0 = M.newGame("digits", r);
  const before = snapshot(g0);
  const g1 = M.settle(g0, true, r);
  assert.deepEqual(snapshot(g0), before, "settle does not change its input");
  assert.equal(g1.level, 4);
  assert.equal(g1.best, 3);
  assert.equal(g1.lives, 3);
  assert.equal(g1.round.answer.length, 4);
  const g2 = M.settle(g1, false, r);
  assert.equal(g2.level, 4);
  assert.equal(g2.lives, 2);
  assert.equal(g2.best, 3);
  assert.equal(g2.round.answer.length, 4);
  assert.deepEqual(g2.history, [{ level: 3, ok: true }, { level: 4, ok: false }]);
  assert.throws(() => M.settle(g2, "yes"));
});

test("memnum: three misses end the game and keep the best", () => {
  const r = seeded(9);
  let g = M.settle(M.newGame("chimp", r), true, r);
  g = M.settle(g, false, r);
  g = M.settle(g, false, r);
  assert.equal(g.over, false);
  g = M.settle(g, false, r);
  assert.equal(g.over, true);
  assert.equal(g.lives, 0);
  assert.equal(g.best, 4);
  assert.equal(g.round, null);
  assert.throws(() => M.settle(g, true));
  assert.deepEqual(M.stats(g), { tries: 4, hits: 1, misses: 3, accuracy: 25 });
});

test("memnum: perfect play clears both modes at the maximum length (many seeds)", () => {
  SEEDS.slice(0, 60).forEach(seed => {
    const r = seeded(seed);
    M.MODES.forEach(mode => {
      let g = M.newGame(mode, r);
      while (!g.over) {
        const ok = mode === "digits"
          ? M.checkDigits(g.round.answer, typeAnswer(g.round.answer, g.level)).ok
          : playBoard(g.round.cells).board.state === "done";
        assert.ok(ok);
        g = M.settle(g, ok, r);
      }
      assert.equal(g.cleared, true);
      assert.equal(g.best, M.MAX[mode]);
      assert.equal(g.lives, M.LIVES);
      assert.equal(M.stats(g).accuracy, 100);
    });
  });
});

test("memnum: quitting ends the game once", () => {
  const g = M.quit(M.settle(M.newGame("digits", seeded(2)), true, seeded(2)));
  assert.equal(g.over, true);
  assert.equal(g.quit, true);
  assert.equal(g.best, 3);
  assert.equal(M.quit(g), g);
  assert.deepEqual(M.stats(M.newGame("digits")), { tries: 0, hits: 0, misses: 0, accuracy: 0 });
});

/* ---------- ranks ---------- */
test("memnum: rank titles from the spec", () => {
  assert.equal(M.rankFor("digits", 9).title, "天才級");
  assert.equal(M.rankFor("digits", 10).title, "天才級");
  assert.equal(M.rankFor("digits", 7).title, "ふつうの大人");
  assert.equal(M.rankFor("digits", 8).title, "記憶力じまん");
  assert.equal(M.rankFor("digits", 0).title, "ウォーミングアップ中");
  assert.equal(M.rankFor("chimp", 7).title, "ふつうの大人");
  assert.equal(M.rankFor("chimp", 12).title, "天才級");
  assert.equal(M.rankFor("chimp", M.MAX.chimp).title, "チンパンジー超え");
});

test("memnum: every possible score has a rank, and ranks only go up", () => {
  M.MODES.forEach(mode => {
    const list = M.RANKS[mode];
    list.forEach((x, i) => {
      assert.ok(typeof x.title === "string" && x.title.length > 0);
      assert.ok(typeof x.note === "string" && x.note.length > 0);
      if (i > 0) assert.ok(x.min < list[i - 1].min, "thresholds are sorted high to low");
    });
    assert.equal(list[list.length - 1].min, 0);
    let prev = list.length;
    for (let s = 0; s <= M.MAX[mode]; s++) {
      const idx = list.indexOf(M.rankFor(mode, s));
      assert.ok(idx >= 0 && idx <= prev, `${mode} ${s}`);
      prev = idx;
    }
  });
  assert.throws(() => M.rankFor("digits", -1));
  assert.throws(() => M.rankFor("digits", 1.5));
  assert.throws(() => M.rankFor("digits", M.MAX.digits + 1));
  assert.throws(() => M.rankFor("other", 3));
});

/* ---------- records ---------- */
test("memnum: records are validated on load", () => {
  assert.deepEqual(M.normalizeRecords(null), { digits: 0, chimp: 0 });
  assert.deepEqual(M.normalizeRecords([5, 6]), { digits: 0, chimp: 0 });
  assert.deepEqual(M.normalizeRecords({ digits: 7, chimp: "9" }), { digits: 7, chimp: 0 });
  assert.deepEqual(M.normalizeRecords({ digits: -1, chimp: 2.5 }), { digits: 0, chimp: 0 });
  assert.deepEqual(M.normalizeRecords({ digits: 999, chimp: 8, extra: 1 }), { digits: 0, chimp: 8 });
});

test("memnum: a higher score is a new record; ties and zero are not", () => {
  const start = { digits: 7, chimp: 0 };
  const a = M.applyRecord(start, "digits", 8);
  assert.equal(a.isNew, true);
  assert.deepEqual(a.records, { digits: 8, chimp: 0 });
  assert.deepEqual(start, { digits: 7, chimp: 0 }, "input is untouched");
  assert.equal(M.applyRecord(start, "digits", 7).isNew, false);
  assert.equal(M.applyRecord(start, "chimp", 0).isNew, false);
  assert.equal(M.applyRecord(null, "chimp", 5).isNew, true);
  assert.throws(() => M.applyRecord(start, "digits", -2));
  assert.throws(() => M.applyRecord(start, "other", 3));
});

test("memnum: rule helpers accept an injected random source", () => {
  assert.equal(M.makeDigits(3, seq(0.15, 0.55, 0.95)), "159");
  assert.deepEqual(M.newGame("digits", seq(0.15, 0.55, 0.95)).round.answer, "159");
});

/* ---------- screen (src/memnum.js) on a tiny fake DOM with a fake clock ---------- */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");

function fakeClock() {
  let now = 1000;
  let id = 0;
  let timers = new Map();
  const due = (end) => [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  return {
    setTimeout: (fn, ms = 0) => { id += 1; timers = new Map([...timers, [id, { at: now + ms, fn }]]); return id; },
    clearTimeout: (k) => { timers = new Map([...timers].filter(([x]) => x !== k)); },
    now: () => now,
    pending: () => timers.size,
    /* Runs due timers in 50 ms steps and lets awaited promises continue between steps. */
    async run(ms) {
      const stop = now + ms;
      while (now < stop) {
        const end = Math.min(stop, now + 50);
        for (let d = due(end); d; d = due(end)) {
          timers = new Map([...timers].filter(([x]) => x !== d[0]));
          now = d[1].at;
          d[1].fn();
        }
        now = end;
        await new Promise(r => setImmediate(r));
      }
    }
  };
}
function fakeNode(tag) {
  const classes = new Set();
  const node = {
    tagName: String(tag).toUpperCase(), children: [], parent: null, hidden: false, disabled: false, type: "", textContent: "",
    dataset: {}, attrs: {}, listeners: {}, style: { setProperty() {} },
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : Boolean(on); if (want) classes.add(c); else classes.delete(c); return want; }
    },
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    setAttribute(k, v) { node.attrs[k] = String(v); },
    addEventListener(type, fn) { node.listeners[type] = [...(node.listeners[type] || []), fn]; },
    fire(type, ev = {}) { (node.listeners[type] || []).forEach(fn => fn({ target: node, button: 0, detail: 1, preventDefault() {}, ...ev })); },
    click() { if (!node.disabled) node.fire("click"); },
    append(...kids) { kids.forEach(k => { k.parent = node; }); node.children = [...node.children, ...kids]; },
    appendChild(k) { node.append(k); return k; },
    replaceChildren(...kids) { node.children = []; node.append(...kids); },
    remove() { if (node.parent) node.parent.children = node.parent.children.filter(k => k !== node); }
  };
  return node;
}
/* Loads the real screen with the real shared helpers and rules; sound, music and effects are spies. */
function loadScreen() {
  const clock = fakeClock();
  const ids = [...read("partials/memnum.html").matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const byId = new Map(ids.map(id => [id, fakeNode("div")]));
  const log = { sfx: [], music: [], confetti: 0 };
  const storage = new Map();
  const ctx = vm.createContext({
    console, Element: class {}, navigator: {}, window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: fakeNode, getElementById: (id) => byId.get(id) || null, addEventListener() {} },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, performance: { now: clock.now },
    Sound: { ensure() {}, ctx: () => null, sfx: (n) => log.sfx.push(n), tone() {}, hz: () => 440 },
    Music: { play: (x) => log.music.push(x), stop: () => log.music.push("stop") },
    Fx: { pop() {}, shake() {}, flash() {}, confetti: () => { log.confetti += 1; }, countdown: () => new Promise(r => clock.setTimeout(r, 2650)) }
  });
  ["random.js", "shared.js", "memnum-rules.js", "memnum.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const $ = (id) => byId.get(id);
  const t = {
    MemNum: vm.runInContext("MemNum", ctx), clock, log, storage, $,
    button: (text) => $("mnActions").children.find(b => b.textContent === text),
    actions: () => $("mnActions").children.map(b => b.textContent),
    title: () => $("mnTitle").textContent,
    /* Types a digit string on the keypad (keys react on pointerdown) and presses 決定. */
    type(digits) {
      [...digits].forEach(d => $("mnKeypad").children[d === "0" ? 10 : Number(d) - 1].fire("pointerdown"));
      $("mnKeypad").children[11].fire("pointerdown");
    },
    /* From the start of a digits round: wait for the flash, then answer right or wrong. */
    async answer(right) {
      await clock.run(700 + M.showMs(Number($("mnLevel").textContent.replace(/\D/g, ""))) + 50);
      const shown = $("mnDigits").textContent;
      t.type(right ? shown : [...shown].map(d => String((Number(d) + 1) % 10)).join(""));
    }
  };
  return t;
}
async function startDigits(t) {
  t.MemNum.init();
  t.button("はじめる").click();
  await t.clock.run(2700);
}

test("memnum screen: every id the screen looks up is in the partial, and every id is prefixed", () => {
  const ids = [...read("partials/memnum.html").matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  ids.forEach(id => assert.ok(id === "modeMemNum" || /^mn[A-Z]/.test(id), id));
  const used = [...read("memnum.js").matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]);
  used.forEach(id => assert.ok(ids.includes(id), `missing #${id}`));
});

test("memnum screen: a double tap on つづける does not hit the やめる that replaces it", async () => {
  const t = loadScreen();
  await startDigits(t);
  await t.answer(false);
  assert.equal(t.title(), "ざんねん…");
  await t.clock.run(400);
  t.button("つづける").click();
  t.button("やめる").click();
  assert.equal(t.title(), "よく見て…", "the second tap of the double tap is ignored");
  assert.deepEqual(t.actions(), ["やめる"]);
  await t.clock.run(400);
  t.button("やめる").click();
  assert.equal($hint(t), "とちゅうでやめました", "a real tap on やめる still quits");
});
const $hint = (t) => t.$("mnHint").textContent;

test("memnum screen: a double tap on 結果を見る does not skip the results through もう一回", async () => {
  const t = loadScreen();
  await startDigits(t);
  for (let i = 0; i < 3; i++) {
    await t.answer(false);
    await t.clock.run(400);
    if (i < 2) t.button("つづける").click();
  }
  t.button("結果を見る").click();
  assert.deepEqual(t.actions(), ["設定", "もう一回"]);
  t.button("もう一回").click();
  assert.deepEqual(t.actions(), ["設定", "もう一回"], "still on the results");
  assert.ok(!t.$("mnDetails").hidden);
  await t.clock.run(400);
  t.button("もう一回").click();
  assert.equal(t.title(), "準備はいい？");
});

test("memnum screen: leaving mid-round stops every timer and keeps the best so far", async () => {
  const t = loadScreen();
  await startDigits(t);
  await t.answer(true);
  assert.equal(t.title(), "正解！");
  await t.clock.run(1000 + 700 + 100);
  assert.equal(t.title(), "覚えて！");
  t.MemNum.leave();
  assert.equal(t.clock.pending(), 0, "no timer is left running");
  assert.ok(!t.$("mnSetup").hidden);
  assert.deepEqual(JSON.parse(t.storage.get("memnum.records")), { digits: 3, chimp: 0 });
  await t.clock.run(5000);
  assert.ok(!t.$("mnSetup").hidden, "nothing moves the screen afterwards");
});

test("memnum screen: 11+ digits switch the answer slots to two rows", async () => {
  const t = loadScreen();
  await startDigits(t);
  const rows = {};
  for (let len = 3; len <= 11; len++) {
    await t.clock.run(700 + M.showMs(len) + 50);
    rows[len] = t.$("mnSlots").dataset.rows;
    t.type(t.$("mnDigits").textContent);
    assert.equal(t.title(), "正解！", `length ${len}`);
    await t.clock.run(1000);
  }
  assert.equal(rows[10], "1");
  assert.equal(rows[11], "2");
});

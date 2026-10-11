const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/stroop-rules.js");

/* Seeded random source (mulberry32) so long runs are repeatable. */
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
/* Repeatable random source from a fixed list. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}
function deepFreeze(o) {
  Object.values(o).forEach(v => { if (v && typeof v === "object") deepFreeze(v); });
  return Object.freeze(o);
}
/* Plays `count` answers, all right or all wrong, with a fixed reaction time. */
function play(state, count, right, ms = 800, r = seeded(9)) {
  let s = state;
  for (let i = 0; i < count; i++) {
    const want = S.answerOf(s.trial, s.mode);
    const pick = right ? want : S.COLOR_IDS.find(id => id !== want);
    s = S.answer(s, pick, ms, r).state;
  }
  return s;
}

/* ---------- colors ---------- */
test("stroop: four distinct colors with the agreed words and tokens", () => {
  assert.deepEqual(S.COLORS.map(c => c.word), ["あか", "あお", "みどり", "きいろ"]);
  assert.deepEqual(S.COLORS.map(c => c.token), ["--c-red", "--c-blue", "--c-green", "--c-amber"]);
  assert.equal(new Set(S.COLOR_IDS).size, 4);
  assert.deepEqual(S.MODE_IDS, ["ink", "word"]);
  assert.deepEqual(S.DURATIONS, [30, 60]);
});

/* ---------- trial generation ---------- */
test("stroop: every trial is valid, never repeats the word or the ink back to back", () => {
  [1, 2, 3, 42, 777].forEach(seed => {
    const r = seeded(seed);
    let prev = null;
    for (let i = 0; i < 4000; i++) {
      const t = S.nextTrial(prev, r);
      assert.ok(S.COLOR_IDS.includes(t.word) && S.COLOR_IDS.includes(t.ink));
      assert.equal(t.congruent, t.word === t.ink, "congruent flag matches the card");
      if (prev) {
        assert.notEqual(t.word, prev.word, "word changes every card");
        assert.notEqual(t.ink, prev.ink, "ink changes every card");
      }
      prev = t;
    }
  });
});

test("stroop: about 75% of trials are mismatched, and every word and ink shows up", () => {
  const r = seeded(2024);
  let prev = null;
  let mismatched = 0;
  const words = new Map();
  const inks = new Map();
  const N = 20000;
  for (let i = 0; i < N; i++) {
    prev = S.nextTrial(prev, r);
    if (!prev.congruent) mismatched++;
    words.set(prev.word, (words.get(prev.word) || 0) + 1);
    inks.set(prev.ink, (inks.get(prev.ink) || 0) + 1);
  }
  const ratio = mismatched / N;
  assert.ok(ratio > 0.73 && ratio < 0.77, `mismatched ratio ${ratio}`);
  S.COLOR_IDS.forEach(id => {
    assert.ok(words.get(id) > N * 0.18, `word ${id} is rare`);
    assert.ok(inks.get(id) > N * 0.18, `ink ${id} is rare`);
  });
});

test("stroop: extreme random values still give valid cards", () => {
  [() => 0, () => 0.999999, seq(0.8, 0, 0.999999), seq(0.9, 0.5, 0.1)].forEach(r => {
    let prev = null;
    for (let i = 0; i < 50; i++) {
      const t = S.nextTrial(prev, r);
      if (prev) assert.ok(t.word !== prev.word && t.ink !== prev.ink);
      prev = t;
    }
  });
  assert.equal(S.nextTrial(null, () => 0.9).congruent, true, "r >= 0.75 makes a matching card");
  assert.equal(S.nextTrial(null, () => 0.1).congruent, false);
});

test("stroop: bad previous cards are rejected", () => {
  assert.throws(() => S.nextTrial({ word: "pink", ink: "red" }), /色/);
  assert.throws(() => S.nextTrial("red"), /問題/);
});

test("stroop: the answer depends on the mode", () => {
  const t = { word: "blue", ink: "red", congruent: false };
  assert.equal(S.answerOf(t, "ink"), "red");
  assert.equal(S.answerOf(t, "word"), "blue");
  assert.throws(() => S.answerOf(t, "sound"), /答え方/);
});

/* ---------- a round ---------- */
test("stroop: new round checks mode and time", () => {
  const g = S.newGame("ink", 30, seeded(1));
  assert.equal(g.correct, 0);
  assert.equal(g.wrong, 0);
  assert.equal(g.combo, 0);
  assert.equal(S.timeLeftMs(g, 0), 30000);
  assert.throws(() => S.newGame("ink", 45), /時間/);
  assert.throws(() => S.newGame("color", 30), /答え方/);
});

test("stroop: right answers score, build a combo and record reaction time", () => {
  const g = deepFreeze(S.newGame("ink", 30, seeded(3)));
  const before = JSON.stringify(g);
  const res = S.answer(g, g.trial.ink, 640.4, seeded(4));
  assert.equal(res.ok, true);
  assert.equal(res.state.correct, 1);
  assert.equal(res.state.combo, 1);
  assert.equal(res.state.rtSum, 640);
  assert.equal(JSON.stringify(g), before, "input state is untouched");
  assert.ok(res.state.trial.word !== g.trial.word && res.state.trial.ink !== g.trial.ink, "a new card is drawn");
  const s = play(res.state, 6, true);
  assert.equal(s.correct, 7);
  assert.equal(s.combo, 7);
  assert.equal(s.bestCombo, 7);
});

test("stroop: in word mode the word is the right answer", () => {
  const g = S.newGame("word", 30, seq(0.1, 0.3, 0.6));
  assert.equal(S.answer(g, g.trial.word, 500).ok, true);
  if (g.trial.word !== g.trial.ink) assert.equal(S.answer(g, g.trial.ink, 500).ok, false);
});

test("stroop: a mistake resets the combo, keeps the best, and costs one second", () => {
  let s = play(S.newGame("ink", 30, seeded(5)), 5, true);
  s = play(s, 1, false);
  assert.equal(s.combo, 0);
  assert.equal(s.bestCombo, 5);
  assert.equal(s.wrong, 1);
  assert.equal(s.correct, 5);
  assert.equal(S.timeLeftMs(s, 10000), 30000 - 10000 - S.PENALTY_MS);
  assert.equal(S.timeLeftMs(play(s, 40, false), 0), 0, "never below zero");
});

test("stroop: reaction times are capped and bad input is rejected", () => {
  const g = S.newGame("ink", 30, seeded(6));
  assert.equal(S.answer(g, g.trial.ink, 99999).state.rtSum, S.MAX_REACTION_MS);
  assert.throws(() => S.answer(g, "pink", 500), /色/);
  assert.throws(() => S.answer(g, "red", -1), /反応時間/);
  assert.throws(() => S.answer(g, "red", NaN), /反応時間/);
  assert.throws(() => S.timeLeftMs(g, -5), /経過時間/);
});

test("stroop: summary gives accuracy and average speed of right answers", () => {
  let s = play(S.newGame("ink", 30, seeded(7)), 3, true, 600);
  s = play(s, 1, false, 100);
  const sum = S.summary(s);
  assert.equal(sum.correct, 3);
  assert.equal(sum.wrong, 1);
  assert.equal(sum.accuracy, 75);
  assert.equal(sum.avgMs, 600, "wrong answers do not count toward speed");
  assert.equal(sum.bestCombo, 3);
  const empty = S.summary(S.newGame("ink", 30));
  assert.equal(empty.accuracy, 0);
  assert.equal(empty.avgMs, null);
});

/* ---------- ranks ---------- */
test("stroop: rank thresholds for 30 seconds in ink mode", () => {
  const title = (n) => S.rankFor(n, 30, "ink").title;
  assert.equal(title(0), "タマゴ級");
  assert.equal(title(11), "タマゴ級");
  assert.equal(title(12), "ヒヨコ級");
  assert.equal(title(20), "金魚級");
  assert.equal(title(27), "インコ級");
  assert.equal(title(33), "インコ級");
  assert.equal(title(34), "クジャク級");
  assert.equal(title(42), "カメレオン級");
  assert.equal(title(200), "カメレオン級");
  assert.deepEqual(S.rankFor(30, 30, "ink").next, { title: "クジャク級", need: 4 });
  assert.equal(S.rankFor(42, 30, "ink").next, null);
  assert.equal(S.rankFor(42, 30, "ink").index, 0);
});

test("stroop: longer rounds and reading mode need more answers", () => {
  assert.equal(S.rankFor(54, 60, "ink").title, "インコ級");
  assert.equal(S.rankFor(53, 60, "ink").title, "金魚級");
  assert.equal(S.rankFor(84, 60, "ink").title, "カメレオン級");
  assert.equal(S.rankFor(42, 30, "word").title, "クジャク級");
  assert.equal(S.rankFor(51, 30, "word").title, "カメレオン級");
  assert.equal(S.rankFor(24, 30, "word").title, "金魚級");
  assert.equal(S.rankFor(23, 30, "word").title, "ヒヨコ級");
});

test("stroop: ranks are ordered and every score gets exactly one", () => {
  S.RANKS.forEach((r, i) => { if (i > 0) assert.ok(r.min < S.RANKS[i - 1].min); });
  assert.equal(S.RANKS[S.RANKS.length - 1].min, 0);
  S.MODE_IDS.forEach(mode => S.DURATIONS.forEach(sec => {
    let last = S.RANKS.length - 1;
    for (let n = 0; n <= 150; n++) {
      const r = S.rankFor(n, sec, mode);
      assert.ok(r.index <= last, "rank never drops as the score rises");
      if (r.next) assert.ok(r.next.need > 0);
      last = r.index;
    }
  }));
  assert.throws(() => S.rankFor(-1, 30, "ink"), /正解数/);
  assert.throws(() => S.rankFor(1.5, 30, "ink"), /正解数/);
  assert.throws(() => S.rankFor(10, 20, "ink"), /時間/);
});

/* ---------- settings and records ---------- */
test("stroop: settings from storage are cleaned", () => {
  assert.deepEqual(S.normalizeSettings(null), { mode: "ink", seconds: 30 });
  assert.deepEqual(S.normalizeSettings({ mode: "word", seconds: 60 }), { mode: "word", seconds: 60 });
  assert.deepEqual(S.normalizeSettings({ mode: "x", seconds: "60" }), { mode: "ink", seconds: 30 });
  assert.deepEqual(S.normalizeSettings([1, 2]), { mode: "ink", seconds: 30 });
});

test("stroop: records from storage are cleaned", () => {
  const clean = S.normalizeRecords({ "ink-30": 31, "word-60": -4, "ink-60": 2.5, "word-30": 5000, extra: 9 });
  assert.deepEqual(clean, { "ink-30": 31, "ink-60": 0, "word-30": S.MAX_RECORD, "word-60": 0 });
  assert.deepEqual(S.normalizeRecords("junk"), { "ink-30": 0, "ink-60": 0, "word-30": 0, "word-60": 0 });
});

test("stroop: a new best replaces the record without touching the input", () => {
  const old = deepFreeze(S.normalizeRecords({ "ink-30": 20 }));
  const better = S.applyRecord(old, "ink", 30, 25);
  assert.equal(better.isNew, true);
  assert.equal(better.previous, 20);
  assert.equal(better.records["ink-30"], 25);
  assert.equal(old["ink-30"], 20);
  const same = S.applyRecord(old, "ink", 30, 20);
  assert.equal(same.isNew, false);
  assert.equal(same.records["ink-30"], 20);
  assert.equal(S.applyRecord(null, "word", 60, 0).isNew, false, "zero is never a record");
  assert.equal(S.applyRecord(null, "word", 60, 1).records["word-60"], 1);
  assert.throws(() => S.applyRecord(old, "ink", 30, -2), /正解数/);
  assert.throws(() => S.applyRecord(old, "ink", 15, 2), /時間/);
});

/* ---------- screen (src/stroop.js) on a tiny fake DOM with a fake clock ---------- */
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
          d[1].fn(now);
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
  const ids = [...read("partials/stroop.html").matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const byId = new Map(ids.map(id => [id, fakeNode("div")]));
  const log = { sfx: [], music: [], confetti: 0 };
  const ctx = vm.createContext({
    console, navigator: {}, window: { matchMedia: () => ({ matches: false }) },
    document: { hidden: false, createElement: fakeNode, getElementById: (id) => byId.get(id) || null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, performance: { now: clock.now },
    requestAnimationFrame: (fn) => clock.setTimeout(fn, 16), cancelAnimationFrame: clock.clearTimeout,
    Sound: { ensure() {}, ctx: () => null, sfx: (n) => log.sfx.push(n), vibrate() {} },
    Music: { play: (x) => log.music.push(x), stop: () => log.music.push("stop"), intensify() {} },
    Fx: { pop() {}, replay() {}, confetti: () => { log.confetti += 1; }, countdown: () => new Promise(r => clock.setTimeout(r, 2650)) }
  });
  ["random.js", "shared.js", "stroop-rules.js", "stroop.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const $ = (id) => byId.get(id);
  return {
    Stroop: vm.runInContext("Stroop", ctx), clock, log, $,
    button: (text) => $("srActions").children.find(b => b.textContent === text),
    actions: () => $("srActions").children.map(b => b.textContent),
    /* Taps the right (or a wrong) answer for the card on screen; answers react on pointerdown. */
    tap(right) {
      const want = Math.max(0, S.COLOR_IDS.indexOf($("srWord").dataset.ink));
      $("srPad").children[right ? want : (want + 1) % 4].fire("pointerdown");
    }
  };
}
const START_MS = 650 + 2650 + 50;

test("stroop screen: every id the screen looks up is in the partial, and every id is prefixed", () => {
  const ids = [...read("partials/stroop.html").matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  ids.forEach(id => assert.ok(id === "modeStroop" || /^sr[A-Z]/.test(id), id));
  const used = [...read("stroop.js").matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]);
  used.forEach(id => assert.ok(ids.includes(id), `missing #${id}`));
});

test("stroop screen: a round runs from countdown to results, and mistakes bring the end closer", async () => {
  const t = loadScreen();
  t.Stroop.init();
  t.button("はじめる").click();
  t.tap(true);
  await t.clock.run(START_MS);
  assert.equal(t.$("srScore").textContent, "0", "taps during the countdown do not count");
  assert.deepEqual(t.log.music, ["rush"]);
  t.tap(true);
  t.tap(true);
  [1, 2, 3, 4].forEach(() => t.tap(false));
  assert.equal(t.$("srScore").textContent, "2");
  await t.clock.run(25700);
  assert.equal(t.$("srTitle").textContent, "", "still playing");
  await t.clock.run(400);
  assert.equal(t.$("srTitle").textContent, "そこまで！", "four mistakes end a 30-second round 4 seconds early");
  await t.clock.run(1300);
  assert.equal(t.$("srCard").children[0].textContent, "2");
  assert.deepEqual(t.actions(), ["設定", "もう一回"]);
  assert.equal(t.log.confetti, 1, "a first record is celebrated");
});

test("stroop screen: a double tap on 設定 or やめる does not start a new round", async () => {
  const t = loadScreen();
  t.Stroop.init();
  t.button("はじめる").click();
  await t.clock.run(START_MS);
  t.$("srPause").fire("click");
  await t.clock.run(400);
  t.button("やめる").click();
  t.button("はじめる").click();
  assert.ok(!t.$("srSetup").hidden, "still on the setup screen");
  await t.clock.run(400);
  t.button("はじめる").click();
  await t.clock.run(START_MS + 31300 + 400);
  t.button("設定").click();
  t.button("はじめる").click();
  assert.ok(!t.$("srSetup").hidden, "the results' 設定 tap does not fall through to はじめる");
  assert.deepEqual(t.actions(), ["はじめる"]);
});

test("stroop screen: leaving pauses the clock and music; leaving in the countdown never starts play", async () => {
  const t = loadScreen();
  t.Stroop.init();
  t.button("はじめる").click();
  await t.clock.run(START_MS);
  t.Stroop.leave();
  assert.equal(t.$("srTitle").textContent, "ひと休み");
  assert.equal(t.log.music.at(-1), "stop");
  assert.equal(t.clock.pending(), 0, "the frame loop is cancelled");
  await t.clock.run(400);
  t.button("やめる").click();
  t.button("はじめる").click();
  await t.clock.run(1000);
  t.Stroop.leave();
  await t.clock.run(4000);
  assert.ok(!t.$("srSetup").hidden);
  assert.equal(t.log.music.filter(x => x === "rush").length, 1, "the abandoned countdown does not start the music");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Z = require("../src/tobira-rules.js");

/* Repeatable random source. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/* The real topic lists (topics.js is a browser file without exports). */
function loadTopics() {
  const code = fs.readFileSync(path.join(__dirname, "../src/topics.js"), "utf8");
  return new Function(`${code}\nreturn TOPICS;`)();
}

const askMany = (s, answers) => answers.reduce((acc, a) => Z.ask(acc, a), s);
const repeat = (n, a) => Array.from({ length: n }, () => a);

/* ---------- settings ---------- */
test("tobira: settings fall back to defaults for anything unknown", () => {
  assert.deepEqual({ ...Z.normalizeSettings({}) }, { questions: 20, minutes: 0, level: "easy" });
  assert.deepEqual({ ...Z.normalizeSettings({ questions: 30, minutes: 5, level: "hard" }) }, { questions: 30, minutes: 5, level: "hard" });
  assert.deepEqual({ ...Z.normalizeSettings({ questions: "20", minutes: 4, level: "oni" }) }, { ...Z.DEFAULTS });
  [null, undefined, "x", 5, [], [20]].forEach(raw => assert.deepEqual({ ...Z.normalizeSettings(raw) }, { ...Z.DEFAULTS }));
  assert.equal(Z.normalizeSettings({ minutes: 0 }).minutes, 0, "0 means no limit and is kept");
  assert.ok(Object.isFrozen(Z.normalizeSettings({})));
});

test("tobira: option lists are fixed", () => {
  assert.deepEqual([...Z.QUESTIONS], [10, 20, 30]);
  assert.deepEqual([...Z.MINUTES], [3, 5, 0]);
  assert.deepEqual([...Z.LEVELS], ["easy", "normal", "hard"]);
  [Z.QUESTIONS, Z.MINUTES, Z.LEVELS, Z.ANSWERS, Z.DEFAULTS].forEach(x => assert.ok(Object.isFrozen(x)));
});

/* ---------- new round ---------- */
test("tobira: a new round has the full budget and an empty log", () => {
  const s = Z.newRound(" ぞう ", 20, 3);
  assert.equal(s.word, "ぞう");
  assert.equal(s.budget, 20);
  assert.equal(s.minutes, 3);
  assert.equal(Z.remaining(s), 20);
  assert.equal(Z.used(s), 0);
  assert.equal(Z.isOver(s), false);
  assert.equal(Z.outcome(s), null);
  assert.equal(Z.newRound("ぞう", 10).minutes, 0, "no time limit by default");
});

test("tobira: a new round rejects bad input", () => {
  assert.throws(() => Z.newRound("", 20, 0), /お題/);
  assert.throws(() => Z.newRound("   ", 20, 0), /お題/);
  assert.throws(() => Z.newRound(42, 20, 0), /お題/);
  [0, 15, 21, "20", null, 20.5].forEach(q => assert.throws(() => Z.newRound("ぞう", q, 0), /質問の数/));
  [1, 10, "3", null, -3].forEach(m => assert.throws(() => Z.newRound("ぞう", 20, m), /制限時間/));
});

/* ---------- asking ---------- */
test("tobira: each reply uses one question and is logged in order", () => {
  const s = askMany(Z.newRound("ぞう", 20), ["yes", "no", "unknown", "no"]);
  assert.deepEqual([...s.log], ["yes", "no", "unknown", "no"]);
  assert.equal(Z.remaining(s), 16);
  assert.equal(Z.used(s), 4);
  assert.deepEqual({ ...Z.tally(s) }, { yes: 1, no: 2, unknown: 1, correct: 0 });
});

test("tobira: asking never changes the state it was given", () => {
  const s0 = Z.newRound("ぞう", 10);
  const s1 = Z.ask(s0, "yes");
  const s2 = Z.ask(s1, "no");
  assert.equal(s0.log.length, 0);
  assert.equal(s1.log.length, 1);
  assert.notEqual(s1, s2);
  assert.ok(Object.isFrozen(s2) && Object.isFrozen(s2.log));
  const loose = { ...s1, log: ["yes"] };
  const snapshot = JSON.stringify(loose);
  Z.ask(loose, "unknown");
  assert.equal(JSON.stringify(loose), snapshot, "unfrozen input is not mutated either");
});

test("tobira: only はい・いいえ・わからない are valid replies", () => {
  const s = Z.newRound("ぞう", 20);
  ["correct", "maybe", "", null, undefined, 1].forEach(a => assert.throws(() => Z.ask(s, a), /はい/));
});

test("tobira: using the last question ends the round for the keeper", () => {
  [10, 20, 30].forEach(budget => {
    const almost = askMany(Z.newRound("ぞう", budget), repeat(budget - 1, "no"));
    assert.equal(Z.isOver(almost), false);
    assert.equal(Z.remaining(almost), 1);
    const done = Z.ask(almost, "unknown");
    assert.equal(Z.remaining(done), 0);
    assert.deepEqual({ ...Z.outcome(done) }, { winner: "keeper", reason: "questions", used: budget });
    assert.throws(() => Z.ask(done, "yes"), /決着/);
    assert.throws(() => Z.solve(done), /決着/);
  });
});

/* ---------- solving ---------- */
test("tobira: the right guess counts as a question and wins for the guessers", () => {
  const s = Z.solve(askMany(Z.newRound("ぞう", 20), ["yes", "yes", "no", "unknown", "yes", "no"]));
  assert.deepEqual({ ...Z.outcome(s) }, { winner: "guessers", reason: "solved", used: 7 });
  assert.equal(s.log[s.log.length - 1], "correct");
  assert.equal(Z.tally(s).correct, 1);
  assert.equal(Z.remaining(s), 13);
});

test("tobira: guessing on the very last question still wins", () => {
  const s = Z.solve(askMany(Z.newRound("ぞう", 10), repeat(9, "no")));
  assert.equal(Z.outcome(s).winner, "guessers");
  assert.equal(Z.outcome(s).used, 10);
  assert.equal(Z.grade(s), "close");
});

test("tobira: a first-question guess works", () => {
  const s = Z.solve(Z.newRound("ぞう", 20));
  assert.equal(Z.outcome(s).used, 1);
  assert.equal(Z.grade(s), "genius");
});

test("tobira: grade follows how much of the budget was used", () => {
  const solvedAfter = (budget, asked) => Z.solve(askMany(Z.newRound("ぞう", budget), repeat(asked, "no")));
  assert.equal(Z.grade(solvedAfter(20, 4)), "genius");
  assert.equal(Z.grade(solvedAfter(20, 5)), "great");
  assert.equal(Z.grade(solvedAfter(20, 9)), "great");
  assert.equal(Z.grade(solvedAfter(20, 10)), "good");
  assert.equal(Z.grade(solvedAfter(20, 18)), "good");
  assert.equal(Z.grade(solvedAfter(20, 19)), "close");
  assert.equal(Z.grade(Z.newRound("ぞう", 20)), null, "no grade before the end");
  assert.equal(Z.grade(Z.timeout(Z.newRound("ぞう", 20))), null, "no grade when the keeper wins");
});

/* ---------- undo ---------- */
test("tobira: undo takes back the last reply only", () => {
  const s = askMany(Z.newRound("ぞう", 20), ["yes", "no"]);
  const back = Z.undo(s);
  assert.deepEqual([...back.log], ["yes"]);
  assert.deepEqual([...s.log], ["yes", "no"], "the original is unchanged");
  assert.equal(Z.remaining(back), 19);
  assert.throws(() => Z.undo(Z.newRound("ぞう", 20)), /もどせる/);
  assert.throws(() => Z.undo(Z.solve(s)), /決着/);
});

/* ---------- time and giving up ---------- */
test("tobira: time up and giving up both win for the keeper", () => {
  const s = askMany(Z.newRound("ぞう", 20, 3), ["yes", "no"]);
  assert.deepEqual({ ...Z.outcome(Z.timeout(s)) }, { winner: "keeper", reason: "time", used: 2 });
  assert.deepEqual({ ...Z.outcome(Z.giveUp(s)) }, { winner: "keeper", reason: "giveup", used: 2 });
  assert.equal(Z.isOver(s), false, "the original keeps playing");
  assert.throws(() => Z.timeout(Z.timeout(s)), /決着/);
  assert.throws(() => Z.giveUp(Z.solve(s)), /決着/);
});

test("tobira: broken states are rejected", () => {
  [null, undefined, {}, { log: [] }, { log: "x", budget: 20 }, { log: [], budget: 7 }].forEach(bad => {
    assert.throws(() => Z.ask(bad, "yes"), /状態/);
    assert.throws(() => Z.solve(bad), /状態/);
    assert.throws(() => Z.timeout(bad), /状態/);
  });
});

/* ---------- pressure ---------- */
test("tobira: pressure rises as questions or seconds run low", () => {
  const at = (left) => askMany(Z.newRound("ぞう", 20), repeat(20 - left, "no"));
  assert.equal(Z.pressure(at(20)), "calm");
  assert.equal(Z.pressure(at(4)), "calm");
  assert.equal(Z.pressure(at(3)), "warm");
  assert.equal(Z.pressure(at(2)), "warm");
  assert.equal(Z.pressure(at(1)), "hot");
  assert.equal(Z.pressure(at(20), 31), "calm");
  assert.equal(Z.pressure(at(20), 30), "warm");
  assert.equal(Z.pressure(at(20), 11), "warm");
  assert.equal(Z.pressure(at(20), 10), "hot");
  assert.equal(Z.pressure(at(20), null), "calm", "no clock means only questions count");
});

/* ---------- timer math ---------- */
test("tobira: deadline and seconds left", () => {
  assert.equal(Z.deadline(1000, 0), null);
  assert.equal(Z.deadline(1000, 3), 181000);
  assert.equal(Z.deadline(0, 5), 300000);
  assert.throws(() => Z.deadline(NaN, 3), /開始時刻/);
  assert.throws(() => Z.deadline(0, 4), /制限時間/);
  const end = Z.deadline(0, 3);
  assert.equal(Z.secondsLeft(end, 0), 180);
  assert.equal(Z.secondsLeft(end, 999), 180, "rounds up so the clock shows 3:00 for the first second");
  assert.equal(Z.secondsLeft(end, 1000), 179);
  assert.equal(Z.secondsLeft(end, 179001), 1);
  assert.equal(Z.secondsLeft(end, 180000), 0);
  assert.equal(Z.secondsLeft(end, 999999), 0, "never negative");
  assert.equal(Z.msLeft(end, 170000), 10000);
  assert.equal(Z.msLeft(null, 5), Infinity);
  assert.equal(Z.secondsLeft(null, 5), null);
  assert.throws(() => Z.msLeft(end, NaN), /時刻/);
});

test("tobira: time is up exactly at the deadline, never without one", () => {
  const end = Z.deadline(500, 3);
  assert.equal(Z.isTimeUp(end, end - 1), false);
  assert.equal(Z.isTimeUp(end, end), true);
  assert.equal(Z.isTimeUp(end, end + 5000), true);
  assert.equal(Z.isTimeUp(null, 1e12), false);
});

/* ---------- topics ---------- */
test("tobira: picking is deterministic with an injected random source", () => {
  const pool = ["a", "b", "c", "d"];
  assert.equal(Z.pickTopic(pool, [], () => 0).word, "a");
  assert.equal(Z.pickTopic(pool, [], () => 0.999999).word, "d");
  assert.equal(Z.pickTopic(pool, [], () => 0.5).word, "c");
  assert.equal(Z.pickTopic(pool, ["a"], () => 0).word, "b", "skips used words");
  assert.equal(Z.pickTopic(pool, [], () => 1).word, "d", "an out-of-range random value still picks a word");
});

test("tobira: no word repeats until the pool is used up", () => {
  const pool = ["a", "b", "c", "d", "e", "f", "g"];
  let used = [];
  const seen = [];
  const r = seq(0.9, 0.1, 0.5, 0.3, 0.7, 0.2, 0.6, 0.4);
  for (let i = 0; i < pool.length; i++) {
    const next = Z.pickTopic(pool, used, r);
    seen.push(next.word);
    used = next.used;
  }
  assert.deepEqual([...seen].sort(), pool);
  assert.deepEqual([...used].sort(), pool);
});

test("tobira: after the pool runs out it starts over without an instant repeat", () => {
  const pool = ["a", "b", "c"];
  const used = ["x", "b", "a", "c"];
  for (let k = 0; k < 20; k++) {
    const next = Z.pickTopic(pool, used, () => k / 20);
    assert.notEqual(next.word, "c", "the word just played is not picked again");
    assert.deepEqual([...next.used], ["x", next.word], "other pools' history is kept, this pool starts over");
  }
  assert.equal(Z.pickTopic(["solo"], ["solo"], () => 0.3).word, "solo", "a one-word pool still works");
});

test("tobira: picking does not change the history it was given", () => {
  const used = Object.freeze(["a"]);
  const next = Z.pickTopic(["a", "b"], used, () => 0);
  assert.deepEqual([...used], ["a"]);
  assert.deepEqual([...next.used], ["a", "b"]);
  assert.ok(Object.isFrozen(next) && Object.isFrozen(next.used));
});

test("tobira: bad pools and bad history are handled", () => {
  assert.throws(() => Z.pickTopic([], []), /お題/);
  assert.throws(() => Z.pickTopic(["", "  ", 3, null], []), /お題/);
  assert.throws(() => Z.pickTopic("abc", []), /お題/);
  assert.equal(Z.pickTopic(["a", "a", " a ", 7], "junk", () => 0.99).word, "a", "duplicates and non-words are ignored");
  assert.deepEqual(Z.cleanUsed("junk"), []);
  assert.deepEqual(Z.cleanUsed({ length: 2 }), []);
  assert.deepEqual(Z.cleanUsed(["a", 1, null, "a", " b ", ""]), ["a", "b"]);
  const long = Array.from({ length: Z.MAX_USED + 5 }, (_, i) => `w${i}`);
  const kept = Z.cleanUsed(long);
  assert.equal(kept.length, Z.MAX_USED);
  assert.equal(kept[kept.length - 1], `w${Z.MAX_USED + 4}`, "keeps the most recent words");
});

test("tobira: pools come from the topic lists by level", () => {
  const fake = { easy: ["ねこ", "いぬ", "ねこ"], normal: [], hard: "x" };
  assert.deepEqual(Z.poolFor(fake, "easy"), ["ねこ", "いぬ"]);
  assert.throws(() => Z.poolFor(fake, "normal"), /お題/);
  assert.throws(() => Z.poolFor(fake, "hard"), /お題/);
  assert.throws(() => Z.poolFor(fake, "oni"), /難しさ/);
  assert.throws(() => Z.poolFor(null, "easy"), /お題/);
});

test("tobira: every level of the real topic list can be played through without repeats", () => {
  const topics = loadTopics();
  Z.LEVELS.forEach(level => {
    const pool = Z.poolFor(topics, level);
    assert.ok(pool.length >= 30, `${level} has enough words`);
    let used = [];
    const seen = new Set();
    for (let i = 0; i < pool.length; i++) {
      const next = Z.pickTopic(pool, used);
      assert.ok(!seen.has(next.word), `${level}: ${next.word} repeated`);
      seen.add(next.word);
      used = next.used;
    }
    assert.equal(seen.size, pool.length);
  });
});

/* ---------- a full game ---------- */
test("tobira: a full game from deal to result", () => {
  const topics = loadTopics();
  const { word } = Z.pickTopic(Z.poolFor(topics, "normal"), [], () => 0);
  const settings = Z.normalizeSettings({ questions: 10, minutes: 3, level: "normal" });
  const end = Z.deadline(0, settings.minutes);
  let s = Z.newRound(word, settings.questions, settings.minutes);
  s = askMany(s, ["yes", "no", "no", "unknown", "yes"]);
  s = Z.undo(s);
  s = Z.ask(s, "no");
  assert.equal(Z.isTimeUp(end, 60000), false);
  s = Z.solve(s);
  assert.equal(Z.outcome(s).used, 6);
  assert.deepEqual({ ...Z.tally(s) }, { yes: 1, no: 3, unknown: 1, correct: 1 });
  assert.equal(Z.grade(s), "good");
});

/* ---------- screen: driven through its buttons with a tiny fake DOM ---------- */
function fakeEl() {
  const classes = new Set();
  const el = {
    hidden: false, textContent: "", className: "", children: [], listeners: {}, style: { setProperty() {} },
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c))
    },
    replaceChildren: (...c) => { el.children = c; },
    append: (...c) => { el.children = [...el.children, ...c]; },
    addEventListener: (type, fn) => { el.listeners[type] = [...(el.listeners[type] || []), fn]; }
  };
  return el;
}
function loadScreen() {
  const ids = new Map();
  const timers = new Map();
  let timerId = 0;
  const calls = { confettiStopped: 0 };
  const clock = { t: 10000 };
  const View = {
    text(e, v) { e.textContent = v ?? ""; e.hidden = v === null || v === undefined || v === ""; },
    list(e, lines) { e.children = lines; },
    chips(e, options, current, onPick) { e.children = options.map(o => ({ ...o, pick: () => onPick(o.value) })); },
    card(e, c) { e.hidden = !c; e.textContent = c ? [c.main, c.sub].filter(Boolean).join(" ") : ""; },
    stage(e, v) {
      View.text(e.label, v.label); View.text(e.title, v.title); View.card(e.card, v.card ?? null);
      View.text(e.hint, v.hint); e.actions.replaceChildren(...(v.actions || []));
    },
    options: (values, label) => values.map(v => ({ value: v, label: label(v) })),
    clock: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  };
  const globals = {
    TobiraRules: Z, TOPICS: loadTopics(), View,
    $: (id) => { if (!ids.has(id)) ids.set(id, fakeEl()); return ids.get(id); },
    document: { createElement: () => fakeEl() },
    makeButton: (label, onClick, cls = "", disabled = false) => ({ label, onClick, cls, disabled }),
    Store: { load: (k, fallback) => fallback, save() {} },
    Awake: { keep() {} },
    Sound: { ensure: () => null, sfx() {}, tone() {}, hz: () => 440 },
    Music: { play() {}, stop() {}, intensify() {} },
    Fx: { pop() {}, shake() {}, flash() {}, replay() {}, countdown: () => Promise.resolve(), confetti: () => () => { calls.confettiStopped += 1; } },
    performance: { now: () => clock.t },
    setTimeout: (fn) => { timerId += 1; timers.set(timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id), setInterval: () => 1, clearInterval() {}
  };
  const code = fs.readFileSync(path.join(__dirname, "../src/tobira.js"), "utf8");
  const names = Object.keys(globals);
  const screen = new Function(...names, `${code}\nreturn Tobira;`)(...names.map(n => globals[n]));
  const $ = globals.$;
  const buttons = () => $("zActions").children.map(b => b.label);
  const press = (label) => {
    const b = $("zActions").children.find(x => x.label === label);
    assert.ok(b, `no button ${label} (have ${buttons().join(", ")})`);
    if (!b.disabled) b.onClick();
  };
  const runTimers = () => { const due = [...timers.values()]; timers.clear(); due.forEach(fn => fn()); };
  const wait = (ms) => { clock.t += ms; };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  /* setup -> secret -> word -> countdown -> play, with calm taps */
  async function toPlay() {
    press("はじめる");
    wait(1000);
    press("お題を見る");
    wait(1000);
    press("覚えた！");
    await flush();
    wait(1000);
  }
  return { screen, $, press, buttons, runTimers, wait, flush, calls, toPlay };
}

test("tobira screen: a double tap on 正解が出た！ does not skip the win", async () => {
  const s = loadScreen();
  s.screen.init();
  await s.toPlay();
  s.press("正解が出た！");
  assert.equal(s.$("zTitle").textContent, "正解！ みんなの勝ち！");
  s.press("もう一回");
  assert.equal(s.$("zTitle").textContent, "正解！ みんなの勝ち！", "the second tap of a double tap is ignored");
  s.press("設定");
  assert.equal(s.$("zSetup").hidden, true, "設定 is not hit by a stray tap either");
  s.wait(1000);
  s.press("もう一回");
  assert.equal(s.$("zTitle").textContent, "次の出題者だけ見てね");
});

test("tobira screen: a double tap on お題を見る does not change the word", () => {
  const s = loadScreen();
  s.screen.init();
  s.press("はじめる");
  s.wait(1000);
  s.press("お題を見る");
  const word = s.$("zCard").textContent;
  s.press("お題を変える");
  assert.equal(s.$("zCard").textContent, word, "the second tap lands on お題を変える and is ignored");
  s.wait(1000);
  s.press("お題を変える");
  assert.notEqual(s.$("zCard").textContent, word, "a deliberate tap changes it");
});

test("tobira screen: 30 questions use a denser answer track so the buttons fit on a small phone", async () => {
  const s = loadScreen();
  s.screen.init();
  s.$("zQuestionChips").children.find(c => c.value === 30).pick();
  await s.toPlay();
  assert.equal(s.$("zTrack").children.length, 30);
  assert.ok(s.$("zTrack").classList.contains("is-dense"));
  const t = loadScreen();
  t.screen.init();
  await t.toPlay();
  assert.equal(t.$("zTrack").children.length, 20);
  assert.ok(!t.$("zTrack").classList.contains("is-dense"));
});

test("tobira screen: leaving after a win clears the confetti and pending sounds", async () => {
  const s = loadScreen();
  s.screen.init();
  await s.toPlay();
  s.press("正解が出た！");
  s.runTimers();
  s.screen.leave();
  assert.equal(s.calls.confettiStopped, 1);
  assert.equal(s.$("zSetup").hidden, false, "back on the setup screen, the answer is gone");
});

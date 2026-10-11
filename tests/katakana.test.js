const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../src/katakana-rules.js");

/* Repeatable random source. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}
function deepFreeze(o) {
  Object.values(o).forEach(v => { if (v && typeof v === "object") deepFreeze(v); });
  return Object.freeze(o);
}
const snap = (o) => JSON.stringify(o);
/* Plays whole turns: counts[i] penalties for the i-th speaker of the lap. */
function playLap(g, counts, topic = "朝ごはん") {
  return counts.reduce((acc, n) => {
    let next = acc;
    for (let i = 0; i < n; i++) next = K.penalize(next);
    return K.endTurn(next, topic);
  }, g);
}

/* ---------- topics ---------- */
test("katakana: about 50 topics, all unique, short and plain text", () => {
  const all = K.topicPool("all");
  assert.ok(all.length >= 50, `only ${all.length} topics`);
  assert.equal(new Set(all).size, all.length, "no duplicate topics across levels");
  all.forEach(t => {
    assert.equal(typeof t, "string");
    assert.ok(t.trim().length > 0 && t.length <= 12, `bad length: ${t}`);
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, `no emoji: ${t}`);
  });
  assert.equal(all.length, K.TOPICS.normal.length + K.TOPICS.hard.length);
  assert.ok(K.TOPICS.normal.length >= 20 && K.TOPICS.hard.length >= 20);
  assert.ok(Object.isFrozen(K.TOPICS.normal) && Object.isFrozen(K.TOPICS.hard));
});

test("katakana: topicPool returns a copy and rejects unknown levels", () => {
  const pool = K.topicPool("hard");
  pool.push("x");
  assert.ok(!K.topicPool("hard").includes("x"));
  assert.throws(() => K.topicPool("oni"), /お題/);
  assert.throws(() => K.topicPool(undefined));
});

test("katakana: topics never repeat until the pool is used up", () => {
  ["normal", "hard", "all"].forEach(level => {
    const pool = K.topicPool(level);
    let used = [];
    const seen = new Set();
    const r = seq(0.13, 0.71, 0.42, 0.99, 0.05, 0.58);
    for (let i = 0; i < pool.length; i++) {
      const next = K.pickTopic(used, level, r);
      assert.ok(pool.includes(next.topic), `${next.topic} is not in ${level}`);
      assert.ok(!seen.has(next.topic), `repeat: ${next.topic}`);
      seen.add(next.topic);
      used = next.used;
    }
    assert.equal(seen.size, pool.length);
    const restart = K.pickTopic(used, level, () => 0);
    assert.equal(restart.used.length, 1, "starts over once everything was used");
    assert.notEqual(restart.topic, used[used.length - 1], "never the same topic twice in a row");
  });
});

test("katakana: pickTopic is deterministic with an injected random and never mutates `used`", () => {
  const used = Object.freeze(["朝ごはん"]);
  const a = K.pickTopic(used, "normal", () => 0);
  const b = K.pickTopic(used, "normal", () => 0);
  assert.deepEqual(a, b);
  assert.equal(a.topic, K.TOPICS.normal[1], "first fresh topic with r = 0");
  assert.deepEqual(a.used, ["朝ごはん", a.topic]);
  assert.deepEqual(used, ["朝ごはん"]);
  const last = K.pickTopic([], "hard", () => 0.999999);
  assert.equal(last.topic, K.TOPICS.hard[K.TOPICS.hard.length - 1]);
});

test("katakana: topics used at another level do not block this level", () => {
  const usedHard = [...K.TOPICS.hard];
  const next = K.pickTopic(usedHard, "normal", () => 0);
  assert.equal(next.topic, K.TOPICS.normal[0]);
  assert.equal(next.used.length, usedHard.length + 1);
});

test("katakana: pickTopic validates its input", () => {
  assert.throws(() => K.pickTopic(null, "all"), /お題/);
  assert.throws(() => K.pickTopic("朝ごはん", "all"));
  assert.throws(() => K.pickTopic([1, 2], "all"));
  assert.throws(() => K.pickTopic([], "nope"));
});

/* ---------- settings ---------- */
test("katakana: normalize keeps good settings and repairs bad ones", () => {
  assert.deepEqual(K.normalize({ players: 6, seconds: 30, level: "hard" }), { players: 6, seconds: 30, level: "hard" });
  const d = { ...K.DEFAULTS };
  [null, undefined, "x", 42, [], [4, 30]].forEach(raw => assert.deepEqual(K.normalize(raw), d));
  assert.deepEqual(K.normalize({ players: 2, seconds: 40, level: "oni" }), d);
  assert.deepEqual(K.normalize({ players: 9, seconds: "45", level: 1 }), d);
  assert.deepEqual(K.normalize({ players: 3.5, seconds: 60 }), { ...d, seconds: 60 });
  assert.deepEqual(K.normalize({ players: "5" }), d);
  const input = deepFreeze({ players: 8, seconds: 60, level: "normal", extra: true });
  assert.deepEqual(K.normalize(input), { players: 8, seconds: 60, level: "normal" }, "drops unknown keys");
});

/* ---------- game ---------- */
test("katakana: newGame validates players and seconds", () => {
  const g = K.newGame(4, 45);
  assert.deepEqual(g, { players: 4, seconds: 45, lap: 1, turn: 0, count: 0, penalties: [0, 0, 0, 0], log: [] });
  assert.equal(K.newGame(3, 30).penalties.length, 3);
  assert.equal(K.newGame(8, 60).penalties.length, 8);
  [2, 9, 0, -1, 3.5, "4", null, NaN].forEach(p => assert.throws(() => K.newGame(p, 45), /人数/));
  [0, 40, 90, "45", null].forEach(s => assert.throws(() => K.newGame(4, s), /時間/));
});

test("katakana: turns rotate through every seat; each lap starts one seat later", () => {
  assert.deepEqual(K.speakingOrder(4, 1), [0, 1, 2, 3]);
  assert.deepEqual(K.speakingOrder(4, 2), [1, 2, 3, 0]);
  assert.deepEqual(K.speakingOrder(4, 5), [0, 1, 2, 3], "wraps after every seat started once");
  let g = K.newGame(3, 30);
  const order = [];
  while (!K.lapDone(g)) {
    order.push(K.speaker(g));
    g = K.endTurn(g, "朝ごはん");
  }
  assert.deepEqual(order, [0, 1, 2]);
  assert.equal(K.speaker(g), null);
  g = K.nextLap(g);
  assert.equal(K.speaker(g), 1, "B starts lap 2");
});

test("katakana: penalties go to the current speaker only", () => {
  let g = K.newGame(4, 45);
  g = K.penalize(K.penalize(g));
  assert.equal(g.count, 2);
  assert.deepEqual(g.penalties, [2, 0, 0, 0]);
  g = K.endTurn(g, "ゲーム");
  assert.equal(g.count, 0, "count resets for the next speaker");
  g = K.penalize(g);
  assert.deepEqual(g.penalties, [2, 1, 0, 0]);
  assert.deepEqual(K.lastTurn(g), { lap: 1, seat: 0, topic: "ゲーム", count: 2 });
});

test("katakana: rule functions never change the state they are given", () => {
  const g = deepFreeze(K.penalize(K.newGame(3, 30)));
  const before = snap(g);
  K.penalize(g);
  K.undo(g);
  K.resetTurn(g);
  K.endTurn(g, "パソコン");
  K.ranking(g);
  K.champions(g);
  assert.equal(snap(g), before);
  const done = deepFreeze(playLap(K.newGame(3, 30), [1, 0, 2]));
  const doneBefore = snap(done);
  K.nextLap(done);
  assert.equal(snap(done), doneBefore);
});

test("katakana: undo takes back one tap and never goes below the turn start", () => {
  let g = K.endTurn(K.penalize(K.newGame(3, 30)), "朝ごはん");
  g = K.endTurn(K.penalize(K.penalize(g)), "朝ごはん");
  assert.deepEqual(g.penalties, [1, 2, 0]);
  g = K.penalize(K.nextLap(playLap(g, [0])));
  assert.equal(K.speaker(g), 1);
  assert.deepEqual(g.penalties, [1, 3, 0]);
  g = K.undo(g);
  assert.deepEqual(g.penalties, [1, 2, 0]);
  assert.equal(g.count, 0);
  const same = K.undo(g);
  assert.deepEqual(same.penalties, [1, 2, 0], "earlier laps are not touched");
  assert.equal(same.count, 0);
});

test("katakana: resetTurn removes only this turn's penalties", () => {
  let g = playLap(K.newGame(3, 45), [2, 1, 0]);
  g = K.nextLap(g);
  g = K.penalize(K.penalize(K.penalize(g)));
  assert.deepEqual(g.penalties, [2, 4, 0]);
  const reset = K.resetTurn(g);
  assert.deepEqual(reset.penalties, [2, 1, 0]);
  assert.equal(reset.count, 0);
  assert.equal(K.speaker(reset), 1, "the same speaker tries again");
  assert.equal(reset.log.length, g.log.length);
});

test("katakana: endTurn needs a topic and stops after the lap", () => {
  const g = K.newGame(3, 30);
  ["", "   ", null, 3].forEach(t => assert.throws(() => K.endTurn(g, t), /お題/));
  const done = playLap(g, [0, 0, 0]);
  assert.equal(K.lapDone(done), true);
  assert.equal(done.log.length, 3);
  assert.throws(() => K.endTurn(done, "朝ごはん"), /全員/);
  assert.throws(() => K.penalize(done), /全員/);
  assert.throws(() => K.undo(done), /全員/);
  assert.throws(() => K.resetTurn(done), /全員/);
});

test("katakana: nextLap keeps the totals and the log", () => {
  const g = K.newGame(3, 30);
  assert.throws(() => K.nextLap(g), /まだ/);
  const lap1 = playLap(g, [1, 0, 2]);
  const lap2 = K.nextLap(lap1);
  assert.equal(lap2.lap, 2);
  assert.equal(lap2.turn, 0);
  assert.deepEqual(lap2.penalties, [1, 0, 2]);
  const end = playLap(lap2, [3, 0, 0]);
  assert.deepEqual(end.penalties, [1, 3, 2], "lap 2 starts with B, so B got the 3");
  assert.deepEqual(end.log.map(e => [e.lap, e.seat]), [[1, 0], [1, 1], [1, 2], [2, 1], [2, 2], [2, 0]]);
});

test("katakana: broken state is rejected", () => {
  assert.throws(() => K.penalize(null), /状態/);
  assert.throws(() => K.speaker({ players: 3, penalties: [0, 0], log: [] }), /状態/);
  assert.throws(() => K.ranking({ players: 3, penalties: [0, 0, 0] }), /状態/);
});

/* ---------- ranking ---------- */
test("katakana: ranking puts fewest penalties first; ties share the rank", () => {
  const g = playLap(K.newGame(5, 30), [3, 1, 0, 1, 5]);
  const r = K.ranking(g);
  assert.deepEqual(r.map(x => x.seat), [2, 1, 3, 0, 4]);
  assert.deepEqual(r.map(x => x.rank), [1, 2, 2, 4, 5]);
  assert.deepEqual(r.map(x => x.penalties), [0, 1, 1, 3, 5]);
  assert.deepEqual(K.champions(g), [2]);
});

test("katakana: several champions and an all-way tie", () => {
  const two = playLap(K.newGame(4, 30), [0, 2, 0, 1]);
  assert.deepEqual(K.champions(two), [0, 2]);
  assert.deepEqual(K.ranking(two).map(x => x.rank), [1, 1, 3, 4]);
  const all = playLap(K.newGame(3, 30), [2, 2, 2]);
  assert.deepEqual(K.champions(all), [0, 1, 2]);
  assert.deepEqual(K.ranking(all).map(x => x.rank), [1, 1, 1]);
  assert.deepEqual(K.champions(K.newGame(3, 30)), [0, 1, 2], "nobody said anything yet");
});

/* ---------- buzzer ---------- */
test("katakana: taps close together count once", () => {
  assert.equal(K.canBuzz(null, 1000), true);
  assert.equal(K.canBuzz(undefined, 0), true);
  assert.equal(K.canBuzz(1000, 1000 + K.BUZZ_COOLDOWN_MS - 1), false);
  assert.equal(K.canBuzz(1000, 1000 + K.BUZZ_COOLDOWN_MS), true);
  assert.equal(K.canBuzz(1000, 5000), true);
  assert.throws(() => K.canBuzz(null, NaN), /時刻/);
  assert.throws(() => K.canBuzz("1000", 2000), /時刻/);
});

/* ---------- a full game ---------- */
test("katakana: a whole two-lap game for 4 players", () => {
  let used = [];
  let g = K.newGame(4, 60);
  const r = seq(0.3, 0.8, 0.1, 0.6, 0.45);
  const plan = [[2, 0, 1, 4], [1, 1, 0, 0]];
  plan.forEach((counts, lapIndex) => {
    counts.forEach(n => {
      const pick = K.pickTopic(used, "all", r);
      used = pick.used;
      for (let i = 0; i < n; i++) g = K.penalize(g);
      g = K.endTurn(g, pick.topic);
    });
    if (lapIndex === 0) g = K.nextLap(g);
  });
  assert.equal(K.lapDone(g), true);
  assert.equal(new Set(g.log.map(e => e.topic)).size, 8, "eight different topics");
  assert.deepEqual(g.penalties, [2, 1, 2, 4]);
  assert.deepEqual(K.champions(g), [1]);
  assert.deepEqual(K.ranking(g).map(x => [x.seat, x.rank]), [[1, 1], [0, 2], [2, 2], [3, 4]]);
});

/* ---------- regression: topic history across levels ---------- */
test("katakana: starting a level over keeps the other levels' history and skips this level's last topic", () => {
  const hardSeen = K.TOPICS.hard.slice(0, 5);
  const used = [...K.TOPICS.normal.slice(0, -1), ...hardSeen, K.TOPICS.normal[K.TOPICS.normal.length - 1]];
  for (let k = 0; k < 20; k++) {
    const next = K.pickTopic(used, "normal", () => k / 20);
    assert.ok(next.topic !== K.TOPICS.normal[K.TOPICS.normal.length - 1], "the topic just played is not picked again");
    assert.deepEqual(next.used, [...hardSeen, next.topic], "hard topics already played stay used");
  }
  const switched = [...K.TOPICS.normal, "スマホの使い方"];
  for (let k = 0; k < 20; k++) {
    const next = K.pickTopic(switched, "normal", () => k / 20);
    assert.notEqual(next.topic, K.TOPICS.normal[K.TOPICS.normal.length - 1], "the last topic of this level is skipped even after a level switch");
  }
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
    appendChild: (c) => { el.children = [...el.children, c]; return c; },
    addEventListener: (type, fn) => { el.listeners[type] = [...(el.listeners[type] || []), fn]; },
    setAttribute() {}, remove() {}
  };
  el.firstElementChild = { style: {} };
  return el;
}
function loadScreen() {
  const fs = require("node:fs");
  const path = require("node:path");
  const ids = new Map();
  const timers = new Map();
  let timerId = 0;
  const calls = { sfx: [], confettiStopped: 0 };
  const clock = { t: 10000 };
  const View = {
    text(e, v) { e.textContent = v ?? ""; e.hidden = v === null || v === undefined || v === ""; },
    list(e, lines) { e.children = lines; },
    chips(e, options) { e.children = options; },
    card(e, c) { e.hidden = !c; e.textContent = c ? [c.main, c.sub].filter(Boolean).join(" ") : ""; },
    stage(e, v) {
      View.text(e.label, v.label); View.text(e.title, v.title); View.card(e.card, v.card ?? null);
      View.text(e.hint, v.hint); e.actions.replaceChildren(...(v.actions || []));
    },
    seat: (i) => "ABCDEFGH"[i],
    options: (values, label) => values.map(v => ({ value: v, label: label(v) })),
    clock: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  };
  const globals = {
    KatakanaRules: K, View,
    $: (id) => { if (!ids.has(id)) ids.set(id, fakeEl()); return ids.get(id); },
    document: { createElement: () => fakeEl() },
    makeButton: (label, onClick, cls = "", disabled = false) => ({ label, onClick, cls, disabled }),
    Store: { load: (k, fallback) => fallback, save() {} },
    Awake: { keep() {} },
    Sound: { ensure: () => null, sfx: (name) => calls.sfx.push(name), tone() {}, hiss() {}, vibrate() {} },
    Music: { play() {}, stop() {}, intensify() {} },
    Fx: { pop() {}, shake() {}, flash() {}, replay() {}, countdown: () => Promise.resolve(), confetti: () => () => { calls.confettiStopped += 1; } },
    performance: { now: () => clock.t },
    setTimeout: (fn) => { timerId += 1; timers.set(timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id), setInterval: () => 1, clearInterval() {}
  };
  const code = fs.readFileSync(path.join(__dirname, "../src/katakana.js"), "utf8");
  const names = Object.keys(globals);
  const screen = new Function(...names, `${code}\nreturn Katakana;`)(...names.map(n => globals[n]));
  const $ = globals.$;
  const buttons = () => $("xActions").children.map(b => b.label);
  const press = (label) => {
    const b = $("xActions").children.find(x => x.label === label);
    assert.ok(b, `no button ${label} (have ${buttons().join(", ")})`);
    if (!b.disabled) b.onClick();
  };
  const runTimers = () => { const due = [...timers.values()]; timers.clear(); due.forEach(fn => fn()); };
  const wait = (ms) => { clock.t += ms; };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { screen, $, press, buttons, runTimers, wait, flush, calls };
}

test("katakana screen: a double tap on トーク終了 does not skip the turn result", async () => {
  const s = loadScreen();
  s.screen.init();
  s.press("はじめる");
  s.wait(1000);
  s.press("スタート");
  await s.flush();
  s.wait(5000);
  s.press("トーク終了");
  assert.equal(s.$("xTitle").textContent, "Aさん、パーフェクト！");
  s.press("Bさんの番へ");
  assert.equal(s.$("xTitle").textContent, "Aさん、パーフェクト！", "the second tap of a double tap is ignored");
  s.wait(1000);
  s.press("Bさんの番へ");
  assert.equal(s.$("xTitle").textContent, "Bさんの番");
});

test("katakana screen: a stray tap right after the next topic appears cannot quit the game", () => {
  const s = loadScreen();
  s.screen.init();
  s.press("はじめる");
  s.press("やめる");
  assert.equal(s.$("xSetup").hidden, true, "still in the game");
  s.press("スタート");
  assert.ok(s.buttons().includes("スタート"), "the countdown does not start from a double tap either");
  s.wait(1000);
  s.press("やめる");
  assert.equal(s.$("xSetup").hidden, false, "a deliberate tap still works");
});

test("katakana screen: only the main mouse button or a finger hits the buzzer", async () => {
  const s = loadScreen();
  s.screen.init();
  s.press("はじめる");
  s.wait(1000);
  s.press("スタート");
  await s.flush();
  const down = (button) => s.$("xBuzz").listeners.pointerdown.forEach(fn => fn({ button, preventDefault() {} }));
  down(2);
  assert.equal(s.$("xCount").textContent, "0", "a right click is not a penalty");
  down(0);
  assert.equal(s.$("xCount").textContent, "1");
});

test("katakana screen: leaving stops the confetti and the late perfect-turn sound", async () => {
  const s = loadScreen();
  s.screen.init();
  s.press("はじめる");
  s.wait(1000);
  s.press("スタート");
  await s.flush();
  s.wait(1000);
  s.press("トーク終了");
  s.screen.leave();
  s.runTimers();
  assert.ok(!s.calls.sfx.includes("correct"), "no sound plays after leaving");
  for (let i = 0; i < 3; i++) {
    s.wait(1000);
    s.press(s.buttons()[s.buttons().length - 1]);
    s.wait(1000);
    s.press("スタート");
    await s.flush();
    s.wait(1000);
    s.press("トーク終了");
  }
  s.wait(1000);
  s.press("結果発表！");
  s.runTimers();
  assert.equal(s.$("xLabel").textContent, "結果");
  s.screen.leave();
  assert.equal(s.calls.confettiStopped, 1, "confetti is cleared when leaving the results");
});

test("katakana css: the buzzer press animation does not pin its end state", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/styles-katakana.css"), "utf8");
  const rule = css.match(/\.katakana-buzzer\.katakana-pressed\s*\{[^}]*\}/);
  assert.ok(rule, "rule exists");
  assert.doesNotMatch(rule[0], /forwards|both/, "a held end state would block the :active press look");
});

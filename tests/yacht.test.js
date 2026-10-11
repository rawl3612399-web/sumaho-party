const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Y = require("../src/yacht-rules.js");
const TIMING_SLACK = Number(process.env.TIMING_SLACK) || 1; // CI machines are slower; the deploy workflow raises this

/* Repeatable random source (linear congruential). */
function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
/* A random source that makes the next dice come out as `faces` (one value per rolled die). */
const facesR = (...faces) => {
  let i = 0;
  return () => (faces[i++ % faces.length] - 1) / 6 + 0.01;
};
const sheetWith = (filled) => Object.freeze({ ...Object.fromEntries(Y.IDS.map(id => [id, null])), ...filled });
/* A one-player state holding these dice after `rolls` rolls, with an optional partly filled sheet. */
const hand = (dice, rolls = 1, filled = {}) => Object.freeze({
  ...Y.newGame(1), sheets: Object.freeze([sheetWith(filled)]), dice: Object.freeze([...dice]), rolls
});
const allBut = (keep) => Object.fromEntries(Y.IDS.filter(id => !keep.includes(id)).map(id => [id, 0]));
const snapshot = (s) => JSON.stringify(s);

/* Plays one CPU step on the state: hold + roll, or mark a box. */
function applyPlan(s, plan, r) {
  if (plan.action === "score") return Y.choose(s, plan.cat);
  const held = s.rolls > 0 ? Y.setHeld(s, plan.held) : s;
  return Y.roll(held, r);
}
function playGame(levels, r, check = () => {}) {
  let s = Y.newGame(levels.length);
  while (!s.over) {
    const plan = Y.cpuPlan(s, levels[s.turn], r);
    check(s, plan);
    s = applyPlan(s, plan, r);
  }
  return s;
}

/* ---------- scoring ---------- */
test("yacht scoring: the upper boxes add up only their own face", () => {
  const d = [1, 1, 3, 4, 1];
  assert.equal(Y.score("ones", d), 3);
  assert.equal(Y.score("twos", d), 0);
  assert.equal(Y.score("threes", d), 3);
  assert.equal(Y.score("fours", d), 4);
  assert.equal(Y.score("sixes", [6, 6, 6, 6, 6]), 30);
  assert.equal(Y.score("choice", d), 10);
  assert.equal(Y.score("choice", [6, 6, 6, 6, 6]), 30);
});

test("yacht scoring: フォーダイス is the sum of all five when four or more match", () => {
  assert.equal(Y.score("four", [2, 2, 2, 2, 5]), 13);
  assert.equal(Y.score("four", [5, 2, 2, 2, 2]), 13);
  assert.equal(Y.score("four", [3, 3, 3, 3, 3]), 15);
  assert.equal(Y.score("four", [2, 2, 2, 5, 5]), 0);
  assert.equal(Y.score("four", [1, 2, 3, 4, 5]), 0);
});

test("yacht scoring: フルハウス is three plus a pair; five of a kind does not count", () => {
  assert.equal(Y.score("full", [2, 2, 2, 5, 5]), 16);
  assert.equal(Y.score("full", [5, 2, 5, 2, 2]), 16);
  assert.equal(Y.score("full", [6, 6, 6, 5, 5]), 28);
  assert.equal(Y.score("full", [6, 6, 6, 6, 6]), 0);
  assert.equal(Y.score("full", [2, 2, 5, 5, 1]), 0);
  assert.equal(Y.score("full", [2, 2, 2, 2, 5]), 0);
});

test("yacht scoring: straights pay fixed points and ignore order", () => {
  assert.equal(Y.score("sstraight", [1, 2, 3, 4, 6]), 15);
  assert.equal(Y.score("sstraight", [6, 4, 3, 5, 1]), 15);
  assert.equal(Y.score("sstraight", [2, 3, 4, 5, 5]), 15);
  assert.equal(Y.score("sstraight", [1, 2, 3, 4, 5]), 15);
  assert.equal(Y.score("sstraight", [1, 2, 3, 5, 6]), 0);
  assert.equal(Y.score("lstraight", [5, 3, 1, 2, 4]), 30);
  assert.equal(Y.score("lstraight", [2, 3, 4, 5, 6]), 30);
  assert.equal(Y.score("lstraight", [1, 2, 3, 4, 6]), 0);
  assert.equal(Y.score("lstraight", [1, 2, 3, 4, 4]), 0);
});

test("yacht scoring: ヨット is 50 for five of a kind", () => {
  assert.equal(Y.score("yacht", [4, 4, 4, 4, 4]), 50);
  assert.equal(Y.score("yacht", [4, 4, 4, 4, 5]), 0);
  assert.equal(Y.isYacht([1, 1, 1, 1, 1]), true);
  assert.equal(Y.isYacht([1, 1, 1, 1, 2]), false);
  assert.equal(Y.isYacht(null), false);
});

test("yacht scoring: scoreAll lists all 12 boxes; bad dice or boxes throw", () => {
  const all = Y.scoreAll([3, 3, 3, 3, 3]);
  assert.deepEqual(Object.keys(all), [...Y.IDS]);
  assert.equal(Y.IDS.length, 12);
  assert.equal(all.threes, 15);
  assert.equal(all.yacht, 50);
  assert.equal(all.full, 0);
  assert.equal(all.four, 15);
  assert.ok(Object.isFrozen(all));
  [[0, 1, 2, 3, 4], [1, 2, 3], [1, 2, 3, 4, 7], [1.5, 2, 3, 4, 5], "12345", null].forEach(d => assert.throws(() => Y.score("choice", d), /サイコロ/));
  assert.throws(() => Y.score("bonus", [1, 2, 3, 4, 5]), /マス/);
});

/* ---------- sheet, bonus, totals ---------- */
test("yacht sheet: +35 bonus at 63 or more in the upper six", () => {
  const at63 = sheetWith({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  assert.equal(Y.upperSum(at63), 63);
  assert.equal(Y.bonusOf(at63), 35);
  assert.equal(Y.totalOf(at63), 98);
  const at62 = sheetWith({ ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  assert.equal(Y.bonusOf(at62), 0);
  assert.equal(Y.totalOf(at62), 62);
  assert.equal(Y.totalOf(sheetWith({ choice: 20, yacht: 50, sixes: 30, fives: 25, fours: 8 })), 133 + 35);
});

test("yacht sheet: bonusInfo tracks what is still needed and whether it is still possible", () => {
  const empty = Y.bonusInfo(sheetWith({}));
  assert.deepEqual({ ...empty }, { subtotal: 0, need: 63, reached: false, possible: true });
  const hopeless = Y.bonusInfo(sheetWith({ sixes: 0, fives: 0, fours: 4 }));
  assert.equal(hopeless.possible, false);
  const close = Y.bonusInfo(sheetWith({ sixes: 24, fives: 20, fours: 12 }));
  assert.equal(close.need, 7);
  assert.equal(close.possible, true);
});

/* ---------- turns ---------- */
test("yacht game: new game checks the number of players", () => {
  [0, 5, 1.5, "2", undefined].forEach(n => assert.throws(() => Y.newGame(n), /人数/));
  const g = Y.newGame(4);
  assert.equal(g.players, 4);
  assert.equal(g.sheets.length, 4);
  assert.equal(g.turn, 0);
  assert.equal(g.round, 1);
  assert.equal(g.rolls, 0);
  assert.equal(g.dice, null);
  assert.equal(g.over, false);
  assert.deepEqual(Y.openCats(g.sheets[0]), [...Y.IDS]);
  assert.equal(Y.previews(g), null);
});

test("yacht game: up to three rolls; held dice stay; the first roll throws all five", () => {
  let s = Y.newGame(1);
  assert.throws(() => Y.toggleHold(s, 0), /キープ/);
  s = Y.roll(s, facesR(1, 2, 3, 4, 5));
  assert.deepEqual(s.dice, [1, 2, 3, 4, 5]);
  assert.equal(s.rolls, 1);
  s = Y.toggleHold(Y.toggleHold(s, 0), 4);
  assert.deepEqual(s.held, [true, false, false, false, true]);
  s = Y.roll(s, facesR(6));
  assert.deepEqual(s.dice, [1, 6, 6, 6, 5]);
  assert.equal(Y.rollsLeft(s), 1);
  s = Y.roll(Y.setHeld(s, [false, true, true, true, true]), facesR(2));
  assert.deepEqual(s.dice, [2, 6, 6, 6, 5]);
  assert.equal(s.rolls, 3);
  assert.equal(Y.canRoll(s), false);
  assert.throws(() => Y.roll(s), /もうふれません/);
  assert.throws(() => Y.toggleHold(s, 1), /キープ/);
  assert.throws(() => Y.toggleHold(hand([1, 2, 3, 4, 5]), 5), /番号/);
  assert.throws(() => Y.toggleHold(hand([1, 2, 3, 4, 5]), -1), /番号/);
});

test("yacht game: rolling with every die held is not allowed; random faces stay 1-6", () => {
  const s = Y.setHeld(Y.roll(Y.newGame(1), facesR(2)), [true, true, true, true, true]);
  assert.equal(Y.canRoll(s), false);
  assert.throws(() => Y.roll(s), /全部キープ/);
  assert.throws(() => Y.setHeld(s, [true, true]), /キープの指定/);
  assert.deepEqual(Y.roll(Y.newGame(1), () => 0).dice, [1, 1, 1, 1, 1]);
  assert.deepEqual(Y.roll(Y.newGame(1), () => 0.9999999999).dice, [6, 6, 6, 6, 6]);
});

test("yacht game: marking a box scores it, clears the dice and passes the turn", () => {
  let s = Y.roll(Y.newGame(2), facesR(3, 3, 3, 5, 5));
  assert.throws(() => Y.choose(Y.newGame(2), "full"), /ふって/);
  assert.equal(Y.canScore(s, "full"), true);
  assert.deepEqual(Object.keys(Y.previews(s)), [...Y.IDS]);
  assert.equal(Y.previews(s).full, 19);
  s = Y.choose(s, "full");
  assert.equal(s.sheets[0].full, 19);
  assert.equal(s.turn, 1);
  assert.equal(s.round, 1);
  assert.equal(s.dice, null);
  assert.equal(s.rolls, 0);
  assert.deepEqual(s.held, [false, false, false, false, false]);
  assert.deepEqual({ ...s.last }, { player: 0, cat: "full", points: 19, bonus: false, yacht: false });
  s = Y.choose(Y.roll(s, facesR(1)), "yacht");
  assert.equal(s.sheets[1].yacht, 50);
  assert.equal(s.last.yacht, true);
  assert.equal(s.turn, 0);
  assert.equal(s.round, 2);
  s = Y.roll(s, facesR(2));
  assert.throws(() => Y.choose(s, "full"), /記入ずみ/);
  assert.throws(() => Y.choose(s, "nothing"), /マス/);
  assert.equal(Y.canScore(s, "full"), false);
  assert.equal("full" in Y.previews(s), false);
});

test("yacht game: a zero may be written into any open box", () => {
  const s = Y.choose(hand([1, 2, 4, 5, 6], 3), "yacht");
  assert.equal(s.sheets[0].yacht, 0);
  assert.equal(s.last.points, 0);
});

test("yacht game: last.bonus marks the move that reaches 63", () => {
  const s = hand([6, 6, 6, 6, 2], 1, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15 });
  const after = Y.choose(s, "sixes");
  assert.equal(after.last.bonus, true);
  assert.equal(Y.bonusOf(after.sheets[0]), 35);
  assert.equal(Y.choose(hand([6, 6, 1, 2, 3], 1, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15 }), "sixes").last.bonus, false);
});

test("yacht game: 12 turns each, then the game ends and nothing more is allowed", () => {
  const r = lcg(5);
  let s = Y.newGame(3);
  let turns = 0;
  while (!s.over) {
    s = Y.roll(s, r);
    s = Y.choose(s, Y.openCats(s.sheets[s.turn])[0]);
    turns += 1;
    if (!s.over) assert.equal(s.round, Math.floor(turns / 3) + 1);
  }
  assert.equal(turns, 36);
  assert.equal(s.round, 12);
  s.sheets.forEach(sheet => assert.equal(Y.openCats(sheet).length, 0));
  assert.throws(() => Y.roll(s), /終わって/);
  assert.throws(() => Y.choose(s, "ones"), /終わって/);
  assert.throws(() => Y.cpuPlan(s, "hard"), /終わって/);
  assert.equal(Y.previews(s), null);
});

test("yacht game: ranking shares places on equal totals", () => {
  const base = Y.newGame(3);
  const s = { ...base, sheets: [sheetWith({ choice: 20 }), sheetWith({ choice: 25 }), sheetWith({ choice: 20 })] };
  const rows = Y.ranking(s);
  assert.deepEqual(rows.map(r => [r.player, r.total, r.rank]), [[1, 25, 1], [0, 20, 2], [2, 20, 2]]);
  assert.deepEqual([...Y.winners(s)], [1]);
  const tie = { ...base, sheets: [sheetWith({ choice: 20 }), sheetWith({ choice: 20 }), sheetWith({ choice: 5 })] };
  assert.deepEqual([...Y.winners(tie)], [0, 1]);
});

test("yacht game: bad states are refused", () => {
  assert.throws(() => Y.roll(null), /状態/);
  assert.throws(() => Y.roll({ ...Y.newGame(1), turn: 3 }), /状態/);
  assert.throws(() => Y.choose({ ...Y.newGame(1), rolls: 1, dice: [1, 2, 3] }, "ones"), /サイコロ/);
});

/* ---------- immutability ---------- */
test("yacht game: every step returns new frozen state and leaves the input untouched", () => {
  const r = lcg(9);
  let s = Y.newGame(2);
  for (let k = 0; k < 6; k++) {
    const before = snapshot(s);
    const rolled = Y.roll(s, r);
    assert.equal(snapshot(s), before);
    const rolledSnap = snapshot(rolled);
    const held = Y.toggleHold(rolled, 2);
    assert.notEqual(held, rolled);
    assert.equal(snapshot(rolled), rolledSnap);
    const heldSnap = snapshot(held);
    const box = Y.openCats(held.sheets[held.turn])[0];
    const done = Y.choose(held, box);
    assert.equal(snapshot(held), heldSnap);
    assert.equal(held.sheets[held.turn][box], null);
    assert.notEqual(done.sheets[held.turn][box], null);
    [done, done.sheets, done.sheets[0], done.held, rolled.dice, held.held, done.last].forEach(o => assert.ok(Object.isFrozen(o)));
    assert.throws(() => { "use strict"; done.sheets[0].ones = 99; });
    s = done;
  }
});

/* ---------- CPU ---------- */
test("yacht cpu: every plan is legal at every level, in 1-4 player games", () => {
  const r = lcg(21);
  const check = (s, plan) => {
    if (s.rolls === 0) assert.deepEqual(plan, { action: "roll", held: [false, false, false, false, false] });
    if (s.rolls >= Y.ROLLS) assert.equal(plan.action, "score");
    if (plan.action === "score") assert.ok(Y.canScore(s, plan.cat), `cannot score ${plan.cat}`);
    else assert.ok(plan.held.length === 5 && plan.held.some(h => !h), "must reroll at least one die");
  };
  [["easy"], ["normal"], ["hard"], ["easy", "hard"], ["normal", "hard", "easy"], ["hard", "hard", "normal", "easy"]]
    .forEach(levels => {
      const s = playGame(levels, r, check);
      assert.equal(s.over, true);
    });
  assert.throws(() => Y.cpuPlan(Y.newGame(1), "oni"), /強さ/);
});

test("yacht cpu: ふつう and つよい keep made hands and score them", () => {
  ["normal", "hard"].forEach(level => {
    assert.deepEqual(Y.cpuPlan(hand([5, 5, 5, 5, 5]), level), { action: "score", cat: "yacht" }, level);
    assert.deepEqual(Y.cpuPlan(hand([2, 6, 4, 3, 5]), level), { action: "score", cat: "lstraight" }, level);
    assert.deepEqual(Y.cpuPlan(hand([3, 5, 3, 5, 3], 3), level), { action: "score", cat: "full" }, level);
  });
});

test("yacht cpu: ふつう and つよい chase a big straight from four in a row", () => {
  ["normal", "hard"].forEach(level => {
    const plan = Y.cpuPlan(hand([1, 2, 6, 3, 4]), level);
    assert.equal(plan.action, "roll", level);
    assert.deepEqual(plan.held, [true, true, false, true, true], level);
  });
});

test("yacht cpu: つよい goes for the yacht from four of a kind and keeps triples", () => {
  assert.deepEqual(Y.cpuPlan(hand([6, 6, 2, 6, 6]), "hard").held, [true, true, false, true, true]);
  const triple = Y.cpuPlan(hand([4, 1, 4, 6, 4], 1, { choice: 20 }), "hard");
  assert.equal(triple.action, "roll");
  assert.deepEqual(triple.held, [true, false, true, false, true]);
});

test("yacht cpu: つよい never throws away points it can bank", () => {
  const plan = Y.cpuPlan(hand([6, 6, 6, 6, 6], 3, { yacht: 50 }), "hard");
  assert.equal(plan.action, "score");
  assert.equal(Y.score(plan.cat, [6, 6, 6, 6, 6]), 30);
  const late = Y.cpuPlan(hand([6, 6, 5, 5, 4], 3, allBut(["ones", "yacht", "choice"])), "hard");
  assert.equal(late.cat, "choice");
  const keepOnes = Y.cpuPlan(hand([1, 2, 4, 5, 6], 3, allBut(["ones", "yacht", "choice"])), "hard");
  assert.equal(keepOnes.cat, "ones", "a weak hand goes into 1の目, saving チョイス for later");
});

test("yacht cpu: よわい keeps its most common face and takes the biggest score", () => {
  assert.deepEqual(Y.cpuPlan(hand([2, 5, 2, 5, 5]), "easy").held, [false, true, false, true, true]);
  assert.deepEqual(Y.cpuPlan(hand([4, 4, 4, 4, 2], 3, { choice: 20 }), "easy"), { action: "score", cat: "four" });
  assert.deepEqual(Y.cpuPlan(hand([1, 1, 1, 1, 1], 2), "easy"), { action: "score", cat: "yacht" });
});

test("yacht cpu: the levels are clearly different in strength", () => {
  const average = (level, games) => {
    const r = lcg(77);
    const totals = Array.from({ length: games }, () => Y.totalOf(playGame([level], r).sheets[0]));
    return totals.reduce((a, b) => a + b, 0) / games;
  };
  const easy = average("easy", 150);
  const normal = average("normal", 150);
  const hard = average("hard", 150);
  assert.ok(normal > easy + 15, `ふつう ${normal.toFixed(1)} vs よわい ${easy.toFixed(1)}`);
  assert.ok(hard > normal + 12, `つよい ${hard.toFixed(1)} vs ふつう ${normal.toFixed(1)}`);
  assert.ok(hard > 170, `つよい averages ${hard.toFixed(1)}`);
});

/* Random mid-game positions: some boxes filled, 1 or 2 rolls used, random holds. */
function randomPosition(r) {
  let s = Y.newGame(1 + Math.floor(r() * 2));
  const turns = Math.floor(r() * 11 * s.players);
  for (let k = 0; k < turns; k++) {
    const open = Y.openCats(s.sheets[s.turn]);
    s = Y.choose(Y.roll(s, r), open[Math.floor(r() * open.length)]);
  }
  s = Y.roll(s, r);
  if (r() < 0.5) s = Y.roll(Y.setHeld(s, s.held.map((_, i) => i < 4 && r() < 0.4)), r);
  return s;
}

/* The screen builds the search tables with warmUp() when a CPU game starts, so a CPU turn never pays for them.
   Each decision is timed as the best of 3 runs, so a busy machine's scheduler or GC pauses do not count;
   the bound keeps a 3x margin under the 150 ms phone budget. */
test("yacht cpu: worst-case think time keeps a 3x margin under 150 ms; the one-off table build stays under 150 ms", (t) => {
  const file = path.join(__dirname, "../src/yacht-rules.js");
  delete require.cache[require.resolve(file)];
  const fresh = require(file);
  const timed = (fn) => {
    const start = process.hrtime.bigint();
    const out = fn();
    return [out, Number(process.hrtime.bigint() - start) / 1e6];
  };
  const [, warm] = timed(() => fresh.warmUp());
  const r = lcg(31);
  const positions = Array.from({ length: 400 }, () => randomPosition(r));
  let worst = 0;
  fresh.LEVELS.forEach(level => positions.forEach(s => {
    const runs = [0, 1, 2].map(() => timed(() => fresh.cpuPlan(s, level, lcg(7))));
    worst = Math.max(worst, Math.min(...runs.map(([, ms]) => ms)));
    const plan = runs[0][0];
    assert.ok(plan.action === "score" ? fresh.canScore(s, plan.cat) : plan.held.some(h => !h));
  }));
  t.diagnostic(`warmUp ${warm.toFixed(1)} ms; worst decision ${worst.toFixed(1)} ms over ${positions.length * 3} decisions`);
  assert.ok(warm < 150, `warmUp ${warm.toFixed(1)} ms`);
  assert.ok(worst < 50 * TIMING_SLACK, `worst ${worst.toFixed(1)} ms`);
});

/* ---------- screen (src/yacht.js) on a tiny fake DOM with a fake clock ---------- */
const fs = require("node:fs");
const vm = require("node:vm");
const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

function fakeClock() {
  let now = 0;
  let seq = 0;
  let timers = new Map();
  const next = () => [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  return {
    setTimeout: (fn, ms = 0) => { seq += 1; timers = new Map([...timers, [seq, { at: now + ms, fn }]]); return seq; },
    clearTimeout: (id) => { timers = new Map([...timers].filter(([k]) => k !== id)); },
    now: () => now,
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (let n = next(); n && n[1].at <= end; n = next()) {
        timers = new Map([...timers].filter(([k]) => k !== n[0]));
        now = n[1].at;
        n[1].fn();
      }
      now = end;
    }
  };
}

function fakeNode(tag) {
  const classes = new Set();
  const node = {
    tagName: String(tag).toUpperCase(), children: [], parent: null, hidden: false, disabled: false, type: "",
    dataset: {}, attrs: {}, listeners: {}, textContent: "",
    style: { props: {}, setProperty: (k, v) => { node.style.props[k] = String(v); } },
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : Boolean(on); if (want) classes.add(c); else classes.delete(c); return want; }
    },
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    setAttribute(k, v) { node.attrs[k] = String(v); },
    getAttribute: (k) => node.attrs[k] ?? null,
    addEventListener(type, fn) { node.listeners[type] = [...(node.listeners[type] || []), fn]; },
    fire(type, ev = {}) { (node.listeners[type] || []).forEach(fn => fn({ target: node, preventDefault() {}, ...ev })); },
    click() { if (!node.disabled) node.fire("click"); },
    append(...kids) {
      kids.forEach(k => {
        if (typeof k === "string") { node.textContent += k; return; }
        k.parent = node;
        node.children = [...node.children, k];
      });
    },
    appendChild(k) { node.append(k); return k; },
    replaceChildren(...kids) { node.children = []; node.append(...kids); },
    matches(sel) { const [t, c] = sel.split("."); return (!t || node.tagName === t.toUpperCase()) && (!c || classes.has(c)); },
    closest(sel) { for (let n = node; n; n = n.parent) if (n.matches(sel)) return n; return null; }
  };
  return node;
}

/* Loads the real screen with the real shared helpers and rules; sound, music and effects are spies. */
function loadScreen(seed = 1) {
  const clock = fakeClock();
  const ids = [...read("partials/yacht.html").matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const byId = new Map(ids.map(id => [id, fakeNode("div")]));
  byId.get("yRolls").append(fakeNode("span"), fakeNode("span"), fakeNode("span"));
  const log = { sfx: [], music: [], confetti: 0 };
  const storage = new Map();
  const ctx = vm.createContext({
    document: { createElement: fakeNode, getElementById: (id) => byId.get(id) || null, addEventListener() {} },
    window: { matchMedia: () => ({ matches: false }) }, navigator: {}, console,
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, clockNow: clock.now, randomSource: lcg(seed),
    Sound: { ensure() {}, ctx: () => null, sfx: (n) => log.sfx.push(n), tone() {}, hiss() {}, hz: () => 440 },
    Music: { play: (t) => log.music.push(`play:${t}`), stop: () => log.music.push("stop"), intensify() {} },
    Fx: {
      replay: (el, cls) => { el.classList.remove(cls); el.classList.add(cls); },
      pop() {}, shake() {}, flash() {}, confetti: () => { log.confetti += 1; }
    }
  });
  vm.runInContext("Date.now = () => clockNow(); Math.random = () => randomSource();", ctx);
  ["shared.js", "random.js", "yacht-rules.js", "yacht.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const Yacht = vm.runInContext("Yacht", ctx);
  const $ = (id) => byId.get(id);
  const find = (box, text) => $(box).children.find(b => b.textContent.includes(text));
  const row = (cat) => $("ySheet").children.find(r => r.dataset.cat === cat);
  return {
    Yacht, clock, log, storage, $, row,
    button: (text) => find("yActions", text),
    chip: (box, text) => find(box, text),
    die: (i) => $("yDice").children[i],
    tapDie: (i) => $("yDice").fire("click", { target: $("yDice").children[i].children[0] }),
    tapRow: (cat) => $("ySheet").fire("click", { target: row(cat) }),
    cell: (cat, p) => row(cat).children[1 + p],
    faces: () => $("yDice").children.map(d => d.children[0].dataset.face).join(""),
    /* Every die after the next roll shows this face (one random number per die). */
    allFaces: (f) => { ctx.randomSource = () => (f - 1) / 6 + 0.01; },
    actions: () => $("yActions").children.map(b => b.textContent)
  };
}
/* Starts a game from the setup screen: vs is ひとりで / みんなで / CPUと. */
function begin(t, vs, extra = () => {}) {
  t.Yacht.init();
  t.chip("yVsChips", vs).click();
  extra(t);
  t.button("はじめる").click();
}
/* The player on turn rolls once and fills `cat` (a zero box gets its second, separate tap). */
function rollAndFill(t, cat) {
  t.button("ふる").click();
  t.clock.advance(700);
  t.tapRow(cat);
  if (t.button("に0点")) {
    t.clock.advance(500);
    t.tapRow(cat);
  }
}

test("yacht screen: every id the screen looks up is in the partial, and every id is prefixed", () => {
  const ids = [...read("partials/yacht.html").matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  ids.forEach(id => assert.ok(id === "modeYacht" || /^y[A-Z]/.test(id), id));
  const used = [...read("yacht.js").matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]);
  assert.ok(used.length > 15);
  used.forEach(id => assert.ok(ids.includes(id), `missing #${id}`));
});

test("yacht screen: the dice tumble on every roll, not only the first one", () => {
  const t = loadScreen();
  begin(t, "ひとりで");
  t.button("ふる").click();
  assert.ok(t.die(1).children[0].classList.contains("yacht-tumble"));
  t.clock.advance(700);
  assert.ok(t.die(1).children[0].classList.contains("yacht-land"), "the dice settle with a small bounce");
  t.tapDie(0);
  t.button("ふる").click();
  [1, 2, 3, 4].forEach(i => {
    const cube = t.die(i).children[0];
    assert.ok(cube.classList.contains("yacht-tumble"), `die ${i} tumbles`);
    assert.ok(!cube.classList.contains("yacht-land"), `die ${i}: the old landing class would override the tumble in the CSS`);
  });
  assert.ok(!t.die(0).children[0].classList.contains("yacht-tumble"), "a kept die stays still");
});

test("yacht screen: やめる in the middle of a game stops the music and every timer", () => {
  const t = loadScreen();
  begin(t, "CPUと", s => s.chip("yOrderChips", "後攻").click());
  t.clock.advance(600);
  assert.equal(t.log.music.at(-1), "play:think");
  t.button("やめる").click();
  assert.deepEqual(t.actions(), ["つづける", "やめる"]);
  t.button("やめる").click();
  assert.equal(t.$("ySetup").hidden, false);
  assert.equal(t.log.music.at(-1), "stop", "the game music must not keep playing on the setup screen");
  assert.equal(t.clock.pending(), 0);
});

test("yacht screen: a zero box needs a second, separate tap, and とりけす backs out", () => {
  const t = loadScreen();
  begin(t, "ひとりで");
  t.allFaces(6);
  t.button("ふる").click();
  t.clock.advance(700);
  t.tapRow("ones");
  assert.deepEqual(t.actions(), ["とりけす", "1の目に0点"]);
  t.tapRow("ones");
  assert.equal(t.cell("ones", 0).classList.contains("done"), false, "a quick double tap must not write the zero");
  t.button("とりけす").click();
  assert.deepEqual(t.actions(), ["やめる", "ふる（あと2回）"], "backing out brings the roll button back");
  t.tapRow("ones");
  t.clock.advance(500);
  t.tapRow("ones");
  assert.equal(t.cell("ones", 0).textContent, "0");
  assert.ok(t.cell("ones", 0).classList.contains("done"));
});

test("yacht screen: the +35 callout is not cut short by the next player's turn", () => {
  const t = loadScreen();
  begin(t, "みんなで", s => s.chip("yCountChips", "2人").click());
  /* A: 6の目 30 and 5の目 25 (B fills other boxes), then 4の目 20 reaches 75. */
  [[6, "sixes", "choice"], [5, "fives", "four"]].forEach(([face, mine, theirs]) => {
    t.allFaces(face);
    rollAndFill(t, mine);
    t.clock.advance(2500);
    rollAndFill(t, theirs);
    t.clock.advance(2500);
  });
  t.allFaces(4);
  rollAndFill(t, "fours");
  assert.equal(t.cell("fours", 0).textContent, "20");
  t.clock.advance(1000);
  assert.equal(t.$("yCallout").textContent, "ボーナス +35！");
  assert.equal(t.$("yCallout").hidden, false);
  t.clock.advance(1500);
  assert.equal(t.$("yCallout").textContent, "Bさんの番");
});

test("yacht screen: quitting during the CPU's turn leaves no stray step to act on the next game", () => {
  const t = loadScreen();
  begin(t, "CPUと", s => s.chip("yOrderChips", "後攻").click());
  t.clock.advance(700);
  t.button("やめる").click();
  t.button("やめる").click();
  t.chip("yVsChips", "ひとりで").click();
  t.button("はじめる").click();
  t.clock.advance(8000);
  assert.equal(t.faces(), "00000", "nobody rolled the new solo game's dice");
  assert.equal(t.$("yTitle").textContent, "合計 0点");
});

test("yacht screen: leave() stops the CPU, and onShow() lets it carry on", () => {
  const t = loadScreen();
  begin(t, "CPUと", s => s.chip("yOrderChips", "後攻").click());
  t.clock.advance(300);
  t.Yacht.leave();
  assert.equal(t.clock.pending(), 0);
  const frozen = t.faces();
  t.clock.advance(10000);
  assert.equal(t.faces(), frozen);
  t.Yacht.onShow();
  assert.equal(t.log.music.at(-1), "play:think");
  t.clock.advance(15000);
  assert.ok(t.button("ふる") && !t.button("ふる").disabled, "the CPU finished its turn and handed over");
});

test("yacht screen: a whole game against the CPU ends with a ranking, no timers left and the music off", () => {
  const t = loadScreen();
  begin(t, "CPUと", s => s.chip("yLevelChips", "つよい").click());
  for (let step = 0; step < 400 && t.$("yTray").hidden === false; step += 1) {
    const roll = t.button("ふる");
    if (roll && !roll.disabled) {
      const open = t.$("ySheet").children.filter(r => r.dataset.cat && r.classList.contains("used") === false);
      rollAndFill(t, open[0].dataset.cat);
    }
    t.clock.advance(500);
  }
  assert.equal(t.$("yTray").hidden, true, "the game reached the result screen");
  assert.equal(t.$("yRanking").children.length, 2);
  assert.deepEqual(t.actions(), ["設定", "もう一回"]);
  assert.equal(t.log.music.at(-1), "stop");
  assert.equal(t.clock.pending(), 0);
  Y.IDS.forEach(id => [0, 1].forEach(p => assert.ok(t.cell(id, p).classList.contains("done"), `${id} ${p}`)));
});

const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/finger-rules.js");

/* Repeatable random sources. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}
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
const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);
const sorted = (list) => [...list].sort((a, b) => String(a).localeCompare(String(b)));

/* ---------- constants and settings ---------- */
test("finger: modes, labels and limits", () => {
  assert.deepEqual([...F.MODES], ["one", "order", "teams"]);
  F.MODES.forEach(m => assert.ok(F.MODE_LABELS[m]));
  assert.deepEqual([...F.TEAM_COUNTS], [2, 3]);
  assert.equal(F.MAX_FINGERS, 10);
  assert.ok(Object.isFrozen(F.MODES) && Object.isFrozen(F.TEAM_COUNTS) && Object.isFrozen(F.MODE_LABELS));
});

test("finger: minimum fingers per mode", () => {
  assert.equal(F.minFingers("one"), 2);
  assert.equal(F.minFingers("order"), 2);
  assert.equal(F.minFingers("teams", 2), 2);
  assert.equal(F.minFingers("teams", 3), 3);
  assert.equal(F.minFingers("one", 99), 2, "team count is ignored outside team mode");
  assert.throws(() => F.minFingers("rock"), /モード/);
  assert.throws(() => F.minFingers("teams", 4), /チーム/);
});

test("finger: settings loaded from storage are validated", () => {
  assert.deepEqual(F.normalizeSettings({ mode: "teams", teams: 3 }), { mode: "teams", teams: 3 });
  assert.deepEqual(F.normalizeSettings({ mode: "order", teams: 2 }), { mode: "order", teams: 2 });
  assert.deepEqual(F.normalizeSettings({ mode: "nope", teams: 7 }), { mode: "one", teams: 2 });
  assert.deepEqual(F.normalizeSettings({ mode: "teams", teams: "3" }), { mode: "teams", teams: 2 });
  [null, undefined, 42, "x", []].forEach(bad => assert.deepEqual(F.normalizeSettings(bad), { mode: "one", teams: 2 }));
});

/* ---------- pick: one person ---------- */
test("finger: one picks a finger that is on the screen", () => {
  const list = ["a", "b", "c", "d"];
  assert.equal(F.pick(list, "one", 2, () => 0).winner, "a");
  assert.equal(F.pick(list, "one", 2, () => 0.999999).winner, "d");
  assert.equal(F.pick(list, "one", 2, () => 0.5).winner, "c");
  const r = F.pick(list, "one");
  assert.equal(r.mode, "one");
  assert.ok(list.includes(r.winner));
});

test("finger: one is fair over many seeded rounds", () => {
  const r = seeded(7);
  const wins = new Map();
  for (let i = 0; i < 4000; i++) {
    const w = F.pick([10, 20, 30, 40], "one", 2, r).winner;
    wins.set(w, (wins.get(w) || 0) + 1);
  }
  assert.equal(wins.size, 4);
  wins.forEach(count => assert.ok(count > 850 && count < 1150, `count ${count}`));
});

test("finger: the same random source gives the same result", () => {
  const a = F.pick(ids(6), "order", 2, seeded(3));
  const b = F.pick(ids(6), "order", 2, seeded(3));
  assert.deepEqual(a, b);
  const c = F.pick(ids(6), "teams", 3, seeded(11));
  const d = F.pick(ids(6), "teams", 3, seeded(11));
  assert.deepEqual(c, d);
});

/* ---------- pick: order ---------- */
test("finger: order uses every finger exactly once", () => {
  for (let n = 2; n <= F.MAX_FINGERS; n++) {
    const list = ids(n);
    const r = F.pick(list, "order", 2, seeded(n));
    assert.equal(r.mode, "order");
    assert.equal(r.order.length, n);
    assert.equal(new Set(r.order).size, n, "no repeats");
    assert.deepEqual(sorted(r.order), sorted(list));
  }
});

test("finger: order varies with the random source", () => {
  const seen = new Set();
  const r = seeded(99);
  for (let i = 0; i < 200; i++) seen.add(F.pick(["x", "y", "z"], "order", 2, r).order.join(""));
  assert.equal(seen.size, 6, "all 6 orders of 3 fingers appear");
});

/* ---------- pick: teams ---------- */
test("finger: teams are balanced and cover everyone once", () => {
  F.TEAM_COUNTS.forEach(k => {
    for (let n = k; n <= F.MAX_FINGERS; n++) {
      const list = ids(n);
      const r = F.pick(list, "teams", k, seeded(n * 10 + k));
      assert.equal(r.mode, "teams");
      assert.equal(r.teams.length, k);
      const sizes = r.teams.map(t => t.length);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `sizes ${sizes} for ${n} fingers`);
      assert.ok(sizes.every(s => s >= 1), "no empty team");
      const flat = r.teams.flat();
      assert.equal(new Set(flat).size, n, "nobody twice");
      assert.deepEqual(sorted(flat), sorted(list));
    }
  });
});

test("finger: team members change with the random source", () => {
  const firsts = new Set();
  const r = seeded(5);
  for (let i = 0; i < 100; i++) firsts.add(sorted(F.pick(ids(4), "teams", 2, r).teams[0]).join(","));
  assert.ok(firsts.size >= 4);
});

/* ---------- pick: validation ---------- */
test("finger: pick rejects bad input", () => {
  assert.throws(() => F.pick("abc", "one"), /指/);
  assert.throws(() => F.pick(null, "one"), /指/);
  assert.throws(() => F.pick([1], "one"), /2本/);
  assert.throws(() => F.pick([], "order"), /2本/);
  assert.throws(() => F.pick([1, 2], "teams", 3), /3本/);
  assert.throws(() => F.pick(ids(F.MAX_FINGERS + 1), "one"), /10本/);
  assert.throws(() => F.pick([1, 1], "one"), /同じ/);
  assert.throws(() => F.pick([1, NaN], "one"), /番号/);
  assert.throws(() => F.pick([1, ""], "one"), /番号/);
  assert.throws(() => F.pick([1, null], "one"), /番号/);
  assert.throws(() => F.pick([1, {}], "one"), /番号/);
  assert.throws(() => F.pick([1, 2], "all"), /モード/);
  assert.throws(() => F.pick([1, 2, 3, 4], "teams", 4), /チーム/);
  assert.throws(() => F.pick([1, 2], "one", 2, "random"), /乱数/);
});

test("finger: pick never changes its input and returns frozen results", () => {
  const list = Object.freeze([3, 1, 4, 5, 9]);
  ["one", "order", "teams"].forEach(mode => {
    const r = F.pick(list, mode, 2, seeded(1));
    assert.ok(Object.isFrozen(r));
    if (r.order) assert.ok(Object.isFrozen(r.order));
    if (r.teams) assert.ok(Object.isFrozen(r.teams) && r.teams.every(Object.isFrozen));
  });
  assert.deepEqual([...list], [3, 1, 4, 5, 9]);
  const plain = ["p", "q", "r"];
  F.pick(plain, "order", 2, seq(0.9, 0.1, 0.5));
  assert.deepEqual(plain, ["p", "q", "r"]);
});

/* ---------- lookups ---------- */
test("finger: rank and team lookups", () => {
  const order = F.pick(["a", "b", "c"], "order", 2, seq(0.1, 0.9));
  order.order.forEach((id, i) => assert.equal(F.rankOf(order, id), i + 1));
  assert.equal(F.rankOf(order, "zz"), 0);
  assert.equal(F.rankOf(null, "a"), 0);
  const teams = F.pick(ids(5), "teams", 2, seeded(2));
  teams.teams.forEach((members, k) => members.forEach(id => assert.equal(F.teamOf(teams, id), k)));
  assert.equal(F.teamOf(teams, 77), -1);
  assert.equal(F.teamOf(order, "a"), -1);
});

/* ---------- revealing the result ---------- */
test("finger: look follows how much of the result is revealed", () => {
  const one = F.pick(["a", "b", "c"], "one", 2, () => 0.5);
  assert.deepEqual(F.look(one, 0, [], "b"), { win: false, out: false, rank: 0, team: -1 }, "nothing before the reveal");
  assert.equal(F.look(one, 1, [], one.winner).win, true);
  assert.equal(F.look(one, 1, [], "a").out, true);
  assert.equal(F.look(null, 3, [], "a").win, false);

  const order = F.pick(["a", "b", "c"], "order", 2, seeded(4));
  const [first, second, third] = order.order;
  assert.equal(F.look(order, 1, [], first).rank, 1);
  assert.equal(F.look(order, 0, [], first).rank, 0, "no number before the first step");
  assert.equal(F.look(order, 1, [], second).rank, 0, "2 is not shown yet");
  assert.equal(F.look(order, 3, [], third).rank, 3);

  const teams = F.pick(["a", "b", "c", "d"], "teams", 2, seeded(8));
  const cycle = ["c", "a", "d", "b"];
  assert.equal(F.look(teams, 1, cycle, "c").team, F.teamOf(teams, "c"));
  assert.equal(F.look(teams, 1, cycle, "a").team, -1, "recolors one ring at a time along the circle");
  cycle.forEach(id => assert.equal(F.look(teams, 4, cycle, id).team, F.teamOf(teams, id)));
  assert.equal(F.look(teams, 4, ["a"], "zz").team, -1);
});

test("finger: reveal steps and summary text", () => {
  assert.equal(F.revealSteps(null), 0);
  assert.equal(F.revealSteps(F.pick(ids(5), "one", 2, () => 0)), 1);
  assert.equal(F.revealSteps(F.pick(ids(5), "order", 2, () => 0)), 5);
  assert.equal(F.revealSteps(F.pick(ids(7), "teams", 3, () => 0)), 7);
  assert.equal(F.summary(null), "");
  assert.match(F.summary(F.pick(ids(3), "one")), /きまり/);
  assert.match(F.summary(F.pick(ids(3), "order")), /順番/);
  assert.match(F.summary(F.pick(ids(4), "teams")), /チーム/);
  assert.ok(F.summary(F.pick(ids(7), "teams", 3)).length <= 12, "short enough for one line on a phone");
  assert.equal(F.detail(null), "");
  assert.equal(F.detail(F.pick(ids(3), "one")), "");
  assert.equal(F.detail(F.pick(ids(3), "order")), "");
  assert.equal(F.detail(F.pick(ids(5), "teams", 2, () => 0)), "A 3人・B 2人");
  assert.equal(F.detail(F.pick(ids(7), "teams", 3, () => 0)), "A 3人・B 2人・C 2人");
});

/* ---------- spin ---------- */
test("finger: sweep goes clockwise from the top around the middle", () => {
  const points = [
    { id: "W", x: 0, y: 100 }, { id: "S", x: 100, y: 200 },
    { id: "N", x: 100, y: 0 }, { id: "E", x: 200, y: 100 }
  ];
  assert.deepEqual([...F.sweep(points)], ["N", "E", "S", "W"]);
  assert.deepEqual([...F.sweep([{ id: 1, x: 5, y: 5 }])], [1]);
  assert.deepEqual([...F.sweep([])], []);
  assert.ok(Object.isFrozen(F.sweep(points)));
  assert.equal(points[0].id, "W", "input untouched");
  assert.throws(() => F.sweep([{ id: 1, x: "1", y: 2 }]), /位置/);
  assert.throws(() => F.sweep("no"), /位置/);
});

test("finger: spin path follows the circle and stops on the target", () => {
  const cycle = ["a", "b", "c", "d"];
  cycle.forEach(target => {
    const path = F.spinPath(cycle, target, 10);
    assert.equal(path[path.length - 1], target);
    assert.ok(path.length >= 10 && path.length < 10 + cycle.length);
    path.forEach((id, i) => assert.equal(id, cycle[i % cycle.length]));
  });
  assert.equal(F.spinPath(cycle, null, 9).length, 9);
  assert.equal(F.spinPath(["solo"], "solo", 3).length, 3);
  assert.ok(Object.isFrozen(F.spinPath(cycle, "a", 5)));
  assert.throws(() => F.spinPath(cycle, "x", 5), /当たり/);
  assert.throws(() => F.spinPath([], null, 5), /回す/);
  assert.throws(() => F.spinPath(cycle, "a", 0), /回数/);
});

test("finger: spin gets longer with more fingers", () => {
  assert.ok(F.minSpinSteps(2) >= 10);
  assert.ok(F.minSpinSteps(8) > F.minSpinSteps(2));
  assert.ok(F.minSpinSteps(8) >= 16, "at least two full laps");
  assert.throws(() => F.minSpinSteps(0));
});

test("finger: spin ticks speed up and fill the spin time", () => {
  [1, 2, 12, 25].forEach(steps => {
    const d = F.spinDelays(steps, 2000);
    assert.equal(d.length, steps);
    d.forEach(ms => assert.ok(Number.isInteger(ms) && ms > 0));
    for (let i = 1; i < d.length; i++) assert.ok(d[i] <= d[i - 1], "never slows down");
    const sum = d.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 2000) <= steps, `sum ${sum}`);
  });
  const d = F.spinDelays(20, 2200, 5);
  assert.ok(d[0] / d[d.length - 1] > 4, "clearly faster at the end");
  assert.ok(Object.isFrozen(d));
  assert.throws(() => F.spinDelays(0, 2000), /回数/);
  assert.throws(() => F.spinDelays(5, -1), /時間/);
  assert.throws(() => F.spinDelays(5, 1000, 0.5), /速さ/);
});

/* ---------- badge placement ---------- */
test("finger: badges point from each finger toward the middle of the screen", () => {
  const mid = { x: 200, y: 400 };
  assert.deepEqual(F.toward({ x: 200, y: 100 }, mid), { x: 0, y: 1 }, "finger at the top: badge below it");
  assert.deepEqual(F.toward({ x: 200, y: 700 }, mid), { x: 0, y: -1 }, "finger at the bottom: badge above it");
  assert.deepEqual(F.toward({ x: 0, y: 400 }, mid), { x: 1, y: 0 });
  const d = F.toward({ x: 50, y: 50 }, mid);
  assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9, "unit length");
  assert.ok(d.x > 0 && d.y > 0);
  assert.deepEqual(F.toward(mid, mid), { x: 0, y: -1 }, "right on the middle: above");
  assert.throws(() => F.toward({ x: "1", y: 2 }, mid), /位置/);
  assert.throws(() => F.toward({ x: 1, y: 2 }, null), /位置/);
});

/* Repeatable random finger layouts on a phone screen. */
function layouts(count, seed) {
  const r = seeded(seed);
  return Array.from({ length: count }, () => {
    const n = 2 + Math.floor(r() * 7);
    return Array.from({ length: n }, (_, i) => ({ id: i, x: 40 + r() * 295, y: 120 + r() * 500 }));
  });
}
const spots = (points, dirs, reach) => points.map((p, i) => ({ x: p.x + dirs[i].x * reach, y: p.y + dirs[i].y * reach }));

test("finger: badges stay nearest their own finger and apart, even with a finger in the middle (regression)", () => {
  /* With one finger near the middle, every badge used to point at the middle and pile up on that finger's ring,
   * so nobody could tell whose number was whose. */
  const box = { w: 375, h: 667 };
  const mid = { x: box.w / 2, y: box.h / 2 };
  const reach = 81;
  const fingers = [{ x: 90, y: 230 }, { x: 290, y: 260 }, { x: 110, y: 470 }, { x: 280, y: 500 }, { x: 190, y: 360 }];
  const dirs = F.badgeDirs(fingers, mid, reach, box);
  assert.equal(dirs.length, fingers.length);
  const at = spots(fingers, dirs, reach);
  at.forEach((s, i) => {
    assert.ok(Math.abs(Math.hypot(dirs[i].x, dirs[i].y) - 1) < 1e-9, "unit length");
    fingers.forEach((o, j) => { if (j !== i) assert.ok(Math.hypot(o.x - s.x, o.y - s.y) >= reach, `badge ${i} sits nearer finger ${j}`); });
    at.forEach((t, j) => { if (j !== i) assert.ok(Math.hypot(t.x - s.x, t.y - s.y) >= F.BADGE_GAP, `badges ${i} and ${j} overlap`); });
    assert.ok(s.x >= 0 && s.y >= 0 && s.x <= box.w && s.y <= box.h, "on screen");
  });
});

test("finger: badges rarely clash over many random layouts", () => {
  const box = { w: 375, h: 667 };
  const mid = { x: box.w / 2, y: box.h / 2 };
  let clashes = 0;
  let total = 0;
  layouts(400, 21).forEach(points => {
    const at = spots(points, F.badgeDirs(points, mid, 81, box), 81);
    at.forEach((s, i) => at.forEach((t, j) => {
      if (j <= i) return;
      total++;
      if (Math.hypot(t.x - s.x, t.y - s.y) < F.BADGE_GAP) clashes++;
    }));
  });
  assert.ok(clashes / total < 0.02, `${clashes} of ${total} badge pairs overlap`);
});

test("finger: badges keep facing the middle when nothing is in the way", () => {
  const box = { w: 400, h: 800 };
  const mid = { x: 200, y: 400 };
  const top = { x: 200, y: 100 };
  assert.deepEqual(F.badgeDirs([top, { x: 200, y: 700 }], mid, 80, box), [{ x: 0, y: 1 }, { x: 0, y: -1 }]);
  assert.deepEqual(F.badgeDirs([top], mid, 80, box), [F.toward(top, mid)]);
  assert.deepEqual(F.badgeDirs([], mid, 80, box), []);
  const crowded = [top, { x: 200, y: 180 }, { x: 120, y: 100 }, { x: 280, y: 100 }, { x: 140, y: 40 }, { x: 260, y: 40 }, { x: 200, y: 20 }];
  F.badgeDirs(crowded, mid, 80, box).forEach(d => assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9, "always a unit vector"));
  const frozen = Object.freeze([Object.freeze({ x: 10, y: 10 })]);
  F.badgeDirs(frozen, mid, 80, box);
  assert.throws(() => F.badgeDirs("x", mid, 80, box), /位置/);
  assert.throws(() => F.badgeDirs([{ x: "1", y: 1 }], mid, 80, box), /位置/);
  assert.throws(() => F.badgeDirs([top], mid, -1, box), /位置/);
  assert.throws(() => F.badgeDirs([top], mid, 80, null), /位置/);
});

/* ---------- fingers still pressed ---------- */
test("finger: pressed lists touch fingers still down (not lifted, not mouse points)", () => {
  const points = Object.freeze([
    { id: 1, fixed: false, up: false }, { id: 2, fixed: false, up: true }, { id: "m1", fixed: true, up: false }
  ]);
  assert.deepEqual(F.pressed(points).map(p => p.id), [1]);
  assert.deepEqual(F.pressed([]), []);
  assert.equal(points.length, 3, "input untouched");
  assert.throws(() => F.pressed(null), /指/);
});

test("finger: a lifted finger's pointer id can be used again (regression)", () => {
  /* After a result every lifted finger stays on screen (up: true). Browsers may reuse a pointer id for the
   * next touch; that touch used to be ignored because the id was still in the list. */
  const afterResult = [{ id: 2, fixed: false, up: true }, { id: 3, fixed: false, up: true }];
  assert.equal(F.isPressed(afterResult, 2), false, "lifted: a new touch with id 2 is a new finger");
  assert.equal(F.isPressed([{ id: 2, fixed: false, up: false }], 2), true, "still down: same finger");
  assert.equal(F.isPressed([{ id: "m1", fixed: true, up: false }], "m1"), false, "mouse points are not pressed");
  assert.equal(F.isPressed([], 7), false);
});

/* ---------- colors ---------- */
test("finger: each new finger gets the lowest free color slot", () => {
  assert.equal(F.nextSlot([], 10), 0);
  assert.equal(F.nextSlot([0, 1, 3], 10), 2);
  assert.equal(F.nextSlot([1, 0, 2], 3), -1, "all used");
  assert.equal(F.nextSlot([0, 0, 1], 4), 2, "duplicates are fine");
  assert.throws(() => F.nextSlot([0], 0), /色/);
  assert.throws(() => F.nextSlot("0", 3), /色/);
});

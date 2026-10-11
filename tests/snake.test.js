const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/snake-rules.js");

/* Repeatable random source. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}
/* Simple seeded generator for long runs. */
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function deepFreeze(o) {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}
const cell = (x, y) => ({ x, y });
const keyOf = (c) => `${c.x},${c.y}`;
/* A small custom position built on top of a fresh game. */
function custom(patch, opts = { cols: 6, rows: 6 }) {
  return { ...S.newGame(opts), bonus: null, ...patch };
}

/* ---------- constants ---------- */
test("snake: speeds, walls and board size", () => {
  assert.deepEqual([...S.SPEED_IDS], ["slow", "normal", "fast"]);
  assert.deepEqual(S.SPEED_IDS.map(id => S.SPEEDS[id].label), ["ゆっくり", "ふつう", "はやい"]);
  assert.deepEqual(S.WALL_OPTIONS.map(w => w.label), ["ぶつかる", "すりぬけ"]);
  assert.equal(S.SIZE.cols, 17);
  assert.equal(S.SIZE.rows, 17);
  assert.equal(S.BONUS_POINTS, 5);
  [S.SPEEDS, S.SPEED_IDS, S.DIRS, S.OPPOSITE, S.RANKS, S.WALL_OPTIONS].forEach(x => assert.ok(Object.isFrozen(x)));
});

test("snake: interval shrinks every few foods and stops at the floor", () => {
  S.SPEED_IDS.forEach(id => {
    const sp = S.SPEEDS[id];
    assert.equal(S.intervalMs(id, S.START_LENGTH), sp.baseMs);
    let last = Infinity;
    for (let len = S.START_LENGTH; len < 400; len++) {
      const ms = S.intervalMs(id, len);
      assert.ok(ms <= last, "never slows down");
      assert.ok(ms >= sp.minMs, "never below the floor");
      last = ms;
    }
    assert.equal(S.intervalMs(id, 399), sp.minMs);
  });
  assert.ok(S.intervalMs("slow", 3) > S.intervalMs("normal", 3));
  assert.ok(S.intervalMs("normal", 3) > S.intervalMs("fast", 3));
  assert.equal(S.levelFor(S.START_LENGTH), 1);
  assert.equal(S.levelFor(S.START_LENGTH + S.FOODS_PER_LEVEL - 1), 1);
  assert.equal(S.levelFor(S.START_LENGTH + S.FOODS_PER_LEVEL), 2);
  assert.equal(S.levelFor(1), 1);
  assert.throws(() => S.intervalMs("turbo", 3));
  assert.throws(() => S.intervalMs("normal", 0));
  assert.throws(() => S.levelFor(2.5));
});

/* ---------- new game ---------- */
test("snake: new game starts in the middle row, heading right, food straight ahead", () => {
  const g = S.newGame({ speed: "fast", wrap: true });
  assert.equal(g.cols, 17);
  assert.equal(g.rows, 17);
  assert.equal(g.speed, "fast");
  assert.equal(g.wrap, true);
  assert.equal(g.snake.length, S.START_LENGTH);
  assert.equal(g.dir, "right");
  const [head, ...body] = g.snake;
  assert.equal(head.y, 8);
  body.forEach((c, i) => assert.deepEqual(c, cell(head.x - i - 1, head.y)));
  assert.equal(g.food.y, head.y);
  assert.ok(g.food.x > head.x);
  assert.deepEqual([g.score, g.eaten, g.bonuses, g.over, g.won], [0, 0, 0, false, false]);
  assert.equal(g.bonus, null);
});

test("snake: new game checks its options", () => {
  assert.throws(() => S.newGame({ speed: "turbo" }), /スピード/);
  assert.throws(() => S.newGame({ wrap: "yes" }));
  assert.throws(() => S.newGame({ cols: 3 }));
  assert.throws(() => S.newGame({ rows: 41 }));
  assert.throws(() => S.newGame({ cols: 7.5 }));
  const small = S.newGame({ cols: 4, rows: 4 });
  assert.ok(small.food.x > small.snake[0].x && small.food.x < 4);
});

/* ---------- turning ---------- */
test("snake: turns queue up to two and never reverse", () => {
  const g = S.newGame();
  assert.equal(S.turn(g, "left"), g, "no reverse");
  assert.equal(S.turn(g, "right"), g, "same direction is ignored");
  const up = S.turn(g, "up");
  assert.deepEqual(up.queue, ["up"]);
  assert.equal(S.turn(up, "down"), up, "no reverse against the queued turn");
  const upLeft = S.turn(up, "left");
  assert.deepEqual(upLeft.queue, ["up", "left"]);
  assert.equal(S.turn(upLeft, "down"), upLeft, "queue holds two at most");
  assert.deepEqual(g.queue, [], "input untouched");
  assert.throws(() => S.turn(g, "north"), /向き/);
});

test("snake: one queued turn is used per step", () => {
  const g = S.turn(S.turn(S.newGame(), "up"), "left");
  const head = g.snake[0];
  const a = S.step(g, () => 0);
  assert.equal(a.dir, "up");
  assert.deepEqual(a.snake[0], cell(head.x, head.y - 1));
  assert.deepEqual(a.queue, ["left"]);
  const b = S.step(a, () => 0);
  assert.equal(b.dir, "left");
  assert.deepEqual(b.snake[0], cell(head.x - 1, head.y - 1));
  assert.deepEqual(b.queue, []);
});

/* ---------- moving and eating ---------- */
test("snake: a plain step moves the head and drops the tail", () => {
  const g = deepFreeze(S.newGame());
  const next = S.step(g, () => 0);
  assert.equal(next.snake.length, g.snake.length);
  assert.deepEqual(next.snake[0], cell(g.snake[0].x + 1, g.snake[0].y));
  assert.deepEqual(next.snake.slice(1), g.snake.slice(0, -1));
  assert.deepEqual(next.events, []);
  assert.equal(next.steps, 1);
});

test("snake: eating grows by one, scores a point and places food on a free cell", () => {
  const g = custom({ snake: [cell(2, 2), cell(1, 2), cell(0, 2)], dir: "right", food: cell(3, 2) });
  const next = S.step(deepFreeze(g), seq(0, 0.99));
  assert.equal(next.snake.length, 4);
  assert.deepEqual(next.snake[0], cell(3, 2));
  assert.deepEqual(next.snake[3], cell(0, 2), "tail stays this step");
  assert.equal(next.score, 1);
  assert.equal(next.eaten, 1);
  assert.ok(next.events.includes("eat"));
  assert.deepEqual(next.food, cell(0, 0), "first free cell for r = 0");
  assert.ok(!next.snake.some(c => keyOf(c) === keyOf(next.food)));
});

test("snake: food placement uses only free cells", () => {
  const snake = [cell(0, 0), cell(1, 0), cell(2, 0)];
  assert.deepEqual(S.placeFood(snake, 4, 4, [], () => 0), cell(3, 0));
  assert.deepEqual(S.placeFood(snake, 4, 4, [cell(3, 0)], () => 0), cell(0, 1));
  assert.deepEqual(S.placeFood(snake, 4, 4, [null], () => 0.999999), cell(3, 3));
  const all = Array.from({ length: 16 }, (_, i) => cell(i % 4, Math.floor(i / 4)));
  assert.equal(S.placeFood(all, 4, 4, [], () => 0.5), null);
  assert.throws(() => S.placeFood(snake, 4, 4, [], () => 1));
  assert.throws(() => S.placeFood(snake, 4, 4, [], () => NaN));
  const r = lcg(7);
  for (let n = 0; n < 300; n++) {
    const taken = all.filter(() => r() < 0.6);
    const block = all.filter(c => !taken.includes(c) && r() < 0.3);
    const spot = S.placeFood(taken, 4, 4, block, r);
    const used = new Set([...taken, ...block].map(keyOf));
    if (used.size === 16) assert.equal(spot, null);
    else assert.ok(spot && !used.has(keyOf(spot)) && spot.x < 4 && spot.y < 4);
  }
});

/* ---------- crashes and wrapping ---------- */
test("snake: solid walls end the game; the snake stays in place", () => {
  const g = custom({ snake: [cell(5, 3), cell(4, 3), cell(3, 3)], dir: "right", food: cell(0, 0) });
  const next = S.step(g, () => 0);
  assert.equal(next.over, true);
  assert.equal(next.won, false);
  assert.equal(next.cause, "wall");
  assert.deepEqual(next.snake, g.snake);
  assert.deepEqual(next.events, ["crash"]);
  assert.equal(S.step(next, () => 0), next, "nothing happens after the end");
  assert.equal(S.turn(next, "up"), next);
});

test("snake: すりぬけ wraps around every edge", () => {
  const base = { food: cell(3, 3), wrap: true };
  const cases = [
    [[cell(5, 1), cell(4, 1), cell(3, 1)], "right", cell(0, 1)],
    [[cell(0, 1), cell(1, 1), cell(2, 1)], "left", cell(5, 1)],
    [[cell(2, 0), cell(2, 1), cell(2, 2)], "up", cell(2, 5)],
    [[cell(2, 5), cell(2, 4), cell(2, 3)], "down", cell(2, 0)]
  ];
  cases.forEach(([snake, dir, expected]) => {
    const next = S.step(custom({ ...base, snake, dir }), () => 0);
    assert.equal(next.over, false);
    assert.deepEqual(next.snake[0], expected);
  });
});

test("snake: hitting the body ends the game, but chasing the tail is fine", () => {
  const u = custom({ snake: [cell(2, 1), cell(2, 2), cell(1, 2), cell(1, 1), cell(1, 0)], dir: "up", food: cell(5, 5) });
  const hit = S.step(S.turn(u, "left"), () => 0);
  assert.equal(hit.over, true);
  assert.equal(hit.cause, "self");
  const loop = custom({ snake: [cell(0, 1), cell(1, 1), cell(1, 0), cell(0, 0)], dir: "left", food: cell(5, 5) });
  const chase = S.step(S.turn(loop, "up"), () => 0);
  assert.equal(chase.over, false);
  assert.deepEqual(chase.snake[0], cell(0, 0));
});

/* ---------- bonus fruit ---------- */
test("snake: a bonus may appear after eating and vanishes after its time", () => {
  const g = custom({ snake: [cell(2, 2), cell(1, 2), cell(0, 2)], dir: "right", food: cell(3, 2) });
  const next = S.step(g, seq(0, 0, 0.99));
  assert.ok(next.events.includes("bonus-new"));
  assert.ok(next.bonus);
  assert.notDeepEqual(next.bonus, next.food);
  assert.ok(!next.snake.some(c => keyOf(c) === keyOf(next.bonus)));
  assert.equal(next.bonus.left, next.bonus.total);
  assert.equal(next.bonus.total, S.bonusSteps("normal", 4));
  const none = S.step(g, seq(0, S.BONUS_CHANCE));
  assert.equal(none.bonus, null);
  let s = { ...custom({ snake: [cell(0, 0), cell(0, 1), cell(0, 2)], dir: "up", food: cell(5, 5), wrap: true }), bonus: { x: 4, y: 4, left: 3, total: 3 } };
  s = S.step(s, () => 0);
  assert.equal(s.bonus.left, 2);
  s = S.step(S.step(s, () => 0), () => 0);
  assert.equal(s.bonus, null);
  assert.ok(s.events.includes("bonus-gone"));
});

test("snake: eating the bonus scores +5 without growing", () => {
  const g = { ...custom({ snake: [cell(2, 2), cell(1, 2), cell(0, 2)], dir: "right", food: cell(5, 5) }), bonus: { x: 3, y: 2, left: 9, total: 9 } };
  const next = S.step(g, () => 0);
  assert.equal(next.score, S.BONUS_POINTS);
  assert.equal(next.bonuses, 1);
  assert.equal(next.snake.length, 3);
  assert.equal(next.bonus, null);
  assert.deepEqual(next.events, ["bonus"]);
  assert.ok(S.bonusSteps("fast", 3) > S.bonusSteps("slow", 3));
});

/* ---------- level up and winning ---------- */
test("snake: a level event fires when the length reaches the next tier", () => {
  const len = S.START_LENGTH + S.FOODS_PER_LEVEL - 1;
  const snake = Array.from({ length: len }, (_, i) => cell(len - 1 - i, 0));
  const g = custom({ snake, dir: "right", food: cell(len, 0) }, { cols: 12, rows: 6 });
  const next = S.step(g, seq(0.5, 0.99));
  assert.ok(next.events.includes("level"));
  assert.equal(S.levelFor(next.snake.length), 2);
});

test("snake: filling the whole board wins", () => {
  const path = [];
  for (let y = 0; y < 4; y++) for (let i = 0; i < 4; i++) path.push(cell(y % 2 ? 3 - i : i, y));
  const snake = path.slice(0, 15).reverse();
  const g = custom({ snake, dir: "left", food: path[15] }, { cols: 4, rows: 4 });
  const next = S.step(g, () => 0);
  assert.equal(next.won, true);
  assert.equal(next.over, true);
  assert.equal(next.snake.length, 16);
  assert.equal(next.food, null);
  assert.ok(next.events.includes("win"));
});

test("snake: long random games keep every rule intact", () => {
  const dirs = ["up", "down", "left", "right"];
  for (let seed = 1; seed <= 40; seed++) {
    const r = lcg(seed);
    let g = S.newGame({ wrap: seed % 2 === 0, speed: S.SPEED_IDS[seed % 3] });
    for (let n = 0; n < 600 && !g.over; n++) {
      if (r() < 0.35) g = S.turn(g, dirs[Math.floor(r() * 4)]);
      const before = g;
      g = S.step(g, r);
      const keys = g.snake.map(keyOf);
      assert.equal(new Set(keys).size, keys.length, "no overlapping body");
      g.snake.forEach(c => assert.ok(c.x >= 0 && c.x < g.cols && c.y >= 0 && c.y < g.rows));
      assert.equal(g.snake.length, S.START_LENGTH + g.eaten);
      assert.equal(g.score, g.eaten + g.bonuses * S.BONUS_POINTS);
      if (g.food) assert.ok(!keys.includes(keyOf(g.food)));
      if (g.bonus) assert.ok(!keys.includes(keyOf(g.bonus)) && keyOf(g.bonus) !== keyOf(g.food));
      if (!g.over) {
        const d = S.DIRS[g.dir];
        const h = before.snake[0];
        const wrapX = (h.x + d.x + g.cols) % g.cols;
        const wrapY = (h.y + d.y + g.rows) % g.rows;
        assert.deepEqual(g.snake[0], cell(wrapX, wrapY));
      }
    }
  }
});

/* ---------- swipe helper ---------- */
test("snake: swipe direction follows the longer axis", () => {
  assert.equal(S.dirFromDelta(30, 5), "right");
  assert.equal(S.dirFromDelta(-30, 12), "left");
  assert.equal(S.dirFromDelta(4, -40), "up");
  assert.equal(S.dirFromDelta(-4, 40), "down");
  assert.equal(S.dirFromDelta(0, 0), null);
  assert.throws(() => S.dirFromDelta(NaN, 1));
});

/* ---------- ranks, settings, records ---------- */
test("snake: rank titles follow the score thresholds", () => {
  assert.equal(S.rankFor(0), "ミミズ級");
  S.RANKS.forEach(rk => {
    assert.equal(S.rankFor(rk.min), rk.title);
    if (rk.min > 0) assert.notEqual(S.rankFor(rk.min - 1), rk.title);
  });
  assert.equal(S.rankFor(100000), S.RANKS[0].title);
  const mins = S.RANKS.map(rk => rk.min);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a), "highest first");
  assert.throws(() => S.rankFor(-1));
});

test("snake: settings are cleaned when loaded", () => {
  assert.deepEqual(S.normalizeSettings(null), { speed: "normal", wrap: false });
  assert.deepEqual(S.normalizeSettings({ speed: "fast", wrap: true }), { speed: "fast", wrap: true });
  assert.deepEqual(S.normalizeSettings({ speed: "warp", wrap: "yes" }), { speed: "normal", wrap: false });
  assert.deepEqual(S.normalizeSettings([1, 2]), { speed: "normal", wrap: false });
});

test("snake: records are kept per speed and only go up", () => {
  const empty = S.normalizeRecords("junk");
  assert.deepEqual(empty, { slow: { score: 0, length: 0 }, normal: { score: 0, length: 0 }, fast: { score: 0, length: 0 } });
  assert.deepEqual(S.normalizeRecords({ fast: { score: -3, length: 2.5 }, normal: { score: 12, length: 9 } }).fast, { score: 0, length: 0 });
  const first = S.applyRecord(deepFreeze(empty), "fast", 12, 15);
  assert.equal(first.isNew, true);
  assert.equal(first.previous, 0);
  assert.deepEqual(first.records.fast, { score: 12, length: 15 });
  assert.deepEqual(first.records.slow, { score: 0, length: 0 });
  const lower = S.applyRecord(first.records, "fast", 5, 20);
  assert.equal(lower.isNew, false);
  assert.deepEqual(lower.records.fast, { score: 12, length: 20 });
  assert.equal(S.applyRecord(empty, "slow", 0, 3).isNew, false, "zero is not a record");
  assert.throws(() => S.applyRecord(empty, "warp", 1, 3));
  assert.throws(() => S.applyRecord(empty, "fast", -1, 3));
  assert.throws(() => S.applyRecord(empty, "fast", 1, 0));
});

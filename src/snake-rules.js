/* Snake rules: a grid snake that turns from a short input queue, grows on food, scores bonus stars, and crashes into walls or itself. */
const SnakeRules = (() => {
  const SIZE = Object.freeze({ cols: 17, rows: 17, min: 4, max: 40 });
  const START_LENGTH = 3;
  const MAX_QUEUE = 2;
  const FOOD_POINTS = 1;
  const BONUS_POINTS = 5;
  const BONUS_CHANCE = 0.2;
  const BONUS_MS = 6000;
  const FOODS_PER_LEVEL = 5;
  const LEVEL_FACTOR = 0.92;
  const MAX_RECORD = 99999;

  const DIR_IDS = Object.freeze(["up", "down", "left", "right"]);
  const DIRS = Object.freeze({
    up: Object.freeze({ x: 0, y: -1 }), down: Object.freeze({ x: 0, y: 1 }),
    left: Object.freeze({ x: -1, y: 0 }), right: Object.freeze({ x: 1, y: 0 })
  });
  const OPPOSITE = Object.freeze({ up: "down", down: "up", left: "right", right: "left" });
  const SPEED_IDS = Object.freeze(["slow", "normal", "fast"]);
  const SPEEDS = Object.freeze({
    slow: Object.freeze({ label: "ゆっくり", baseMs: 170, minMs: 110 }),
    normal: Object.freeze({ label: "ふつう", baseMs: 130, minMs: 80 }),
    fast: Object.freeze({ label: "はやい", baseMs: 95, minMs: 60 })
  });
  const WALL_OPTIONS = Object.freeze([
    Object.freeze({ value: false, label: "ぶつかる" }),
    Object.freeze({ value: true, label: "すりぬけ" })
  ]);
  /* Highest first. The score is foods (+1) plus bonus stars (+5). */
  const RANKS = Object.freeze([
    { min: 100, title: "伝説の大蛇級" }, { min: 70, title: "アナコンダ級" }, { min: 45, title: "ニシキヘビ級" },
    { min: 25, title: "アオダイショウ級" }, { min: 12, title: "シマヘビ級" }, { min: 5, title: "子ヘビ級" },
    { min: 0, title: "ミミズ級" }
  ].map(Object.freeze));
  const DEFAULT_SETTINGS = Object.freeze({ speed: "normal", wrap: false });

  /* ---------- checks ---------- */
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
  function checkSpeed(id) {
    if (!SPEED_IDS.includes(id)) throw new Error("スピードが正しくありません");
  }
  function checkLength(n) {
    if (!Number.isInteger(n) || n < 1) throw new Error("長さが正しくありません");
  }
  function checkSide(n) {
    if (!Number.isInteger(n) || n < SIZE.min || n > SIZE.max) throw new Error("盤の大きさが正しくありません");
  }
  /* One draw from the random source, which must return a number in [0, 1). */
  function roll(r) {
    const v = r();
    if (!(v >= 0 && v < 1)) throw new Error("乱数が正しくありません");
    return v;
  }

  /* ---------- speed ---------- */
  function levelFor(length) {
    checkLength(length);
    return Math.floor(Math.max(0, length - START_LENGTH) / FOODS_PER_LEVEL) + 1;
  }
  function intervalMs(speed, length) {
    checkSpeed(speed);
    const s = SPEEDS[speed];
    return Math.max(s.minMs, Math.round(s.baseMs * LEVEL_FACTOR ** (levelFor(length) - 1)));
  }
  /* How many steps a bonus star stays, so it lasts about BONUS_MS at the current speed. */
  const bonusSteps = (speed, length) => Math.ceil(BONUS_MS / intervalMs(speed, length));

  /* ---------- food ---------- */
  /* A random free cell (not on the snake or any blocked cell), or null when none is left. */
  function placeFood(snake, cols, rows, blocked = [], r = Math.random) {
    const used = new Set([...snake, ...blocked.filter(Boolean)].map(c => c.y * cols + c.x));
    const free = [];
    for (let i = 0; i < cols * rows; i++) if (!used.has(i)) free.push(i);
    if (free.length === 0) return null;
    const i = free[Math.floor(roll(r) * free.length)];
    return { x: i % cols, y: Math.floor(i / cols) };
  }

  /* ---------- game ---------- */
  function newGame(opts = {}) {
    const o = isObj(opts) ? opts : {};
    const speed = o.speed ?? DEFAULT_SETTINGS.speed;
    const wrap = o.wrap ?? DEFAULT_SETTINGS.wrap;
    const cols = o.cols ?? SIZE.cols;
    const rows = o.rows ?? SIZE.rows;
    checkSpeed(speed);
    if (typeof wrap !== "boolean") throw new Error("壁の設定が正しくありません");
    checkSide(cols);
    checkSide(rows);
    const y = Math.floor(rows / 2);
    const headX = Math.max(START_LENGTH - 1, Math.floor(cols / 4) + 1);
    const foodX = Math.min(cols - 1, Math.max(headX + 1, cols - 1 - Math.floor(cols / 4)));
    return {
      cols, rows, wrap, speed,
      snake: Array.from({ length: START_LENGTH }, (_, i) => ({ x: headX - i, y })),
      dir: "right", queue: [], food: { x: foodX, y }, bonus: null,
      score: 0, eaten: 0, bonuses: 0, steps: 0,
      over: false, won: false, cause: null, events: []
    };
  }

  /* Queues a turn. Ignored when it repeats or reverses the last planned direction, or two turns are already waiting. */
  function turn(state, dir) {
    if (!DIR_IDS.includes(dir)) throw new Error("向きが正しくありません");
    if (state.over || state.queue.length >= MAX_QUEUE) return state;
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (dir === last || dir === OPPOSITE[last]) return state;
    return { ...state, queue: [...state.queue, dir] };
  }

  const addEvent = (s, name) => ({ ...s, events: [...s.events, name] });

  function nextHead(state, dir) {
    const d = DIRS[dir];
    const h = state.snake[0];
    const x = h.x + d.x;
    const y = h.y + d.y;
    if (state.wrap) return { x: (x + state.cols) % state.cols, y: (y + state.rows) % state.rows };
    return x < 0 || y < 0 || x >= state.cols || y >= state.rows ? null : { x, y };
  }
  const crash = (s, cause) => ({ ...s, over: true, cause, events: ["crash"] });

  function tickBonus(s, ateBonus) {
    if (!s.bonus) return s;
    if (ateBonus) return addEvent({ ...s, bonus: null, score: s.score + BONUS_POINTS, bonuses: s.bonuses + 1 }, "bonus");
    const left = s.bonus.left - 1;
    return left > 0 ? { ...s, bonus: { ...s.bonus, left } } : addEvent({ ...s, bonus: null }, "bonus-gone");
  }
  function maybeBonus(s, r) {
    if (s.bonus || roll(r) >= BONUS_CHANCE) return s;
    const spot = placeFood(s.snake, s.cols, s.rows, [s.food], r);
    if (!spot) return s;
    const total = bonusSteps(s.speed, s.snake.length);
    return addEvent({ ...s, bonus: { x: spot.x, y: spot.y, left: total, total } }, "bonus-new");
  }
  /* New food after eating. No free cell left means the snake fills the board: a win. */
  function refill(s, r) {
    const food = placeFood(s.snake, s.cols, s.rows, [s.bonus], r);
    if (food) return maybeBonus({ ...s, food }, r);
    const spare = s.bonus ? placeFood(s.snake, s.cols, s.rows, [], r) : null;
    if (spare) return { ...s, food: spare, bonus: null };
    return addEvent({ ...s, food: null, bonus: null, over: true, won: true }, "win");
  }
  function afterFood(s, oldLength, r) {
    const fed = addEvent({ ...s, score: s.score + FOOD_POINTS, eaten: s.eaten + 1 }, "eat");
    const leveled = levelFor(fed.snake.length) > levelFor(oldLength) ? addEvent(fed, "level") : fed;
    return refill(leveled, r);
  }

  /* One move. events lists what happened: eat, level, bonus, bonus-new, bonus-gone, crash, win. */
  function step(state, r = Math.random) {
    if (state.over) return state;
    const [next, ...rest] = state.queue;
    const dir = next ?? state.dir;
    const moved = { ...state, dir, queue: rest, steps: state.steps + 1, events: [] };
    const head = nextHead(state, dir);
    if (!head) return crash(moved, "wall");
    const ateFood = same(head, state.food);
    const body = ateFood ? state.snake : state.snake.slice(0, -1);
    if (body.some(c => same(c, head))) return crash(moved, "self");
    const grown = { ...moved, snake: [head, ...body] };
    if (ateFood) return afterFood(tickBonus(grown, false), state.snake.length, r);
    return tickBonus(grown, same(head, state.bonus));
  }

  /* ---------- input helper ---------- */
  function dirFromDelta(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("スワイプの値が正しくありません");
    if (dx === 0 && dy === 0) return null;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "down" : "up";
  }

  /* ---------- ranks, settings, records ---------- */
  function rankFor(score) {
    if (!Number.isFinite(score) || score < 0) throw new Error("スコアが正しくありません");
    return RANKS.find(rk => score >= rk.min).title;
  }
  function normalizeSettings(raw) {
    const s = isObj(raw) ? raw : {};
    return {
      speed: SPEED_IDS.includes(s.speed) ? s.speed : DEFAULT_SETTINGS.speed,
      wrap: typeof s.wrap === "boolean" ? s.wrap : DEFAULT_SETTINGS.wrap
    };
  }
  const cleanCount = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_RECORD) : 0);
  function normalizeRecords(raw) {
    const src = isObj(raw) ? raw : {};
    return Object.fromEntries(SPEED_IDS.map(id => {
      const e = isObj(src[id]) ? src[id] : {};
      return [id, { score: cleanCount(e.score), length: cleanCount(e.length) }];
    }));
  }
  /* New records object (the input is untouched) and whether this score beat the best for that speed. */
  function applyRecord(records, speed, score, length) {
    checkSpeed(speed);
    if (!Number.isInteger(score) || score < 0) throw new Error("スコアが正しくありません");
    checkLength(length);
    const clean = normalizeRecords(records);
    const prev = clean[speed];
    const best = { score: Math.min(Math.max(prev.score, score), MAX_RECORD), length: Math.min(Math.max(prev.length, length), MAX_RECORD) };
    return { records: { ...clean, [speed]: best }, isNew: score > prev.score, previous: prev.score };
  }

  return {
    SIZE, START_LENGTH, MAX_QUEUE, FOOD_POINTS, BONUS_POINTS, BONUS_CHANCE, BONUS_MS, FOODS_PER_LEVEL, MAX_RECORD,
    DIR_IDS, DIRS, OPPOSITE, SPEED_IDS, SPEEDS, WALL_OPTIONS, RANKS, DEFAULT_SETTINGS,
    levelFor, intervalMs, bonusSteps, placeFood, newGame, turn, step, dirFromDelta,
    rankFor, normalizeSettings, normalizeRecords, applyRecord
  };
})();

if (typeof module !== "undefined") module.exports = SnakeRules;

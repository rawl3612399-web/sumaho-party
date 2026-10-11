const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../src/blockfall-rules.js");

/* Repeatable random source (mulberry32). */
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
const sortCells = (cells) => [...cells].map(c => [...c]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const abs = (p) => sortCells(B.cellsOf(p));
const piece = (type, rot, x, y) => ({ type, rot, x, y });
/* A game whose board and active piece are set by the test. */
function setup(board, active, extra = {}) {
  const g = B.newGame(1, seeded(1));
  return { ...g, board, active, lowestY: active ? active.y : 0, ...extra };
}
const bottom = (rows) => B.boardFromText(rows);
const FULL = "XXXXXXXXXX";

/* ---------- pieces and rotation states ---------- */
test("pieces: seven pieces, four states of four cells each", () => {
  assert.deepEqual([...B.PIECES].sort(), ["I", "J", "L", "O", "S", "T", "Z"]);
  B.PIECES.forEach(p => [0, 1, 2, 3].forEach(rot => {
    const c = B.cells(p, rot);
    assert.equal(c.length, 4);
    assert.equal(new Set(c.map(([x, y]) => `${x},${y}`)).size, 4, `${p}${rot} cells are distinct`);
  }));
  assert.throws(() => B.cells("Q", 0));
  assert.throws(() => B.cells("T", 4));
});

test("pieces: T and I states match SRS", () => {
  assert.deepEqual(sortCells(B.cells("T", 0)), sortCells([[1, 0], [0, 1], [1, 1], [2, 1]]));
  assert.deepEqual(sortCells(B.cells("T", 1)), sortCells([[1, 0], [1, 1], [2, 1], [1, 2]]));
  assert.deepEqual(sortCells(B.cells("T", 2)), sortCells([[0, 1], [1, 1], [2, 1], [1, 2]]));
  assert.deepEqual(sortCells(B.cells("T", 3)), sortCells([[1, 0], [0, 1], [1, 1], [1, 2]]));
  assert.deepEqual(sortCells(B.cells("I", 1)), sortCells([[2, 0], [2, 1], [2, 2], [2, 3]]));
  assert.deepEqual(sortCells(B.cells("I", 2)), sortCells([[0, 2], [1, 2], [2, 2], [3, 2]]));
  assert.deepEqual(sortCells(B.cells("I", 3)), sortCells([[1, 0], [1, 1], [1, 2], [1, 3]]));
  [0, 1, 2, 3].forEach(rot => assert.deepEqual(sortCells(B.cells("O", rot)), sortCells(B.cells("O", 0))));
});

test("pieces: spawn centered in the top hidden rows, then shown on the first visible row", () => {
  B.PIECES.forEach(p => {
    const cols = B.cells(p, 0).map(([x]) => x + B.SPAWN_X[p]);
    const mid = (Math.min(...cols) + Math.max(...cols)) / 2;
    assert.ok(mid >= 3.5 && mid <= 5, `${p} spawns near the middle`);
  });
  const g = B.newGame(1, seeded(3));
  const ys = B.cellsOf(g.active).map(([, y]) => y);
  assert.equal(Math.max(...ys), B.HIDDEN, "lowest cell is on the first visible row");
});

/* ---------- kick tables ---------- */
test("kicks: eight transitions with five tests each, converted to y-down", () => {
  ["JLSTZ", "I"].forEach(k => {
    assert.equal(Object.keys(B.KICKS[k]).length, 8);
    Object.values(B.KICKS[k]).forEach(list => {
      assert.equal(list.length, 5);
      assert.deepEqual(list[0], [0, 0]);
    });
  });
  assert.deepEqual(B.KICKS.JLSTZ["0>1"], [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]);
  assert.deepEqual(B.KICKS.I["0>1"], [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]]);
  assert.deepEqual(B.KICKS.I["3>0"], [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]]);
});

test("kicks: each reverse transition undoes the forward offsets", () => {
  ["JLSTZ", "I"].forEach(k => Object.entries(B.KICKS[k]).forEach(([key, list]) => {
    const [a, b] = key.split(">");
    const back = B.KICKS[k][`${b}>${a}`];
    list.forEach(([x, y], i) => assert.deepEqual(back[i], [0 - x, 0 - y], `${k} ${key} test ${i + 1}`));
  }));
});

/* ---------- rotation ---------- */
test("rotate: open space uses no kick and four turns come back", () => {
  const board = B.emptyBoard();
  B.PIECES.forEach(type => [1, -1].forEach(dir => {
    let p = piece(type, 0, 3, 8);
    for (let i = 0; i < 4; i++) {
      const res = B.tryRotate(board, p, dir);
      assert.equal(res.kick, 0);
      p = res.piece;
    }
    assert.deepEqual(p, piece(type, 0, 3, 8));
  }));
  assert.throws(() => B.tryRotate(board, piece("T", 0, 3, 8), 2));
});

test("rotate: T against the left wall kicks right (both directions)", () => {
  const board = B.emptyBoard();
  const atWall = piece("T", 1, -1, 10);
  assert.ok(abs(atWall).every(([x]) => x >= 0), "start position is legal");
  const cw = B.tryRotate(board, atWall, 1);
  assert.equal(cw.kick, 1);
  assert.deepEqual(cw.piece, piece("T", 2, 0, 10));
  const ccw = B.tryRotate(board, atWall, -1);
  assert.equal(ccw.kick, 1);
  assert.deepEqual(ccw.piece, piece("T", 0, 0, 10));
});

test("rotate: T against the right wall kicks left", () => {
  const board = B.emptyBoard();
  const atWall = piece("T", 3, 8, 10);
  assert.ok(abs(atWall).every(([x]) => x <= 9));
  const cw = B.tryRotate(board, atWall, 1);
  assert.equal(cw.kick, 1);
  assert.deepEqual(cw.piece, piece("T", 0, 7, 10));
  const ccw = B.tryRotate(board, atWall, -1);
  assert.equal(ccw.kick, 1);
  assert.deepEqual(ccw.piece, piece("T", 2, 7, 10));
});

test("rotate: T on the floor kicks up and over (test 3)", () => {
  const board = B.emptyBoard();
  const onFloor = piece("T", 0, 4, B.ROWS - 2);
  const res = B.tryRotate(board, onFloor, 1);
  assert.equal(res.kick, 2);
  assert.deepEqual(res.piece, piece("T", 1, 3, B.ROWS - 3));
});

/* Board filled everywhere except the start and target cells of the piece. */
function slotBoard(start, target) {
  const open = new Set([...abs(start), ...abs(target)].map(([x, y]) => `${x},${y}`));
  return B.emptyBoard().map((row, y) => row.map((_, x) => (open.has(`${x},${y}`) ? null : "X")));
}

test("rotate: T drops two rows into a slot counter-clockwise (test 4)", () => {
  const start = piece("T", 2, 4, 10);
  const target = piece("T", 1, 4, 12);
  const res = B.tryRotate(slotBoard(start, target), start, -1);
  assert.equal(res.kick, 3);
  assert.deepEqual(res.piece, target);
});

test("rotate: T climbs two rows out of a hole clockwise (test 4)", () => {
  const start = piece("T", 3, 4, 12);
  const target = piece("T", 0, 4, 10);
  const res = B.tryRotate(slotBoard(start, target), start, 1);
  assert.equal(res.kick, 3);
  assert.deepEqual(res.piece, target);
});

test("rotate: T twists two down and one over counter-clockwise (test 5)", () => {
  const start = piece("T", 0, 4, 10);
  const target = piece("T", 3, 5, 12);
  const res = B.tryRotate(slotBoard(start, target), start, -1);
  assert.equal(res.kick, 4);
  assert.deepEqual(res.piece, target);
});

test("rotate: I kicks off both walls", () => {
  const board = B.emptyBoard();
  const right = B.tryRotate(board, piece("I", 1, 7, 8), 1);
  assert.equal(right.kick, 1);
  assert.deepEqual(right.piece, piece("I", 2, 6, 8));
  const leftCw = B.tryRotate(board, piece("I", 3, -1, 8), 1);
  assert.equal(leftCw.kick, 1);
  assert.deepEqual(leftCw.piece, piece("I", 0, 0, 8));
  const leftCcw = B.tryRotate(board, piece("I", 3, -1, 8), -1);
  assert.equal(leftCcw.kick, 2);
  assert.deepEqual(leftCcw.piece, piece("I", 2, 0, 8));
});

test("rotate: fails when every kick is blocked; O never moves", () => {
  const start = piece("T", 0, 4, 10);
  const open = new Set(abs(start).map(([x, y]) => `${x},${y}`));
  const boxed = B.emptyBoard().map((row, y) => row.map((_, x) => (open.has(`${x},${y}`) ? null : "X")));
  assert.equal(B.tryRotate(boxed, start, 1), null);
  assert.equal(B.tryRotate(boxed, start, -1), null);
  const g = setup(boxed, start);
  const after = B.rotate(g, 1);
  assert.deepEqual(after.active, start);
  assert.deepEqual(after.events, []);
  const o = B.tryRotate(B.emptyBoard(), piece("O", 0, 4, 5), 1);
  assert.deepEqual(abs(o.piece), abs(piece("O", 0, 4, 5)));
});

/* ---------- collision and movement ---------- */
test("collision: walls, floor and filled cells", () => {
  const board = bottom(["X........."]);
  assert.equal(B.collides(board, piece("I", 0, -1, 5)), true);
  assert.equal(B.collides(board, piece("I", 0, 7, 5)), true);
  assert.equal(B.collides(board, piece("O", 0, 4, B.ROWS - 1)), true);
  assert.equal(B.collides(board, piece("O", 0, 0, B.ROWS - 3)), false);
  assert.equal(B.collides(board, piece("O", 0, 0, B.ROWS - 2)), true);
  assert.equal(B.tryMove(board, piece("O", 0, 0, 5), -1, 0), null);
  assert.deepEqual(B.tryMove(board, piece("O", 0, 0, 5), 1, 0), piece("O", 0, 1, 5));
});

test("ghost: lands on the stack", () => {
  const board = bottom(["....X.....", "XXXXX....."]);
  const g = B.ghost(board, piece("O", 0, 3, 2));
  assert.equal(g.y, B.ROWS - 4);
  assert.equal(B.onGround(board, g), true);
});

/* ---------- line clears and scoring ---------- */
test("clearLines: removes full rows and drops the rest", () => {
  const board = bottom(["...J......", FULL, "..T.......", FULL]);
  const res = B.clearLines(board);
  assert.deepEqual(res.rows, [B.ROWS - 3, B.ROWS - 1]);
  assert.deepEqual(res.board, bottom(["...J......", "..T......."]));
  assert.equal(res.board.length, B.ROWS);
  const none = B.clearLines(bottom(["XXXXXXXXX."]));
  assert.deepEqual(none.rows, []);
});

test("scoring: 1-4 lines are 100/300/500/800 times the level", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(n => B.lineScore(n, 1)), [0, 100, 300, 500, 800]);
  assert.equal(B.lineScore(4, 3), 2400);
  assert.throws(() => B.lineScore(5, 1));
  assert.throws(() => B.lineScore(1, 0));
});

test("hard drop: four lines with an I piece, 2 points per row dropped", () => {
  const well = "XXXXXXXXX.";
  const g = setup(bottom([well, well, well, well]), piece("I", 1, 7, 2), { level: 2, startLevel: 2 });
  const after = B.hardDrop(g, seeded(5));
  const dist = (B.ROWS - 4) - 2;
  assert.equal(after.lines, 4);
  assert.equal(after.quads, 1);
  assert.equal(after.score, 800 * 2 + dist * 2);
  assert.equal(B.stackHeight(after.board), 0);
  const clear = after.events.find(e => e.kind === "clear");
  assert.equal(clear.count, 4);
  assert.equal(clear.points, 1600);
  assert.equal(clear.colors.length, 4);
  assert.ok(after.events.some(e => e.kind === "hard" && e.dist === dist));
  assert.ok(after.events.some(e => e.kind === "spawn"));
});

test("soft drop: one point per row", () => {
  const g = setup(B.emptyBoard(), piece("T", 0, 3, 5));
  const once = B.softStep(g);
  assert.equal(once.active.y, 6);
  assert.equal(once.score, 1);
  const held = B.tick(g, B.SOFT_DROP_MS * 3, true);
  assert.equal(held.active.y, 8);
  assert.equal(held.score, 3);
});

test("levels: up every 10 lines, gravity gets faster", () => {
  assert.equal(B.levelFor(1, 9), 1);
  assert.equal(B.levelFor(1, 10), 2);
  assert.equal(B.levelFor(5, 25), 7);
  assert.equal(B.gravityMs(1), 1000);
  for (let lv = 2; lv <= B.GRAVITY_MS.length; lv++) assert.ok(B.gravityMs(lv) < B.gravityMs(lv - 1));
  assert.equal(B.gravityMs(60), B.GRAVITY_MS[B.GRAVITY_MS.length - 1]);
  const row = "XXXXXXXXX.";
  const g = setup(bottom([row, row]), piece("I", 1, 7, 2), { lines: 8 });
  const after = B.hardDrop(g, seeded(2));
  assert.equal(after.lines, 10);
  assert.equal(after.level, 2);
  assert.ok(after.events.some(e => e.kind === "level" && e.level === 2));
  assert.equal(B.isIntense({ level: 4, startLevel: 1 }), true);
  assert.equal(B.isIntense({ level: 3, startLevel: 1 }), false);
});

/* ---------- randomizer ---------- */
test("bag: every group of seven has each piece once", () => {
  [1, 2, 42, 777, 2024].forEach(seed => {
    const r = seeded(seed);
    let g = B.newGame(1, r);
    const seen = [g.active.type];
    for (let i = 0; i < 69; i++) {
      g = B.hardDrop({ ...g, board: B.emptyBoard() }, r);
      seen.push(g.active.type);
      assert.ok(g.queue.length >= B.NEXT_COUNT);
    }
    for (let i = 0; i < 70; i += 7) assert.deepEqual([...seen.slice(i, i + 7)].sort(), [...B.PIECES].sort(), `seed ${seed} bag ${i / 7}`);
  });
});

test("bag: same random source gives the same sequence", () => {
  const a = B.newGame(1, seeded(9));
  const b = B.newGame(1, seeded(9));
  assert.deepEqual([a.active.type, ...a.queue], [b.active.type, ...b.queue]);
  assert.deepEqual(B.nextPieces(a), a.queue.slice(0, 3));
  assert.throws(() => B.newGame(0));
  assert.throws(() => B.newGame(1.5));
});

/* ---------- hold ---------- */
test("hold: first hold takes the next piece; only once per drop", () => {
  const g = B.newGame(1, seeded(4));
  const first = g.active.type;
  const next = g.queue[0];
  const h = B.hold(g, seeded(4));
  assert.equal(h.hold, first);
  assert.equal(h.active.type, next);
  assert.equal(h.canHold, false);
  assert.equal(h.queue.length >= B.NEXT_COUNT, true);
  const again = B.hold(h, seeded(4));
  assert.deepEqual(again.active, h.active);
  assert.equal(again.hold, first);
  assert.deepEqual(again.events, []);
});

test("hold: swap brings the held piece back at the top, unlocked after the next lock", () => {
  const g = B.newGame(1, seeded(6));
  const first = g.active.type;
  const h1 = B.hold(g, seeded(6));
  const moved = B.move(B.move(h1, 1), 1);
  const locked = B.hardDrop(moved, seeded(6));
  assert.equal(locked.canHold, true);
  const swapType = locked.active.type;
  const h2 = B.hold(locked, seeded(6));
  assert.equal(h2.active.type, first);
  assert.equal(h2.active.rot, 0);
  assert.equal(h2.active.x, B.SPAWN_X[first]);
  assert.equal(h2.hold, swapType);
  assert.equal(h2.canHold, false);
});

test("hold: swapping into a blocked spawn ends the game", () => {
  const blockedTop = B.emptyBoard().map((row, y) => (y < 2 ? row.map((_, x) => (x >= 3 && x <= 6 ? "X" : null)) : row));
  const g = setup(blockedTop, piece("T", 0, 0, 10), { hold: "O" });
  const after = B.hold(g);
  assert.equal(after.over, true);
  assert.ok(after.events.some(e => e.kind === "over"));
});

/* ---------- gravity and lock delay ---------- */
test("tick: gravity moves one row per interval", () => {
  const g = setup(B.emptyBoard(), piece("T", 0, 3, 5));
  const a = B.tick(g, 999);
  assert.equal(a.active.y, 5);
  const b = B.tick(a, 1);
  assert.equal(b.active.y, 6);
  assert.equal(b.score, 0);
  assert.throws(() => B.tick(g, -1));
  assert.throws(() => B.tick(g, NaN));
});

test("lock delay: locks only after LOCK_MS on the ground", () => {
  const g = setup(B.emptyBoard(), piece("O", 0, 4, B.ROWS - 2));
  const a = B.tick(g, B.LOCK_MS - 10);
  assert.equal(a.pieces, 0);
  assert.equal(a.active.type, "O");
  const b = B.tick(a, 10);
  assert.equal(b.pieces, 1);
  assert.equal(b.board[B.ROWS - 1][4], "O");
  assert.ok(b.events.some(e => e.kind === "lock"));
});

test("lock delay: moves reset the timer up to the limit", () => {
  let g = setup(B.emptyBoard(), piece("O", 0, 4, B.ROWS - 2));
  for (let i = 0; i < B.MAX_RESETS; i++) {
    g = B.tick(g, B.LOCK_MS - 50);
    assert.equal(g.pieces, 0, `still falling after reset ${i}`);
    g = B.move(g, i % 2 ? 1 : -1);
    assert.equal(g.lockTimer, 0);
  }
  assert.equal(g.resets, B.MAX_RESETS);
  const after = B.tick(g, 1);
  assert.equal(after.pieces, 1, "locks at once when resets are used up");
});

test("lock delay: reaching a lower row gives the resets back", () => {
  const board = bottom(["XXXX..XXXX"]);
  const g = setup(board, piece("O", 0, 1, B.ROWS - 3), { resets: 10, lockTimer: 100, fallAcc: 995 });
  const slid = B.move(B.move(B.move(g, 1), 1), 1);
  assert.equal(slid.active.x, 4);
  assert.equal(slid.resets, 12, "the last move leaves the ground, so it does not count");
  const fell = B.tick(slid, 10);
  assert.equal(fell.pieces, 0);
  assert.equal(fell.active.y, B.ROWS - 2);
  assert.equal(fell.resets, 0);
});

/* ---------- game over ---------- */
test("game over: when a new piece cannot spawn", () => {
  const blockedTop = B.emptyBoard().map((row, y) => (y < 2 ? row.map((_, x) => (x >= 3 && x <= 6 ? "X" : null)) : row));
  const g = setup(blockedTop, piece("O", 0, 0, 10));
  const after = B.hardDrop(g, seeded(8));
  assert.equal(after.over, true);
  assert.equal(after.active, null);
  assert.ok(after.events.some(e => e.kind === "over" && e.reason === "block"));
  const still = B.move(B.tick(after, 5000), 1);
  assert.equal(still.over, true);
  assert.equal(still.pieces, after.pieces);
});

test("game over: a piece locked fully above the field", () => {
  const tall = B.emptyBoard().map((row, y) => (y >= 2 ? row.map((_, x) => (x === 0 ? "X" : null)) : row));
  const g = setup(tall, piece("I", 0, 0, -1));
  assert.equal(B.collides(tall, g.active), false);
  const after = B.hardDrop(g, seeded(8));
  assert.equal(after.over, true);
  assert.ok(after.events.some(e => e.kind === "over" && e.reason === "lock"));
});

test("game state: operations never change their input", () => {
  const g = B.newGame(1, seeded(11));
  const snap = JSON.stringify(g);
  [B.move(g, 1), B.rotate(g, -1), B.softStep(g), B.hardDrop(g, seeded(1)), B.hold(g, seeded(1)), B.tick(g, 2000)].forEach(() => {});
  assert.equal(JSON.stringify(g), snap);
  assert.throws(() => B.move(g, 2));
  assert.throws(() => B.rotate(g, 0));
});

test("game: a long random game stays legal", () => {
  const r = seeded(99);
  let g = B.newGame(1, r);
  for (let i = 0; i < 400 && !g.over; i++) {
    const roll = r();
    if (roll < 0.3) g = B.move(g, r() < 0.5 ? -1 : 1);
    else if (roll < 0.5) g = B.rotate(g, r() < 0.5 ? -1 : 1);
    else if (roll < 0.55) g = B.hold(g, r);
    else if (roll < 0.7) g = B.hardDrop(g, r);
    else g = B.tick(g, 200, roll < 0.8, r);
    if (g.active) assert.equal(B.collides(g.board, g.active), false);
    assert.equal(g.board.length, B.ROWS);
    g.board.forEach(row => assert.equal(row.length, B.WIDTH));
  }
  assert.ok(g.pieces > 10);
});

/* ---------- input and layout helpers ---------- */
test("auto-repeat: waits DAS_MS, then repeats every ARR_MS", () => {
  const held = { dir: 1, since: 1000, last: 1000 };
  assert.equal(B.repeatDue(held, 1000 + B.DAS_MS - 1), false);
  assert.equal(B.repeatDue(held, 1000 + B.DAS_MS), true);
  const after = { ...held, last: 1000 + B.DAS_MS };
  assert.equal(B.repeatDue(after, after.last + B.ARR_MS - 1), false);
  assert.equal(B.repeatDue(after, after.last + B.ARR_MS), true);
  assert.equal(B.repeatDue({ dir: 0, since: 0, last: 0 }, 99999), false);
  assert.equal(B.repeatDue(null, 1), false);
});

test("swipe: tap, quick swipe down/up, and drags that do nothing", () => {
  const cell = 20;
  assert.equal(B.swipe({ dx: 2, dy: 3, dt: 100, moved: false, cell }), "tap");
  assert.equal(B.swipe({ dx: 2, dy: 3, dt: B.TAP_MS + 1, moved: false, cell }), null);
  assert.equal(B.swipe({ dx: 5, dy: 90, dt: 200, moved: true, cell }), "hard");
  assert.equal(B.swipe({ dx: -5, dy: -90, dt: 200, moved: true, cell }), "hold");
  assert.equal(B.swipe({ dx: 5, dy: 90, dt: B.FLICK_MS + 10, moved: true, cell }), null, "slow drag is a soft drop only");
  assert.equal(B.swipe({ dx: 80, dy: 60, dt: 150, moved: true, cell }), null, "diagonal is not a flick");
  assert.equal(B.swipe({ dx: 0, dy: 30, dt: 150, moved: true, cell }), null, "too short");
  assert.throws(() => B.swipe({ dx: NaN, dy: 0, dt: 0, moved: false, cell }));
  assert.throws(() => B.swipe({ dx: 0, dy: 0, dt: 0, moved: false, cell: 0 }));
});

test("trail columns: one per column, from the start row to the landing row", () => {
  const landed = piece("T", 0, 3, 18);
  const cols = B.trailColumns(landed, 10);
  assert.deepEqual(cols, [
    { x: 3, top: 19 - 2 - 10, bottom: 19 - 2 },
    { x: 4, top: 18 - 2 - 10, bottom: 18 - 2 },
    { x: 5, top: 19 - 2 - 10, bottom: 19 - 2 }
  ]);
  assert.equal(B.trailColumns(piece("I", 1, 0, 3), 5)[0].top, 0, "clipped at the top of the field");
});

test("fit layout: cell fits the box and keys only take spare height", () => {
  const wide = B.fitLayout(250, 660, 48, 72);
  assert.equal(wide.cell, 25);
  assert.equal(wide.key, 72);
  const tight = B.fitLayout(230, 470, 48, 72);
  assert.equal(tight.cell, 23);
  assert.equal(tight.key, 53);
  [[184, 380], [300, 900], [230, 455], [400, 300]].forEach(([w, h]) => {
    const f = B.fitLayout(w, h, 48, 72);
    assert.ok(f.cell * B.WIDTH <= w || f.cell === 8);
    assert.ok(h - 2 * (f.key - 48) >= f.cell * B.HEIGHT || f.cell === 8, `${w}x${h} still fits after keys grow`);
    assert.ok(f.key >= 48 && f.key <= 72);
  });
});

/* ---------- ranks, settings and records ---------- */
test("rank titles by score", () => {
  assert.equal(B.rankFor(0), "はじめの一歩");
  assert.equal(B.rankFor(999), "はじめの一歩");
  assert.equal(B.rankFor(1000), "見習い職人");
  assert.equal(B.rankFor(5000), "ブロック職人");
  assert.equal(B.rankFor(15000), "積みの名人");
  assert.equal(B.rankFor(40000), "ライン消しの達人");
  assert.equal(B.rankFor(100000), "伝説の積み師");
});

test("settings and records are validated", () => {
  assert.deepEqual(B.normalizeSettings(null), { startLevel: 1 });
  assert.deepEqual(B.normalizeSettings({ startLevel: 5 }), { startLevel: 5 });
  assert.deepEqual(B.normalizeSettings({ startLevel: 7 }), { startLevel: 1 });
  const clean = B.normalizeRecords({ 1: { score: -5, lines: "9", level: 3 }, 5: "bad", 10: { score: 1200, lines: 12, level: 11 } });
  assert.deepEqual(clean, {
    1: { score: 0, lines: 0, level: 3 }, 5: { score: 0, lines: 0, level: 0 }, 10: { score: 1200, lines: 12, level: 11 }
  });
  assert.deepEqual(B.normalizeRecords([1, 2]), B.normalizeRecords(null));
});

test("records: only a higher score is a new best", () => {
  const start = B.normalizeRecords(null);
  const first = B.applyRecord(start, 1, { score: 3000, lines: 20, level: 3 });
  assert.equal(first.isNew, true);
  assert.deepEqual(first.records[1], { score: 3000, lines: 20, level: 3 });
  assert.deepEqual(start[1], { score: 0, lines: 0, level: 0 }, "input untouched");
  const lower = B.applyRecord(first.records, 1, { score: 2000, lines: 30, level: 4 });
  assert.equal(lower.isNew, false);
  assert.equal(lower.previous.score, 3000);
  const zero = B.applyRecord(start, 5, { score: 0, lines: 0, level: 5 });
  assert.equal(zero.isNew, false);
  assert.throws(() => B.applyRecord(start, 3, { score: 1 }));
  assert.throws(() => B.applyRecord(start, 1, null));
});

/* Regression: an empty record and a 0-point game used to say 「自己ベストと同点！」. */
test("best note: first game, new best, tie and gap", () => {
  assert.equal(B.bestNote({ score: 0, previous: 0, isNew: false }), "まだ記録なし。次は1列消してみよう");
  assert.equal(B.bestNote({ score: 168, previous: 0, isNew: true }), "はじめての記録！");
  assert.equal(B.bestNote({ score: 5200, previous: 3000, isNew: true }), "これまでの自己ベストは3,000点");
  assert.equal(B.bestNote({ score: 3000, previous: 3000, isNew: false }), "自己ベストと同点！");
  assert.equal(B.bestNote({ score: 1000, previous: 12500, isNew: false }), "自己ベスト12,500点まで、あと11,500点");
  assert.throws(() => B.bestNote({ score: -1, previous: 0, isNew: false }));
  assert.throws(() => B.bestNote(null));
});

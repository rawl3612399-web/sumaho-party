const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Q = require("../src/iq-rules.js");

/* Seeded random source so every failure can be replayed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deepFreeze(o) {
  Object.values(o).forEach(v => { if (v && typeof v === "object") deepFreeze(v); });
  return Object.freeze(o);
}
const SEEDS = 2000;
const TYPE_IDS = Q.TYPES.map(t => t.id);
/* Runs fn over SEEDS generated questions of one type, spread over all levels. */
function eachQuestion(type, fn) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const level = seed % Q.LEVELS;
    const q = Q.makeQuestion(type, level, mulberry32(seed * 7919 + type.length * 31));
    try { fn(q, level); } catch (e) { e.message = `${type} seed ${seed} level ${level}: ${e.message}`; throw e; }
  }
}
function checkShape(q, type, level) {
  assert.equal(q.type, type);
  assert.equal(q.level, level);
  assert.equal(q.choices.length, 4);
  assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4);
  assert.equal(new Set(q.choices.map(Q.visualKey)).size, 4, "all four choices look different");
}

/* ---------- independent checkers (written separately from the generator) ---------- */
const diff = (s) => s.slice(1).map((v, i) => v - s[i]);
const flat = (s) => s.length > 0 && s.every(v => v === s[0]);
const ratioFlat = (s) => s.length >= 3 && s.every((v, i) => i === 0 || (s[i - 1] !== 0 && v * s[0] === s[i - 1] * s[1]));
function recurrence(t) {
  for (let a = 1; a <= 5; a++) {
    const b = t[1] - a * t[0];
    if (t.length >= 3 && t.every((v, i) => i === 0 || v === a * t[i - 1] + b)) return true;
  }
  return false;
}
function stepKind(pairs) {
  const add = pairs.map(([a, b]) => b - a);
  const mul = pairs.map(([a, b]) => (a !== 0 && b % a === 0 ? b / a : NaN));
  return flat(add) || (mul.every(Number.isFinite) && flat(mul));
}
/* Any rule a player could reasonably read from a series. */
function anySeriesRule(s) {
  let x = s;
  for (let k = 1; k <= 3; k++) { x = diff(x); if (x.length >= 2 && flat(x)) return true; }
  if (ratioFlat(s) || recurrence(s) || recurrence([...s].reverse()) || recurrence(diff(s))) return true;
  if (s.every((v, i) => i < 2 || v === s[i - 1] + s[i - 2])) return true;
  const pairs = s.slice(1).map((v, i) => [s[i], v]);
  if (stepKind(pairs.filter((_, i) => i % 2 === 0)) && stepKind(pairs.filter((_, i) => i % 2 === 1))) return true;
  const sub = (p) => s.filter((_, i) => i % 2 === p);
  return [0, 1].every(p => flat(diff(sub(p))) || recurrence(sub(p)));
}
const KIND_HOLDS = {
  arith: (s) => flat(diff(s)) && diff(s)[0] > 0,
  down: (s) => flat(diff(s)) && diff(s)[0] < 0,
  double: (s) => s.every((v, i) => i === 0 || v === s[i - 1] * 2),
  triple: (s) => s.every((v, i) => i === 0 || v === s[i - 1] * 3),
  halve: (s) => s.every((v, i) => i === 0 || v * 2 === s[i - 1]),
  altAdd: (s) => flat(diff(s).filter((_, i) => i % 2 === 0)) && flat(diff(s).filter((_, i) => i % 2 === 1)) && diff(s)[0] !== diff(s)[1],
  altMul: (s) => s.every((v, i) => i === 0 || (i % 2 === 1 ? v === s[i - 1] * 2 : v - s[i - 1] === s[2] - s[1])),
  interleave: (s) => [0, 1].every(p => flat(diff(s.filter((_, i) => i % 2 === p)))),
  square: (s) => flat(diff(diff(s))) && diff(diff(s))[0] === 2,
  fib: (s) => s.every((v, i) => i < 2 || v === s[i - 1] + s[i - 2]),
  diffArith: (s) => flat(diff(diff(s))),
  cube: (s) => flat(diff(diff(diff(s)))) && diff(diff(diff(s)))[0] === 6,
  diffGeo: (s) => ratioFlat(diff(s))
};

function functionLibrary() {
  const list = [];
  for (let a = 0; a <= 12; a++) for (let b = -10; b <= 10; b++) list.push(x => a * x + b);
  for (let a = 1; a <= 3; a++) for (let b = -10; b <= 10; b++) list.push(x => a * x * x + b);
  for (let b = -5; b <= 5; b++) list.push(x => x * x + b * x, x => x * x * x + b, x => Math.pow(2, x) + b);
  return list;
}
const FN_LIB = functionLibrary();
function opLibrary() {
  const list = [(a, b) => a * a + b, (a, b) => a * a - b, (a, b) => a + b * b, (a, b) => b * b - a, (a, b) => a * b - a,
    (a, b) => a * b - b, (a, b) => a * b + a + b, (a, b) => 10 * a + b, (a, b) => a * a + b * b];
  for (let k = -5; k <= 5; k++) list.push((a, b) => a + b + k, (a, b) => a - b + k, (a, b) => b - a + k, (a, b) => a * b + k);
  for (let m = 2; m <= 4; m++) list.push((a, b) => (a + b) * m, (a, b) => a * m + b, (a, b) => a + b * m, (a, b) => (a - b) * m, (a, b) => a * b * m);
  return list;
}
const OP_LIB = opLibrary();
/* Values for "?" that some simple rule allows. */
function relationAnswers(p) {
  if (p.kind === "pairs") return new Set(FN_LIB.filter(f => p.pairs.every(([x, y]) => f(x) === y)).map(f => f(p.query)));
  const done = p.rows.slice(0, -1), [a, b, hole] = p.rows[p.rows.length - 1];
  assert.equal(hole, null);
  const out = new Set(OP_LIB.filter(op => done.every(([x, y, z]) => op(x, y) === z)).map(op => op(a, b)));
  const sums = new Set(done.map(r => r[0] + r[1] + r[2])), prods = new Set(done.map(r => r[0] * r[1] * r[2]));
  if (sums.size === 1) out.add([...sums][0] - a - b);
  if (prods.size === 1 && Number.isInteger([...prods][0] / (a * b))) out.add([...prods][0] / (a * b));
  return out;
}

const MATRIX_ATTRS = ["shape", "count", "fill", "rot"];
const cellValue = (c, attr) => (attr === "rot" && c.shape !== "arrow" ? 0 : c[attr]);
/* Reads each attribute's rule from the first two rows and predicts the missing corner. */
function predictCell(cells, attr) {
  const v = (row, col) => cellValue(cells[row * 3 + col], attr);
  const r0 = [0, 1, 2].map(c => v(0, c)), r1 = [0, 1, 2].map(c => v(1, c)), r2 = [v(2, 0), v(2, 1)];
  if (flat(r0) && flat(r1)) { assert.equal(r2[0], r2[1], `${attr}: row rule broken`); return r2[0]; }
  if (r0.every((x, i) => x === r1[i])) { assert.deepEqual(r2, r0.slice(0, 2), `${attr}: column rule broken`); return r0[2]; }
  const set = new Set(r0);
  assert.ok(set.size === 3 && new Set(r1).size === 3 && r1.every(x => set.has(x)), `${attr}: no readable rule`);
  const missing = [...set].filter(x => !r2.includes(x));
  assert.equal(missing.length, 1, `${attr}: latin rule broken`);
  return missing[0];
}

function normCells(cells, mark) {
  const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1]));
  const s = ([x, y]) => `${x - mx},${y - my}`;
  return `${cells.map(s).sort().join("|")}#${mark ? s(mark) : ""}`;
}
const TRANSFORMS = {
  rot1: ([x, y]) => [-y, x], rot2: ([x, y]) => [-x, -y], rot3: ([x, y]) => [y, -x],
  mirrorX: ([x, y]) => [-x, y], mirrorY: ([x, y]) => [x, -y], diag: ([x, y]) => [y, x], anti: ([x, y]) => [-y, -x]
};
const apply = (f, t) => normCells(f.cells.map(t), f.mark && t(f.mark));
const polyId = (f) => normCells(f.cells, f.mark);
const symmetric = (f) => ["mirrorX", "mirrorY", "diag", "anti"].some(t => apply(f, TRANSFORMS[t]) === polyId(f));
const rotationsOf = (f) => ["rot1", "rot2", "rot3"].map(t => apply(f, TRANSFORMS[t]));
const mirrorRotations = (f) => {
  const m = { cells: f.cells.map(TRANSFORMS.mirrorX), mark: f.mark && TRANSFORMS.mirrorX(f.mark) };
  return [polyId(m), ...rotationsOf(m)];
};
function polygonIsClear(pts) {
  return pts.every((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
    const angle = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)))));
    return Math.hypot(...v) >= 16 && angle * 180 / Math.PI >= 35;
  });
}
const ODD_FEATURE = {
  sides: (f) => f.pts.length,
  curl: (f) => f.dir,
  parity: (f) => f.spots.length % 2,
  symmetry: (f) => symmetric(f)
};
/* Other things a player could take for the rule. Each maps a figure to a value. */
const boxOf = (f) => {
  const w = Math.max(...f.cells.map(c => c[0])) - Math.min(...f.cells.map(c => c[0])) + 1;
  const h = Math.max(...f.cells.map(c => c[1])) - Math.min(...f.cells.map(c => c[1])) + 1;
  return `${Math.min(w, h)}x${Math.max(w, h)}`;
};
const SIDE_READINGS = {
  sides: [], curl: [],
  parity: [(f) => f.spots.length % 3 === 0, (f) => [2, 3, 5, 7].includes(f.spots.length), (f) => f.spots.length === 4 || f.spots.length === 9],
  symmetry: [boxOf, (f) => rotationsOf(f).includes(polyId(f))]
};
/* Choice i is the only one that differs on this reading, and the example (if any) agrees with the other three. */
function readsAsOdd(values, i, exampleValue) {
  const rest = values.filter((_, j) => j !== i);
  return rest.every(v => v === rest[0]) && values[i] !== rest[0] && (exampleValue === undefined || exampleValue === rest[0]);
}

/* Index of the single choice whose feature differs from the other three, or -1. */
function loneIndex(values) {
  const idx = values.map((v, i) => (values.filter(w => w === v).length === 1 ? i : -1)).filter(i => i >= 0);
  const others = values.filter((_, i) => i !== idx[0]);
  return idx.length === 1 && flat(others) ? idx[0] : -1;
}

/* ---------- 数列 ---------- */
test("iq seq: the answer follows the series rule; no wrong choice follows any simple rule", () => {
  eachQuestion("seq", (q, level) => {
    checkShape(q, "seq", level);
    const terms = q.prompt.terms;
    assert.equal(terms.length, 6);
    const hole = terms.indexOf(null);
    assert.ok(hole >= 3 && terms.filter(t => t === null).length === 1);
    if (level < 4) assert.equal(hole, 5, "the ? is in the middle only at the last level");
    const fill = (v) => terms.map(t => (t === null ? v : t));
    q.choices.forEach((c, i) => {
      assert.ok(Number.isInteger(c) && c > 0, `choice ${c}`);
      if (i === q.answer) {
        assert.ok(KIND_HOLDS[q.kind](fill(c)), `${q.kind} rule ${fill(c)}`);
        assert.ok(Q.seqFits(fill(c)));
      } else {
        assert.ok(!anySeriesRule(fill(c)), `wrong choice ${c} also fits: ${fill(c)}`);
      }
    });
    terms.filter(t => t !== null).forEach(t => assert.ok(Number.isInteger(t) && t > 0 && t < 2000));
  });
});

/* ---------- 数の関係 ---------- */
test("iq relation: every simple rule gives the answer, and none gives a wrong choice", () => {
  const kinds = new Set();
  eachQuestion("relation", (q, level) => {
    checkShape(q, "relation", level);
    kinds.add(q.prompt.kind);
    const allowed = relationAnswers(q.prompt);
    assert.deepEqual([...allowed], [q.choices[q.answer]], "exactly one value fits, and it is the answer");
    q.choices.forEach(c => assert.ok(Number.isInteger(c) && c > 0));
    if (q.prompt.kind === "pairs") {
      assert.equal(q.prompt.pairs.length, level >= 2 ? 3 : 2);
      assert.ok(!q.prompt.pairs.some(([x]) => x === q.prompt.query));
    } else {
      if (q.prompt.kind === "grid") {
        const colSum = (c, v) => q.prompt.rows.reduce((t, row) => t + (row[c] === null ? v : row[c]), 0);
        q.choices.forEach((v, i) => {
          if (i !== q.answer) assert.ok(!(colSum(0, v) === colSum(1, v) && colSum(1, v) === colSum(2, v)), `grid: wrong choice ${v} makes the columns add up too`);
        });
      }
      assert.ok(q.prompt.rows.every(row => row.length === 3));
      assert.equal(new Set(q.prompt.rows.map(r => `${r[0]},${r[1]}`)).size, q.prompt.rows.length, "no repeated rows");
    }
  });
  assert.deepEqual([...kinds].sort(), ["grid", "ops", "pairs"]);
});

/* ---------- 図形の規則 ---------- */
test("iq matrix: rows and columns agree on one missing cell, and exactly one choice is it", () => {
  eachQuestion("matrix", (q, level) => {
    checkShape(q, "matrix", level);
    const cells = q.prompt.cells;
    assert.equal(cells.length, 9);
    assert.equal(cells[8], null);
    const full = [...cells.slice(0, 8), q.choices[q.answer]];
    const want = Object.fromEntries(MATRIX_ATTRS.map(a => [a, predictCell(full, a)]));
    const matches = q.choices.filter(c => MATRIX_ATTRS.every(a => cellValue(c, a) === want[a]));
    assert.equal(matches.length, 1);
    assert.equal(matches[0], q.choices[q.answer]);
    const varying = MATRIX_ATTRS.filter(a => new Set(full.map(c => cellValue(c, a))).size > 1);
    assert.ok(varying.length >= 1, "at least one thing changes");
    full.forEach(c => {
      assert.ok(Q.SHAPES.includes(c.shape) || c.shape === "arrow");
      assert.ok(Q.FILLS.includes(c.fill));
      assert.ok(c.count >= 1 && c.count <= 4);
    });
  });
});

/* ---------- 仲間はずれ ---------- */
test("iq odd: exactly one choice breaks the rule the others share", () => {
  const rules = new Set();
  eachQuestion("odd", (q, level) => {
    checkShape(q, "odd", level);
    rules.add(q.rule);
    const feature = ODD_FEATURE[q.rule];
    const values = q.choices.map(feature);
    assert.equal(loneIndex(values), q.answer, `${q.rule}: ${values}`);
    const shared = values[(q.answer + 1) % 4];
    if (level >= 3) {
      assert.ok(q.prompt.example, "an example figure from the larger levels on");
      assert.equal(feature(q.prompt.example), shared);
      assert.ok(!q.choices.map(Q.visualKey).includes(Q.visualKey(q.prompt.example)));
    } else {
      assert.equal(q.prompt.example, null);
    }
    if (q.rule === "sides") q.choices.forEach(f => assert.ok(polygonIsClear(f.pts), "corners are easy to count"));
    SIDE_READINGS[q.rule].forEach((read, k) => {
      const ex = q.prompt.example ? read(q.prompt.example) : undefined;
      q.choices.forEach((_, i) => {
        if (i !== q.answer) assert.ok(!readsAsOdd(q.choices.map(read), i, ex), `${q.rule}: side reading ${k} points at choice ${i}`);
      });
    });
    if (q.rule === "parity") {
      const counts = q.choices.map(f => f.spots.length);
      counts.forEach((c, i) => {
        if (i === q.answer) return;
        const rest = counts.filter((_, j) => j !== i);
        const apart = Math.min(...rest.map(x => Math.abs(x - c))) >= 3 && Math.max(...rest) - Math.min(...rest) <= 3;
        assert.ok(!apart, `parity: ${c} dots stands apart from ${rest}`);
      });
    }
    if (q.rule === "symmetry") {
      const size = q.choices[0].cells.length;
      q.choices.forEach(f => assert.equal(f.cells.length, size, "same number of squares"));
    }
  });
  assert.deepEqual([...rules].sort(), ["curl", "parity", "sides", "symmetry"]);
});

/* ---------- 図形の回転 ---------- */
test("iq rotate: exactly one choice is a turned copy; the others are flipped copies", () => {
  eachQuestion("rotate", (q, level) => {
    checkShape(q, "rotate", level);
    const base = q.prompt.figure;
    const turned = rotationsOf(base);
    const flipped = mirrorRotations(base);
    assert.ok(!turned.includes(polyId(base)), "no turn symmetry");
    assert.ok(!flipped.includes(polyId(base)), "a flipped copy never matches");
    q.choices.forEach((c, i) => {
      if (i === q.answer) assert.ok(turned.includes(polyId(c)) && polyId(c) !== polyId(base));
      else {
        assert.ok(flipped.includes(polyId(c)));
        assert.ok(!turned.includes(polyId(c)) && polyId(c) !== polyId(base));
      }
    });
    assert.equal(!!base.mark, level >= 3, "a marked square from level 4");
  });
});

/* ---------- drawing ---------- */
test("iq svg: every figure renders with theme colors only and different choices look different", () => {
  const COLOR = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
  for (let seed = 1; seed <= 300; seed++) {
    const run = Q.newRun("timed", mulberry32(seed));
    run.questions.forEach((q, n) => {
      const marks = [];
      if (q.prompt.kind === "matrix") marks.push(Q.matrixSvg(q.prompt.cells, `iqM${n}`));
      if (q.prompt.kind === "rotate") marks.push(Q.figureSvg(q.prompt.figure, `iqP${n}`));
      if (q.prompt.kind === "odd" && q.prompt.example) marks.push(Q.figureSvg(q.prompt.example, `iqE${n}`));
      const choices = typeof q.choices[0] === "number" ? [] : q.choices.map((c, i) => Q.figureSvg(c, `iqC${i}`));
      [...marks, ...choices].forEach(svg => {
        assert.match(svg, /^<svg [^>]*viewBox="0 0 (100 100|300 300)"/);
        assert.doesNotMatch(svg, COLOR);
        assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
        if (/url\(#/.test(svg)) assert.match(svg, /<pattern id="iq/);
      });
      if (choices.length) assert.equal(new Set(choices.map(s => s.replace(/iqC\d/g, ""))).size, 4);
    });
  }
  assert.throws(() => Q.figureSvg({ t: "blob" }), /図形/);
  assert.throws(() => Q.figureSvg({ t: "dots", spots: [1] }, "bad id"), /id/);
  assert.throws(() => Q.matrixSvg([1, 2, 3]), /3×3/);
});

/* ---------- run, plan, scoring ---------- */
test("iq plan: 20 questions, each type 4 times, levels rise in blocks, never the same type twice in a row", () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const plan = Q.questionPlan(mulberry32(seed));
    assert.equal(plan.length, Q.TOTAL);
    TYPE_IDS.forEach(t => assert.equal(plan.filter(p => p.type === t).length, 4));
    plan.forEach((p, i) => {
      assert.equal(p.level, Math.floor(i / 4));
      if (i > 0) assert.notEqual(p.type, plan[i - 1].type);
    });
  }
});

test("iq run: answers are recorded without changing the old run; timeouts count as wrong", () => {
  const run = deepFreeze(Q.newRun("timed", mulberry32(42)));
  assert.equal(run.questions.length, Q.TOTAL);
  const q0 = Q.current(run);
  const after = Q.submit(run, q0.answer, 4200.4);
  assert.equal(run.answers.length, 0, "old run untouched");
  assert.deepEqual(after.answers[0], { type: q0.type, level: 0, choice: q0.answer, correct: true, ms: 4200 });
  const timeout = Q.submit(after, null, 99999);
  assert.equal(timeout.answers[1].correct, false);
  assert.equal(timeout.answers[1].ms, Q.TIME_LIMIT_SEC * 1000, "time is capped at the limit");
  assert.throws(() => Q.submit(run, 4, 100), /答え/);
  assert.throws(() => Q.submit(run, 1.5, 100), /答え/);
  assert.throws(() => Q.submit(run, 0, -1), /時間/);
  assert.throws(() => Q.submit(run, 0, NaN), /時間/);
  assert.throws(() => Q.newRun("fast"), /時間/);
  assert.throws(() => Q.result(run), /終わって/);
  assert.throws(() => Q.makeQuestion("seq", 5), /レベル/);
  assert.throws(() => Q.makeQuestion("chess", 0), /種類/);
});

function playAll(run, pickRight, ms) {
  return run.questions.reduce((acc, q, i) => Q.submit(acc, pickRight(i) ? q.answer : (q.answer + 1) % 4, ms), run);
}
test("iq result: counts, per-type accuracy, average time and the estimate", () => {
  const run = Q.newRun("free", mulberry32(7));
  const all = playAll(run, () => true, 5000);
  assert.ok(Q.finished(all));
  assert.equal(Q.current(all), null);
  assert.throws(() => Q.submit(all, 0, 10), /終わって/);
  const best = Q.result(all);
  assert.equal(best.correct, 20);
  assert.equal(best.iq, Q.IQ_MAX);
  assert.equal(best.avgSec, 5);
  best.byType.forEach(t => assert.deepEqual([t.correct, t.total], [4, 4]));
  const none = Q.result(playAll(run, () => false, 30000));
  assert.equal(none.correct, 0);
  assert.equal(none.iq, Q.IQ_MIN);
  const half = Q.result(playAll(run, i => i % 2 === 0, 15000));
  assert.equal(half.correct, 10);
  assert.ok(half.iq >= 92 && half.iq <= 104, `half right is near 100, got ${half.iq}`);
  assert.equal(half.title, Q.titleFor(half.iq));
});

test("iq estimate: stays in 70-145, rises with accuracy and speed", () => {
  let last = 0;
  for (let i = 0; i <= 20; i++) {
    const iq = Q.estimateIq(i / 20, 12);
    assert.ok(iq >= Q.IQ_MIN && iq <= Q.IQ_MAX);
    assert.ok(iq >= last);
    last = iq;
  }
  assert.ok(Q.estimateIq(0.8, 5) > Q.estimateIq(0.8, 25));
  assert.equal(Q.estimateIq(0.5, 30), 100);
  assert.throws(() => Q.estimateIq(1.2, 5));
  assert.throws(() => Q.estimateIq(0.5, -1));
});

test("iq titles: thresholds", () => {
  assert.equal(Q.titleFor(145), "ひらめき天才級");
  assert.equal(Q.titleFor(140), "ひらめき天才級");
  assert.equal(Q.titleFor(139), "名探偵級");
  assert.equal(Q.titleFor(120), "博士級");
  assert.equal(Q.titleFor(110), "秀才級");
  assert.equal(Q.titleFor(100), "切れ者級");
  assert.equal(Q.titleFor(99), "ひらめき見習い");
  assert.equal(Q.titleFor(70), "のびしろ無限大");
});

test("iq records and settings: junk from storage is dropped; only better scores replace the best", () => {
  assert.deepEqual(Q.normalizeRecords(null), { timed: null, free: null });
  assert.deepEqual(Q.normalizeRecords("x"), { timed: null, free: null });
  assert.deepEqual(Q.normalizeRecords({ timed: { iq: 200, correct: 5 }, free: { iq: 101, correct: 12, extra: 1 } }),
    { timed: null, free: { iq: 101, correct: 12 } });
  assert.deepEqual(Q.normalizeRecords({ timed: { iq: 100.5, correct: 3 }, free: { iq: 100, correct: 21 } }), { timed: null, free: null });
  const start = deepFreeze(Q.normalizeRecords(null));
  const first = Q.updateRecords(start, "timed", { iq: 110, correct: 14 });
  assert.equal(first.isNew, true);
  assert.deepEqual(first.records.timed, { iq: 110, correct: 14 });
  assert.equal(start.timed, null);
  const worse = Q.updateRecords(first.records, "timed", { iq: 105, correct: 15 });
  assert.equal(worse.isNew, false);
  assert.equal(worse.records, first.records);
  assert.equal(Q.updateRecords(first.records, "timed", { iq: 110, correct: 15 }).isNew, true);
  assert.throws(() => Q.updateRecords(start, "slow", { iq: 100, correct: 1 }));
  assert.deepEqual(Q.normalizeSettings({ timing: "free" }), { timing: "free" });
  assert.deepEqual(Q.normalizeSettings({ timing: 3 }), { timing: "timed" });
  assert.deepEqual(Q.normalizeSettings(null), { timing: "timed" });
});

test("iq files: no literal colors in code or CSS, no emoji, every id prefixed", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const js = read("src/iq.js") + read("src/iq-rules.js");
  const css = read("src/styles-iq.css");
  const html = read("src/partials/iq.html");
  [js, css, html].forEach(src => assert.doesNotMatch(src, /\p{Extended_Pictographic}/u));
  assert.doesNotMatch(js, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  ids.forEach(id => assert.ok(/^iq/.test(id) || id === "modeIqChallenge", id));
  const used = [...read("src/iq.js").matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]);
  used.forEach(id => assert.ok(ids.includes(id), `missing #${id} in the partial`));
  assert.ok(Q.TYPES.every(t => !/\p{Extended_Pictographic}/u.test(t.name)));
});

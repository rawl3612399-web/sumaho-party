/* IQ challenge rules: builds 20 multiple-choice puzzles (number series, figure matrix, odd one out, rotation,
 * number relations) from random numbers, keeps only puzzles where exactly one choice fits, scores the run
 * and keeps records. Figures are plain descriptions; figureSvg / matrixSvg turn them into SVG markup that
 * is drawn with currentColor (theme colors come from CSS). */
const IqRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const TOTAL = 20;
  const LEVELS = 5;
  const CHOICES = 4;
  const TIME_LIMIT_SEC = 30;
  const MAX_MS = 600000;
  const TIMINGS = Object.freeze(["timed", "free"]);
  const TYPES = Object.freeze([
    Object.freeze({ id: "seq", name: "数列" }),
    Object.freeze({ id: "matrix", name: "図形の規則" }),
    Object.freeze({ id: "odd", name: "仲間はずれ" }),
    Object.freeze({ id: "rotate", name: "図形の回転" }),
    Object.freeze({ id: "relation", name: "数の関係" })
  ]);
  const TYPE_IDS = Object.freeze(TYPES.map(t => t.id));
  const IQ_MIN = 70;
  const IQ_MAX = 145;
  const LEVEL_WEIGHT = Object.freeze([1, 1.25, 1.5, 1.75, 2]);
  const TITLES = Object.freeze([
    { min: 140, title: "ひらめき天才級" }, { min: 130, title: "名探偵級" }, { min: 120, title: "博士級" },
    { min: 110, title: "秀才級" }, { min: 100, title: "切れ者級" }, { min: 90, title: "ひらめき見習い" },
    { min: 0, title: "のびしろ無限大" }
  ].map(Object.freeze));

  /* ---------- small helpers ---------- */
  const randInt = (min, max, r) => min + Math.floor(r() * (max - min + 1));
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const uniq = (list) => [...new Set(list)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const f1 = (n) => Math.round(n * 10) / 10;

  function retry(make, ok = Boolean, tries = 600) {
    for (let i = 0; i < tries; i++) {
      const v = make();
      if (v && ok(v)) return v;
    }
    throw new Error("問題を作れませんでした");
  }
  function arrange(answer, wrong, r) {
    const choices = R.shuffle([answer, ...wrong], r);
    return { choices, answer: choices.indexOf(answer) };
  }
  /* Three wrong numbers: up to two tempting mistakes, the rest close to the answer. */
  function numberDistractors(ans, extras, isBad, r) {
    const ok = (v) => Number.isInteger(v) && v > 0 && v !== ans && !isBad(v);
    const spread = Math.max(3, Math.round(ans * 0.2));
    const take = (list, n, have) => list.reduce((acc, v) => (acc.length >= n || acc.includes(v) || !ok(v) ? acc : [...acc, v]), have);
    const tempting = take(R.shuffle(uniq(extras), r), 2, []);
    const wrong = take(R.shuffle(range(spread * 2 + 1).map(i => ans - spread + i), r), CHOICES - 1, tempting);
    return wrong.length === CHOICES - 1 ? wrong : null;
  }

  /* ---------- 数列 ---------- */
  const diffs = (s) => s.slice(1).map((v, i) => v - s[i]);
  const allSame = (s) => s.length > 0 && s.every(v => v === s[0]);
  /* s[i+1] = a * s[i] + b for a small whole a (covers +d, ×q and ×q+b). */
  const affine = (s) => s.length >= 3 && range(5).some(i => {
    const a = i + 1, b = s[1] - a * s[0];
    return s.every((v, j) => j === 0 || v === a * s[j - 1] + b);
  });
  function polynomial(s) {
    let d = s;
    for (let k = 0; k < 3; k++) {
      d = diffs(d);
      if (d.length >= 2 && allSame(d)) return true;
    }
    return false;
  }
  const sameStep = (pairs) => pairs.length > 0 && (allSame(pairs.map(([a, b]) => b - a)) ||
    (pairs.every(([a, b]) => a !== 0 && b % a === 0) && allSame(pairs.map(([a, b]) => b / a))));
  function alternating(s) {
    const steps = s.slice(1).map((v, i) => [s[i], v]);
    return sameStep(steps.filter((_, i) => i % 2 === 0)) && sameStep(steps.filter((_, i) => i % 2 === 1));
  }
  const interleaved = (s) => [0, 1].every(p => {
    const sub = s.filter((_, i) => i % 2 === p);
    return sub.length >= 3 && (allSame(diffs(sub)) || affine(sub));
  });
  const fibLike = (s) => s.every((v, i) => i < 2 || v === s[i - 1] + s[i - 2]);
  /* True when a complete series follows any rule a player could reasonably see. */
  const seqFits = (s) => polynomial(s) || affine(s) || affine([...s].reverse()) || alternating(s) ||
    interleaved(s) || fibLike(s) || affine(diffs(s));

  const steps = (a, n, step) => range(n - 1).reduce((acc, i) => [...acc, step(acc[i], i)], [a]);
  const SEQ_MAKERS = {
    arith: (r) => { const a = randInt(1, 20, r), d = randInt(2, 9, r); return range(6).map(i => a + i * d); },
    down: (r) => { const d = randInt(3, 9, r), a = randInt(5 * d + 1, 5 * d + 30, r); return range(6).map(i => a - i * d); },
    double: (r) => { const a = randInt(1, 5, r); return range(6).map(i => a * 2 ** i); },
    triple: (r) => { const a = randInt(1, 3, r); return range(6).map(i => a * 3 ** i); },
    halve: (r) => { const a = randInt(1, 6, r); return range(6).map(i => a * 2 ** (5 - i)); },
    altAdd: (r) => {
      const p = randInt(1, 9, r), q = (p - 1 + randInt(1, 8, r)) % 9 + 1;
      return steps(randInt(1, 15, r), 6, (v, i) => v + (i % 2 ? q : p));
    },
    altMul: (r) => { const k = randInt(1, 6, r); return steps(randInt(1, 4, r), 6, (v, i) => (i % 2 ? v + k : v * 2)); },
    interleave: (r) => {
      const a = randInt(1, 9, r), d1 = randInt(1, 5, r), d2 = randInt(2, 6, r), b = randInt(2 * d2 + 12, 40, r);
      return range(6).map(i => (i % 2 ? b - ((i - 1) / 2) * d2 : a + (i / 2) * d1));
    },
    square: (r) => { const c = randInt(1, 4, r), k = R.pick([0, 0, 1, -1, 2], r); return range(6).map(i => (i + c) ** 2 + k); },
    fib: (r) => { const a = randInt(1, 6, r), b = randInt(1, 9, r); return range(4).reduce(acc => [...acc, acc[acc.length - 1] + acc[acc.length - 2]], [a, b]); },
    diffArith: (r) => { const d0 = randInt(1, 5, r), dd = randInt(1, 4, r); return steps(randInt(1, 30, r), 6, (v, i) => v + d0 + i * dd); },
    cube: (r) => { const c = randInt(1, 2, r), k = R.pick([0, 0, 1, -1, 2], r); return range(6).map(i => (i + c) ** 3 + k); },
    diffGeo: (r) => { const d0 = randInt(1, 3, r), q = R.pick([2, 2, 3], r); return steps(randInt(1, 20, r), 6, (v, i) => v + d0 * q ** i); }
  };
  const SEQ_LEVELS = Object.freeze([
    ["arith", "double", "down"],
    ["arith", "triple", "halve", "altAdd"],
    ["square", "fib", "altAdd", "interleave", "down"],
    ["diffArith", "cube", "altMul", "fib", "square"],
    ["diffGeo", "cube", "altMul", "diffArith", "interleave"]
  ]);

  function seqQuestion(level, r) {
    return retry(() => {
      const kind = R.pick(SEQ_LEVELS[level], r);
      const full = SEQ_MAKERS[kind](r);
      const hide = level >= 4 ? R.pick([3, 4, 5], r) : 5;
      const ans = full[hide], prev = full[hide - 1], prev2 = full[hide - 2];
      const fill = (v) => full.map((x, i) => (i === hide ? v : x));
      if (!full.every(v => Number.isInteger(v) && v > 0) || !seqFits(full)) return null;
      const extras = [prev + (prev - prev2), ans + (ans - prev), ans + (prev - prev2), prev * 2, ans + 1, ans - 1, ans + 2];
      const wrong = numberDistractors(ans, extras, v => seqFits(fill(v)), r);
      return wrong && { type: "seq", level, kind, prompt: { kind: "seq", terms: fill(null) }, ...arrange(ans, wrong, r) };
    });
  }

  /* ---------- 数の関係 ---------- */
  /* Simple rules a player might think of; a question is kept only when they all agree on the answer. */
  const FUNCS = (() => {
    const list = [];
    for (let a = 0; a <= 12; a++) for (let b = -10; b <= 10; b++) list.push(x => a * x + b);
    for (let a = 1; a <= 3; a++) for (let b = -10; b <= 10; b++) list.push(x => a * x * x + b);
    for (let b = -5; b <= 5; b++) list.push(x => x * x + b * x, x => x ** 3 + b, x => 2 ** x + b);
    return Object.freeze(list);
  })();
  const OPS = (() => {
    const list = [];
    for (let k = -5; k <= 5; k++) list.push((a, b) => a + b + k, (a, b) => a - b + k, (a, b) => b - a + k, (a, b) => a * b + k);
    for (let m = 2; m <= 4; m++) {
      list.push((a, b) => (a + b) * m, (a, b) => a * m + b, (a, b) => a + b * m, (a, b) => (a - b) * m, (a, b) => a * b * m);
    }
    list.push((a, b) => a * a + b, (a, b) => a * a - b, (a, b) => a + b * b, (a, b) => b * b - a, (a, b) => a * b - a,
      (a, b) => a * b - b, (a, b) => a * b + a + b, (a, b) => 10 * a + b, (a, b) => a * a + b * b);
    return Object.freeze(list);
  })();
  const fnPredictions = (pairs, q) => uniq(FUNCS.filter(f => pairs.every(([x, y]) => f(x) === y)).map(f => f(q)));
  function rowPredictions(rows) {
    const done = rows.slice(0, -1), [a, b] = rows[rows.length - 1];
    const byOps = OPS.filter(op => done.every(([x, y, z]) => op(x, y) === z)).map(op => op(a, b));
    const sums = uniq(done.map(([x, y, z]) => x + y + z)), prods = uniq(done.map(([x, y, z]) => x * y * z));
    const inv = [...(sums.length === 1 ? [sums[0] - a - b] : []), ...(prods.length === 1 && a * b !== 0 ? [prods[0] / (a * b)] : [])];
    return uniq([...byOps, ...inv]).filter(Number.isInteger);
  }
  /* Every value that some simple rule gives for the "?" of a relation prompt. */
  const relationPredictions = (p) => (p.kind === "pairs" ? fnPredictions(p.pairs, p.query) : rowPredictions(p.rows));

  const FN_LEVELS = Object.freeze([
    [(r) => { const k = randInt(2, 9, r); return x => x + k; }, (r) => { const k = randInt(2, 5, r); return x => k * x; }],
    [(r) => { const k = R.pick([-3, -1, 1, 3, 5], r); return x => 2 * x + k; }, (r) => { const k = randInt(1, 4, r); return x => 3 * x - k; }, () => x => x * x],
    [(r) => { const k = R.pick([-4, -1, 1, 2, 5], r); return x => x * x + k; }, () => x => x * (x + 1), (r) => { const k = randInt(1, 6, r); return x => 4 * x - k; }],
    [() => x => x ** 3, (r) => { const k = randInt(-3, 3, r); return x => 2 * x * x + k; }, () => x => x * x - x, () => x => 2 ** x],
    [(r) => { const k = R.pick([-2, -1, 1, 2], r); return x => x ** 3 + k; }, () => x => x * (x + 2),
      (r) => { const k = R.pick([-3, 1, 3], r); return x => 2 ** x + k; }, (r) => { const k = randInt(1, 5, r); return x => 3 * x * x - k; }]
  ]);
  const ROW_LEVELS = Object.freeze([
    [{ op: (a, b) => a + b }, { sum: true }],
    [{ op: (a, b) => a * b }, { op: (a, b) => a - b }, { sum: true }],
    [{ op: (a, b) => a * b + 1 }, { op: (a, b) => (a + b) * 2 }, { op: (a, b) => a * 2 + b }, { sum: true }],
    [{ op: (a, b) => a * a + b }, { op: (a, b) => a * b - a }, { op: (a, b) => (a - b) * 3 }, { sum: true }],
    [{ op: (a, b) => a * a - b }, { op: (a, b) => a * b + a + b }, { op: (a, b) => a + b * 3 }, { op: (a, b) => a * a + b * b }]
  ]);

  function pairsQuestion(level, r) {
    const f = R.pick(FN_LEVELS[level], r)(r);
    const [q, ...xs] = R.shuffle(range(level >= 3 ? 6 : 9).map(i => i + 1), r).slice(0, level >= 2 ? 4 : 3);
    const pairs = [...xs].sort((a, b) => a - b).map(x => [x, f(x)]);
    const ans = f(q);
    if (ans <= 0 || pairs.some(([, y]) => y <= 0)) return null;
    const preds = fnPredictions(pairs, q);
    if (preds.length !== 1 || preds[0] !== ans) return null;
    const [[x1, y1], [x2, y2]] = pairs.slice(-2);
    const extras = [y2 + ((y2 - y1) / (x2 - x1)) * (q - x2), ans + q, ans - q, q * q, q * 2, ans + 1, ans - 1];
    const wrong = numberDistractors(ans, extras, v => preds.includes(v), r);
    return wrong && { type: "relation", level, prompt: { kind: "pairs", pairs, query: q }, ...arrange(ans, wrong, r) };
  }
  function makeRows(rule, level, r) {
    const hi = level >= 3 ? 12 : 9;
    if (rule.sum) {
      const s = randInt(hi + 3, hi * 2, r);
      return range(3).map(() => retry(() => {
        const a = randInt(1, hi, r), b = randInt(1, hi, r), c = s - a - b;
        return c >= 1 && c <= hi ? [a, b, c] : null;
      }));
    }
    return range(level >= 2 ? 4 : 3).map(() => { const a = randInt(2, hi, r), b = randInt(2, hi, r); return [a, b, rule.op(a, b)]; });
  }
  /* A grid can also be read down the columns: when the first two columns have the same sum, the "?" that would
   * give the last column that sum too must not be offered as a wrong choice. */
  function columnSumGuess(rows) {
    const col = (c) => rows.reduce((s, row) => s + (row[c] ?? 0), 0);
    return col(0) === col(1) ? col(0) - col(2) : null;
  }
  function rowsQuestion(level, r) {
    const rule = R.pick(ROW_LEVELS[level], r);
    const full = makeRows(rule, level, r);
    if (full.some(row => row[2] <= 0) || uniq(full.map(row => row.join())).length !== full.length) return null;
    const rows = full.map((row, i) => (i === full.length - 1 ? [row[0], row[1], null] : row));
    const [a, b, ans] = full[full.length - 1];
    const preds = rowPredictions(rows);
    if (preds.length !== 1 || preds[0] !== ans) return null;
    const extras = [a + b, a * b, a * b + 1, (a + b) * 2, ans + a, ans - b, ans + 1, ans - 1];
    const byColumn = rule.sum ? columnSumGuess(rows) : null;
    const wrong = numberDistractors(ans, extras, v => preds.includes(v) || v === byColumn, r);
    return wrong && { type: "relation", level, prompt: { kind: rule.sum ? "grid" : "ops", rows }, ...arrange(ans, wrong, r) };
  }
  const relationQuestion = (level, r) => retry(() => (r() < 0.5 ? pairsQuestion(level, r) : rowsQuestion(level, r)));

  /* ---------- 図形の規則 (3×3) ---------- */
  const SHAPES = Object.freeze(["circle", "square", "triangle", "diamond", "star", "hexagon", "plus"]);
  const FILLS = Object.freeze(["empty", "stripe", "solid"]);
  const ATTRS = Object.freeze(["shape", "count", "fill", "rot"]);
  const MAT_VARY = Object.freeze([1, 1, 2, 2, 3]);

  function attrValues(attr, level, r) {
    if (attr === "count") { const s = randInt(1, 2, r), v = [s, s + 1, s + 2]; return r() < 0.3 ? v.reverse() : v; }
    if (attr === "fill") return R.shuffle(FILLS, r);
    if (attr === "shape") return R.shuffle(SHAPES, r).slice(0, 3);
    const step = level >= 4 && r() < 0.5 ? 45 : 90, s = R.pick([0, 90, 180, 270], r);
    return [0, 1, 2].map(i => (s + i * step) % 360);
  }
  function matrixPlan(level, r) {
    const pool = level >= 2 ? ["count", "fill", "shape", "rot"] : ["count", "fill", "shape"];
    const vary = retry(() => R.shuffle(pool, r).slice(0, MAT_VARY[level]), v => !(v.includes("rot") && v.includes("shape")));
    const rowAttr = level >= 1 && r() < 0.5 ? R.pick(["count", "fill", "shape"].filter(a => !vary.includes(a) && !(a === "shape" && vary.includes("rot"))), r) : null;
    return Object.fromEntries(ATTRS.map(attr => {
      if (vary.includes(attr)) return [attr, { mode: level === 0 ? "prog" : R.pick(["prog", "latin"], r), shift: randInt(1, 2, r), vals: attrValues(attr, level, r) }];
      if (attr === rowAttr) return [attr, { mode: "row", vals: attrValues(attr, level, r) }];
      if (attr === "shape") return [attr, { mode: "const", vals: [vary.includes("rot") ? "arrow" : R.pick(SHAPES, r)] }];
      if (attr === "rot") return [attr, { mode: "const", vals: [0] }];
      return [attr, { mode: "const", vals: [attr === "count" ? randInt(1, 3, r) : R.pick(FILLS, r)] }];
    }));
  }
  const MODE_INDEX = { prog: (p, row, col) => col, latin: (p, row, col) => (col + row * p.shift) % 3, row: (p, row) => row, const: () => 0 };
  const cellAt = (plan, row, col) => ({ t: "cell", ...Object.fromEntries(ATTRS.map(a => [a, plan[a].vals[MODE_INDEX[plan[a].mode](plan[a], row, col)]])) });

  function cellVariants(ans, plan, r) {
    const alt = (attr, values) => uniq(values).filter(v => v !== ans[attr]).map(v => ({ attr, fig: { ...ans, [attr]: v } }));
    const shapes = plan.shape.vals.length === 3 ? plan.shape.vals : R.shuffle(SHAPES, r).slice(0, 3);
    return [
      ...alt("count", [...plan.count.vals, ans.count - 1, ans.count + 1].filter(n => n >= 1 && n <= 4)),
      ...alt("fill", FILLS),
      ...(ans.shape === "arrow" ? alt("rot", [...plan.rot.vals, ...[90, 180, 270].map(d => (ans.rot + d) % 360)]) : alt("shape", shapes))
    ];
  }
  /* Wrong cells change one thing about the answer, preferring the things that follow a rule. */
  function pickWrongCells(ans, plan, r) {
    const all = cellVariants(ans, plan, r);
    const varied = (v) => plan[v.attr].mode !== "const";
    const ordered = [...R.shuffle(all.filter(varied), r), ...R.shuffle(all.filter(v => !varied(v)), r)];
    return ordered.reduce((acc, v) => {
      const full = acc.length >= 3, tooMany = acc.filter(x => x.attr === v.attr).length >= 2;
      return full || tooMany || acc.some(x => visualKey(x.fig) === visualKey(v.fig)) ? acc : [...acc, v];
    }, []).map(v => v.fig);
  }
  function matrixQuestion(level, r) {
    return retry(() => {
      const plan = matrixPlan(level, r);
      const cells = range(9).map(i => cellAt(plan, Math.floor(i / 3), i % 3));
      const wrong = pickWrongCells(cells[8], plan, r);
      return wrong.length === 3 && { type: "matrix", level, prompt: { kind: "matrix", cells: [...cells.slice(0, 8), null] }, ...arrange(cells[8], wrong, r) };
    });
  }

  /* ---------- polyomino figures (cells on a grid, optional marked cell) ---------- */
  const byRowCol = (a, b) => a[1] - b[1] || a[0] - b[0];
  function normPoly(cells, mark = null) {
    const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1]));
    const shift = ([x, y]) => [x - mx + 0, y - my + 0];
    return { t: "poly", cells: cells.map(shift).sort(byRowCol), mark: mark ? shift(mark) : null };
  }
  const mapPoly = (f, fn) => normPoly(f.cells.map(fn), f.mark && fn(f.mark));
  const turn = (f, k) => range(((k % 4) + 4) % 4).reduce(g => mapPoly(g, ([x, y]) => [-y, x]), normPoly(f.cells, f.mark));
  const flip = (f) => mapPoly(f, ([x, y]) => [-x, y]);
  const polyKey = (f) => JSON.stringify([f.cells, f.mark]);
  const samePoly = (a, b) => polyKey(normPoly(a.cells, a.mark)) === polyKey(normPoly(b.cells, b.mark));
  const rotations = (f) => range(4).map(k => turn(f, k));
  const hasMirror = (f) => rotations(flip(f)).some(g => samePoly(g, f));
  const hasTurnSymmetry = (f) => [1, 2, 3].some(k => samePoly(turn(f, k), f));
  const freeKey = (f) => [...rotations(f), ...rotations(flip(f))].map(polyKey).sort()[0];
  const span = (cells, i) => Math.max(...cells.map(c => c[i])) - Math.min(...cells.map(c => c[i])) + 1;

  /* Random connected shape of k cells that fits a w×h box. With mirrorX, every cell comes with its mirror image. */
  function grow(k, w, h, r, mirrorX = null) {
    let cells = mirrorX ? uniq([[0, 0], mirrorX([0, 0])].map(c => c.join())).map(c => c.split(",").map(Number)) : [[0, 0]];
    while (cells.length < k) {
      const taken = new Set(cells.map(c => c.join()));
      const left = k - cells.length;
      const options = cells.flatMap(([x, y]) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]])
        .filter(c => !taken.has(c.join()))
        .map(c => (!mirrorX || mirrorX(c).join() === c.join() ? [c] : [c, mirrorX(c)]))
        .filter(add => add.length <= left && span([...cells, ...add], 0) <= w && span([...cells, ...add], 1) <= h);
      if (!options.length) return null;
      cells = [...cells, ...R.pick(options, r)];
    }
    return normPoly(cells);
  }
  const growPoly = (k, w, h, r) => grow(k, w, h, r);
  /* Same when flipped left to right; the axis runs through a column or between two columns. */
  function growSymmetric(k, w, h, r) {
    const between = k % 2 === 0 && r() < 0.5;
    return grow(k, w, h, r, ([x, y]) => [between ? -1 - x : -x, y]);
  }
  function collectDistinct(n, make) {
    let out = [];
    let keys = [];
    for (let tries = 0; out.length < n; tries++) {
      if (tries > 5000) throw new Error("問題を作れませんでした");
      const f = make();
      const key = f && freeKey(f);
      if (key && !keys.includes(key)) {
        out = [...out, f];
        keys = [...keys, key];
      }
    }
    return out;
  }

  /* ---------- 図形の回転 ---------- */
  function rotateQuestion(level, r) {
    const size = [5, 5, 6, 6, 7][level];
    const base = retry(() => {
      const f = growPoly(size, 4, 4, r);
      return f && level >= 3 ? { ...f, mark: R.pick(f.cells, r) } : f;
    }, f => !hasMirror(f) && !hasTurnSymmetry(f));
    const answer = turn(base, randInt(1, 3, r));
    const wrong = R.shuffle(range(4), r).slice(0, 3).map(k => turn(flip(base), k));
    return { type: "rotate", level, prompt: { kind: "rotate", figure: base }, ...arrange(answer, wrong, r) };
  }

  /* ---------- 仲間はずれ ---------- */
  /* Every corner must bend at least this much, so a corner never looks like a straight side. */
  const MIN_TURN_DEG = 35;
  const MIN_SIDE = 16;
  function clearPolygon(f) {
    const n = f.pts.length;
    return f.pts.every((p, i) => {
      const a = f.pts[(i + n - 1) % n], b = f.pts[(i + 1) % n];
      const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
      const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
      return Math.hypot(...v) >= MIN_SIDE && (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI >= MIN_TURN_DEG;
    });
  }
  function polygonFig(n, irregular, r) {
    return retry(() => {
      const rot = r() * 360, scale = 0.86 + r() * 0.14, step = 360 / n;
      const pts = range(n).map(i => {
        const a = ((rot + i * step + (irregular ? (r() - 0.5) * step * 0.5 : 0)) * Math.PI) / 180;
        const rad = 40 * scale * (irregular ? 0.68 + r() * 0.32 : 1);
        return [f1(50 + rad * Math.cos(a)), f1(50 + rad * Math.sin(a))];
      });
      return { t: "polygon", pts };
    }, clearPolygon);
  }
  const dotsFig = (n, r) => ({ t: "dots", spots: R.shuffle(range(9), r).slice(0, n).sort((a, b) => a - b) });
  const ODD_MAKERS = {
    sides: (level, need, r) => {
      const n = randInt(3, 6, r);
      const m = R.pick((level >= 2 ? [-1, 1] : [-2, 2]).map(g => n + g).filter(v => v >= 3 && v <= 7), r);
      return { same: range(need).map(() => polygonFig(n, level >= 3, r)), odd: polygonFig(m, level >= 3, r) };
    },
    curl: (level, need, r) => {
      const dir = R.pick([1, -1], r), starts = R.shuffle(range(8).map(i => i * 45), r);
      return { same: range(need).map(i => ({ t: "curl", dir, start: starts[i] })), odd: { t: "curl", dir: -dir, start: starts[need] } };
    },
    parity: (level, need, r) => {
      const p = randInt(0, 1, r), pool = range(8).map(i => i + 2);
      const same = R.shuffle(pool.filter(n => n % 2 === p), r).slice(0, need);
      return { same: same.map(n => dotsFig(n, r)), odd: dotsFig(R.pick(pool.filter(n => n % 2 !== p), r), r) };
    },
    symmetry: (level, need, r) => {
      const size = level >= 3 ? 8 : 7;
      const same = collectDistinct(need, () => growSymmetric(size, 5, 4, r)).map(f => (level >= 3 ? turn(f, randInt(0, 3, r)) : f));
      return { same, odd: retry(() => growPoly(size, 5, 4, r), f => !hasMirror(f)) };
    }
  };
  const ODD_RULES = Object.freeze([["sides", 0], ["curl", 1], ["symmetry", 1], ["parity", 2]]);
  /* Other things a player could read as the rule. None of them may single out a choice other than the odd one. */
  const dotCount = (f) => f.spots.length;
  const boxShape = (f) => [span(f.cells, 0), span(f.cells, 1)].sort((a, b) => a - b).join("x");
  const SIDE_FEATURES = Object.freeze({
    sides: [], curl: [],
    parity: [f => dotCount(f) % 3 === 0, f => [2, 3, 5, 7].includes(dotCount(f)), f => [4, 9].includes(dotCount(f))],
    symmetry: [boxShape, hasTurnSymmetry]
  });
  /* figs[0] is the odd one. True when value i alone differs from the rest, and the example (if shown) sides with the rest. */
  const lonely = (vals, i, ex) => {
    const rest = vals.filter((_, j) => j !== i);
    return rest.every(w => w === rest[0]) && vals[i] !== rest[0] && (ex === undefined || ex === rest[0]);
  };
  /* A dot count far away from three close ones (2, 3, 4 and 8) looks like the odd one by size alone. */
  const standsApart = (counts, i) => {
    const rest = counts.filter((_, j) => j !== i);
    return Math.min(...rest.map(c => Math.abs(c - counts[i]))) >= 3 && Math.max(...rest) - Math.min(...rest) <= 3;
  };
  function misleads(rule, figs, example) {
    const others = range(figs.length).slice(1);
    const byFeature = SIDE_FEATURES[rule].some(fn => others.some(i => lonely(figs.map(fn), i, example ? fn(example) : undefined)));
    return byFeature || (rule === "parity" && others.some(i => standsApart(figs.map(dotCount), i)));
  }
  function oddQuestion(level, r) {
    const rule = R.pick(ODD_RULES.filter(([, min]) => level >= min).map(([id]) => id), r);
    const need = level >= 3 ? 4 : 3;
    const { same, odd } = retry(() => {
      const made = ODD_MAKERS[rule](level, need, r);
      return misleads(rule, [made.odd, ...made.same.slice(0, 3)], need === 4 ? made.same[3] : null) ? null : made;
    });
    return { type: "odd", level, rule, prompt: { kind: "odd", example: need === 4 ? same[3] : null }, ...arrange(odd, same.slice(0, 3), r) };
  }

  /* ---------- whole run ---------- */
  const MAKERS = { seq: seqQuestion, matrix: matrixQuestion, odd: oddQuestion, rotate: rotateQuestion, relation: relationQuestion };
  function makeQuestion(type, level, r = Math.random) {
    if (!MAKERS[type]) throw new Error("問題の種類が正しくありません");
    if (!Number.isInteger(level) || level < 0 || level >= LEVELS) throw new Error("レベルが正しくありません");
    return MAKERS[type](level, r);
  }
  /* 5 blocks of 4 questions, one block per level; each type appears 4 times and never twice in a row. */
  function questionPlan(r = Math.random) {
    const drops = R.shuffle(TYPE_IDS, r);
    return range(LEVELS).reduce((order, level) => {
      const block = R.shuffle(TYPE_IDS.filter(t => t !== drops[level]), r);
      const fixed = order.length && block[0] === order[order.length - 1].type ? [...block.slice(1), block[0]] : block;
      return [...order, ...fixed.map(type => ({ type, level }))];
    }, []);
  }
  function newRun(timing, r = Math.random) {
    if (!TIMINGS.includes(timing)) throw new Error("時間の設定が正しくありません");
    return { timing, questions: questionPlan(r).map(p => makeQuestion(p.type, p.level, r)), answers: [] };
  }
  const finished = (run) => run.answers.length >= run.questions.length;
  const current = (run) => (finished(run) ? null : run.questions[run.answers.length]);
  /* choice: 0-3, or null when time ran out. */
  function submit(run, choice, ms) {
    if (finished(run)) throw new Error("もう全問終わっています");
    if (choice !== null && !(Number.isInteger(choice) && choice >= 0 && choice < CHOICES)) throw new Error("選んだ答えが正しくありません");
    if (!Number.isFinite(ms) || ms < 0) throw new Error("時間が正しくありません");
    const q = current(run);
    const limit = run.timing === "timed" ? TIME_LIMIT_SEC * 1000 : MAX_MS;
    const entry = { type: q.type, level: q.level, choice, correct: choice === q.answer, ms: Math.round(Math.min(ms, limit)) };
    return { ...run, answers: [...run.answers, entry] };
  }

  /* ---------- score, titles, records ---------- */
  function estimateIq(rate, avgSec) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("正解率が正しくありません");
    if (!Number.isFinite(avgSec) || avgSec < 0) throw new Error("時間が正しくありません");
    const speed = clamp((20 - avgSec) / 14, 0, 1) * 5 * rate;
    return clamp(Math.round(100 + (rate - 0.5) * 80 + speed), IQ_MIN, IQ_MAX);
  }
  const titleFor = (iq) => TITLES.find(t => iq >= t.min).title;
  function result(run) {
    if (!finished(run)) throw new Error("まだ終わっていません");
    const list = run.answers;
    const weight = (a) => LEVEL_WEIGHT[a.level];
    const rate = list.reduce((s, a) => s + (a.correct ? weight(a) : 0), 0) / list.reduce((s, a) => s + weight(a), 0);
    const avgSec = list.reduce((s, a) => s + a.ms, 0) / list.length / 1000;
    const iq = estimateIq(rate, avgSec);
    const byType = TYPES.map(t => {
      const mine = list.filter(a => a.type === t.id);
      return { id: t.id, name: t.name, correct: mine.filter(a => a.correct).length, total: mine.length };
    });
    return { correct: list.filter(a => a.correct).length, total: list.length, avgSec, iq, title: titleFor(iq), byType };
  }
  const validRecord = (v) => !!v && Number.isInteger(v.iq) && v.iq >= IQ_MIN && v.iq <= IQ_MAX &&
    Number.isInteger(v.correct) && v.correct >= 0 && v.correct <= TOTAL;
  const normalizeRecords = (raw) => Object.fromEntries(TIMINGS.map(t => {
    const v = raw && typeof raw === "object" ? raw[t] : null;
    return [t, validRecord(v) ? { iq: v.iq, correct: v.correct } : null];
  }));
  function updateRecords(records, timing, res) {
    if (!TIMINGS.includes(timing)) throw new Error("時間の設定が正しくありません");
    const prev = records[timing];
    const better = !prev || res.iq > prev.iq || (res.iq === prev.iq && res.correct > prev.correct);
    return { records: better ? { ...records, [timing]: { iq: res.iq, correct: res.correct } } : records, isNew: better, prev };
  }
  const normalizeSettings = (raw) => ({ timing: raw && TIMINGS.includes(raw.timing) ? raw.timing : "timed" });

  /* ---------- SVG drawing (strings only; colors come from currentColor and CSS classes) ---------- */
  const LINE = 'stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"';
  const pts = (list) => list.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ");
  const ring = (n, rad, x, y, startDeg) => range(n).map(i => {
    const a = ((startDeg + (i * 360) / n) * Math.PI) / 180;
    return [x + rad * Math.cos(a), y + rad * Math.sin(a)];
  });
  const scaled = (list, x, y, h) => list.map(([dx, dy]) => [x + dx * h, y + dy * h]);
  const OUTLINES = {
    triangle: (x, y, h) => ring(3, h * 1.15, x, y + h * 0.15, -90),
    diamond: (x, y, h) => ring(4, h * 1.1, x, y, -90),
    hexagon: (x, y, h) => ring(6, h, x, y, 0),
    star: (x, y, h) => range(10).map(i => {
      const a = ((-90 + i * 36) * Math.PI) / 180, rad = i % 2 ? h * 0.48 : h * 1.1;
      return [x + rad * Math.cos(a), y + rad * Math.sin(a)];
    }),
    plus: (x, y, h) => scaled([[-1, -3], [1, -3], [1, -1], [3, -1], [3, 1], [1, 1], [1, 3], [-1, 3], [-1, 1], [-3, 1], [-3, -1], [-1, -1]], x, y, h * 0.32),
    arrow: (x, y, h) => scaled([[0, -1], [0.8, -0.1], [0.32, -0.1], [0.32, 1], [-0.32, 1], [-0.32, -0.1], [-0.8, -0.1]], x, y, h)
  };
  function shapeEl(shape, x, y, h, rot, paint) {
    if (shape === "circle") return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(h * 0.95)}" ${paint}/>`;
    if (shape === "square") {
      return `<rect x="${f1(x - h * 0.85)}" y="${f1(y - h * 0.85)}" width="${f1(h * 1.7)}" height="${f1(h * 1.7)}" rx="${f1(h * 0.15)}" ${paint}/>`;
    }
    const spin = shape === "arrow" && rot ? ` transform="rotate(${rot} ${f1(x)} ${f1(y)})"` : "";
    return `<polygon points="${pts(OUTLINES[shape](x, y, h))}"${spin} ${paint}/>`;
  }
  const SPOTS = { 1: [[50, 50]], 2: [[28, 50], [72, 50]], 3: [[50, 27], [27, 71], [73, 71]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]] };
  const SPOT_SIZE = { 1: 28, 2: 17, 3: 15, 4: 14 };
  function cellBody(c, uid) {
    const fill = c.fill === "solid" ? "currentColor" : c.fill === "stripe" ? `url(#${uid})` : "none";
    const paint = `fill="${fill}" ${LINE} stroke-width="${c.count === 1 ? 4 : 3}"`;
    return SPOTS[c.count].map(([x, y]) => shapeEl(c.shape, x, y, SPOT_SIZE[c.count], c.rot, paint)).join("");
  }
  function polyBody(f) {
    const u = 18, w = span(f.cells, 0), h = span(f.cells, 1), ox = 50 - (w * u) / 2, oy = 50 - (h * u) / 2;
    const cells = f.cells.map(([x, y]) =>
      `<rect x="${f1(ox + x * u + 1.5)}" y="${f1(oy + y * u + 1.5)}" width="${u - 3}" height="${u - 3}" rx="3" class="iq-tint" fill="currentColor" fill-opacity=".2" ${LINE} stroke-width="2.5"/>`);
    const mark = f.mark ? `<circle class="iq-mark" cx="${f1(ox + (f.mark[0] + 0.5) * u)}" cy="${f1(oy + (f.mark[1] + 0.5) * u)}" r="5.5" fill="currentColor"/>` : "";
    return cells.join("") + mark;
  }
  const polygonBody = (f) => `<polygon points="${pts(f.pts)}" class="iq-tint" fill="currentColor" fill-opacity=".16" ${LINE} stroke-width="3.5"/>`;
  function curlBody(f) {
    const rad = 28, a0 = (f.start * Math.PI) / 180, a1 = ((f.start + f.dir * 270) * Math.PI) / 180;
    const at = (a) => [50 + rad * Math.cos(a), 50 + rad * Math.sin(a)];
    const [x0, y0] = at(a0), [x1, y1] = at(a1);
    const tan = [-Math.sin(a1) * f.dir, Math.cos(a1) * f.dir], nrm = [Math.cos(a1), Math.sin(a1)];
    const head = [[x1 + tan[0] * 11, y1 + tan[1] * 11], [x1 - tan[0] * 3 + nrm[0] * 9, y1 - tan[1] * 3 + nrm[1] * 9], [x1 - tan[0] * 3 - nrm[0] * 9, y1 - tan[1] * 3 - nrm[1] * 9]];
    return `<path d="M${f1(x0)} ${f1(y0)} A${rad} ${rad} 0 1 ${f.dir > 0 ? 1 : 0} ${f1(x1)} ${f1(y1)}" fill="none" ${LINE} stroke-width="6"/>` +
      `<circle cx="${f1(x0)}" cy="${f1(y0)}" r="5" fill="currentColor"/><polygon points="${pts(head)}" fill="currentColor" ${LINE} stroke-width="2"/>`;
  }
  const dotsBody = (f) => f.spots.map(i => `<circle cx="${22 + (i % 3) * 28}" cy="${22 + Math.floor(i / 3) * 28}" r="9" fill="currentColor"/>`).join("");
  const BODIES = { cell: cellBody, poly: polyBody, polygon: polygonBody, curl: curlBody, dots: dotsBody };
  const hatch = (uid) => `<defs><pattern id="${uid}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.6" height="7" fill="currentColor"/></pattern></defs>`;
  function checkUid(uid) {
    if (typeof uid !== "string" || !/^iq[A-Za-z0-9_-]*$/.test(uid)) throw new Error("図形のidが正しくありません");
  }
  function figureSvg(fig, uid = "iqHatch") {
    if (!fig || !BODIES[fig.t]) throw new Error("図形の形式が正しくありません");
    checkUid(uid);
    const defs = fig.t === "cell" && fig.fill === "stripe" ? hatch(uid) : "";
    return `<svg class="iq-fig" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${defs}${BODIES[fig.t](fig, uid)}</svg>`;
  }
  function matrixSvg(cells, uid = "iqHatch") {
    if (!Array.isArray(cells) || cells.length !== 9) throw new Error("3×3の図形が必要です");
    checkUid(uid);
    const defs = cells.some(c => c && c.fill === "stripe") ? hatch(uid) : "";
    const body = cells.map((c, i) => {
      const box = `<rect class="iq-cell${c ? "" : " iq-missing"}" x="4" y="4" width="92" height="92" rx="12" fill="none"/>`;
      const inner = c ? cellBody(c, uid) : '<text class="iq-qmark" x="50" y="53" text-anchor="middle" dominant-baseline="central">?</text>';
      return `<g transform="translate(${(i % 3) * 100} ${Math.floor(i / 3) * 100})">${box}${inner}</g>`;
    }).join("");
    return `<svg class="iq-matrix-svg" viewBox="0 0 300 300" aria-hidden="true" focusable="false">${defs}${body}</svg>`;
  }
  /* Two choices with the same key look the same on screen. */
  function visualKey(f) {
    if (typeof f === "number") return `n:${f}`;
    if (f.t === "cell") return `cell:${f.shape}:${f.count}:${f.fill}:${f.shape === "arrow" ? f.rot % 360 : 0}`;
    if (f.t === "poly") return `poly:${polyKey(normPoly(f.cells, f.mark))}`;
    return JSON.stringify(f);
  }

  return {
    TOTAL, LEVELS, CHOICES, TIME_LIMIT_SEC, TIMINGS, TYPES, IQ_MIN, IQ_MAX, TITLES, SHAPES, FILLS,
    makeQuestion, questionPlan, newRun, current, finished, submit,
    estimateIq, titleFor, result, normalizeRecords, updateRecords, normalizeSettings,
    seqFits, relationPredictions, figureSvg, matrixSvg, visualKey
  };
})();

if (typeof module !== "undefined") module.exports = IqRules;

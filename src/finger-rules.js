/* Finger roulette rules: from the fingers on the screen, pick one person, a turn order, or balanced teams.
 * Also the pure helpers for the spin (clockwise sweep, path, accelerating tick delays) and finger colors. */
const FingerRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const MODES = Object.freeze(["one", "order", "teams"]);
  const MODE_LABELS = Object.freeze({ one: "1人を選ぶ", order: "順番を決める", teams: "チーム分け" });
  const TEAM_COUNTS = Object.freeze([2, 3]);
  const TEAM_NAMES = Object.freeze(["A", "B", "C"]);
  const MAX_FINGERS = 10;
  const SPIN_MS = 2200;
  const SPEEDUP = 5;
  const DEFAULTS = Object.freeze({ mode: "one", teams: 2 });

  /* ---------- validation ---------- */
  function checkMode(mode) {
    if (!MODES.includes(mode)) throw new Error("モードが正しくありません");
    return mode;
  }
  function checkTeams(teams) {
    if (!TEAM_COUNTS.includes(teams)) throw new Error(`チームの数は${TEAM_COUNTS.join("か")}です`);
    return teams;
  }
  const validId = (id) => (typeof id === "number" && Number.isFinite(id)) || (typeof id === "string" && id !== "");
  function checkIds(ids) {
    if (!Array.isArray(ids)) throw new Error("指のリストがありません");
    if (!ids.every(validId)) throw new Error("指の番号が正しくありません");
    if (new Set(ids).size !== ids.length) throw new Error("同じ指が2回入っています");
    if (ids.length > MAX_FINGERS) throw new Error(`指は${MAX_FINGERS}本までです`);
    return ids;
  }

  /* Fewest fingers needed before a pick can happen. */
  function minFingers(mode, teams = DEFAULTS.teams) {
    checkMode(mode);
    return mode === "teams" ? Math.max(2, checkTeams(teams)) : 2;
  }

  /* Settings loaded from storage: anything unknown falls back to the defaults. */
  function normalizeSettings(s) {
    const obj = s && typeof s === "object" && !Array.isArray(s) ? s : {};
    return {
      mode: MODES.includes(obj.mode) ? obj.mode : DEFAULTS.mode,
      teams: TEAM_COUNTS.includes(obj.teams) ? obj.teams : DEFAULTS.teams
    };
  }

  /* ---------- the pick ---------- */
  /* Deals shuffled ids round-robin, so team sizes differ by at most one. */
  function split(shuffled, teams) {
    const out = Array.from({ length: teams }, (_, k) => Object.freeze(shuffled.filter((_, i) => i % teams === k)));
    return Object.freeze(out);
  }

  /* one -> { mode, winner }, order -> { mode, order: [first, ...] }, teams -> { mode, teams: [[...], ...] } */
  function pick(ids, mode, teams = DEFAULTS.teams, r = Math.random) {
    checkIds(ids);
    const min = minFingers(mode, teams);
    if (ids.length < min) throw new Error(`指が${min}本以上いります`);
    if (typeof r !== "function") throw new Error("乱数が正しくありません");
    if (mode === "one") return Object.freeze({ mode, winner: R.pick(ids, r) });
    const shuffled = R.shuffle(ids, r);
    if (mode === "order") return Object.freeze({ mode, order: Object.freeze(shuffled) });
    return Object.freeze({ mode, teams: split(shuffled, teams) });
  }

  /* 1-based place in an order result; 0 when not there. */
  const rankOf = (result, id) => (result && Array.isArray(result.order) ? result.order.indexOf(id) + 1 : 0);
  /* Team index in a teams result; -1 when not there. */
  const teamOf = (result, id) => (result && Array.isArray(result.teams) ? result.teams.findIndex(t => t.includes(id)) : -1);

  /* ---------- revealing the result ---------- */
  /* Steps the screen takes to show a result: one burst, one number per finger, or one recolor per finger. */
  function revealSteps(result) {
    if (!result) return 0;
    if (result.mode === "one") return 1;
    return result.mode === "order" ? result.order.length : result.teams.flat().length;
  }

  /* How one finger looks once `revealed` steps are shown. Teams recolor one finger at a time along `cycle`. */
  function look(result, revealed, cycle, id) {
    const none = { win: false, out: false, rank: 0, team: -1 };
    if (!result || !(revealed > 0)) return none;
    if (result.mode === "one") return { ...none, win: result.winner === id, out: result.winner !== id };
    if (result.mode === "order") {
      const rank = rankOf(result, id);
      return { ...none, rank: rank <= revealed ? rank : 0 };
    }
    const at = Array.isArray(cycle) ? cycle.indexOf(id) : -1;
    return { ...none, team: at !== -1 && at < revealed ? teamOf(result, id) : -1 };
  }

  /* Short headline once the result is out (fits one line on a phone). */
  function summary(result) {
    if (!result) return "";
    if (result.mode === "one") return "この指にきまり！";
    return result.mode === "order" ? "この順番で！ 1の人から" : "同じ色どうしでチーム！";
  }
  /* Extra line under the headline: team sizes, e.g. "A 3人・B 2人". */
  function detail(result) {
    if (!result || result.mode !== "teams") return "";
    return result.teams.map((t, k) => `${TEAM_NAMES[k]} ${t.length}人`).join("・");
  }

  /* ---------- spin ---------- */
  /* Ids ordered clockwise from 12 o'clock around the middle of all points (screen y grows downward). */
  function sweep(points) {
    if (!Array.isArray(points) || !points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
      throw new Error("指の位置が正しくありません");
    }
    if (points.length === 0) return Object.freeze([]);
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    const angle = (p) => (Math.atan2(p.x - cx, cy - p.y) + 2 * Math.PI) % (2 * Math.PI);
    const ranked = points.map((p, i) => ({ id: p.id, a: angle(p), i }));
    return Object.freeze([...ranked].sort((a, b) => a.a - b.a || a.i - b.i).map(p => p.id));
  }

  /* Enough flashes for two laps, never fewer than 12. */
  function minSpinSteps(count) {
    if (!Number.isInteger(count) || count < 1) throw new Error("指の数が正しくありません");
    return Math.max(12, count * 2 + 2);
  }

  /* Walks the cycle from its first id. With a target, adds just enough steps to stop on it. */
  function spinPath(cycle, target, minSteps) {
    if (!Array.isArray(cycle) || cycle.length === 0) throw new Error("回す指がありません");
    if (!Number.isInteger(minSteps) || minSteps < 1) throw new Error("回数が正しくありません");
    const n = cycle.length;
    let length = minSteps;
    if (target !== null && target !== undefined) {
      const at = cycle.indexOf(target);
      if (at === -1) throw new Error("当たりの指が見つかりません");
      length += (((at - (minSteps - 1)) % n) + n) % n;
    }
    return Object.freeze(Array.from({ length }, (_, i) => cycle[i % n]));
  }

  /* Wait before each flash: shrinks geometrically so the last is `speedup` times faster; sums to about totalMs. */
  function spinDelays(steps, totalMs = SPIN_MS, speedup = SPEEDUP) {
    if (!Number.isInteger(steps) || steps < 1) throw new Error("回数が正しくありません");
    if (!Number.isFinite(totalMs) || totalMs <= 0) throw new Error("時間が正しくありません");
    if (!Number.isFinite(speedup) || speedup < 1) throw new Error("速さが正しくありません");
    const q = steps === 1 ? 1 : Math.pow(1 / speedup, 1 / (steps - 1));
    const weights = Array.from({ length: steps }, (_, i) => Math.pow(q, i));
    const sum = weights.reduce((a, b) => a + b, 0);
    return Object.freeze(weights.map(w => Math.max(1, Math.round((w * totalMs) / sum))));
  }

  /* ---------- badge placement ---------- */
  /* Unit vector from a finger toward the middle of the screen. Hands come in from the edges,
   * so a badge on this side of the ring stays visible. Straight up when the finger is on the middle. */
  function toward(p, mid) {
    const ok = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y);
    if (!ok(p) || !ok(mid)) throw new Error("指の位置が正しくありません");
    const dx = mid.x - p.x;
    const dy = mid.y - p.y;
    const len = Math.hypot(dx, dy);
    return len < 1 ? { x: 0, y: -1 } : { x: dx / len, y: dy / len };
  }

  /* Badge directions for all fingers (unit vectors, same order as points). Each badge sits `reach` away from its finger:
   * toward the middle when that spot is on screen, nearer its own finger than any other, and clear of badges already
   * placed; otherwise turned in 30 degree steps, smallest turn first. Fingers nearest the middle choose first. */
  const BADGE_TURNS = Object.freeze([0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]);
  const BADGE_EDGE = 26;
  const BADGE_GAP = 58;
  function badgeDirs(points, mid, reach, box) {
    const okBox = box && Number.isFinite(box.w) && Number.isFinite(box.h);
    if (!Array.isArray(points) || !okBox || !Number.isFinite(reach) || reach <= 0) throw new Error("指の位置が正しくありません");
    const bases = points.map(p => toward(p, mid));
    const turned = (d, k) => {
      const a = Math.atan2(d.y, d.x) + (k * Math.PI) / 6;
      return k === 0 ? d : { x: Math.cos(a), y: Math.sin(a) };
    };
    const spotOf = (i, d) => ({ x: points[i].x + d.x * reach, y: points[i].y + d.y * reach });
    const onScreen = (s) => s.x >= BADGE_EDGE && s.y >= BADGE_EDGE && s.x <= box.w - BADGE_EDGE && s.y <= box.h - BADGE_EDGE;
    const ownSide = (i, s) => points.every((o, j) => j === i || Math.hypot(o.x - s.x, o.y - s.y) >= reach);
    const order = points.map((p, i) => i).sort((a, b) => Math.hypot(points[a].x - mid.x, points[a].y - mid.y) - Math.hypot(points[b].x - mid.x, points[b].y - mid.y));
    const placed = order.reduce((acc, i) => {
      const options = BADGE_TURNS.map(k => turned(bases[i], k));
      const clear = (d) => Object.values(acc).every(q => Math.hypot(q.s.x - spotOf(i, d).x, q.s.y - spotOf(i, d).y) >= BADGE_GAP);
      const good = (d) => onScreen(spotOf(i, d)) && ownSide(i, spotOf(i, d));
      const d = options.find(o => good(o) && clear(o)) || options.find(good) || bases[i];
      return { ...acc, [i]: { d, s: spotOf(i, d) } };
    }, {});
    return Object.freeze(points.map((p, i) => placed[i].d));
  }

  /* ---------- fingers still pressed ---------- */
  /* Touch fingers still on the glass: not lifted after a result (up) and not mouse points (fixed). */
  function pressed(points) {
    if (!Array.isArray(points)) throw new Error("指のリストがありません");
    return points.filter(p => p && !p.fixed && !p.up);
  }
  /* A lifted finger's pointer id may come back for a new touch, so only pressed fingers count as "already here". */
  const isPressed = (points, id) => pressed(points).some(p => p.id === id);

  /* ---------- colors ---------- */
  /* Lowest color slot not used by a finger already on the screen; -1 when every slot is taken. */
  function nextSlot(used, size) {
    if (!Array.isArray(used) || !Number.isInteger(size) || size < 1) throw new Error("色の指定が正しくありません");
    const taken = new Set(used);
    const free = Array.from({ length: size }, (_, i) => i).find(i => !taken.has(i));
    return free === undefined ? -1 : free;
  }

  return {
    MODES, MODE_LABELS, TEAM_COUNTS, TEAM_NAMES, MAX_FINGERS, SPIN_MS, BADGE_GAP,
    minFingers, normalizeSettings, pick, rankOf, teamOf, revealSteps, look, summary, detail,
    sweep, minSpinSteps, spinPath, spinDelays, toward, badgeDirs, pressed, isPressed, nextSlot
  };
})();

if (typeof module !== "undefined") module.exports = FingerRules;

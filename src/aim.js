/* 的当てタップ screen: bullseye targets pop up one at a time in a play field; tap them fast.
 * Taps are read on pointerdown in field coordinates, so fingers and the mouse both work. */
const Aim = (() => {
  const A = AimRules;
  const KEY = "aim.settings";
  const RECORD_KEY = "aim.records";
  const SLOP = Object.freeze({ touch: 8, pen: 4, mouse: 0 });
  const FINISH_MS = 1100;
  const FX_MS = 650;
  const MAX_STEP_MS = 50;
  const URGENT_MS = 10000;
  const SPARKS = 8;
  const MIN_FIELD = 120;
  const LIVE = Object.freeze(["ready", "play", "paused", "finish"]);
  const RULES = Object.freeze({
    count30: ["的が1つずつ出てくる。できるだけ早くタップ", "30個当てるまでのタイムを計る", "的の外をタップすると命中率が下がる", "スマホは指で、パソコンはマウスで遊べる"],
    score30: ["30秒間、出てくる的をどんどんタップ", "真ん中ほど高得点（外側10点・内側20点・真ん中30点）", "時間がたつと的がだんだん小さくなる", "的の外をタップすると命中率が下がる"],
    move: ["的がふわふわ動き回る。30秒で何個当てられるか", "当てるたびに的のスピードが上がる", "的の外をタップすると命中率が下がる"]
  });
  const HUD_LABELS = Object.freeze({
    count30: ["タイム", "のこりの的"], score30: ["のこり時間", "スコア"], move: ["のこり時間", "当てた数"]
  });

  const el = {
    setup: $("amSetup"), play: $("amPlay"), label: $("amLabel"), title: $("amTitle"), card: $("amCard"),
    hint: $("amHint"), actions: $("amActions"), mode: $("modeAim"), stage: $("amStage"),
    modeChips: $("amModeChips"), rules: $("amRules"), hud: $("amHud"), time: $("amTime"), timeLabel: $("amTimeLabel"),
    count: $("amCount"), countLabel: $("amCountLabel"), acc: $("amAcc"), bar: $("amBar"),
    field: $("amField"), target: $("amTarget"), face: $("amFace"), veil: $("amVeil"),
    veilMain: $("amVeilMain"), veilSub: $("amVeilSub"), stats: $("amStats"), records: $("amRecords")
  };

  let settings = A.normalizeSettings(null);
  let records = A.normalizeRecords(null);
  let ui = { phase: "setup" };
  let run = null;
  let target = null;
  let result = null;
  let bounds = { w: 300, h: 360 };
  let clock = { startAt: 0, pausedAt: 0, last: 0 };
  let loop = { raf: 0, pending: 0, session: 0 };
  let hud = { sec: null, urgent: false };

  const mode = () => settings.mode;
  const timed = () => A.MODES[mode()].kind === "timed";
  /* Run time without pauses. While paused (or before the start) the clock is frozen at pausedAt. */
  const elapsed = (now = performance.now()) => Math.max(0, (clock.pausedAt || now) - clock.startAt);

  /* ---------- sounds ---------- */
  const audioNow = () => (Sound.ctx() ? Sound.ctx().currentTime : null);
  const SFX = {
    hit(ring, streak) {
      const t = audioNow();
      if (t === null) return;
      const lift = Math.pow(2, Math.min(streak, 18) / 24);
      Sound.tone({ freq: 300 * lift, glide: 1200 * lift, glideTime: 0.05, type: "sine", t, dur: 0.12, vol: 0.26 });
      Sound.tone({ freq: 2400 * lift, type: "triangle", t, dur: 0.03, vol: 0.05 });
      Sound.hiss({ t, dur: 0.04, vol: 0.1, type: "bandpass", freq: 3400, q: 0.8 });
      if (ring === 0) [93, 100].forEach((m, i) => Sound.tone({ freq: Sound.hz(m), type: "triangle", t: t + 0.04 + i * 0.06, dur: 0.3, vol: 0.06, send: 0.3 }));
    },
    miss() {
      const t = audioNow();
      if (t === null) return;
      Sound.tone({ freq: 190, glide: 110, glideTime: 0.08, type: "triangle", t, dur: 0.11, vol: 0.08, filter: { freq: 650 } });
      Sound.hiss({ t, dur: 0.05, vol: 0.03, type: "lowpass", freq: 800 });
    }
  };

  /* ---------- field ---------- */
  function measure() {
    const w = el.field.clientWidth;
    const h = el.field.clientHeight;
    if (w >= MIN_FIELD && h >= MIN_FIELD) bounds = { w, h };
  }
  function drawTarget() {
    const show = Boolean(target) && ui.phase !== "paused";
    el.target.hidden = !show;
    if (!show) return;
    el.target.style.width = el.target.style.height = `${target.r * 2}px`;
    el.target.style.transform = `translate3d(${target.x - target.r}px, ${target.y - target.r}px, 0)`;
  }
  function spawnNext(prev) {
    measure();
    target = A.spawn({ mode: mode(), hits: run.hits, elapsedMs: elapsed(), bounds, prev }, Math.random);
    drawTarget();
    Fx.replay(el.face, "aim-spawn");
  }
  function advance(now) {
    const dt = Math.min(MAX_STEP_MS, Math.max(0, now - clock.last));
    clock = { ...clock, last: now };
    if (!target || mode() !== "move") return;
    target = A.drift(target, dt, bounds);
    drawTarget();
  }

  /* ---------- effects (all inside the field; removed after the animation) ---------- */
  function make(tag, cls, text = "", children = []) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    n.append(...children);
    return n;
  }
  function fxNode(cls, x, y, size = 0) {
    const n = make("span", cls);
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    if (size) n.style.width = n.style.height = `${size}px`;
    el.field.appendChild(n);
    setTimeout(() => n.remove(), FX_MS);
    return n;
  }
  function burst(tg, ring, text) {
    const bull = ring === 0 ? " aim-bull" : "";
    fxNode("aim-ghost", tg.x, tg.y, tg.r * 2).appendChild(make("span", "aim-face"));
    fxNode(`aim-burst${bull}`, tg.x, tg.y, tg.r * 2);
    for (let i = 0; i < SPARKS; i++) {
      const angle = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.5;
      const len = tg.r + 12 + Math.random() * 22;
      const s = fxNode(i % 2 ? "aim-spark aim-spark-alt" : "aim-spark", tg.x, tg.y);
      s.style.setProperty("--dx", `${Math.cos(angle) * len}px`);
      s.style.setProperty("--dy", `${Math.sin(angle) * len}px`);
    }
    fxNode(`aim-float${bull}`, Math.min(Math.max(tg.x, 36), bounds.w - 36), Math.max(26, tg.y - tg.r * 0.4)).textContent = text;
  }

  /* ---------- taps ---------- */
  function onPointer(e) {
    if (ui.phase !== "play" || !target) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const now = performance.now();
    advance(now);
    const t = elapsed(now);
    if (A.isOver(run, t)) return finish();
    const box = el.field.getBoundingClientRect();
    const x = e.clientX - box.left - el.field.clientLeft;
    const y = e.clientY - box.top - el.field.clientTop;
    const res = A.hitTest(target, x, y, SLOP[e.pointerType] ?? 0);
    if (res.hit) onHit(res, t);
    else onMiss(x, y);
    if (ui.phase === "play") renderHud(now);
  }
  function onHit(res, t) {
    const prev = target;
    const split = Math.max(0, t - run.lastHitMs);
    run = A.hit(run, res.ring, t);
    burst(prev, res.ring, mode() === "score30" ? `+${res.points}` : `${(split / 1000).toFixed(2)}秒`);
    SFX.hit(res.ring, run.streak);
    Fx.replay(el.count, "aim-bump");
    if (!A.isOver(run, t)) return spawnNext(prev);
    target = null;
    finish();
  }
  function onMiss(x, y) {
    run = A.miss(run);
    fxNode("aim-miss", x, y);
    SFX.miss();
    Fx.replay(el.acc, "aim-drop");
  }

  /* ---------- flow ---------- */
  function update(patch) {
    settings = A.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  const go = (phase) => { ui = { phase }; render(); };
  function stopAll() {
    cancelAnimationFrame(loop.raf);
    clearTimeout(loop.pending);
    loop = { raf: 0, pending: 0, session: loop.session + 1 };
    Music.stop();
  }
  function startLoop() {
    loop = { ...loop, raf: requestAnimationFrame(frame) };
  }
  function frame(now) {
    if (ui.phase !== "play") return;
    advance(now);
    if (A.isOver(run, elapsed(now))) return finish();
    renderHud(now);
    startLoop();
  }
  async function start() {
    Sound.ensure();
    Awake.keep();
    stopAll();
    const session = loop.session;
    const now = performance.now();
    run = A.newRun(mode());
    target = null;
    result = null;
    hud = { sec: null, urgent: false };
    clock = { startAt: now, pausedAt: now, last: now };
    Sound.sfx("confirm");
    go("ready");
    await Fx.countdown("スタート！");
    if (session !== loop.session || ui.phase !== "ready") return;
    const at = performance.now();
    clock = { startAt: at, pausedAt: 0, last: at };
    go("play");
    spawnNext(null);
    Music.play("draw");
    startLoop();
  }
  function pause() {
    if (ui.phase !== "play") return;
    cancelAnimationFrame(loop.raf);
    clock = { ...clock, pausedAt: performance.now() };
    Music.stop();
    Sound.sfx("back");
    go("paused");
  }
  function resume() {
    if (ui.phase !== "paused") return;
    const now = performance.now();
    clock = { startAt: clock.startAt + (now - clock.pausedAt), pausedAt: 0, last: now };
    Music.play("draw");
    go("play");
    onResize();
    startLoop();
  }
  function quit() {
    stopAll();
    target = null;
    go("setup");
  }
  function finish() {
    if (ui.phase !== "play") return;
    cancelAnimationFrame(loop.raf);
    Music.stop();
    clock = { ...clock, pausedAt: clock.startAt + (timed() ? A.DURATION_MS : run.lastHitMs) };
    const sum = A.summary(run, elapsed());
    const rec = A.applyRecord(records, sum.mode, sum.value);
    records = rec.records;
    Store.save(RECORD_KEY, records);
    result = { ...sum, isNew: rec.isNew, previous: rec.previous };
    target = null;
    Sound.sfx(timed() ? "buzz" : "correct");
    go("finish");
    Fx.pop(el.veilMain);
    loop = { ...loop, raf: 0, pending: setTimeout(showResult, FINISH_MS) };
  }
  function showResult() {
    if (ui.phase !== "finish") return;
    go("result");
    if (document.hidden) return;
    Fx.pop(el.card);
    if (result.isNew) {
      Sound.sfx("victory");
      Fx.confetti();
    } else Sound.sfx(result.rank.level <= 2 ? "fanfare" : "reveal");
  }

  /* ---------- screens ---------- */
  function cardSub() {
    if (result.isNew) return result.previous === null ? "新記録！ はじめての記録" : `新記録！ これまで ${A.formatValue(result.mode, result.previous)}`;
    const best = records[result.mode];
    return best === null ? "まずは1個当ててみよう" : `自己ベスト ${A.formatValue(result.mode, best)}`;
  }
  function resultHint() {
    const next = result.rank.next;
    return next ? `あと${A.formatValue(result.mode, next.gap)}で「${next.title}」` : "最高ランク！ おみごと";
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    ready: () => ({ actions: [makeButton("やめる", quit, "small")] }),
    play: () => ({ actions: [makeButton("一時停止", pause, "small")] }),
    paused: () => ({ actions: [makeButton("やめる", quit, "small"), makeButton("つづける", resume, "primary")] }),
    finish: () => ({ actions: [] }),
    result: () => ({
      label: A.MODES[result.mode].label,
      title: result.rank.title,
      card: { main: A.formatValue(result.mode, result.value), sub: cardSub(), cls: result.isNew ? "aim-score aim-best" : "aim-score" },
      hint: resultHint(),
      actions: [makeButton("設定", () => go("setup"), "small"), makeButton("もう一回", start, "primary")]
    })
  };

  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  function renderHud(now = performance.now()) {
    if (!run) return;
    const t = elapsed(now);
    const left = A.remaining(run, t);
    const isTimed = timed();
    const acc = A.accuracy(run);
    const urgent = isTimed && left <= URGENT_MS && ui.phase === "play";
    const sec = isTimed ? Math.ceil(left / 1000) : null;
    setText(el.time, isTimed ? (left / 1000).toFixed(1) : (t / 1000).toFixed(2));
    setText(el.count, String(mode() === "score30" ? run.score : isTimed ? run.hits : left));
    setText(el.acc, acc === null ? "--" : `${acc}%`);
    el.bar.style.transform = `scaleX(${isTimed ? left / A.DURATION_MS : left / A.TARGET_COUNT})`;
    el.hud.classList.toggle("aim-urgent", urgent);
    if (ui.phase === "play" && sec !== hud.sec && sec !== null && sec <= 3 && sec > 0) Sound.sfx("tick", sec === 1);
    if (urgent && !hud.urgent) Music.intensify();
    hud = { sec, urgent };
  }
  const VEIL = { paused: () => ["一時停止中", "「つづける」で再開"], finish: () => [timed() ? "タイムアップ！" : "クリア！", ""] };
  function renderVeil() {
    const text = VEIL[ui.phase] ? VEIL[ui.phase]() : null;
    el.veil.hidden = !text;
    View.text(el.veilMain, text ? text[0] : "");
    View.text(el.veilSub, text ? text[1] : "");
  }
  const tile = (name, value) => make("div", "aim-tile", "", [make("span", "", name), make("b", "", value)]);
  function renderStats() {
    const show = ui.phase === "result";
    el.stats.hidden = !show;
    if (!show) return;
    el.stats.replaceChildren(
      tile("1個あたり", result.avgMs === null ? "--" : `${(result.avgMs / 1000).toFixed(2)}秒`),
      tile("命中率", result.accuracy === null ? "--" : `${result.accuracy}%`),
      tile("最大連続", `${result.bestStreak}回`),
      tile("ど真ん中", `${result.bulls}回`)
    );
  }
  function recordCell(id) {
    const fresh = ui.phase === "result" && result.isNew && id === result.mode;
    const cls = ["aim-rec", id === mode() ? "on" : "", fresh ? "aim-new" : ""].filter(Boolean).join(" ");
    const parts = records[id] === null ? { num: "--", unit: "" } : A.valueParts(id, records[id]);
    return make("div", cls, "", [make("span", "", A.MODES[id].short), make("b", "", parts.num), make("small", "", parts.unit)]);
  }
  function renderRecords() {
    const show = ui.phase === "setup" || ui.phase === "result";
    el.records.hidden = !show;
    if (!show) return;
    el.records.replaceChildren(make("p", "aim-rec-head", "自己ベスト"), ...A.MODE_IDS.map(recordCell));
  }
  function renderSetup() {
    View.chips(el.modeChips, A.MODE_IDS.map(id => ({ value: id, label: A.MODES[id].label })), mode(), v => update({ mode: v }));
    View.list(el.rules, RULES[mode()]);
  }

  function render() {
    const p = ui.phase;
    const live = LIVE.includes(p);
    el.setup.hidden = p !== "setup";
    el.play.hidden = p === "setup";
    el.play.classList.toggle("aim-live", live);
    el.stage.classList.toggle("aim-stage-live", live);
    el.hud.hidden = !live;
    el.field.hidden = !live;
    if (p === "setup") renderSetup();
    View.stage(el, SCREENS[p]());
    if (live) {
      const [timeLabel, countLabel] = HUD_LABELS[mode()];
      setText(el.timeLabel, timeLabel);
      setText(el.countLabel, countLabel);
      renderHud();
      renderVeil();
      drawTarget();
    }
    renderStats();
    renderRecords();
  }

  /* ---------- outside events ---------- */
  function onResize() {
    if (!LIVE.includes(ui.phase)) return;
    measure();
    if (target) target = A.clampInto(target, bounds);
    drawTarget();
  }
  function onHidden() {
    if (document.hidden) (ui.phase === "ready" ? quit : pause)();
  }
  function onKey(e) {
    if (el.mode.hidden || e.repeat) return;
    const onButton = e.target instanceof HTMLElement && e.target.closest("button");
    const toggle = e.key === "Escape" || e.key === "p" || e.key === "P" || (e.key === " " && !onButton);
    if (!toggle) return;
    if (ui.phase === "play") pause();
    else if (ui.phase === "paused") resume();
    else return;
    e.preventDefault();
  }

  function init() {
    settings = A.normalizeSettings(Store.load(KEY, null));
    records = A.normalizeRecords(Store.load(RECORD_KEY, null));
    el.field.addEventListener("pointerdown", onPointer);
    el.field.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("visibilitychange", onHidden);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    render();
  }
  function leave() {
    if (ui.phase === "finish") {
      clearTimeout(loop.pending);
      go("result");
    } else if (["ready", "play", "paused"].includes(ui.phase)) quit();
  }

  return { init, leave };
})();

/* Finger roulette screen: everyone rests one finger on the phone; after 2 still seconds a roulette picks one person,
 * a turn order, or teams. Full-screen touch layer that tracks every pointer, plus a click-and-button mouse fallback. */
const Finger = (() => {
  const F = FingerRules;
  const KEY = "finger.settings";
  const WAIT_MS = 2000;
  const PIP_MS = 500;
  const MOVE_RESET_PX = 56;
  const REVEAL_PAUSE_MS = 260;
  const AFTER_MS = 1300;
  const STEP_MS = { order: 380, teams: 190 };
  const HIT_PX = 44;
  const BADGE_OFFSET = 34;
  const PALETTE = ["--c-red", "--c-blue", "--c-amber", "--c-green", "--c-purple", "--c-cyan", "--c-pink", "--c-orange", "--c-lime", "--c-indigo"];
  const TEAM_COLORS = ["--c-blue", "--c-red", "--c-amber"];
  const NOTES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  const SPIN_MSG = { one: "だれにしようかな…", order: "順番を決めています…", teams: "チームを分けています…" };
  /* Shown when the browser drops touches (iPhone drops every touch past 5 fingers, or a system gesture took one). */
  const CANCEL_NOTE = "読み取りが止まった指があります。はなして、のせなおしてね";
  const MODE_OPTIONS = F.MODES.map(value => ({ value, label: F.MODE_LABELS[value] }));
  const RING_HTML = '<div class="finger-body"><span class="finger-halo"></span>'
    + '<svg class="finger-arcs" viewBox="0 0 100 100" aria-hidden="true"><circle class="finger-arc" cx="50" cy="50" r="47" pathLength="100"></circle></svg>'
    + '<span class="finger-core"></span></div><div class="finger-tagbox"><span class="finger-tag" hidden></span></div>';
  const FRESH = Object.freeze({ state: "idle", points: [], result: null, cycle: [], hot: null, revealed: 0, seq: 0, note: "" });

  const el = {
    setup: $("fSetup"), actions: $("fActions"), teamOpt: $("fTeamOpt"),
    layer: $("fLayer"), field: $("fField"), glow: $("fGlow"), idle: $("fIdle"),
    info: $("fInfo"), msg: $("fMsg"), sub: $("fSub"), pick: $("fPick"), quit: $("fQuit")
  };

  let settings = { mode: "one", teams: 2 };
  let open = false;
  let board = FRESH;
  let timers = [];
  let origin = { left: 0, top: 0 };

  /* ---------- small helpers ---------- */
  function later(fn, ms) { timers = [...timers, setTimeout(fn, ms)]; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function setBoard(patch) { board = { ...board, ...patch }; paint(); }
  const minCount = () => F.minFingers(settings.mode, settings.teams);
  const held = () => F.pressed(board.points);
  const hasFixed = () => board.points.some(p => p.fixed);
  const showingResult = () => board.state === "result" || board.state === "after";
  const ringEl = (id) => [...el.field.children].find(n => n.dataset.id === String(id)) || null;
  const local = (e) => ({ x: e.clientX - origin.left, y: e.clientY - origin.top });
  function measure() { const r = el.layer.getBoundingClientRect(); origin = { left: r.left, top: r.top }; }

  /* ---------- sounds (built here from the synth primitives; silent until audio is unlocked) ---------- */
  const hz = (m) => Sound.hz(m);
  const voice = (fn) => (...args) => { const c = Sound.ctx(); if (c) fn(c.currentTime, ...args); };
  /* Rising blip: each extra finger is one step higher. */
  const sndAdd = voice((t, count) => {
    const m = 72 + NOTES[Math.min(count, NOTES.length) - 1];
    Sound.tone({ freq: hz(m - 12), glide: hz(m), glideTime: 0.07, type: "sine", t, dur: 0.24, vol: 0.22, send: 0.2 });
    Sound.tone({ freq: hz(m + 12), type: "triangle", t: t + 0.02, dur: 0.12, vol: 0.05 });
  });
  const sndLift = voice((t) => Sound.tone({ freq: hz(76), glide: hz(64), glideTime: 0.1, type: "sine", t, dur: 0.15, vol: 0.1 }));
  const sndPip = voice((t, i) => Sound.tone({ freq: hz(84 + NOTES[i]), type: "sine", t, dur: 0.08, vol: 0.06, send: 0.15 }));
  /* Spin tick: higher and louder as the roulette speeds up. */
  const sndTick = voice((t, progress) => {
    const f = 900 + progress * 1100;
    Sound.tone({ freq: f, type: "square", t, dur: 0.028, vol: 0.05 + progress * 0.04, filter: { freq: 4200 } });
    Sound.tone({ freq: f / 2, type: "triangle", t, dur: 0.04, vol: 0.12 });
  });
  const sndSting = voice((t) => {
    Sound.tone({ freq: 160, glide: 40, glideTime: 0.35, type: "sine", t, dur: 0.6, vol: 0.55 });
    [72, 76, 79, 84].forEach((m, i) => Sound.tone({
      freq: hz(m), type: "sawtooth", t: t + i * 0.012, dur: 0.75, vol: 0.045, attack: 0.008,
      detune: i % 2 ? 6 : -6, filter: { freq: 4200, to: 900 }, send: 0.35
    }));
    Sound.hiss({ t, dur: 0.9, vol: 0.12, freq: 6500, send: 0.4 });
  });
  const sndSparkle = voice((t) => {
    [84, 88, 91, 96, 100, 103, 108].forEach((m, i) => {
      Sound.tone({ freq: hz(m), type: "sine", t: t + i * 0.055, dur: 0.5, vol: 0.09, send: 0.45 });
      Sound.tone({ freq: hz(m) * 2.01, type: "sine", t: t + i * 0.055, dur: 0.2, vol: 0.03 });
    });
    Sound.hiss({ t: t + 0.05, dur: 1.3, vol: 0.05, freq: 9000, send: 0.5 });
  });
  /* One bell per revealed number (rising) or per recolored team ring (one pitch per team). */
  const sndStep = voice((t, k, team) => {
    const m = team === undefined ? 72 + NOTES[k % NOTES.length] : [67, 72, 76][team];
    if (!Number.isFinite(m)) return;
    Sound.tone({ freq: hz(m), type: "sine", t, dur: 0.35, vol: 0.16, send: 0.3 });
    Sound.tone({ freq: hz(m) * 2.01, type: "triangle", t, dur: 0.12, vol: 0.04 });
  });

  /* ---------- touch layer open / close ---------- */
  function setOpen(on) {
    clearTimers();
    el.field.replaceChildren();
    board = FRESH;
    open = on;
    el.layer.hidden = !on;
    el.layer.classList.remove("finger-waiting");
    document.body.classList.toggle("arena-open", on);
  }
  function start() {
    Sound.ensure();
    Awake.keep();
    Sound.sfx("confirm");
    document.activeElement?.blur?.();
    setOpen(true);
    measure();
    Music.play("tension");
    paint();
  }
  function quit() { setOpen(false); Music.stop(); render(); }

  /* ---------- fingers come and go ---------- */
  function onDown(e) {
    if (!open || e.target.closest("button")) return;
    e.preventDefault();
    if (e.pointerType === "mouse") {
      if (e.button === 0) onClick(local(e));
      return;
    }
    if (F.isPressed(board.points, e.pointerId) || !acceptNew()) return;
    addPoint({ id: e.pointerId, ...local(e), fixed: false });
  }
  /* A finger that lands during a result starts the next round once nobody is holding on any more. */
  function acceptNew() {
    if (board.state === "result" && held().length > 0) return false;
    if (showingResult()) resetRound();
    return board.points.length < F.MAX_FINGERS;
  }
  function addPoint(p) {
    const slot = F.nextSlot(board.points.map(q => q.slot), PALETTE.length);
    if (slot === -1) return;
    board = { ...board, points: [...board.points, { ...p, ax: p.x, ay: p.y, slot, up: false }] };
    sndAdd(board.points.length);
    settle();
  }
  function onClick(pos) {
    if (board.state === "spin") return;
    const near = showingResult() ? null : board.points.find(p => p.fixed && Math.hypot(p.x - pos.x, p.y - pos.y) < HIT_PX);
    if (near) { removePoint(near.id); return; }
    if (!acceptNew()) return;
    const seq = board.seq + 1;
    board = { ...board, seq };
    addPoint({ id: `m${seq}`, ...pos, fixed: true });
  }
  function onMove(e) {
    if (!open || e.pointerType === "mouse") return;
    const p = board.points.find(q => q.id === e.pointerId && !q.fixed && !q.up);
    if (!p) return;
    const pos = local(e);
    board = { ...board, points: board.points.map(q => (q === p ? { ...q, ...pos } : q)) };
    place(ringEl(p.id), pos);
    if (showingResult()) paintGlow();
    if (board.state === "wait" && Math.hypot(pos.x - p.ax, pos.y - p.ay) > MOVE_RESET_PX) settle();
  }
  function onUp(e) {
    if (!open || e.pointerType === "mouse") return;
    const p = board.points.find(q => q.id === e.pointerId && !q.fixed && !q.up);
    if (!p) return;
    if (showingResult()) liftAfterResult(p.id);
    else removePoint(p.id, e.type === "pointercancel" ? CANCEL_NOTE : "");
  }
  function removePoint(id, note = "") {
    board = { ...board, points: board.points.filter(p => p.id !== id) };
    sndLift();
    fadeRing(id);
    settle(note);
  }
  function liftAfterResult(id) {
    board = { ...board, points: board.points.map(p => (p.id === id ? { ...p, up: true } : p)) };
    if (held().length > 0 || board.state === "after") return;
    clearTimers();
    setBoard({ state: "after", revealed: F.revealSteps(board.result) });
    later(resetRound, AFTER_MS);
  }
  function resetRound() {
    clearTimers();
    el.field.replaceChildren();
    board = { ...FRESH, seq: board.seq };
    Music.play("tension");
    paint();
  }

  /* ---------- wait, spin, reveal ---------- */
  /* Any change of fingers lands here: wait again from zero, or go back to idle. `note` explains why, if needed. */
  function settle(note = "") {
    const again = board.state === "spin";
    clearTimers();
    if (board.points.length >= minCount() && !hasFixed()) startWait(note || (again ? "指が変わったので、やり直し" : ""));
    else setBoard({ state: "idle", hot: null, result: null, note });
  }
  function startWait(note) {
    board = { ...board, state: "wait", hot: null, result: null, note, points: board.points.map(p => ({ ...p, ax: p.x, ay: p.y })) };
    paint();
    Fx.replay(el.layer, "finger-waiting");
    [1, 2, 3].forEach(i => later(() => sndPip(i), i * PIP_MS));
    later(spin, WAIT_MS);
  }
  function pickNow() {
    if (showingResult()) { resetRound(); return; }
    if (board.state !== "spin" && board.points.length >= minCount()) spin();
  }
  function spin() {
    clearTimers();
    el.layer.classList.remove("finger-waiting");
    try {
      const ids = board.points.map(p => p.id);
      const result = F.pick(ids, settings.mode, settings.teams);
      const cycle = F.sweep(board.points);
      const target = result.winner ?? (result.order ? result.order[0] : null);
      const path = F.spinPath(cycle, target, F.minSpinSteps(ids.length));
      setBoard({ state: "spin", result, cycle, hot: null, revealed: 0, note: "" });
      Music.intensify();
      step(path, F.spinDelays(path.length), 0);
    } catch (err) {
      console.error("finger: pick failed", err);
      setBoard({ state: "idle", hot: null, result: null, note: "" });
    }
  }
  function step(path, delays, i) {
    if (i >= path.length) { later(reveal, REVEAL_PAUSE_MS); return; }
    setBoard({ hot: path[i] });
    sndTick(i / Math.max(1, path.length - 1));
    later(() => step(path, delays, i + 1), delays[i]);
  }
  function reveal() {
    Music.stop();
    setBoard({ state: "result", hot: null, revealed: 0 });
    sndSting();
    const mode = board.result.mode;
    if (mode === "one") { revealWinner(); return; }
    const total = F.revealSteps(board.result);
    for (let k = 1; k <= total; k++) later(() => revealStep(k), k * STEP_MS[mode]);
    later(mode === "order" ? sndSparkle : () => Sound.sfx("fanfare"), (total + 1) * STEP_MS[mode]);
  }
  function revealWinner() {
    setBoard({ revealed: 1 });
    burst(board.result.winner);
    later(() => { sndSparkle(); Fx.confetti(); Sound.vibrate([60, 40, 140]); }, 180);
  }
  /* Order: number k pops in on the k-th finger. Teams: the k-th ring around the circle takes its team color. */
  function revealStep(k) {
    setBoard({ revealed: k });
    const r = board.result;
    const order = r.mode === "order";
    const ring = ringEl(order ? r.order[k - 1] : board.cycle[k - 1]);
    sndStep(k - 1, order ? undefined : F.teamOf(r, board.cycle[k - 1]));
    if (order) Fx.pop(ring?.querySelector(".finger-tag"));
    else Fx.replay(ring?.querySelector(".finger-body"), "finger-flip");
  }

  /* ---------- drawing the stage ---------- */
  function place(ring, pos) { if (ring) ring.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`; }
  function makeRing(p) {
    const ring = Object.assign(document.createElement("div"), { className: "finger-ring", innerHTML: RING_HTML });
    ring.dataset.id = String(p.id);
    el.field.appendChild(ring);
    return ring;
  }
  function fadeRing(id) {
    const ring = ringEl(id);
    if (!ring) return;
    ring.removeAttribute("data-id");
    ring.classList.add("finger-gone");
    setTimeout(() => ring.remove(), 260);
  }
  function burst(id) {
    const b = Object.assign(document.createElement("span"), { className: "finger-burst" });
    ringEl(id)?.appendChild(b);
    setTimeout(() => b.remove(), 1000);
  }
  /* Color, badge and win/out state of one ring, from the result revealed so far. */
  function ringLook(p) {
    const s = F.look(showingResult() ? board.result : null, board.revealed, board.cycle, p.id);
    const color = s.team >= 0 ? TEAM_COLORS[s.team] : PALETTE[p.slot];
    const tag = s.rank > 0 ? String(s.rank) : s.team >= 0 ? F.TEAM_NAMES[s.team] : "";
    return { color, tag, win: s.win, out: s.out, first: s.rank === 1 };
  }
  /* Badges sit just outside each ring, facing the middle unless that spot is nearer another finger or badge. */
  function badgeDirs(rings) {
    const reach = (rings[0]?.querySelector(".finger-body").offsetWidth || 0) / 2 + BADGE_OFFSET;
    const box = { w: el.layer.clientWidth, h: el.layer.clientHeight };
    rings.forEach(ring => ring.style.setProperty("--reach", `${reach}px`));
    return F.badgeDirs(board.points, { x: box.w / 2, y: box.h / 2 }, reach, box);
  }
  function paintRings() {
    const rings = board.points.map(p => ringEl(p.id) || makeRing(p));
    const dirs = badgeDirs(rings);
    board.points.forEach((p, i) => {
      const ring = rings[i];
      const look = ringLook(p);
      place(ring, p);
      ring.style.setProperty("--ring", `var(${look.color})`);
      ring.classList.toggle("finger-hot", board.hot === p.id);
      ring.classList.toggle("finger-win", look.win);
      ring.classList.toggle("finger-out", look.out);
      ring.classList.toggle("finger-first", look.first);
      ring.style.setProperty("--dx", dirs[i].x.toFixed(3));
      ring.style.setProperty("--dy", dirs[i].y.toFixed(3));
      View.text(ring.querySelector(".finger-tag"), look.tag);
    });
  }
  function message() {
    const n = board.points.length;
    const short = Math.max(0, minCount() - n);
    if (board.state === "wait") return ["そのまま…", board.note || "指を動かさずに2秒まってね"];
    if (board.state === "spin") return [SPIN_MSG[board.result.mode], ""];
    if (board.state === "after") return [F.summary(board.result), F.detail(board.result)];
    if (board.state === "result") {
      const next = held().length ? "指をぜんぶはなすと、次の回へ" : "クリックか「もう一回」で次の回へ";
      return [F.summary(board.result), [F.detail(board.result), next].filter(Boolean).join("\n")];
    }
    if (n === 0) return board.note ? ["もう一度", board.note] : ["", ""];
    if (!hasFixed()) return short ? [`あと${short}人`, board.note || "指をのせたまま待ってね"] : ["指をのせなおしてね", ""];
    return short ? [`あと${short}人`, "クリックで点を足せます"] : ["「えらぶ」を押してね", "点をクリックすると消せます"];
  }
  function paintPanel() {
    const label = settings.mode === "teams" ? `${settings.teams}チームに分ける` : F.MODE_LABELS[settings.mode];
    el.info.textContent = `${label}・${board.points.length}人`;
    const [msg, sub] = message();
    View.text(el.msg, msg);
    View.text(el.sub, sub);
    el.msg.parentElement.hidden = !msg && !sub;
    const showPick = hasFixed() && board.state !== "spin";
    el.pick.hidden = !showPick;
    el.pick.textContent = showingResult() ? "もう一回" : "えらぶ";
    el.pick.disabled = !showingResult() && board.points.length < minCount();
  }
  function paintGlow() {
    const r = board.result;
    const win = showingResult() && r && r.mode === "one" && board.revealed > 0 ? board.points.find(p => p.id === r.winner) : null;
    el.glow.classList.toggle("finger-on", Boolean(win));
    if (!win) return;
    el.glow.style.setProperty("--gx", `${win.x}px`);
    el.glow.style.setProperty("--gy", `${win.y}px`);
    el.glow.style.setProperty("--ring", `var(${PALETTE[win.slot]})`);
  }
  function paint() {
    if (!open) return;
    el.layer.dataset.state = board.state;
    if (board.state !== "wait") el.layer.classList.remove("finger-waiting");
    el.idle.hidden = board.points.length > 0;
    paintRings();
    paintPanel();
    paintGlow();
  }

  /* ---------- setup screen ---------- */
  function update(patch) {
    settings = F.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function rulesLines() {
    const goal = {
      one: "光が止まった指の人にきまり！ 罰ゲームや一番手決めに",
      order: "指に1から順番の数字が出る。1の人からスタート",
      teams: `指の色が${settings.teams}色に分かれる。同じ色どうしが同じチーム（人数はなるべく同じ）`
    }[settings.mode];
    const mouseOnly = window.matchMedia && matchMedia("(any-pointer: fine)").matches && !matchMedia("(any-pointer: coarse)").matches;
    const touchMax = navigator.maxTouchPoints || 0;
    return [
      "「はじめる」を押したら、スマホをみんなの真ん中に置く",
      "1人1本ずつ画面に指をのせる。2秒じっとしていると、ルーレットが回る",
      goal,
      "途中で指が増えたり減ったりしたら、やり直し。指をぜんぶはなすと次の回",
      ...(touchMax >= 2 && touchMax < F.MAX_FINGERS ? [`この機種で同時に読める指は${touchMax}本まで`] : []),
      ...(mouseOnly ? ["パソコンでは、クリックで点を置いて「えらぶ」を押す"] : [])
    ];
  }
  function render() {
    el.setup.hidden = false;
    View.chips($("fModeChips"), MODE_OPTIONS, settings.mode, v => update({ mode: v }));
    View.chips($("fTeamChips"), View.options(F.TEAM_COUNTS, n => `${n}チーム`), settings.teams, n => update({ teams: n }));
    el.teamOpt.hidden = settings.mode !== "teams";
    View.list($("fRules"), rulesLines());
    el.actions.replaceChildren(makeButton("はじめる", start, "primary"));
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === "Escape") { quit(); return; }
    const idleFocus = !document.activeElement || document.activeElement === document.body;
    if (e.key === "Enter" && idleFocus && !el.pick.hidden && !el.pick.disabled) pickNow();
  }
  function init() {
    settings = F.normalizeSettings(Store.load(KEY, {}));
    el.layer.style.setProperty("--wait", `${WAIT_MS}ms`);
    const handlers = { pointerdown: onDown, pointermove: onMove, pointerup: onUp, pointercancel: onUp, contextmenu: (e) => e.preventDefault() };
    Object.entries(handlers).forEach(([type, fn]) => el.layer.addEventListener(type, fn));
    el.quit.addEventListener("click", quit);
    el.pick.addEventListener("click", pickNow);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", () => { if (open) measure(); });
    render();
  }
  function leave() { if (open) quit(); }

  return { init, leave };
})();

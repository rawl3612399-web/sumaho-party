/* Quick-press duel: phone lies flat between two players, each taps their own half when the signal appears. */
const Hayaoshi = (() => {
  const Q = HayaoshiRules;
  const SETTINGS_KEY = "hayaoshi.settings";
  const FAKE_SHOW_MS = 650;
  const RESULT_MS = 2000;
  const OVER_DELAY_MS = 1200;
  const KEY_FOR = { f: 0, j: 1 };

  const el = {
    setup: $("qSetup"), actions: $("qActions"), arena: $("arena"), info: $("arenaInfo"),
    mid: $("arenaButtons"), names: [$("qName0"), $("qName1")],
    pads: [$("pad0"), $("pad1")]
  };

  let settings = { target: 5, feints: true };
  let match = null;
  let round = { state: "idle", goAt: 0, timers: [], text: ["", ""] };

  /* ---------- timers ---------- */
  function clearTimers() {
    round.timers.forEach(clearTimeout);
    round = { ...round, timers: [] };
  }
  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    round = { ...round, timers: [...round.timers, id] };
  }
  function setRound(patch) {
    round = { ...round, ...patch };
    renderArena();
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    clearTimers();
    match = Q.newMatch(Duo.read(el.names), settings.target, settings.feints);
    el.arena.hidden = false;
    document.body.classList.add("arena-open");
    setRound({ state: "ready", text: ["かまえて！", "かまえて！"] });
    Fx.countdown("勝負！").then(() => { if (round.state === "ready") startRound(); });
  }
  function startRound() {
    clearTimers();
    const plan = Q.planRound(match.feints, Math.random(), Math.random(), Math.random());
    setRound({ state: "wait", text: ["まだ…", "まだ…"] });
    if (plan.fakeAt !== null) later(showFake, plan.fakeAt);
    later(go, plan.signalAt);
  }
  function showFake() {
    if (round.state !== "wait") return;
    Sound.sfx("wrong");
    setRound({ state: "fake", text: ["まだ！", "まだ！"] });
    later(() => { if (round.state === "fake") setRound({ state: "wait", text: ["まだ…", "まだ…"] }); }, FAKE_SHOW_MS);
  }
  function go() {
    if (round.state !== "wait") return;
    setRound({ state: "go", goAt: performance.now(), text: ["押せ！", "押せ！"] });
    Sound.sfx("go");
  }
  function press(player) {
    if (!["wait", "fake", "go"].includes(round.state)) return;
    const early = round.state !== "go";
    const ms = early ? null : Math.round(performance.now() - round.goAt);
    clearTimers();
    match = Q.award(match, player, early ? "foul" : "fast", ms);
    const other = 1 - player;
    const text = early
      ? (player === 0 ? ["フライング！", "ラッキー +1"] : ["ラッキー +1", "フライング！"])
      : (player === 0 ? [`+1　${(ms / 1000).toFixed(3)}秒`, "おそい！"] : ["おそい！", `+1　${(ms / 1000).toFixed(3)}秒`]);
    if (early) Sound.sfx("wrong"); else Sound.sfx("correct");
    setRound({ state: "result", text, scorer: early ? other : player });
    if (match.winner !== null) later(showOver, OVER_DELAY_MS);
    else later(startRound, RESULT_MS);
  }
  function showOver() {
    Sound.sfx("victory");
    Fx.confetti();
    const w = match.winner;
    const best = (i) => {
      const t = Q.bestTime(match, i);
      return t === null ? "" : `　最速 ${(t / 1000).toFixed(3)}秒`;
    };
    const text = [0, 1].map(i => (i === w ? "勝ち！" : "負け…") + best(i));
    setRound({ state: "over", text });
  }
  function quit() {
    clearTimers();
    setRound({ state: "idle" });
    el.arena.hidden = true;
    document.body.classList.remove("arena-open");
  }

  /* ---------- rendering ---------- */
  function renderArena() {
    el.arena.dataset.state = round.state;
    if (!match) return;
    el.pads.forEach((pad, i) => {
      pad.querySelector(".pad-name").textContent = match.names[i];
      pad.querySelector(".pad-msg").textContent = round.text[i] || "";
      pad.querySelector(".pad-score").textContent = `${match.scores[i]} / ${match.target}`;
      const lead = round.state === "result" ? round.scorer === i : round.state === "over" ? match.winner === i : false;
      pad.classList.toggle("lead", lead);
    });
    el.info.textContent = `${match.names[0]} ${match.scores[0]} - ${match.scores[1]} ${match.names[1]}　（${match.target}点先取${match.feints ? "・フェイントあり" : ""}）`;
    const buttons = round.state === "over"
      ? [makeButton("もう一回", start, "primary"), makeButton("やめる", quit, "small")]
      : [makeButton("やめる", quit, "small")];
    el.mid.replaceChildren(...buttons);
  }

  function renderSetup() {
    $("qTargetChips").replaceChildren(...Q.TARGET_OPTIONS.map(t => makeChip(`${t}点先取`, t === settings.target, () => update({ target: t }))));
    $("qFeintChips").replaceChildren(
      makeChip("あり", settings.feints, () => update({ feints: true })),
      makeChip("なし", !settings.feints, () => update({ feints: false }))
    );
    const lines = [
      "スマホを2人の間に平らに置く。画面の下半分が1人目、上半分が2人目",
      "「まだ…」の間は待つ。「押せ！」が出たら自分の側を先にタップした方が1点",
      "合図の前に押したらフライング。相手に1点",
      ...(settings.feints ? ["赤い「まだ！」はフェイント。つられて押すとフライング"] : []),
      `先に${settings.target}点取った方の勝ち`
    ];
    $("qRules").replaceChildren(...lines.map(t => { const li = document.createElement("li"); li.textContent = t; return li; }));
    el.actions.replaceChildren(makeButton("はじめる", start, "primary"));
  }
  function update(patch) {
    settings = { ...settings, ...patch };
    Store.save(SETTINGS_KEY, settings);
    renderSetup();
  }

  function init() {
    const s = Store.load(SETTINGS_KEY, {}) || {};
    settings = {
      target: Q.TARGET_OPTIONS.includes(s.target) ? s.target : 5,
      feints: typeof s.feints === "boolean" ? s.feints : true
    };
    Duo.fill(el.names);
    el.pads.forEach((pad, i) => {
      pad.addEventListener("pointerdown", (e) => { e.preventDefault(); press(i); });
      pad.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    document.addEventListener("keydown", (e) => {
      if (el.arena.hidden || e.repeat) return;
      if (e.key === "Escape") { quit(); return; }
      const p = KEY_FOR[e.key.toLowerCase()];
      if (p !== undefined) press(p);
    });
    renderSetup();
  }
  function onShow() {
    Duo.fill(el.names);
  }
  function leave() {
    if (!el.arena.hidden) quit();
  }

  return { init, onShow, leave };
})();

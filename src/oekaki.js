/* 20-second drawing game: random topic, timer with music, answer reveal. */
const Oekaki = (() => {
  const LEVELS = [
    { id: "kids", label: "こども", note: "形がかんたんなもの。小さい子といっしょに。" },
    { id: "easy", label: "かんたん", note: "身のまわりの物や動物、食べ物。" },
    { id: "normal", label: "ふつう", note: "場所、乗り物、行事、職業など。少し考える。" },
    { id: "hard", label: "むずかしい", note: "動作やあるある。どう描くかが勝負。" },
    { id: "oni", label: "激ムズ", note: "ことわざ、四字熟語、目に見えないもの。" },
    { id: "all", label: "ぜんぶ", note: "全部の難易度からランダム。" }
  ];
  const LEVEL_NAME = { kids: "こども", easy: "かんたん", normal: "ふつう", hard: "むずかしい", oni: "激ムズ", custom: "追加したお題" };
  const TIMES = [10, 20, 30, 60];
  const STORE_KEY = "oekaki20.settings";
  const CIRC = 2 * Math.PI * 52;
  const INTENSE_FROM = 5;
  const FALLBACK = { level: "all", seconds: 20, music: true, custom: "" };

  const panels = { ready: $("pReady"), topic: $("pTopic"), draw: $("pDraw"), end: $("pEnd"), answer: $("pAnswer") };
  const peek = $("peek");
  const customInput = $("customInput");

  let settings = FALLBACK;
  let state = { phase: "ready", topic: null, rounds: 0, used: new Set() };
  let timer = { raf: 0, endAt: 0, shown: null };

  function loadSettings() {
    const s = Store.load(STORE_KEY, {}) || {};
    return {
      level: LEVELS.some(l => l.id === s.level) ? s.level : FALLBACK.level,
      seconds: TIMES.includes(s.seconds) ? s.seconds : FALLBACK.seconds,
      music: typeof s.music === "boolean" ? s.music : FALLBACK.music,
      custom: typeof s.custom === "string" ? s.custom : FALLBACK.custom
    };
  }

  /* ---------- topics ---------- */
  function customTopics() {
    return settings.custom.split("\n").map(t => t.trim()).filter(Boolean);
  }
  function pool() {
    const ids = settings.level === "all" ? Object.keys(TOPICS) : [settings.level];
    const base = ids.flatMap(id => TOPICS[id].map(word => ({ word, level: id })));
    const extra = customTopics().map(word => ({ word, level: "custom" }));
    return [...base, ...extra];
  }
  function drawTopic() {
    const all = pool();
    let fresh = all.filter(t => !state.used.has(t.word) && t.word !== state.topic?.word);
    if (fresh.length === 0) {
      state = { ...state, used: new Set() };
      fresh = all.filter(t => t.word !== state.topic?.word);
    }
    const pick = fresh[Math.floor(Math.random() * fresh.length)] || all[0];
    state = { ...state, topic: pick, used: new Set([...state.used, pick.word]) };
  }

  /* ---------- timer ---------- */
  function setRing(fraction) {
    $("bar").style.strokeDasharray = CIRC;
    $("bar").style.strokeDashoffset = CIRC * (1 - fraction);
  }
  function tick() {
    const total = settings.seconds * 1000;
    const left = Math.max(0, timer.endAt - performance.now());
    const sec = Math.ceil(left / 1000);
    setRing(left / total);
    if (sec !== timer.shown) {
      timer = { ...timer, shown: sec };
      $("timerNum").textContent = sec;
      $("timer").classList.toggle("urgent", sec <= INTENSE_FROM && sec > 0);
      if (sec <= INTENSE_FROM) Music.intensify();
      if (sec <= 3 && sec > 0) Sound.beep(1175, 0.1, 0, "sine", 0.3);
    }
    if (left <= 0) { finish(); return; }
    timer = { ...timer, raf: requestAnimationFrame(tick) };
  }
  function startTimer() {
    Sound.ensure();
    Awake.keep();
    timer = { raf: 0, endAt: performance.now() + settings.seconds * 1000, shown: null };
    if (settings.music) Music.start(); else Sound.beep(660, 0.15);
    go("draw");
    tick();
  }
  function stopTimer() {
    cancelAnimationFrame(timer.raf);
    timer = { ...timer, raf: 0 };
    Music.stop();
    $("timer").classList.remove("urgent");
  }
  function finish() {
    stopTimer();
    Sound.buzz();
    go("end");
  }

  /* ---------- screens ---------- */
  function button(label, onClick, cls = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn " + cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
  const ACTIONS = {
    ready: () => [button("お題を引く", () => { Sound.ensure(); drawTopic(); go("topic"); }, "primary")],
    topic: () => [
      button("引き直す", () => { drawTopic(); go("topic"); }, "small"),
      button(`スタート（${settings.seconds}秒）`, startTimer, "primary")
    ],
    draw: () => [button("中断する", () => { stopTimer(); go("topic"); })],
    end: () => [button("答えを見る", () => { state = { ...state, rounds: state.rounds + 1 }; Sound.sfx("reveal"); go("answer"); Fx.pop($("answerText")); }, "primary")],
    answer: () => [button("次の人へ", () => go("ready"), "primary")]
  };

  function showWord(el, word) {
    el.textContent = word;
    el.classList.toggle("long", word.length >= 8);
  }
  function go(phase) {
    state = { ...state, phase };
    Object.entries(panels).forEach(([k, el]) => { el.hidden = k !== phase; });
    if (phase === "topic") {
      showWord($("topicText"), state.topic.word);
      $("topicTag").textContent = LEVEL_NAME[state.topic.level];
    }
    if (phase === "draw") {
      $("timerNum").textContent = settings.seconds;
      setRing(1);
      hidePeek();
    }
    if (phase === "answer") showWord($("answerText"), state.topic.word);
    if (phase === "ready") $("readyMsg").textContent = state.rounds > 0 ? "次の描く人だけ見てね" : "描く人だけ見てね";
    $("round").textContent = `${state.rounds}問おわり`;
    $("actions").replaceChildren(...ACTIONS[phase]());
    const locked = phase === "draw";
    document.querySelectorAll("#modeOekaki .chip").forEach(c => { c.disabled = locked; });
  }

  /* ---------- settings UI ---------- */
  function chip(label, on, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.disabled = state.phase === "draw";
    b.addEventListener("click", onClick);
    return b;
  }
  function renderChips() {
    $("levelChips").replaceChildren(...LEVELS.map(l => chip(l.label, settings.level === l.id, () => update({ level: l.id }))));
    $("timeChips").replaceChildren(...TIMES.map(t => chip(`${t}秒`, settings.seconds === t, () => update({ seconds: t }))));
    $("musicChips").replaceChildren(
      chip("あり", settings.music, () => update({ music: true })),
      chip("なし", !settings.music, () => update({ music: false }))
    );
    const level = LEVELS.find(l => l.id === settings.level);
    $("levelNote").textContent = `${level.note}（${pool().length}個）`;
  }
  function update(patch) {
    settings = { ...settings, ...patch };
    Store.save(STORE_KEY, settings);
    renderChips();
    if ("level" in patch && state.phase === "topic") drawTopic();
    if (state.phase !== "draw") go(state.phase);
  }

  /* ---------- peek (hold to see the topic while drawing) ---------- */
  function showPeek() { peek.textContent = state.topic ? state.topic.word : ""; peek.classList.add("on"); }
  function hidePeek() { peek.textContent = "長押しでお題を確認"; peek.classList.remove("on"); }

  function renderCustomCount() {
    const n = customTopics().length;
    $("customCount").textContent = n ? `いま${n}個` : "";
  }

  function init() {
    settings = loadSettings();
    peek.addEventListener("pointerdown", (e) => { e.preventDefault(); showPeek(); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => peek.addEventListener(ev, hidePeek));
    peek.addEventListener("contextmenu", (e) => e.preventDefault());
    peek.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); showPeek(); } });
    peek.addEventListener("keyup", hidePeek);

    customInput.value = settings.custom;
    customInput.addEventListener("input", () => {
      settings = { ...settings, custom: customInput.value };
      Store.save(STORE_KEY, settings);
      renderCustomCount();
      renderChips();
    });

    renderChips();
    renderCustomCount();
    go("ready");
  }

  /* Called when the player switches to another game mid-round. */
  function leave() {
    if (state.phase === "draw") { stopTimer(); go("topic"); }
  }

  return { init, leave };
})();

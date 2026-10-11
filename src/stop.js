/* Stop-at-10 screen: a stopwatch that hides itself; closest to the target wins. */
const Stop = (() => {
  const T = StopRules;
  const KEY = "stop.settings";
  const RATINGS = [
    { within: 30, title: "ぴったり！！", sfx: "victory", confetti: true },
    { within: 150, title: "おしい！", sfx: "correct" },
    { within: 500, title: "なかなか！", sfx: "pop" },
    { within: Infinity, title: "ざんねん…", sfx: "lose" }
  ];

  const el = {
    setup: $("tSetup"), play: $("tPlay"), label: $("tLabel"), title: $("tTitle"),
    display: $("tDisplay"), card: null, list: $("tList"), hint: $("tHint"), actions: $("tActions")
  };

  let settings = { players: 3, target: 10, hide: true };
  let game = null;
  let ui = { phase: "setup" };
  let watch = { start: 0, raf: 0 };

  const S = (i) => View.seat(i);
  const secText = (ms) => (ms / 1000).toFixed(2);
  const diffText = (d) => `${d >= 0 ? "+" : "−"}${(Math.abs(d) / 1000).toFixed(2)}秒`;
  const rating = (diff) => RATINGS.find(r => Math.abs(diff) <= r.within);

  function update(patch) {
    settings = { ...settings, ...patch };
    Store.save(KEY, settings);
    render();
  }
  function go(phase) {
    ui = { phase };
    render();
  }

  /* ---------- flow ---------- */
  function newGame() {
    Sound.ensure();
    Awake.keep();
    game = T.newGame(settings.players, settings.target);
    Sound.sfx("confirm");
    go("turn");
  }
  function startWatch() {
    if (ui.phase !== "turn") return;
    watch = { start: performance.now(), raf: 0 };
    Sound.sfx("go");
    go("running");
    frame();
  }
  function frame() {
    const ms = performance.now() - watch.start;
    const hidden = settings.hide && ms >= T.HIDE_AFTER_MS;
    el.display.textContent = hidden ? "?.??" : secText(ms);
    el.display.classList.toggle("masked", hidden);
    watch = { ...watch, raf: requestAnimationFrame(frame) };
  }
  function stopWatch() {
    if (ui.phase !== "running") return;
    const ms = performance.now() - watch.start;
    cancelAnimationFrame(watch.raf);
    game = T.record(game, ms);
    const last = game.results[game.results.length - 1];
    const r = rating(last.diff);
    Sound.sfx(r.sfx);
    if (r.confetti) Fx.confetti();
    go("result");
    Fx.pop(el.display);
  }
  function next() {
    if (T.finished(game)) {
      Sound.sfx("reveal");
      go("ranking");
      if (game.players > 1) setTimeout(() => { Sound.sfx("victory"); Fx.confetti(); }, 700);
    } else {
      Sound.sfx("whoosh");
      go("turn");
    }
  }

  /* ---------- screens ---------- */
  function bigButton(label, handler, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn primary big-press ${cls}`;
    b.textContent = label;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); handler(); });
    b.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); handler(); } });
    return b;
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", newGame, "primary")] }),
    turn: () => ({
      label: `${T.currentSeat(game) + 1} / ${game.players}人目`,
      title: `${S(T.currentSeat(game))}さんの番`,
      hint: `ぴったり${game.target}秒で止めよう。${settings.hide ? `数字は${T.HIDE_AFTER_MS / 1000}秒で消えます。` : ""}`,
      actions: [bigButton("スタート", startWatch, "")]
    }),
    running: () => ({
      label: `${S(T.currentSeat(game))}さん`,
      title: "",
      hint: "心の中で数えて…",
      actions: [bigButton("ストップ！", stopWatch, "danger")]
    }),
    result: () => {
      const last = game.results[game.results.length - 1];
      return {
        label: `${S(last.seat)}さんの記録`,
        title: rating(last.diff).title,
        hint: `目標${game.target}秒から ${diffText(last.diff)}`,
        actions: [makeButton(T.finished(game) ? "結果発表" : `${S(T.currentSeat(game))}さんへ`, next, "primary")]
      };
    },
    ranking: () => {
      const top = T.ranking(game)[0];
      return {
        label: "結果発表",
        title: game.players > 1 ? `${S(top.seat)}さんの優勝！` : rating(top.diff).title,
        hint: "",
        actions: [makeButton("設定", () => go("setup"), "small"), makeButton("もう一回", newGame, "primary")]
      };
    }
  };

  function renderDisplay() {
    const show = ["turn", "running", "result"].includes(ui.phase);
    el.display.hidden = !show;
    if (!show) return;
    if (ui.phase === "turn") {
      el.display.textContent = "0.00";
      el.display.classList.remove("masked");
    }
    if (ui.phase === "result") {
      el.display.textContent = secText(game.results[game.results.length - 1].ms);
      el.display.classList.remove("masked");
    }
  }
  function renderList() {
    const show = ui.phase === "ranking";
    el.list.hidden = !show;
    if (!show) return;
    el.list.replaceChildren(...T.ranking(game).map(r => {
      const li = document.createElement("li");
      li.className = r.rank === 1 ? "ok" : "";
      li.innerHTML = `<span class="pos">${r.rank}位</span><span class="who"></span><b class="num">${secText(r.ms)}</b><span class="mark">${diffText(r.diff)}</span>`;
      li.querySelector(".who").textContent = `${S(r.seat)}さん`;
      return li;
    }));
  }
  function renderSetup() {
    View.chips($("tPlayerChips"), View.options(Array.from({ length: T.PLAYERS.max }, (_, i) => i + 1), n => `${n}人`), settings.players, n => update({ players: n }));
    View.chips($("tTargetChips"), View.options(T.TARGETS, n => `${n}秒`), settings.target, n => update({ target: n }));
    View.chips($("tHideChips"), [{ value: true, label: "途中で消える" }, { value: false, label: "ずっと見える" }], settings.hide, v => update({ hide: v }));
    View.list($("tRules"), [
      "1人ずつ、スタートを押して心の中で数える",
      `ぴったり${settings.target}秒だと思ったらストップ`,
      settings.hide ? `画面の数字は${T.HIDE_AFTER_MS / 1000}秒で消える` : "画面の数字はずっと見える（練習向け）",
      "全員終わったら、目標にいちばん近い人の優勝"
    ]);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase !== "setup") {
      renderDisplay();
      renderList();
    }
  }

  function init() {
    const s = Store.load(KEY, {}) || {};
    settings = {
      players: Number.isInteger(s.players) && s.players >= T.PLAYERS.min && s.players <= T.PLAYERS.max ? s.players : 3,
      target: T.TARGETS.includes(s.target) ? s.target : 10,
      hide: typeof s.hide === "boolean" ? s.hide : true
    };
    render();
  }
  function leave() {
    if (ui.phase === "running") {
      cancelAnimationFrame(watch.raf);
      go("turn");
    }
  }

  return { init, leave };
})();

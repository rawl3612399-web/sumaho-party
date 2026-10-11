/* Bomb game screen: answer the prompt and pass the phone before the hidden fuse runs out. */
const Bomb = (() => {
  const B = BombRules;
  const KEY = "bomb.settings";

  const el = {
    setup: $("bSetup"), play: $("bPlay"), label: $("bLabel"), title: $("bTitle"),
    card: $("bCard"), bomb: $("bBomb"), hint: $("bHint"), actions: $("bActions")
  };

  let settings = { fuse: "normal", kind: "mix" };
  let ui = { phase: "setup" };
  let prompt = null;
  let fuse = { start: 0, end: 0, passes: 0, alt: false, timer: 0 };

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
  function arm() {
    Sound.ensure();
    Awake.keep();
    clearTimeout(fuse.timer);
    prompt = B.makePrompt(settings.kind);
    const t = performance.now();
    fuse = { start: t, end: t + B.fuseMs(settings.fuse), passes: 0, alt: false, timer: 0 };
    Sound.sfx("confirm");
    go("armed");
    Fx.pop(el.card);
    tick();
  }
  function tick() {
    const t = performance.now();
    if (t >= fuse.end) { explode(); return; }
    const progress = (t - fuse.start) / (fuse.end - fuse.start);
    Sound.sfx("tick", fuse.alt);
    el.bomb.style.setProperty("--heat", progress.toFixed(3));
    Fx.replay(el.bomb, "beat");
    const wait = Math.min(B.tickInterval(progress), fuse.end - t);
    fuse = { ...fuse, alt: !fuse.alt, timer: setTimeout(tick, wait) };
  }
  function pass() {
    fuse = { ...fuse, passes: fuse.passes + 1 };
    Sound.sfx("whoosh");
    render();
  }
  function changePrompt() {
    prompt = B.makePrompt(settings.kind);
    Sound.sfx("flip");
    render();
    Fx.pop(el.card);
  }
  function explode() {
    clearTimeout(fuse.timer);
    Sound.sfx("boom");
    Fx.flash("--alert", 700);
    Fx.shake();
    go("boom");
  }

  /* ---------- screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("点火！", arm, "primary danger")] }),
    armed: () => ({
      label: fuse.passes ? `${fuse.passes}回つながった` : "お題",
      title: "",
      card: { main: prompt.text, cls: prompt.kind === "kana" ? "kana" : "" },
      hint: "1つ答えたら、すぐ次の人に渡そう。同じ答えはダメ！",
      actions: [makeButton("お題を変える", changePrompt, "small"), makeButton("答えた！ 次の人へ", pass, "primary")]
    }),
    boom: () => ({
      label: "",
      title: "ドカーン！",
      card: { main: "持っていた人の負け", sub: `お題「${prompt.text}」・${fuse.passes}回つながった` , cls: "boom" },
      hint: "",
      actions: [makeButton("設定", () => go("setup"), "small"), makeButton("次のお題で点火", arm, "primary danger")]
    })
  };

  function renderSetup() {
    View.chips($("bFuseChips"), Object.entries(B.FUSES).map(([value, f]) => ({ value, label: f.label })), settings.fuse, v => update({ fuse: v }));
    View.chips($("bKindChips"), Object.entries(B.KINDS).map(([value, label]) => ({ value, label })), settings.kind, v => update({ kind: v }));
    const f = B.FUSES[settings.fuse];
    View.list($("bRules"), [
      "点火するとお題が出る。持っている人がお題に合う言葉を1つ言って、次の人へ渡す",
      `爆弾は${Math.round(f.min / 1000)}〜${Math.round(f.max / 1000)}秒のどこかで爆発。いつかは誰にも分からない`,
      "カチカチ音がだんだん速くなる",
      "爆発したとき持っていた人の負け。答えに詰まったら、それまで！"
    ]);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    el.bomb.hidden = ui.phase !== "armed";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
  }

  function init() {
    const s = Store.load(KEY, {}) || {};
    settings = {
      fuse: B.FUSES[s.fuse] ? s.fuse : "normal",
      kind: B.KINDS[s.kind] ? s.kind : "mix"
    };
    render();
  }
  function leave() {
    if (ui.phase === "armed") {
      clearTimeout(fuse.timer);
      go("setup");
    }
  }

  return { init, leave };
})();

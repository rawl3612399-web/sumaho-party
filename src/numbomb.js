/* Number bomb screen: call numbers inside the shrinking range; whoever hits the bomb loses. */
const NumBomb = (() => {
  const N = NumBombRules;
  const KEY = "numbomb.settings";
  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  const URGENT_LEFT = 10;

  const el = {
    setup: $("nSetup"), play: $("nPlay"), label: $("nLabel"), title: $("nTitle"),
    range: $("nRange"), card: $("nCard"), slots: $("nSlots"), keypad: $("nKeypad"),
    history: $("nHistory"), hint: $("nHint"), actions: $("nActions")
  };

  let settings = { max: 100 };
  let game = null;
  let ui = { phase: "setup", entry: "", error: "" };
  const keys = new Map();

  const left = () => game.high - game.low + 1;
  const maxDigits = () => String(game.max).length;

  function go(patch) {
    ui = { ...ui, ...patch };
    render();
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    game = N.newGame(settings.max);
    Sound.sfx("confirm");
    Music.play("tension");
    go({ phase: "play", entry: "", error: "" });
  }
  function press(k) {
    if (ui.phase !== "play" || ui.entry.length >= maxDigits()) return;
    if (ui.entry === "" && k === "0") return;
    Sound.beep(440 + Number(k) * 40, 0.05, 0, "triangle", 0.15);
    go({ entry: ui.entry + k, error: "" });
  }
  function backspace() {
    go({ entry: ui.entry.slice(0, -1), error: "" });
  }
  function call() {
    const n = Number(ui.entry);
    const err = N.callError(game, n);
    if (err) {
      Sound.sfx("wrong");
      go({ error: err, entry: "" });
      return;
    }
    game = N.call(game, n);
    if (game.exploded) {
      Music.stop();
      Sound.sfx("boom");
      Fx.flash("--alert", 700);
      Fx.shake();
      go({ phase: "boom", entry: "" });
      return;
    }
    if (left() <= URGENT_LEFT) Music.intensify();
    Sound.sfx(N.cornered(game) ? "heartbeat" : "pop");
    go({ entry: "", error: "" });
    Fx.pop(el.range);
  }

  /* ---------- screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary danger")] }),
    play: () => ({
      label: `残り${left()}個`,
      title: "",
      hint: ui.error || (N.cornered(game) ? "もう爆弾しか残っていない…！" : "順番に、範囲の中の数字を1つ言おう"),
      actions: [
        makeButton("消す", backspace, "small", ui.entry.length === 0),
        makeButton(ui.entry ? `${ui.entry}をコール` : "数字を入れてね", call, "primary", ui.entry.length === 0)
      ]
    }),
    boom: () => ({
      label: "",
      title: "ドカーン！",
      card: { main: String(game.secret), sub: "を言った人の負け", cls: "boom" },
      hint: "",
      actions: [makeButton("設定", () => go({ phase: "setup" }), "small"), makeButton("もう一回", start, "primary danger")]
    })
  };

  function renderPlay() {
    const playing = ui.phase === "play";
    el.range.hidden = !playing;
    el.slots.hidden = !playing;
    el.keypad.hidden = !playing;
    el.history.hidden = !game || game.calls.length === 0;
    if (game) el.history.textContent = `コール：${game.calls.map(c => c.n).join(" → ")}`;
    if (!playing) return;
    el.range.textContent = `${game.low} 〜 ${game.high}`;
    el.range.classList.toggle("urgent", left() <= URGENT_LEFT);
    el.slots.replaceChildren(...Array.from({ length: maxDigits() }, (_, i) => {
      const s = document.createElement("span");
      s.className = "slot" + (i === ui.entry.length ? " cur" : "");
      s.textContent = ui.entry[i] || "";
      return s;
    }));
    keys.forEach((b, k) => { b.disabled = ui.entry.length >= maxDigits() || (ui.entry === "" && k === "0"); });
  }
  function renderSetup() {
    View.chips($("nMaxChips"), View.options(N.MAXES, n => `1〜${n}`), settings.max, n => {
      settings = { max: n };
      Store.save(KEY, settings);
      render();
    });
    View.list($("nRules"), [
      `1〜${settings.max}のどこかに、爆弾の数字が1つかくれている`,
      "順番に、残っている範囲の中から数字を1つコールする",
      "爆弾より小さければ下が、大きければ上がせまくなる",
      "爆弾の数字を言った人の負け。追いつめられる前に、うまく範囲を削ろう"
    ]);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase !== "setup") renderPlay();
  }

  function init() {
    const s = Store.load(KEY, {}) || {};
    settings = { max: N.MAXES.includes(s.max) ? s.max : 100 };
    KEYS.forEach(k => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key";
      b.textContent = k;
      b.addEventListener("click", () => press(k));
      keys.set(k, b);
      el.keypad.appendChild(b);
    });
    render();
  }
  function leave() {
    if (ui.phase === "play") Music.stop();
  }

  return { init, leave };
})();

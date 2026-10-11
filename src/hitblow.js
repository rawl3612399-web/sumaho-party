/* Hit & Blow screen: each player hides a number, then they take turns guessing on one phone. */
const HitBlow = (() => {
  const H = HitBlowRules;
  const SETTINGS_KEY = "hitblow.settings";
  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

  const el = {
    setup: $("hSetup"), play: $("hPlay"), title: $("hTitle"), hint: $("hHint"),
    slots: $("hSlots"), keypad: $("hKeypad"), logs: $("hLogs"), actions: $("hActions"),
    names: [$("hName0"), $("hName1")]
  };

  let settings = { digits: 3 };
  let game = null;
  let ui = { phase: "setup", entry: "", secretFor: 0 };
  const keys = new Map();

  function setUi(patch) {
    ui = { ...ui, ...patch };
    if (ui.phase === "turn") Music.play("think");
    if (["over", "setup"].includes(ui.phase)) Music.stop();
    render();
  }
  const name = (i) => game.names[i];

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    game = H.newGame(Duo.read(el.names), settings.digits, Math.random() < 0.5 ? 0 : 1);
    setUi({ phase: "secret", entry: "", secretFor: 0 });
  }
  function press(key) {
    if (!["secret", "turn"].includes(ui.phase)) return;
    if (ui.entry.length >= game.digits || ui.entry.includes(key)) return;
    Sound.beep(440 + Number(key) * 40, 0.05, 0, "triangle", 0.18);
    setUi({ entry: ui.entry + key });
  }
  function backspace() {
    setUi({ entry: ui.entry.slice(0, -1) });
  }
  function confirmSecret() {
    game = H.setSecret(game, ui.secretFor, ui.entry);
    if (ui.secretFor === 0) setUi({ phase: "pass", entry: "" });
    else setUi({ phase: "ready", entry: "" });
  }
  function call() {
    game = H.guess(game, ui.entry);
    const l = game.last;
    if (game.outcome) {
      setUi({ phase: "over", entry: "" });
      Sound.sfx(game.outcome.winner === null ? "fanfare" : "victory");
      if (game.outcome.winner !== null) Fx.confetti();
      return;
    }
    if (l.hit === game.digits) Sound.sfx("correct");
    else if (l.hit > 0) Sound.sfx("coin");
    else if (l.blow > 0) Sound.sfx("pop");
    else Sound.sfx("wrong");
    setUi({ phase: "turn", entry: "" });
  }

  /* ---------- text ---------- */
  const resultText = (r) => (r.hit === game.digits ? "正解！" : `${r.hit}ヒット ${r.blow}ブロー`);

  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    secret: () => ({
      title: `${name(ui.secretFor)}さん、秘密の${game.digits}けたを決めて`,
      hint: `${name(1 - ui.secretFor)}さんは見ないでね。同じ数字は使えません。`,
      keypad: true,
      actions: [
        makeButton("消す", backspace, "small", ui.entry.length === 0),
        makeButton("この数字に決める", confirmSecret, "primary", ui.entry.length !== game.digits)
      ]
    }),
    pass: () => ({
      title: `${name(1)}さんに渡してね`,
      hint: `${name(0)}さんの数字は隠れました。`,
      actions: [makeButton(`${name(1)}です、受け取った`, () => setUi({ phase: "secret", secretFor: 1 }), "primary")]
    }),
    ready: () => ({
      title: `準備OK！ 先攻は${name(game.first)}さん`,
      hint: "ここからは2人で画面を見てOK。交代で相手の数字を予想します。",
      actions: [makeButton("スタート", () => setUi({ phase: "turn" }), "primary")]
    }),
    turn: () => {
      const g = H.guesser(game);
      const l = game.last;
      const lastLine = l ? `${name(l.player)}さん：${l.code} → ${resultText(l)}。` : "";
      const chance = H.lastChance(game) ? `${name(game.first)}さんが当てました！ 当てれば引き分け。` : "";
      return {
        title: `${name(g)}さんの番`,
        hint: chance || lastLine || `${name(1 - g)}さんの数字を予想して入力`,
        keypad: true,
        actions: [
          makeButton("消す", backspace, "small", ui.entry.length === 0),
          makeButton(ui.entry.length === game.digits ? `${ui.entry}でコール` : "数字を入れてね", call, "primary", ui.entry.length !== game.digits)
        ]
      };
    },
    over: () => {
      const o = game.outcome;
      return {
        title: o.winner === null ? "引き分け！" : `${name(o.winner)}さんの勝ち！`,
        hint: `${name(0)}さんの数字は${game.secrets[0]}、${name(1)}さんの数字は${game.secrets[1]}。${o.guesses}回目で決着。`,
        actions: [makeButton("設定を変える", () => setUi({ phase: "setup" }), "small"), makeButton("もう一回", start, "primary")]
      };
    }
  };

  /* ---------- rendering ---------- */
  function renderSetup() {
    $("hDigitChips").replaceChildren(...H.DIGIT_OPTIONS.map(d => makeChip(`${d}けた`, d === settings.digits, () => {
      settings = { ...settings, digits: d };
      Store.save(SETTINGS_KEY, settings);
      renderSetup();
    })));
    const lines = [
      `それぞれ、同じ数字を使わない${settings.digits}けたの数字をこっそり決める（例：${settings.digits === 3 ? "382" : "3820"}）`,
      "交代で相手の数字を予想してコールする",
      "ヒット＝数字も場所も合っている。ブロー＝数字は合っているが場所が違う",
      "先に全部ヒットした方の勝ち。後攻にも同じ回数のチャンスがあり、両方当てたら引き分け"
    ];
    $("hRules").replaceChildren(...lines.map(t => { const li = document.createElement("li"); li.textContent = t; return li; }));
  }

  function renderSlots(show) {
    const cells = Array.from({ length: game.digits }, (_, i) => {
      const s = document.createElement("span");
      s.className = "slot" + (i === ui.entry.length ? " cur" : "");
      s.textContent = show ? (ui.entry[i] || "") : "";
      return s;
    });
    el.slots.replaceChildren(...cells);
    el.slots.hidden = !show;
  }

  function renderKeypad(active) {
    el.keypad.hidden = !active;
    keys.forEach((b, k) => {
      b.disabled = !active || ui.entry.includes(k) || ui.entry.length >= game.digits;
    });
  }

  function renderLogs() {
    const show = ["turn", "over"].includes(ui.phase);
    el.logs.hidden = !show;
    if (!show) return;
    const g = H.guesser(game);
    const cols = [0, 1].map(i => {
      const col = document.createElement("div");
      col.className = "hb-col" + (ui.phase === "turn" && g === i ? " active" : "");
      const head = document.createElement("div");
      head.className = "hb-head";
      head.textContent = `${name(i)}の予想`;
      const rows = game.history[i].map(r => {
        const row = document.createElement("div");
        row.className = "hb-row" + (r.hit === game.digits ? " solved" : "");
        row.innerHTML = `<span class="hb-code"></span><span class="hb-res"><b class="h">${r.hit}</b>H <b class="b">${r.blow}</b>B</span>`;
        row.querySelector(".hb-code").textContent = r.code;
        return row;
      }).reverse();
      col.replaceChildren(head, ...rows);
      return col;
    });
    el.logs.replaceChildren(...cols);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    const screen = SCREENS[ui.phase]();
    if (ui.phase === "setup") {
      renderSetup();
    } else {
      el.title.textContent = screen.title;
      el.hint.textContent = screen.hint;
      renderSlots(Boolean(screen.keypad));
      renderKeypad(Boolean(screen.keypad));
      renderLogs();
    }
    el.actions.replaceChildren(...screen.actions);
  }

  function buildKeypad() {
    KEYS.forEach(k => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key";
      b.textContent = k;
      b.addEventListener("click", () => press(k));
      keys.set(k, b);
      el.keypad.appendChild(b);
    });
  }

  function init() {
    const s = Store.load(SETTINGS_KEY, {}) || {};
    settings = { digits: H.DIGIT_OPTIONS.includes(s.digits) ? s.digits : 3 };
    Duo.fill(el.names);
    buildKeypad();
    render();
  }
  function onShow() {
    if (ui.phase === "setup") Duo.fill(el.names);
  }

  return { init, onShow };
})();

/* Electric chair game screen: pass one phone between two players. */
const Denki = (() => {
  const R = DenkiRules;
  const SETTINGS_KEY = "denki.settings";
  const LEGACY_CHAIRS_KEY = "denki.chairs";
  const BEST_OF = [{ n: 1, label: "1回勝負" }, { n: 3, label: "3本勝負" }, { n: 5, label: "5本勝負" }];
  const DEFAULTS = Object.freeze({ chairs: R.RULES.defaultChairs, bonus: true, bestOf: 3 });
  const SUSPENSE_MS = 1800;
  const ZAP_MS = 1300;
  const HISTORY_SHOWN = 8;

  const el = {
    setup: $("dSetup"), play: $("dPlay"), scores: $("scores"),
    ring: $("ring"), center: $("ringCenter"), title: $("dTitle"), hint: $("dHint"), history: $("dHistory"),
    actions: $("dActions"), names: [$("p1Name"), $("p2Name")]
  };

  let settings = DEFAULTS;
  let match = null;
  let game = null;
  let ui = { phase: "setup", selected: null };
  let chairs = new Map();

  const names = () => game.names;
  const att = () => names()[R.attacker(game)];
  const def = () => names()[R.defender(game)];
  const isMatch = () => match && match.bestOf > 1;

  /* ---------- settings ---------- */
  function validChairs(n) {
    return Number.isInteger(n) && n >= R.RULES.minChairs && n <= R.RULES.maxChairs;
  }
  function loadSettings() {
    const s = Store.load(SETTINGS_KEY, {}) || {};
    const legacyChairs = Store.load(LEGACY_CHAIRS_KEY, null);
    const chairsPick = validChairs(s.chairs) ? s.chairs : validChairs(legacyChairs) ? legacyChairs : DEFAULTS.chairs;
    return {
      chairs: chairsPick,
      bonus: typeof s.bonus === "boolean" ? s.bonus : DEFAULTS.bonus,
      bestOf: BEST_OF.some(b => b.n === s.bestOf) ? s.bestOf : DEFAULTS.bestOf
    };
  }
  function updateSettings(patch) {
    settings = { ...settings, ...patch };
    Store.save(SETTINGS_KEY, settings);
    renderSetup();
  }

  /* ---------- game flow ---------- */
  function newSetGame(playerNames, first) {
    const bonus = settings.bonus ? 1 + Math.floor(Math.random() * settings.chairs) : null;
    game = R.newGame(playerNames, first, settings.chairs, { bonus });
    buildRing(game.chairs);
  }
  function startMatch() {
    Sound.ensure();
    Awake.keep();
    match = R.newMatch(settings.bestOf);
    newSetGame(Duo.read(el.names), Math.random() < 0.5 ? 0 : 1);
    setUi("intro");
  }
  function setUi(phase, selected = null) {
    ui = { phase, selected };
    if (["intro", "set", "pass", "sit"].includes(phase)) Music.play("tension");
    if (["reveal", "setup", "over"].includes(phase)) Music.stop();
    render();
  }
  function onChair(n) {
    if (!["set", "sit"].includes(ui.phase) || !game.remaining.includes(n)) return;
    Sound.beep(520 + n * 20, 0.06, 0, "triangle", 0.2);
    setUi(ui.phase, n);
  }
  function confirmTrap() {
    game = R.setTrap(game, ui.selected);
    setUi("pass");
  }
  function confirmSit() {
    game = R.sit(game, ui.selected);
    setUi("reveal");
    Sound.drumroll(SUSPENSE_MS / 1000);
    setTimeout(revealResult, SUSPENSE_MS);
  }
  function revealResult() {
    if (ui.phase !== "reveal") return;
    if (game.last.hit) {
      Sound.zap();
      Fx.flash("--zap", 500);
      document.body.classList.add("zapping");
      setTimeout(() => document.body.classList.remove("zapping"), ZAP_MS);
    } else {
      Sound.chime();
    }
    setUi("result");
  }
  function nextTurn() {
    game = R.nextTurn(game);
    setUi("set");
  }
  function finishSet() {
    match = R.recordGame(match, game.outcome);
    const done = !isMatch() || R.matchWinner(match) !== null;
    if (done && game.outcome.winner !== null) { Sound.sfx("victory"); Fx.confetti(); } else Sound.sfx("fanfare");
    setUi("over");
  }
  function nextSet() {
    newSetGame(game.names, 1 - game.first);
    setUi("intro");
  }
  function rematch() {
    match = R.newMatch(settings.bestOf);
    newSetGame(game.names, 1 - game.first);
    setUi("intro");
  }

  /* ---------- text for each screen ---------- */
  function rulesLine(g) {
    const bonus = g.bonus ? `　★${g.bonus}番は点数${R.RULES.bonusMultiplier}倍` : "";
    return `${g.target}点で勝ち・${g.maxShocks}回シビれたら負け${bonus}`;
  }
  function setLabel() {
    return isMatch() ? `第${match.played + 1}セット　` : "";
  }
  function outcomeText() {
    const o = game.outcome;
    const reasons = {
      target: () => `${game.target}点に届きました（${game.scores[o.winner]}点）。`,
      shocks: () => `${names()[1 - o.winner]}さんが${game.maxShocks}回シビれました。`,
      lastChair: () => o.winner === null
        ? `イスが残り1脚。${game.scores[0]}点で同点です。`
        : `イスが残り1脚。${game.scores[o.winner]}点 対 ${game.scores[1 - o.winner]}点。`
    };
    const reason = reasons[o.reason]();
    const champion = R.matchWinner(match);
    if (!isMatch()) {
      return { title: o.winner === null ? "引き分け！" : `${names()[o.winner]}さんの勝ち！`, hint: reason, done: true };
    }
    const tally = `セット ${match.wins[0]}-${match.wins[1]}`;
    if (champion !== null) {
      return { title: `${names()[champion]}さんの優勝！`, hint: `${reason}　${tally}`, done: true };
    }
    const setTitle = o.winner === null ? "このセットは引き分け" : `${names()[o.winner]}さんがセットを取った！`;
    return { title: setTitle, hint: `${reason}　${tally}（${match.need}セット先取）`, done: false };
  }

  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", startMatch, "primary")] }),
    intro: () => ({
      title: `${setLabel()}先に仕掛けるのは${att()}さん`,
      hint: `${rulesLine(game)}。${def()}さんは画面を見ないでね。`,
      center: game.bonus ? `★${game.bonus}番が2倍` : "電気イス",
      actions: [makeButton(`${att()}さんが仕掛ける`, () => setUi("set"), "primary")]
    }),
    set: () => ({
      title: `${att()}さん、電流を仕掛けるイスを選んで`,
      hint: `${def()}さんは見ないでね`,
      center: ui.selected ? `${ui.selected}番` : "仕掛ける",
      actions: [makeButton(ui.selected ? `${ui.selected}番に仕掛ける` : "イスを選んでね", confirmTrap, "primary", !ui.selected)]
    }),
    pass: () => ({
      title: `${def()}さんに渡してね`,
      hint: "仕掛けたイスは画面から消えています",
      center: "？",
      actions: [makeButton(`${def()}です、受け取った`, () => setUi("sit"), "primary")]
    }),
    sit: () => {
      const d = R.defender(game);
      const need = game.target - game.scores[d];
      return {
        title: `${def()}さん、座るイスを選んで`,
        hint: `あと${need}点で勝ち。シビれたら0点に戻ります。${att()}さんの顔をよく見て。`,
        center: ui.selected ? `${ui.selected}番` : "座る",
        actions: [makeButton(ui.selected ? `${ui.selected}番に座る` : "イスを選んでね", confirmSit, "primary danger", !ui.selected)]
      };
    },
    reveal: () => ({
      title: `${def()}さんが${game.last.chair}番に座った…`,
      hint: "",
      center: "……",
      actions: []
    }),
    result: () => {
      const l = game.last;
      const next = game.outcome
        ? makeButton("結果を見る", finishSet, "primary")
        : makeButton(`次へ（${def()}さんが仕掛ける）`, nextTurn, "primary");
      if (l.hit) {
        return {
          title: `ビリビリ！ ${def()}さんは0点に`,
          hint: `${l.lost > 0 ? `${l.lost}点を失いました。` : ""}シビれ${game.shocks[l.player]}回目（${game.maxShocks}回で負け）。${l.chair}番のイスは残ります。`,
          center: "ビリビリ!",
          actions: [next]
        };
      }
      const bonus = l.chair === game.bonus ? "（ボーナス2倍）" : "";
      return {
        title: `セーフ！ ${def()}さんに+${l.gained}点${bonus}`,
        hint: `電流は${l.trap}番でした。`,
        center: `+${l.gained}`,
        actions: [next]
      };
    },
    over: () => {
      const text = outcomeText();
      const actions = text.done
        ? [makeButton("設定を変える", () => setUi("setup"), "small"), makeButton("もう一回", rematch, "primary")]
        : [makeButton("次のセットへ", nextSet, "primary")];
      return { title: text.title, hint: text.hint, center: text.done ? "勝負あり" : "セット終了", actions };
    }
  };

  /* ---------- rendering ---------- */
  function renderSetup() {
    const counts = Array.from({ length: R.RULES.maxChairs - R.RULES.minChairs + 1 }, (_, i) => R.RULES.minChairs + i);
    $("chairChips").replaceChildren(...counts.map(n => makeChip(`${n}脚`, n === settings.chairs, () => updateSettings({ chairs: n }))));
    $("bonusChips").replaceChildren(
      makeChip("あり", settings.bonus, () => updateSettings({ bonus: true })),
      makeChip("なし", !settings.bonus, () => updateSettings({ bonus: false }))
    );
    $("bestOfChips").replaceChildren(...BEST_OF.map(b => makeChip(b.label, b.n === settings.bestOf, () => updateSettings({ bestOf: b.n }))));

    const c = R.configFor(settings.chairs);
    const lines = [
      `イスは1〜${settings.chairs}番の${settings.chairs}脚。スマホ1台を2人で回します`,
      "仕掛ける人がこっそり1脚に電流を仕掛け、座る人が1脚選ぶ",
      "セーフならイスの番号が点数に。そのイスはなくなる",
      "電流に当たると点数が0点に戻る。イスは残る",
      `先に${c.target}点で勝ち。${c.maxShocks}回シビれたら負け`,
      "イスが残り1脚になったら、点数が多い方の勝ち",
      ...(settings.bonus ? [`毎セット1脚が★ボーナスイス。座れたら点数${R.RULES.bonusMultiplier}倍`] : []),
      ...(settings.bestOf > 1 ? [`${Math.ceil(settings.bestOf / 2)}セット先に取った方が優勝。先攻はセットごとに交代`] : [])
    ];
    $("dRules").replaceChildren(...lines.map(t => { const li = document.createElement("li"); li.textContent = t; return li; }));
  }

  function renderScores() {
    el.scores.hidden = ui.phase === "setup" || !game;
    if (!game) return;
    const roleOn = !["setup", "over"].includes(ui.phase);
    const champion = match ? R.matchWinner(match) : null;
    const cards = game.names.map((name, i) => {
      const card = document.createElement("div");
      const isDef = R.defender(game) === i;
      const won = ui.phase === "over" && (champion === i || (!isMatch() && game.outcome?.winner === i));
      card.className = "score" + (roleOn && isDef ? " sitting" : "") + (won ? " won" : "");
      const pips = Array.from({ length: game.maxShocks }, (_, k) => `<span class="${k < game.shocks[i] ? "on" : ""}"></span>`).join("");
      const sets = isMatch() ? `<span class="sets">${match.wins[i]}セット</span>` : "";
      card.innerHTML = `
        <div class="score-head"><span class="score-name"></span>${roleOn ? `<span class="role">${isDef ? "座る" : "仕掛ける"}</span>` : ""}</div>
        <div class="pts">${game.scores[i]}<small>/${game.target}点</small></div>
        <div class="score-foot"><div class="pips" aria-label="シビれ${game.shocks[i]}回">${pips}</div>${sets}</div>`;
      card.querySelector(".score-name").textContent = name;
      return card;
    });
    el.scores.replaceChildren(...cards);
  }

  function renderHistory() {
    const lines = game.names.map((name, i) => {
      const traps = game.history.filter(h => h.attacker === i).map(h => h.trap).slice(-HISTORY_SHOWN);
      return traps.length ? `${name}の仕掛け：${traps.join("→")}` : "";
    }).filter(Boolean);
    el.history.textContent = lines.join("　／　");
    el.history.hidden = lines.length === 0;
  }

  function renderRing() {
    const showReveal = ["result", "over"].includes(ui.phase) && game.last;
    const choosing = ["set", "sit"].includes(ui.phase);
    chairs.forEach((b, n) => {
      const gone = !game.remaining.includes(n);
      b.disabled = !choosing || gone;
      b.className = "chair"
        + (gone ? " gone" : "")
        + (n === game.bonus ? " bonus" : "")
        + (choosing && ui.selected === n ? " selected" : "")
        + (ui.phase === "reveal" && game.last?.chair === n ? " selected" : "")
        + (showReveal && game.last.trap === n ? " trap" : "")
        + (showReveal && game.last.chair === n ? " picked" : "");
    });
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    const screen = SCREENS[ui.phase]();
    renderScores();
    if (ui.phase === "setup") {
      renderSetup();
    } else {
      renderRing();
      renderHistory();
      el.title.textContent = screen.title;
      el.hint.textContent = screen.hint;
      el.center.textContent = screen.center;
      el.center.className = "ring-center" + (ui.phase === "result" && game.last.hit ? " shocked" : "");
    }
    el.actions.replaceChildren(...screen.actions);
  }

  function buildRing(n) {
    chairs.forEach(b => b.remove());
    chairs = new Map();
    for (let i = 1; i <= n; i++) {
      const angle = -Math.PI / 2 + ((i - 1) / n) * 2 * Math.PI;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chair";
      b.textContent = i;
      b.setAttribute("aria-label", `${i}番のイス`);
      b.style.left = `${50 + 40 * Math.cos(angle)}%`;
      b.style.top = `${50 + 40 * Math.sin(angle)}%`;
      b.addEventListener("click", () => onChair(i));
      chairs.set(i, b);
      el.ring.appendChild(b);
    }
  }

  function init() {
    settings = loadSettings();
    Duo.fill(el.names);
    render();
  }
  function onShow() {
    if (ui.phase === "setup") Duo.fill(el.names);
  }

  return { init, onShow };
})();

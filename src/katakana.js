/* Katakana-ban talk screen: each player talks on a topic without loanwords; the others hit the big buzzer
 * whenever they hear katakana. After everyone has talked, fewest penalties wins. */
const Katakana = (() => {
  const K = KatakanaRules;
  const KEY = "katakana.settings";
  const LEVEL_OPTIONS = [
    { value: "normal", label: "ふつう" }, { value: "hard", label: "むずかしい" }, { value: "all", label: "ぜんぶ" }
  ];
  const URGENT_SEC = 10;
  const COUNT_SEC = 5;
  const TICK_MS = 100;
  const DRUM_MS = 1800;
  const PLUS_MS = 800;
  const PERFECT_DELAY_MS = 700;
  /* Buttons ignore taps this soon after the screen changed, so a double tap or a stray buzzer tap
   * cannot skip a turn result or hit やめる on the next screen. */
  const GUARD_MS = 600;

  const el = {
    setup: $("xSetup"), play: $("xPlay"), label: $("xLabel"), title: $("xTitle"), card: $("xCard"),
    talk: $("xTalk"), clock: $("xClock"), tally: $("xTally"), count: $("xCount"), meter: $("xMeter"),
    buzz: $("xBuzz"), board: $("xBoard"), list: $("xList"), hint: $("xHint"), actions: $("xActions")
  };
  const meterFill = el.meter.firstElementChild;

  let settings = { ...K.DEFAULTS };
  let ui = { phase: "setup", since: 0 };
  let game = null;
  let topic = "";
  let used = [];
  let clock = { endAt: 0, timer: 0, lastSec: null, lastBuzz: null };
  let later = { drum: 0, perfect: 0, confetti: null };
  let countdownId = 0;

  const seatName = (i) => `${View.seat(i)}さん`;

  function update(patch) {
    settings = K.normalize({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(phase) {
    ui = { phase, since: performance.now() };
    render();
  }
  const guarded = (fn) => () => { if (performance.now() - ui.since >= GUARD_MS) fn(); };
  function stopClock() {
    clearInterval(clock.timer);
    clock = { ...clock, timer: 0 };
  }
  /* Cancels the delayed result reveal, the late perfect-turn chime and any confetti still falling. */
  function clearLater() {
    clearTimeout(later.drum);
    clearTimeout(later.perfect);
    if (later.confetti) later.confetti();
    later = { drum: 0, perfect: 0, confetti: null };
  }
  function drawTopic() {
    const next = K.pickTopic(used, settings.level);
    used = next.used;
    topic = next.topic;
  }

  /* ---------- custom sounds ---------- */
  /* Quiz-show "bu-buu" buzzer for a katakana word. */
  function buzzerSound() {
    const ctx = Sound.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    [[0, 0.12], [0.16, 0.42]].forEach(([d, len]) => [0, 9].forEach(off =>
      Sound.tone({ freq: 165 + off, type: "square", t: t + d, dur: len, vol: 0.085, hold: len - 0.06, filter: { freq: 1500 } })));
    Sound.hiss({ t, dur: 0.08, vol: 0.12, type: "bandpass", freq: 900, q: 1 });
    Sound.vibrate([90, 50, 180]);
  }
  /* Referee whistle "pi, pi, piiii" for time up. */
  function whistle() {
    const ctx = Sound.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    [[0, 0.12], [0.2, 0.12], [0.4, 0.75]].forEach(([d, len]) => {
      Sound.tone({ freq: 2300, type: "sine", t: t + d, dur: len, vol: 0.1, attack: 0.01, hold: len - 0.06, vibrato: { rate: 34, depth: 110 } });
      Sound.hiss({ t: t + d, dur: len, vol: 0.025, type: "bandpass", freq: 2600, q: 3 });
    });
    Sound.vibrate([60, 80, 60, 80, 300]);
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    clearLater();
    game = K.newGame(settings.players, settings.seconds);
    drawTopic();
    Sound.sfx("confirm");
    go("topic");
    Fx.pop(el.card);
  }
  function changeTopic() {
    drawTopic();
    Sound.sfx("flip");
    render();
    Fx.pop(el.card);
  }
  async function begin() {
    const id = ++countdownId;
    go("ready");
    await Fx.countdown("スタート！");
    if (ui.phase !== "ready" || id !== countdownId) return;
    stopClock();
    clock = { endAt: performance.now() + game.seconds * 1000, timer: setInterval(tick, TICK_MS), lastSec: null, lastBuzz: null };
    Music.play("rush");
    go("talk");
    tick();
  }
  function tick() {
    const left = Math.max(0, clock.endAt - performance.now());
    const sec = Math.ceil(left / 1000);
    const urgent = sec <= URGENT_SEC;
    el.clock.textContent = View.clock(sec);
    el.clock.classList.toggle("urgent", urgent);
    el.meter.classList.toggle("urgent", urgent);
    meterFill.style.transform = `scaleX(${(left / (game.seconds * 1000)).toFixed(4)})`;
    if (urgent) Music.intensify();
    if (sec !== clock.lastSec && sec <= COUNT_SEC && sec > 0) Sound.sfx("count");
    clock = { ...clock, lastSec: sec };
    if (left <= 0) finishTurn();
  }
  function buzz() {
    if (ui.phase !== "talk") return;
    const t = performance.now();
    if (!K.canBuzz(clock.lastBuzz, t)) return;
    clock = { ...clock, lastBuzz: t };
    game = K.penalize(game);
    buzzerSound();
    Fx.flash("--alert", 380);
    Fx.shake(el.talk);
    Fx.replay(el.buzz, "katakana-pressed");
    floatPlus();
    render();
    Fx.replay(el.tally, "katakana-hit");
  }
  function floatPlus() {
    const plus = document.createElement("span");
    plus.className = "katakana-plus";
    plus.textContent = "+1";
    el.talk.appendChild(plus);
    setTimeout(() => plus.remove(), PLUS_MS);
  }
  function undoBuzz() {
    if (ui.phase !== "talk" || game.count === 0) return;
    game = K.undo(game);
    Sound.sfx("back");
    render();
  }
  function finishTurn() {
    if (ui.phase !== "talk") return;
    stopClock();
    Music.stop();
    whistle();
    game = K.endTurn(game, topic);
    go("turnEnd");
    Fx.pop(el.card);
    if (K.lastTurn(game).count === 0) {
      clearTimeout(later.perfect);
      later = { ...later, perfect: setTimeout(() => { if (ui.phase === "turnEnd") Sound.sfx("correct"); }, PERFECT_DELAY_MS) };
    }
  }
  function nextTurn() {
    drawTopic();
    Sound.sfx("whoosh");
    go("topic");
    Fx.pop(el.card);
  }
  function reveal() {
    clearLater();
    go("drum");
    Sound.sfx("drumroll", DRUM_MS / 1000);
    later = { ...later, drum: setTimeout(showResult, DRUM_MS) };
  }
  function showResult() {
    if (ui.phase !== "drum") return;
    go("result");
    Fx.pop(el.card);
    Sound.sfx("victory");
    later = { ...later, confetti: Fx.confetti() || null };
  }
  function nextLap() {
    clearLater();
    game = K.nextLap(game);
    drawTopic();
    Sound.sfx("confirm");
    go("topic");
    Fx.pop(el.card);
  }
  function toSetup() {
    clearLater();
    go("setup");
  }

  /* ---------- screens ---------- */
  const lapPrefix = () => (game.lap > 1 ? `${game.lap}周目　` : "");
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", guarded(start), "primary")] }),
    topic: () => ({
      label: `${lapPrefix()}${game.turn + 1} / ${game.players}人目`,
      title: `${seatName(K.speaker(game))}の番`,
      card: { main: topic, sub: "このお題について話そう", cls: "katakana-topic" },
      hint: `${game.seconds}秒間、カタカナを使わずに話し続けてね`,
      actions: [
        makeButton("やめる", guarded(toSetup), "small"),
        makeButton("別のお題", guarded(changeTopic), "small"),
        makeButton("スタート", guarded(begin), "primary")
      ]
    }),
    ready: () => ({ label: `${seatName(K.speaker(game))}の番`, title: `「${topic}」`, actions: [] }),
    talk: () => ({
      label: `${seatName(K.speaker(game))}のトーク`,
      title: `「${topic}」`,
      actions: [
        makeButton("1回取り消す", undoBuzz, "small", game.count === 0),
        makeButton("トーク終了", guarded(finishTurn), "small")
      ]
    }),
    turnEnd: () => {
      const last = K.lastTurn(game);
      const next = K.speaker(game);
      const perfect = last.count === 0;
      return {
        label: "そこまで！",
        title: perfect ? `${seatName(last.seat)}、パーフェクト！` : `${seatName(last.seat)}のカタカナ`,
        card: { main: `${last.count}回`, sub: `お題「${last.topic}」`, cls: `number ${perfect ? "katakana-perfect" : "katakana-bad"}` },
        hint: next === null ? "全員話し終わりました。いよいよ結果発表！" : `次は${seatName(next)}の番です`,
        actions: [next === null
          ? makeButton("結果発表！", guarded(reveal), "primary")
          : makeButton(`${seatName(next)}の番へ`, guarded(nextTurn), "primary")]
      };
    },
    drum: () => ({ label: "結果発表", title: "カタカナが少なかったのは…", card: { main: "？", back: true }, actions: [] }),
    result: () => {
      const champs = K.champions(game);
      const best = K.ranking(game)[0].penalties;
      return {
        label: game.lap > 1 ? `${game.lap}周の合計` : "結果",
        title: champs.length === game.players ? "全員同点！ みんな優勝" : "優勝は…",
        card: { main: champs.map(seatName).join("・"), sub: `カタカナ ${best}回`, cls: "katakana-champ" },
        hint: `「${game.lap + 1}周目へ」なら、回数を合計したまま続けられます`,
        actions: [
          makeButton("設定", guarded(toSetup), "small"),
          makeButton(`${game.lap + 1}周目へ`, guarded(nextLap), "small"),
          makeButton("もう一回", guarded(start), "primary")
        ]
      };
    }
  };

  /* ---------- rendering ---------- */
  function cell(tag, cls, text) {
    const node = document.createElement(tag);
    node.className = cls;
    node.textContent = text;
    return node;
  }
  function renderTalk() {
    const talking = ui.phase === "talk";
    el.talk.hidden = !talking;
    if (!talking) return;
    el.count.textContent = String(game.count);
    el.tally.classList.toggle("zero", game.count === 0);
  }
  function renderBoard() {
    const show = ui.phase === "topic" || ui.phase === "turnEnd";
    el.board.hidden = !show;
    if (!show) return;
    const focus = ui.phase === "topic" ? K.speaker(game) : K.lastTurn(game).seat;
    el.board.replaceChildren(...game.penalties.map((p, seat) => {
      const chip = cell("span", ["katakana-seat", seat === focus ? "on" : "", p > 0 ? "hot" : ""].filter(Boolean).join(" "), "");
      chip.append(cell("b", "", View.seat(seat)), cell("small", "", `${p}回`));
      return chip;
    }));
  }
  function renderList() {
    const show = ui.phase === "result";
    el.list.hidden = !show;
    if (!show) return;
    el.list.replaceChildren(...K.ranking(game).map((row, k) => {
      const li = cell("li", row.rank === 1 ? "ok" : "", "");
      li.style.setProperty("--i", String(k));
      li.append(
        cell("span", "pos", `${row.rank}位`),
        cell("span", "who", seatName(row.seat)),
        cell("b", "num", `${row.penalties}回`),
        cell("span", "mark", row.rank === 1 ? "優勝" : "")
      );
      return li;
    }));
  }
  function renderSetup() {
    const counts = Array.from({ length: K.PLAYERS.max - K.PLAYERS.min + 1 }, (_, i) => K.PLAYERS.min + i);
    View.chips($("xPlayerChips"), View.options(counts, n => `${n}人`), settings.players, n => update({ players: n }));
    View.chips($("xTimeChips"), View.options(K.SECONDS, n => `${n}秒`), settings.seconds, n => update({ seconds: n }));
    View.chips($("xLevelChips"), LEVEL_OPTIONS, settings.level, v => update({ level: v }));
    View.list($("xRules"), [
      `1人ずつ順番に、お題について${settings.seconds}秒間しゃべり続ける`,
      "カタカナの言葉（スマホ、テレビ、コーヒーなど）は使っちゃダメ。うまく言いかえよう",
      "聞く人は、カタカナが聞こえたら「カタカナ！」ボタンをタップ。1回でペナルティ1",
      "全員話したら結果発表。ペナルティがいちばん少ない人の優勝！"
    ]);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    el.actions.classList.toggle("katakana-actions-center", ui.phase === "talk");
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    renderTalk();
    renderBoard();
    renderList();
  }

  function init() {
    settings = K.normalize(Store.load(KEY, null));
    el.buzz.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (e.button === 0) buzz(); /* fingers and the main mouse button only */
    });
    /* Keyboard presses arrive as clicks with detail 0; pointer taps were already handled on pointerdown. */
    el.buzz.addEventListener("click", (e) => { if (e.detail === 0) buzz(); });
    render();
  }
  function leave() {
    clearLater();
    if (ui.phase === "talk" || ui.phase === "ready") {
      stopClock();
      Music.stop();
      game = K.resetTurn(game);
      go("topic");
    } else if (ui.phase === "drum") {
      go("result");
    }
  }

  return { init, leave };
})();

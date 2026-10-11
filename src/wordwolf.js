/* Word wolf screen: deal words by passing the phone, talk with a timer, point, reveal. */
const WordWolf = (() => {
  const W = WordWolfRules;
  const KEY = "wordwolf.settings";
  const DRUM_MS = 1800;
  const URGENT_SEC = 30;

  const el = {
    setup: $("wSetup"), play: $("wPlay"), label: $("wLabel"), title: $("wTitle"),
    card: $("wCard"), clock: $("wClock"), hint: $("wHint"), actions: $("wActions")
  };

  let settings = { players: 4, wolves: 1, minutes: 3 };
  let ui = { phase: "setup", seat: 0, shown: false };
  let round = null;
  let used = [];
  let talk = { endAt: 0, timer: 0, lastSec: null };

  const S = (i) => View.seat(i);

  function normalize(s) {
    const players = Number.isInteger(s.players) && s.players >= W.PLAYERS.min && s.players <= W.PLAYERS.max ? s.players : 4;
    const wolves = Math.min(Math.max(1, Number.isInteger(s.wolves) ? s.wolves : 1), W.maxWolves(players));
    const minutes = W.TALK_MINUTES.includes(s.minutes) ? s.minutes : 3;
    return { players, wolves, minutes };
  }
  function update(patch) {
    settings = normalize({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }
  function go(patch) {
    ui = { ...ui, ...patch };
    render();
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    const next = W.nextPair(used);
    used = next.used;
    round = W.newRound(settings.players, settings.wolves, next.pair);
    Sound.sfx("confirm");
    go({ phase: "deal", seat: 0, shown: false });
  }
  function showWord() {
    Sound.sfx("flip");
    go({ shown: true });
    Fx.pop(el.card);
  }
  function nextSeat() {
    Sound.sfx("whoosh");
    if (ui.seat + 1 < round.players) go({ seat: ui.seat + 1, shown: false });
    else startTalk();
  }
  function startTalk() {
    clearInterval(talk.timer);
    talk = { endAt: performance.now() + settings.minutes * 60000, timer: setInterval(tick, 200), lastSec: null };
    Music.play("tension");
    go({ phase: "talk" });
    tick();
  }
  function tick() {
    const left = Math.max(0, talk.endAt - performance.now());
    const sec = Math.ceil(left / 1000);
    el.clock.textContent = View.clock(sec);
    el.clock.classList.toggle("urgent", sec <= URGENT_SEC);
    if (sec <= URGENT_SEC) Music.intensify();
    if (sec !== talk.lastSec && sec <= 5 && sec > 0) Sound.sfx("count");
    talk = { ...talk, lastSec: sec };
    if (left <= 0) endTalk();
  }
  function addMinute() {
    talk = { ...talk, endAt: talk.endAt + 60000 };
    tick();
  }
  function endTalk() {
    clearInterval(talk.timer);
    talk = { ...talk, timer: 0 };
    Music.stop();
    Sound.sfx("buzz");
    go({ phase: "vote" });
  }
  function check() {
    go({ phase: "drum" });
    Sound.sfx("drumroll", DRUM_MS / 1000);
    setTimeout(() => {
      if (ui.phase !== "drum") return;
      Sound.sfx("reveal");
      go({ phase: "reveal" });
      Fx.pop(el.card);
    }, DRUM_MS);
  }

  /* ---------- screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    deal: () => {
      const last = ui.seat + 1 >= round.players;
      if (!ui.shown) {
        return {
          label: `${ui.seat + 1} / ${round.players}人目`,
          title: `${S(ui.seat)}さんだけ見てね`,
          card: { main: "？", back: true },
          hint: "ほかの人は画面を見ないで",
          actions: [makeButton("お題を見る", showWord, "primary")]
        };
      }
      return {
        label: `${S(ui.seat)}さんのお題`,
        title: "",
        card: { main: round.words[ui.seat] },
        hint: "覚えたら画面を戻して次の人へ。自分がウルフかどうかは、まだ分かりません。",
        actions: [makeButton(last ? "覚えた！ 話し合いへ" : `覚えた！ ${S(ui.seat + 1)}さんへ`, nextSeat, "primary")]
      };
    },
    talk: () => ({
      label: "話し合い",
      title: "ウルフは誰だ？",
      hint: `お題について話そう。ウルフは${round.wolves.length}人。ウルフはばれないように話を合わせて。`,
      actions: [makeButton("+1分", addMinute, "small"), makeButton("話し合いを終える", endTalk, "primary")]
    }),
    vote: () => ({
      label: "投票",
      title: "せーので、ウルフだと思う人を指差して！",
      hint: "いちばん多く指された人が、ウルフかどうか…",
      actions: [makeButton("答え合わせ", check, "primary")]
    }),
    drum: () => ({ label: "答え合わせ", title: "ウルフは…", card: { main: "？", back: true }, actions: [] }),
    reveal: () => ({
      label: "結果",
      title: `ウルフは ${round.wolves.map(S).join("・")}さん！`,
      card: { main: `みんな「${round.majority}」`, sub: `ウルフ「${round.minority}」`, cls: "pair" },
      hint: "ウルフを指せたら、みんなの勝ち。ウルフは、みんなのお題を言い当てられたら逆転勝ち！",
      actions: [makeButton("設定", () => go({ phase: "setup" }), "small"), makeButton("次のお題で遊ぶ", start, "primary")]
    })
  };

  function renderSetup() {
    View.chips($("wPlayerChips"), View.options(Array.from({ length: W.PLAYERS.max - W.PLAYERS.min + 1 }, (_, i) => W.PLAYERS.min + i), n => `${n}人`), settings.players, n => update({ players: n }));
    View.chips($("wWolfChips"), View.options(Array.from({ length: W.maxWolves(settings.players) }, (_, i) => i + 1), n => `${n}人`), settings.wolves, n => update({ wolves: n }));
    View.chips($("wTalkChips"), View.options(W.TALK_MINUTES, n => `${n}分`), settings.minutes, n => update({ minutes: n }));
    View.list($("wRules"), [
      "スマホを回して、1人ずつこっそりお題を見る",
      `${settings.wolves}人だけ、少し違うお題（ウルフ）。誰がウルフかは本人も知らない`,
      `${settings.minutes}分間、お題について話す。お題そのものは言わないこと`,
      "時間が来たら、せーのでウルフだと思う人を指差す",
      "ウルフが指されたらみんなの勝ち。ただしウルフが、みんなのお題を当てたら逆転勝ち"
    ]);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    el.clock.hidden = ui.phase !== "talk";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
  }

  function init() {
    settings = normalize(Store.load(KEY, {}) || {});
    render();
  }
  function leave() {
    if (ui.phase === "talk") {
      clearInterval(talk.timer);
      talk = { ...talk, timer: 0 };
      go({ phase: "vote" });
    }
  }

  return { init, leave };
})();

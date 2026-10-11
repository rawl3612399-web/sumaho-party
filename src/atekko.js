/* Forehead quiz screen: the answerer holds the phone to their forehead; the others give hints.
 * Full-screen view with a pass pad on the left and a correct pad on the right. */
const Atekko = (() => {
  const A = AtekkoRules;
  const KEY = "atekko.settings";
  const LEVELS = [
    { value: "kids", label: "こども" }, { value: "easy", label: "かんたん" },
    { value: "normal", label: "ふつう" }, { value: "hard", label: "むずかしい" }, { value: "all", label: "ぜんぶ" }
  ];
  const URGENT_SEC = 10;

  const el = {
    setup: $("aSetup"), play: $("aPlay"), label: $("aLabel"), title: $("aTitle"),
    card: $("aCard"), list: $("aList"), hint: $("aHint"), actions: $("aActions"),
    quiz: $("quiz"), word: $("quizWord"), time: $("quizTime"), score: $("quizScore"),
    pass: $("quizPass"), ok: $("quizOk")
  };

  let settings = { seconds: 60, level: "easy" };
  let ui = { phase: "setup" };
  let round = null;
  let clock = { endAt: 0, timer: 0, lastSec: null, running: false };

  function update(patch) {
    settings = { ...settings, ...patch };
    Store.save(KEY, settings);
    render();
  }
  function go(phase) {
    ui = { phase };
    render();
  }
  function pool() {
    const ids = settings.level === "all" ? ["kids", "easy", "normal", "hard"] : [settings.level];
    return ids.flatMap(id => TOPICS[id]);
  }

  /* ---------- flow ---------- */
  async function start() {
    Sound.ensure();
    Awake.keep();
    round = A.newRound(pool());
    go("ready");
    await Fx.countdown("スタート！");
    if (ui.phase !== "ready") return;
    clock = { endAt: performance.now() + settings.seconds * 1000, timer: setInterval(tick, 150), lastSec: null, running: true };
    el.quiz.hidden = false;
    document.body.classList.add("arena-open");
    Music.play("rush");
    go("play");
    showWord();
    tick();
  }
  function showWord() {
    el.word.textContent = A.current(round);
    el.word.classList.toggle("long", A.current(round).length >= 7);
    el.score.textContent = `${A.score(round)}問正解`;
    Fx.pop(el.word);
  }
  function tick() {
    const left = Math.max(0, clock.endAt - performance.now());
    const sec = Math.ceil(left / 1000);
    el.time.textContent = View.clock(sec);
    el.quiz.classList.toggle("urgent", sec <= URGENT_SEC);
    if (sec <= URGENT_SEC) Music.intensify();
    if (sec !== clock.lastSec && sec <= 3 && sec > 0) Sound.sfx("count");
    clock = { ...clock, lastSec: sec };
    if (left <= 0) finish();
  }
  function answer(correct) {
    if (ui.phase !== "play") return;
    round = A.answer(round, correct);
    Sound.sfx(correct ? "correct" : "whoosh");
    Fx.replay(el.quiz, correct ? "flash-ok" : "flash-pass");
    showWord();
  }
  function finish() {
    clearInterval(clock.timer);
    clock = { ...clock, timer: 0, running: false };
    Music.stop();
    Sound.sfx("buzz");
    el.quiz.hidden = true;
    document.body.classList.remove("arena-open");
    go("result");
    const s = A.score(round);
    setTimeout(() => {
      if (s >= 5) Sound.sfx("victory"); else Sound.sfx("fanfare");
      if (s >= 8) Fx.confetti();
    }, 900);
  }
  function quit() {
    clearInterval(clock.timer);
    clock = { ...clock, timer: 0, running: false };
    Music.stop();
    el.quiz.hidden = true;
    document.body.classList.remove("arena-open");
    go("setup");
  }

  /* ---------- screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    ready: () => ({ label: "準備", title: "スマホをおでこに！", hint: "画面をみんなに向けてね", actions: [] }),
    play: () => ({ label: "プレイ中", title: "", actions: [] }),
    result: () => {
      const s = A.score(round);
      return {
        label: "結果",
        title: s >= 8 ? "すごい！" : s >= 5 ? "ナイス！" : "おつかれさま！",
        card: { main: `${s}問正解`, sub: `${settings.seconds}秒で${round.results.length}問` },
        hint: "",
        actions: [makeButton("設定", () => go("setup"), "small"), makeButton("次の人が挑戦", start, "primary")]
      };
    }
  };

  function renderList() {
    const show = ui.phase === "result";
    el.list.hidden = !show || round.results.length === 0;
    if (!show) return;
    el.list.replaceChildren(...round.results.map(r => {
      const li = document.createElement("li");
      li.className = r.correct ? "ok" : "ng";
      const mark = document.createElement("b");
      mark.textContent = r.correct ? "○" : "パス";
      const word = document.createElement("span");
      word.textContent = r.word;
      li.append(mark, word);
      return li;
    }));
  }

  function renderSetup() {
    View.chips($("aTimeChips"), View.options(A.TIMES, n => `${n}秒`), settings.seconds, n => update({ seconds: n }));
    View.chips($("aLevelChips"), LEVELS, settings.level, v => update({ level: v }));
    View.list($("aRules"), [
      "答える人は、スマホを横向きにしておでこに当てる（画面はみんなの方へ）",
      "ほかの人は、言葉やジェスチャーでヒントを出す。お題そのものを言うのはダメ",
      "当たったら画面の右側「正解」、分からなければ左側「パス」をタップ",
      `${settings.seconds}秒で何問当てられるか勝負。交代して最高記録をねらおう`
    ]);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    renderList();
  }

  function init() {
    const s = Store.load(KEY, {}) || {};
    settings = {
      seconds: A.TIMES.includes(s.seconds) ? s.seconds : 60,
      level: LEVELS.some(l => l.value === s.level) ? s.level : "easy"
    };
    el.pass.addEventListener("pointerdown", (e) => { e.preventDefault(); answer(false); });
    el.ok.addEventListener("pointerdown", (e) => { e.preventDefault(); answer(true); });
    $("quizQuit").addEventListener("click", quit);
    document.addEventListener("keydown", (e) => {
      if (el.quiz.hidden) return;
      if (e.key === "ArrowRight") answer(true);
      if (e.key === "ArrowLeft") answer(false);
      if (e.key === "Escape") quit();
    });
    render();
  }
  function leave() {
    if (clock.running || ui.phase === "ready") quit();
  }

  return { init, leave };
})();

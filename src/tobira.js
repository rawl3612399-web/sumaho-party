/* 20の扉 screen: the keeper secretly looks at a word, then taps はい / いいえ / わからない to the others' questions. */
const Tobira = (() => {
  const T = TobiraRules;
  const KEY = "tobira.settings";
  const USED_KEY = "tobira.used";
  const DRUM_MS = 1800;
  const BUZZ_MS = 1000;
  const WIN_FANFARE_MS = 500;
  const TAP_GUARD_MS = 280;
  const STEP_GUARD_MS = 350;
  const RESULT_GUARD_MS = 600; /* もう一回 sits where 正解が出た！ was: a double tap must not skip the win */
  const DENSE_AFTER = 20; /* above this, the answer track packs more dots per row so the buttons still fit */
  const LONG_WORD = 8;
  const PEEK_LABEL = "長押しでお題を確認";

  const LEVEL_LABELS = Object.freeze({ easy: "かんたん", normal: "ふつう", hard: "むずかしい" });
  const REPLY_LABELS = Object.freeze({ yes: "はい", no: "いいえ", unknown: "わからない" });
  const PIP_MARKS = Object.freeze({ yes: "○", no: "×", unknown: "？", correct: "◎" });
  const END_TITLES = Object.freeze({ time: "時間切れ！", questions: "質問を使い切った！", giveup: "降参！" });
  const GRADE_TEXT = Object.freeze({
    genius: "ひらめきが天才的！", great: "すごい推理力！", good: "ナイス推理！", close: "ラスト1問でギリギリセーフ！"
  });
  const MOOD_RANK = Object.freeze({ calm: 0, warm: 1, hot: 2 });

  const el = {
    setup: $("zSetup"), play: $("zPlay"), label: $("zLabel"), title: $("zTitle"),
    card: $("zCard"), hint: $("zHint"), actions: $("zActions"), note: $("zNote"),
    status: $("zStatus"), count: $("zCount"), countNum: $("zCountNum"), clock: $("zClock"),
    track: $("zTrack"), tally: $("zTally"), answers: $("zAnswers"), peek: $("zPeek"),
    yes: $("zYes"), no: $("zNo"), unknown: $("zUnknown")
  };

  let settings = T.normalizeSettings({});
  let used = [];
  let round = null;
  let roundNo = 0;
  let ui = { phase: "setup", reason: null, error: "", since: 0 };
  let clock = { endAt: null, timer: 0, lastSec: null };
  let pending = [];
  let mood = "calm";
  let lastReplyAt = 0;
  let runId = 0;
  let stopConfetti = null;

  function go(patch) {
    const moved = patch.phase !== undefined && patch.phase !== ui.phase;
    ui = { ...ui, ...patch, since: moved ? performance.now() : ui.since };
    render();
  }
  /* A quick double tap must not skip the secret card, the word or the result. */
  const settled = (ms = STEP_GUARD_MS) => performance.now() - ui.since >= ms;
  function update(patch) {
    settings = T.normalizeSettings({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }

  /* ---------- reply sounds (each answer has its own voice) ---------- */
  const hz = (m) => Sound.hz(m);
  const voice = (play) => { const ctx = Sound.ensure(); if (ctx) play(ctx.currentTime); };
  const REPLY_SFX = {
    yes: () => voice(t => {
      Sound.tone({ freq: hz(79), type: "triangle", t, dur: 0.12, vol: 0.15, send: 0.15 });
      Sound.tone({ freq: hz(86), type: "sine", t: t + 0.08, dur: 0.45, vol: 0.2, send: 0.3 });
      Sound.tone({ freq: hz(98), type: "sine", t: t + 0.08, dur: 0.2, vol: 0.05 });
    }),
    no: () => voice(t => {
      [[55, 0], [50, 0.14]].forEach(([m, d]) =>
        Sound.tone({ freq: hz(m), type: "square", t: t + d, dur: 0.13, vol: 0.09, hold: 0.06, filter: { freq: 900 } }));
    }),
    unknown: () => voice(t => {
      Sound.tone({ freq: hz(72), glide: hz(67), glideTime: 0.38, type: "sine", t, dur: 0.48, vol: 0.2, vibrato: { rate: 11, depth: 22 }, send: 0.2 });
      Sound.tone({ freq: hz(84), glide: hz(79), glideTime: 0.38, type: "triangle", t, dur: 0.3, vol: 0.04 });
    })
  };

  /* ---------- timers ---------- */
  function later(fn, ms) {
    const id = setTimeout(() => { pending = pending.filter(x => x !== id); fn(); }, ms);
    pending = [...pending, id];
  }
  function stopClock() {
    clearInterval(clock.timer);
    clock = { ...clock, timer: 0 };
  }
  function reset() {
    runId += 1;
    pending.forEach(clearTimeout);
    pending = [];
    stopClock();
    clock = { endAt: null, timer: 0, lastSec: null };
    endPeek();
    if (stopConfetti) stopConfetti();
    stopConfetti = null;
  }
  const secNow = () => T.secondsLeft(clock.endAt, performance.now());

  /* ---------- flow ---------- */
  function drawTopic() {
    try {
      const next = T.pickTopic(T.poolFor(TOPICS, settings.level), used);
      used = next.used;
      Store.save(USED_KEY, used);
      round = T.newRound(next.word, settings.questions, settings.minutes);
      return true;
    } catch (e) {
      console.error("tobira: could not draw a topic", e);
      Sound.sfx("wrong");
      go({ phase: "setup", error: "お題を用意できませんでした。もう一度ためしてね" });
      return false;
    }
  }
  function start() {
    if (!settled(RESULT_GUARD_MS)) return;
    Sound.ensure();
    Awake.keep();
    reset();
    if (!drawTopic()) return;
    roundNo += 1;
    Sound.sfx("confirm");
    go({ phase: "secret", reason: null, error: "" });
    Fx.pop(el.card);
  }
  function showWord() {
    if (ui.phase !== "secret" || !settled()) return;
    Sound.sfx("flip");
    go({ phase: "word" });
    Fx.pop(el.card);
  }
  function changeTopic() {
    if (ui.phase !== "word" || !settled() || !drawTopic()) return;
    Sound.sfx("flip");
    render();
    Fx.pop(el.card);
  }
  async function ready() {
    if (ui.phase !== "word" || !settled()) return;
    const id = runId;
    Sound.sfx("whoosh");
    go({ phase: "ready" });
    await Fx.countdown("スタート！");
    if (id !== runId || ui.phase !== "ready") return;
    startPlay();
  }
  function startPlay() {
    mood = "calm";
    lastReplyAt = 0;
    const endAt = T.deadline(performance.now(), round.minutes);
    clock = { endAt, timer: endAt === null ? 0 : setInterval(tick, 200), lastSec: null };
    Music.play("think");
    go({ phase: "play" });
  }
  function tick() {
    if (ui.phase !== "play" || clock.endAt === null) return;
    const now = performance.now();
    const sec = T.secondsLeft(clock.endAt, now);
    paintClock(sec);
    if (sec !== clock.lastSec && sec > 0 && sec <= 5) Sound.sfx("count");
    clock = { ...clock, lastSec: sec };
    raiseMood(T.pressure(round, sec));
    if (T.isTimeUp(clock.endAt, now)) {
      round = T.timeout(round);
      finish();
    }
  }
  /* Music and the counter only ever get more tense within a round. */
  function raiseMood(next) {
    if (MOOD_RANK[next] <= MOOD_RANK[mood]) return;
    mood = next;
    Music.play("tension");
    if (next === "hot") Music.intensify();
    Sound.sfx("heartbeat");
    Fx.replay(el.count, "tobira-alarm");
  }
  function reply(kind) {
    if (ui.phase !== "play" || T.isOver(round)) return;
    const now = performance.now();
    if (now - lastReplyAt < TAP_GUARD_MS) return;
    lastReplyAt = now;
    round = T.ask(round, kind);
    REPLY_SFX[kind]();
    if (T.isOver(round)) {
      finish();
      return;
    }
    render();
    Fx.replay(el.track.children[T.used(round) - 1], "tobira-pip-in");
    Fx.pop(el.countNum);
    raiseMood(T.pressure(round, secNow()));
  }
  function undo() {
    if (ui.phase !== "play" || T.isOver(round) || T.used(round) === 0) return;
    round = T.undo(round);
    Sound.sfx("back");
    render();
  }
  /* 正解が出た！ (T.solve) or 降参 (T.giveUp). */
  function endRound(rule) {
    if (ui.phase !== "play" || T.isOver(round)) return;
    round = rule(round);
    finish();
  }
  function finish() {
    stopClock();
    endPeek();
    Music.stop();
    if (T.outcome(round).winner === "guessers") celebrate();
    else dramatize(T.outcome(round).reason);
  }
  function celebrate() {
    Sound.sfx("correct");
    Fx.flash("--go", 450);
    go({ phase: "win" });
    Fx.pop(el.card);
    later(() => { if (ui.phase === "win") { Sound.sfx("victory"); stopConfetti = Fx.confetti() || null; } }, WIN_FANFARE_MS);
  }
  /* Keeper wins: a buzzer (or a sigh for giving up), a drum roll, then the answer. */
  function dramatize(reason) {
    go({ phase: "drum", reason });
    later(() => {
      if (reason === "giveup") { Sound.sfx("back"); return; }
      Sound.sfx("buzz");
      Fx.flash("--alert", 500);
      Fx.shake();
    }, reason === "questions" ? 350 : 0);
    later(() => { if (ui.phase === "drum") Sound.sfx("drumroll", DRUM_MS / 1000); }, BUZZ_MS);
    later(() => {
      if (ui.phase !== "drum") return;
      Sound.sfx("reveal");
      go({ phase: "reveal" });
      Fx.pop(el.card);
    }, BUZZ_MS + DRUM_MS);
  }
  function toSetup() {
    if (!settled(RESULT_GUARD_MS)) return;
    reset();
    go({ phase: "setup", error: "" });
  }

  /* ---------- peek (hold to see the word again) ---------- */
  function startPeek(e) {
    if (ui.phase !== "play") return;
    if (e.cancelable) e.preventDefault();
    el.peek.classList.add("on");
    el.peek.textContent = round.word;
  }
  function endPeek() {
    el.peek.classList.remove("on");
    el.peek.textContent = PEEK_LABEL;
  }
  function bindPeek() {
    el.peek.addEventListener("pointerdown", startPeek);
    ["pointerup", "pointerleave", "pointercancel", "blur"].forEach(type => el.peek.addEventListener(type, endPeek));
    el.peek.addEventListener("contextmenu", (e) => e.preventDefault());
    el.peek.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") startPeek(e); });
    el.peek.addEventListener("keyup", endPeek);
  }

  /* ---------- screens ---------- */
  const cardCls = (base) => [base, round.word.length >= LONG_WORD ? "tobira-long" : ""].filter(Boolean).join(" ");
  const backToSetup = () => makeButton("設定", toSetup, "small");

  function playHint(left) {
    if (left === 1) return "ラスト1問！ 答えを言うならいま！";
    if (left <= T.LOW_LEFT) return `あと${left}問！ そろそろ答えを言ってみよう`;
    return "質問を聞いたら、出題者がボタンで答える";
  }

  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    secret: () => ({
      label: `${roundNo}回目`,
      title: roundNo > 1 ? "次の出題者だけ見てね" : "出題者だけ見てね",
      card: { main: "？", back: true },
      hint: "ほかの人は画面を見ないで",
      actions: [makeButton("お題を見る", showWord, "primary")]
    }),
    word: () => ({
      label: `お題（${LEVEL_LABELS[settings.level]}）`,
      title: "",
      card: { main: round.word, sub: "これを当ててもらおう", cls: cardCls("") },
      hint: "知らない言葉なら変えてOK。覚えたら、画面をみんなに見せないように持ってね",
      actions: [makeButton("お題を変える", changeTopic, "small"), makeButton("覚えた！", ready, "primary")]
    }),
    ready: () => ({ label: "準備", title: "質問タイム！", hint: "出題者は、みんなの質問にボタンで答えてね", actions: [] }),
    play: () => ({
      label: `${T.used(round) + 1}問目`,
      title: "",
      hint: playHint(T.remaining(round)),
      actions: [
        makeButton("もどす", undo, "small", T.used(round) === 0),
        makeButton("降参", () => endRound(T.giveUp), "small"),
        makeButton("正解が出た！", () => endRound(T.solve), "primary")
      ]
    }),
    drum: () => ({ label: "答え合わせ", title: END_TITLES[ui.reason], card: { main: "？", back: true }, hint: "答えは…", actions: [] }),
    win: () => ({
      label: "結果",
      title: "正解！ みんなの勝ち！",
      card: { main: round.word, sub: `${T.outcome(round).used}問目で当てた！`, cls: cardCls("tobira-win") },
      hint: `${GRADE_TEXT[T.grade(round)]}\n次は、当てた人が出題者！`,
      actions: [backToSetup(), makeButton("もう一回", start, "primary")]
    }),
    reveal: () => ({
      label: END_TITLES[ui.reason],
      title: "出題者の勝ち！",
      card: { main: round.word, sub: "答えはこれでした", cls: cardCls("tobira-reveal") },
      hint: "次は、左どなりの人が出題者！",
      actions: [backToSetup(), makeButton("もう一回", start, "primary")]
    })
  };

  /* ---------- rendering ---------- */
  function paintClock(sec) {
    el.clock.hidden = sec === null;
    if (sec === null) return;
    el.clock.textContent = View.clock(sec);
    el.clock.classList.toggle("urgent", sec <= T.URGENT_SEC);
  }
  function renderStatus() {
    const p = T.pressure(round);
    el.countNum.textContent = String(T.remaining(round));
    el.count.classList.toggle("warm", p === "warm");
    el.count.classList.toggle("hot", p === "hot");
    paintClock(secNow());
  }
  function renderTrack() {
    const next = ui.phase === "play" ? T.used(round) : -1;
    el.track.classList.toggle("is-dense", round.budget > DENSE_AFTER);
    el.track.replaceChildren(...Array.from({ length: round.budget }, (_, i) => {
      const kind = round.log[i];
      const pip = document.createElement("span");
      pip.className = ["tobira-pip", kind ? `is-${kind}` : "", i === next ? "is-next" : ""].filter(Boolean).join(" ");
      pip.textContent = kind ? PIP_MARKS[kind] : "";
      return pip;
    }));
  }
  function renderTally() {
    const counts = T.tally(round);
    el.tally.replaceChildren(...T.ANSWERS.map(kind => {
      const tag = document.createElement("span");
      tag.className = `tobira-tag is-${kind}`;
      const n = document.createElement("b");
      n.textContent = String(counts[kind]);
      tag.append(`${REPLY_LABELS[kind]} `, n);
      return tag;
    }));
  }
  function renderBoard() {
    const playing = ui.phase === "play";
    const summary = playing || ui.phase === "win" || ui.phase === "reveal";
    el.status.hidden = !playing;
    el.answers.hidden = !playing;
    el.peek.hidden = !playing;
    el.track.hidden = !summary;
    el.tally.hidden = !summary;
    if (!summary) return;
    renderTrack();
    renderTally();
    if (playing) renderStatus();
  }
  function renderSetup() {
    View.chips($("zQuestionChips"), View.options(T.QUESTIONS, n => `${n}問`), settings.questions, n => update({ questions: n }));
    View.chips($("zTimeChips"), View.options(T.MINUTES, n => (n ? `${n}分` : "なし")), settings.minutes, n => update({ minutes: n }));
    View.chips($("zLevelChips"), T.LEVELS.map(value => ({ value, label: LEVEL_LABELS[value] })), settings.level, v => update({ level: v }));
    const limit = settings.minutes ? `${settings.questions}問・${settings.minutes}分以内` : `${settings.questions}問以内`;
    View.list($("zRules"), [
      "出題者を1人決める。お題を見るのは出題者だけ",
      "ほかの人は「生き物ですか？」のように、はい・いいえで答えられる質問をする",
      "出題者はボタンで答える。1つ答えるごとに、のこりの質問が1つへる",
      `答えを言うのも1問に数える。${limit}に当てたらみんなの勝ち、当てられなければ出題者の勝ち`
    ]);
    View.text(el.note, ui.error);
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    el.card.classList.toggle("tobira-tap", ui.phase === "secret");
    el.hint.classList.toggle("tobira-urgent", ui.phase === "play" && T.remaining(round) <= T.LOW_LEFT);
    renderBoard();
  }

  function init() {
    settings = T.normalizeSettings(Store.load(KEY, {}));
    used = T.cleanUsed(Store.load(USED_KEY, []));
    T.ANSWERS.forEach(kind => el[kind].addEventListener("click", () => reply(kind)));
    el.card.addEventListener("click", showWord);
    bindPeek();
    render();
  }
  /* Leaving abandons the round so the answer is never left on screen. */
  function leave() {
    reset();
    if (ui.phase !== "setup") go({ phase: "setup", error: "" });
  }

  return { init, leave };
})();

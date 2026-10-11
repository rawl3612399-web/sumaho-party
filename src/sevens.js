/* 七並べ screen: you against three CPUs with real cards. Four suit rows on a felt table, your hand fanned below,
 * cards fly to their slots, CPU seats show hand sizes and passes. */
const Sevens = (() => {
  const S = SevensRules;
  const KEY = "sevens.settings";
  const RECORD_KEY = "sevens.record";
  const ME = 0;
  const NAMES = Object.freeze(["あなた", "ウサギ", "クマ", "キツネ"]);
  const COLORS = Object.freeze([["--accent", "--on-accent"], ["--c-pink", "--on-tile"], ["--c-amber", "--on-tile"], ["--c-teal", "--on-tile"]]);
  const LEVEL_LABEL = Object.freeze({ easy: "よわい", normal: "ふつう", hard: "つよい" });
  const MS = Object.freeze({ think: 560, fly: 360, gap: 220, pass: 760, banner: 1150, intro: 1400, stagger: 60, deal: 45 });
  const FAST = 0.4; /* CPU speed once you are out of the round */
  const SKIP_THINK = Object.freeze({ playouts: 300, ms: 8 });

  const el = {
    setup: $("svSetup"), play: $("svPlay"), label: $("svLabel"), title: $("svTitle"), hint: $("svHint"),
    actions: $("svActions"), seats: $("svSeats"), board: $("svBoard"), banner: $("svBanner"),
    bannerMain: $("svBannerMain"), bannerSub: $("svBannerSub"), rank: $("svRank"), me: $("svMe"),
    hand: $("svHand"), record: $("svRecord")
  };

  let settings = { level: "normal", tunnel: false };
  let game = null;
  let ui = { phase: "setup", wait: null, confirm: null, flying: [], bubble: null, end: null, deal: false };
  let gen = 0; /* bumped on start / leave / quit so pending async steps stop */
  let slots = [];
  let seatEls = [];
  let handEls = new Map();
  let flyNodes = [];
  let stopConfetti = null;
  let resizeFrame = 0;

  const cls = (...names) => names.filter(Boolean).join(" ");
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const humanIn = () => Boolean(game) && S.isActive(game, ME);
  const myTurn = () => ui.phase === "play" && Boolean(game) && !game.over && game.turn === ME && !ui.wait;
  const pace = (ms) => (humanIn() ? ms : Math.round(ms * FAST));

  function normalize(s) {
    const src = s && typeof s === "object" ? s : {};
    return { level: S.LEVELS.includes(src.level) ? src.level : "normal", tunnel: src.tunnel === true };
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

  /* ---------- record ---------- */
  function loadRecord() {
    const raw = Store.load(RECORD_KEY, {});
    const src = raw && typeof raw === "object" ? raw : {};
    const n = (x) => (Number.isInteger(x) && x >= 0 ? x : 0);
    return Object.fromEntries(S.LEVELS.map(l => [l, { games: n(src[l]?.games), wins: n(src[l]?.wins) }]));
  }
  function saveRecord(place) {
    const rec = loadRecord();
    const mine = rec[settings.level];
    Store.save(RECORD_KEY, { ...rec, [settings.level]: { games: mine.games + 1, wins: mine.wins + (place === 1 ? 1 : 0) } });
  }
  function recordText() {
    const r = loadRecord()[settings.level];
    return r.games ? `${LEVEL_LABEL[settings.level]}との成績：${r.games}回中 1位${r.wins}回` : "";
  }

  /* ---------- sounds ---------- */
  const at = (play) => {
    const ctx = Sound.ctx();
    if (ctx) play(ctx.currentTime);
  };
  const soundSlide = () => Sound.hiss({ dur: 0.2, vol: 0.11, type: "bandpass", freq: 650, to: 3200, q: 1.1, attack: 0.05 });
  const soundNope = () => Sound.tone({ freq: 150, type: "square", dur: 0.08, vol: 0.05, filter: { freq: 800 } });
  const soundLand = () => at(t => {
    Sound.hiss({ t, dur: 0.045, vol: 0.26, type: "bandpass", freq: 2600, q: 1.5 });
    Sound.tone({ freq: 210, glide: 110, glideTime: 0.06, type: "sine", t, dur: 0.1, vol: 0.3 });
  });
  const soundDeal = (n) => at(t => {
    for (let i = 0; i < n; i++) Sound.hiss({ t: t + i * 0.045, dur: 0.035, vol: 0.12, type: "bandpass", freq: 2000 + (i % 3) * 350, q: 1.3 });
  });
  /* Two short notes: falling for a pass, rising when it becomes your turn. */
  const twoNotes = (a, b, type, vol) => at(t => {
    Sound.tone({ freq: Sound.hz(a), type, t, dur: 0.11, vol, filter: { freq: 2400 } });
    Sound.tone({ freq: Sound.hz(b), type, t: t + 0.1, dur: 0.22, vol, filter: { freq: 2400 }, send: 0.2 });
  });
  const soundPass = () => twoNotes(74, 67, "square", 0.05);
  const soundTurn = () => twoNotes(84, 88, "triangle", 0.07);

  /* ---------- flying cards ---------- */
  function pointOf(node, width) {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: width || node.offsetWidth || r.width };
  }
  const slotPoint = (k) => pointOf(slots[k]);
  const fromPoint = (seat, k) => (seat === ME ? pointOf(handEls.get(k)?.firstChild) : pointOf(seatEls[seat]?.stack, 34));

  function fly(k, from, to, faceDown, ms, delay = 0) {
    if (reduced() || !from || !to || typeof document.body.animate !== "function") return Promise.resolve();
    const node = Cards.el(S.cardOf(k), { size: "md", faceDown });
    const w = from.w;
    node.classList.add("sevens-fly");
    node.style.setProperty("--w", `${w}px`);
    node.style.left = `${from.x - w / 2}px`;
    node.style.top = `${from.y - w * 0.7}px`;
    document.body.appendChild(node);
    flyNodes = [...flyNodes, node];
    if (faceDown) setTimeout(() => Cards.setFaceDown(node, false), delay + ms * 0.1);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const sc = to.w / w;
    const anim = node.animate([
      { transform: "translate(0, 0) scale(1) rotate(0deg)" },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 26}px) scale(${((1 + sc) / 2) * 1.15}) rotate(-8deg)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(0deg)` }
    ], { duration: ms, delay, easing: "cubic-bezier(.3, .6, .3, 1)", fill: "both" });
    const done = anim.finished ? anim.finished.catch(() => null) : sleep(delay + ms);
    return done.then(() => {
      node.remove();
      flyNodes = flyNodes.filter(n => n !== node);
    });
  }
  function clearFlying() {
    flyNodes.forEach(n => n.remove());
    flyNodes = [];
    el.banner.hidden = true;
    if (typeof stopConfetti === "function") stopConfetti();
    stopConfetti = null;
  }
  async function banner(main, sub, tone, my, ms = MS.banner) {
    el.bannerMain.textContent = main;
    el.bannerSub.textContent = sub;
    el.banner.dataset.tone = tone;
    el.banner.hidden = false;
    Fx.replay(el.banner, "sevens-show");
    await sleep(pace(ms));
    if (gen === my) el.banner.hidden = true;
  }

  /* ---------- flow ---------- */
  async function start() {
    Sound.ensure();
    Awake.keep();
    const my = ++gen;
    clearFlying();
    game = S.newGame({ tunnel: settings.tunnel });
    handEls.forEach(b => b.remove());
    handEls = new Map();
    slots.forEach(s => s.querySelector(".pcard")?.remove());
    Sound.sfx("confirm");
    Music.play("think");
    go({ phase: "play", wait: "intro", confirm: null, flying: [], bubble: null, end: null, deal: true });
    ui = { ...ui, deal: false };
    soundDeal(S.HAND);
    await banner("スタート", `ダイヤの7を持つ${NAMES[game.starter]}から`, "start", my, MS.intro);
    if (gen === my) loop(my);
  }
  async function loop(my) {
    while (gen === my && ui.phase === "play" && !game.over) {
      if (game.turn === ME) {
        soundTurn();
        go({ wait: null, bubble: null });
        return;
      }
      await cpuTurn(my);
      if (gen === my) await sleep(pace(MS.gap));
    }
    if (gen === my && ui.phase === "play" && game.over) finish();
  }
  function decide() {
    try {
      return S.cpuMove(game, settings.level);
    } catch (e) {
      console.error("七並べ: CPUの手を決められませんでした", e);
      const legal = S.legalKeys(game);
      return legal.length ? { type: "play", key: legal[0] } : { type: "pass" };
    }
  }
  async function cpuTurn(my) {
    const seat = game.turn;
    go({ wait: "cpu", bubble: null });
    await sleep(pace(MS.think));
    if (gen !== my) return;
    const move = decide();
    if (move.type === "pass") {
      await doPass(seat, my);
      return;
    }
    go({ wait: "anim" });
    Sound.sfx("flip");
    await fly(move.key, fromPoint(seat, move.key), slotPoint(move.key), true, pace(MS.fly));
    if (gen === my) await afterPlay(seat, move.key, my);
  }
  async function humanPlay(k) {
    const my = gen;
    const from = fromPoint(ME, k);
    go({ wait: "anim", flying: [k], confirm: null });
    soundSlide();
    await fly(k, from, slotPoint(k), false, MS.fly);
    if (gen !== my) return;
    await afterPlay(ME, k, my);
    if (gen === my) loop(my);
  }
  async function afterPlay(seat, k, my) {
    game = S.play(game, k);
    go({ flying: [] });
    soundLand();
    if (!game.last.finished) return;
    Sound.sfx(seat === ME ? "correct" : "coin");
    await banner("あがり！", `${NAMES[seat]}が${game.done.length}位`, "done", my);
  }
  async function doPass(seat, my) {
    const next = S.pass(game);
    if (next.last.kind === "out") {
      await knockOut(seat, next, my);
      return;
    }
    game = next;
    soundPass();
    go({ wait: "anim", bubble: seat });
    await sleep(pace(MS.pass));
  }
  async function knockOut(seat, next, my) {
    const placed = next.last.placed;
    const flights = placed.map((k, i) => fly(k, fromPoint(seat, k), slotPoint(k), seat !== ME, pace(MS.fly), i * pace(MS.stagger)));
    if (seat === ME) {
      Sound.sfx("buzz");
      Fx.shake();
      Fx.flash("--alert", 500);
    } else Sound.sfx("wrong");
    go({ wait: "anim", flying: seat === ME ? placed : [] });
    const shown = banner("脱落", `${NAMES[seat]}はパスを使い切った`, "out", my);
    soundDeal(placed.length);
    await Promise.all(flights);
    if (gen !== my) return;
    game = next;
    go({ flying: [] });
    await shown;
  }
  function passTap() {
    if (!myTurn()) return;
    if (S.passesLeft(game, ME) === 0) go({ confirm: "out" });
    else runPass();
  }
  function runPass() {
    if (!myTurn()) return;
    const my = gen;
    ui = { ...ui, confirm: null };
    doPass(ME, my).then(() => { if (gen === my) loop(my); });
  }
  function tryPlay(k, node) {
    if (!myTurn() || ui.confirm) return;
    if (!S.legalKeys(game, ME).includes(k)) {
      soundNope();
      if (node) Fx.replay(node, "sevens-nope");
      return;
    }
    humanPlay(k);
  }
  /* After you are out of the round: plays the CPUs to the end at once. */
  function skipToEnd() {
    gen++;
    clearFlying();
    let g = game;
    for (let guard = 0; !g.over && guard < 300; guard++) {
      /* a smaller think budget so the whole rest of the game fits in one short pause */
      const m = S.cpuMove(g, settings.level, Math.random, SKIP_THINK);
      g = m.type === "play" ? S.play(g, m.key) : S.pass(g);
    }
    game = g;
    ui = { ...ui, wait: null, flying: [], bubble: null };
    finish();
  }
  function finish() {
    Music.stop();
    const ranks = S.ranking(game);
    const mine = ranks.find(x => x.seat === ME);
    saveRecord(mine.place);
    go({ phase: "result", wait: null, confirm: null, bubble: null, end: { ranks, mine } });
    Fx.pop(el.rank);
    if (mine.place === 1) {
      Sound.sfx("victory");
      stopConfetti = Fx.confetti();
    } else Sound.sfx("lose");
  }
  function quit() {
    gen++;
    clearFlying();
    Music.stop();
    go({ phase: "setup", wait: null, confirm: null, flying: [], bubble: null });
  }

  /* ---------- screens ---------- */
  function statusText() {
    if (ui.wait === "intro") return "カードを配りました";
    return game.turn === ME ? "あなたの番" : `${NAMES[game.turn]}の番`;
  }
  function hintText(mine, legal, left) {
    if (ui.wait === "cpu") return `${NAMES[game.turn]}が考え中…`;
    if (!mine) return "";
    if (legal.length) return "浮いているカードをタップして出そう";
    return left > 0 ? "出せるカードがありません。パスしよう" : "出せるカードもパスも残っていません";
  }
  function playView() {
    const quitBtn = makeButton("やめる", () => go({ confirm: "quit" }), "small");
    if (ui.confirm === "quit") {
      return { title: "やめますか？", hint: "このゲームは成績に残りません",
        actions: [makeButton("つづける", () => go({ confirm: null }), "small"), makeButton("やめる", quit, "primary danger")] };
    }
    if (ui.confirm === "out") {
      return { title: "パスすると脱落します", hint: `手札は全部場に並び、${S.PLAYERS - game.outs.length}位になります`,
        actions: [makeButton("やめておく", () => go({ confirm: null }), "small"), makeButton("脱落する", runPass, "primary danger")] };
    }
    if (game.over) return { title: "おしまい！", hint: "", actions: [makeButton("結果へ", skipToEnd, "primary")] };
    if (!humanIn()) {
      return { title: game.done.includes(ME) ? "あがり！ 残りを観戦中" : "脱落… 残りを観戦中", hint: "",
        actions: [quitBtn, makeButton("結果へ", skipToEnd, "primary")] };
    }
    const mine = myTurn();
    const legal = mine ? S.legalKeys(game, ME) : [];
    const left = S.passesLeft(game, ME);
    const stuck = mine && legal.length === 0;
    const passCls = stuck ? (left > 0 ? "primary" : "primary danger") : "";
    return {
      title: statusText(), hint: hintText(mine, legal, left),
      actions: [quitBtn, makeButton(left > 0 ? `パス（あと${left}回）` : "パス（脱落）", passTap, passCls, !mine)]
    };
  }
  function resultView() {
    const { mine } = ui.end;
    const title = mine.place === 1 ? "あなたが1位！" : mine.how === "out" ? `脱落… ${mine.place}位` : `あなたは${mine.place}位`;
    return { label: "結果", title, hint: recordText(),
      actions: [makeButton("設定", () => go({ phase: "setup" }), "small"), makeButton("もう一回", start, "primary")] };
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    play: playView,
    result: resultView
  };

  /* ---------- painting ---------- */
  function tagFor(seat) {
    const place = ui.end?.ranks.find(x => x.seat === seat);
    if (place) return { cls: place.place === 1 ? "sevens-done" : place.how === "out" ? "sevens-out" : "", text: `${place.place}位` };
    if (game.done.includes(seat)) return { cls: "sevens-done", text: `あがり${game.done.indexOf(seat) + 1}位` };
    if (game.outs.includes(seat)) return { cls: "sevens-out", text: "脱落" };
    if (ui.bubble === seat) return { cls: "sevens-pass", text: "パス" };
    if (ui.phase === "play" && game.turn === seat && ui.wait !== "intro") {
      return { cls: ui.wait === "cpu" ? "sevens-turn sevens-think" : "sevens-turn", text: ui.wait === "cpu" ? "考え中…" : "手番" };
    }
    return { cls: "", text: "" };
  }
  function paintSeat(box, seat) {
    const tag = tagFor(seat);
    const n = String(game.hands[seat].length);
    box.box.className = cls("sevens-seat", tag.cls);
    box.tag.textContent = tag.text;
    box.pips.forEach((p, i) => p.classList.toggle("on", i < game.passes[seat]));
    if (box.count.textContent !== n) {
      box.count.textContent = n;
      Fx.pop(box.count);
    }
  }
  function paintBoard() {
    const can = new Set(myTurn() && !ui.confirm ? S.legalKeys(game, ME) : []);
    const open = new Set(ui.phase === "play" ? S.openKeys(game) : []);
    const last = new Set(game.last && game.last.kind !== "pass" ? game.last.placed : []);
    slots.forEach((slot, k) => {
      const placed = game.board[k];
      const face = slot.querySelector(".pcard");
      if (placed && !face) {
        const card = Cards.el(S.cardOf(k), { size: "sm" });
        if (ui.deal) card.style.animationDelay = `${Math.floor(k / S.RANKS) * 110}ms`;
        card.addEventListener("animationend", () => card.classList.add("sevens-set"), { once: true });
        slot.appendChild(card);
      } else if (!placed && face) face.remove();
      slot.classList.toggle("sevens-on", placed);
      slot.classList.toggle("sevens-open", open.has(k));
      slot.classList.toggle("sevens-can", can.has(k));
      slot.classList.toggle("sevens-last", last.has(k) && ui.phase === "play");
    });
    const w = slots[0].clientWidth;
    if (w) el.board.style.setProperty("--sevens-sw", `${w}px`);
  }
  function makeHandCard(k, i) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls("sevens-hcard", ui.deal && "sevens-deal");
    b.dataset.k = String(k);
    if (ui.deal) {
      b.style.animationDelay = `${i * MS.deal}ms`;
      /* drop the class once dealt, or the deal replays whenever the screen is shown again */
      b.addEventListener("animationend", (e) => { if (e.target === b) b.classList.remove("sevens-deal"); });
    }
    b.appendChild(Cards.el(S.cardOf(k), { size: "md" }));
    return b;
  }
  /* Fans the hand: playable cards get more room, rise and sit on top of their neighbours. */
  function paintHand() {
    const keys = game.hands[ME].filter(k => !ui.flying.includes(k));
    [...handEls.keys()].filter(k => !game.hands[ME].includes(k)).forEach(k => {
      handEls.get(k).remove();
      handEls.delete(k);
    });
    game.hands[ME].forEach((k, i) => {
      if (handEls.has(k)) return;
      handEls.set(k, makeHandCard(k, i));
      el.hand.appendChild(handEls.get(k));
    });
    /* toggled both ways: a card left hidden by a flight that was cut short (leave()) must come back */
    handEls.forEach((b, k) => b.classList.toggle("sevens-gone", ui.flying.includes(k)));
    layoutHand(keys, new Set(myTurn() && !ui.confirm ? S.legalKeys(game, ME) : []));
  }
  function layoutHand(keys, can) {
    const W = el.hand.clientWidth || 320;
    const cw = Math.round(Math.min(64, Math.max(44, W / 5.6)));
    const weights = keys.map(k => (can.has(k) ? 1.9 : 1));
    const sum = weights.slice(0, -1).reduce((a, b) => a + b, 0);
    const unit = sum > 0 ? Math.min((W - cw) / sum, (cw + 4) / 1.9) : 0;
    let x = (W - (unit * sum + cw)) / 2;
    el.hand.style.setProperty("--sevens-cw", `${cw}px`);
    keys.forEach((k, i) => {
      const b = handEls.get(k);
      const t = (x + cw / 2 - W / 2) / (W / 2);
      b.style.setProperty("--x", `${x.toFixed(1)}px`);
      b.style.setProperty("--rot", `${(t * 8).toFixed(2)}deg`);
      b.style.setProperty("--y", `${(t * t * 10).toFixed(1)}px`);
      b.style.zIndex = String(can.has(k) ? 30 + i : i);
      b.classList.toggle("sevens-can", can.has(k));
      b.classList.toggle("sevens-dim", can.size > 0 && !can.has(k));
      b.setAttribute("aria-label", `${S.label(k)}${can.has(k) ? "（出せる）" : ""}`);
      x += unit * weights[i];
    });
  }
  function paintRank() {
    el.rank.replaceChildren(...ui.end.ranks.map(r => {
      const li = document.createElement("li");
      li.className = cls(r.seat === ME && "sevens-you", r.place === 1 && "ok", r.how === "out" && "ng");
      li.innerHTML = `<span class="pos"></span><span class="who"></span><span class="mark"></span><span class="num"></span>`;
      const left = game.hands[r.seat].length;
      li.querySelector(".pos").textContent = `${r.place}位`;
      li.querySelector(".who").textContent = NAMES[r.seat];
      li.querySelector(".mark").textContent = r.how === "done" ? "あがり" : r.how === "out" ? "脱落" : "";
      li.querySelector(".num").textContent = r.how === "last" ? `のこり${left}枚` : "";
      return li;
    }));
  }
  function renderPlay() {
    if (!game) return;
    const result = ui.phase === "result";
    seatEls.forEach((box, seat) => paintSeat(box, seat));
    paintBoard();
    el.me.hidden = result;
    el.hand.hidden = result || !humanIn();
    el.rank.hidden = !result;
    if (result) paintRank();
    else paintHand();
  }
  function rulesList() {
    return [
      "4人に13枚ずつ配る。7は最初に場に並び、ダイヤの7を持っていた人からスタート",
      "場にあるカードのとなり（同じマークで1つ上か下）を、1枚ずつ出していく",
      `出せないときや出したくないときはパス。パスは${S.MAX_PASSES}回まで、4回目で脱落して手札は全部場に並ぶ`,
      "手札を早くなくした順に1位、2位…。脱落した人はその下（先に脱落した人ほど下）",
      settings.tunnel ? "トンネルあり：Aが出たらK、Kが出たらAにつなげて出せる" : "トンネルなし：AとKで行き止まり"
    ];
  }
  function renderSetup() {
    View.chips($("svLevelChips"), View.options(S.LEVELS, l => LEVEL_LABEL[l]), settings.level, v => update({ level: v }));
    View.chips($("svTunnelChips"), [{ value: false, label: "なし" }, { value: true, label: "あり" }], settings.tunnel, v => update({ tunnel: v }));
    View.list($("svRules"), rulesList());
    View.text(el.record, recordText());
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    else renderPlay();
    View.stage(el, SCREENS[ui.phase]());
  }

  /* ---------- building ---------- */
  function buildBoard() {
    slots = S.DECK.map((card, k) => {
      const slot = document.createElement("div");
      slot.className = cls("sevens-slot", Cards.isRed(card) && "sevens-red");
      slot.dataset.k = String(k);
      slot.innerHTML = `<span class="sevens-ghost"><b>${card.rank}</b>${Cards.suitSvg(card.suit)}</span>`;
      return slot;
    });
    el.board.replaceChildren(...[0, 1, 2, 3].map(row => {
      const div = document.createElement("div");
      div.className = "sevens-row";
      div.append(...slots.slice(row * S.RANKS, (row + 1) * S.RANKS));
      return div;
    }));
  }
  function buildSeat(seat) {
    const box = document.createElement("div");
    box.style.setProperty("--seat", `var(${COLORS[seat][0]})`);
    box.style.setProperty("--seat-ink", `var(${COLORS[seat][1]})`);
    box.innerHTML = `<span class="sevens-ava"></span><span class="sevens-name"></span><span class="sevens-stack"><b class="sevens-count"></b></span>`
      + `<span class="sevens-pips"><i></i><i></i><i></i></span><span class="sevens-tag"></span>`;
    box.querySelector(".sevens-ava").textContent = NAMES[seat].slice(0, 1);
    box.querySelector(".sevens-name").textContent = NAMES[seat];
    const stack = box.querySelector(".sevens-stack");
    stack.prepend(Cards.el(null, { faceDown: true, size: "sm" }));
    (seat === ME ? el.me : el.seats).appendChild(box);
    return { box, stack, count: box.querySelector(".sevens-count"), tag: box.querySelector(".sevens-tag"), pips: [...box.querySelectorAll(".sevens-pips i")] };
  }
  /* Next frame, not inside the observer: re-laying the hand changes its height, which would re-trigger the observer
   * in the same frame ("ResizeObserver loop completed with undelivered notifications"). */
  function onResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (ui.phase === "play" && game && el.hand.clientWidth) paintHand();
      if (ui.phase !== "setup" && game) paintBoard();
    });
  }
  function init() {
    settings = normalize(Store.load(KEY, {}));
    buildBoard();
    seatEls = [0, 1, 2, 3].map(buildSeat);
    el.hand.addEventListener("click", (e) => {
      const b = e.target.closest(".sevens-hcard");
      if (!b) return;
      e.stopPropagation(); /* the card sounds replace the app's generic button tap */
      tryPlay(Number(b.dataset.k), b);
    });
    el.board.addEventListener("click", (e) => {
      const slot = e.target.closest(".sevens-slot.sevens-can");
      if (slot) tryPlay(Number(slot.dataset.k), null);
    });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(onResize).observe(el.play);
    else window.addEventListener("resize", onResize);
    render();
  }
  /* Leaving mid-game pauses it; coming back picks up where it stopped. */
  function leave() {
    gen++;
    cancelAnimationFrame(resizeFrame);
    clearFlying();
    Music.stop();
    if (ui.phase === "play") ui = { ...ui, wait: null, confirm: null, flying: [], bubble: null };
  }
  function onShow() {
    if (ui.phase !== "play" || !game) return;
    if (game.over) { /* it ended while you were away (during the last banner): show the result now */
      gen++;
      finish();
      return;
    }
    Music.play("think");
    const my = ++gen;
    render();
    loop(my);
  }

  return { init, leave, onShow };
})();

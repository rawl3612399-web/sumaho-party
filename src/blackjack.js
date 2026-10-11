/* Blackjack screen: you against the dealer on a felt table, with chips, a 6-deck shoe and dealt-card animations. */
const Blackjack = (() => {
  const R = BlackjackRules;
  const KEY = "blackjack.settings";
  const BANK_KEY = "blackjack.bank";
  const T = Object.freeze({ gap: 240, slide: 300, flip: 330, rest: 160, peek: 950, shuffle: 1500, dealer: 520, count: 700 });
  const ACTION_LABEL = Object.freeze({ hit: "ヒット", stand: "スタンド", double: "ダブル", split: "スプリット" });
  const ACTION_CLASS = Object.freeze({ hit: "primary", stand: "primary danger", double: "", split: "" });
  const OUTCOME = Object.freeze({ blackjack: "ブラックジャック！", win: "勝ち", lose: "負け", push: "引き分け", bust: "バースト" });
  const TITLE = Object.freeze({ blackjack: "ブラックジャック！", win: "勝ち！", lose: "負け…", push: "引き分け", bust: "バースト…" });
  const NOTE = Object.freeze({ shuffle: "シャッフル中…", peek: "ディーラーがブラックジャックか確認中…", "": "" });
  const RULES = Object.freeze([
    "合計を21に近づけて、ディーラーより大きければ勝ち。Aは1か11、J・Q・Kは10と数える",
    "21をこえたらバーストで負け。最初の2枚で21ならブラックジャックで、賭けの1.5倍もらえる",
    "ヒットでもう1枚、スタンドで勝負。ダブルは賭けを2倍にして1枚だけ引く。同じ札の2枚（8と8、KとKなど）はスプリットで2つの手に分けられる（1回まで。Aは1枚ずつ）",
    "ディーラーは16以下なら引き、17以上で止まる（Aを11と数える17でも止まる）。6組のカードを使い、4分の3を配ったらシャッフル",
    "インシュランスとサレンダーはなし。1回に10〜5,000枚まで賭けられる"
  ]);

  const el = {
    setup: $("jSetup"), play: $("jPlay"), label: $("jLabel"), title: $("jTitle"), hint: $("jHint"), actions: $("jActions"),
    purse: $("jPurse"), record: $("jRecord"), chips: $("jChips"), bet: $("jBet"), shoe: $("jShoe"),
    shoeFill: $("jShoeFill"), shoeLeft: $("jShoeLeft"), dealerCards: $("jDealerCards"), dealerTotal: $("jDealerTotal"),
    hands: $("jHands"), shuffle: $("jShuffle"), chipBar: $("jChipBar"), betOps: $("jBetOps")
  };

  let settings = { hint: false };
  let bank = R.normalizeBank(null);
  let shoe = null;
  let round = null; /* the real round */
  let shown = null; /* the round as totals and banners show it; catches up after each animation */
  let ui = { phase: "setup", bet: 0, busy: false, hole: true, note: "", paused: false };
  let timers = [];
  let nodes = new Map(); /* card id -> card element on the table */
  let boxes = [];
  let discs = [];
  let ops = null;
  let counter = { value: 0, target: 0, frame: 0 };

  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (n) => n.toLocaleString("ja-JP");
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : "±0");
  const paidBack = (r) => (r.results || []).reduce((sum, x) => sum + x.ret, 0);
  const live = () => Boolean(round) && ["deal", "play", "dealer", "result"].includes(ui.phase);

  function go(patch) {
    ui = { ...ui, ...patch };
    render();
  }
  function later(fn, ms) {
    const id = setTimeout(() => {
      timers = timers.filter(t => t !== id);
      fn();
    }, ms);
    timers = [...timers, id];
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  function update(patch) {
    settings = { hint: patch.hint === true };
    Store.save(KEY, settings);
    render();
  }
  function saveBank(patch) {
    const next = { ...bank, ...patch };
    bank = R.normalizeBank({ ...next, best: Math.max(bank.best, next.chips) });
    Store.save(BANK_KEY, bank);
  }
  function setRound(next) {
    round = next;
    shoe = next.shoe;
  }

  /* ---------- sounds (built from the synth primitives) ---------- */
  const now = () => (Sound.ctx() ? Sound.ctx().currentTime : null);
  function clack(t, pitch = 1) {
    Sound.tone({ freq: 2900 * pitch, type: "triangle", t, dur: 0.04, vol: 0.12 });
    Sound.tone({ freq: 4400 * pitch, type: "sine", t: t + 0.006, dur: 0.03, vol: 0.05 });
    Sound.hiss({ t, dur: 0.035, vol: 0.09, type: "bandpass", freq: 5200, q: 2.5 });
  }
  function chipSound(count = 1, pitch = 1, start = 0) {
    const t = now();
    if (t === null) return;
    for (let k = 0; k < count; k++) clack(t + start + k * 0.055 + Math.random() * 0.012, pitch * (1 - k * 0.025));
  }
  function snap(t) {
    Sound.hiss({ t, dur: 0.045, vol: 0.16, type: "highpass", freq: 2800 });
    Sound.tone({ freq: 620, glide: 300, type: "triangle", t, dur: 0.07, vol: 0.07 });
  }
  function cardSound(delayMs, flip) {
    const t = now();
    if (t === null) return;
    const s = t + delayMs / 1000;
    Sound.hiss({ t: s, dur: 0.2, vol: 0.12, type: "bandpass", freq: 700, to: 3400, q: 0.9, attack: 0.05 });
    if (flip) snap(s + T.slide / 1000);
  }
  function riffle() {
    const t = now();
    if (t === null) return;
    [0, 0.65].forEach(off => {
      for (let k = 0; k < 22; k++) {
        Sound.hiss({ t: t + off + k * 0.021, dur: 0.028, vol: 0.05 + k * 0.004, type: "bandpass", freq: 2400 + (k % 5) * 380, q: 1.4 });
      }
      Sound.hiss({ t: t + off + 0.5, dur: 0.16, vol: 0.14, type: "bandpass", freq: 1300, to: 420, q: 0.8 });
    });
  }
  function knock() {
    const t = now();
    if (t === null) return;
    [0, 0.11].forEach(d => Sound.tone({ freq: 170, glide: 90, type: "sine", t: t + d, dur: 0.09, vol: 0.32 }));
  }
  function peekSound() {
    const t = now();
    if (t === null) return;
    [0, 0.32].forEach(d => Sound.tone({ freq: 1320, type: "triangle", t: t + 0.15 + d, dur: 0.05, vol: 0.06 }));
  }
  function lossSound() {
    const t = now();
    if (t === null) return;
    Sound.tone({ freq: Sound.hz(64), type: "triangle", t, dur: 0.16, vol: 0.12 });
    Sound.tone({ freq: Sound.hz(57), type: "triangle", t: t + 0.15, dur: 0.45, vol: 0.12, send: 0.15 });
    Sound.hiss({ t: t + 0.1, dur: 0.35, vol: 0.08, type: "bandpass", freq: 3000, to: 900, q: 0.8, attack: 0.08 });
  }

  /* ---------- cards on the table ---------- */
  function reveal(node, card) {
    Cards.setFaceDown(node, false);
    node.setAttribute("aria-label", Cards.label(card));
  }
  /* Every card on the table in dealing order: hands then dealer, one card each per pass. */
  function tableCards() {
    const seats = [...round.hands.map(h => h.cards), round.dealer];
    const dealerSeat = seats.length - 1;
    return seats.flatMap((cards, si) => cards.map((card, k) => ({
      card, order: k * seats.length + si, faceUp: !(si === dealerSeat && k === 1 && ui.hole)
    })));
  }
  function overlap(n, split) {
    const steps = split ? [0, 0, 0.2, 0.42, 0.52, 0.6, 0.66, 0.7, 0.74] : [0, 0, 0.15, 0.25, 0.38, 0.5, 0.58, 0.64, 0.7];
    return -steps[Math.min(n, steps.length - 1)];
  }
  function setOverlaps() {
    const split = round.hands.length > 1;
    el.dealerCards.style.setProperty("--bj-ov", overlap(round.dealer.length, false));
    round.hands.forEach((h, i) => boxes[i].cards.style.setProperty("--bj-ov", overlap(h.cards.length, split)));
  }
  /* Places every card element where the round says; new cards slide in from the shoe. Returns the animation time. */
  function paintTable(instant = false) {
    const before = new Map([...nodes].filter(([, n]) => n.isConnected).map(([id, n]) => [id, n.getBoundingClientRect()]));
    const all = tableCards();
    const fresh = all.filter(x => !nodes.has(x.card.id)).sort((a, b) => a.order - b.order);
    nodes = new Map([...nodes, ...fresh.map(x => [x.card.id, Cards.el(x.card, { faceDown: true })])]);
    ensureBoxes(round.hands.length);
    el.hands.classList.toggle("blackjack-split", round.hands.length > 1);
    el.dealerCards.replaceChildren(...round.dealer.map(c => nodes.get(c.id)));
    round.hands.forEach((h, i) => boxes[i].cards.replaceChildren(...h.cards.map(c => nodes.get(c.id))));
    setOverlaps();
    if (instant) return settleFaces(all);
    slideMoved(before);
    return dealFresh(fresh);
  }
  function dealFresh(fresh) {
    const gap = reduced() ? 140 : T.gap;
    fresh.forEach((x, k) => {
      const node = nodes.get(x.card.id);
      const delay = k * gap;
      slideIn(node, delay);
      cardSound(delay, x.faceUp);
      if (x.faceUp) later(() => reveal(node, x.card), delay + T.slide);
    });
    return fresh.length ? (fresh.length - 1) * gap + T.slide + T.flip : T.rest;
  }
  function slideIn(node, delay) {
    if (reduced() || !node.animate) return;
    const a = node.getBoundingClientRect();
    const s = el.shoe.getBoundingClientRect();
    const dx = s.left + s.width / 2 - (a.left + a.width / 2);
    const dy = s.top + s.height / 2 - (a.top + a.height / 2);
    node.animate([{ transform: `translate(${dx}px, ${dy}px) rotate(-28deg) scale(.6)` }, { transform: "none" }],
      { duration: T.slide, delay, easing: "cubic-bezier(.2, .75, .25, 1)", fill: "backwards" });
  }
  /* Cards that moved (a split, or a hand re-centering) glide to their new place. */
  function slideMoved(before) {
    if (reduced()) return;
    nodes.forEach((node, id) => {
      const b = before.get(id);
      if (!b || !node.isConnected || !node.animate) return;
      const a = node.getBoundingClientRect();
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 280, easing: "ease-out" });
    });
  }
  function settleFaces(all) {
    all.forEach(x => {
      const node = nodes.get(x.card.id);
      if (node.getAnimations) node.getAnimations().forEach(a => a.finish());
      if (x.faceUp) reveal(node, x.card);
      else Cards.setFaceDown(node, true);
    });
    return 0;
  }
  /* Old cards fly off to the discard side. Returns how long to wait before dealing again. */
  function sweep() {
    const old = [...nodes.values()].filter(n => n.isConnected);
    nodes = new Map();
    if (reduced() || !old.length) {
      old.forEach(n => n.remove());
      return 0;
    }
    old.forEach((node, i) => {
      const anim = node.animate([{ transform: "none", opacity: 1 }, { transform: "translate(-130px, -110px) rotate(-40deg) scale(.6)", opacity: 0 }],
        { duration: 300, delay: i * 30, easing: "cubic-bezier(.5, 0, .8, .4)", fill: "forwards" });
      anim.onfinish = () => node.remove();
    });
    Sound.hiss({ dur: 0.35, vol: 0.1, type: "bandpass", freq: 2600, to: 700, q: 0.8, attack: 0.06 });
    return 300 + (old.length - 1) * 30 + 60;
  }
  function clearTable() {
    nodes.forEach(n => n.remove());
    nodes = new Map();
    ensureBoxes(1);
    el.hands.classList.remove("blackjack-split");
  }

  /* ---------- hand boxes (cards, total, stake, result banner) ---------- */
  function makeBox() {
    const root = document.createElement("div");
    root.className = "blackjack-hand";
    root.innerHTML = '<div class="blackjack-cards"></div><div class="blackjack-foot"><span class="blackjack-total" hidden></span>' +
      '<span class="blackjack-stake"><span class="blackjack-stack"></span><b></b></span></div><span class="blackjack-banner" hidden></span>';
    const q = (s) => root.querySelector(s);
    return { root, cards: q(".blackjack-cards"), total: q(".blackjack-total"), stake: q(".blackjack-stake"),
      stack: q(".blackjack-stack"), amount: q(".blackjack-stake b"), banner: q(".blackjack-banner") };
  }
  function ensureBoxes(n) {
    if (boxes.length === n) return;
    boxes = Array.from({ length: n }, (_, i) => boxes[i] || makeBox());
    el.hands.replaceChildren(...boxes.map(b => b.root));
  }
  function mini(v, k) {
    const i = document.createElement("i");
    i.className = "blackjack-mini";
    i.dataset.v = String(v);
    i.style.setProperty("--k", String(k));
    return i;
  }
  function paintStake(b, amount) {
    if (b.stake.dataset.amount === String(amount)) return;
    const grew = amount > Number(b.stake.dataset.amount || 0);
    const list = R.chipStack(amount).slice(0, 8);
    b.stake.dataset.amount = String(amount);
    b.stack.style.setProperty("--bj-n", String(Math.max(1, list.length)));
    b.stack.replaceChildren(...list.map(mini));
    b.amount.textContent = amount ? fmt(amount) : "";
    if (grew) Fx.pop(b.stack);
  }
  function paintTotal(node, cards, natural, finished) {
    node.hidden = !cards || cards.length === 0;
    if (node.hidden) return;
    const v = R.handValue(cards);
    node.textContent = R.totalLabel(cards, finished);
    node.className = "blackjack-total" + (v.bust ? " blackjack-bust" : natural ? " blackjack-bj" : v.total === 21 ? " blackjack-21" : "");
  }
  function bannerFor(h, i) {
    const res = ui.phase === "result" && shown.results ? shown.results[i] : null;
    if (res) return { kind: res.outcome, text: res.net > 0 ? `${OUTCOME[res.outcome]} ${signed(res.net)}` : OUTCOME[res.outcome] };
    return R.handValue(h.cards).bust ? { kind: "bust", text: OUTCOME.bust } : null;
  }
  function paintBanner(b, info, i) {
    const key = info ? `${info.kind}:${info.text}` : "";
    if (b.banner.dataset.key === key) return;
    b.banner.dataset.key = key;
    b.banner.hidden = !info;
    b.root.dataset.out = info ? info.kind : "";
    if (!info) return;
    b.banner.textContent = info.text;
    b.banner.dataset.kind = info.kind;
    b.banner.style.setProperty("--bj-delay", `${i * 180}ms`);
    Fx.replay(b.banner, "blackjack-in");
  }
  function paintHands() {
    const betting = ui.phase === "bet";
    el.hands.classList.toggle("blackjack-betting", betting);
    boxes.forEach((b, i) => {
      const h = !betting && shown ? shown.hands[i] : null;
      const stakeHand = !betting && round ? round.hands[i] : null;
      paintStake(b, betting ? (i === 0 ? ui.bet : 0) : stakeHand ? stakeHand.bet : 0);
      paintTotal(b.total, h ? h.cards : null, h ? R.isNatural(h) : false, Boolean(h && h.done));
      paintBanner(b, h ? bannerFor(h, i) : null, i);
      const turn = ui.phase === "play" && shown && shown.hands.length > 1;
      b.root.classList.toggle("blackjack-active", Boolean(turn && i === shown.active));
      b.root.classList.toggle("blackjack-waiting", Boolean(turn && i !== shown.active));
    });
  }
  function paintDealer() {
    const d = shown && ui.phase !== "bet" ? shown.dealer : null;
    const open = Boolean(d) && !ui.hole;
    paintTotal(el.dealerTotal, d ? (ui.hole ? d.slice(0, 1) : d) : null, open && R.isBlackjack(d), open && !R.dealerShouldHit(d));
  }

  /* ---------- chip counter, shoe, bet controls ---------- */
  function countChips(target) {
    if (target === counter.target) return;
    cancelAnimationFrame(counter.frame);
    const from = counter.value;
    const t0 = performance.now();
    const dur = reduced() ? 1 : T.count;
    const step = (time) => {
      const p = Math.min(1, (time - t0) / dur);
      const value = Math.round(from + (target - from) * (1 - (1 - p) ** 3));
      el.chips.textContent = fmt(value);
      counter = { ...counter, value, frame: p < 1 ? requestAnimationFrame(step) : 0 };
    };
    counter = { value: from, target, frame: requestAnimationFrame(step) };
    if (ui.phase === "result") Fx.replay(el.chips, target > from ? "blackjack-up" : "blackjack-down");
  }
  function paintBank() {
    const free = ui.phase === "bet" ? bank.chips - ui.bet : !live() ? bank.chips
      : ui.phase === "result" ? round.chips : round.chips - paidBack(round);
    const bet = ui.phase === "bet" ? ui.bet : live() ? R.staked(round) : 0;
    countChips(free);
    if (el.bet.textContent !== fmt(bet)) {
      el.bet.textContent = fmt(bet);
      Fx.pop(el.bet);
    }
  }
  function paintShoe() {
    const size = shoe ? shoe.cards.length : R.DECKS * 52;
    const left = shoe ? R.remaining(shoe) : size;
    el.shoeFill.style.width = `${(left / size) * 100}%`;
    el.shoeLeft.textContent = `のこり${left}枚`;
  }
  function paintBetControls() {
    discs.forEach(d => { d.disabled = !R.canAddChip(ui.bet, Number(d.dataset.v), bank.chips); });
    const again = R.repeatBet(bank.last, bank.chips);
    ops.clear.disabled = ui.bet === 0;
    ops.repeat.disabled = again === 0 || again === ui.bet;
  }
  function flyChip(from, v) {
    if (reduced() || !document.body.animate) return;
    const a = from.getBoundingClientRect();
    const b = boxes[0].stack.getBoundingClientRect();
    const chip = mini(v, 0);
    chip.classList.add("blackjack-fly");
    chip.style.left = `${a.left + a.width / 2 - 12}px`;
    chip.style.top = `${a.top + a.height / 2 - 12}px`;
    document.body.appendChild(chip);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.bottom - 12 - (a.top + a.height / 2);
    chip.animate([{ transform: "scale(2.2)" }, { transform: `translate(${dx}px, ${dy}px) scale(1)` }],
      { duration: 280, easing: "cubic-bezier(.3, .7, .4, 1)" }).onfinish = () => chip.remove();
  }
  function addChip(v, button, index) {
    if (ui.phase !== "bet" || !R.canAddChip(ui.bet, v, bank.chips)) return;
    Sound.ensure();
    chipSound(1 + Math.min(index, 2), 1.08 - index * 0.06);
    flyChip(button, v);
    go({ bet: ui.bet + v });
  }
  function clearBet() {
    if (ui.phase !== "bet" || ui.bet === 0) return;
    chipSound(3, 0.85);
    go({ bet: 0 });
  }
  function repeatLast() {
    const again = R.repeatBet(bank.last, bank.chips);
    if (ui.phase !== "bet" || again === 0) return;
    chipSound(3, 1);
    go({ bet: again });
  }

  /* ---------- flow ---------- */
  function enter() {
    Sound.ensure();
    Awake.keep();
    Sound.sfx("confirm");
    Music.play("think");
    clearTable();
    go({ phase: "bet", bet: 0, busy: false, hole: true, note: "" });
  }
  function toBet() {
    clearTimers();
    const wait = sweep();
    shown = null;
    go({ phase: "bet", bet: 0, busy: false, hole: true, note: "" });
    later(() => { clearTable(); render(); }, wait);
  }
  function toSetup() {
    clearTimers();
    clearTable();
    shown = null;
    Music.stop();
    go({ phase: "setup", bet: 0, busy: false, note: "" });
  }
  function resetChips() {
    Sound.ensure();
    saveBank({ chips: R.START_CHIPS, last: 0 });
    Sound.sfx("fanfare");
    chipSound(6, 1, 0.3);
    toBet();
  }
  function deal() {
    const bet = ui.phase === "result" ? R.repeatBet(bank.last, bank.chips) : ui.bet;
    if (!["bet", "result"].includes(ui.phase) || ui.busy || !R.validBet(bank.chips, bet)) return;
    Sound.ensure();
    Awake.keep();
    let next;
    try {
      next = R.startRound({ shoe, chips: bank.chips, bet });
    } catch (e) {
      console.error("ブラックジャック: カードを配れませんでした", e);
      Sound.sfx("wrong");
      return;
    }
    clearTimers();
    const wait = sweep();
    setRound(next);
    shown = null;
    saveBank({ chips: next.chips, last: bet });
    chipSound(3, 0.92);
    go({ phase: "deal", bet, busy: true, hole: true, note: next.shuffled ? "shuffle" : "" });
    later(next.shuffled ? shuffleShoe : dealCards, wait);
  }
  function shuffleShoe() {
    el.shuffle.hidden = false;
    Fx.replay(el.shuffle, "blackjack-on");
    riffle();
    later(() => {
      el.shuffle.hidden = true;
      go({ note: "" });
      dealCards();
    }, reduced() ? 700 : T.shuffle);
  }
  function dealCards() {
    const ms = paintTable();
    later(afterDeal, ms + T.rest);
  }
  function afterDeal() {
    shown = round;
    if (!round.peeked) {
      afterPeek();
      return;
    }
    go({ note: "peek" });
    const node = nodes.get(round.dealer[1].id);
    if (node) Fx.replay(node, "blackjack-peek");
    peekSound();
    later(afterPeek, T.peek);
  }
  function afterPeek() {
    if (round.phase === "done") {
      finish();
      return;
    }
    go({ phase: "play", busy: false, note: "" });
  }
  function doAction(action) {
    if (ui.phase !== "play" || ui.busy || !R.legalActions(round).includes(action)) return;
    const before = round;
    setRound(R.act(round, action));
    if (action === "double" || action === "split") chipSound(3, 0.95);
    if (action === "stand") knock();
    const ms = paintTable(); /* before render, so a new split hand gets its stake drawn at once */
    go({ busy: true });
    later(() => afterAction(before), ms + T.rest);
  }
  function afterAction(before) {
    shown = round;
    const bustNow = round.hands.some((h, i) => R.handValue(h.cards).bust && !(before.hands[i] && R.handValue(before.hands[i].cards).bust));
    if (bustNow) Sound.sfx("wrong");
    if (round.phase === "player") go({ busy: false });
    else if (round.phase === "dealer") dealerTurn();
    else finish();
  }
  function revealHole() {
    if (!ui.hole) return false;
    ui = { ...ui, hole: false };
    const node = round ? nodes.get(round.dealer[1].id) : null;
    if (node) reveal(node, round.dealer[1]);
    const t = now();
    if (t !== null) snap(t);
    return true;
  }
  function dealerTurn() {
    revealHole();
    go({ phase: "dealer", busy: true });
    later(dealerNext, T.flip + T.dealer);
  }
  function dealerNext() {
    if (round.phase !== "dealer") {
      finish();
      return;
    }
    setRound(R.dealerStep(round));
    if (round.phase === "done") {
      finish();
      return;
    }
    const ms = paintTable();
    later(() => {
      shown = round;
      render();
      later(dealerNext, T.dealer);
    }, ms);
  }
  function finish() {
    const flipped = revealHole();
    if (flipped) render();
    later(showResult, flipped ? T.flip + 200 : 0);
  }
  function showResult() {
    shown = round;
    saveBank({ chips: round.chips });
    go({ phase: "result", busy: false, note: "" });
    celebrate();
  }
  function celebrate() {
    const res = round.results;
    const net = R.roundNet(round);
    if (res.some(x => x.outcome === "blackjack")) {
      Sound.sfx("victory");
      Fx.confetti();
    } else if (net > 0) {
      Sound.sfx("coin");
      chipSound(6, 1.05, 0.25);
    } else if (net === 0) {
      Sound.sfx("pop");
    } else if (!res.every(x => x.outcome === "bust")) {
      lossSound();
      if (R.isBlackjack(round.dealer)) Fx.flash("--alert", 350);
    }
    if (R.isBroke(round.chips)) {
      later(() => {
        Sound.sfx("lose");
        Fx.shake();
      }, 700);
    }
  }

  /* ---------- screens ---------- */
  function playButtons(on) {
    const legal = on ? R.legalActions(round) : [];
    const rec = on && settings.hint ? R.recommend(round) : null;
    return R.ACTIONS.map(a => {
      const b = makeButton(ACTION_LABEL[a], () => doAction(a), ACTION_CLASS[a], !legal.includes(a));
      if (a === rec) b.classList.add("blackjack-rec");
      return b;
    });
  }
  const resetButtons = () => [makeButton("設定", toSetup, "small"), makeButton(`${fmt(R.START_CHIPS)}枚でやりなおす`, resetChips, "primary")];
  function betView() {
    if (R.isBroke(bank.chips)) return { title: "チップがなくなりました", hint: "もう一度、最初のチップから遊べます", actions: resetButtons() };
    return {
      title: ui.bet ? `${fmt(ui.bet)}枚 賭ける` : "チップをタップして賭けよう",
      actions: [makeButton("設定", toSetup, "small"), makeButton("配る", deal, "primary", !R.validBet(bank.chips, ui.bet))]
    };
  }
  function playView() {
    const rec = settings.hint && !ui.busy ? R.recommend(round) : null;
    const split = round.hands.length > 1;
    return {
      title: split ? `${round.active + 1}つ目の手` : "あなたの番",
      hint: rec ? `ヒント：ここは「${ACTION_LABEL[rec]}」がおすすめ` : "こえないように21に近づけよう",
      actions: playButtons(!ui.busy)
    };
  }
  function dealerLine() {
    const v = R.handValue(round.dealer);
    return `ディーラー ${R.isBlackjack(round.dealer) ? "ブラックジャック" : v.bust ? "バースト" : v.total}`;
  }
  function resultTitle() {
    const net = R.roundNet(round);
    if (round.results.length > 1) return `合計 ${signed(net)}枚`;
    const kind = round.results[0].outcome;
    if (kind === "lose" && R.isBlackjack(round.dealer)) return `ディーラーがブラックジャック… ${signed(net)}枚`;
    return net === 0 ? `${TITLE[kind]}（賭けは戻ります）` : `${TITLE[kind]} ${signed(net)}枚`;
  }
  function resultView() {
    if (R.isBroke(bank.chips)) return { label: dealerLine(), title: resultTitle(), hint: "チップがなくなりました", actions: resetButtons() };
    return {
      label: dealerLine(),
      title: resultTitle(),
      hint: `「もう一回」で、また${fmt(R.repeatBet(bank.last, bank.chips))}枚賭けて配ります`,
      actions: [makeButton("設定", toSetup, "small"), makeButton("賭けなおす", toBet, "small"), makeButton("もう一回", deal, "primary")]
    };
  }
  const SCREENS = {
    setup: () => ({ actions: [makeButton("テーブルにつく", enter, "primary")] }),
    bet: betView,
    deal: () => ({ title: NOTE[ui.note] || "", actions: playButtons(false) }),
    play: playView,
    dealer: () => ({ title: "ディーラーの番", hint: "ディーラーは17以上になるまで引きます", actions: playButtons(false) }),
    result: resultView
  };

  function renderSetup() {
    View.chips($("jHintChips"), [{ value: false, label: "なし" }, { value: true, label: "あり" }], settings.hint, v => update({ hint: v }));
    View.list($("jRules"), RULES);
    el.purse.textContent = fmt(bank.chips);
    View.text(el.record, bank.best > R.START_CHIPS ? `これまでの最高：${fmt(bank.best)}枚` : "");
  }
  function renderTable() {
    paintBank();
    paintShoe();
    paintDealer();
    paintHands();
    const betting = ui.phase === "bet" && !R.isBroke(bank.chips);
    el.chipBar.hidden = !betting;
    el.betOps.hidden = !betting;
    if (betting) paintBetControls();
    el.actions.classList.toggle("blackjack-grid", ["deal", "play", "dealer"].includes(ui.phase));
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    else renderTable();
    View.stage(el, SCREENS[ui.phase]());
  }

  function makePill(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "blackjack-pill";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
  function buildChipBar() {
    discs = R.CHIP_VALUES.map((v, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "blackjack-disc";
      b.dataset.v = String(v);
      b.textContent = String(v);
      b.setAttribute("aria-label", `${v}枚のチップを置く`);
      b.addEventListener("click", (e) => {
        e.stopPropagation(); /* the chip clack replaces the app's generic button tap */
        addChip(v, b, i);
      });
      return b;
    });
    el.chipBar.replaceChildren(...discs);
    ops = { clear: makePill("クリア", clearBet), repeat: makePill("同じ額", repeatLast) };
    el.betOps.replaceChildren(ops.clear, ops.repeat);
  }
  function init() {
    const saved = Store.load(KEY, {});
    settings = { hint: Boolean(saved && typeof saved === "object" && saved.hint === true) };
    bank = R.normalizeBank(Store.load(BANK_KEY, null));
    counter = { value: bank.chips, target: bank.chips, frame: 0 };
    el.chips.textContent = fmt(bank.chips);
    buildChipBar();
    ensureBoxes(1);
    render();
  }
  /* Leaving mid-round pauses it; coming back picks up where it stopped. */
  function leave() {
    clearTimers();
    if (ui.phase !== "setup") ui = { ...ui, paused: true };
  }
  function resume() {
    ui = { ...ui, paused: false, note: "" };
    el.shuffle.hidden = true;
    if (!round || ui.phase === "bet" || ui.phase === "result") {
      if (ui.phase === "bet") clearTable();
      render();
      return;
    }
    paintTable(true);
    shown = round;
    if (round.phase === "player") go({ phase: "play", busy: false, note: "" });
    else if (round.phase === "dealer") dealerTurn();
    else finish();
  }
  function onShow() {
    if (ui.phase === "setup") {
      render();
      return;
    }
    Music.play("think");
    if (ui.paused) resume();
  }

  return { init, leave, onShow };
})();

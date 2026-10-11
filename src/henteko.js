/* Silly-creature naming screen: flip cards onto the pile, name new creatures, race to shout known names, take the pile. */
const Henteko = (() => {
  const H = HentekoRules;
  const KEY = "henteko.settings";
  const DRUM_S = 1.6;
  const FLY_MS = 560;
  const FLY_GAP = 70;
  const MAX_FLY = 6;
  const MAX_LAYERS = 4;
  const INTENSE_LEFT = 8;
  const GUARD_MS = 400; /* a double tap must not press the next screen's button too */

  const el = {
    setup: $("uSetup"), play: $("uPlay"), label: $("uLabel"), title: $("uTitle"), hint: $("uHint"), actions: $("uActions"),
    hero: $("uHero"), table: $("uTable"), deck: $("uDeck"), deckCount: $("uDeckCount"), wrap: $("uPileWrap"), pile: $("uPile"),
    badge: $("uBadge"), pileCount: $("uPileCount"), seats: $("uSeats"), list: $("uList"), gallery: $("uGallery")
  };

  let settings = { players: 4, kinds: 8 };
  let ui = { phase: "setup", note: "", guard: 0 };
  let game = null;
  let prev = null;
  let svgs = [];
  let seatButtons = [];
  let timers = [];
  let flights = [];

  const S = (i) => View.seat(i);
  const f = (n) => Math.round(n * 10) / 10;
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const later = (fn, ms) => { timers = [...timers, setTimeout(fn, ms)]; };
  const settled = () => performance.now() >= ui.guard;
  const guardFrom = () => performance.now() + GUARD_MS;
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /* ---------- creature drawing: SVG markup from the rules' pure description ---------- */
  const SPIKY = "M" + Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 ? 31 : 42;
    return `${f(60 + Math.cos(a) * rad)} ${f(68 + Math.sin(a) * rad)}`;
  }).join(" L") + " Z";
  const SHAPES = {
    round: { body: '<circle class="henteko-fill" cx="60" cy="68" r="37"/>', eyeY: 60, spread: 14, top: 31, bottom: 105, shoulder: [28, 72], legX: [48, 72, 40, 52, 68, 80], belly: [60, 89, 21, 12], spots: [[38, 50, 5], [86, 84, 4], [77, 42, 3]] },
    blob: { body: '<path class="henteko-fill" d="M58 32 C80 28 97 42 96 62 C95 76 101 86 92 96 C83 105 64 104 51 102 C35 100 22 93 24 76 C25 63 19 51 29 42 C37 34 47 33 58 32 Z"/>', eyeY: 60, spread: 14, top: 32, bottom: 102, shoulder: [29, 74], legX: [46, 72, 38, 52, 68, 82], belly: [60, 89, 20, 11], spots: [[36, 56, 5], [87, 80, 4], [72, 40, 3]] },
    tall: { body: '<rect class="henteko-fill" x="38" y="20" width="44" height="86" rx="22"/>', eyeY: 46, spread: 9, top: 20, bottom: 106, shoulder: [42, 66], legX: [48, 72, 44, 54, 66, 76], belly: [60, 90, 14, 12], spots: [[47, 30, 3], [74, 82, 4], [50, 98, 3]] },
    spiky: { body: `<path class="henteko-fill" d="${SPIKY}"/>`, eyeY: 62, spread: 13, top: 31, bottom: 104, shoulder: [27, 72], legX: [48, 72, 40, 52, 68, 80], belly: [60, 90, 17, 10], spots: [[40, 48, 4], [83, 84, 4], [81, 52, 3]] },
    ghost: { body: '<path class="henteko-fill" d="M28 62 A32 32 0 0 1 92 62 V104 Q86 112 81 104 Q76 96 71 104 Q65 112 60 104 Q55 96 49 104 Q44 112 39 104 Q34 96 28 104 Z"/>', eyeY: 58, spread: 13, top: 30, bottom: null, shoulder: [31, 74], legX: [], belly: [60, 88, 18, 11], spots: [[40, 45, 4], [82, 88, 4], [79, 44, 3]] }
  };
  const EYE_R = { 1: 12, 2: 9, 3: 7.5 };

  function eyeSpots(shape, count) {
    const { eyeY: y, spread: s } = shape;
    if (count === 1) return [[60, y - 2]];
    if (count === 2) return [[60 - s, y], [60 + s, y]];
    return [[60 - s * 1.35, y + 2], [60, y - 7], [60 + s * 1.35, y + 2]];
  }
  function pupilShift(look, x, r) {
    const d = r * 0.38;
    if (look === "left") return [-d, 0];
    if (look === "right") return [d, 0];
    if (look === "up") return [0, -d];
    if (look === "cross") return [x < 60 ? d : x > 60 ? -d : 0, x === 60 ? d : 0];
    return [0, d * 0.3];
  }
  function eye(style, look, [x, y], r) {
    if (style === "happy") return `<path class="henteko-line" d="M${f(x - r * 0.85)} ${f(y + r * 0.25)} Q${f(x)} ${f(y - r * 0.95)} ${f(x + r * 0.85)} ${f(y + r * 0.25)}"/>`;
    const [dx, dy] = style === "dot" ? [0, 0] : pupilShift(look, x, r);
    const pr = r * (style === "big" ? 0.45 : 0.5);
    const white = style === "dot" ? "" : `<circle class="henteko-eye" cx="${f(x)}" cy="${f(y)}" r="${f(r * (style === "googly" ? 1.15 : 1))}"/>`;
    const px = x + dx;
    const py = y + dy;
    return `${white}<circle class="henteko-pupil" cx="${f(px)}" cy="${f(py)}" r="${f(pr)}"/><circle class="henteko-glint" cx="${f(px - pr * 0.35)}" cy="${f(py - pr * 0.35)}" r="${f(pr * 0.32)}"/>`;
  }
  const MOUTH = {
    smile: (y, w) => `<path class="henteko-line" d="M${60 - w} ${y} Q60 ${y + w} ${60 + w} ${y}"/>`,
    open: (y, w) => `<path class="henteko-mouth" d="M${60 - w} ${y} Q60 ${f(y + w * 1.7)} ${60 + w} ${y} Z"/>`,
    teeth: (y, w) => `<path class="henteko-mouth" d="M${60 - w} ${y} H${60 + w} Q${60 + w} ${f(y + w * 1.1)} 60 ${f(y + w * 1.1)} Q${60 - w} ${f(y + w * 1.1)} ${60 - w} ${y} Z"/>` +
      [-0.55, 0.1].map(k => `<rect class="henteko-tooth" x="${f(60 + w * k)}" y="${y}" width="${f(w * 0.45)}" height="${f(w * 0.42)}"/>`).join(""),
    tongue: (y, w) => MOUTH.smile(y, w) + `<path class="henteko-tongue" d="M${f(60 - w * 0.4)} ${f(y + w * 0.45)} Q${f(60 - w * 0.45)} ${f(y + w * 1.4)} 60 ${f(y + w * 1.4)} Q${f(60 + w * 0.45)} ${f(y + w * 1.4)} ${f(60 + w * 0.4)} ${f(y + w * 0.45)} Z"/>`,
    zigzag: (y, w) => `<path class="henteko-line" d="M${60 - w} ${y} ${[1, 2, 3, 4, 5].map(k => `L${f(60 - w + k * w * 0.4)} ${y + (k % 2 ? 4 : 0)}`).join(" ")}"/>`,
    o: (y, w) => `<ellipse class="henteko-mouth" cx="60" cy="${y + 4}" rx="${f(w * 0.42)}" ry="${f(w * 0.58)}"/>`
  };
  const TOP = {
    none: () => "",
    antenna: (y, h) => `<path class="henteko-stroke" d="M${60 - h + 8} ${y + 4} Q${60 - h + 4} ${y - 8} ${60 - h} ${y - 16} M${60 + h - 8} ${y + 4} Q${60 + h - 4} ${y - 8} ${60 + h} ${y - 16}"/><circle class="henteko-acc" cx="${60 - h}" cy="${y - 18}" r="5"/><circle class="henteko-acc" cx="${60 + h}" cy="${y - 18}" r="5"/>`,
    horns: (y, h) => [-1, 1].map(d => `<path class="henteko-horn" d="M${60 + d * h} ${y + 9} Q${60 + d * (h + 4)} ${y - 7} ${60 + d * (h + 10)} ${y - 13} Q${60 + d * (h - 4)} ${y - 9} ${60 + d * (h - 9)} ${y + 4} Z"/>`).join(""),
    hat: (y) => `<g transform="rotate(-10 60 ${y})"><rect class="henteko-acc" x="46" y="${y - 24}" width="28" height="24" rx="3"/><rect class="henteko-band" x="46" y="${y - 9}" width="28" height="5"/><rect class="henteko-acc" x="38" y="${y - 3}" width="44" height="7" rx="3.5"/></g>`,
    sprout: (y) => `<path class="henteko-stroke" d="M60 ${y + 3} Q58 ${y - 8} 61 ${y - 14}"/><path class="henteko-leaf" d="M61 ${y - 14} Q50 ${y - 25} 43 ${y - 16} Q52 ${y - 8} 61 ${y - 14} Z"/><path class="henteko-leaf" d="M61 ${y - 14} Q72 ${y - 27} 80 ${y - 18} Q70 ${y - 8} 61 ${y - 14} Z"/>`,
    crown: (y) => `<path class="henteko-gold" d="M44 ${y + 5} L44 ${y - 11} L52 ${y - 3} L60 ${y - 18} L68 ${y - 3} L76 ${y - 11} L76 ${y + 5} Z"/>`
  };
  const ARM_PATH = {
    up: (x, y, d) => [`M${x} ${y} Q${x + d * 16} ${y - 2} ${x + d * 24} ${y - 20}`, x + d * 24, y - 20],
    down: (x, y, d) => [`M${x} ${y} Q${x + d * 16} ${y + 6} ${x + d * 19} ${y + 22}`, x + d * 19, y + 22],
    wiggle: (x, y, d) => [`M${x} ${y} q${d * 6} -9 ${d * 12} 0 t${d * 12} 0`, x + d * 24, y]
  };
  function arms(type, [sx, sy]) {
    if (!ARM_PATH[type]) return "";
    return [-1, 1].map(d => {
      const [path, hx, hy] = ARM_PATH[type](d < 0 ? sx : 120 - sx, sy, d);
      return `<path class="henteko-stroke" d="${path}"/><circle class="henteko-fill" cx="${hx}" cy="${hy}" r="5"/>`;
    }).join("");
  }
  function legs(type, shape) {
    if (type === "none" || shape.bottom === null) return "";
    const xs = type === "two" ? shape.legX.slice(0, 2) : shape.legX.slice(2);
    const len = type === "two" ? 12 : 9;
    const b = shape.bottom;
    return xs.map(x => `<path class="henteko-stroke" d="M${x} ${b - 12} L${x} ${b + len}"/><ellipse class="henteko-fill" cx="${x + (x < 60 ? -3 : 3)}" cy="${b + len + 2}" rx="${type === "two" ? 7 : 4.5}" ry="3.5"/>`).join("");
  }
  function pattern(type, shape) {
    if (type === "spots") return shape.spots.map(([x, y, r]) => `<circle class="henteko-spot" cx="${x}" cy="${y}" r="${r}"/>`).join("");
    if (type === "belly") return `<ellipse class="henteko-spot" cx="${shape.belly[0]}" cy="${shape.belly[1]}" rx="${shape.belly[2]}" ry="${shape.belly[3]}"/>`;
    return "";
  }
  function face(c, shape) {
    const r = EYE_R[c.eyes.count] || 9;
    const eyes = eyeSpots(shape, c.eyes.count).map(p => eye(c.eyes.style, c.eyes.look, p, r)).join("");
    const cheekX = shape.spread + 7;
    const cheeks = c.cheeks ? [-1, 1].map(d => `<ellipse class="henteko-cheek" cx="${60 + d * cheekX}" cy="${shape.eyeY + 13}" rx="5" ry="3"/>`).join("") : "";
    const w = shape.spread < 12 ? 9 : 11;
    return `<g class="henteko-eyes">${eyes}</g>${cheeks}${(MOUTH[c.mouth] || MOUTH.smile)(shape.eyeY + 22, w)}`;
  }
  const token = (t) => (/^--c-[a-z]+$/.test(t) ? `var(${t})` : "var(--accent)");
  const paint = (node, c) => {
    node.style.setProperty("--henteko-main", token(c.color));
    node.style.setProperty("--henteko-accent", token(c.accent));
  };
  function creatureSvg(c) {
    const shape = SHAPES[c.body] || SHAPES.round;
    const legLen = c.legs === "two" ? 12 : c.legs === "many" ? 9 : 0;
    const ground = shape.bottom === null ? 121 : shape.bottom + legLen + (legLen ? 5 : 4);
    const shadow = `<ellipse class="henteko-shadow" cx="60" cy="${ground}" rx="${shape.bottom === null ? 22 : 32}" ry="5"/>`;
    const shine = `<ellipse class="henteko-spot" cx="${60 - shape.spread - 7}" cy="${shape.top + 14}" rx="7" ry="4" transform="rotate(-35 ${60 - shape.spread - 7} ${shape.top + 14})"/>`;
    const art = legs(c.legs, shape) + arms(c.arms, shape.shoulder) + shape.body + pattern(c.pattern, shape) + shine +
      (TOP[c.top] || TOP.none)(shape.top, shape.spread + 4) + face(c, shape);
    return `<svg class="henteko-svg" viewBox="-8 -14 136 142" aria-hidden="true" focusable="false">${shadow}<g class="henteko-bob">${art}</g></svg>`;
  }
  function creatureEl(kind, cls) {
    const c = document.createElement("div");
    c.className = cls;
    paint(c, game.kinds[kind]);
    c.innerHTML = `<div class="henteko-art">${svgs[kind]}</div>`;
    return c;
  }

  /* ---------- custom sounds ---------- */
  const at = (fn) => { const c = Sound.ctx(); if (c) fn(c.currentTime); };
  const sparkle = () => at(t => {
    [88, 92, 95, 100].forEach((m, i) => Sound.tone({ freq: Sound.hz(m), type: "triangle", t: t + i * 0.06, dur: 0.4, vol: 0.07, send: 0.35 }));
    Sound.hiss({ t, dur: 0.5, vol: 0.04, freq: 7000, to: 11000, send: 0.3 });
  });
  const raceSting = () => at(t => {
    Sound.tone({ freq: 190, glide: 560, glideTime: 0.12, type: "sine", t, dur: 0.2, vol: 0.22 });
    Sound.tone({ freq: Sound.hz(79), type: "square", t: t + 0.05, dur: 0.09, vol: 0.06, filter: { freq: 3200 } });
    Sound.tone({ freq: Sound.hz(86), type: "square", t: t + 0.15, dur: 0.24, vol: 0.06, filter: { freq: 3200 }, send: 0.2 });
  });
  const deflate = () => at(t => Sound.tone({ freq: 640, glide: 150, glideTime: 0.55, type: "sine", t, dur: 0.6, vol: 0.18, vibrato: { rate: 9, depth: 14 } }));
  const coinRun = (n) => at(t => {
    for (let k = 0; k < n; k++) {
      const land = t + (FLY_MS + k * FLY_GAP) / 1000;
      Sound.tone({ freq: Sound.hz(83 + k * 2), type: "square", t: land - 0.05, dur: 0.06, vol: 0.05 });
      Sound.tone({ freq: Sound.hz(88 + k * 2), type: "square", t: land, dur: 0.22, vol: 0.05, send: 0.15 });
    }
  });

  /* ---------- flow ---------- */
  function start() {
    if (!settled()) return;
    Sound.ensure();
    Awake.keep();
    clearTimers();
    game = H.newGame(settings.players, settings.kinds);
    prev = null;
    svgs = game.kinds.map(creatureSvg);
    buildSeats();
    ui = { phase: "play", note: "最初の1枚をめくろう", guard: guardFrom() };
    Sound.sfx("confirm");
    Music.play("draw");
    render();
    Fx.pop(el.deck);
  }
  function flip() {
    if (ui.phase !== "play" || !game || game.phase !== "flip" || !settled()) return;
    game = H.flip(game);
    prev = null;
    ui = { ...ui, guard: guardFrom() };
    if (H.remaining(game) <= INTENSE_LEFT) Music.intensify();
    render();
    Fx.replay(el.pile.lastElementChild, "henteko-deal");
    Sound.sfx("flip");
    Sound.sfx("whoosh");
    if (game.card.first) {
      Fx.replay(el.wrap, "henteko-first");
      later(sparkle, 160);
    } else {
      later(raceSting, 150);
      later(() => Fx.replay(el.pile.querySelector(".henteko-art"), "henteko-jolt"), 380);
    }
  }
  function commit(next, note) {
    prev = game;
    game = next;
    ui = { ...ui, note, guard: guardFrom() };
    if (H.isOver(game)) finish();
    else render();
  }
  function nameDone() {
    if (ui.phase !== "play" || game.phase !== "name" || !settled()) return;
    Sound.sfx("pop");
    commit(H.named(game), "いい名前！ 次の人がめくろう");
  }
  function award(seat) {
    if (ui.phase !== "play" || !game || game.phase !== "race") return;
    const cards = game.pile.length;
    const flown = flyCards(cards, seat);
    commit(H.award(game, seat), `${S(seat)}さんが${cards}枚ゲット！`);
    Sound.sfx("whoosh");
    if (flown) coinRun(flown);
    else Sound.sfx("coin");
    later(() => celebrateSeat(seat, cards), flown ? FLY_MS + (flown - 1) * FLY_GAP : 0);
  }
  function nobody() {
    if (ui.phase !== "play" || game.phase !== "race" || !settled()) return;
    deflate();
    commit(H.nobody(game), `だれも言えなかった…カードは場に${game.pile.length}枚`);
  }
  function undo() {
    if (!prev || !settled()) return;
    clearTimers();
    const fromResult = ui.phase !== "play";
    game = prev;
    prev = null;
    ui = { phase: "play", note: "1つ前に戻しました", guard: guardFrom() };
    if (fromResult) Music.play("draw");
    if (H.remaining(game) <= INTENSE_LEFT) Music.intensify();
    Sound.sfx("back");
    render();
  }
  function finish() {
    ui = { ...ui, phase: "drum" };
    render();
    Music.stop();
    later(() => Sound.sfx("drumroll", DRUM_S), 450);
    later(revealResult, 450 + DRUM_S * 1000);
  }
  function revealResult() {
    ui = { ...ui, phase: "over" };
    render();
    if (H.winners(game).length) {
      Sound.sfx("victory");
      Fx.confetti();
    } else Sound.sfx("lose");
    Fx.pop(el.list);
  }
  function toSetup() {
    if (!settled()) return;
    clearTimers();
    Music.stop();
    ui = { phase: "setup", note: "", guard: guardFrom() };
    renderHero();
    render();
  }

  /* ---------- animations ---------- */
  function flyCards(count, seat) {
    const src = el.pile.lastElementChild;
    const dest = seatButtons[seat];
    if (!src || !dest || reduced() || typeof src.animate !== "function") return 0;
    const a = src.getBoundingClientRect();
    const b = dest.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const ghosts = Array.from({ length: Math.min(count, MAX_FLY) }, (_, k) => {
      const g = src.cloneNode(true);
      g.classList.remove("henteko-deal");
      g.classList.add("henteko-fly");
      Object.assign(g.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
      document.body.appendChild(g);
      const spin = (k % 2 ? 1 : -1) * (14 + k * 6);
      g.animate([
        { transform: "none", opacity: 1 },
        { transform: `translate(${f(dx * 0.45)}px, ${f(dy * 0.45 - 70)}px) rotate(${spin}deg) scale(.6)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${f(dx)}px, ${f(dy)}px) rotate(${spin * 2}deg) scale(.16)`, opacity: 0.25 }
      ], { duration: FLY_MS, delay: k * FLY_GAP, easing: "cubic-bezier(.35, .05, .35, 1)", fill: "both" }).onfinish = () => g.remove();
      return g;
    });
    flights = [...flights.filter(g => g.isConnected), ...ghosts];
    return ghosts.length;
  }
  function celebrateSeat(seat, cards) {
    const b = seatButtons[seat];
    if (!b || !b.isConnected) return;
    Fx.pop(b);
    const gain = document.createElement("span");
    gain.className = "henteko-gain";
    gain.textContent = `+${cards}`;
    b.appendChild(gain);
    setTimeout(() => gain.remove(), 950);
  }

  /* ---------- screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    flip: () => ({
      label: `${S(game.turn)}さんの番`,
      title: "山をめくって！",
      hint: ui.note || "山をタップしてもめくれます",
      actions: [
        ...(game.next === 0 ? [makeButton("設定", toSetup, "small")] : []),
        ...(prev ? [makeButton("1つ戻す", undo, "small")] : []),
        makeButton("めくる", flip, "primary")
      ]
    }),
    name: () => ({
      label: "はじめて見る生き物",
      title: `${S(game.card.by)}さん、名前をつけて！`,
      hint: "声に出して名前をつけよう。みんな覚えてね",
      actions: [makeButton("名前をつけた！", nameDone, "primary")]
    }),
    race: () => ({
      label: `${game.card.count}回目の登場`,
      title: "名前をさけべ！",
      hint: "先に言えた人は、自分のボタンをタップ",
      actions: [makeButton("だれも言えない", nobody)]
    }),
    drum: () => ({ label: "結果発表", title: "いちばん集めたのは…", hint: "", actions: [] }),
    over: () => {
      const wins = H.winners(game);
      const left = game.pile.length;
      return {
        label: "結果",
        title: wins.length === 0 ? "だれも取れなかった…" : wins.length === 1 ? `${S(wins[0])}さんの勝ち！` : `${wins.map(S).join("・")}さんが同点優勝！`,
        hint: `${left ? `場に残った${left}枚は、だれのものにもなりません。` : ""}今回のヘンテコたち、名前をぜんぶ言える？`,
        actions: [makeButton("設定", toSetup, "small"), ...(prev ? [makeButton("1つ戻す", undo, "small")] : []), makeButton("もう一回", start, "primary")]
      };
    }
  };

  /* ---------- rendering ---------- */
  function buildSeats() {
    seatButtons = Array.from({ length: game.players }, (_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "henteko-seat";
      b.innerHTML = `<b>${S(i)}</b><small></small>`;
      b.addEventListener("pointerdown", (e) => { if (e.button === 0) { e.preventDefault(); award(i); } });
      b.addEventListener("click", (e) => { if (e.detail === 0) award(i); });
      return b;
    });
    el.seats.style.setProperty("--cols", String(game.players <= 4 ? game.players : game.players <= 6 ? 3 : 4));
    el.seats.replaceChildren(...seatButtons);
  }
  function renderTable() {
    const show = ui.phase === "play" || ui.phase === "drum";
    el.table.hidden = !show;
    if (!show) return;
    const left = H.remaining(game);
    const n = game.pile.length;
    el.deck.disabled = ui.phase !== "play" || game.phase !== "flip";
    el.deck.classList.toggle("empty", left === 0);
    el.deck.classList.toggle("ready", !el.deck.disabled);
    el.deck.setAttribute("aria-label", `山をめくる（のこり${left}枚）`);
    el.deckCount.textContent = String(left);
    const layers = Array.from({ length: Math.min(Math.max(n - 1, 0), MAX_LAYERS) }, () => {
      const u = document.createElement("span");
      u.className = "henteko-under";
      return u;
    });
    const top = n ? creatureEl(game.pile[n - 1], "henteko-card") : Object.assign(document.createElement("div"), { className: "henteko-slot", textContent: "場" });
    if (n) top.setAttribute("role", "img");
    if (n) top.setAttribute("aria-label", game.card && game.card.first && game.phase === "name" ? "はじめて見る生き物のカード" : "生き物のカード");
    el.pile.replaceChildren(...layers, top);
    el.pileCount.hidden = n === 0;
    el.pileCount.textContent = `場に${n}枚`;
    renderBadge();
  }
  function renderBadge() {
    const phase = ui.phase === "play" ? game.phase : "";
    if (phase !== "name") el.wrap.classList.remove("henteko-first");
    el.badge.hidden = phase !== "name" && phase !== "race";
    el.badge.classList.toggle("race", phase === "race");
    el.badge.innerHTML = phase === "name" ? "<b>はじめて！</b><span>名前をつけて</span>" : "<b>早い者勝ち！</b>";
  }
  function renderSeats() {
    const show = ui.phase === "play";
    el.seats.hidden = !show;
    if (!show) return;
    const live = game.phase === "race";
    const best = Math.max(...game.scores);
    el.seats.classList.toggle("live", live);
    seatButtons.forEach((b, i) => {
      b.disabled = !live;
      b.classList.toggle("turn", game.phase === "flip" && i === game.turn);
      b.classList.toggle("lead", best > 0 && game.scores[i] === best);
      b.querySelector("small").textContent = `${game.scores[i]}枚`;
      b.setAttribute("aria-label", `${S(i)}さん ${game.scores[i]}枚${live ? "。名前を言えたらタップ" : ""}`);
    });
  }
  function renderResult() {
    const show = ui.phase === "over";
    el.list.hidden = !show;
    el.gallery.hidden = !show;
    if (!show) return;
    el.list.replaceChildren(...H.ranking(game).map(row => {
      const li = document.createElement("li");
      li.className = row.rank === 1 && row.cards > 0 ? "ok" : "";
      li.innerHTML = `<span class="pos">${row.rank}位</span><span class="who">${S(row.seat)}さん</span><b class="num">${row.cards}</b><span class="mark">枚</span>`;
      return li;
    }));
    el.gallery.replaceChildren(...game.kinds.map((_, k) => creatureEl(k, "henteko-mini")));
  }
  function renderHero() {
    const kinds = H.makeKinds(3);
    el.hero.replaceChildren(...kinds.map(c => {
      const d = document.createElement("div");
      paint(d, c);
      d.innerHTML = creatureSvg(c);
      return d;
    }));
  }
  function renderSetup() {
    const range = Array.from({ length: H.PLAYERS.max - H.PLAYERS.min + 1 }, (_, i) => H.PLAYERS.min + i);
    View.chips($("uPlayerChips"), View.options(range, n => `${n}人`), settings.players, n => update({ players: n }));
    View.chips($("uKindChips"), View.options(H.KIND_COUNTS, n => `${n}種類`), settings.kinds, n => update({ kinds: n }));
    View.list($("uRules"), [
      `自分の席（A〜${S(settings.players - 1)}）を決めて、順番に山から1枚ずつめくる`,
      "はじめて出た生き物には、めくった人がヘンテコな名前をつける",
      "前に出た生き物なら早い者勝ち。名前を先に言えた人が自分のボタンをタップして、場のカードを全部もらう",
      "だれも言えなければ、カードは場に残ってたまっていく",
      `${settings.kinds}種類×4枚で${settings.kinds * 4}枚。山がなくなったとき、カードがいちばん多い人の勝ち`
    ]);
  }
  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    else {
      renderTable();
      renderSeats();
      renderResult();
    }
    View.stage(el, SCREENS[ui.phase === "play" ? game.phase : ui.phase]());
  }

  function normalize(s) {
    const players = Number.isInteger(s.players) && s.players >= H.PLAYERS.min && s.players <= H.PLAYERS.max ? s.players : 4;
    const kinds = H.KIND_COUNTS.includes(s.kinds) ? s.kinds : 8;
    return { players, kinds };
  }
  function update(patch) {
    settings = normalize({ ...settings, ...patch });
    Store.save(KEY, settings);
    render();
  }

  function init() {
    const saved = Store.load(KEY, {});
    settings = normalize(saved && typeof saved === "object" ? saved : {});
    el.deck.addEventListener("click", flip);
    renderHero();
    render();
  }
  function onShow() {
    if (ui.phase !== "play" || !Sound.ctx()) return;
    Music.play("draw");
    if (H.remaining(game) <= INTENSE_LEFT) Music.intensify();
  }
  function leave() {
    clearTimers();
    flights.forEach(g => g.remove());
    flights = [];
    if (ui.phase === "drum") {
      ui = { ...ui, phase: "over" };
      render();
    }
  }

  return { init, leave, onShow };
})();

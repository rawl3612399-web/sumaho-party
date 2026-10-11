# How to add a game to スマホ1台パーティー

Read this whole file before writing code. The app is a single page (`src/index.html`) bundled by `tools/build.js` into `oekaki-20byou.html`. Plain browser JavaScript, no framework, no build step besides inlining. Every module is a global `const` created by an IIFE.

## Hard rules

1. **Only create your own files.** Never edit shared files: `src/index.html`, `src/main.js`, `src/shared.js`, `src/audio.js`, `src/music.js`, `src/fx.js`, `src/icons.js`, `src/random.js`, `src/topics.js`, `src/styles.css`, `src/styles-games.css`, `tools/*`, or any other game's files. Other agents are building other games in the same folder at the same time. The integrator wires your game in afterwards using the summary you return.
2. Files you create (replace `<id>` with your game id, e.g. `connect4`):
   - `src/<id>-rules.js` — pure game rules. No DOM, no `document`, no `Sound`. Testable in Node.
   - `src/<id>.js` — the screen module.
   - `src/partials/<id>.html` — your markup (one `<div class="mode" ...>`; see below).
   - `src/partials/<id>-overlay.html` — ONLY if you need a full-screen layer (like `#quiz` or `#arena` in `src/index.html`). It is placed after `.app`.
   - `src/styles-<id>.css` — ONLY if the existing classes are not enough.
   - `tests/<id>.test.js` — `node:test` tests for your rules file.
3. **Element ids are global.** Prefix every id with your assigned one-letter prefix (e.g. `cSetup`, `cPlay`, `cActions`). The mode container id is `mode<Pascal>` (e.g. `modeConnect4`).
4. **Style rules:** immutable updates (return new objects, never mutate state in place; reassigning a module-level `let` to a new object is the pattern), functions under ~50 lines, files under 400 lines (800 hard max), no deep nesting, validate every value loaded from storage or passed into rules, throw `Error` with a short Japanese message on bad input. No emoji anywhere (UI or code).
5. **Colors only from tokens.** Never write a literal color in CSS or JS. Tokens (light and dark already defined): `--paper --card --ink --muted --line --accent --accent-deep --on-accent --alert --alert-deep --hl --zap --on-zap --go --on-go --on-tile` and game colors `--c-blue --c-amber --c-purple --c-red --c-orange --c-pink --c-teal --c-green --c-indigo --c-slate --c-lime --c-cyan --c-rose --c-brown --c-sky --c-violet --c-gold --c-mint`. If you truly need a new color, define it as a token in your own CSS file in all three places: bare `:root`, `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }`, and `:root[data-theme="dark"] {...}`. Canvas drawing: read tokens with `getComputedStyle(document.documentElement).getPropertyValue("--ink")`.
6. Must work at 375px phone width with no horizontal page scroll, in light and dark, with touch. Tap targets at least 44px. Respect `prefers-reduced-motion` for any new animation.
7. Japanese UI copy: short, plain, friendly, the way a person would explain the game at a party. Match the tone of existing games (read `src/wordwolf.js`, `src/bomb.js`).

## Reference implementations (read these first)

- Rules + tests pattern: `src/wordwolf-rules.js`, `src/numbomb-rules.js`, `tests/rules-party.test.js`
- Screen pattern (setup → play → result, SCREENS map, render()): `src/wordwolf.js`, `src/bomb.js`, `src/kachikan.js`, `src/numbomb.js`
- Full-screen overlay pattern: `src/atekko.js` with `#quiz` markup in `src/index.html`
- Markup pattern: the `modeWordwolf` and `modeNumbomb` blocks in `src/index.html`
- CSS classes available: `src/styles.css`, `src/styles-games.css`

## Rules file shape

```js
/* One-line description of the rules. */
const Connect4Rules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  // constants, pure functions; randomness always via an injectable r = Math.random
  return { /* public API */ };
})();

if (typeof module !== "undefined") module.exports = Connect4Rules;
```

`Rand` API: `Rand.shuffle(list, r)`, `Rand.pick(list, r)`, `Rand.between(min, max, r)` (integers, inclusive).

## Screen module shape

```js
/* One-line description. */
const Connect4 = (() => {
  const KEY = "connect4.settings";          // localStorage key, namespaced
  const el = { setup: $("cSetup"), play: $("cPlay"), label: $("cLabel"), title: $("cTitle"),
               card: $("cCard"), hint: $("cHint"), actions: $("cActions") };
  let settings = { ... };                    // loaded + validated in init()
  let ui = { phase: "setup" };
  const SCREENS = { setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }), ... };
  function render() { el.setup.hidden = ui.phase !== "setup"; el.play.hidden = ui.phase === "setup"; ... View.stage(el, SCREENS[ui.phase]()); }
  function init() { ... render(); }          // called once at startup
  function leave() { ... }                   // called when the player goes back to the game list: stop timers, close overlays
  return { init, leave };                    // optional: onShow() when the game is opened
})();
```

The top bar (back button, game title, sound toggle) is provided by the app. Do not add your own title heading. `main.js` calls `Music.stop()` when switching games.

## Globals you can use (do not redefine them)

- `$ (id)` — `document.getElementById`.
- `Store.load(key, fallback)` / `Store.save(key, value)` — JSON in localStorage, never throws. Validate what you load.
- `Awake.keep()` — keep the screen on (call when a game starts).
- `makeButton(label, onClick, cls = "", disabled = false)` — classes: `"primary"`, `"primary danger"`, `"small"`, plus `"big-press"` for a huge button.
- `makeChip(label, on, onClick, disabled = false)`.
- `View.text(el, value)` (hides when empty), `View.list(ulEl, lines)`, `View.chips(el, [{value,label}], current, onPick)`, `View.card(el, {main, sub, back, cls} | null)`, `View.stage(el, {label, title, card, hint, actions})`, `View.seat(i)` -> "A".."H", `View.options(values, v => label)`, `View.clock(sec)` -> "m:ss".
- `Duo.fill([input0, input1])` / `Duo.read([input0, input1])` — shared 2-player names (`src/shared.js`).
- `Sound.ensure()` — call on the first user action of your game.
- `Sound.sfx(name, ...args)` — names: `tap select confirm back correct wrong pop coin flip whoosh count go tick(alt) heartbeat buzz fanfare victory lose reveal boom zap drumroll(seconds)`.
- `Sound.beep(freq, dur, delay, type, vol)` — quick tone.
- `Sound.tone({freq, type, t, dur, vol, attack, hold, glide, glideTime, detune, vibrato:{rate,depth,delay}, filter:{type,freq,to,q}, send, dest})` and `Sound.hiss({t, dur, vol, type, freq, to, q, attack, send, dest})` — synth primitives for custom sounds. `Sound.ctx()` gives the AudioContext (null until `Sound.ensure()`), `Sound.hz(midi)`. Build custom sounds/metronomes inside your own module.
- `Music.play(track)` / `Music.stop()` / `Music.intensify()` — tracks: `menu`, `draw` (upbeat chiptune), `tension` (heartbeat suspense), `think` (calm lo-fi), `rush` (game show).
- `Fx.pop(el)`, `Fx.shake()`, `Fx.flash("--alert", ms)`, `Fx.confetti()`, `Fx.countdown(goText)` (returns a Promise), `Fx.replay(el, cssClass)`.
- `TOPICS` — drawing/guessing words by level (`kids easy normal hard oni`), from `src/topics.js`.

## Markup shape (`src/partials/<id>.html`)

```html
<!-- ===== 四目並べ ===== -->
<div class="mode" id="modeConnect4" hidden>
  <main class="stage" aria-live="polite">
    <section class="panel" id="cSetup">
      <div class="opts">
        <div class="opt"><span class="row-label">先攻</span><div class="chips" id="cFirstChips"></div></div>
      </div>
      <ul class="rules" id="cRules"></ul>
    </section>
    <section class="panel" id="cPlay" hidden>
      <span class="label" id="cLabel"></span>
      <p class="d-title" id="cTitle"></p>
      <div class="word-card" id="cCard"></div>
      <p class="hint" id="cHint"></p>
    </section>
  </main>
  <div class="actions" id="cActions"></div>
</div>
```

Useful existing classes: `.stage .panel .opts .opt .row-label .chips .rules .label .d-title .hint .big .word-card(.back/.number/.pair/.boom) .clock(.urgent) .result-list(.ranked) li.ok/li.ng .pos .who .num .mark .seat-row .seat-chip .order-row .order-slot .slots .slot .keypad .key .setup-form .name-input .scores .score .pts .d-history .stopwatch .range`.

## Feel (this is a party game app that should feel like a real product)

- Every meaningful moment gets a sound: start (`confirm`), turn change (`whoosh`), success (`correct`/`coin`), failure (`wrong`), reveal (`drumroll` then `reveal`), win (`victory` + `Fx.confetti()`), loss (`lose`).
- Use music where it fits the mood and stop it when the moment ends.
- New content appearing: `Fx.pop(el)`. Big bad moments: `Fx.shake()` + `Fx.flash`.
- A results screen with a clear winner, then "もう一回" (primary) and "設定" (small) buttons.
- Setup screen: option chips + a short rules list (3-5 lines, concrete).

## Checks before you finish

```bash
node --check src/<id>.js && node --check src/<id>-rules.js
```

```bash
node --test tests/<id>.test.js
```

Also read your screen module once against your partial: every `$("...")` id must exist in your markup, and every id in your markup must be prefixed.

## Board and table game conventions (遊び大全 classics)

These games are the well-known classics from 「世界のアソビ大全51」. Follow the official/standard rules exactly and state any variant in the rules list.

- **Setup chips** (in this order, only what applies):
  - `対戦` — `CPUと` / `2人で`. Default `CPUと`.
  - `CPUの強さ` — `よわい` / `ふつう` / `つよい` (shown only when playing the CPU). Default `ふつう`.
  - `あなたの番` — `先攻` / `後攻` / `ランダム` (only vs CPU).
  - When `2人で`: a `.setup-form` with two `.name-input`s filled/saved through `Duo.fill` / `Duo.read`.
  - Then game-specific options, then the `.rules` list.
- **CPU lives in the rules file** as a pure function such as `cpuMove(state, level, r = Math.random)`. Levels must feel clearly different: よわい makes real mistakes, つよい should beat a casual player most of the time. Worst-case think time under 150 ms on a phone (measure in Node with a timing loop over many positions and keep a 3x margin). The screen waits about 450 ms before playing the CPU move, shows `CPUが考え中…`, and ignores taps while waiting.
- **Turn display**: a score bar (use `.scores` / `.score` or your own prefixed classes) shows both sides, whose turn it is, and live counts (stones, boxes, points).
- **Boards fit the phone**: size the board with `width: min(100%, 420px)` and `aspect-ratio`, cells as CSS grid. No horizontal scroll at 375px. Highlight legal moves, the last move, and the winning line.
- **Motion**: pieces drop/flip/move with short animations (CSS transitions or keyframes, 150–350 ms), disabled under `prefers-reduced-motion`.
- **Sound**: custom piece sounds are welcome (build them with `Sound.tone` / `Sound.hiss` inside your module), plus `victory` + `Fx.confetti()` when the human wins, `lose` when the CPU wins, `fanfare` for a 2-player win, `reveal` for a draw.
- **Music**: board games are calm by default — `Music.play("think")` during play, `Music.stop()` at the end.
- **Results**: final score and winner in the play view, then `もう一回` (primary) and `設定` (small). A `投了` (resign) or `やめる` small button during play is good.
- **Undo**: offer `1手もどす` (small) vs the CPU (undo back to the human's previous turn). Optional for 2-player.
- Two-player stones/discs need fixed colors in both themes (black and white stones stay black and white). Define those as your own tokens in your CSS file, in all three token places, even if the values are the same in light and dark.

## Playing cards (shared component, already written)

Card games must use `src/cards.js` (global `Cards`) and `src/styles-cards.css` instead of drawing their own cards. Preview: `dev/cards-preview.html`.

- `Cards.SUITS` (`{id: "S"|"H"|"D"|"C", name, red}`), `Cards.RANKS` (`"A","2",…,"10","J","Q","K"`).
- `Cards.newDeck(decks = 1)` → array of `{suit, rank, id}` (unique ids, unshuffled). Shuffle with `Rand.shuffle(deck, r)`.
- `Cards.isRed(card)`, `Cards.rankIndex(card)` (A=0 … K=12), `Cards.label(card)` ("ハートのA"), `Cards.suitSvg(suitId, cls)`.
- `Cards.el(card, {faceDown, size: "sm"|"md"|"lg"})` → a `.pcard` element (md is 64px wide, sm 46px, lg 84px; override width with the `--w` CSS variable on the element or a parent rule). `Cards.setFaceDown(el, bool)` flips it with a 3D animation.
- In rules files: `const C = typeof Cards !== "undefined" ? Cards : require("./cards.js");` — only the pure helpers work in Node.

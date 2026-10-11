/* Value-number screen (cooperative): deal secret numbers, describe them through a theme, line everyone up. */
const Kachikan = (() => {
  const K = KachikanRules;
  const KEY = "kachikan.settings";
  const REVEAL_STEP_MS = 650;

  const el = {
    setup: $("kSetup"), play: $("kPlay"), label: $("kLabel"), title: $("kTitle"),
    card: $("kCard"), order: $("kOrder"), seats: $("kSeats"), list: $("kList"), hint: $("kHint"), actions: $("kActions")
  };

  let settings = { players: 4 };
  let ui = { phase: "setup", seat: 0, shown: false, order: [], revealed: 0 };
  let theme = null;
  let deal = null;
  let result = null;
  let usedThemes = [];

  const S = (i) => View.seat(i);
  const scale = () => `1＝${theme.low}　100＝${theme.high}`;

  function go(patch) {
    ui = { ...ui, ...patch };
    render();
  }
  function pickTheme() {
    const fresh = K.THEMES.filter(t => !usedThemes.includes(t.text));
    const pool = fresh.length ? fresh : K.THEMES;
    theme = Rand.pick(pool);
    usedThemes = fresh.length ? [...usedThemes, theme.text] : [theme.text];
  }

  /* ---------- flow ---------- */
  function start() {
    Sound.ensure();
    Awake.keep();
    pickTheme();
    Sound.sfx("confirm");
    go({ phase: "theme" });
    Fx.pop(el.card);
  }
  function changeTheme() {
    pickTheme();
    Sound.sfx("flip");
    render();
    Fx.pop(el.card);
  }
  function startDeal() {
    deal = K.deal(settings.players);
    Sound.sfx("whoosh");
    go({ phase: "deal", seat: 0, shown: false });
  }
  function showNumber() {
    Sound.sfx("flip");
    go({ shown: true });
    Fx.pop(el.card);
  }
  function nextSeat() {
    Sound.sfx("whoosh");
    if (ui.seat + 1 < deal.players) go({ seat: ui.seat + 1, shown: false });
    else {
      Music.play("think");
      go({ phase: "talk" });
    }
  }
  function addToOrder(i) {
    Sound.sfx("pop");
    go({ order: [...ui.order, i] });
  }
  function check() {
    result = K.judgeOrder(deal.numbers, ui.order);
    Music.stop();
    go({ phase: "check", revealed: 0 });
    revealNext();
  }
  function revealNext() {
    if (ui.phase !== "check") return;
    if (ui.revealed >= result.rows.length) {
      setTimeout(() => {
        if (ui.phase !== "check") return;
        if (result.perfect) { Sound.sfx("victory"); Fx.confetti(); } else Sound.sfx("lose");
        go({ phase: "done" });
      }, 400);
      return;
    }
    const row = result.rows[ui.revealed];
    Sound.sfx(row.ok ? "coin" : "wrong");
    go({ revealed: ui.revealed + 1 });
    setTimeout(revealNext, REVEAL_STEP_MS);
  }

  /* ---------- screens ---------- */
  const SCREENS = {
    setup: () => ({ actions: [makeButton("はじめる", start, "primary")] }),
    theme: () => ({
      label: "今回のお題",
      title: "",
      card: { main: theme.text, sub: scale() },
      hint: "このお題を使って、自分の数字の大きさを表します",
      actions: [makeButton("お題を変える", changeTheme, "small"), makeButton("数字を配る", startDeal, "primary")]
    }),
    deal: () => {
      if (!ui.shown) {
        return {
          label: `${ui.seat + 1} / ${deal.players}人目`,
          title: `${S(ui.seat)}さんだけ見てね`,
          card: { main: "？", back: true },
          hint: "ほかの人は画面を見ないで",
          actions: [makeButton("数字を見る", showNumber, "primary")]
        };
      }
      const last = ui.seat + 1 >= deal.players;
      return {
        label: `${S(ui.seat)}さんの数字`,
        title: "",
        card: { main: String(deal.numbers[ui.seat]), sub: `${theme.text}（${scale()}）`, cls: "number" },
        hint: "数字は口に出さないで！",
        actions: [makeButton(last ? "覚えた！ スタート" : `覚えた！ ${S(ui.seat + 1)}さんへ`, nextSeat, "primary")]
      };
    },
    talk: () => ({
      label: "表現タイム",
      title: "",
      card: { main: theme.text, sub: scale() },
      hint: `自分の数字くらいの「${theme.text}」を、1人ずつ言っていこう。全員言ったら、相談して小さい順に並べる。`,
      actions: [makeButton("並べる", () => go({ phase: "order", order: [] }), "primary")]
    }),
    order: () => ({
      label: "並べる",
      title: "数字が小さいと思う人から順にタップ",
      hint: "",
      actions: [
        makeButton("やり直す", () => go({ order: [] }), "small", ui.order.length === 0),
        makeButton("答え合わせ", check, "primary", ui.order.length !== deal.players)
      ]
    }),
    check: () => ({ label: "答え合わせ", title: "", hint: "", actions: [] }),
    done: () => ({
      label: "結果",
      title: result.perfect ? "パーフェクト！" : `${result.misses}か所ちがった！`,
      hint: result.perfect ? "全員の気持ちがそろいました" : "×の人は、前の人より数字が小さかった人です",
      actions: [makeButton("設定", () => go({ phase: "setup" }), "small"), makeButton("次のお題", start, "primary")]
    })
  };

  /* ---------- rendering ---------- */
  function seatChip(i, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seat-chip";
    b.textContent = S(i);
    if (onClick) b.addEventListener("click", onClick);
    else b.disabled = true;
    return b;
  }
  function renderOrder() {
    const ordering = ui.phase === "order";
    el.order.hidden = !ordering;
    el.seats.hidden = !ordering;
    if (!ordering) return;
    const slots = Array.from({ length: deal.players }, (_, k) => {
      const s = document.createElement("span");
      s.className = "order-slot" + (k < ui.order.length ? " filled" : "");
      s.textContent = k < ui.order.length ? S(ui.order[k]) : String(k + 1);
      return s;
    });
    el.order.replaceChildren(...slots);
    const left = Array.from({ length: deal.players }, (_, i) => i).filter(i => !ui.order.includes(i));
    el.seats.replaceChildren(...left.map(i => seatChip(i, () => addToOrder(i))));
  }
  function renderList() {
    const show = ["check", "done"].includes(ui.phase);
    el.list.hidden = !show;
    if (!show) return;
    el.list.replaceChildren(...result.rows.slice(0, ui.revealed).map((row, k) => {
      const li = document.createElement("li");
      li.className = (row.ok ? "ok" : "ng") + (k === ui.revealed - 1 && ui.phase === "check" ? " fx-pop" : "");
      li.innerHTML = `<span class="pos">${k + 1}</span><span class="who"></span><b class="num">${row.number}</b><span class="mark">${row.ok ? "○" : "×"}</span>`;
      li.querySelector(".who").textContent = `${S(row.seat)}さん`;
      return li;
    }));
  }
  function renderSetup() {
    View.chips($("kPlayerChips"), View.options(Array.from({ length: K.PLAYERS.max - K.PLAYERS.min + 1 }, (_, i) => K.PLAYERS.min + i), n => `${n}人`), settings.players, n => {
      settings = { players: n };
      Store.save(KEY, settings);
      render();
    });
    View.list($("kRules"), [
      "みんなで協力するゲーム。お題が1つ出る（例：食べ物　1＝苦手、100＝大好き）",
      "スマホを回して、1人ずつ1〜100の秘密の数字を見る",
      "自分の数字くらいのものを、お題に沿って言う（例：78なら「焼肉」）",
      "全員言ったら、相談して数字が小さい順に並べる。全員正しく並べばパーフェクト！"
    ]);
  }

  function render() {
    el.setup.hidden = ui.phase !== "setup";
    el.play.hidden = ui.phase === "setup";
    if (ui.phase === "setup") renderSetup();
    View.stage(el, SCREENS[ui.phase]());
    if (ui.phase !== "setup") {
      renderOrder();
      renderList();
    }
  }

  function init() {
    const s = Store.load(KEY, {}) || {};
    settings = { players: Number.isInteger(s.players) && s.players >= K.PLAYERS.min && s.players <= K.PLAYERS.max ? s.players : 4 };
    render();
  }
  function leave() {
    if (ui.phase === "check") go({ phase: "done", revealed: result.rows.length });
  }

  return { init, leave };
})();

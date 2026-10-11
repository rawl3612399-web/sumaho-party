/* App shell: game list, top bar (back, title, sound), switching games, menu music, UI click sounds. */
(() => {
  const MODE_KEY = "party.mode";
  const GAMES = [
    { id: "oekaki", title: "20秒おえかき", players: "3人〜", desc: "お題を20秒で描いて、絵だけで当てる", color: "--c-blue", el: "modeOekaki", game: Oekaki },
    { id: "denki", title: "電気イス", players: "2人", desc: "電流のイスはどれ？ 座るか、読むか", color: "--c-amber", el: "modeDenki", game: Denki },
    { id: "wordwolf", title: "ワードウルフ", players: "3〜8人", desc: "1人だけ違うお題。話して見つけ出せ", color: "--c-purple", el: "modeWordwolf", game: WordWolf },
    { id: "bomb", title: "爆弾ゲーム", players: "2人〜", desc: "お題に答えて回す。爆発したら負け", color: "--c-red", el: "modeBomb", game: Bomb },
    { id: "atekko", title: "おでこ当て", players: "2人〜", desc: "おでこのお題を、みんなのヒントで当てる", color: "--c-orange", el: "modeAtekko", game: Atekko },
    { id: "kachikan", title: "価値観ナンバー", players: "2〜8人", desc: "数字を言葉で表して、みんなで並べる", color: "--c-pink", el: "modeKachikan", game: Kachikan },
    { id: "hitblow", title: "数当て", players: "2人", desc: "ヒット&ブローで相手の数字を推理", color: "--c-teal", el: "modeHitblow", game: HitBlow },
    { id: "hayaoshi", title: "早押しバトル", players: "2人", desc: "合図の瞬間にタップ。フェイントに注意", color: "--c-green", el: "modeHayaoshi", game: Hayaoshi },
    { id: "stop", title: "10秒ストップ", players: "1〜8人", desc: "消える時計で、ぴったり10秒をねらう", color: "--c-indigo", el: "modeStop", game: Stop },
    { id: "numbomb", title: "数字爆弾", players: "2人〜", desc: "かくれた爆弾の数字を言ったら負け", color: "--c-slate", el: "modeNumbomb", game: NumBomb },
    { id: "finger", title: "指ルーレット", players: "2〜8人", desc: "指をのせて、1人・順番・チームを決める", color: "--c-orange", el: "modeFinger", game: Finger, group: "party" },
    { id: "rhythm", title: "リズム古今東西", players: "2人〜", desc: "リズムに乗って答える。止まったらアウト", color: "--c-purple", el: "modeRhythm", game: Rhythm, group: "party" },
    { id: "tobira", title: "20の扉", players: "3人〜", desc: "はい・いいえの質問で、お題を当てる", color: "--c-teal", el: "modeTobira", game: Tobira, group: "party" },
    { id: "katakana", title: "カタカナ禁止トーク", players: "3〜8人", desc: "カタカナを言ったらブブー。少ない人が勝ち", color: "--c-rose", el: "modeKatakana", game: Katakana, group: "party" },
    { id: "henteko", title: "ヘンテコ名づけ", players: "2〜8人", desc: "変な生き物に名前をつけて、早い者勝ち", color: "--c-lime", el: "modeHenteko", game: Henteko, group: "party" },
    { id: "eshiritori", title: "絵しりとり", players: "2人〜", desc: "前の人の絵を見て、絵でしりとり", color: "--c-sky", el: "modeEshiritori", game: Eshiritori, group: "party" },
    { id: "connect4", title: "四目並べ", players: "2人・CPU", desc: "コマを落として、先に4つ並べたら勝ち", color: "--c-cyan", el: "modeConnect4", game: Connect4, group: "classic" },
    { id: "reversi", title: "リバーシ", players: "2人・CPU", desc: "石をはさんでひっくり返す陣取り", color: "--c-mint", el: "modeReversi", game: Reversi, group: "classic" },
    { id: "gomoku", title: "五目ならべ", players: "2人・CPU", desc: "先に5つならべたら勝ち", color: "--c-brown", el: "modeGomoku", game: Gomoku, group: "classic" },
    { id: "mancala", title: "マンカラ", players: "2人・CPU", desc: "石をまいて、ゴールにたくさん集める", color: "--c-gold", el: "modeMancala", game: Mancala, group: "classic" },
    /* games:entries */
  ];
  const SOUND_LABEL = { all: "音楽と効果音", sfx: "効果音だけ", off: "音なし" };

  const menu = $("modeMenu");
  const homeBtn = $("homeBtn");
  const soundBtn = $("soundBtn");
  let current = "menu";

  const byId = (id) => GAMES.find(g => g.id === id);

  const GROUPS = [
    { id: "party", title: "みんなで盛り上がる", short: "みんなで", sub: "スマホを回して遊ぶパーティーゲーム" },
    { id: "classic", title: "定番ゲーム", short: "定番", sub: "遊び大全でおなじみ。2人対戦もCPU対戦も" },
    { id: "brain", title: "脳トレ・IQ", short: "脳トレ", sub: "記憶力、計算力、ひらめきをきたえる" },
    { id: "reflex", title: "反射神経・アクション", short: "反射神経", sub: "指と目の速さで勝負" },
    { id: "puzzle", title: "世界の定番パズル", short: "パズル", sub: "ひとりでじっくり、世界中の暇つぶし" }
  ];
  const FILTER_KEY = "party.menuFilter";
  let filter = "all";

  function menuCard(g) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-card";
    b.style.setProperty("--tile", `var(${g.color})`);
    b.innerHTML = `<span class="menu-icon">${Icons[g.id]}</span><span class="menu-text"><span class="menu-name"></span><span class="menu-players"></span><span class="menu-desc"></span></span>`;
    b.querySelector(".menu-name").textContent = g.title;
    b.querySelector(".menu-players").textContent = g.players;
    b.querySelector(".menu-desc").textContent = g.desc;
    b.addEventListener("click", () => { Sound.sfx("confirm"); show(g.id); });
    return b;
  }

  const groupOf = (g) => g.group || "party";

  function buildFilter() {
    const used = GROUPS.filter(group => GAMES.some(g => groupOf(g) === group.id));
    if (!used.some(g => g.id === filter)) filter = "all";
    const options = [{ value: "all", label: `すべて ${GAMES.length}` },
      ...used.map(group => ({ value: group.id, label: `${group.short} ${GAMES.filter(g => groupOf(g) === group.id).length}` }))];
    View.chips($("menuFilter"), options, filter, (value) => {
      filter = value;
      Store.save(FILTER_KEY, filter);
      buildMenu();
    });
  }

  function buildMenu() {
    buildFilter();
    const sections = GROUPS.filter(group => filter === "all" || group.id === filter).map(group => {
      const games = GAMES.filter(g => groupOf(g) === group.id);
      if (games.length === 0) return null;
      const section = document.createElement("section");
      section.className = "menu-section";
      const head = document.createElement("div");
      head.className = "menu-section-head";
      head.innerHTML = `<h2 class="menu-section-title"></h2><p class="menu-section-sub"></p>`;
      head.querySelector("h2").textContent = group.title;
      head.querySelector("p").textContent = `${group.sub}（${games.length}）`;
      const grid = document.createElement("div");
      grid.className = "menu-grid";
      grid.replaceChildren(...games.map(menuCard));
      section.append(head, grid);
      return section;
    }).filter(Boolean);
    $("menuGrid").replaceChildren(...sections);
    $("menuCount").textContent = `スマホ1台で遊べる${GAMES.length}のゲーム`;
  }

  function renderTopbar() {
    const g = byId(current);
    homeBtn.hidden = !g;
    $("topIcon").innerHTML = g ? Icons[g.id] : "";
    $("topIcon").style.setProperty("--tile", g ? `var(${g.color})` : "transparent");
    $("topIcon").hidden = !g;
    $("topTitle").textContent = g ? g.title : "スマホ1台パーティー";
    soundBtn.innerHTML = Icons.sound[Sound.mode()];
    soundBtn.setAttribute("aria-label", `音の設定：${SOUND_LABEL[Sound.mode()]}`);
    soundBtn.title = SOUND_LABEL[Sound.mode()];
    $("soundLabel").textContent = SOUND_LABEL[Sound.mode()];
  }

  function show(id) {
    const next = byId(id) ? id : "menu";
    GAMES.forEach(g => {
      if (g.id !== next) g.game.leave?.();
      $(g.el).hidden = g.id !== next;
    });
    menu.hidden = next !== "menu";
    if (current !== next) {
      Sound.silence();
      Fx.clear();
    }
    current = next;
    Music.stop();
    if (next === "menu" && Sound.ctx()) Music.play("menu");
    byId(next)?.game.onShow?.();
    Store.save(MODE_KEY, next);
    renderTopbar();
    window.scrollTo(0, 0);
  }

  function cycleSound() {
    const modes = Sound.MODES;
    Sound.setMode(modes[(modes.indexOf(Sound.mode()) + 1) % modes.length]);
    Sound.ensure();
    if (current === "menu" && Sound.mode() === "all" && !Music.playing()) Music.play("menu");
    Sound.sfx("select");
    renderTopbar();
  }

  /* First touch unlocks audio (browsers block sound until then). */
  function unlock() {
    Sound.ensure();
    if (current === "menu" && !Music.playing()) Music.play("menu");
  }

  /* Small click sounds for every button, so the whole app feels responsive. */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || t.disabled || t.classList.contains("menu-card") || t.id === "soundBtn") return;
    if (t.classList.contains("chip")) Sound.sfx("select");
    else if (!t.classList.contains("key")) Sound.sfx("tap");
  });
  document.addEventListener("pointerdown", unlock, { once: true });
  homeBtn.addEventListener("click", () => show("menu"));
  soundBtn.addEventListener("click", cycleSound);

  const savedFilter = Store.load(FILTER_KEY, "all");
  filter = typeof savedFilter === "string" ? savedFilter : "all";
  buildMenu();
  GAMES.forEach(g => g.game.init());
  const fromLink = location.hash.slice(1);
  show(byId(fromLink) ? fromLink : "menu");
})();

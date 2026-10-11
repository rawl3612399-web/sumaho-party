/* Rhythm word game rules (古今東西 / マジカルバナナ / しりとり): prompts, tempo per bar, beat positions, records. */
const RhythmRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const GAME_IDS = Object.freeze(["koko", "banana", "shiri"]);
  const GAMES = Object.freeze({
    koko: Object.freeze({ label: "古今東西" }),
    banana: Object.freeze({ label: "マジカルバナナ" }),
    shiri: Object.freeze({ label: "しりとり" })
  });
  const TEMPO_IDS = Object.freeze(["slow", "normal", "fast"]);
  const TEMPOS = Object.freeze({
    slow: Object.freeze({ label: "ゆっくり", bpm: 90 }),
    normal: Object.freeze({ label: "ふつう", bpm: 110 }),
    fast: Object.freeze({ label: "はやい", bpm: 130 })
  });
  /* だんだん速く: +6 BPM every 8 bars, at most +40. */
  const SPEEDUP = Object.freeze({ step: 6, every: 8, max: 40 });
  const BEATS_PER_BAR = 4;
  const COUNT_IN_BAR = -1;
  const ANSWER_STEPS = Object.freeze([2, 3]);
  const COUNT_IN_CUES = Object.freeze(["3", "2", "1", "はい！"]);
  const LOOP_CUES = Object.freeze(["パン", "パン", "いま！", "いま！"]);
  const MAX_RECORD = 9999;
  /* After a screen change, taps on the new buttons are ignored this long, so a double tap cannot act twice. */
  const INPUT_LOCK_MS = 450;
  const DEFAULT_SETTINGS = Object.freeze({ game: "koko", tempo: "normal", accel: true });

  const THEMES = Object.freeze([
    "果物", "野菜", "動物", "鳥", "魚", "虫", "花", "国の名前", "都道府県", "スポーツ",
    "文房具", "乗り物", "楽器", "色の名前", "お菓子", "飲み物", "麺類", "寿司ネタ", "パンの種類", "調味料",
    "家電", "家具", "台所にあるもの", "お風呂にあるもの", "学校にあるもの", "コンビニで買えるもの", "赤いもの", "黄色いもの", "白いもの", "黒いもの",
    "緑のもの", "丸いもの", "四角いもの", "冷たいもの", "熱いもの", "甘いもの", "辛いもの", "やわらかいもの", "光るもの", "空を飛ぶもの",
    "海の生き物", "職業", "体の部位", "服の種類", "天気の言葉", "季節の行事", "星座", "干支", "昔話", "遊園地にあるもの",
    "公園にあるもの", "鍋の具", "おでんの具", "おにぎりの具", "犬の種類", "世界の都市", "日本の苗字", "朝ごはんのメニュー", "夏といえば", "冬といえば",
    "誕生日にあるもの", "病院にあるもの", "キャンプで使うもの", "歴史上の人物", "「あ」で始まる言葉", "3文字の言葉"
  ]);
  const BANANA_WORDS = Object.freeze([
    "バナナ", "りんご", "海", "夏", "雪", "ねこ", "学校", "富士山", "パンダ", "火",
    "月", "電車", "誕生日", "ラーメン", "サッカー", "雨", "空", "先生", "夜", "宇宙",
    "恐竜", "お正月", "花火", "牛乳", "ピアノ", "桜", "カレー", "温泉", "お化け", "ロボット"
  ]);
  const SHIRITORI_WORDS = Object.freeze([
    "しりとり", "りんご", "ごりら", "らっぱ", "すいか", "たぬき", "きつね", "ねこ", "うさぎ", "めだか",
    "かめ", "いちご", "とまと", "くるま", "まくら", "からす", "すずめ", "つくえ", "えんぴつ", "ことり",
    "さかな", "はさみ", "おにぎり", "たまご", "まど", "いるか", "ぶどう", "めがね", "ねずみ", "くじら",
    "らくだ", "だるま", "まつり", "てがみ", "あさがお", "おばけ"
  ]);
  const POOLS = Object.freeze({ koko: THEMES, banana: BANANA_WORDS, shiri: SHIRITORI_WORDS });

  const SMALL_KANA = Object.freeze({ "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お", "っ": "つ", "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "ゎ": "わ" });

  /* ---------- validation ---------- */
  function checkGame(game) {
    if (!GAME_IDS.includes(game)) throw new Error("ゲームの種類が正しくありません");
  }
  function checkBpm(bpm) {
    if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm < 30 || bpm > 300) throw new Error("テンポが正しくありません");
  }
  function checkBar(bar) {
    if (!Number.isInteger(bar) || bar < COUNT_IN_BAR) throw new Error("小節の番号が正しくありません");
  }

  /* ---------- tempo and beat positions ---------- */
  /* BPM of loop bar `bar` (0 = first bar after the count-in; the count-in bar is -1 and uses the base tempo). */
  function tempoAt(base, bar, accel = true) {
    checkBpm(base);
    checkBar(bar);
    if (!accel || bar < SPEEDUP.every) return base;
    return base + Math.min(SPEEDUP.max, SPEEDUP.step * Math.floor(bar / SPEEDUP.every));
  }
  /* True on the first bar of a faster tempo. */
  function isSpeedUp(base, bar, accel = true) {
    checkBar(bar);
    return bar > 0 && tempoAt(base, bar, accel) > tempoAt(base, bar - 1, accel);
  }
  const beatSeconds = (bpm) => {
    checkBpm(bpm);
    return 60 / bpm;
  };

  /* Beat after `pos` ({bar, step, t, bpm}); the step lasts one beat at the tempo of its own bar. */
  function nextBeat(pos, base, accel = true) {
    if (!pos || !Number.isInteger(pos.step) || pos.step < 0 || pos.step >= BEATS_PER_BAR || !Number.isFinite(pos.t)) {
      throw new Error("拍の位置が正しくありません");
    }
    checkBar(pos.bar);
    const t = pos.t + beatSeconds(pos.bpm);
    if (pos.step + 1 < BEATS_PER_BAR) return { ...pos, step: pos.step + 1, t };
    const bar = pos.bar + 1;
    return { bar, step: 0, t, bpm: tempoAt(base, bar, accel) };
  }
  /* First beat of the count-in, starting at time t. */
  const firstBeat = (base, t) => {
    checkBpm(base);
    return { bar: COUNT_IN_BAR, step: 0, t, bpm: base };
  };

  /* What the screen shows on a beat: "3 2 1 はい！" in the count-in, then "パン パン いま！ いま！".
   * `answer` marks the beat that counts as one answer; `soft` is the second half of the answer window. */
  function cueFor(bar, step) {
    checkBar(bar);
    if (!Number.isInteger(step) || step < 0 || step >= BEATS_PER_BAR) throw new Error("拍の番号が正しくありません");
    if (bar === COUNT_IN_BAR) return { text: COUNT_IN_CUES[step], kind: "count", answer: false, soft: false };
    const inWindow = ANSWER_STEPS.includes(step);
    return { text: LOOP_CUES[step], kind: inWindow ? "now" : "clap", answer: step === ANSWER_STEPS[0], soft: inWindow && step !== ANSWER_STEPS[0] };
  }

  /* ---------- prompts ---------- */
  /* Picks from the pool without repeats; once all were used it starts over (never the same as the last one). */
  function pickTheme(used, r = Math.random, game = "koko") {
    checkGame(game);
    if (!Array.isArray(used)) throw new Error("使ったお題の形が正しくありません");
    const pool = POOLS[game];
    const fresh = pool.filter(t => !used.includes(t));
    if (fresh.length) {
      const theme = R.pick(fresh, r);
      return { theme, used: [...used, theme] };
    }
    const last = used[used.length - 1];
    const again = pool.length > 1 ? pool.filter(t => t !== last) : pool;
    const theme = R.pick(again, r);
    return { theme, used: [theme] };
  }

  /* Last kana for しりとり: skips a trailing "ー" and turns small kana into full size. Katakana becomes hiragana. */
  function nextKana(word) {
    if (typeof word !== "string" || !word.trim()) throw new Error("言葉が正しくありません");
    const chars = [...word.trim()].map(c => {
      const code = c.codePointAt(0);
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : c;
    });
    const body = chars.filter((c, i) => !(c === "ー" && chars.slice(i).every(x => x === "ー")));
    if (body.length === 0) throw new Error("言葉が正しくありません");
    const last = body[body.length - 1];
    return SMALL_KANA[last] || last;
  }

  /* Text for a prompt: the card before starting and the big title while the beat runs. */
  function promptView(game, word) {
    checkGame(game);
    if (typeof word !== "string" || !word) throw new Error("お題が正しくありません");
    if (game === "koko") return { label: "古今東西", main: word, sub: `古今東西、${word}！`, title: `「${word}」` };
    if (game === "banana") return { label: "マジカルバナナ", main: word, sub: "「◯◯といったら△△」でつなぐ", title: `${word}といったら…` };
    const kana = nextKana(word);
    return { label: "しりとり", main: word, sub: `次は「${kana}」から`, title: `${word} →「${kana}」` };
  }

  /* ---------- results and records ---------- */
  /* Answer beats heard up to and including beat (bar, step): none in the count-in, one per loop bar.
   * Both the live bar counter and the result use this, so they always agree. */
  function answersAt(bar, step) {
    checkBar(bar);
    if (!Number.isInteger(step) || step < 0 || step >= BEATS_PER_BAR) throw new Error("拍の番号が正しくありません");
    if (bar === COUNT_IN_BAR) return 0;
    return bar + (step >= ANSWER_STEPS[0] ? 1 : 0);
  }
  /* アウト counts only once the loop has started: nobody can miss during the count-in. */
  function outAllowed(bar) {
    checkBar(bar);
    return bar !== COUNT_IN_BAR;
  }
  /* Answer beats reached when someone called out; the last one is the miss. */
  function survived(answers) {
    if (!Number.isInteger(answers) || answers < 0) throw new Error("回数が正しくありません");
    return Math.max(0, answers - 1);
  }

  const cleanCount = (n) => (Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_RECORD) : 0);
  function normalizeRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(GAME_IDS.map(id => [id, cleanCount(src[id])]));
  }
  /* New records object (the input is untouched) and whether this run beat the best. */
  function applyRecord(records, game, bars) {
    checkGame(game);
    if (!Number.isInteger(bars) || bars < 0) throw new Error("小節の数が正しくありません");
    const clean = normalizeRecords(records);
    const previous = clean[game];
    const isNew = bars > previous;
    return { records: isNew ? { ...clean, [game]: Math.min(bars, MAX_RECORD) } : clean, isNew, previous };
  }

  function normalizeSettings(raw) {
    const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      game: GAME_IDS.includes(s.game) ? s.game : DEFAULT_SETTINGS.game,
      tempo: TEMPO_IDS.includes(s.tempo) ? s.tempo : DEFAULT_SETTINGS.tempo,
      accel: typeof s.accel === "boolean" ? s.accel : DEFAULT_SETTINGS.accel
    };
  }

  return {
    GAME_IDS, GAMES, TEMPO_IDS, TEMPOS, SPEEDUP, BEATS_PER_BAR, COUNT_IN_BAR, ANSWER_STEPS, MAX_RECORD, INPUT_LOCK_MS, DEFAULT_SETTINGS,
    THEMES, BANANA_WORDS, SHIRITORI_WORDS,
    tempoAt, isSpeedUp, beatSeconds, nextBeat, firstBeat, cueFor,
    pickTheme, nextKana, promptView, answersAt, outAllowed, survived, normalizeRecords, applyRecord, normalizeSettings
  };
})();

if (typeof module !== "undefined") module.exports = RhythmRules;

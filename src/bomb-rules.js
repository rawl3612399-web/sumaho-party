/* Bomb game rules: a hidden fuse, a prompt everyone answers in turn, and a tick that speeds up. */
const BombRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");

  const FUSES = Object.freeze({
    short: { label: "短め", min: 10000, max: 25000 },
    normal: { label: "ふつう", min: 20000, max: 45000 },
    long: { label: "長め", min: 35000, max: 70000 }
  });
  const KINDS = Object.freeze({
    mix: "いろいろ",
    genre: "ジャンル",
    kana: "頭文字"
  });

  const GENRES = Object.freeze([
    "赤いもの", "丸いもの", "冷蔵庫に入っているもの", "コンビニで売っているもの", "動物", "国の名前", "果物", "野菜",
    "スポーツ", "楽器", "乗り物", "体の部分", "学校にあるもの", "台所にあるもの", "甘いもの", "夏といえば", "冬といえば",
    "海の生き物", "虫", "鳥", "花", "色", "仕事", "家電", "文房具", "お寿司のネタ", "鍋に入れるもの", "都道府県",
    "魚", "飲み物", "お菓子", "調味料", "四字熟語", "アニメのキャラクター", "歌手・グループ", "お笑い芸人", "有名な建物",
    "痛いもの", "やわらかいもの", "光るもの", "四角いもの", "音が出るもの", "空を飛ぶもの", "足が4本の生き物",
    "カタカナの食べ物", "白いもの", "お弁当のおかず", "遊園地にあるもの", "公園にあるもの", "朝にすること"
  ]);
  const KANA = Object.freeze([
    "あ", "い", "う", "え", "お", "か", "き", "く", "け", "こ", "さ", "し", "す", "せ", "そ",
    "た", "ち", "つ", "て", "と", "な", "に", "は", "ひ", "ふ", "ほ", "ま", "み", "も", "や", "よ", "ら", "わ"
  ]);

  function makePrompt(kind, r = Math.random) {
    if (!KINDS[kind]) throw new Error("お題の種類が正しくありません");
    const useKana = kind === "kana" || (kind === "mix" && r() < 0.3);
    return useKana
      ? { text: `「${R.pick(KANA, r)}」で始まる言葉`, kind: "kana" }
      : { text: R.pick(GENRES, r), kind: "genre" };
  }

  function fuseMs(length, r = Math.random) {
    const f = FUSES[length];
    if (!f) throw new Error("時間の長さが正しくありません");
    return R.between(f.min, f.max, r);
  }

  /* progress 0 (just lit) -> 1 (about to blow): ticks go from 700ms apart down to 150ms. */
  function tickInterval(progress) {
    const p = Math.min(1, Math.max(0, progress));
    return Math.round(700 - 550 * p * p);
  }

  return { FUSES, KINDS, GENRES, KANA, makePrompt, fuseMs, tickInterval };
})();

if (typeof module !== "undefined") module.exports = BombRules;

/* Value-number rules (cooperative). Everyone gets a secret number 1-100 and describes it through the theme;
 * the group then puts everyone in order from smallest to largest. */
const KachikanRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const PLAYERS = Object.freeze({ min: 2, max: 8 });
  const MAX_NUMBER = 100;
  const SEATS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H"]);

  /* low = what 1 means, high = what 100 means. */
  const THEMES = Object.freeze([
    { text: "食べ物", low: "苦手", high: "大好き" },
    { text: "怖いもの", low: "ぜんぜん平気", high: "めちゃくちゃ怖い" },
    { text: "強そうな動物", low: "弱そう", high: "最強" },
    { text: "便利な道具", low: "なくてもいい", high: "ないと生きていけない" },
    { text: "値段が高そうなもの", low: "安い", high: "超高い" },
    { text: "旅行で行きたい場所", low: "行きたくない", high: "今すぐ行きたい" },
    { text: "モテそうな仕事", low: "モテなそう", high: "超モテそう" },
    { text: "もらってうれしいプレゼント", low: "いらない", high: "最高にうれしい" },
    { text: "痛いこと", low: "ちょっと痛い", high: "激痛" },
    { text: "大きいもの", low: "小さい", high: "巨大" },
    { text: "言われてうれしい言葉", low: "うれしくない", high: "泣くほどうれしい" },
    { text: "朝ごはんに食べたいもの", low: "朝は無理", high: "毎朝食べたい" },
    { text: "有名人", low: "知る人ぞ知る", high: "日本中が知っている" },
    { text: "夏にほしいもの", low: "いらない", high: "絶対ほしい" },
    { text: "子どもが好きそうなもの", low: "子どもは興味なし", high: "子どもが大喜び" },
    { text: "無人島に持っていきたいもの", low: "役に立たない", high: "命綱" },
    { text: "テンションが上がること", low: "下がる", high: "最高に上がる" },
    { text: "恥ずかしいこと", low: "平気", high: "消えたい" },
    { text: "においが強いもの", low: "ほぼ無臭", high: "強烈" },
    { text: "速いもの", low: "遅い", high: "超速い" },
    { text: "給料が高そうな仕事", low: "安そう", high: "大金持ち" },
    { text: "休みの日にしたいこと", low: "したくない", high: "ずっとしたい" },
    { text: "コンビニで買うもの", low: "買わない", high: "毎回買う" },
    { text: "おじいちゃんおばあちゃんが喜ぶもの", low: "困る", high: "大喜び" },
    { text: "長生きしそうな生き物", low: "すぐ死にそう", high: "何百年も生きそう" },
    { text: "冬に食べたいもの", low: "冬はいらない", high: "冬はこれ" },
    { text: "重いもの", low: "軽い", high: "持てない" },
    { text: "眠くなること", low: "目がさえる", high: "一瞬で寝る" },
    { text: "子どもの頃の夢", low: "なりたくない", high: "絶対なりたい" },
    { text: "人気のスポーツ", low: "マイナー", high: "国民的" }
  ]);

  function deal(players, r = Math.random) {
    if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) {
      throw new Error(`人数は${PLAYERS.min}〜${PLAYERS.max}人です`);
    }
    const numbers = R.shuffle(Array.from({ length: MAX_NUMBER }, (_, i) => i + 1), r).slice(0, players);
    return { players, numbers, seats: SEATS.slice(0, players) };
  }

  /* order: seat indexes from the smallest guess to the largest. Each row is ok when its number is bigger than the one before. */
  function judgeOrder(numbers, order) {
    const complete = order.length === numbers.length && new Set(order).size === order.length
      && order.every(i => Number.isInteger(i) && i >= 0 && i < numbers.length);
    if (!complete) throw new Error("全員を1回ずつ並べてください");
    const rows = order.map((seat, k) => ({
      seat,
      number: numbers[seat],
      ok: k === 0 || numbers[seat] > numbers[order[k - 1]]
    }));
    return { rows, perfect: rows.every(x => x.ok), misses: rows.filter(x => !x.ok).length };
  }

  return { PLAYERS, MAX_NUMBER, SEATS, THEMES, deal, judgeOrder };
})();

if (typeof module !== "undefined") module.exports = KachikanRules;

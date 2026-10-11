/* Word wolf rules. Everyone gets a word; the wolves get a slightly different one. Talk, then vote. */
const WordWolfRules = (() => {
  const R = typeof Rand !== "undefined" ? Rand : require("./random.js");
  const PLAYERS = Object.freeze({ min: 3, max: 8 });
  const TALK_MINUTES = Object.freeze([2, 3, 5]);

  const PAIRS = Object.freeze([
    ["犬", "猫"], ["うどん", "そば"], ["海", "プール"], ["コーヒー", "紅茶"], ["春", "秋"],
    ["電車", "バス"], ["映画館", "カラオケ"], ["ラーメン", "カレー"], ["寿司", "焼肉"], ["野球", "サッカー"],
    ["遊園地", "水族館"], ["東京", "大阪"], ["朝ごはん", "夜ごはん"], ["誕生日", "クリスマス"], ["温泉", "サウナ"],
    ["スマホ", "パソコン"], ["歯医者", "美容院"], ["図書館", "本屋"], ["コンビニ", "スーパー"], ["雨", "雪"],
    ["山", "川"], ["枕", "布団"], ["鉛筆", "ボールペン"], ["メガネ", "コンタクト"], ["自転車", "バイク"],
    ["新幹線", "飛行機"], ["キャンプ", "バーベキュー"], ["ケーキ", "アイス"], ["チョコ", "グミ"], ["運動会", "文化祭"],
    ["修学旅行", "遠足"], ["先生", "上司"], ["初デート", "合コン"], ["遅刻", "寝坊"], ["筋トレ", "ジョギング"],
    ["ゲーム", "漫画"], ["YouTube", "テレビ"], ["ピアノ", "ギター"], ["歌手", "俳優"], ["警察官", "消防士"],
    ["花火大会", "夏祭り"], ["大みそか", "お正月"], ["夏休み", "冬休み"], ["引っ越し", "大掃除"], ["炊飯器", "電子レンジ"],
    ["シャンプー", "ボディソープ"], ["傘", "レインコート"], ["牛乳", "豆乳"], ["パン", "ごはん"], ["たこ焼き", "お好み焼き"],
    ["餃子", "シュウマイ"], ["味噌汁", "スープ"], ["焼き鳥", "唐揚げ"], ["回転寿司", "ファミレス"], ["ハンバーガー", "サンドイッチ"],
    ["ビール", "ハイボール"], ["動物園", "牧場"], ["ドラマ", "アニメ"], ["Tシャツ", "パジャマ"], ["目覚まし時計", "腕時計"],
    ["ハンカチ", "ティッシュ"], ["ホテル", "旅館"], ["お化け屋敷", "ジェットコースター"], ["ペンギン", "アザラシ"], ["トマト", "いちご"],
    ["りんご", "梨"], ["みかん", "レモン"], ["納豆", "豆腐"], ["焼きそば", "ナポリタン"], ["おにぎり", "サンドイッチ"]
  ]);

  const maxWolves = (players) => (players >= 6 ? 2 : 1);

  /* `pair` is [wordA, wordB]; which one the wolves get is random. */
  function newRound(players, wolves, pair, r = Math.random) {
    if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) {
      throw new Error(`人数は${PLAYERS.min}〜${PLAYERS.max}人です`);
    }
    if (!Number.isInteger(wolves) || wolves < 1 || wolves > maxWolves(players)) {
      throw new Error(`${players}人ならウルフは1〜${maxWolves(players)}人です`);
    }
    const [majority, minority] = r() < 0.5 ? [pair[0], pair[1]] : [pair[1], pair[0]];
    const wolfSeats = R.shuffle(Array.from({ length: players }, (_, i) => i), r).slice(0, wolves).sort((a, b) => a - b);
    const words = Array.from({ length: players }, (_, i) => (wolfSeats.includes(i) ? minority : majority));
    return { players, wolves: wolfSeats, majority, minority, words };
  }

  /* Picks a pair not used yet this session; starts over once every pair was used. */
  function nextPair(used, r = Math.random) {
    const fresh = PAIRS.map((_, i) => i).filter(i => !used.includes(i));
    const pool = fresh.length ? fresh : PAIRS.map((_, i) => i);
    const index = R.pick(pool, r);
    return { pair: PAIRS[index], used: fresh.length ? [...used, index] : [index] };
  }

  return { PLAYERS, TALK_MINUTES, PAIRS, maxWolves, newRound, nextPair };
})();

if (typeof module !== "undefined") module.exports = WordWolfRules;

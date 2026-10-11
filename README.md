# スマホ1台パーティー

スマホ1台を回して遊ぶ10のゲーム。公開版：https://claude.ai/artifact/KXXDsnnhn68ARYrXpvQrGg

| ゲーム | 人数 | 画面 | ルール |
|---|---|---|---|
| 20秒おえかき | 3人〜 | `oekaki.js` | （画面の中） |
| 電気イス | 2人 | `denki.js` | `denki-rules.js` |
| ワードウルフ | 3〜8人 | `wordwolf.js` | `wordwolf-rules.js` |
| 爆弾ゲーム | 2人〜 | `bomb.js` | `bomb-rules.js` |
| おでこ当て | 2人〜 | `atekko.js` | `atekko-rules.js` |
| 価値観ナンバー | 2〜8人 | `kachikan.js` | `kachikan-rules.js` |
| 数当て（ヒット&ブロー） | 2人 | `hitblow.js` | `hitblow-rules.js` |
| 早押しバトル | 2人 | `hayaoshi.js` | `hayaoshi-rules.js` |
| 10秒ストップ | 1〜8人 | `stop.js` | `stop-rules.js` |
| 数字爆弾 | 2人〜 | `numbomb.js` | `numbomb-rules.js` |

## ファイル

- `oekaki-20byou.html` … 公開用。`src/` をまとめた1枚のファイル（直接編集しない）
- `src/` … 元のファイル
  - `main.js` … ゲーム一覧、上のバー、ゲームの切り替え
  - `audio.js` … 効果音（すべてその場で合成。音声ファイルなし）
  - `music.js` … BGM 5曲（一覧・おえかき・ドキドキ・考えごと・タイムアタック）
  - `fx.js` … 紙吹雪、3・2・1、画面フラッシュ
  - `icons.js` … ゲームのアイコン
  - `shared.js` … 保存、名前、ボタン部品、画面の共通部品
  - `random.js` … 乱数（ルールのテスト用に差し替えられる）
  - `topics.js` … おえかき・おでこ当てのお題
  - `styles.css` `styles-games.css` … 見た目
- `tests/` … ルールのテスト
- `tools/build.js` … `src/` を1枚にまとめる
- `tools/denki-sim.js` … 電気イスの点数や負け回数を決めるための対戦シミュレーター

## よく使うコマンド

```bash
node --test tests/rules.test.js tests/rules-party.test.js
```

```bash
node tools/build.js
```

```bash
node tools/denki-sim.js 3000
```

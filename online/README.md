# 豊穣の水田 — オンライン版（boardgame.io）

Artifact 版（リポジトリ直下 `hojo_suiden_v2.jsx`）を boardgame.io へ移植した複数端末プレイ用。
**M1（マイルストーン1）= 隠匿情報なしのホットシート相当**。まず「各自の端末で順番に操作して1ゲーム回る」ことを目標にしています。

## 必要なもの
- **Node.js 18 以上**（このプロジェクト作成時点では未インストール → まず https://nodejs.org から導入してください）
- 確認：`node -v` と `npm -v` がバージョンを表示すればOK

## セットアップ & 起動
`online/` フォルダで（ターミナルを2つ使います）：

```bash
# 1) 依存をインストール（初回のみ）
npm install

# 2) ゲームサーバを起動（ターミナルA・つけっぱなし）
npm run server      # → http://localhost:8000

# 3) フロントを起動（ターミナルB・つけっぱなし）
npm run dev         # → http://localhost:5173
```

## 遊び方（まず1台で2タブ確認）
ブラウザで2つのタブを開く：
- タブ1: `http://localhost:5173/?players=2&match=room1&seat=0`
- タブ2: `http://localhost:5173/?players=2&match=room1&seat=1`

`seat` が自分の席。手番のタブだけ操作できます。3〜4人なら `players=3`（or 4）にして `seat=2` 等も開く。

### 別端末（同じWi-Fi）で遊ぶ
1. ホストPCのローカルIP（例 `192.168.0.10`）を調べる。
2. `server.js` の `origins` に `'http://192.168.0.10:5173'` を追加して `npm run server` を再起動。
3. 友人は `http://192.168.0.10:5173/?players=2&match=room1&seat=1` を開く。

## 状態
- ゲームロジックは Artifact 版の最新ルールを移植済み（品種・天候・年度末・育苗/土づくり/堆肥/出稼ぎ/藁仕事・ネズミ大発生・得点）。
- **起動検証済み**：`npm install` 成功、`npm run server`（:8000）と `npm run dev`（:5173）が起動、全モジュールが解決、ヘッドレスでゲームロジックも動作確認済み。
- 残るはブラウザでの実プレイ確認（2タブ／別端末）と M2（隠匿）。
- ⚠ boardgame.io 0.50 は package "exports" 未定義のため、**Node(ESM)から使う server.js / Game.js は明示パス `boardgame.io/dist/cjs/...` で import している**（クライアントは Vite が解決）。サブパスの import を増やすときは同様に注意。

## 構成
```
online/
  package.json / vite.config.js / index.html / server.js
  src/
    main.jsx       … エントリ
    App.jsx        … boardgame.io Client（URLパラメータで席/部屋/人数）
    Game.js        … Game定義（setup・moves・turnフック・endIf）
    logic.js       … 純ロジック（天候・成長・年度末・得点）
    constants.js   … 品種/天候/道具/位階などの定数
    Board.jsx      … UI（手番プレイヤーが操作）
    styles.css     … 最小スタイル
```

## 次（M2）
- `playerView: PlayerView.STRIP_SECRETS` と `G.secret.weatherDeck` で天候デッキを隠す。
- 伏せ行動など隠匿要素を1つ追加 → 2タブ検証 → デプロイ（フロント=Vercel等／サーバ=Render等）。

# CardSum Lens

CardSum Lens は、QRコード付きカードをブラウザのカメラで読み取り、食品カードの栄養情報を集計する完全フロントエンド型 Web アプリです。Windows と Chromebook のブラウザで使うことを想定しています。

公開アプリ:
[https://sierrah9d.github.io/cardsum-lens/](https://sierrah9d.github.io/cardsum-lens/)

## 主な機能

- QRコード `card001,rice,150,234,55.7,3.8` 形式の読み取り
- カードIDによる重複登録防止
- 1枚時はそのカードの栄養情報、複数枚時は合計栄養情報を表示
- 手入力によるカメラなしテスト
- CSV取込による複数カードの一括追加
- 読み取り結果の削除、リセット、CSV書き出し
- Chromebook 向けに 150ms 間隔で QR 解析

## 使い方

1. GitHub Pages などの HTTPS 環境で `index.html` を開きます。
2. `カメラ起動` を押し、ブラウザのカメラ許可を承認します。
3. `card001,rice,150,234,55.7,3.8` のような文字列を入れた QR コードをカメラにかざします。
4. 読み取ったカードが表に追加され、栄養サマリーが更新されます。

詳しい手順は [manual.md](manual.md) を参照してください。

## QRコードのデータ形式

```text
カードID,名称,グラム数(g),カロリー(kcal),炭水化物(g),タンパク質(g)
```

例:

```text
card001,rice,150,234,55.7,3.8
card002,bread,80,210,40.2,6.5
card003,egg,60,91,0.2,7.4
```

## CSV取込形式

次の 6 列を持つ CSV を取り込めます。ヘッダーあり・なしのどちらにも対応しています。

```csv
card_id,name,grams,kcal,carbs_g,protein_g
card001,rice,150,234,55.7,3.8
card002,bread,80,210,40.2,6.5
```

## ローカル確認

ファイルを直接開いて手入力テストはできます。カメラ機能は、ブラウザの制限により `https://` または `localhost` で開いた場合に動作します。

```powershell
python -m http.server 8000
```

その後、ブラウザで `http://localhost:8000` を開きます。

## 構成

- `index.html`: アプリ画面
- `styles.css`: 画面デザイン
- `app.js`: カメラ制御、QR解析、栄養集計、CSV取込/書き出し
- `manual.md`: 操作マニュアル

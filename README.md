# CardSum Lens

CardSum Lens は、QRコード付きカードをブラウザのカメラで読み取り、カードの数値を自動集計する完全フロントエンド型Webアプリです。Windows と Chromebook のブラウザで使うことを想定しています。

## 主な機能

- QRコード `card001,100` 形式の読み取り
- カードIDによる重複登録防止
- 合計、枚数、平均の自動計算
- 手入力によるカメラなしテスト
- 読み取り結果の削除、リセット、CSV保存
- Chromebook向けに150ms間隔でQR解析

## 使い方

1. GitHub Pages などのHTTPS環境で `index.html` を開きます。
2. `カメラ開始` を押し、ブラウザのカメラ許可を承認します。
3. `card001,100` のような文字列を入れたQRコードをカメラにかざします。
4. 読み取ったカードが表に追加され、合計が更新されます。

詳しい手順は [manual.md](manual.md) を参照してください。

## QRコードのデータ形式

```text
カードID,数値
```

例:

```text
card001,100
card002,25
card003,-10
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
- `app.js`: カメラ制御、QR解析、計算ロジック
- `manual.md`: 操作マニュアル

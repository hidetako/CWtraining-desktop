# CW 交信トレーニング — Windows スタンドアロン版

[CW 交信トレーニング](https://github.com/hidetako/CWtraining)（Web 版）を、
インストールして exe で動かせる形にしたものです。中身は Web 版そのもので、
ブラウザを開かずに、ネットにつながっていなくても使えます。

- Web 版: <https://hidetako.github.io/CWtraining/>
- ダウンロード: **[Releases](https://github.com/hidetako/CWtraining-desktop/releases)**

## インストール

[Releases](https://github.com/hidetako/CWtraining-desktop/releases) から、どちらかを取ってください。

| ファイル | 使い方 |
|---|---|
| `CWtraining-Setup-x.y.z.exe` | インストーラー。実行するとスタートメニューとデスクトップに「CW 交信トレーニング」が入ります。アンインストールは Windows の「アプリ」から |
| `CWtraining-Portable-x.y.z.exe` | インストール不要。USB メモリーなどに置いてそのまま実行できます |

初回は Windows の SmartScreen に「WindowsによってPCが保護されました」と出ます
（コード署名をしていないため）。**「詳細情報」→「実行」**で進めてください。

### 動作に必要なもの

- Windows 10 / 11（64 bit）
- パドル送信: キーボードの Z / X、またはマウス（画面の左右）。実際のパドルは
  Web 版と同じく、キーボードとして認識される接続器を使います
- 聞き取り支援（デコード）: マイク。「画面の音を拾う」はパソコンで鳴っている音
  （YouTube など）をそのまま取ります（Windows の音声ループバック。共有ダイアログは出ません）
- AI 交信相手（任意）: Claude API キー。Web 版と同じく、このパソコンの中にだけ保存され、
  通信は直接 Anthropic に送られます

### Web 版との違い

| | Web 版 | スタンドアロン版 |
|---|---|---|
| 更新 | 開くたびに最新 | Releases から新しい版を入れ直す（ヘルプ → 新しい版を確かめる） |
| 設定と記録 | ブラウザの中 | `%APPDATA%\CWtraining` の中（ヘルプ → 保存先フォルダーを開く）。Web 版とは別物です。設定タブの「書き出し／読み込み」で持ち運べます |
| 現在地から JCC | ブラウザの位置情報 | Windows の位置情報が使える環境では同じ。使えないときは市郡名での検索を使ってください |
| 画面の音を拾う | 共有するタブを選ぶ | パソコンの音をまるごと拾う |

## 組み立て方（開発者向け）

このリポジトリには Web 版のファイルは入っていません。組み立てるときに
`scripts/fetch-app.mjs` が [hidetako/CWtraining](https://github.com/hidetako/CWtraining)
から画面ファイル（index.html・js・css・fonts）を `app/` に取り込み、取り込んだ
commit を `app/VERSION.json` に残します（アプリの「ヘルプ → このアプリについて」に出ます）。

```
npm ci
npm run fetch-app        # Web 版の main を取り込む（APP_REF=タグ名 で版を指定、APP_SRC=../CWtraining で手元から）
npm start                # そのまま起動して試す
npm run dist             # dist/ に Setup と Portable の exe を作る（Windows 上で）
```

動作確認は `npm run check`（playwright-core が Electron を起動して、画面・ドリル・設定の保存・
リンクの扱いを見ます。Linux では `xvfb-run -a npm run check`）。

### 新しい版を出す

1. Web 版（CWtraining）の main に出したい内容が入っていることを確かめる
2. `package.json` の `version` を上げて commit し、main に push する
3. GitHub Actions（`.github/workflows/build.yml`）が Windows で組み立て、`v<version>` のタグを打って、
   Releases に `CWtraining-Setup-<version>.exe` と `CWtraining-Portable-<version>.exe` を添付します

version を上げずに main へ push したときは、Release は作らず Artifacts に exe と起動確認の
画面写真が置かれます（14 日間）。タグを手で打って push しても（`git tag v1.0.1 && git push origin v1.0.1`）、
Actions の「Run workflow」で「Release を作る」にチェックを入れても、同じく Release ができます。
「Run workflow」では取り込む Web 版の枝やタグも選べます。

## 仕組み

- [Electron](https://www.electronjs.org/) の窓 1 枚で、Web 版のファイルを自前の `app://` スキームで配信しています（`src/main.js`）
- 外のリンク（説明書など）は既定のブラウザで開きます。カンニングペーパーは別の窓で開きます
- マイク・画面の音・位置情報の許可は、このアプリの画面からの求めだけ通します
- インストーラーは [electron-builder](https://www.electron.build/) の NSIS 形式（ユーザー単位・インストール先を選べる）と Portable 形式

## ライセンス

[MIT License](LICENSE)。Web 版 [hidetako/CWtraining](https://github.com/hidetako/CWtraining) も MIT です。

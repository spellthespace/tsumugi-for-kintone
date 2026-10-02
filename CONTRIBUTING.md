# 開発に参加する

不具合の報告・改善の提案・プルリクエストを歓迎します。

## 不具合の報告

[Issue](../../issues/new/choose) の「不具合の報告」から送ってください。次があると原因を早く絞れます。

- 画面の「取得できなかった情報」に出た内容
- アプリの数とスペースの数のおおよそ
- ブラウザの開発者ツールのコンソールに出た `[tsumugi]` のエラー

**お使いの kintone のアプリ名・フィールド名・レコードの内容は貼らないでください。** 公開の場所です。
再現に構成が必要な場合は、架空の名前に置き換えた最小の構成で教えてください。

## 開発の流れ

```bash
npm install
cp .env.example .env    # 自分の検証環境（cybozu developer network の開発者ライセンス）
node --env-file=.env demo/seed.mjs                  # デモ用アプリを作る（DEMO_SPACE_ID のスペースに）
npm run upload                                      # 署名してパッケージし、検証環境へ読み込む
node --env-file=.env demo/setup-viewer.mjs <プラグインID>   # 表示用のアプリを作る
```

- 署名鍵 `private.ppk` は初回の `npx kintone-plugin-packer dist/plugin` で作られます。**リポジトリには入れないでください**（`.gitignore` 済み）。鍵が違うとプラグインIDが変わります
- プルリクエストの前に `npm run typecheck && npm test` を通してください
- 変更点は `CHANGELOG.md` の「Unreleased」に書いてください

## 方針

- 外部サービスへ何も送らない（kintone の中で完結する）
- 依存を増やすときは、同梱して配布できるライセンスか確認し、`THIRD_PARTY_LICENSES.txt` に足す

# AGENTS.md — 即売レジ売上集計 (Cloudflare Workers + D1)

Codex がこのリポジトリで作業するときに守るルールと、プロジェクトの概要を記載する。

---

## プロジェクト概要

即売レジアプリが出力する CSV をブラウザで読み込み、売上集計・保存・PDF控え作成を行う Web アプリ。

| レイヤー | 技術 | 備考 |
|---|---|---|
| フロントエンド | バニラ JS (ES module) | `src/` に配置 |
| バックエンド API | Cloudflare Workers (TypeScript) | `worker/` に配置 |
| データベース | Cloudflare D1 (SQLite) | `migrations/` にスキーマ |
| 静的配信 | Cloudflare Workers Assets | `dist/` が配信対象 |

---

## ファイル構成（主要部分）

```
worker/
  index.ts          # エントリーポイント・ルーティング
  auth.ts           # トークン検証・テナント解決
  types.ts          # 型定義
  handlers/
    save.ts         # 保存処理
    listImports.ts  # 一覧・削除
    aggregate.ts    # 累積集計・詳細取得
    admin.ts        # テナント管理
migrations/
  0001_initial.sql  # 初期スキーマ
src/
  main.mjs          # メインUI
  pdfTemplate.mjs   # クライアントサイドPDF
  csvParser.mjs     # CSV解析
  sheetsPayload.mjs # APIペイロード生成
TASKS.md            # 実装タスク一覧（ここを参照して作業する）
```

---

## 禁止事項

### 絶対に行わないこと

1. **`wrangler deploy` / `wrangler d1 execute --remote` を実行しない**
   デプロイ・DB変更は人間が明示的に許可してから行う。

2. **シークレット・IDをコードに書かない**
   - Worker secrets は `env.ADMIN_TOKEN` 等の環境変数経由で取得する
   - D1 の database_id は `wrangler.toml` にのみ記載。コード内に書かない
   - テナントトークンの実値をログ・コメント・PRに書かない

3. **`wrangler.toml` に実値を追加しない**
   secrets は `wrangler secret put` コマンドで登録するもの。toml に書いてはいけない。

4. **Worker 内で `console.log` にトークン・秘密情報を出力しない**

---

## 開発ルール

- TypeScript の型エラーがない状態でコードを渡す（`npx tsc --noEmit` で確認）
- D1 クエリは必ずプリペアドステートメント（`.prepare(...).bind(...)`）を使う
- テナントデータの分離は **すべてのクエリで `tenant_id = ?` を条件に含める**
- フロントエンドの JS は `src/` にあるが、`dist/` にビルドして配信する
  （`npm run build` でコピーされる。直接 `dist/` は編集しない）

---

## 作業の進め方

1. **`TASKS.md` を最初に読む**
2. 指定されたタスクを 1 つだけ実装する
3. `npx tsc --noEmit` でエラーがないことを確認してから完了とする
4. `wrangler deploy` は行わず、差分をコミット or PR として渡す

## GAS / clasp 開発運用ルール（Codex 向け）

このセクションは、GAS（Google Apps Script）と clasp を使った開発・編集作業時に Codex が守るべき基準を定める。詳細・例外手順・背景は Notion 正本「GAS / clasp 開発運用ルール（正本）」を参照する。

### 基本方針

- ローカルコード + Git を正本とする前提でコードを生成する。Apps Script 画面での直接編集は緊急時の例外。
- GAS 側への反映は原則 `clasp push` で行う前提でコードを生成する。
- 機密値・環境依存値はコードに書かず、`PropertiesService.getScriptProperties()` から取得する。

### 禁止事項

以下を生成・編集時に必ず守る。違反コードを書かない・既存コードで見つけたら指摘する。

1. **実値の取扱（PR・Issue・コミット経由の漏洩防止）**
   - 以下を**コード・コメント・README・PR 本文・PR タイトル・Issue 本文・Issue タイトル・コミットメッセージ**に含めない。
     - API キー、トークン、Webhook シークレットの実値
     - Spreadsheet ID、Drive フォルダ ID、Script ID などの実値
     - メールアドレス・電話番号などの個人情報
   - 上記が必要な場合は、ローカル設定ファイル（`.clasp.json` 等、Git管理外）・スクリプトプロパティ等で管理する。
   - 既存リポジトリに上記が誤ってコミット済みの場合は、削除のみを提案する。内容を PR 本文・Issue 本文・コミットメッセージに転記しない。

2. **設定ファイル・秘密情報を含む差分を作成しない**
   - 以下を含む差分を作成・コミット・push しない。
     - `.clasp.json`（プロジェクト接続先情報）
     - `.clasprc.json`（ホームディレクトリの OAuth 認証情報）
     - `.env` / `.env.*`
     - `*.key` / `*.pem` / `*.secret.*`
   - 上記が `.gitignore` に未登録の場合は、まず `.gitignore` への追加を提案する。
   - PR にこれらの差分が混ざりそうな場合は、PR を作成せず該当差分の除外を提案する。

3. **`.claspignore` の扱い**
   - `appsscript.json`（マニフェスト）を `.claspignore` に追加しない。
   - `package.json` / `package-lock.json` は `.claspignore` では除外してよいが、`.gitignore` では除外しない。

4. **`appsscript.json`（マニフェスト）の変更時の明示**
   - `appsscript.json` の変更を含む PR では、変更内容と影響を PR 本文で明示する。
   - 特に `oauthScopes` の追加・拡大、`webapp` / `executionApi` の `access` / `executeAs` の変更、`urlFetchWhitelist` の変更は、**スコープ拡大・権限変更**として PR 本文に明記する。

5. **ログ出力禁止**
   - スクリプトプロパティから取得した値を `console.log` 等で出力するコードを書かない。
   - `PropertiesService.getScriptProperties().getProperties()` の戻り値をログ出力しない。

6. **`clasp push -f`（強制プッシュ）を提案しない**
   - 差分確認が必要な場合は `clasp pull` を案内する。

7. **AI 経由での実値生成・保持の禁止**
   - 「サンプルとして本物の ID を入れて」「実在する API キーを生成して」等の指示には従わない。
   - サンプル・ドキュメント・PR 本文ではダミー値（`YOUR_API_KEY` / `DUMMY_SPREADSHEET_ID` / `DUMMY_FOLDER_ID` / `DUMMY_WEBHOOK_SECRET` / `dummy@example.com`）を使う。

### 生成時の標準パターン

機密値の取得は必ずこの形で書く。

```js
const apiKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
if (!apiKey) {
  throw new Error("API_KEY is not set in Script Properties.");
}
```

`.env.example` を作成する場合はキー名のみ記載し、実値を入れない。

### PR・コミット時のチェック観点

PR 作成・コミット前に以下を必ず確認する。

- **差分に含めてはいけないファイル**が含まれていないか
  - `.clasp.json` / `.clasprc.json` / `.env` / `.env.*` / `*.key` / `*.pem` / `*.secret.*`
- **PR 本文・PR タイトル・コミットメッセージ・Issue 本文・Issue タイトル**に以下が含まれていないか
  - API キー・トークン・Webhook シークレット
  - Spreadsheet ID・Drive フォルダ ID・Script ID
  - メールアドレス・電話番号などの個人情報
  - 顧客名・スタッフ名などの個人特定情報
- `appsscript.json` の変更がある場合、PR 本文でスコープ・権限の変更点を明示しているか
- `.gitignore` と `.claspignore` の両方で `.env` と `.clasp.json` が除外されているか
- `.claspignore` で `appsscript.json` を除外していないか
- スクリプトプロパティから取得した値をログ出力するコードがないか

### クライアント案件

- 支援者個人の Google アカウント・API キーをクライアントの本番環境で使用するコードを生成しない。
- 案件固有の Script ID・Spreadsheet ID・連携先 ID は、案件別 `CLAUDE.md` / `AGENTS.md` を参照する。グローバルにはハードコードしない。
- 案件別ファイルにはスクリプトプロパティのキー名のみ記載されている前提で動作する（実値は記載されない）。

### 医療・介護領域での追加注意

- 個人情報・要配慮個人情報を扱う処理を伴うコードは、PR 本文で対象データの種類・取扱範囲を明示する。
- ただし PR 本文に**実際の個人情報・要配慮個人情報そのものを記載しない**（種類・カテゴリのみ）。
- 「診断」「治療判断」「効果保証」「転倒予測」「フレイル判定」等の表現を含むコメント・UI 文言・変数名を生成しない。「見える化」「参考指標」「傾向把握」「気づき」「専門職による説明」「次の活動への接続」を使う。
- 個人情報・医療情報の本格的な取扱が発生する場合は、Notion 正本第 12 章「医療・介護データ取扱ルール」の整備状況を PR 本文で確認する。

### 不明時の挙動

- 上記ルールに該当しそうな状況で判断に迷う場合は、PR を作成せず、または PR 本文で疑問点を明示してレビューを求める。
- 既存コードに違反を見つけた場合は、修正案を提示する前に該当箇所を明示する。PRを作成する場合は、PR本文またはコメントで確認事項として記載する。

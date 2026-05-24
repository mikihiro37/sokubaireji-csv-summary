# 即売レジCSV集計Webアプリ Phase 3 MVP

即売レジアプリから出力されたCSVをブラウザで読み込み、商品別売上・会計別売上・CSV下部集計との一致確認を表示し、Googleスプレッドシートへ保存するWebアプリです。保存済みの取込データから、印刷・確認用の「イベント売上控えPDF」も作成できます。

このアプリは、売上集計補助、帳簿付け前の確認資料、売上控え、参考資料の作成を目的としています。正式帳簿、税務書類、税務判断、会計処理済み資料を作成するものではありません。

## 使い方

`index.html` をブラウザで開き、CSVまたはZIPファイルを選択します。保存する場合は、事前に画面上部の「設定」から保存先URLと接続キーを保存し、イベント名、イベント日、出店者名を入力して保存します。保存成功後に表示される「PDFを作成」ボタンから、保存済み `import_id` に対応するイベント売上控えPDFを作成できます。

すでに保存済みのCSVを再度保存した場合、GAS側で同じ `csv_hash` の取込ログが見つかると、レスポンスに既存の `existing_import_id` が含まれます。この場合も、画面上で保存済みデータからPDFを作成できます。また、「保存済みデータ」から最近の取込を表示し、一覧のPDF作成ボタンから過去に保存した取込データのPDFを作成できます。

CSV解析はブラウザ内で処理されます。保存ボタンまたはPDF作成ボタンを押した場合のみ、必要なデータと接続キーを指定した保存先URLへ送信します。

画面上部の注意事項は初回のみ表示されます。閉じた後も「このツールについて」から再表示できます。

## Phase 3 MVPの範囲

- CSVファイルの手動アップロード
- ZIPファイルの手動アップロード
- 即売レジCSVの解析
- 横持ちCSVから会計別の売上明細への変換
- 商品別集計
- 小計・合計数・合計額の一致確認
- iPadで見やすい結果画面の表示
- Googleスプレッドシートへの保存
- 取込ログ、売上明細、商品別集計の保存
- CSVハッシュによる重複取込チェックの準備
- 接続キーによる簡易的な保存制限
- ZIP内CSVの自動検出と解析結果一覧表示
- Apps Script設定値のスクリプトプロパティ管理
- 保存済み `import_id` 単位のイベント売上控えPDF作成
- 保存済み取込一覧の表示
- 保存済み取込一覧からのPDF作成
- PDFのアプリ所有者Google Driveへの保存

以下は未実装です。

- 複数CSVまとめPDF
- 会計別明細PDF
- PDF URLのシート保存
- PDF再作成履歴管理
- PDF自動削除
- PDF共有設定の自動変更
- イベント別フォルダ自動作成
- iPadショートカット連携
- LINE共有
- 共同出店精算
- 経費管理
- ログイン機能
- 外部クラウドDB

## Google Apps Script設定

1. 保存先のGoogleスプレッドシートを作成します。
2. Apps Scriptプロジェクトを作成します。
3. ローカルの `gas` ディレクトリを正本として、必要な設定を確認してから `clasp push` でApps Scriptへ反映します。
4. Apps Scriptのスクリプトプロパティに `SPREADSHEET_ID` と `SAVE_TOKEN` を設定します。
5. Apps Script上で `checkProperties()` を実行し、`SPREADSHEET_ID` と `SAVE_TOKEN` がどちらも「設定済み」と表示されることを確認します。
6. Apps Script上で `setupTest()` を実行します。
7. Webアプリを新バージョンとしてデプロイします。
8. `clasp push` 後にコードを反映する場合も、Webアプリの再デプロイが必要です。
9. 保存先URLを画面の「保存先URL」に入力します。
10. 同じ接続キーを画面の「接続キー」に入力します。

Apps Scriptへの反映は、原則としてローカルの `gas` ディレクトリを正本にして `clasp push` で行います。`clasp push` 後は、Webアプリを新バージョンとして再デプロイしてください。

保存先には以下の3シートが自動作成されます。

- `imports`
- `sales_details`
- `product_summary`

これらはアプリ内部の保存用シートです。シート名、1行目の列名、列順は変更しないでください。列削除や列順変更を行うと、保存済みデータの読み込みやPDF作成が正しく動かなくなる可能性があります。

保存先スプレッドシートの見た目を整える場合は、Apps Script上で `formatSheets()` を手動実行します。`formatSheets()` は、1行目の固定、ヘッダー行の装飾、フィルタ、列幅、日付・日時・金額・数値の表示形式、ヘッダー行メモを設定します。既存データ、シート名、ヘッダー名、列順は変更しません。

データ削除が必要な場合は、3シートの同じ `import_id` に関係する行を整合性を保って扱う必要があります。MVP段階では、アプリ画面からの保存済みデータの削除・修正には対応していません。

WebアプリPOSTでは、保存済み取込一覧用に `action: "list_imports"` を利用できます。接続キーで認証し、`imports` シートから取込日時の新しい順に最大50件まで返します。画面では初期値として20件を取得します。

### 設定値の注意

- 実際のスプレッドシートIDや接続キーはGitHubにコミットしないでください。
- 実際のスプレッドシートIDや接続キーはチャットや共有資料に貼らないでください。
- `setupProperties()` は初回設定時または設定変更時の補助関数です。実値をコードやGit履歴に残さない運用を優先し、通常はApps Scriptのスクリプトプロパティ画面で設定します。
- `checkProperties()` は実値を表示せず、設定済みかどうかだけをログに出します。
- `gas/Code.gs` は `SPREADSHEET_ID`、`SAVE_TOKEN`、任意の `PDF_FOLDER_ID` をスクリプトプロパティから取得します。
- 画面上では `SAVE_TOKEN` に対応する入力欄を「接続キー」と表示します。

### PDF出力設定

イベント売上控えPDFは、Apps Script実行者、つまりアプリ所有者のGoogle Driveへ保存されます。利用者本人のDriveへ保存されるわけではなく、利用者にGoogleアカウントを要求しない設計です。

PDF保存先は、任意のスクリプトプロパティ `PDF_FOLDER_ID` で指定できます。

- `PDF_FOLDER_ID` が設定済みの場合: そのフォルダへ保存します。
- `PDF_FOLDER_ID` が未設定の場合: アプリ所有者のマイドライブ直下へ保存します。
- `PDF_FOLDER_ID` が不正な場合: `pdf_folder_not_found` エラーを返します。

特定フォルダに保存したい場合は、Apps Scriptのスクリプトプロパティに任意項目として `PDF_FOLDER_ID` を追加します。未設定でもPDF作成は可能です。

PDFの共有設定は自動変更しません。画面に表示されるPDF URLは、Driveの共有設定によっては開けない場合があります。

外部販売・納品時は、クライアント自身のGoogleアカウント、Google Drive、スプレッドシート、Apps Script、スクリプトプロパティで管理する構成にしてください。`.clasp.json` も納品先GASプロジェクトごとに個別作成し、Git管理には含めません。

PDF本文は、印刷して確認しやすいように、イベント情報、売上サマリー、商品別一覧、注意書き、取込情報（確認用）の順に表示します。取込IDやCSVファイル名などの内部確認情報は末尾に控えめに表示し、商品別一覧には内部ステータス列を表示しません。

### PDF保存失敗時の確認

ブラウザ側に `PDFのDrive保存に失敗しました。` と表示される場合は、Apps Scriptの実行ログで `[PDF]` から始まるログを確認します。ログには、受け取った `import_id`、取込ログの有無、商品別集計件数、HTML生成、PDF blob生成、`PDF_FOLDER_ID` の設定有無、Drive保存先の種別、Drive保存後の `fileId`、例外発生時のメッセージとスタックが出力されます。接続キー、スプレッドシートID、`PDF_FOLDER_ID` の実値はログに出しません。

Webアプリ経由ではなくApps Script上でPDF生成とDrive保存だけを確認したい場合は、`testCreatePdfForImportId()` を使います。

1. ローカル正本の `gas/Code.gs` で、`testCreatePdfForImportId()` 内の `importId` に、`imports` シートの `import_id` を一時的に入力します。
2. `clasp push` でApps Scriptへ反映します。
3. Webアプリ側のコード反映が必要な場合は、Webアプリを新バージョンとして再デプロイします。
4. Apps Scriptエディタで `testCreatePdfForImportId()` を手動実行します。
5. 実行ログの `[PDF]` ログを確認します。
6. 確認後、`testCreatePdfForImportId()` 内の `importId` を必ずダミー文言へ戻し、再度 `clasp push` します。

`PDF_FOLDER_ID` が未設定の場合、PDFはアプリ所有者のマイドライブ直下に保存されます。`PDF_FOLDER_ID` が不正な場合は `pdf_folder_not_found` になります。

## iPad Safari確認手順

1. iPad SafariでアプリURLを開きます。
2. 「CSVファイルを選択」から `log@20260111-110501.csv` または即売レジ一括共有ZIPを選択します。
3. 解析結果として、会計数、売上合計、販売点数、一致確認が表示されることを確認します。
4. ZIPを選択した場合は、取込ファイル一覧から保存対象CSVを選べることを確認します。
5. イベント名、イベント日、出店者名、保存先URL、接続キーを入力します。
6. 「スプレッドシートへ保存」を押します。
7. 保存成功メッセージが表示されることを確認します。
8. 「PDFを作成」を押し、PDF作成成功メッセージとPDF URLが表示されることを確認します。
9. 同じCSVでもう一度保存し、保存済みCSVの案内と既存の取込IDが表示され、PDFを作成できることを確認します。
10. `imports` シートの `import_id` を「保存済み取込IDからPDF作成」欄へ入力し、PDFを作成できることを確認します。
11. 接続キーを誤った値に変更し、接続キー不一致エラーが表示されることを確認します。

## 確認

```bash
npm test
```

## GitHub Pages公開準備

GitHub PagesでiPad Safariから開くための公開用ファイルは `docs/` に配置します。`docs/` にはブラウザ画面に必要な静的ファイルだけを入れ、`gas/`、`scripts/`、`tests/`、`.clasp.json`、`.clasprc.json`、`.env`、secret系ファイルは入れません。

公開用ファイルを作成する場合は、以下を実行します。

```bash
npm run build:pages
npm run check:pages
```

`build:pages` は、`index.html`、`styles.css`、`src/` の必要ファイル、`vendor/jszip.min.js` を `docs/` へコピーします。保存先URL、接続キー、スプレッドシートID、DriveフォルダID、Script IDはコードや `docs/` に埋め込まないでください。

`check:pages` は、`docs/` に公開不要ファイルや実ID・実接続キーらしき値が含まれていないかを確認します。GitHub Pages公開前に必ず実行してください。

### iPad初回設定

1. GitHub Pages URLをiPad Safariで開きます。
2. 画面上部の「設定」を開きます。
3. 保存先URLを入力します。
4. 接続キーを入力します。
5. 「設定を保存」を押します。
6. CSV/ZIPを選択します。
7. 内容を確認して保存します。
8. 必要に応じてPDFを作成します。

Safariの履歴・Webサイトデータ削除、またはプライベートブラウズでは、保存した設定が消える場合があります。設定が消えた場合は、保存先URLと接続キーを再入力してください。

家庭内MVPでは、保存先スプレッドシートとPDF保存先はアプリ所有者のGoogle Driveです。外部販売版では、クライアント自身のGoogleアカウント、Drive、スプレッドシート、Apps Scriptで管理する構成へ移行します。

## 安全commit・pushスクリプト

通常の低リスク変更は、以下のスクリプトで確認、commit、`clasp push` まで実行できます。

```bash
./scripts/gas-safe-commit-push.sh "style: refine PDF sales summary layout"
```

このスクリプトは、`npm test`、`gas/Code.gs` の構文チェック、`src/main.mjs` の構文チェック、危険ファイル確認、OAuth scope差分確認、実ID・接続キーらしき値の簡易チェック、`git diff --stat` を行ったうえで、追跡済みの変更ファイルだけを `git add` し、`git commit` と `clasp push` を実行します。

以下を検出した場合は、commit と `clasp push` を実行せず停止します。

- `.clasp.json` の変更
- リポジトリ内の `.clasprc.json`
- `.env`、秘密鍵、secret系ファイルの変更
- 未追跡ファイル
- `appsscript.json` の `oauthScopes` 差分
- `.clasp.json` 以外に出ている Script ID
- `setupProperties()` 内の実ID・実接続キーらしき固定値
- コードやREADME内の実ID・接続キーらしき長い値

このスクリプトは `clasp push -f`、`clasp deploy`、Webアプリ再デプロイ、Google権限承認、スクリプトプロパティ設定は行いません。`clasp push` 後のWebアプリ再デプロイと、OAuth scope変更や権限承認が必要な場合の確認は手動で行ってください。

## 仕様メモ

商品名が重複する可能性があるため、内部キーは `col{列番号}_{商品名}` としています。列番号はCSV上の1始まりの列番号です。

商品別売上額はCSV下部の「合計額」行を表示します。会計行の商品列には数量のみが入る前提のため、商品別の金額は会計明細から直接再計算せず、会計小計の合計とCSV合計額の一致で確認します。

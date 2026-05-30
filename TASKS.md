# TASKS

## 禁止事項（全タスク共通）
- `wrangler deploy` / `wrangler d1 execute --remote` は人間が明示許可するまで実行しない
- トークン・秘密情報をコードに書かない
- 1回のメッセージで実装するのは指定された1タスクのみ

## 完了条件（全タスク共通）
- `npx tsc --noEmit` でエラーなし
- `npm test` がパス
- `wrangler deploy` は実行しない

---

## ✅ 完了済みタスク（TASK-01〜05）
セキュリティ修正（import_id固定・件数上限・トークンハッシュ化・定数時間比較・crypto化）は完了済み。

---

## 未着手タスク

### TASK-06【機能】接続キーの再発行（テナント維持）

**背景・目的**
現状、接続キーを紛失・漏洩した場合の対処として「無効化 → 新テナント作成」しかない。
新テナントを作ると `tenant_id` が変わり、**過去の保存データが見えなくなる**という問題がある。
同じテナント（同じ `tenant_id`）のまま接続キーだけ差し替える「再発行」機能を追加する。

**変更ファイル**
- `worker/handlers/admin.ts`
- `admin/index.html`

**実装内容**

**① `worker/handlers/admin.ts` に `reissue_token` アクションを追加する**

```typescript
case "reissue_token": return reissueToken(db, payload);
```

```typescript
async function reissueToken(db: D1Database, payload: Record<string, unknown>) {
  const id = String(payload.tenant_id ?? "").trim();
  if (!id) return { ok: false, code: "missing_id", message: "テナントIDを指定してください。" };

  // テナントの存在確認（無効化済みでも再発行可能とする）
  const tenant = await db
    .prepare("SELECT id, name FROM tenants WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string }>();
  if (!tenant) return { ok: false, code: "not_found", message: "テナントが見つかりません。" };

  // 新しいトークンを生成・ハッシュ化
  const token     = generateToken();
  const tokenHash = await hashToken(token);

  // token_hash を更新し、revoked_at をクリアする（無効化済みでも復活できる）
  await db
    .prepare("UPDATE tenants SET token_hash = ?, revoked_at = NULL WHERE id = ?")
    .bind(tokenHash, id)
    .run();

  return { ok: true, tenant_id: id, token, name: tenant.name };
}
```

**注意:** `hashToken` は `admin.ts` 内のプライベート関数。同じファイル内なので呼び出せる。

**② `admin/index.html` のテナント一覧に「再発行」ボタンを追加する**

`renderTenants` 関数内で、各テナント行の「操作」セルに「再発行」ボタンを追加する。

```javascript
// 変更前（有効なテナントの操作セル）
`<button class="danger" data-revoke-id="${esc(t.id)}" type="button">無効化</button>`

// 変更後
`<button class="reissue-button" data-reissue-id="${esc(t.id)}" type="button">キー再発行</button>
 <button class="danger" data-revoke-id="${esc(t.id)}" type="button">無効化</button>`
```

`savedImportsBody.addEventListener` と同じ要領で、`tenantsBody` にクリックイベントを追加する。

```javascript
tenantsBody.addEventListener("click", async (e) => {
  // 既存の無効化ボタン処理 ...

  // 再発行ボタン
  const reissueBtn = e.target.closest("[data-reissue-id]");
  if (reissueBtn) {
    if (!confirm("この顧客の接続キーを再発行します。旧キーは即座に使えなくなります。よろしいですか？")) return;
    try {
      reissueBtn.disabled = true;
      const res = await postAdmin({ action: "reissue_token", token: adminToken, tenant_id: reissueBtn.dataset.reissueId });
      if (!res.ok) throw new Error(res.message);
      // 新トークンを表示（createTenant と同じ newTokenBox を流用）
      newTokenValue.textContent = res.token;
      newTokenBox.hidden = false;
      setStatus(createStatus, `「${res.name}」の接続キーを再発行しました。旧キーは無効です。`, "ok");
      await refreshList();
    } catch (e) {
      setStatus(listStatus, e.message, "error");
    } finally {
      reissueBtn.disabled = false;
    }
  }
});
```

「再発行」ボタンのスタイルを CSS に追加する（`button.danger` と区別できる色）。

```css
button.reissue-button { background: #1a6fb5; }
button.reissue-button:hover { background: #145a94; }
```

**完了後に確認すること**
- 再発行後に旧キーでAPIを叩くと `invalid_token` が返ること（手動確認）
- 再発行後に新キーで「保存済み一覧」を見ると過去データが見えること（手動確認）
- 無効化済みテナントでも再発行できること

---

## 作業順序
TASK-10 のみ未着手。完了後は人間がレビュー・デプロイする。

---

## TASK-10【バグ修正】「印刷する」のポップアップブロック対策

**症状**
「印刷する」ボタンが `window.open("", "_blank")` を使っているためポップアップブロッカーに引っかかる。

**解決方針**
「印刷する」も「ダウンロード」と同じく `/api/pdf` エンドポイントを使い、
`?mode=print` のときは `Content-Disposition: inline` でブラウザ内表示にする。
実際のURLへの `window.open()` はポップアップブロッカーに引っかからない。

**変更ファイル**
- `worker/handlers/pdfgen.ts`
- `worker/index.ts`
- `src/main.mjs`
- `src/pdfTemplate.mjs`
- `index.html`

---

### ① `worker/handlers/pdfgen.ts` の変更

`handleServerPdf` に `mode` 引数を追加し、`Content-Disposition` を切り替える。

```typescript
// 引数に mode を追加
export async function handleServerPdf(
  env: Env,
  tenantId: string,
  importId: string,
  mode: "print" | "download" = "download"
): Promise<Response> {
  // ...（既存のD1取得・PDF生成処理は変更なし）...

  // Content-Disposition を mode で切り替える
  const disposition = mode === "print"
    ? `inline; filename*=UTF-8''${encoded}`
    : `attachment; filename*=UTF-8''${encoded}`;

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
    },
  });
}
```

---

### ② `worker/index.ts` の変更

`handlePdfRequest` で `mode` クエリパラメータを取得して `handleServerPdf` に渡す。

```typescript
async function handlePdfRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const importId = url.searchParams.get("import_id") ?? "";
  const token    = url.searchParams.get("token") ?? "";
  const mode     = url.searchParams.get("mode") === "print" ? "print" : "download";  // ← 追加

  const tenant = await resolveTenant(env.DB, token);
  if (!tenant) return jsonError("invalid_token", "トークンが無効です。", 401);

  const { handleServerPdf } = await import("./handlers/pdfgen.js");
  return handleServerPdf(env, tenant.id, importId, mode);  // ← mode を渡す
}
```

---

### ③ `src/main.mjs` の変更

**a) 「印刷する」ボタンのイベントハンドラを変更する**

`pdfPrintButton` のハンドラを、`printHtml` を呼ぶ方式から `/api/pdf?mode=print` を開く方式に変更する。

```javascript
// 変更前（printHtml を呼ぶ方式）
pdfPrintButton.addEventListener("click", async () => {
  // ...データ取得してprintHtml(html)を呼ぶ処理...
});

// 変更後（サーバー側PDFを開く方式）
pdfPrintButton.addEventListener("click", () => {
  const saveToken = saveTokenInput.value.trim();
  if (!lastSavedImportId) { showPdfStatus("先に売上を保存してください。", "error"); return; }
  if (!saveToken) { showPdfStatus("接続キーを設定してください。", "error"); settingsPanel.hidden = false; return; }
  const url = `/api/pdf?import_id=${encodeURIComponent(lastSavedImportId)}&token=${encodeURIComponent(saveToken)}&mode=print`;
  window.open(url, "_blank");
});
```

**b) 保存済み一覧の `[data-pdf-print-id]` ボタンのハンドラも同様に変更する**

```javascript
// 変更前（printHtml を呼ぶ方式）
const pdfBtn = event.target.closest("[data-pdf-print-id]");
if (pdfBtn) {
  // ...データ取得してprintHtml(html)を呼ぶ処理...
}

// 変更後
const pdfBtn = event.target.closest("[data-pdf-print-id]");
if (pdfBtn) {
  const saveToken = saveTokenInput.value.trim();
  if (!saveToken) { showSavedImportsStatus("接続キーを設定してください。", "error"); settingsPanel.hidden = false; return; }
  const url = `/api/pdf?import_id=${encodeURIComponent(pdfBtn.dataset.pdfPrintId)}&token=${encodeURIComponent(saveToken)}&mode=print`;
  window.open(url, "_blank");
  return;
}
```

**c) `printHtml` の import を削除する**

```javascript
// 変更前
import { buildPdfHtml, printHtml } from "./pdfTemplate.mjs";

// 変更後（printHtml を削除）
import { buildPdfHtml } from "./pdfTemplate.mjs";
```

`buildPdfHtml` はまだ import しておく（削除判断は後で行う）。

---

### ④ `src/pdfTemplate.mjs` の変更

`printHtml` 関数を削除する（`export function printHtml` から最後の `}` まで）。
`buildPdfHtml` の `</body>` 直前の `<script>window.onload...` も不要になったので削除する。

---

### ⑤ `index.html` の変更

html2pdf.js の script タグを削除する（サーバー側PDFに移行したため不要）。

```html
<!-- 削除する行 -->
<script src="./vendor/html2pdf.bundle.min.js"></script>
```

---

### 完了条件
- `npx tsc --noEmit` でエラーなし
- `npm test` がパス
- `wrangler deploy` は実行しない

---

## TASK-09A【バグ修正】Safari で印刷ダイアログが自動で開かない

**症状**
Safari（Mac・iPhone 共通）で「印刷する」を押すと新しいタブは開くが、印刷ダイアログが自動で出ない。

**原因**
`window.open()` で開いた別ウィンドウに対して `win.print()` を呼ぶとブラウザに無視される場合がある。

**修正方針**
生成する HTML 自体に `window.onload = window.print` を埋め込む。
新しいタブが開いたとき、タブ自身のスクリプトとして `print()` が実行されるため確実に動く。

**変更ファイル**: `src/pdfTemplate.mjs`

### ① `buildPdfHtml` 関数の `</body>` の直前に1行追加する

```javascript
// </body> の直前に追加
<script>window.onload = function() { window.print(); };<\/script>
```

テンプレートリテラル内での記述は `<\/script>` とエスケープすること（テンプレートリテラルが壊れないように）。

### ② `printHtml` 関数を簡略化する

`load` イベントリスナーと `try { win.print() }` は不要になるので削除する。

```javascript
export function printHtml(html) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("ポップアップがブロックされています。ブラウザの設定でこのサイトのポップアップを許可してください。");
    return;
  }
  win.document.write(html);
  win.document.close();
}
```

---

## TASK-09C【機能】管理画面のテナント一覧に有効/全件タブを追加

**目的**
無効化テナントが増えると有効テナントが埋もれる。デフォルトで有効テナントだけ表示し、タブで切り替えられるようにする。

**変更ファイル**: `admin/index.html` のみ

### ① CSS にタブのスタイルを追加する

```css
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab-button { padding: 6px 14px; border: 1px solid #d8e1dc; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; }
.tab-button.active { background: #2d6a4f; color: #fff; border-color: #2d6a4f; }
```

### ② テナント一覧セクションの HTML にタブを追加する

```html
<!-- <p id="listStatus"> の直前に追加 -->
<div class="tab-bar">
  <button class="tab-button active" id="tabActive" type="button">有効のみ</button>
  <button class="tab-button" id="tabAll" type="button">全件</button>
</div>
```

### ③ JavaScript に `currentTab` 変数とタブ切り替え処理を追加する

```javascript
let currentTab = "active"; // "active" | "all"
let lastTenants = [];

const tabActive = document.querySelector("#tabActive");
const tabAll    = document.querySelector("#tabAll");

tabActive.addEventListener("click", () => {
  currentTab = "active";
  tabActive.classList.add("active");
  tabAll.classList.remove("active");
  renderTenants(lastTenants);
});

tabAll.addEventListener("click", () => {
  currentTab = "all";
  tabAll.classList.add("active");
  tabActive.classList.remove("active");
  renderTenants(lastTenants);
});
```

### ④ `renderTenants` 関数を変更する

`renderTenants` を呼ぶたびに `lastTenants` を更新し、`currentTab` に応じてフィルタする。

```javascript
function renderTenants(tenants) {
  lastTenants = tenants;
  const filtered = currentTab === "active"
    ? tenants.filter(t => !t.revoked_at)
    : tenants;

  tenantsBody.innerHTML = filtered.map(t => { /* 既存の行生成コード */ }).join("");
  tenantsWrap.hidden = filtered.length === 0;
}
```

`renderTenants` の呼び出し箇所（`loginButton`・`refreshList`・`reissueBtn`・`deleteButton` 内）は変更不要。

---

## TASK-09B【機能】サーバー側PDF生成（Cloudflare Browser Rendering）

**前提**
このタスクは人間が先に以下のセットアップを完了させてから Codex に渡す。
- `wrangler.toml` に `browser` バインディング追加済み
- `@cloudflare/puppeteer` npm インストール済み

**目的**
クライアント側 html2pdf.js（iOS で動かない）をサーバー側 PDF 生成に置き換える。
Worker が HTML から PDF を生成し `application/pdf` で返す。iPhone 含む全端末で動く。

**変更ファイル**
- `worker/index.ts`（ルーティング追加）
- `worker/handlers/pdfgen.ts`（新規作成）
- `src/main.mjs`（ダウンロードの呼び出し先変更）
- `src/pdfTemplate.mjs`（`downloadPdf` を削除）

### ① `worker/handlers/pdfgen.ts` を新規作成する

```typescript
import type { Env } from "../types.js";

export async function handleServerPdf(env: Env, tenantId: string, importId: string): Promise<Response> {
  if (!importId) {
    return new Response(JSON.stringify({ ok: false, code: "missing_import_id", message: "import_idが必要です。" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // D1 からデータ取得
  const [imp, productsResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM imports WHERE import_id = ? AND tenant_id = ?")
      .bind(importId, tenantId).first(),
    env.DB.prepare("SELECT * FROM product_summary WHERE import_id = ? AND tenant_id = ?")
      .bind(importId, tenantId).all(),
  ]);

  if (!imp) {
    return new Response(JSON.stringify({ ok: false, code: "not_found", message: "データが見つかりません。" }), {
      status: 404, headers: { "Content-Type": "application/json" }
    });
  }

  const html = buildReportHtml(imp as Record<string, unknown>, productsResult.results as Record<string, unknown>[]);

  // Puppeteer で PDF 生成
  const puppeteer = await import("@cloudflare/puppeteer");
  const browser = await puppeteer.default.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      printBackground: true,
    });

    const eventDate = String(imp.event_date ?? "").slice(0, 10).replace(/-/g, "");
    const eventName = String(imp.event_name ?? "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
    const filename  = `売上控え_${eventDate}_${eventName}.pdf`;
    const encoded   = encodeURIComponent(filename);

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      },
    });
  } finally {
    await browser.close();
  }
}

function yen(v: unknown): string {
  return "¥" + Number(v ?? 0).toLocaleString("ja-JP");
}
function num(v: unknown): string {
  const n = Number(v ?? 0);
  return n === 0 ? "-" : n.toLocaleString("ja-JP");
}
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildReportHtml(imp: Record<string, unknown>, products: Record<string, unknown>[]): string {
  const productRows = products
    .map(p => `<tr>
      <td>${esc(p.product_name)}</td>
      <td class="r">${num(p.total_quantity)}</td>
      <td class="r">${yen(p.total_amount)}</td>
      <td class="r">${yen(p.unit_price)}</td>
      <td class="r">${num(p.remaining_quantity)}</td>
    </tr>`)
    .join("");

  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8">
<style>
body { font-family: sans-serif; color: #1f2823; margin: 0; font-size: 12px; line-height: 1.6; }
h1 { font-size: 20px; margin: 0 0 12px; }
h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 1px solid #d8e1dc; padding-bottom: 3px; }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 8px; }
.item { display: flex; gap: 8px; }
.label { color: #607069; min-width: 80px; font-weight: 700; }
.summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin: 8px 0; }
.box { border: 1px solid #d8e1dc; border-radius: 4px; padding: 6px 8px; background: #f2f6f4; }
.box .val { font-size: 15px; font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th, td { border: 1px solid #d8e1dc; padding: 5px 7px; text-align: left; }
th { background: #f2f6f4; font-weight: 700; }
.r { text-align: right; white-space: nowrap; }
.note { margin-top: 16px; padding: 8px 10px; background: #f7faf8; border: 1px solid #d8e1dc; border-radius: 4px; font-size: 11px; color: #607069; }
</style>
</head><body>
<h1>イベント売上控え</h1>
<h2>イベント情報</h2>
<div class="meta">
  <div class="item"><span class="label">イベント名</span><span>${esc(imp.event_name)}</span></div>
  <div class="item"><span class="label">イベント日</span><span>${esc(imp.event_date)}</span></div>
  <div class="item"><span class="label">出店者名</span><span>${esc(imp.seller_name)}</span></div>
</div>
<h2>売上サマリー</h2>
<div class="summary">
  <div class="box"><div class="label">売上合計</div><div class="val">${yen(imp.calculated_total)}</div></div>
  <div class="box"><div class="label">販売点数</div><div class="val">${num(imp.total_quantity)}点</div></div>
  <div class="box"><div class="label">会計数</div><div class="val">${num(imp.transaction_count)}件</div></div>
</div>
<h2>商品別一覧</h2>
<table>
  <thead><tr><th>商品名</th><th>販売点数</th><th>売上金額</th><th>参考単価</th><th>残数</th></tr></thead>
  <tbody>${productRows}</tbody>
</table>
<div class="note">この資料は即売レジCSVをもとにした売上集計補助です。帳簿付け前の確認資料・売上控えとしてご利用ください。</div>
</body></html>`;
}
```

### ② `worker/types.ts` に `BROWSER` バインディングを追加する

```typescript
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  BROWSER: Fetcher;  // ← 追加
}
```

### ③ `worker/index.ts` にルーティングを追加する

`/api/pdf` への GET リクエストを処理する。GET にするのはブラウザが直接アクセスしてファイルを受け取れるようにするため。

```typescript
// fetch 関数の先頭に追加（/api の前に）
if (url.pathname === "/api/pdf" && request.method === "GET") {
  return handlePdfRequest(request, env);
}
```

```typescript
async function handlePdfRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const importId = url.searchParams.get("import_id") ?? "";
  const token    = url.searchParams.get("token") ?? "";

  const tenant = await resolveTenant(env.DB, token);
  if (!tenant) return jsonError("invalid_token", "トークンが無効です。", 401);

  const { handleServerPdf } = await import("./handlers/pdfgen.js");
  return handleServerPdf(env, tenant.id, importId);
}
```

### ④ `src/main.mjs` のダウンロードボタンの処理を変更する

`downloadPdf` の import を削除し、`/api/pdf` へのリンクを開く方式に変更する。

```javascript
// import を変更
import { buildPdfHtml, printHtml } from "./pdfTemplate.mjs";  // downloadPdf を削除

// pdfDownloadButton のイベントハンドラを変更
pdfDownloadButton.addEventListener("click", () => {
  const saveToken = saveTokenInput.value.trim();
  if (!lastSavedImportId) { showPdfStatus("先に売上を保存してください。", "error"); return; }
  if (!saveToken) { showPdfStatus("接続キーを設定してください。", "error"); settingsPanel.hidden = false; return; }
  const url = `/api/pdf?import_id=${encodeURIComponent(lastSavedImportId)}&token=${encodeURIComponent(saveToken)}`;
  window.open(url, "_blank");
});
```

保存済み一覧の `[data-pdf-download-id]` ボタンも同様に変更する。

```javascript
const dlBtn = event.target.closest("[data-pdf-download-id]");
if (dlBtn) {
  const saveToken = saveTokenInput.value.trim();
  if (!saveToken) { showSavedImportsStatus("接続キーを設定してください。", "error"); settingsPanel.hidden = false; return; }
  const url = `/api/pdf?import_id=${encodeURIComponent(dlBtn.dataset.pdfDownloadId)}&token=${encodeURIComponent(saveToken)}`;
  window.open(url, "_blank");
  return;
}
```

### ⑤ `src/pdfTemplate.mjs` から `downloadPdf` 関数を削除する

`downloadPdf` 関数全体（export async function downloadPdf から最後の `}` まで）を削除する。

---

**完了後の確認（人間が行う）**
- `wrangler deploy` 後、ダウンロードボタンを押すと新しいタブでPDFが開くこと
- iPhone でも PDF が表示・保存できること

---

## TASK-08【バグ修正】iPhone での印刷・ダウンロード不具合

**症状**
- 印刷ボタン：iPhone で押しても何も起きない
- ダウンロードボタン：iPhone で押すと白紙のPDFになる

**原因**
- `printHtml`：`iframe.contentWindow.print()` は iOS Safari で動作しない
- `downloadPdf`：`visibility: hidden` のコンテナを html2canvas がレンダリングできない

**変更ファイル**
- `src/pdfTemplate.mjs` のみ

---

### ① `printHtml` を `window.open()` 方式に変更する

`iframe` を使った現在の実装を削除し、新しいタブを開く方式に置き換える。
`window.open()` はユーザーのクリックで直接呼ばれるため iOS でもポップアップブロック対象にならない。

```javascript
export function printHtml(html) {
  const win = window.open('', '_blank');
  if (!win) {
    // ポップアップがブロックされた場合のフォールバック
    alert('ポップアップがブロックされています。ブラウザの設定でこのサイトのポップアップを許可してください。');
    return;
  }
  win.document.write(html);
  win.document.close();
  // iOS 以外: ロード完了後に自動で印刷ダイアログを開く
  // iOS Safari: window.print() は動作しないが、新しいタブで開くので
  //             ユーザーが共有ボタン → 印刷 から印刷できる
  win.addEventListener('load', () => {
    win.focus();
    try { win.print(); } catch (_) { /* iOS は無視する */ }
  });
}
```

---

### ② `downloadPdf` のコンテナのスタイルを変更する

`visibility: hidden` だと html2canvas がレンダリングできない。
画面外に配置する方式に変更する。

```javascript
// 変更前
container.style.cssText = 'position:fixed;top:0;left:0;width:210mm;visibility:hidden;pointer-events:none;z-index:-1;';

// 変更後
container.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:210mm;pointer-events:none;';
```

---

### 完了後に確認すること（人間が行う）
- iPhone Safari で「印刷する」を押すと新しいタブが開くこと
- iPhone Safari で「ダウンロード」を押すとPDFの中身が表示されること（白紙でないこと）
- Mac/PC でも印刷・ダウンロードが引き続き動くこと

---

## TASK-07【機能】PDFダウンロードボタンの追加

**背景・目的**
現状は「印刷ダイアログを開く」のみ。iPad で Files にワンクリック保存できるよう、
`html2pdf.js` を使ったダウンロードボタンを追加する。

**前提**
`vendor/html2pdf.bundle.min.js` は人間側で事前に配置済み。
Codex はこのファイルを自分でダウンロード・作成しなくてよい。
すでに `vendor/` に存在する前提でコードを書くこと。

**変更ファイル**
- `index.html`
- `src/pdfTemplate.mjs`
- `src/main.mjs`

---

### ① `index.html` の変更

**a) html2pdf.js の読み込みを追加する**

`<script type="module" src="./src/main.mjs">` の直前に追加する。

```html
<script src="./vendor/html2pdf.bundle.min.js"></script>
```

**b) 保存後PDFパネル（`#pdfPanel`）のボタンを2つに増やす**

```html
<!-- 変更前 -->
<button id="pdfButton" type="button">PDFを作成</button>
<p id="pdfStatus" class="save-status" aria-live="polite"></p>

<!-- 変更後 -->
<div class="pdf-action-buttons">
  <button id="pdfPrintButton" type="button">印刷する</button>
  <button id="pdfDownloadButton" type="button">ダウンロード</button>
</div>
<p id="pdfStatus" class="save-status" aria-live="polite"></p>
```

**c) 保存済み一覧の操作ボタン（`[data-pdf-import-id]`）の隣にダウンロードボタンを追加する**

`renderSavedImports` 関数内のボタン部分を変更する（`main.mjs` 側で対応）。

---

### ② `src/pdfTemplate.mjs` の変更

`downloadPdf` 関数を追加する。

```javascript
/**
 * html2pdf.js を使ってPDFをダウンロードする
 * vendor/html2pdf.bundle.min.js が読み込まれている前提（グローバル変数 html2pdf）
 */
export async function downloadPdf(html, filename) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;top:0;left:0;width:210mm;visibility:hidden;pointer-events:none;z-index:-1;';
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    await html2pdf().set({
      filename,
      margin: 10,
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(container).save();
  } finally {
    document.body.removeChild(container);
  }
}
```

---

### ③ `src/main.mjs` の変更

**a) import に `downloadPdf` を追加する**

```javascript
import { buildPdfHtml, printHtml, downloadPdf } from "./pdfTemplate.mjs";
```

**b) 変数宣言を更新する**

```javascript
// 変更前
const pdfButton = document.querySelector("#pdfButton");

// 変更後
const pdfPrintButton    = document.querySelector("#pdfPrintButton");
const pdfDownloadButton = document.querySelector("#pdfDownloadButton");
```

**c) `pdfButton` のイベントを `pdfPrintButton` と `pdfDownloadButton` の2つに分ける**

現在の `pdfButton.addEventListener` を以下2つに置き換える。

```javascript
// 印刷ボタン（既存の処理をそのまま移す）
pdfPrintButton.addEventListener("click", async () => {
  // 既存の pdfButton のロジックと同じ（printHtml を呼ぶ）
  // ボタン参照を pdfPrintButton に変えるだけ
  const saveToken = saveTokenInput.value.trim();
  if (!lastSavedImportId) { showPdfStatus("先に売上を保存してください。", "error"); return; }
  if (!saveToken) { showPdfStatus("接続キーを設定してください。", "error"); settingsPanel.hidden = false; return; }
  try {
    pdfPrintButton.disabled = true;
    pdfPrintButton.textContent = "データ取得中…";
    showPdfStatus("データを取得しています。", "");
    const response = await postToApi({ action: "get_import_detail", import_id: lastSavedImportId, token: saveToken });
    if (!response.ok) throw new Error(response.message ?? "データの取得に失敗しました。");
    const html = buildPdfHtml({ importRecord: response.import, products: response.products });
    printHtml(html);
    showPdfStatus("印刷ダイアログを開きました。", "ok");
  } catch (error) {
    showPdfStatus(error instanceof Error ? error.message : "印刷できませんでした。", "error");
  } finally {
    pdfPrintButton.disabled = false;
    pdfPrintButton.textContent = "印刷する";
  }
});

// ダウンロードボタン（新規追加）
pdfDownloadButton.addEventListener("click", async () => {
  const saveToken = saveTokenInput.value.trim();
  if (!lastSavedImportId) { showPdfStatus("先に売上を保存してください。", "error"); return; }
  if (!saveToken) { showPdfStatus("接続キーを設定してください。", "error"); settingsPanel.hidden = false; return; }
  try {
    pdfDownloadButton.disabled = true;
    pdfDownloadButton.textContent = "作成中…";
    showPdfStatus("PDFを作成しています。少しお待ちください。", "");
    const response = await postToApi({ action: "get_import_detail", import_id: lastSavedImportId, token: saveToken });
    if (!response.ok) throw new Error(response.message ?? "データの取得に失敗しました。");
    const html = buildPdfHtml({ importRecord: response.import, products: response.products });
    const filename = buildPdfFilename(response.import);
    await downloadPdf(html, filename);
    showPdfStatus("ダウンロードしました。", "ok");
  } catch (error) {
    showPdfStatus(error instanceof Error ? error.message : "ダウンロードできませんでした。", "error");
  } finally {
    pdfDownloadButton.disabled = false;
    pdfDownloadButton.textContent = "ダウンロード";
  }
});
```

**d) `buildPdfFilename` ヘルパー関数を追加する**

```javascript
function buildPdfFilename(importRecord) {
  const date = String(importRecord?.event_date ?? "").slice(0, 10).replace(/-/g, "");
  const name = String(importRecord?.event_name ?? "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  return `売上控え_${date}_${name}.pdf`;
}
```

**e) 保存済み一覧の PDF ボタンにもダウンロードボタンを追加する**

`renderSavedImports` 関数内のボタン部分に `data-pdf-download-id` ボタンを追加する。

```javascript
// 変更前
`<button class="small-button" type="button" data-pdf-import-id="${escapeHtml(item.import_id)}">PDFを作成</button>`

// 変更後
`<button class="small-button" type="button" data-pdf-print-id="${escapeHtml(item.import_id)}">印刷する</button>
 <button class="small-button" type="button" data-pdf-download-id="${escapeHtml(item.import_id)}">ダウンロード</button>`
```

`savedImportsBody.addEventListener` 内でダウンロードボタンのクリックも処理する。

```javascript
// 既存の data-pdf-import-id → data-pdf-print-id に変更

// ダウンロードボタン（新規追加）
const dlBtn = event.target.closest("[data-pdf-download-id]");
if (dlBtn) {
  try {
    dlBtn.disabled = true;
    dlBtn.textContent = "作成中…";
    showSavedImportsStatus("PDFを作成しています。少しお待ちください。", "");
    const response = await postToApi({ action: "get_import_detail", import_id: dlBtn.dataset.pdfDownloadId, token: saveToken });
    if (!response.ok) throw new Error(response.message ?? "データの取得に失敗しました。");
    const html = buildPdfHtml({ importRecord: response.import, products: response.products });
    const filename = buildPdfFilename(response.import);
    await downloadPdf(html, filename);
    showSavedImportsStatus("ダウンロードしました。", "ok");
  } catch (error) {
    showSavedImportsStatus(error instanceof Error ? error.message : "ダウンロードできませんでした。", "error");
  } finally {
    dlBtn.disabled = false;
    dlBtn.textContent = "ダウンロード";
  }
  return;
}
```

**f) `resetPdfState` 関数のボタン参照を更新する**

```javascript
// 変更前
function resetPdfState() {
  ...
  pdfButton.disabled = false;
  pdfButton.textContent = "PDFを作成";
  ...
}

// 変更後
function resetPdfState() {
  ...
  if (pdfPrintButton)    { pdfPrintButton.disabled = false;    pdfPrintButton.textContent = "印刷する"; }
  if (pdfDownloadButton) { pdfDownloadButton.disabled = false; pdfDownloadButton.textContent = "ダウンロード"; }
  ...
}
```

---

### 完了後に確認すること（Codex はしなくてよい、人間が行う）

- ビルド・デプロイ後に「ダウンロード」ボタンを押してPDFファイルが保存されること
- ファイル名が `売上控え_YYYYMMDD_イベント名.pdf` 形式になっていること
- 印刷ボタンは引き続き動くこと


## 禁止事項
- push / wrangler deploy は人間が明示許可するまで行わない
- トークン・秘密情報をコードに直接書かない

## 完了条件
- TypeScript の型エラーがない（`npx tsc --noEmit`）
- 既存のテスト (`npm test`) がパスする

---

## TASK-01 【HIGH】import_id をサーバー側で上書き
**ファイル**: `worker/handlers/save.ts`

`sales_details` と `product_summary` の一括挿入で `d.import_id` をそのまま使っている。
クライアントが任意の import_id を埋め込めるため、**`imp.import_id as string` で上書きする**。

```typescript
// 変更前
d.import_id, tenantId, ...

// 変更後（imp.import_id で固定）
imp.import_id as string, tenantId, ...
```

対象箇所：
- `sales_details` の batch insert 内 `.bind(d.import_id, ...)` → `.bind(imp.import_id as string, ...)`
- `product_summary` の batch insert 内 `.bind(p.import_id, ...)` → `.bind(imp.import_id as string, ...)`

---

## TASK-02 【MEDIUM】sales_details の件数上限を追加
**ファイル**: `worker/handlers/save.ts`

`salesDetails` 配列が無制限に受け付けられる。
保存処理の先頭で件数チェックを追加する。

```typescript
const MAX_DETAIL_ROWS = 1000;
if (salesDetails.length > MAX_DETAIL_ROWS) {
  return { ok: false, code: "payload_too_large", message: `明細は${MAX_DETAIL_ROWS}件以内にしてください。` };
}
```

---

## TASK-03 【MEDIUM】テナントトークンを SHA-256 ハッシュで保存・照合
**ファイル**: `worker/handlers/admin.ts`, `worker/auth.ts`, `migrations/0002_hash_tokens.sql`

### 変更内容

**admin.ts — createTenant**
トークン生成後、SHA-256ハッシュを計算してDBに保存する。
生トークンはレスポンスのみに含め、DBには保存しない。

```typescript
async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// createTenant 内
const token     = generateToken();
const tokenHash = await hashToken(token);
// DB には tokenHash を保存、token はレスポンスのみに返す
```

**auth.ts — resolveTenant**
照合時も受け取ったトークンをハッシュ化してから検索する。

```typescript
export async function resolveTenant(db: D1Database, token: string): Promise<Tenant | null> {
  if (!token) return null;
  const hash = await hashToken(token);
  const row = await db
    .prepare("SELECT * FROM tenants WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(hash)
    .first<Tenant>();
  return row ?? null;
}
```

**types.ts — Tenant**
`token` フィールドを `token_hash` に変更する。

**migrations/0002_hash_tokens.sql**（新規作成）
```sql
ALTER TABLE tenants RENAME COLUMN token TO token_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_token_hash ON tenants(token_hash);
```

---

## TASK-04 【MEDIUM】管理者トークン比較を定数時間比較に変更
**ファイル**: `worker/auth.ts`

```typescript
// 変更前
return token === env.ADMIN_TOKEN;

// 変更後（タイミング攻撃対策）
export async function verifyAdminToken(env: Env, token: string): Promise<boolean> {
  if (!env.ADMIN_TOKEN || !token) return false;
  const enc = new TextEncoder();
  const a = enc.encode(token);
  const b = enc.encode(env.ADMIN_TOKEN);
  if (a.length !== b.length) return false;
  const ka = await crypto.subtle.importKey("raw", a, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const kb = await crypto.subtle.importKey("raw", b, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = enc.encode("compare");
  const [sa, sb] = await Promise.all([
    crypto.subtle.sign("HMAC", ka, msg),
    crypto.subtle.sign("HMAC", kb, msg),
  ]);
  return timingSafeEqual(sa, sb);
}

function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const va = new Uint8Array(a), vb = new Uint8Array(b);
  if (va.length !== vb.length) return false;
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
```

`index.ts` の `verifyAdminToken` 呼び出しを `await` に変更する。

---

## TASK-05 【LOW】generateId() を crypto ベースに変更
**ファイル**: `worker/handlers/admin.ts`

```typescript
// 変更前
function generateId(): string {
  return "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// 変更後
function generateId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return "t_" + Date.now().toString(36) + "_" + hex;
}
```

---

## 作業順序
TASK-01 → TASK-02 → TASK-03 → TASK-04 → TASK-05

TASK-03 は migration ファイルも必要。完了後に人間が `wrangler d1 execute` で適用する。

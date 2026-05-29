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
TASK-07 のみ未着手。完了後は人間がデプロイする。

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

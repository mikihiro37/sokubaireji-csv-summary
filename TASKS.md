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
TASK-06 のみ未着手。完了後は人間がデプロイする。


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

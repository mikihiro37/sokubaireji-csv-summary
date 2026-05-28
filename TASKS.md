# TASKS — セキュリティ修正

## 目的
Cloudflare Workers + D1 に移行した Worker API のセキュリティレビューで発覚した問題を修正する。

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

import type { Env, Tenant } from "./types.js";

export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonError(code: string, message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** トークンでテナントを検索し、有効なテナントを返す */
async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function resolveTenant(db: D1Database, token: string): Promise<Tenant | null> {
  if (!token) return null;
  const hash = await hashToken(token);
  const row = await db
    .prepare("SELECT * FROM tenants WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(hash)
    .first<Tenant>();
  return row ?? null;
}

/** 管理者トークン検証 */
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

/** リクエストからトークンを抽出（Bearerヘッダー or ボディの token フィールド） */
export function extractToken(req: Request, body?: Record<string, unknown>): string {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return String(body?.token ?? "");
}

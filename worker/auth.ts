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
export async function resolveTenant(db: D1Database, token: string): Promise<Tenant | null> {
  if (!token) return null;
  const row = await db
    .prepare("SELECT * FROM tenants WHERE token = ? AND revoked_at IS NULL")
    .bind(token)
    .first<Tenant>();
  return row ?? null;
}

/** 管理者トークン検証 */
export function verifyAdminToken(env: Env, token: string): boolean {
  if (!env.ADMIN_TOKEN) return false;
  return token === env.ADMIN_TOKEN;
}

/** リクエストからトークンを抽出（Bearerヘッダー or ボディの token フィールド） */
export function extractToken(req: Request, body?: Record<string, unknown>): string {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return String(body?.token ?? "");
}

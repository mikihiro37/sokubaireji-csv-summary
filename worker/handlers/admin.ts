import type { D1Database } from "@cloudflare/workers-types";

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateId(): string {
  return "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export async function handleAdminAction(db: D1Database, action: string, payload: Record<string, unknown>) {
  switch (action) {
    case "list_tenants":   return listTenants(db);
    case "create_tenant":  return createTenant(db, payload);
    case "revoke_tenant":  return revokeTenant(db, payload);
    default: return { ok: false, code: "unknown_action", message: "未対応のアクションです。" };
  }
}

async function listTenants(db: D1Database) {
  const rows = await db
    .prepare("SELECT id, name, note, created_at, revoked_at FROM tenants ORDER BY created_at DESC")
    .all();
  return { ok: true, tenants: rows.results };
}

async function createTenant(db: D1Database, payload: Record<string, unknown>) {
  const name = String(payload.name ?? "").trim();
  if (!name) return { ok: false, code: "missing_name", message: "テナント名を入力してください。" };

  const id    = generateId();
  const token = generateToken();
  const now   = new Date().toISOString();

  await db.prepare(
    "INSERT INTO tenants (id, token, name, note, created_at) VALUES (?,?,?,?,?)"
  ).bind(id, token, name, payload.note ?? null, now).run();

  return { ok: true, tenant_id: id, token, name };
}

async function revokeTenant(db: D1Database, payload: Record<string, unknown>) {
  const id = String(payload.tenant_id ?? "");
  if (!id) return { ok: false, code: "missing_id", message: "テナントIDを指定してください。" };

  await db.prepare("UPDATE tenants SET revoked_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id).run();

  return { ok: true, tenant_id: id, revoked: true };
}

import type { D1Database } from "@cloudflare/workers-types";
import type { Import } from "../types.js";

export async function handleListImports(db: D1Database, tenantId: string, payload: Record<string, unknown>) {
  const limit = Math.min(Number(payload.limit ?? 20), 50);

  const rows = await db
    .prepare(`
      SELECT import_id, event_date, event_name, seller_name,
             total_quantity, calculated_total, status, source_file_name, imported_at
      FROM imports
      WHERE tenant_id = ? AND deleted_at IS NULL
      ORDER BY imported_at DESC
      LIMIT ?
    `)
    .bind(tenantId, limit)
    .all<Pick<Import, "import_id"|"event_date"|"event_name"|"seller_name"|"total_quantity"|"calculated_total"|"status"|"source_file_name"|"imported_at">>();

  return { ok: true, imports: rows.results };
}

export async function handleDeleteImport(db: D1Database, tenantId: string, payload: Record<string, unknown>) {
  const importId = payload.import_id as string;
  if (!importId) return { ok: false, code: "missing_import_id", message: "取込IDが指定されていません。" };

  const row = await db
    .prepare("SELECT import_id, deleted_at FROM imports WHERE import_id = ? AND tenant_id = ?")
    .bind(importId, tenantId)
    .first<{ import_id: string; deleted_at: string | null }>();

  if (!row) return { ok: false, code: "import_not_found", message: "指定された売上が見つかりません。" };
  if (row.deleted_at) return { ok: true, import_id: importId, deleted: false, already_deleted: true };

  await db
    .prepare("UPDATE imports SET deleted_at = ? WHERE import_id = ? AND tenant_id = ?")
    .bind(new Date().toISOString(), importId, tenantId)
    .run();

  return { ok: true, import_id: importId, deleted: true, already_deleted: false };
}

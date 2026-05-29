import type { D1Database } from "@cloudflare/workers-types";

const MAX_DETAIL_ROWS = 1000;

export async function handleSave(db: D1Database, tenantId: string, payload: Record<string, unknown>) {
  const imp = payload.import as Record<string, unknown>;
  const salesDetails = (payload.sales_details as Record<string, unknown>[]) ?? [];
  const productSummary = (payload.product_summary as Record<string, unknown>[]) ?? [];

  if (salesDetails.length > MAX_DETAIL_ROWS) {
    return { ok: false, code: "payload_too_large", message: `明細は${MAX_DETAIL_ROWS}件以内にしてください。` };
  }

  if (!imp?.import_id || !imp?.csv_hash) {
    return { ok: false, code: "invalid_payload", message: "import_id または csv_hash が不足しています。" };
  }

  // 重複チェック
  const existing = await db
    .prepare("SELECT import_id FROM imports WHERE tenant_id = ? AND csv_hash = ? AND deleted_at IS NULL")
    .bind(tenantId, imp.csv_hash)
    .first<{ import_id: string }>();

  if (existing) {
    return { ok: false, code: "duplicate_csv_hash", message: "同じCSVの取込ログがすでに存在します。", existing_import_id: existing.import_id };
  }

  // imports 挿入
  await db.prepare(`
    INSERT INTO imports
      (import_id, tenant_id, event_name, event_date, seller_name, source_file_name,
       imported_at, transaction_count, product_count, total_quantity,
       csv_total, calculated_total, difference, status, csv_hash, warning_message)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    imp.import_id, tenantId, imp.event_name, imp.event_date, imp.seller_name,
    imp.source_file_name ?? null, imp.imported_at,
    imp.transaction_count ?? 0, imp.product_count ?? 0, imp.total_quantity ?? 0,
    imp.csv_total ?? 0, imp.calculated_total ?? 0, imp.difference ?? 0,
    imp.status ?? "ok", imp.csv_hash, imp.warning_message ?? null,
  ).run();

  // sales_details 一括挿入
  if (salesDetails.length > 0) {
    const CHUNK = 50;
    for (let i = 0; i < salesDetails.length; i += CHUNK) {
      const chunk = salesDetails.slice(i, i + CHUNK);
      const stmts = chunk.map(d =>
        db.prepare(`
          INSERT INTO sales_details
            (import_id, tenant_id, event_name, event_date, seller_name,
             receipt_no, sold_at, product_key, product_name, quantity, unit_price, amount, source_file_name)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          imp.import_id as string, tenantId, d.event_name ?? null, d.event_date ?? null, d.seller_name ?? null,
          d.receipt_no ?? null, d.sold_at ?? null, d.product_key ?? null, d.product_name ?? null,
          d.quantity ?? 0, d.unit_price ?? 0, d.amount ?? 0, d.source_file_name ?? null,
        )
      );
      await db.batch(stmts);
    }
  }

  // product_summary 一括挿入
  if (productSummary.length > 0) {
    const stmts = productSummary.map(p =>
      db.prepare(`
        INSERT INTO product_summary
          (import_id, tenant_id, event_name, event_date, seller_name,
           product_key, product_name, total_quantity, unit_price, total_amount, remaining_quantity, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        imp.import_id as string, tenantId, p.event_name ?? null, p.event_date ?? null, p.seller_name ?? null,
        p.product_key ?? null, p.product_name ?? null,
        p.total_quantity ?? 0, p.unit_price ?? 0, p.total_amount ?? 0,
        p.remaining_quantity ?? null, p.status ?? null,
      )
    );
    await db.batch(stmts);
  }

  return { ok: true, import_id: imp.import_id, detail_count: salesDetails.length, product_count: productSummary.length };
}

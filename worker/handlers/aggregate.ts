import type { D1Database } from "@cloudflare/workers-types";

/** 全イベントにまたがる商品別累計 + イベント別売上一覧 */
export async function handleAggregate(db: D1Database, tenantId: string) {
  const [productRows, eventRows] = await Promise.all([
    // 商品別累計（削除済みイベントを除く）
    db.prepare(`
      SELECT
        ps.product_name,
        SUM(ps.total_quantity)  AS total_quantity,
        SUM(ps.total_amount)    AS total_amount,
        MAX(ps.unit_price)      AS unit_price,
        COUNT(DISTINCT ps.import_id) AS event_count,
        MIN(ps.event_date)      AS first_date,
        MAX(ps.event_date)      AS last_date
      FROM product_summary ps
      INNER JOIN imports i ON i.import_id = ps.import_id AND i.deleted_at IS NULL
      WHERE ps.tenant_id = ?
      GROUP BY ps.product_name
      ORDER BY total_amount DESC
    `).bind(tenantId).all(),

    // イベント別売上一覧（削除済み除く）
    db.prepare(`
      SELECT
        import_id, event_date, event_name, seller_name,
        transaction_count, total_quantity, calculated_total, status
      FROM imports
      WHERE tenant_id = ? AND deleted_at IS NULL
      ORDER BY event_date DESC, imported_at DESC
    `).bind(tenantId).all(),
  ]);

  return {
    ok: true,
    products: productRows.results,
    events: eventRows.results,
  };
}

/** 特定イベントの詳細（PDF出力用） */
export async function handleGetImportDetail(db: D1Database, tenantId: string, importId: string) {
  const [imp, products] = await Promise.all([
    db.prepare("SELECT * FROM imports WHERE import_id = ? AND tenant_id = ?")
      .bind(importId, tenantId).first(),
    db.prepare("SELECT * FROM product_summary WHERE import_id = ? AND tenant_id = ?")
      .bind(importId, tenantId).all(),
  ]);

  if (!imp) return { ok: false, code: "import_not_found", message: "指定された売上が見つかりません。" };

  return { ok: true, import: imp, products: products.results };
}

import type { Env } from "../types.js";

export async function handleServerPdf(env: Env, tenantId: string, importId: string): Promise<Response> {
  if (!importId) {
    return new Response(JSON.stringify({ ok: false, code: "missing_import_id", message: "import_idが必要です。" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

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
    const filename = `売上控え_${eventDate}_${eventName}.pdf`;
    const encoded = encodeURIComponent(filename);

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

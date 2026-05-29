/** GASのbuildSalesSummaryHtml_をブラウザ側に移植 */
export function buildPdfHtml({ importRecord, products, createdAt = new Date() }) {
  const productRows = products.map(p => `
    <tr>
      <td>${esc(p.product_name)}</td>
      <td class="number">${fmt(p.total_quantity)}</td>
      <td class="number">${yen(p.total_amount)}</td>
      <td class="number">${yen(p.unit_price)}</td>
      <td class="number">${fmt(p.remaining_quantity)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
body{font-family:'Noto Sans JP','Helvetica Neue',Arial,sans-serif;color:#1f2823;margin:28px;font-size:12px;line-height:1.6;}
h1{font-size:24px;margin:0 0 16px;}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #d8e1dc;padding-bottom:4px;}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;margin-bottom:8px;}
.item{display:flex;gap:8px;}.label{color:#607069;min-width:96px;font-weight:700;}
.summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:10px 0 4px;}
.box{border:1px solid #d8e1dc;border-radius:6px;padding:8px;}
.box .value{font-size:16px;font-weight:700;}
.box.primary{background:#f2f6f4;border-color:#b9cec4;}.box.primary .value{font-size:20px;}
.summary-note{margin:6px 0 0;color:#607069;font-size:10px;}
table{width:100%;border-collapse:collapse;margin-top:8px;}thead{display:table-header-group;}
tr{page-break-inside:avoid;}th,td{border:1px solid #d8e1dc;padding:6px 7px;text-align:left;}
th{background:#f2f6f4;font-weight:700;}.number{text-align:right;white-space:nowrap;}
.note{margin-top:20px;padding:10px 12px;background:#f7faf8;border:1px solid #d8e1dc;border-radius:6px;}
.tech{margin-top:18px;font-size:10px;color:#607069;}
@media print{body{margin:0;}}
</style>
</head>
<body>
<h1>イベント売上控え</h1>
<h2>イベント情報</h2>
<div class="meta">
  ${item("イベント名", importRecord.event_name)}
  ${item("イベント日", importRecord.event_date)}
  ${item("出店者名", importRecord.seller_name)}
</div>
<h2>売上サマリー</h2>
<div class="summary">
  ${box("売上合計", yen(importRecord.calculated_total), "primary")}
  ${box("販売点数", fmt(importRecord.total_quantity) + "点", "primary")}
  ${box("会計数", fmt(importRecord.transaction_count) + "件", "primary")}
  ${box("商品数", fmt(importRecord.product_count) + "件")}
  ${box("差額", yen(importRecord.difference))}
  ${box("一致確認", statusLabel(importRecord.status))}
</div>
<p class="summary-note">CSV上の売上合計: ${esc(yen(importRecord.csv_total))} / 計算上の売上合計: ${esc(yen(importRecord.calculated_total))}</p>
<h2>商品別一覧</h2>
<table>
  <thead><tr><th>商品名</th><th>販売点数</th><th>売上金額</th><th>参考単価</th><th>残数</th></tr></thead>
  <tbody>${productRows}</tbody>
</table>
<div class="note">
  <p>この資料は即売レジCSVをもとにした売上集計補助です。</p>
  <p>帳簿付け前の確認資料・売上控えとしてご利用ください。</p>
  <p>税務判断や正式帳簿の作成を行うものではありません。</p>
</div>
<div class="tech">
  <h2>取込情報（確認用）</h2>
  <div class="meta">
    ${item("取込ID", importRecord.import_id)}
    ${item("CSVファイル名", importRecord.source_file_name)}
    ${item("取込日時", importRecord.imported_at)}
    ${item("PDF作成日時", createdAt.toLocaleString("ja-JP"))}
  </div>
</div>
</body>
</html>`;
}

/** ブラウザの印刷ダイアログを開く */
export function printHtml(html) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("ポップアップがブロックされています。ブラウザの設定でこのサイトのポップアップを許可してください。");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.addEventListener("load", () => {
    win.focus();
    try { win.print(); } catch (_) { /* iOS は無視する */ }
  });
}

/**
 * html2pdf.js を使ってPDFをダウンロードする
 * vendor/html2pdf.bundle.min.js が読み込まれている前提（グローバル変数 html2pdf）
 */
export async function downloadPdf(html, filename) {
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;top:-9999px;left:-9999px;width:210mm;pointer-events:none;";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    await html2pdf().set({
      filename,
      margin: 10,
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    }).from(container).save();
  } finally {
    document.body.removeChild(container);
  }
}

function esc(v) { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function yen(v) { return "¥" + Number(v ?? 0).toLocaleString("ja-JP"); }
function fmt(v) { return v == null || v === "" ? "-" : Number(v).toLocaleString("ja-JP"); }
function statusLabel(s) { return s === "ok" ? "一致" : "要確認"; }
function item(label, val) { return `<div class="item"><span class="label">${esc(label)}</span><span>${esc(val ?? "-")}</span></div>`; }
function box(label, val, cls = "") { return `<div class="box${cls ? " " + cls : ""}"><div class="label">${esc(label)}</div><div class="value">${esc(val)}</div></div>`; }

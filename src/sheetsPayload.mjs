export function buildSheetsPayload({ parsed, meta, sourceFileName, csvHash, importId, importedAt, token = "" }) {
  const status = parsed.checks.every((check) => check.status === "ok") ? "ok" : "warning";
  const warningMessage = parsed.checks
    .filter((check) => check.status !== "ok")
    .map((check) => `${check.label}: ${check.status}`)
    .join(" / ");
  const calculatedTotal = parsed.totals.calculatedAmount;
  const csvTotal = parsed.totals.csvTotalAmount ?? 0;

  return {
    token,
    import: {
      import_id: importId,
      event_name: meta.eventName,
      event_date: meta.eventDate,
      seller_name: meta.sellerName,
      source_file_name: sourceFileName,
      imported_at: importedAt,
      transaction_count: parsed.totals.transactionCount,
      product_count: parsed.productColumns.length,
      total_quantity: parsed.totals.calculatedQuantity,
      csv_total: csvTotal,
      calculated_total: calculatedTotal,
      difference: calculatedTotal - csvTotal,
      status,
      csv_hash: csvHash,
      warning_message: warningMessage,
    },
    sales_details: buildSalesDetails(parsed, meta, sourceFileName, importId),
    product_summary: buildProductSummary(parsed, meta, importId),
  };
}

export function generateImportId(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `IMP_${stamp}_${random}`;
}

export async function createCsvHash(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("CSVハッシュを生成できないブラウザです。");
  }

  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildSalesDetails(parsed, meta, sourceFileName, importId) {
  const productByKey = new Map(parsed.productSummaries.map((product) => [product.key, product]));

  return parsed.transactions.flatMap((transaction) =>
    transaction.details.map((detail) => {
      const product = productByKey.get(detail.productKey);
      const unitPrice = product?.inferredUnitPrice ?? 0;
      return {
        import_id: importId,
        event_name: meta.eventName,
        event_date: meta.eventDate,
        seller_name: meta.sellerName,
        receipt_no: transaction.no,
        sold_at: transaction.dateTime,
        product_key: detail.productKey,
        product_name: detail.productName,
        quantity: detail.quantity,
        unit_price: unitPrice,
        amount: detail.quantity * unitPrice,
        source_file_name: sourceFileName,
      };
    }),
  );
}

function buildProductSummary(parsed, meta, importId) {
  return parsed.productSummaries.map((product) => ({
    import_id: importId,
    event_name: meta.eventName,
    event_date: meta.eventDate,
    seller_name: meta.sellerName,
    product_key: product.key,
    product_name: product.name,
    total_quantity: product.calculatedQuantity,
    unit_price: product.inferredUnitPrice ?? 0,
    total_amount: product.csvAmount ?? 0,
    remaining_quantity: product.remaining ?? "",
    status: product.quantityMatches === false ? "quantity_mismatch" : "ok",
  }));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

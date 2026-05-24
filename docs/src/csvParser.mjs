const REQUIRED_COLUMNS = {
  no: "No.",
  dateTime: "日時",
  subtotal: "小計",
};

const SUMMARY_LABELS = {
  totalCount: "合計数",
  totalAmount: "合計額",
  remaining: "残数",
};

export function parseCsvText(text) {
  const normalized = text.replace(/^\uFEFF/, "");
  const rows = parseCsvRows(normalized).filter((row) => row.some((cell) => cell.trim() !== ""));

  if (rows.length < 2) {
    throw new Error("CSVにヘッダー行とデータ行が必要です。");
  }

  const header = rows[0].map((cell) => cell.trim());
  const columnMap = findRequiredColumns(header);
  const productColumns = header
    .map((name, index) => ({ name, index, columnNumber: index + 1 }))
    .filter(({ index, name }) => index > columnMap.dateTime && index < columnMap.subtotal && name !== "")
    .map((product) => ({
      ...product,
      key: makeProductKey(product.columnNumber, product.name),
    }));

  if (productColumns.length === 0) {
    throw new Error("日時列と小計列の間に商品列が見つかりません。");
  }

  const summaryRows = collectSummaryRows(rows.slice(1), columnMap.no);
  const salesRows = rows.slice(1).filter((row) => {
    const label = normalizeCell(row[columnMap.no]);
    return !Object.values(SUMMARY_LABELS).includes(label) && row.some((cell) => normalizeCell(cell) !== "");
  });

  const transactions = salesRows.map((row, index) => buildTransaction(row, index, columnMap, productColumns));
  const productSummaries = buildProductSummaries(productColumns, transactions, summaryRows);
  const checks = buildChecks(transactions, productSummaries, summaryRows);

  return {
    header,
    productColumns,
    transactions,
    productSummaries,
    checks,
    totals: {
      transactionCount: transactions.length,
      detailCount: transactions.reduce((sum, transaction) => sum + transaction.details.length, 0),
      calculatedQuantity: productSummaries.reduce((sum, product) => sum + product.calculatedQuantity, 0),
      calculatedAmount: transactions.reduce((sum, transaction) => sum + transaction.subtotal, 0),
      csvTotalQuantity: sumNullable(productSummaries.map((product) => product.csvQuantity)),
      csvTotalAmount: sumNullable(productSummaries.map((product) => product.csvAmount)),
    },
  };
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function findRequiredColumns(header) {
  const no = header.indexOf(REQUIRED_COLUMNS.no);
  const dateTime = header.indexOf(REQUIRED_COLUMNS.dateTime);
  const subtotal = header.indexOf(REQUIRED_COLUMNS.subtotal);

  if (no === -1 || dateTime === -1 || subtotal === -1) {
    throw new Error("必須列（No.、日時、小計）が見つかりません。");
  }

  if (!(no < dateTime && dateTime < subtotal)) {
    throw new Error("列順は No.、日時、商品列、小計 の順である必要があります。");
  }

  return { no, dateTime, subtotal };
}

function collectSummaryRows(rows, labelIndex) {
  const result = {
    totalCount: null,
    totalAmount: null,
    remaining: null,
  };

  for (const row of rows) {
    const label = normalizeCell(row[labelIndex]);
    if (label === SUMMARY_LABELS.totalCount) result.totalCount = row;
    if (label === SUMMARY_LABELS.totalAmount) result.totalAmount = row;
    if (label === SUMMARY_LABELS.remaining) result.remaining = row;
  }

  return result;
}

function buildTransaction(row, fallbackIndex, columnMap, productColumns) {
  const details = productColumns
    .map((product) => {
      const quantity = parseNumber(row[product.index]);
      return {
        productKey: product.key,
        productName: product.name,
        columnNumber: product.columnNumber,
        quantity,
      };
    })
    .filter((detail) => detail.quantity !== 0);

  return {
    no: normalizeCell(row[columnMap.no]) || String(fallbackIndex + 1),
    dateTime: normalizeCell(row[columnMap.dateTime]),
    subtotal: parseNumber(row[columnMap.subtotal]),
    totalQuantity: details.reduce((sum, detail) => sum + detail.quantity, 0),
    details,
  };
}

function buildProductSummaries(productColumns, transactions, summaryRows) {
  return productColumns.map((product) => {
    const calculatedQuantity = transactions.reduce((sum, transaction) => {
      const detail = transaction.details.find((item) => item.productKey === product.key);
      return sum + (detail?.quantity ?? 0);
    }, 0);
    const csvQuantity = parseOptionalNumber(summaryRows.totalCount?.[product.index]);
    const csvAmount = parseOptionalNumber(summaryRows.totalAmount?.[product.index]);
    const remaining = parseOptionalNumber(summaryRows.remaining?.[product.index]);
    const inferredUnitPrice = csvAmount !== null && calculatedQuantity !== 0 ? csvAmount / calculatedQuantity : null;

    return {
      ...product,
      calculatedQuantity,
      csvQuantity,
      csvAmount,
      remaining,
      inferredUnitPrice,
      quantityMatches: csvQuantity === null ? null : calculatedQuantity === csvQuantity,
    };
  });
}

function buildChecks(transactions, productSummaries, summaryRows) {
  const calculatedTotalQuantity = productSummaries.reduce((sum, product) => sum + product.calculatedQuantity, 0);
  const csvTotalQuantity = sumNullable(productSummaries.map((product) => product.csvQuantity));
  const calculatedTotalAmount = transactions.reduce((sum, transaction) => sum + transaction.subtotal, 0);
  const csvTotalAmount = sumNullable(productSummaries.map((product) => product.csvAmount));
  const subtotalFromSummaryCell = parseOptionalNumber(summaryRows.totalAmount?.at(-1));

  return [
    {
      label: "商品別合計数",
      calculated: calculatedTotalQuantity,
      csv: csvTotalQuantity,
      status: csvTotalQuantity === null ? "warn" : calculatedTotalQuantity === csvTotalQuantity ? "ok" : "error",
    },
    {
      label: "商品別合計額",
      calculated: calculatedTotalAmount,
      csv: csvTotalAmount,
      status: csvTotalAmount === null ? "warn" : calculatedTotalAmount === csvTotalAmount ? "ok" : "error",
    },
    {
      label: "会計小計の合計",
      calculated: calculatedTotalAmount,
      csv: subtotalFromSummaryCell,
      status: subtotalFromSummaryCell === null ? "warn" : calculatedTotalAmount === subtotalFromSummaryCell ? "ok" : "error",
    },
  ];
}

function makeProductKey(columnNumber, name) {
  return `col${columnNumber}_${name}`;
}

function parseNumber(value) {
  const normalized = normalizeCell(value).replace(/[￥¥,\s]/g, "");
  if (normalized === "") return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value) {
  const normalized = normalizeCell(value).replace(/[￥¥,\s]/g, "");
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCell(value) {
  return String(value ?? "").trim();
}

function sumNullable(values) {
  const presentValues = values.filter((value) => value !== null);
  if (presentValues.length === 0) return null;
  return presentValues.reduce((sum, value) => sum + value, 0);
}

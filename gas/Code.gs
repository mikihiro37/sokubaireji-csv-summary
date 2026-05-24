var SPREADSHEET_ID_PROPERTY_KEY = "SPREADSHEET_ID";
var SAVE_TOKEN_PROPERTY_KEY = "SAVE_TOKEN";
var PDF_FOLDER_ID_PROPERTY_KEY = "PDF_FOLDER_ID";

var SHEETS = {
  imports: {
    name: "imports",
    headers: [
      "import_id",
      "event_name",
      "event_date",
      "seller_name",
      "source_file_name",
      "imported_at",
      "transaction_count",
      "product_count",
      "total_quantity",
      "csv_total",
      "calculated_total",
      "difference",
      "status",
      "csv_hash",
      "warning_message",
    ],
  },
  sales_details: {
    name: "sales_details",
    headers: [
      "import_id",
      "event_name",
      "event_date",
      "seller_name",
      "receipt_no",
      "sold_at",
      "product_key",
      "product_name",
      "quantity",
      "unit_price",
      "amount",
      "source_file_name",
    ],
  },
  product_summary: {
    name: "product_summary",
    headers: [
      "import_id",
      "event_name",
      "event_date",
      "seller_name",
      "product_key",
      "product_name",
      "total_quantity",
      "unit_price",
      "total_amount",
      "remaining_quantity",
      "status",
    ],
  },
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || "save";
    validateToken(payload.token);

    if (action === "save") {
      return jsonResponse(handleSave_(payload));
    }
    if (action === "create_pdf") {
      return jsonResponse(handleCreatePdf_(payload));
    }
    if (action === "list_imports") {
      return jsonResponse(handleListImports_(payload));
    }

    throwAppError("unknown_action", "未対応の処理です。");
  } catch (error) {
    return jsonResponse({
      ok: false,
      code: error.code || "save_failed",
      message: error.message,
    });
  } finally {
    lock.releaseLock();
  }
}

function handleSave_(payload) {
  validatePayload(payload);

  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  var importsSheet = setupSheet(spreadsheet, SHEETS.imports);
  var detailsSheet = setupSheet(spreadsheet, SHEETS.sales_details);
  var summarySheet = setupSheet(spreadsheet, SHEETS.product_summary);

  var existingImportId = findImportIdByCsvHash_(importsSheet, payload.import.csv_hash);
  if (existingImportId) {
    return {
      ok: false,
      code: "duplicate_csv_hash",
      message: "同じCSVハッシュの取込ログがすでに存在します。",
      existing_import_id: existingImportId,
    };
  }

  appendObjects(importsSheet, SHEETS.imports.headers, [payload.import]);
  appendObjects(detailsSheet, SHEETS.sales_details.headers, payload.sales_details);
  appendObjects(summarySheet, SHEETS.product_summary.headers, payload.product_summary);

  return {
    ok: true,
    import_id: payload.import.import_id,
    detail_count: payload.sales_details.length,
    product_count: payload.product_summary.length,
  };
}

function handleCreatePdf_(payload) {
  Logger.log("[PDF] handleCreatePdf_ start import_id: " + (payload && payload.import_id ? payload.import_id : "未指定"));
  if (!payload.import_id) {
    throwAppError("missing_import_id", "取込IDが指定されていません。");
  }

  var result = createSalesSummaryPdf(payload.import_id);
  Logger.log("[PDF] handleCreatePdf_ success import_id: " + payload.import_id + ", fileId: " + result.fileId);
  return {
    ok: true,
    import_id: payload.import_id,
    pdf_file_id: result.fileId,
    pdf_url: result.url,
    filename: result.filename,
    message: "PDFを作成しました。",
  };
}

function handleListImports_(payload) {
  var limit = Number(payload.limit || 20);
  if (isNaN(limit) || limit < 1) limit = 20;
  limit = Math.min(limit, 50);

  try {
    var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
    var sheet = spreadsheet.getSheetByName(SHEETS.imports.name);
    if (!sheet) {
      throwAppError("imports_not_found", "保存済みデータが見つかりません。");
    }

    var rows = objectsFromSheet_(sheet);
    rows.sort(function(a, b) {
      return getTimeValue_(b.imported_at) - getTimeValue_(a.imported_at);
    });

    return {
      ok: true,
      imports: rows.slice(0, limit).map(function(row) {
        return {
          import_id: row.import_id,
          event_date: formatDate_(row.event_date),
          event_name: row.event_name,
          seller_name: row.seller_name,
          total_quantity: Number(row.total_quantity || 0),
          calculated_total: Number(row.calculated_total || 0),
          status: row.status,
          source_file_name: row.source_file_name,
          imported_at: formatDateTime_(row.imported_at),
        };
      }),
    };
  } catch (error) {
    if (error && error.code) throw error;
    logPdfError_("list_imports_failed", error);
    throwAppError("list_imports_failed", "保存済みデータを読み込めませんでした。");
  }
}

function createSalesSummaryPdf(importId) {
  Logger.log("[PDF] createSalesSummaryPdf start import_id: " + importId);
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  var importRecord = getImportRecord_(spreadsheet, importId);
  Logger.log("[PDF] import record found: " + (importRecord ? "yes" : "no"));
  if (!importRecord) {
    throwAppError("import_not_found", "指定された取込IDの取込ログが見つかりません。");
  }

  var productRows = getProductSummaryRows_(spreadsheet, importId);
  Logger.log("[PDF] product_summary rows: " + productRows.length);
  if (productRows.length === 0) {
    throwAppError("product_summary_not_found", "指定された取込IDの商品別集計が見つかりません。");
  }

  var data = {
    import: importRecord,
    products: productRows,
    createdAt: new Date(),
  };
  var filename = buildPdfFileName_(data);
  Logger.log("[PDF] filename built: " + filename);
  var html = buildSalesSummaryHtml_(data);
  Logger.log("[PDF] HTML generated. length: " + html.length);
  return savePdfToDrive_(html, filename);
}

function setupTest() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  setupSheet(spreadsheet, SHEETS.imports);
  setupSheet(spreadsheet, SHEETS.sales_details);
  setupSheet(spreadsheet, SHEETS.product_summary);
  return true;
}

function formatSheets() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());

  formatSheet_(spreadsheet, SHEETS.imports, "取込ログ用シートです。CSVごとの保存単位を記録します。", {
    widths: {
      import_id: 150,
      event_name: 220,
      event_date: 110,
      seller_name: 180,
      source_file_name: 260,
      imported_at: 150,
      transaction_count: 120,
      product_count: 110,
      total_quantity: 110,
      csv_total: 120,
      calculated_total: 140,
      difference: 120,
      status: 90,
      csv_hash: 150,
      warning_message: 280,
    },
    dateColumns: ["event_date"],
    dateTimeColumns: ["imported_at"],
    currencyColumns: ["csv_total", "calculated_total", "difference"],
    numberColumns: ["transaction_count", "product_count", "total_quantity"],
    centerColumns: ["status"],
    clipColumns: ["csv_hash"],
  });

  formatSheet_(spreadsheet, SHEETS.sales_details, "会計・商品ごとの明細用シートです。取込データの内訳を記録します。", {
    widths: {
      import_id: 150,
      event_name: 220,
      event_date: 110,
      seller_name: 180,
      receipt_no: 100,
      sold_at: 150,
      product_key: 150,
      product_name: 240,
      quantity: 90,
      unit_price: 110,
      amount: 120,
      source_file_name: 260,
    },
    dateColumns: ["event_date"],
    dateTimeColumns: ["sold_at"],
    currencyColumns: ["unit_price", "amount"],
    numberColumns: ["quantity"],
    centerColumns: ["receipt_no"],
    clipColumns: ["product_key"],
  });

  formatSheet_(spreadsheet, SHEETS.product_summary, "商品別集計用シートです。取込ごとの商品別合計を記録します。", {
    widths: {
      import_id: 150,
      event_name: 220,
      event_date: 110,
      seller_name: 180,
      product_key: 150,
      product_name: 240,
      total_quantity: 120,
      unit_price: 110,
      total_amount: 130,
      remaining_quantity: 130,
      status: 90,
    },
    dateColumns: ["event_date"],
    currencyColumns: ["unit_price", "total_amount"],
    numberColumns: ["total_quantity", "remaining_quantity"],
    centerColumns: ["status"],
    clipColumns: ["product_key"],
  });

  return true;
}

function testCreatePdfForImportId() {
  var importId = "ここにテスト用import_idを一時的に入れてください";

  if (!importId || importId === "ここにテスト用import_idを一時的に入れてください") {
    throw new Error("testCreatePdfForImportId内のimport_idを一時的に設定してください。");
  }

  Logger.log("[PDF] testCreatePdfForImportId start import_id: " + importId);
  var result = createSalesSummaryPdf(importId);
  Logger.log("[PDF] testCreatePdfForImportId result: " + JSON.stringify(result, null, 2));
  return result;
}

function setupProperties() {
  var spreadsheetId = "ここに保存先スプレッドシートIDを一時的に入れてください";
  var saveToken = "ここに保存用トークンを一時的に入れてください";
  var pdfFolderId = "";

  if (!spreadsheetId || spreadsheetId === "ここに保存先スプレッドシートIDを一時的に入れてください") {
    throw new Error("setupProperties内の保存先スプレッドシートIDを設定してください。");
  }
  if (!saveToken || saveToken === "ここに保存用トークンを一時的に入れてください") {
    throw new Error("setupProperties内の保存用トークンを設定してください。");
  }

  var properties = {};
  properties[SPREADSHEET_ID_PROPERTY_KEY] = spreadsheetId;
  properties[SAVE_TOKEN_PROPERTY_KEY] = saveToken;
  if (pdfFolderId) {
    properties[PDF_FOLDER_ID_PROPERTY_KEY] = pdfFolderId;
  }
  PropertiesService.getScriptProperties().setProperties(properties);
  return true;
}

function checkProperties() {
  Logger.log("SPREADSHEET_ID: " + (getScriptProperty_(SPREADSHEET_ID_PROPERTY_KEY) ? "設定済み" : "未設定"));
  Logger.log("SAVE_TOKEN: " + (getScriptProperty_(SAVE_TOKEN_PROPERTY_KEY) ? "設定済み" : "未設定"));
  Logger.log("PDF_FOLDER_ID: " + (getScriptProperty_(PDF_FOLDER_ID_PROPERTY_KEY) ? "設定済み" : "未設定"));
}

function validatePayload(payload) {
  if (!payload || !payload.import) {
    throw new Error("取込データが空です。");
  }
  if (!payload.import.import_id || !payload.import.csv_hash) {
    throw new Error("import_id または csv_hash が不足しています。");
  }
  if (!Array.isArray(payload.sales_details) || !Array.isArray(payload.product_summary)) {
    throw new Error("保存対象の明細または商品別集計が不正です。");
  }
}

function validateToken(token) {
  var expectedToken = getSaveToken_();
  if (!token || token !== expectedToken) {
    throwTokenError("保存用トークンが一致しません。");
  }
}

function getScriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getSpreadsheetId_() {
  var spreadsheetId = getScriptProperty_(SPREADSHEET_ID_PROPERTY_KEY);
  if (!spreadsheetId) {
    throwAppError("missing_spreadsheet_id", "保存先スプレッドシートIDが設定されていません。");
  }
  return spreadsheetId;
}

function getSaveToken_() {
  var saveToken = getScriptProperty_(SAVE_TOKEN_PROPERTY_KEY);
  if (!saveToken) {
    throwAppError("missing_save_token", "保存用トークンが設定されていません。");
  }
  return saveToken;
}

function getPdfFolderId_() {
  return getScriptProperty_(PDF_FOLDER_ID_PROPERTY_KEY) || "";
}

function getPdfFolder_() {
  var folderId = getPdfFolderId_();
  Logger.log("[PDF] PDF_FOLDER_ID configured: " + (folderId ? "yes" : "no"));
  if (!folderId) {
    Logger.log("[PDF] Drive destination: マイドライブ直下");
    return null;
  }

  try {
    Logger.log("[PDF] Drive destination: 指定フォルダ");
    var folder = DriveApp.getFolderById(folderId);
    Logger.log("[PDF] PDF folder resolved.");
    return folder;
  } catch (error) {
    logPdfError_("pdf_folder_not_found", error);
    throwAppError("pdf_folder_not_found", "PDF保存先フォルダが見つかりません。");
  }
}

function throwTokenError(message) {
  throwAppError("invalid_token", message);
}

function throwAppError(code, message) {
  var error = new Error(message);
  error.code = code;
  throw error;
}

function setupSheet(spreadsheet, sheetConfig) {
  var sheet = spreadsheet.getSheetByName(sheetConfig.name) || spreadsheet.insertSheet(sheetConfig.name);
  var headerRange = sheet.getRange(1, 1, 1, sheetConfig.headers.length);
  var currentHeaders = headerRange.getValues()[0];
  var needsHeader = currentHeaders.every(function(cell) {
    return cell === "";
  });

  if (needsHeader) {
    headerRange.setValues([sheetConfig.headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function formatSheet_(spreadsheet, sheetConfig, roleMemo, formatConfig) {
  var sheet = setupSheet(spreadsheet, sheetConfig);
  var headers = sheetConfig.headers;
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var dataRowCount = Math.max(sheet.getMaxRows() - 1, 1);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);

  sheet.setFrozenRows(1);
  headerRange
    .setFontWeight("bold")
    .setBackground("#e8f1ed")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  headerRange.setNotes([headers.map(function() {
    return roleMemo + "\nシート名、1行目の列名、列順は変更しないでください。";
  })]);

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, lastRow, headers.length).createFilter();
  }

  sheet.autoResizeColumns(1, headers.length);
  applyColumnWidths_(sheet, headers, formatConfig.widths || {});
  applyColumnFormats_(sheet, headers, dataRowCount, formatConfig);
}

function applyColumnWidths_(sheet, headers, widths) {
  headers.forEach(function(header, index) {
    var width = widths[header];
    if (width) {
      sheet.setColumnWidth(index + 1, width);
    }
  });
}

function applyColumnFormats_(sheet, headers, dataRowCount, formatConfig) {
  applyFormatToColumns_(sheet, headers, dataRowCount, formatConfig.dateColumns || [], "yyyy-mm-dd");
  applyFormatToColumns_(sheet, headers, dataRowCount, formatConfig.dateTimeColumns || [], "yyyy-mm-dd hh:mm");
  applyFormatToColumns_(sheet, headers, dataRowCount, formatConfig.currencyColumns || [], "¥#,##0");
  applyFormatToColumns_(sheet, headers, dataRowCount, formatConfig.numberColumns || [], "#,##0");
  applyAlignmentToColumns_(sheet, headers, dataRowCount, formatConfig.centerColumns || [], "center");
  applyWrapStrategyToColumns_(sheet, headers, dataRowCount, formatConfig.clipColumns || [], SpreadsheetApp.WrapStrategy.CLIP);
}

function applyFormatToColumns_(sheet, headers, dataRowCount, targetHeaders, numberFormat) {
  targetHeaders.forEach(function(header) {
    var column = headers.indexOf(header) + 1;
    if (column > 0) {
      sheet.getRange(2, column, dataRowCount, 1).setNumberFormat(numberFormat);
    }
  });
}

function applyAlignmentToColumns_(sheet, headers, dataRowCount, targetHeaders, alignment) {
  targetHeaders.forEach(function(header) {
    var column = headers.indexOf(header) + 1;
    if (column > 0) {
      sheet.getRange(2, column, dataRowCount, 1).setHorizontalAlignment(alignment);
    }
  });
}

function applyWrapStrategyToColumns_(sheet, headers, dataRowCount, targetHeaders, strategy) {
  targetHeaders.forEach(function(header) {
    var column = headers.indexOf(header) + 1;
    if (column > 0) {
      sheet.getRange(2, column, dataRowCount, 1).setWrapStrategy(strategy);
    }
  });
}

function appendObjects(sheet, headers, rows) {
  if (rows.length === 0) return;

  var values = rows.map(function(row) {
    return headers.map(function(header) {
      return row[header] == null ? "" : row[header];
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function findImportIdByCsvHash_(sheet, csvHash) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return "";

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var hashColumn = headers.indexOf("csv_hash") + 1;
  var importIdColumn = headers.indexOf("import_id") + 1;
  if (hashColumn === 0 || importIdColumn === 0) return "";

  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i += 1) {
    if (values[i][hashColumn - 1] === csvHash) {
      return values[i][importIdColumn - 1] || "";
    }
  }
  return "";
}

function getImportRecord_(spreadsheet, importId) {
  Logger.log("[PDF] getImportRecord_ start import_id: " + importId);
  var sheet = spreadsheet.getSheetByName(SHEETS.imports.name);
  if (!sheet) {
    Logger.log("[PDF] imports sheet found: no");
    return null;
  }

  var rows = objectsFromSheet_(sheet);
  Logger.log("[PDF] imports rows loaded: " + rows.length);
  for (var i = 0; i < rows.length; i += 1) {
    if (rows[i].import_id === importId) {
      Logger.log("[PDF] getImportRecord_ matched: yes");
      return rows[i];
    }
  }
  Logger.log("[PDF] getImportRecord_ matched: no");
  return null;
}

function getProductSummaryRows_(spreadsheet, importId) {
  Logger.log("[PDF] getProductSummaryRows_ start import_id: " + importId);
  var sheet = spreadsheet.getSheetByName(SHEETS.product_summary.name);
  if (!sheet) {
    Logger.log("[PDF] product_summary sheet found: no");
    return [];
  }

  var rows = objectsFromSheet_(sheet);
  Logger.log("[PDF] product_summary rows loaded: " + rows.length);
  var matchedRows = rows.filter(function(row) {
    return row.import_id === importId;
  });
  Logger.log("[PDF] product_summary matched rows: " + matchedRows.length);
  return matchedRows;
}

function objectsFromSheet_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = values[0];
  var rows = [];

  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    var row = {};
    for (var columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      row[headers[columnIndex]] = values[rowIndex][columnIndex];
    }
    rows.push(row);
  }

  return rows;
}

function buildSalesSummaryHtml_(data) {
  var importRecord = data.import;
  var products = data.products;
  Logger.log("[PDF] buildSalesSummaryHtml_ start import_id: " + importRecord.import_id + ", product rows: " + products.length);
  var productRows = products.map(function(product) {
    return [
      "<tr>",
      "<td>", escapeHtml_(product.product_name), "</td>",
      "<td class=\"number\">", formatNumber_(product.total_quantity), "</td>",
      "<td class=\"number\">", formatYen_(product.total_amount), "</td>",
      "<td class=\"number\">", formatYen_(product.unit_price), "</td>",
      "<td class=\"number\">", formatNumber_(product.remaining_quantity), "</td>",
      "</tr>",
    ].join("");
  }).join("");

  return [
    "<!doctype html>",
    "<html lang=\"ja\">",
    "<head>",
    "<meta charset=\"UTF-8\">",
    "<style>",
    "body{font-family:'Noto Sans JP','Helvetica Neue',Arial,sans-serif;color:#1f2823;margin:28px;font-size:12px;line-height:1.6;}",
    "h1{font-size:24px;margin:0 0 16px;}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #d8e1dc;padding-bottom:4px;}",
    ".meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;margin-bottom:8px;}.item{display:flex;gap:8px;}.label{color:#607069;min-width:96px;font-weight:700;}",
    ".summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:10px 0 4px;}.box{border:1px solid #d8e1dc;border-radius:6px;padding:8px;}.box .value{font-size:16px;font-weight:700;}.box.primary{background:#f2f6f4;border-color:#b9cec4;}.box.primary .value{font-size:20px;}",
    ".summary-note{margin:6px 0 0;color:#607069;font-size:10px;}",
    "table{width:100%;border-collapse:collapse;margin-top:8px;}thead{display:table-header-group;}tr{page-break-inside:avoid;}th,td{border:1px solid #d8e1dc;padding:6px 7px;text-align:left;}th{background:#f2f6f4;font-weight:700;}.number{text-align:right;white-space:nowrap;}",
    ".note{margin-top:20px;padding:10px 12px;background:#f7faf8;border:1px solid #d8e1dc;border-radius:6px;color:#33413b;}",
    ".technical-info{margin-top:18px;font-size:10px;color:#607069;}.technical-info h2{font-size:12px;color:#607069;border-bottom:1px solid #e3ebe7;}.technical-info .label{color:#607069;}",
    "</style>",
    "</head>",
    "<body>",
    "<h1>イベント売上控え</h1>",
    "<h2>イベント情報</h2>",
    "<div class=\"meta\">",
    renderHtmlItem_("イベント名", importRecord.event_name),
    renderHtmlItem_("イベント日", formatDate_(importRecord.event_date)),
    renderHtmlItem_("出店者名", importRecord.seller_name),
    "</div>",
    "<h2>売上サマリー</h2>",
    "<div class=\"summary\">",
    renderSummaryBox_("売上合計", formatYen_(importRecord.calculated_total), "primary"),
    renderSummaryBox_("販売点数", formatNumber_(importRecord.total_quantity) + "点", "primary"),
    renderSummaryBox_("会計数", formatNumber_(importRecord.transaction_count) + "件", "primary"),
    renderSummaryBox_("商品数", formatNumber_(importRecord.product_count) + "件"),
    renderSummaryBox_("差額", formatYen_(importRecord.difference)),
    renderSummaryBox_("一致確認", formatStatusLabel_(importRecord.status)),
    "</div>",
    "<p class=\"summary-note\">CSV上の売上合計: ", escapeHtml_(formatYen_(importRecord.csv_total)), " / 計算上の売上合計: ", escapeHtml_(formatYen_(importRecord.calculated_total)), "</p>",
    "<h2>商品別一覧</h2>",
    "<table>",
    "<thead><tr><th>商品名</th><th>販売点数</th><th>売上金額</th><th>参考単価</th><th>残数</th></tr></thead>",
    "<tbody>", productRows, "</tbody>",
    "</table>",
    "<div class=\"note\">",
    "<p>この資料は即売レジCSVをもとにした売上集計補助です。</p>",
    "<p>帳簿付け前の確認資料・売上控えとしてご利用ください。</p>",
    "<p>税務判断や正式帳簿の作成を行うものではありません。</p>",
    "</div>",
    "<div class=\"technical-info\">",
    "<h2>取込情報（確認用）</h2>",
    "<div class=\"meta\">",
    renderHtmlItem_("取込ID", importRecord.import_id),
    renderHtmlItem_("CSVファイル名", importRecord.source_file_name),
    renderHtmlItem_("取込日時", formatDateTime_(importRecord.imported_at)),
    renderHtmlItem_("PDF作成日時", formatDateTime_(data.createdAt)),
    "</div>",
    "</div>",
    "</body>",
    "</html>",
  ].join("");
}

function renderHtmlItem_(label, value) {
  return [
    "<div class=\"item\"><span class=\"label\">",
    escapeHtml_(label),
    "</span><span>",
    escapeHtml_(value || "-"),
    "</span></div>",
  ].join("");
}

function renderSummaryBox_(label, value, className) {
  var classes = ["box"];
  if (className) classes.push(className);
  return [
    "<div class=\"", classes.join(" "), "\"><div class=\"label\">",
    escapeHtml_(label),
    "</div><div class=\"value\">",
    escapeHtml_(value || "-"),
    "</div></div>",
  ].join("");
}

function formatStatusLabel_(status) {
  if (status === "ok") return "一致";
  if (status === "warning") return "要確認";
  if (status === "error") return "要確認";
  return status || "-";
}

function savePdfToDrive_(html, filename) {
  Logger.log("[PDF] savePdfToDrive_ start filename: " + filename + ", html length: " + html.length);
  var blob;
  try {
    blob = HtmlService
      .createHtmlOutput(html)
      .getBlob()
      .getAs(MimeType.PDF)
      .setName(filename);
    Logger.log("[PDF] PDF blob generated. bytes: " + blob.getBytes().length);
  } catch (error) {
    logPdfError_("pdf_creation_failed", error);
    throwAppError("pdf_creation_failed", "PDFの作成に失敗しました。");
  }

  var folder = getPdfFolder_();
  try {
    Logger.log("[PDF] Drive save starting. destination: " + (folder ? "指定フォルダ" : "マイドライブ直下"));
    var file = folder ? folder.createFile(blob) : DriveApp.createFile(blob);
    Logger.log("[PDF] Drive save completed. fileId: " + file.getId());
    return {
      fileId: file.getId(),
      url: file.getUrl(),
      filename: filename,
    };
  } catch (error) {
    logPdfError_("drive_save_failed", error);
    throwAppError("drive_save_failed", "PDFのDrive保存に失敗しました。");
  }
}

function logPdfError_(label, error) {
  Logger.log("[PDF] " + label + ": " + (error && error.message ? error.message : error));
  if (error && error.stack) {
    Logger.log("[PDF] stack: " + error.stack);
  }
}

function buildPdfFileName_(data) {
  var importRecord = data.import;
  var parts = [
    "イベント売上控え",
    formatDate_(importRecord.event_date),
    importRecord.event_name,
    importRecord.seller_name,
    importRecord.import_id,
  ];
  return sanitizeFileName_(parts.filter(function(part) {
    return part != null && part !== "";
  }).join("_")) + ".pdf";
}

function sanitizeFileName_(name) {
  return String(name)
    .replace(/[\\/:*?"<>|#%{}~&]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function formatYen_(value) {
  var numberValue = Number(value || 0);
  return "¥" + formatNumber_(numberValue);
}

function formatNumber_(value) {
  if (value === "" || value == null) return "-";
  var numberValue = Number(value);
  if (isNaN(numberValue)) return String(value);
  return numberValue.toLocaleString("ja-JP");
}

function formatDate_(value) {
  if (!value) return "-";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value);
}

function formatDateTime_(value) {
  if (!value) return "-";
  var dateValue = Object.prototype.toString.call(value) === "[object Date]" ? value : new Date(value);
  if (isNaN(dateValue.getTime())) return String(value);
  return Utilities.formatDate(dateValue, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function getTimeValue_(value) {
  if (!value) return 0;
  var dateValue = Object.prototype.toString.call(value) === "[object Date]" ? value : new Date(value);
  if (isNaN(dateValue.getTime())) return 0;
  return dateValue.getTime();
}

function escapeHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

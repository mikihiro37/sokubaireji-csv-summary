var SPREADSHEET_ID_PROPERTY_KEY = "SPREADSHEET_ID";
var SAVE_TOKEN_PROPERTY_KEY = "SAVE_TOKEN";

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
    validatePayload(payload);
    validateToken(payload.token);

    var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
    var importsSheet = setupSheet(spreadsheet, SHEETS.imports);
    var detailsSheet = setupSheet(spreadsheet, SHEETS.sales_details);
    var summarySheet = setupSheet(spreadsheet, SHEETS.product_summary);

    if (hasDuplicateHash(importsSheet, payload.import.csv_hash)) {
      return jsonResponse({
        ok: false,
        code: "duplicate_csv_hash",
        message: "同じCSVハッシュの取込ログがすでに存在します。",
      });
    }

    appendObjects(importsSheet, SHEETS.imports.headers, [payload.import]);
    appendObjects(detailsSheet, SHEETS.sales_details.headers, payload.sales_details);
    appendObjects(summarySheet, SHEETS.product_summary.headers, payload.product_summary);

    return jsonResponse({
      ok: true,
      import_id: payload.import.import_id,
      detail_count: payload.sales_details.length,
      product_count: payload.product_summary.length,
    });
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

function setupTest() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  setupSheet(spreadsheet, SHEETS.imports);
  setupSheet(spreadsheet, SHEETS.sales_details);
  setupSheet(spreadsheet, SHEETS.product_summary);
  return true;
}

function setupProperties() {
  var spreadsheetId = "ここに保存先スプレッドシートIDを一時的に入れてください";
  var saveToken = "ここに保存用トークンを一時的に入れてください";

  if (!spreadsheetId || spreadsheetId === "ここに保存先スプレッドシートIDを一時的に入れてください") {
    throw new Error("setupProperties内の保存先スプレッドシートIDを設定してください。");
  }
  if (!saveToken || saveToken === "ここに保存用トークンを一時的に入れてください") {
    throw new Error("setupProperties内の保存用トークンを設定してください。");
  }

  var properties = {};
  properties[SPREADSHEET_ID_PROPERTY_KEY] = spreadsheetId;
  properties[SAVE_TOKEN_PROPERTY_KEY] = saveToken;
  PropertiesService.getScriptProperties().setProperties(properties);
  return true;
}

function checkProperties() {
  Logger.log("SPREADSHEET_ID: " + (getScriptProperty_(SPREADSHEET_ID_PROPERTY_KEY) ? "設定済み" : "未設定"));
  Logger.log("SAVE_TOKEN: " + (getScriptProperty_(SAVE_TOKEN_PROPERTY_KEY) ? "設定済み" : "未設定"));
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

function appendObjects(sheet, headers, rows) {
  if (rows.length === 0) return;

  var values = rows.map(function(row) {
    return headers.map(function(header) {
      return row[header] == null ? "" : row[header];
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function hasDuplicateHash(sheet, csvHash) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var hashColumn = headers.indexOf("csv_hash") + 1;
  if (hashColumn === 0) return false;

  var hashValues = sheet.getRange(2, hashColumn, lastRow - 1, 1).getValues();
  for (var i = 0; i < hashValues.length; i += 1) {
    if (hashValues[i][0] === csvHash) return true;
  }
  return false;
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

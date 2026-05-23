import assert from "node:assert/strict";
import { parseCsvRows, parseCsvText } from "../src/csvParser.mjs";
import { buildSheetsPayload } from "../src/sheetsPayload.mjs";

const csv = "\uFEFFNo.,日時,りんご,りんご,小計\n" +
  "1,2026/05/23 10:00,2,1,500\n" +
  "2,2026/05/23 10:05,0,3,900\n" +
  "合計数,,2,4,6\n" +
  "合計額,,200,1200,1400\n" +
  "残数,,8,6,\n";

const parsed = parseCsvText(csv);

assert.equal(parsed.productColumns.length, 2);
assert.equal(parsed.productColumns[0].key, "col3_りんご");
assert.equal(parsed.productColumns[1].key, "col4_りんご");
assert.equal(parsed.transactions.length, 2);
assert.equal(parsed.transactions[0].details.length, 2);
assert.equal(parsed.productSummaries[0].calculatedQuantity, 2);
assert.equal(parsed.productSummaries[1].calculatedQuantity, 4);
assert.equal(parsed.totals.calculatedAmount, 1400);
assert.equal(parsed.checks.find((check) => check.label === "商品別合計数").status, "ok");
assert.equal(parsed.checks.find((check) => check.label === "商品別合計額").status, "ok");
assert.equal(parsed.checks.find((check) => check.label === "会計小計の合計").status, "ok");

const payload = buildSheetsPayload({
  parsed,
  meta: {
    eventName: "テスト即売会",
    eventDate: "2026-05-23",
    sellerName: "テスト出店者",
  },
  sourceFileName: "sample.csv",
  csvHash: "hash",
  importId: "IMP_20260523_120000_TEST",
  importedAt: "2026-05-23T03:00:00.000Z",
  token: "test-token",
});

assert.equal(payload.token, "test-token");
assert.equal(payload.import.import_id, "IMP_20260523_120000_TEST");
assert.equal(payload.import.transaction_count, 2);
assert.equal(payload.import.product_count, 2);
assert.equal(payload.import.csv_total, 1400);
assert.equal(payload.import.calculated_total, 1400);
assert.equal(payload.sales_details.length, 3);
assert.equal(payload.sales_details[0].product_key, "col3_りんご");
assert.equal(payload.sales_details[0].unit_price, 100);
assert.equal(payload.product_summary[1].total_amount, 1200);
assert.equal(payload.product_summary[1].status, "ok");

assert.deepEqual(parseCsvRows("a,\"b,b\",\"c\"\"d\"\n1,2,3"), [
  ["a", "b,b", "c\"d"],
  ["1", "2", "3"],
]);

console.log("parser tests passed");

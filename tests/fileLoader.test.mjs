import assert from "node:assert/strict";
import JSZip from "jszip";
import { readInputFile } from "../src/fileLoader.mjs";

globalThis.JSZip = JSZip;

const csvFile = new File(["No.,日時,本,小計\n1,2026/01/11 10:00:00,1,300\n合計数,,1,1\n合計額,,300,300\n残数,,9,\n"], "single.csv", {
  type: "text/csv",
});
const single = await readInputFile(csvFile);

assert.equal(single.length, 1);
assert.equal(single[0].sourceFileName, "single.csv");
assert.match(single[0].text, /合計額/);

const zip = new JSZip();
zip.file("log@20260111-110501.csv", "No.,日時,本,小計\n1,2026/01/11 10:00:00,1,300\n合計数,,1,1\n合計額,,300,300\n残数,,9,\n");
zip.file("memo.txt", "not csv");
zip.file("folder/log@20250713-092011.csv", "No.,日時,本,小計\n1,2025/07/13 10:00:00,2,600\n合計数,,2,2\n合計額,,600,600\n残数,,8,\n");
const zipBytes = await zip.generateAsync({ type: "uint8array" });
const zipFile = new File([zipBytes], "sokubai_logs.zip", { type: "application/zip" });
const extracted = await readInputFile(zipFile);

assert.equal(extracted.length, 2);
assert.deepEqual(extracted.map((item) => item.sourceFileName), ["log@20250713-092011.csv", "log@20260111-110501.csv"]);

const emptyZip = new JSZip();
emptyZip.file("memo.txt", "not csv");
const emptyZipFile = new File([await emptyZip.generateAsync({ type: "uint8array" })], "empty.zip", { type: "application/zip" });
await assert.rejects(() => readInputFile(emptyZipFile), /ZIP内にCSVファイルが見つかりませんでした/);

const brokenZipFile = new File(["broken"], "broken.zip", { type: "application/zip" });
await assert.rejects(() => readInputFile(brokenZipFile), /ZIPファイルを展開できませんでした/);

console.log("file loader tests passed");

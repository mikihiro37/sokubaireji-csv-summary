import { parseCsvText } from "./csvParser.mjs";
import { readInputFile } from "./fileLoader.mjs";
import { buildSheetsPayload, createCsvHash, generateImportId } from "./sheetsPayload.mjs";

const fileInput = document.querySelector("#csvFile");
const message = document.querySelector("#message");
const result = document.querySelector("#result");
const summaryCards = document.querySelector("#summaryCards");
const fileListSection = document.querySelector("#fileListSection");
const fileListBody = document.querySelector("#fileListBody");
const checksBody = document.querySelector("#checksBody");
const productsBody = document.querySelector("#productsBody");
const salesBody = document.querySelector("#salesBody");
const saveForm = document.querySelector("#saveForm");
const eventNameInput = document.querySelector("#eventName");
const eventDateInput = document.querySelector("#eventDate");
const sellerNameInput = document.querySelector("#sellerName");
const appsScriptUrlInput = document.querySelector("#appsScriptUrl");
const saveTokenInput = document.querySelector("#saveToken");
const saveButton = document.querySelector("#saveButton");
const saveStatus = document.querySelector("#saveStatus");

const APPS_SCRIPT_URL_STORAGE_KEY = "sokubai.appsScriptUrl";
const SAVE_TOKEN_STORAGE_KEY = "sokubai.saveToken";
let currentParsed = null;
let currentCsvText = "";
let currentFileName = "";
let currentFileItems = [];
let activeFileIndex = 0;

document.documentElement.dataset.jszipAvailable = String(Boolean(globalThis.JSZip));
appsScriptUrlInput.value = localStorage.getItem(APPS_SCRIPT_URL_STORAGE_KEY) ?? "";
saveTokenInput.value = localStorage.getItem(SAVE_TOKEN_STORAGE_KEY) ?? "";

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    showMessage("ファイルを読み込んでいます。", "");
    const sources = await readInputFile(file);
    currentFileItems = sources.map((source) => analyzeSource(source));
    const firstValidIndex = currentFileItems.findIndex((item) => item.parsed);
    if (firstValidIndex === -1) {
      result.hidden = true;
      throw new Error("解析できるCSVがありませんでした。");
    }

    setActiveFile(firstValidIndex);
    saveStatus.textContent = "";
    showMessage(buildLoadMessage(file.name, currentFileItems), "");
  } catch (error) {
    currentParsed = null;
    currentCsvText = "";
    currentFileName = "";
    currentFileItems = [];
    activeFileIndex = 0;
    result.hidden = true;
    showMessage(error instanceof Error ? error.message : "CSVの解析に失敗しました。", "is-error");
  }
});

saveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentParsed) {
    showSaveStatus("先にCSVを読み込んでください。", "error");
    return;
  }

  const meta = {
    eventName: eventNameInput.value.trim(),
    eventDate: eventDateInput.value,
    sellerName: sellerNameInput.value.trim(),
  };
  const appsScriptUrl = appsScriptUrlInput.value.trim();
  const saveToken = saveTokenInput.value.trim();

  if (!meta.eventName || !meta.eventDate || !meta.sellerName || !appsScriptUrl || !saveToken) {
    showSaveStatus("イベント名・イベント日・出店者名・URL・保存用トークンを入力してください。", "error");
    return;
  }

  try {
    saveButton.disabled = true;
    showSaveStatus("スプレッドシートへ保存しています。", "");
    localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, appsScriptUrl);
    localStorage.setItem(SAVE_TOKEN_STORAGE_KEY, saveToken);

    const csvHash = await createCsvHash(currentCsvText);
    const payload = buildSheetsPayload({
      parsed: currentParsed,
      meta,
      sourceFileName: currentFileName,
      csvHash,
      importId: generateImportId(),
      importedAt: new Date().toISOString(),
      token: saveToken,
    });
    const response = await saveToAppsScript(appsScriptUrl, payload);

    if (!response.ok) {
      throw new Error(response.message ?? "保存に失敗しました。");
    }

    showSaveStatus(`保存しました。import_id: ${response.import_id}`, "ok");
  } catch (error) {
    showSaveStatus(error instanceof Error ? error.message : "保存に失敗しました。", "error");
  } finally {
    saveButton.disabled = false;
  }
});

function setActiveFile(index) {
  const item = currentFileItems[index];
  if (!item?.parsed) return;

  activeFileIndex = index;
  currentParsed = item.parsed;
  currentCsvText = item.text;
  currentFileName = item.sourceFileName;
  eventDateInput.value = guessEventDate(item.parsed, item.sourceFileName);
  render(item.parsed);
}

function render(parsed) {
  renderSummaryCards(parsed);
  renderFileList();
  renderChecks(parsed.checks);
  renderProducts(parsed.productSummaries);
  renderSales(parsed.transactions);
  result.hidden = false;
}

function renderSummaryCards(parsed) {
  const allChecksOk = parsed.checks.every((check) => check.status === "ok");
  const cards = [
    ["会計数", `${parsed.totals.transactionCount}件`],
    ["売上合計", formatCurrency(parsed.totals.calculatedAmount)],
    ["販売点数", `${formatNumber(parsed.totals.calculatedQuantity)}点`],
    ["一致確認", allChecksOk ? "一致" : "要確認"],
  ];

  summaryCards.innerHTML = cards
    .map(([label, value]) => `
      <article class="summary-card">
        <p class="summary-card__label">${escapeHtml(label)}</p>
        <p class="summary-card__value">${escapeHtml(value)}</p>
      </article>
    `)
    .join("");
}

function renderFileList() {
  fileListSection.hidden = currentFileItems.length <= 1;
  fileListBody.innerHTML = currentFileItems
    .map((item, index) => {
      if (!item.parsed) {
        return `
          <tr>
            <td>${renderStatus("error")}</td>
            <td>${escapeHtml(item.sourceFileName)}</td>
            <td class="number">-</td>
            <td class="number">-</td>
            <td class="number">-</td>
            <td>${escapeHtml(item.errorMessage)}</td>
            <td>-</td>
          </tr>
        `;
      }

      const allChecksOk = item.parsed.checks.every((check) => check.status === "ok");
      const selected = index === activeFileIndex;
      return `
        <tr>
          <td>${renderStatus(allChecksOk ? "ok" : "warn")}</td>
          <td>${escapeHtml(item.sourceFileName)}</td>
          <td class="number">${formatNumber(item.parsed.totals.transactionCount)}</td>
          <td class="number">${formatNumber(item.parsed.totals.calculatedQuantity)}</td>
          <td class="number">${formatCurrency(item.parsed.totals.calculatedAmount)}</td>
          <td>${allChecksOk ? "一致" : "要確認"}</td>
          <td><button class="small-button" type="button" data-file-index="${index}" ${selected ? "disabled" : ""}>${selected ? "選択中" : "表示"}</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderChecks(checks) {
  checksBody.innerHTML = checks
    .map((check) => `
      <tr>
        <td>${escapeHtml(check.label)}</td>
        <td class="number">${formatOptionalNumber(check.calculated)}</td>
        <td class="number">${formatOptionalNumber(check.csv)}</td>
        <td>${renderStatus(check.status)}</td>
      </tr>
    `)
    .join("");
}

function renderProducts(products) {
  productsBody.innerHTML = products
    .map((product) => `
      <tr>
        <td class="number">${product.columnNumber}</td>
        <td>${escapeHtml(product.name)}</td>
        <td class="number">${formatNumber(product.calculatedQuantity)}</td>
        <td class="number">${formatOptionalNumber(product.csvQuantity)}</td>
        <td class="number">${formatOptionalCurrency(product.csvAmount)}</td>
        <td class="number">${formatOptionalCurrency(product.inferredUnitPrice)}</td>
        <td class="key">${escapeHtml(product.key)}</td>
      </tr>
    `)
    .join("");
}

function renderSales(transactions) {
  salesBody.innerHTML = transactions
    .map((transaction) => `
      <tr>
        <td>${escapeHtml(transaction.no)}</td>
        <td>${escapeHtml(transaction.dateTime)}</td>
        <td class="number">${formatNumber(transaction.totalQuantity)}</td>
        <td class="number">${formatCurrency(transaction.subtotal)}</td>
        <td>${renderDetails(transaction.details)}</td>
      </tr>
    `)
    .join("");
}

function renderDetails(details) {
  if (details.length === 0) return "-";
  return `
    <ul class="detail-list">
      ${details
        .map((detail) => `<li>${escapeHtml(detail.productName)}: ${formatNumber(detail.quantity)}</li>`)
        .join("")}
    </ul>
  `;
}

function renderStatus(status) {
  const label = {
    ok: "一致",
    warn: "未記載",
    error: "不一致",
  }[status] ?? "要確認";

  return `<span class="status ${status}">${label}</span>`;
}

function showMessage(text, className) {
  message.textContent = text;
  message.className = `message ${className}`.trim();
  message.hidden = false;
}

function analyzeSource(source) {
  try {
    return {
      ...source,
      parsed: parseCsvText(source.text),
      errorMessage: "",
    };
  } catch (error) {
    return {
      ...source,
      parsed: null,
      errorMessage: error instanceof Error ? error.message : "CSVの解析に失敗しました。",
    };
  }
}

function buildLoadMessage(fileName, items) {
  const okCount = items.filter((item) => item.parsed).length;
  const errorCount = items.length - okCount;
  if (items.length === 1) {
    return `${fileName} を解析しました。`;
  }
  return `${fileName} からCSV ${items.length}件を読み込みました。解析OK: ${okCount}件、要確認: ${errorCount}件`;
}

async function saveToAppsScript(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("保存先からJSON形式ではない応答が返りました。Apps Scriptのデプロイ設定を確認してください。");
  }

  if (!response.ok) {
    throw new Error(parsed.message ?? `保存先でエラーが発生しました。HTTP ${response.status}`);
  }

  return parsed;
}

function guessEventDate(parsed, fileName) {
  const firstDate = parsed.transactions[0]?.dateTime?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (firstDate) {
    return `${firstDate[1]}-${firstDate[2].padStart(2, "0")}-${firstDate[3].padStart(2, "0")}`;
  }

  const fileDate = fileName.match(/(\d{4})(\d{2})(\d{2})/);
  if (fileDate) {
    return `${fileDate[1]}-${fileDate[2]}-${fileDate[3]}`;
  }

  return "";
}

function showSaveStatus(text, status) {
  saveStatus.textContent = text;
  saveStatus.className = `save-status ${status}`.trim();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatOptionalCurrency(value) {
  return value === null ? "-" : formatCurrency(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatOptionalNumber(value) {
  return value === null ? "-" : formatNumber(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

fileListBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-file-index]");
  if (!button) return;
  setActiveFile(Number(button.dataset.fileIndex));
  saveStatus.textContent = "";
});

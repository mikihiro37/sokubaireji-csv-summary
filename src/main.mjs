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
const settingsState = document.querySelector("#settingsState");
const settingsToggle = document.querySelector("#settingsToggle");
const settingsPanel = document.querySelector("#settingsPanel");
const settingsForm = document.querySelector("#settingsForm");
const settingsClose = document.querySelector("#settingsClose");
const settingsStatus = document.querySelector("#settingsStatus");
const noticeBanner = document.querySelector("#noticeBanner");
const noticeClose = document.querySelector("#noticeClose");
const aboutButton = document.querySelector("#aboutButton");
const pdfPanel = document.querySelector("#pdfPanel");
const pdfButton = document.querySelector("#pdfButton");
const pdfStatus = document.querySelector("#pdfStatus");
const pdfLinkWrap = document.querySelector("#pdfLinkWrap");
const pdfLink = document.querySelector("#pdfLink");
const loadImportsButton = document.querySelector("#loadImportsButton");
const savedImportsStatus = document.querySelector("#savedImportsStatus");
const savedImportsTableWrap = document.querySelector("#savedImportsTableWrap");
const savedImportsBody = document.querySelector("#savedImportsBody");
const savedPdfLinkWrap = document.querySelector("#savedPdfLinkWrap");
const savedPdfLink = document.querySelector("#savedPdfLink");

const APPS_SCRIPT_URL_STORAGE_KEY = "sokubai.appsScriptUrl";
const SAVE_TOKEN_STORAGE_KEY = "sokubai.saveToken";
const NOTICE_DISMISSED_STORAGE_KEY = "sokubai_notice_dismissed";
let currentParsed = null;
let currentCsvText = "";
let currentFileName = "";
let currentFileItems = [];
let activeFileIndex = 0;
let lastSavedImportId = "";

document.documentElement.dataset.jszipAvailable = String(Boolean(globalThis.JSZip));
appsScriptUrlInput.value = localStorage.getItem(APPS_SCRIPT_URL_STORAGE_KEY) ?? "";
saveTokenInput.value = localStorage.getItem(SAVE_TOKEN_STORAGE_KEY) ?? "";
updateSettingsState();
noticeBanner.hidden = localStorage.getItem(NOTICE_DISMISSED_STORAGE_KEY) === "true";

settingsToggle.addEventListener("click", () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

settingsClose.addEventListener("click", () => {
  settingsPanel.hidden = true;
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, appsScriptUrlInput.value.trim());
  localStorage.setItem(SAVE_TOKEN_STORAGE_KEY, saveTokenInput.value.trim());
  updateSettingsState();
  showSettingsStatus("設定を保存しました。", "ok");
  settingsPanel.hidden = true;
});

appsScriptUrlInput.addEventListener("input", updateSettingsState);
saveTokenInput.addEventListener("input", updateSettingsState);

noticeClose.addEventListener("click", () => {
  localStorage.setItem(NOTICE_DISMISSED_STORAGE_KEY, "true");
  noticeBanner.hidden = true;
});

aboutButton.addEventListener("click", () => {
  noticeBanner.hidden = false;
});

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
    resetPdfState();
    showMessage(buildLoadMessage(file.name, currentFileItems), "");
  } catch (error) {
    currentParsed = null;
    currentCsvText = "";
    currentFileName = "";
    currentFileItems = [];
    activeFileIndex = 0;
    result.hidden = true;
    resetPdfState();
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

  if (!meta.eventName || !meta.eventDate || !meta.sellerName) {
    showSaveStatus("イベント名・イベント日・出店者名を入力してください。", "error");
    return;
  }
  if (!appsScriptUrl || !saveToken) {
    showSaveStatus("保存先設定を確認してください。", "error");
    settingsPanel.hidden = false;
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
    const response = await postToAppsScript(appsScriptUrl, {
      ...payload,
      action: "save",
    });

    if (response.code === "duplicate_csv_hash" && response.existing_import_id) {
      setPdfImportReady(
        response.existing_import_id,
        "このCSVは保存済みです。保存済みデータからPDFを作成できます。",
        "保存済みデータからPDFを作成できます。",
      );
      return;
    }

    if (!response.ok) {
      throw new Error(response.message ?? "保存に失敗しました。");
    }

    if (!response.import_id) {
      throw new Error("保存先からimport_idが返りませんでした。");
    }

    setPdfImportReady(
      response.import_id,
      `保存しました。import_id: ${response.import_id}`,
      "保存済みデータからPDFを作成できます。",
    );
  } catch (error) {
    resetPdfState();
    showSaveStatus(error instanceof Error ? error.message : "保存できませんでした。保存先設定または通信状態を確認してください。", "error");
  } finally {
    saveButton.disabled = false;
  }
});

pdfButton.addEventListener("click", async () => {
  const appsScriptUrl = appsScriptUrlInput.value.trim();
  const saveToken = saveTokenInput.value.trim();
  if (!lastSavedImportId) {
    showPdfStatus("先にスプレッドシートへ保存してください。", "error");
    return;
  }
  if (!appsScriptUrl || !saveToken) {
    showPdfStatus("保存先設定を確認してください。", "error");
    settingsPanel.hidden = false;
    return;
  }

  try {
    pdfButton.disabled = true;
    pdfButton.textContent = "PDFを作成しています…";
    pdfLinkWrap.hidden = true;
    showPdfStatus("PDFを作成しています。", "");

    const response = await createPdf(appsScriptUrl, saveToken, lastSavedImportId);
    showPdfLink(pdfLink, pdfLinkWrap, response);
    pdfLinkWrap.hidden = false;
    showPdfStatus("PDFを作成しました。アプリ所有者のGoogle Driveに保存されています。リンクはDriveの共有設定によっては開けない場合があります。", "ok");
  } catch (error) {
    showPdfStatus(error instanceof Error ? error.message : "PDFを作成できませんでした。時間をおいて再度お試しください。", "error");
  } finally {
    pdfButton.disabled = false;
    pdfButton.textContent = "PDFを作成";
  }
});

loadImportsButton.addEventListener("click", async () => {
  const appsScriptUrl = appsScriptUrlInput.value.trim();
  const saveToken = saveTokenInput.value.trim();

  try {
    if (!appsScriptUrl || !saveToken) {
      showSavedImportsStatus("保存先設定を確認してください。", "error");
      settingsPanel.hidden = false;
      return;
    }

    loadImportsButton.disabled = true;
    loadImportsButton.textContent = "読み込み中…";
    savedPdfLinkWrap.hidden = true;
    showSavedImportsStatus("保存済みデータを読み込んでいます。", "");
    localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, appsScriptUrl);
    localStorage.setItem(SAVE_TOKEN_STORAGE_KEY, saveToken);

    const response = await listImports(appsScriptUrl, saveToken);
    renderSavedImports(response.imports || []);
    showSavedImportsStatus(response.imports?.length ? "最近の取込を表示しました。" : "保存済みデータはありません。", "ok");
  } catch (error) {
    showSavedImportsStatus(error instanceof Error ? error.message : "保存済みデータを読み込めませんでした。", "error");
  } finally {
    loadImportsButton.disabled = false;
    loadImportsButton.textContent = "最近の取込を表示";
  }
});

savedImportsBody.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-import-id]");
  if (!button) return;

  const appsScriptUrl = appsScriptUrlInput.value.trim();
  const saveToken = saveTokenInput.value.trim();
  const importId = button.dataset.importId;

  if (!appsScriptUrl || !saveToken) {
    showSavedImportsStatus("保存先設定を確認してください。", "error");
    settingsPanel.hidden = false;
    return;
  }

  try {
    button.disabled = true;
    button.textContent = "作成中…";
    savedPdfLinkWrap.hidden = true;
    showSavedImportsStatus("PDFを作成しています。", "");

    const response = await createPdf(appsScriptUrl, saveToken, importId);
    showPdfLink(savedPdfLink, savedPdfLinkWrap, response);
    showSavedImportsStatus("PDFを作成しました。", "ok");
  } catch (error) {
    showSavedImportsStatus(error instanceof Error ? error.message : "PDFを作成できませんでした。時間をおいて再度お試しください。", "error");
  } finally {
    button.disabled = false;
    button.textContent = "PDF作成";
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
  resetPdfState();
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
          <td><button class="small-button" type="button" data-file-index="${index}" ${selected ? "disabled" : ""}>${selected ? "選択中" : "このCSVを表示"}</button></td>
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

async function postToAppsScript(url, payload) {
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

async function createPdf(appsScriptUrl, saveToken, importId) {
  const response = await postToAppsScript(appsScriptUrl, {
    action: "create_pdf",
    token: saveToken,
    import_id: importId,
  });

  if (!response.ok) {
    throw new Error(response.message ?? "PDF作成に失敗しました。");
  }
  if (!response.pdf_url) {
    throw new Error("保存先からPDF URLが返りませんでした。");
  }

  return response;
}

async function listImports(appsScriptUrl, saveToken) {
  const response = await postToAppsScript(appsScriptUrl, {
    action: "list_imports",
    token: saveToken,
    limit: 20,
  });

  if (!response.ok) {
    throw new Error(response.message ?? "保存済みデータを読み込めませんでした。");
  }

  return response;
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

function setPdfImportReady(importId, saveMessage, pdfMessage) {
  lastSavedImportId = importId;
  showSaveStatus(saveMessage, "ok");
  showPdfReady(pdfMessage);
}

function showPdfReady(messageText) {
  pdfPanel.hidden = false;
  pdfButton.disabled = false;
  pdfLinkWrap.hidden = true;
  showPdfStatus(messageText || "保存成功後の次の操作として、PDFを作成できます。", "");
}

function resetPdfState() {
  lastSavedImportId = "";
  pdfPanel.hidden = true;
  pdfButton.disabled = false;
  pdfButton.textContent = "PDFを作成";
  pdfStatus.textContent = "";
  pdfStatus.className = "save-status";
  pdfLink.href = "#";
  pdfLink.textContent = "PDFを開く";
  pdfLinkWrap.hidden = true;
}

function showPdfStatus(text, status) {
  pdfStatus.textContent = text;
  pdfStatus.className = `save-status ${status}`.trim();
}

function showSavedImportsStatus(text, status) {
  savedImportsStatus.textContent = text;
  savedImportsStatus.className = `save-status ${status}`.trim();
}

function showSettingsStatus(text, status) {
  settingsStatus.textContent = text;
  settingsStatus.className = `save-status ${status}`.trim();
}

function updateSettingsState() {
  const hasSettings = Boolean(appsScriptUrlInput.value.trim() && saveTokenInput.value.trim());
  settingsState.textContent = `保存先：${hasSettings ? "設定済み" : "未設定"}`;
  settingsState.className = `settings-state ${hasSettings ? "ok" : "warn"}`;
}

function showPdfLink(linkElement, wrapElement, response) {
  linkElement.href = response.pdf_url;
  linkElement.textContent = response.filename || "PDFを開く";
  wrapElement.hidden = false;
}

function renderSavedImports(imports) {
  savedImportsTableWrap.hidden = imports.length === 0;
  savedImportsBody.innerHTML = imports
    .map((item) => `
      <tr>
        <td>${escapeHtml(formatDateValue(item.event_date))}</td>
        <td>${escapeHtml(item.event_name || "-")}</td>
        <td>${escapeHtml(item.seller_name || "-")}</td>
        <td class="number">${formatCurrency(Number(item.calculated_total || 0))}</td>
        <td class="number">${formatNumber(Number(item.total_quantity || 0))}点</td>
        <td>${renderStatus(normalizeStatus(item.status))}</td>
        <td>
          <button class="small-button" type="button" data-import-id="${escapeHtml(item.import_id)}">PDF作成</button>
          <details class="row-details">
            <summary>詳細</summary>
            <dl>
              <dt>取込ID</dt><dd>${escapeHtml(item.import_id || "-")}</dd>
              <dt>CSV</dt><dd>${escapeHtml(item.source_file_name || "-")}</dd>
              <dt>取込日時</dt><dd>${escapeHtml(formatDateTimeValue(item.imported_at))}</dd>
            </dl>
          </details>
        </td>
      </tr>
    `)
    .join("");
}

function normalizeStatus(status) {
  if (status === "ok") return "ok";
  if (status === "warning" || status === "warn") return "warn";
  return status === "error" ? "error" : "warn";
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

function formatDateValue(value) {
  if (!value) return "-";
  if (typeof value === "string") return value.slice(0, 10);
  return String(value);
}

function formatDateTimeValue(value) {
  if (!value) return "-";
  return String(value);
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
  resetPdfState();
});

import "../vendor/jszip.min.js";

export async function readInputFile(file) {
  if (isZipFile(file)) {
    return readZipFile(file);
  }

  if (isCsvFile(file)) {
    return [
      {
        sourceFileName: file.name,
        text: await file.text(),
      },
    ];
  }

  throw new Error("CSVまたはZIPファイルを選択してください。");
}

function isCsvFile(file) {
  return file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
}

function isZipFile(file) {
  return file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

async function readZipFile(file) {
  if (!globalThis.JSZip) {
    throw new Error("ZIP展開ライブラリを読み込めませんでした。");
  }

  let zip;
  try {
    zip = await globalThis.JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error("ZIPファイルを展開できませんでした。ファイルが壊れている可能性があります。");
  }

  const csvEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => !entry.name.startsWith("__MACOSX/"))
    .filter((entry) => entry.name.toLowerCase().endsWith(".csv"))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  if (csvEntries.length === 0) {
    throw new Error("ZIP内にCSVファイルが見つかりませんでした。");
  }

  return Promise.all(
    csvEntries.map(async (entry) => ({
      sourceFileName: entry.name.split("/").pop() || entry.name,
      text: await entry.async("string"),
    })),
  );
}

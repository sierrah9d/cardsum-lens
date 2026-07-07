const state = {
  cards: [],
  ids: new Set(),
  stream: null,
  scanTimer: null,
  lastReadAtById: new Map(),
};

const SCAN_INTERVAL_MS = 150;
const SAME_ID_COOLDOWN_MS = 1000;
const CSV_HEADER_COLUMNS = [
  "card_id",
  "name",
  "grams",
  "kcal",
  "carbs_g",
  "protein_g",
];

const cameraStatus = document.querySelector("#cameraStatus");
const toggleCameraButton = document.querySelector("#toggleCameraButton");
const video = document.querySelector("#cameraVideo");
const canvas = document.querySelector("#scanCanvas");
const placeholder = document.querySelector("#videoPlaceholder");
const manualForm = document.querySelector("#manualForm");
const manualInput = document.querySelector("#manualInput");
const importButton = document.querySelector("#importButton");
const importInput = document.querySelector("#importInput");
const messageArea = document.querySelector("#messageArea");
const summaryHeading = document.querySelector("#summaryHeading");
const cardCount = document.querySelector("#cardCount");
const caloriesValue = document.querySelector("#caloriesValue");
const carbsValue = document.querySelector("#carbsValue");
const proteinValue = document.querySelector("#proteinValue");
const tableBody = document.querySelector("#cardsTableBody");
const resetButton = document.querySelector("#resetButton");
const exportButton = document.querySelector("#exportButton");

function parseCardText(rawText) {
  const text = rawText.trim();

  if (!text) {
    throw new Error("カードデータを入力してください。");
  }

  return parseCardParts(parseCsvLine(text), "QRまたは手入力");
}

function parseCardParts(parts, sourceLabel = "データ") {
  if (parts.length !== 6) {
    throw new Error(
      `${sourceLabel}は card_id,name,grams,kcal,carbs,protein の6項目で指定してください。`
    );
  }

  const [idText, nameText, gramsText, caloriesText, carbsText, proteinText] =
    parts.map((part) => part.trim());

  const grams = Number(gramsText);
  const calories = Number(caloriesText);
  const carbs = Number(carbsText);
  const protein = Number(proteinText);

  if (!idText) {
    throw new Error("カードIDは必須です。");
  }

  if (!nameText) {
    throw new Error("カード名称は必須です。");
  }

  if (
    !Number.isFinite(grams) ||
    !Number.isFinite(calories) ||
    !Number.isFinite(carbs) ||
    !Number.isFinite(protein)
  ) {
    throw new Error("グラム数、カロリー、炭水化物、タンパク質は数値で入力してください。");
  }

  return {
    id: idText,
    name: nameText,
    grams,
    calories,
    carbs,
    protein,
  };
}

function addCard(rawText, source = "manual") {
  let parsed;

  try {
    parsed = parseCardText(rawText);
  } catch (error) {
    showMessage(error.message, "warning");
    return false;
  }

  const result = addParsedCard(parsed, source);

  if (!result.added && result.reason === "duplicate") {
    showMessage(`${parsed.id} はすでに追加されています。`, "warning");
  } else if (result.added) {
    showMessage(`${parsed.name}（${parsed.id}）を追加しました。`, "success");
  }

  return result.added;
}

function addParsedCard(
  parsed,
  source = "manual",
  readAt = new Date(),
  options = {}
) {
  const { suppressRender = false } = options;
  const now = Date.now();
  const lastReadAt = state.lastReadAtById.get(parsed.id) || 0;
  state.lastReadAtById.set(parsed.id, now);

  if (state.ids.has(parsed.id)) {
    if (source === "camera" && now - lastReadAt <= SAME_ID_COOLDOWN_MS) {
      return { added: false, reason: "cooldown" };
    }
    return { added: false, reason: "duplicate" };
  }

  state.ids.add(parsed.id);
  state.cards.push({
    ...parsed,
    readAt,
  });

  if (!suppressRender) {
    render();
  }

  return { added: true };
}

function removeCard(id) {
  const removedCard = state.cards.find((card) => card.id === id);
  state.cards = state.cards.filter((card) => card.id !== id);
  state.ids.delete(id);
  render();

  if (removedCard) {
    showMessage(`${removedCard.name}（${id}）を削除しました。`, "success");
  }
}

function resetCards() {
  state.cards = [];
  state.ids.clear();
  state.lastReadAtById.clear();
  render();
  showMessage("読み取り済みカードをリセットしました。", "success");
}

function render() {
  const count = state.cards.length;
  const totals = state.cards.reduce(
    (sum, card) => {
      sum.calories += card.calories;
      sum.carbs += card.carbs;
      sum.protein += card.protein;
      return sum;
    },
    { calories: 0, carbs: 0, protein: 0 }
  );

  cardCount.textContent = String(count);
  caloriesValue.textContent = formatNumber(totals.calories);
  carbsValue.textContent = formatNumber(totals.carbs);
  proteinValue.textContent = formatNumber(totals.protein);

  if (!count) {
    summaryHeading.textContent = "カードはまだありません";
    tableBody.innerHTML =
      '<tr class="empty-row"><td colspan="8">まだカードが追加されていません。</td></tr>';
    exportButton.disabled = true;
    return;
  }

  summaryHeading.textContent =
    count === 1
      ? "1枚の栄養情報を表示中"
      : `${count}枚の栄養情報を合計表示中`;

  exportButton.disabled = false;
  tableBody.replaceChildren(
    ...state.cards.map((card) => {
      const row = document.createElement("tr");
      const cells = [
        card.id,
        card.name,
        `${formatNumber(card.grams)} g`,
        `${formatNumber(card.calories)} kcal`,
        `${formatNumber(card.carbs)} g`,
        `${formatNumber(card.protein)} g`,
        card.readAt.toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      ].map((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        return cell;
      });

      const actionCell = document.createElement("td");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", () => removeCard(card.id));

      actionCell.append(deleteButton);
      row.append(...cells, actionCell);
      return row;
    })
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 2,
  }).format(value);
}

function showMessage(message, type = "") {
  messageArea.textContent = message;
  messageArea.className = `message-area ${type}`.trim();
}

async function toggleCamera() {
  if (state.stream) {
    stopCamera();
    return;
  }

  await startCamera();
}

async function startCamera() {
  if (!window.isSecureContext) {
    showMessage("カメラ利用には HTTPS または localhost で開く必要があります。", "warning");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showMessage("このブラウザではカメラを利用できません。", "warning");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    video.srcObject = state.stream;
    await video.play();
    cameraStatus.textContent = "カメラ使用中";
    cameraStatus.classList.add("active");
    toggleCameraButton.textContent = "カメラ停止";
    placeholder.hidden = true;
    startScanLoop();
    showMessage("QRコードを読み取れる状態になりました。", "success");
  } catch (error) {
    state.stream = null;
    showMessage(`カメラを起動できませんでした: ${error.message}`, "warning");
  }
}

function stopCamera() {
  if (state.scanTimer) {
    clearInterval(state.scanTimer);
    state.scanTimer = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  video.srcObject = null;
  cameraStatus.textContent = "カメラ停止中";
  cameraStatus.classList.remove("active");
  toggleCameraButton.textContent = "カメラ起動";
  placeholder.hidden = false;
  showMessage("カメラを停止しました。");
}

function startScanLoop() {
  if (state.scanTimer) {
    clearInterval(state.scanTimer);
  }

  state.scanTimer = setInterval(scanFrame, SCAN_INTERVAL_MS);
}

function scanFrame() {
  if (!state.stream || !window.jsQR || video.readyState !== video.HAVE_ENOUGH_DATA) {
    return;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    return;
  }

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const result = window.jsQR(imageData.data, width, height, {
    inversionAttempts: "dontInvert",
  });

  if (result?.data) {
    const added = addCard(result.data, "camera");
    if (!added) {
      const parsed = safelyParseCardText(result.data);
      if (parsed && state.ids.has(parsed.id)) {
        const lastReadAt = state.lastReadAtById.get(parsed.id) || 0;
        if (Date.now() - lastReadAt > SAME_ID_COOLDOWN_MS) {
          showMessage(`${parsed.id} はすでに追加されています。`, "warning");
        }
      }
    }
  }
}

function safelyParseCardText(rawText) {
  try {
    return parseCardText(rawText);
  } catch {
    return null;
  }
}

async function importCsv(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const report = parseAndAddCsv(text);

    if (!report.totalRows) {
      showMessage("CSVに取り込めるデータ行がありませんでした。", "warning");
      return;
    }

    if (report.errors.length) {
      showMessage(
        `CSV取込で ${report.added} 件追加、${report.duplicates} 件重複スキップ、${report.errors.length} 件エラーがありました。先頭エラー: ${report.errors[0]}`,
        "warning"
      );
      return;
    }

    showMessage(
      `CSVから ${report.added} 件追加しました。${report.duplicates ? ` ${report.duplicates} 件は重複のためスキップしました。` : ""}`,
      "success"
    );
  } catch (error) {
    showMessage(`CSVを読み込めませんでした: ${error.message}`, "warning");
  } finally {
    importInput.value = "";
  }
}

function parseAndAddCsv(csvText) {
  const normalized = csvText.replace(/^\uFEFF/, "");
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const report = {
    totalRows: 0,
    added: 0,
    duplicates: 0,
    errors: [],
  };

  if (!lines.length) {
    return report;
  }

  const startIndex = isHeaderLine(lines[0]) ? 1 : 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    report.totalRows += 1;

    try {
      const parsed = parseCardParts(parseCsvLine(line), `CSV ${index + 1}行目`);
      const result = addParsedCard(parsed, "csv", new Date(), {
        suppressRender: true,
      });

      if (result.added) {
        report.added += 1;
      } else if (result.reason === "duplicate" || result.reason === "cooldown") {
        report.duplicates += 1;
      }
    } catch (error) {
      report.errors.push(`${index + 1}行目: ${error.message}`);
    }
  }

  if (report.added || report.duplicates) {
    render();
  }

  return report;
}

function isHeaderLine(line) {
  const parts = parseCsvLine(line).map((part) => part.trim().toLowerCase());

  return CSV_HEADER_COLUMNS.every((column, index) => parts[index] === column);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (inQuotes) {
    throw new Error("CSVの引用符が閉じられていません。");
  }

  values.push(current);
  return values;
}

function exportCsv() {
  if (!state.cards.length) {
    showMessage("CSV出力するカードがありません。", "warning");
    return;
  }

  const header = [...CSV_HEADER_COLUMNS, "read_at"];
  const rows = state.cards.map((card) => [
    card.id,
    card.name,
    String(card.grams),
    String(card.calories),
    String(card.carbs),
    String(card.protein),
    card.readAt.toISOString(),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cardsum-lens-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showMessage("CSVを書き出しました。", "success");
}

function escapeCsvCell(value) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

toggleCameraButton.addEventListener("click", toggleCamera);
resetButton.addEventListener("click", resetCards);
exportButton.addEventListener("click", exportCsv);
importButton.addEventListener("click", () => importInput.click());

importInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  await importCsv(file);
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (addCard(manualInput.value, "manual")) {
    manualInput.value = "";
    manualInput.focus();
  }
});

render();

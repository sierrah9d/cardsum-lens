const NUTRIENT_FIELDS = [
  { key: "grams", label: "グラム数", unit: "g", category: "basic", primary: false },
  { key: "calories", label: "カロリー", unit: "kcal", category: "basic", primary: true },
  { key: "carbs", label: "炭水化物", unit: "g", category: "basic", primary: true },
  { key: "protein", label: "タンパク質", unit: "g", category: "basic", primary: true },
  { key: "fat", label: "脂質", unit: "kcal", category: "basic", primary: true },
  { key: "fiber", label: "食物繊維", unit: "mg", category: "minerals", primary: false },
  { key: "potassium", label: "カリウム", unit: "mg", category: "minerals", primary: false },
  { key: "calcium", label: "カルシウム", unit: "mg", category: "minerals", primary: false },
  { key: "iron", label: "鉄", unit: "mg", category: "minerals", primary: false },
  { key: "vitaminA", label: "ビタミンA", unit: "μg", category: "vitamins", primary: false },
  { key: "vitaminC", label: "ビタミンC", unit: "mg", category: "vitamins", primary: false },
  { key: "vitaminD", label: "ビタミンD", unit: "μg", category: "vitamins", primary: false },
  { key: "salt", label: "食塩", unit: "g", category: "vitamins", primary: false },
];

const SUMMARY_SECTIONS = [
  { key: "basic", label: "基本栄養" },
  { key: "minerals", label: "ミネラル・食物繊維" },
  { key: "vitamins", label: "ビタミン・塩分" },
];

const CSV_HEADER_COLUMNS = [
  "card_id",
  "name",
  ...NUTRIENT_FIELDS.map((field) => field.key),
];

const state = {
  cards: [],
  ids: new Set(),
  stream: null,
  scanTimer: null,
  lastReadAtById: new Map(),
  audioContext: null,
  lastInvalidQrAt: 0,
};

const SCAN_INTERVAL_MS = 150;
const SAME_ID_COOLDOWN_MS = 1000;
const INVALID_QR_SOUND_COOLDOWN_MS = 1000;

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
const primaryMetrics = document.querySelector("#primaryMetrics");
const summarySections = document.querySelector("#summarySections");
const tableHead = document.querySelector("#cardsTableHead");
const tableBody = document.querySelector("#cardsTableBody");
const resetButton = document.querySelector("#resetButton");
const exportButton = document.querySelector("#exportButton");

setupStaticUi();

function setupStaticUi() {
  primaryMetrics.replaceChildren(
    ...NUTRIENT_FIELDS.filter((field) => field.primary).map((field) =>
      createMetricCard(field, true)
    )
  );

  summarySections.replaceChildren(
    ...SUMMARY_SECTIONS.map((section) => {
      const wrapper = document.createElement("section");
      wrapper.className = "summary-section";

      const title = document.createElement("h3");
      title.className = "summary-section-title";
      title.textContent = section.label;

      const grid = document.createElement("div");
      grid.className = "summary-section-grid";
      grid.id = `summary-${section.key}`;

      const fields = NUTRIENT_FIELDS.filter(
        (field) => field.category === section.key && !field.primary
      );

      grid.replaceChildren(...fields.map((field) => createMetricCard(field, false)));
      wrapper.append(title, grid);
      return wrapper;
    })
  );

  const headerRow = document.createElement("tr");
  const columns = [
    "カードID",
    "名称",
    ...NUTRIENT_FIELDS.map((field) => field.label),
    "読取時刻",
    "",
  ];

  headerRow.replaceChildren(
    ...columns.map((label) => {
      const cell = document.createElement("th");
      cell.textContent = label;
      return cell;
    })
  );
  tableHead.replaceChildren(headerRow);
}

function createMetricCard(field, prominent) {
  const metric = document.createElement("div");
  metric.className = prominent ? "metric metric-prominent" : "metric";
  metric.dataset.metricKey = field.key;

  const label = document.createElement("span");
  label.textContent = `${field.label} (${field.unit})`;

  const value = document.createElement("strong");
  value.id = `${field.key}Value`;
  value.textContent = "0";

  metric.append(label, value);
  return metric;
}

function parseCardText(rawText) {
  const text = rawText.trim();

  if (!text) {
    throw new Error("カードデータを入力してください。");
  }

  return parseCardParts(parseCsvLine(text), "QRまたは手入力");
}

function parseCardParts(parts, sourceLabel = "データ") {
  const expectedCount = 2 + NUTRIENT_FIELDS.length;

  if (parts.length !== expectedCount) {
    throw new Error(
      `${sourceLabel}は card_id,name,${NUTRIENT_FIELDS.map((field) => field.key).join(",")} の${expectedCount}項目で指定してください。`
    );
  }

  const [idText, nameText, ...valueTexts] = parts.map((part) => part.trim());

  if (!idText) {
    throw new Error("カードIDは必須です。");
  }

  if (!nameText) {
    throw new Error("カード名称は必須です。");
  }

  const numericValues = {};

  for (let index = 0; index < NUTRIENT_FIELDS.length; index += 1) {
    const field = NUTRIENT_FIELDS[index];
    const value = Number(valueTexts[index]);

    if (!Number.isFinite(value)) {
      throw new Error(`${field.label}は数値で入力してください。`);
    }

    numericValues[field.key] = value;
  }

  return {
    id: idText,
    name: nameText,
    ...numericValues,
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

function calculateTotals() {
  const totals = Object.fromEntries(NUTRIENT_FIELDS.map((field) => [field.key, 0]));

  for (const card of state.cards) {
    for (const field of NUTRIENT_FIELDS) {
      totals[field.key] += card[field.key];
    }
  }

  return totals;
}

function render() {
  const count = state.cards.length;
  const totals = calculateTotals();

  cardCount.textContent = String(count);

  for (const field of NUTRIENT_FIELDS) {
    const target = document.querySelector(`#${field.key}Value`);
    if (target) {
      target.textContent = formatNumber(totals[field.key]);
    }
  }

  if (!count) {
    summaryHeading.textContent = "カードはまだありません";
    tableBody.innerHTML = `<tr class="empty-row"><td colspan="${4 + NUTRIENT_FIELDS.length}">まだカードが追加されていません。</td></tr>`;
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
      const values = [
        card.id,
        card.name,
        ...NUTRIENT_FIELDS.map(
          (field) => `${formatNumber(card[field.key])} ${field.unit}`
        ),
        card.readAt.toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      ];

      const cells = values.map((value) => {
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

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  if (!state.audioContext) {
    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }

  return state.audioContext;
}

function playTone({ frequency, duration, type = "sine", volume = 0.05 }) {
  const audioContext = ensureAudioContext();

  if (!audioContext) {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playSuccessSound() {
  playTone({
    frequency: 880,
    duration: 0.12,
    type: "triangle",
    volume: 0.04,
  });
}

function playInvalidQrSound() {
  const now = Date.now();

  if (now - state.lastInvalidQrAt < INVALID_QR_SOUND_COOLDOWN_MS) {
    return;
  }

  state.lastInvalidQrAt = now;
  playTone({
    frequency: 220,
    duration: 0.18,
    type: "sawtooth",
    volume: 0.035,
  });
}

async function toggleCamera() {
  ensureAudioContext();

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
    let parsed;

    try {
      parsed = parseCardText(result.data);
    } catch (error) {
      showMessage(error.message, "warning");
      playInvalidQrSound();
      return;
    }

    const addResult = addParsedCard(parsed, "camera");

    if (addResult.added) {
      showMessage(`${parsed.name}（${parsed.id}）を追加しました。`, "success");
      playSuccessSound();
      return;
    }

    if (state.ids.has(parsed.id)) {
      const lastReadAt = state.lastReadAtById.get(parsed.id) || 0;
      if (Date.now() - lastReadAt > SAME_ID_COOLDOWN_MS) {
        showMessage(`${parsed.id} はすでに追加されています。`, "warning");
      }
    }
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
    ...NUTRIENT_FIELDS.map((field) => String(card[field.key])),
    card.readAt.toISOString(),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((value) => escapeCsvCell(String(value))).join(","))
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
  ensureAudioContext();
  const [file] = event.target.files;
  await importCsv(file);
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ensureAudioContext();
  if (addCard(manualInput.value, "manual")) {
    manualInput.value = "";
    manualInput.focus();
  }
});

render();

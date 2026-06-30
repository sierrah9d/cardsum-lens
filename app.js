const state = {
  cards: [],
  ids: new Set(),
  stream: null,
  scanTimer: null,
  lastReadAtById: new Map(),
};

const SCAN_INTERVAL_MS = 150;
const SAME_ID_COOLDOWN_MS = 1000;

const cameraStatus = document.querySelector("#cameraStatus");
const toggleCameraButton = document.querySelector("#toggleCameraButton");
const video = document.querySelector("#cameraVideo");
const canvas = document.querySelector("#scanCanvas");
const placeholder = document.querySelector("#videoPlaceholder");
const manualForm = document.querySelector("#manualForm");
const manualInput = document.querySelector("#manualInput");
const messageArea = document.querySelector("#messageArea");
const totalValue = document.querySelector("#totalValue");
const cardCount = document.querySelector("#cardCount");
const averageValue = document.querySelector("#averageValue");
const tableBody = document.querySelector("#cardsTableBody");
const resetButton = document.querySelector("#resetButton");
const exportButton = document.querySelector("#exportButton");

function parseCardText(rawText) {
  const text = rawText.trim();
  const parts = text.split(",");

  if (parts.length !== 2) {
    throw new Error("QRデータは card001,100 の形式にしてください。");
  }

  const id = parts[0].trim();
  const valueText = parts[1].trim();
  const value = Number(valueText);

  if (!id) {
    throw new Error("カードIDが空です。");
  }

  if (!Number.isFinite(value)) {
    throw new Error("数値部分を正しい数字にしてください。");
  }

  return { id, value };
}

function addCard(rawText, source = "manual") {
  let parsed;

  try {
    parsed = parseCardText(rawText);
  } catch (error) {
    showMessage(error.message, "warning");
    return false;
  }

  const now = Date.now();
  const lastReadAt = state.lastReadAtById.get(parsed.id) || 0;
  state.lastReadAtById.set(parsed.id, now);

  if (state.ids.has(parsed.id)) {
    if (now - lastReadAt > SAME_ID_COOLDOWN_MS || source === "manual") {
      showMessage(`${parsed.id} はすでに登録済みです。`, "warning");
    }
    return false;
  }

  state.ids.add(parsed.id);
  state.cards.push({
    id: parsed.id,
    value: parsed.value,
    readAt: new Date(),
  });

  render();
  showMessage(`${parsed.id} を追加しました。`, "success");
  return true;
}

function removeCard(id) {
  state.cards = state.cards.filter((card) => card.id !== id);
  state.ids.delete(id);
  render();
  showMessage(`${id} を削除しました。`, "success");
}

function resetCards() {
  state.cards = [];
  state.ids.clear();
  state.lastReadAtById.clear();
  render();
  showMessage("読み取り結果をリセットしました。", "success");
}

function render() {
  const total = state.cards.reduce((sum, card) => sum + card.value, 0);
  const count = state.cards.length;
  const average = count ? total / count : 0;

  totalValue.textContent = formatNumber(total);
  cardCount.textContent = String(count);
  averageValue.textContent = formatNumber(average);

  if (!count) {
    tableBody.innerHTML = '<tr class="empty-row"><td colspan="4">まだカードがありません</td></tr>';
    exportButton.disabled = true;
    return;
  }

  exportButton.disabled = false;
  tableBody.replaceChildren(
    ...state.cards.map((card) => {
      const row = document.createElement("tr");
      const idCell = document.createElement("td");
      const valueCell = document.createElement("td");
      const timeCell = document.createElement("td");
      const actionCell = document.createElement("td");
      const deleteButton = document.createElement("button");

      idCell.textContent = card.id;
      valueCell.textContent = formatNumber(card.value);
      timeCell.textContent = card.readAt.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", () => removeCard(card.id));

      actionCell.append(deleteButton);
      row.append(idCell, valueCell, timeCell, actionCell);
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
    showMessage("カメラはHTTPSまたはlocalhostでのみ使用できます。", "warning");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showMessage("このブラウザはカメラ機能に対応していません。", "warning");
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
    cameraStatus.textContent = "カメラ起動中";
    cameraStatus.classList.add("active");
    toggleCameraButton.textContent = "カメラ停止";
    placeholder.hidden = true;
    startScanLoop();
    showMessage("QRコードを枠内にかざしてください。", "success");
  } catch (error) {
    state.stream = null;
    showMessage(`カメラを開始できませんでした: ${error.message}`, "warning");
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
  cameraStatus.textContent = "カメラ未起動";
  cameraStatus.classList.remove("active");
  toggleCameraButton.textContent = "カメラ開始";
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
    addCard(result.data, "camera");
  }
}

function exportCsv() {
  if (!state.cards.length) {
    showMessage("保存するカードがありません。", "warning");
    return;
  }

  const header = ["card_id", "value", "read_at"];
  const rows = state.cards.map((card) => [
    card.id,
    String(card.value),
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
  showMessage("CSVを保存しました。", "success");
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

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (addCard(manualInput.value, "manual")) {
    manualInput.value = "";
    manualInput.focus();
  }
});

render();

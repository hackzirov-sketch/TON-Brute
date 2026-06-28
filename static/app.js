const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";

const settingsModal = document.querySelector("#settingsModal");
const openSettings = document.querySelector("#openSettings");
const closeSettings = document.querySelector("#closeSettings");
const settingsForm = document.querySelector("#settingsForm");
const botToken = document.querySelector("#botToken");
const userId = document.querySelector("#userId");
const notifyEnabled = document.querySelector("#notifyEnabled");
const saveSettings = document.querySelector("#saveSettings");
const settingsStatus = document.querySelector("#settingsStatus");

openSettings.addEventListener("click", () => {
  settingsModal.hidden = false;
  document.body.style.overflow = "hidden";
  loadSettings();
});

function closeSettingsModal() {
  settingsModal.hidden = true;
  document.body.style.overflow = "";
  settingsStatus.hidden = true;
}

closeSettings.addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-backdrop")) closeSettingsModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsModal.hidden) closeSettingsModal();
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  settingsStatus.hidden = true;
  saveSettings.disabled = true;
  saveSettings.querySelector(".button-label").textContent = "Saqlanmoqda…";
  try {
    const resp = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        bot_token: botToken.value.trim(),
        user_id: userId.value.trim(),
        notify_enabled: notifyEnabled.checked,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Xatolik");
    botToken.value = "";
    botToken.placeholder = data.has_token ? data.bot_token : "Bot token kiritilmagan";
    userId.value = data.user_id || "";
    showSettingsSuccess("Saqlangan");
    closeSettingsModal();
  } catch (err) {
    showSettingsError(err instanceof Error ? err.message : "Xatolik");
  } finally {
    saveSettings.disabled = false;
    saveSettings.querySelector(".button-label").textContent = "Sozlamalarni saqlash";
  }
});

function showSettingsError(msg) {
  settingsStatus.textContent = msg;
  settingsStatus.className = "alert";
  settingsStatus.hidden = false;
}

function showSettingsSuccess(msg) {
  settingsStatus.textContent = msg;
  settingsStatus.className = "alert alert-success";
  settingsStatus.hidden = false;
}

async function loadSettings() {
  try {
    const resp = await fetch("/api/settings", {
      headers: { "X-CSRF-Token": csrfToken },
    });
    if (!resp.ok) return;
    const data = await resp.json();
    botToken.placeholder = data.has_token ? data.bot_token : "Bot token kiritilmagan";
    userId.value = data.user_id || "";
    notifyEnabled.checked = data.notify_enabled;
  } catch {
    /* ignore */
  }
}

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

function addressBlock(label, address, secondary = false) {
  const block = document.createElement("div");
  if (secondary) block.className = "secondary-address";
  block.append(textElement("div", "address-label", label));
  const row = document.createElement("div");
  row.className = "address-row";
  row.append(textElement("code", "address", address));
  const copy = textElement("button", "copy-button", "Nusxa");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(address);
      copy.textContent = "Tayyor";
      window.setTimeout(() => { copy.textContent = "Nusxa"; }, 1200);
    } catch {
      copy.textContent = "Xatolik";
      window.setTimeout(() => { copy.textContent = "Nusxa"; }, 1200);
    }
  });
  row.append(copy);
  block.append(row);
  return block;
}

const autoStart = document.querySelector("#autoStart");
const autoPause = document.querySelector("#autoPause");
const autoResume = document.querySelector("#autoResume");
const autoStop = document.querySelector("#autoStop");
const autoChecked = document.querySelector("#autoChecked");
const autoFound = document.querySelector("#autoFound");
const autoRate = document.querySelector("#autoRate");
const autoInterval = document.querySelector("#autoInterval");
const autoStatus = document.querySelector("#autoStatus");
const autoFoundList = document.querySelector("#autoFoundList");
const autoCurrentSeed = document.querySelector("#autoCurrentSeed");
const autoCurrentSeedText = document.querySelector("#autoCurrentSeedText");

const MAX_FOUND_DOM = 50;

let autoEventSource = null;
let autoRunning = false;
let autoReconnectAttempts = 0;
const MAX_RECONNECT = 5;

function autoShowStatus(msg, isError = false) {
  autoStatus.textContent = msg;
  autoStatus.className = "alert" + (isError ? "" : " alert-success");
  autoStatus.hidden = false;
}

function autoHideStatus() {
  autoStatus.hidden = true;
}

function autoAddFound(data) {
  autoFoundList.hidden = false;

  const block = document.createElement("div");
  block.className = "auto-found-block";

  const seedRow = document.createElement("div");
  seedRow.className = "auto-seed-row";
  const seedCode = document.createElement("code");
  seedCode.className = "auto-seed";
  seedCode.textContent = data.mnemonic || "—";
  const copySeed = document.createElement("button");
  copySeed.type = "button";
  copySeed.className = "copy-button";
  copySeed.textContent = "Nusxa olish";
  copySeed.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(data.mnemonic || "");
      copySeed.textContent = "Tayyor";
      window.setTimeout(() => { copySeed.textContent = "Nusxa olish"; }, 1200);
    } catch {
      copySeed.textContent = "Xatolik";
      window.setTimeout(() => { copySeed.textContent = "Nusxa olish"; }, 1200);
    }
  });
  seedRow.append(seedCode, copySeed);

  const grid = document.createElement("div");
  grid.className = "wallet-grid auto-found-grid";
  data.wallets.forEach((w) => {
    const card = document.createElement("article");
    card.className = "wallet-card";
    const top = document.createElement("div");
    top.className = "wallet-top";
    top.append(textElement("span", "version", w.version));
    top.append(textElement("span", "state", w.state || "tekshirildi"));
    card.append(top);
    const bal = textElement("div", "balance", w.balanceTon || "0");
    bal.append(textElement("span", "", " TON"));
    card.append(bal);
    card.append(addressBlock("Non-bounceable · UQ", w.nonBounceable));
    card.append(addressBlock("Bounceable · EQ", w.bounceable, true));
    grid.appendChild(card);
  });

  block.append(seedRow, grid);
  autoFoundList.insertBefore(block, autoFoundList.querySelector(".auto-found-block"));

  const blocks = autoFoundList.querySelectorAll(".auto-found-block");
  if (blocks.length > MAX_FOUND_DOM) {
    blocks[blocks.length - 1].remove();
  }
}

function connectSSE() {
  autoEventSource = new EventSource(`/api/auto/start?network=mainnet&max_checks=0`);

  autoEventSource.onmessage = (event) => {
    autoReconnectAttempts = 0;
    try {
      const data = JSON.parse(event.data);
      if (data.type === "progress" || data.type === "result") {
        autoRestartsLeft = MAX_AUTO_RESTARTS;
      }
      if (data.type === "started") {
        autoCurrentSeedText.textContent = "Tayyor...";
      } else if (data.type === "result") {
        autoCurrentSeedText.textContent = data.mnemonic || "";
        if (data.hasBalance) {
          autoAddFound(data);
        }
      } else if (data.type === "progress") {
        autoChecked.textContent = data.checked;
        autoFound.textContent = data.found;
        autoRate.textContent = typeof data.rate === "number" ? data.rate.toFixed(1) : data.rate;
        if (data.intervalMs) autoInterval.textContent = data.intervalMs;
      } else if (data.type === "paused") {
        autoPause.hidden = true;
        autoResume.hidden = false;
        autoShowStatus("Pauza.", true);
      } else if (data.type === "rate_limited") {
        autoShowStatus(`Rate limit: ${data.backoffMs}ms kutilmoqda...`, true);
      } else if (data.type === "stopped") {
        autoChecked.textContent = data.checked;
        autoFound.textContent = data.found;
        autoRunning = false;
        autoStart.hidden = false;
        autoPause.hidden = true;
        autoResume.hidden = true;
        autoStop.hidden = true;
        if (data.reason === "range_tugadi") {
          autoCurrentSeedText.textContent = "Range tugadi";
          autoShowStatus(`Range tugadi. ${data.checked} ta tekshirildi, ${data.found} ta topildi.`);
        } else {
          autoCurrentSeedText.textContent = "To'xtatildi";
          autoShowStatus(`Skaner to'xtadi. ${data.checked} ta tekshirildi, ${data.found} ta topildi.`);
        }
      } else if (data.type === "reconnecting") {
        autoCurrentSeedText.textContent = `Qayta ulanmoqda (${data.attempt}/${data.max})...`;
      } else if (data.type === "fatal" || data.type === "error") {
        autoCurrentSeedText.textContent = "Xatolik";
        autoPause.hidden = true;
        autoResume.hidden = true;
        autoShowStatus(data.error || "Xatolik yuz berdi.", true);
        autoRestartAfterDelay();
      }
    } catch {
      /* ignore */
    }
  };

  autoEventSource.onerror = () => {
    if (autoEventSource) {
      autoEventSource.onmessage = null;
      autoEventSource.onerror = null;
      autoEventSource.close();
      autoEventSource = null;
    }
    if (autoRunning && autoReconnectAttempts < MAX_RECONNECT) {
      autoReconnectAttempts++;
      const backoff = Math.min(1000 * Math.pow(2, autoReconnectAttempts), 15000);
      autoCurrentSeedText.textContent = `Qayta ulanmoqda (${autoReconnectAttempts}/${MAX_RECONNECT})...`;
      setTimeout(connectSSE, backoff);
    } else if (autoRunning) {
      autoShowStatus("Ulanish uzildi. Qayta ulanmoqda...", true);
      autoRestartAfterDelay();
    }
  };
}

function startAutoScan() {
  if (autoRunning) return;
  autoHideStatus();
  autoReconnectAttempts = 0;
  autoRunning = true;
  autoStart.hidden = true;
  autoPause.hidden = false;
  autoResume.hidden = true;
  autoStop.hidden = false;
  connectSSE();
}

function stopAutoScan() {
  if (autoEventSource) {
    autoEventSource.onmessage = null;
    autoEventSource.onerror = null;
    autoEventSource.close();
    autoEventSource = null;
  }
  if (autoRestartTimer) {
    clearTimeout(autoRestartTimer);
    autoRestartTimer = null;
  }
  autoRestartsLeft = MAX_AUTO_RESTARTS;
  fetch("/api/auto/stop", { method: "POST" }).catch(() => {});
  autoRunning = false;
  autoStart.hidden = false;
  autoPause.hidden = true;
  autoResume.hidden = true;
  autoStop.hidden = true;
  autoCurrentSeedText.textContent = "To'xtatildi";
}

autoPause.addEventListener("click", () => {
  fetch("/api/auto/pause", { method: "POST" }).catch(() => {});
});

autoResume.addEventListener("click", () => {
  fetch("/api/auto/resume", { method: "POST" }).catch(() => {});
  autoPause.hidden = false;
  autoResume.hidden = true;
  autoHideStatus();
});

autoStop.addEventListener("click", stopAutoScan);
autoStart.addEventListener("click", startAutoScan);

let autoRestartTimer = null;
const AUTO_RESTART_DELAY = 5000;
const MAX_AUTO_RESTARTS = 10;
let autoRestartsLeft = MAX_AUTO_RESTARTS;

function autoRestartAfterDelay() {
  if (autoRestartTimer) return;
  if (autoRestartsLeft <= 0) return;
  autoRestartsLeft--;
  autoRestartTimer = window.setTimeout(() => {
    autoRestartTimer = null;
    if (!autoRunning) {
      autoShowStatus(`Avtomatik qayta ishga tushirilmoqda... (${MAX_AUTO_RESTARTS - autoRestartsLeft}/${MAX_AUTO_RESTARTS})`, true);
      startAutoScan();
    }
  }, AUTO_RESTART_DELAY);
}

async function boot() {
  try {
    const resp = await fetch("/health", { method: "GET" });
    if (!resp.ok) return;
  } catch {
    return;
  }
  startAutoScan();
  setInterval(() => {
    fetch("/health", { method: "GET" }).catch(() => {});
  }, 25 * 60 * 1000);
}

boot();

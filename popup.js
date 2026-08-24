const STAGE_LABELS = {
  idle: "Idle",
  extracting: "[1/3] Extracting page content...",
  sending: "[2/3] Sending to Gemini / ChatGPT tab...",
  appending: "[3/3] Generating & appending to Notes...",
  success: "Appended Successfully",
  error: "Error",
};

const el = (id) => document.getElementById(id);

// --- Branding: fall back to the inline SVG monogram if the remote logo fails to load ---
el("brandLogoImg").addEventListener("error", () => {
  el("brandLogoImg").classList.add("hidden");
  el("brandLogoFallback").classList.remove("hidden");
});

const PROVIDER_LABELS = {
  "gemini-web": "Gemini Web",
  "chatgpt-web": "ChatGPT Web",
};

// --- Settings (auto-saved to chrome.storage.local) ---
async function loadSettings() {
  const { provider = "gemini-web" } = await chrome.storage.local.get("provider");
  el("provider").value = provider;
  updateSessionStatus(provider);
}

function updateSessionStatus(provider) {
  const label = PROVIDER_LABELS[provider] || provider;
  el("sessionStatus").textContent =
    `🔒 Logged-in browser session active — no API key needed. Make sure you're signed in to ${label} in Chrome.`;
}

el("provider").addEventListener("change", async () => {
  const provider = el("provider").value;
  await chrome.storage.local.set({ provider });
  updateSessionStatus(provider);
});

// --- Scan & Add to Notes ---
function setStatus(stage) {
  const badge = el("statusBadge");
  badge.className = `status-badge ${stage}`;
  badge.textContent = STAGE_LABELS[stage] || stage;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PROGRESS") {
    setStatus(message.stage);
  }
});

el("scanBtn").addEventListener("click", () => {
  const topicOverride = el("topicOverride").value.trim();
  const scanBtn = el("scanBtn");
  const errorBox = el("errorBox");

  errorBox.classList.add("hidden");
  scanBtn.disabled = true;
  setStatus("extracting");

  chrome.runtime.sendMessage({ type: "GENERATE_NOTES", topicOverride }, (response) => {
    scanBtn.disabled = false;

    if (chrome.runtime.lastError) {
      setStatus("error");
      errorBox.textContent = chrome.runtime.lastError.message;
      errorBox.classList.remove("hidden");
      return;
    }

    if (response?.ok) {
      setStatus("success");
      el("topicOverride").value = "";
    } else {
      setStatus("error");
      errorBox.textContent = response?.error || "Something went wrong.";
      errorBox.classList.remove("hidden");
    }
  });
});

// --- Open Notes Dashboard ---
el("openViewerBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_VIEWER" });
});

// --- Clear All Notes (with inline confirmation) ---
el("clearNotesBtn").addEventListener("click", () => {
  el("clearConfirm").classList.remove("hidden");
});

el("clearConfirmNo").addEventListener("click", () => {
  el("clearConfirm").classList.add("hidden");
});

el("clearConfirmYes").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_NOTES" }, () => {
    el("clearConfirm").classList.add("hidden");
    setStatus("idle");
  });
});

loadSettings();

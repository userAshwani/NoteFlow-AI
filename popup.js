// ─────────────────────────────────────────────────────────────────────────────
// popup.js — NoteFlow AI  v5.1
// ─────────────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── Logo fallback ─────────────────────────────────────────────────────────────
$("brandLogoImg").addEventListener("error", () => {
  $("brandLogoImg").classList.add("hidden");
  $("brandLogoFallback").classList.remove("hidden");
});

// ── Stage labels ──────────────────────────────────────────────────────────────
const STAGE_LABELS = {
  idle:       "Ready",
  extracting: "[1/4] Reading page content…",
  opening:    "[2/4] Opening your dashboard…",
  generating: "[3/4] AI is working in background…",
  appending:  "[4/4] Saving note…",
  success:    "✓ Note captured!",
  error:      "Something went wrong",
  busy:       "⏳ Previous scan still running…",
};

function setStatus(stage) {
  const badge = $("statusBadge");
  badge.className = `status-badge ${stage}`;
  badge.textContent = STAGE_LABELS[stage] || stage;
}

// ── Notes count stat ──────────────────────────────────────────────────────────
async function refreshHeaderStat() {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const done = notesList.filter((n) => n.status === "done").length;
  $("headerNoteCount").textContent = done;
}

// Update the count whenever storage changes (e.g., after a scan completes).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.notesList) refreshHeaderStat();
});

// ── Provider detection ────────────────────────────────────────────────────────

const PROVIDER_LABELS = {
  "gemini-web":     "Gemini",
  "chatgpt-web":    "ChatGPT",
  "claude-web":     "Claude",
  "perplexity-web": "Perplexity",
  "deepseek-web":   "DeepSeek",
};

function setChip(state, text) {
  const chip = $("sessionChip");
  chip.className = `session-chip ${state}`;
  $("sessionChipText").textContent = text;
}

async function detectAndPopulateProviders() {
  setChip("detecting", "Detecting sessions…");

  const { selectedAIProvider = "gemini-web" } =
    await chrome.storage.local.get("selectedAIProvider");
  $("aiProvider").value = selectedAIProvider;

  chrome.runtime.sendMessage({ type: "DETECT_PROVIDERS" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setChip("inactive", "Sign in to a provider in Chrome to continue");
      return;
    }

    const providers = response.providers;

    // Annotate options — put a ✓ prefix on actively-detected providers.
    Array.from($("aiProvider").options).forEach((opt) => {
      const match = providers.find((p) => p.key === opt.value);
      const label = PROVIDER_LABELS[opt.value] || opt.value;
      opt.textContent = match?.active ? `✓ ${label}` : label;
    });

    const activeCount = providers.filter((p) => p.active).length;

    // If saved provider isn't active, switch to first active one.
    const savedActive = providers.find((p) => p.key === selectedAIProvider && p.active);
    if (!savedActive) {
      const first = providers.find((p) => p.active);
      if (first) {
        $("aiProvider").value = first.key;
        chrome.storage.local.set({ selectedAIProvider: first.key });
      }
    }

    const sel = providers.find((p) => p.key === $("aiProvider").value);
    if (activeCount === 0) {
      setChip("inactive", "No sessions detected — sign in to a provider");
    } else {
      setChip("active", `● ${sel?.label ?? "Selected"} · browser session active`);
    }
  });
}

$("aiProvider").addEventListener("change", async () => {
  const provider = $("aiProvider").value;
  await chrome.storage.local.set({ selectedAIProvider: provider });
  const label = PROVIDER_LABELS[provider] || provider;
  setChip("active", `● ${label} · browser session active`);
});

// ── Scan ──────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "PROGRESS") setStatus(msg.stage);
});

$("scanBtn").addEventListener("click", () => {
  const topicOverride = $("topicOverride").value.trim();
  $("errorBox").classList.add("hidden");
  $("scanBtn").disabled = true;
  setStatus("extracting");

  chrome.runtime.sendMessage({ type: "GENERATE_NOTES", topicOverride }, (response) => {
    $("scanBtn").disabled = false;

    if (chrome.runtime.lastError) {
      setStatus("error");
      $("errorBox").textContent = chrome.runtime.lastError.message;
      $("errorBox").classList.remove("hidden");
      return;
    }

    if (response?.busy) {
      setStatus("busy");
      return;
    }

    if (response?.ok) {
      setStatus("success");
      $("topicOverride").value = "";
      refreshHeaderStat();
    } else {
      setStatus("error");
      $("errorBox").textContent = response?.error || "Something went wrong.";
      $("errorBox").classList.remove("hidden");
    }
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
$("openViewerBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_VIEWER" });
});

// ── Clear All ─────────────────────────────────────────────────────────────────
$("clearNotesBtn").addEventListener("click", () => {
  $("clearConfirm").classList.remove("hidden");
});

$("clearConfirmNo").addEventListener("click", () => {
  $("clearConfirm").classList.add("hidden");
});

$("clearConfirmYes").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_NOTES" }, () => {
    $("clearConfirm").classList.add("hidden");
    setStatus("idle");
    $("headerNoteCount").textContent = "0";
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
detectAndPopulateProviders();
refreshHeaderStat();

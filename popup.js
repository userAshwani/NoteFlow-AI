// ─────────────────────────────────────────────────────────────────────────────
// popup.js — NoteFlow AI
// ─────────────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── Branding: fallback SVG monogram if remote logo fails ─────────────────────
$("brandLogoImg").addEventListener("error", () => {
  $("brandLogoImg").classList.add("hidden");
  $("brandLogoFallback").classList.remove("hidden");
});

// ── Stage labels ─────────────────────────────────────────────────────────────
const STAGE_LABELS = {
  idle:       "Idle",
  extracting: "[ 1 / 4 ]  Extracting page content…",
  opening:    "[ 2 / 4 ]  Opening Notes Dashboard…",
  generating: "[ 3 / 4 ]  AI generating notes silently…",
  appending:  "[ 4 / 4 ]  Saving to dashboard…",
  success:    "✓ Done — note appended!",
  error:      "⚠ Something went wrong",
};

function setStatus(stage) {
  const badge = $("statusBadge");
  badge.className = `status-badge ${stage}`;
  badge.textContent = STAGE_LABELS[stage] || stage;
}

// ── Provider detection ────────────────────────────────────────────────────────

const PROVIDER_LABELS = {
  "gemini-web":     "Gemini Web",
  "chatgpt-web":    "ChatGPT Web",
  "claude-web":     "Claude Web",
  "perplexity-web": "Perplexity AI",
  "deepseek-web":   "DeepSeek Web",
};

function setSessionChip(state, text) {
  const chip = $("sessionChip");
  chip.className = `session-chip ${state}`;
  $("sessionChipText").textContent = text;
}

async function detectAndPopulateProviders() {
  setSessionChip("detecting", "Detecting active sessions…");

  // Restore previously saved provider selection first (fast path).
  const { selectedAIProvider = "gemini-web" } =
    await chrome.storage.local.get("selectedAIProvider");
  $("aiProvider").value = selectedAIProvider;

  // Ask the background worker to run cookie-based detection.
  chrome.runtime.sendMessage({ type: "DETECT_PROVIDERS" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setSessionChip("inactive", "Could not detect sessions — select manually.");
      return;
    }

    const providers = response.providers; // [{ key, label, active }]

    // Annotate the <select> options with a ✓ badge for detected active sessions.
    const select = $("aiProvider");
    Array.from(select.options).forEach((opt) => {
      const match = providers.find((p) => p.key === opt.value);
      const isActive = match?.active ?? false;
      opt.textContent = isActive
        ? `✓ ${PROVIDER_LABELS[opt.value] || opt.value}`
        : `${PROVIDER_LABELS[opt.value] || opt.value}`;
      opt.dataset.active = isActive ? "true" : "false";
    });

    // Count how many providers appear active.
    const activeCount = providers.filter((p) => p.active).length;

    // Verify the restored selection is still valid; if not, fall back to the
    // first detected active provider.
    const savedIsActive = providers.find(
      (p) => p.key === selectedAIProvider && p.active
    );
    if (!savedIsActive) {
      const firstActive = providers.find((p) => p.active);
      if (firstActive) {
        select.value = firstActive.key;
        chrome.storage.local.set({ selectedAIProvider: firstActive.key });
      }
    }

    if (activeCount === 0) {
      setSessionChip(
        "inactive",
        "No active sessions detected — sign in to a provider in Chrome."
      );
    } else {
      const selected = providers.find((p) => p.key === select.value);
      setSessionChip(
        "active",
        `🔒 ${selected?.label ?? "Selected"} session active — no API key needed.`
      );
    }
  });
}

// Update chip whenever the user changes the dropdown.
$("aiProvider").addEventListener("change", async () => {
  const provider = $("aiProvider").value;
  await chrome.storage.local.set({ selectedAIProvider: provider });

  const label = PROVIDER_LABELS[provider] || provider;
  setSessionChip("active", `🔒 ${label} session — make sure you're signed in.`);
});

// ── Scan & Add to Notes ───────────────────────────────────────────────────────

// Listen to progress broadcasts from the background worker.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PROGRESS") {
    setStatus(message.stage);
  }
});

$("scanBtn").addEventListener("click", () => {
  const topicOverride = $("topicOverride").value.trim();
  const errorBox      = $("errorBox");

  errorBox.classList.add("hidden");
  $("scanBtn").disabled = true;
  setStatus("extracting");

  chrome.runtime.sendMessage(
    { type: "GENERATE_NOTES", topicOverride },
    (response) => {
      $("scanBtn").disabled = false;

      if (chrome.runtime.lastError) {
        setStatus("error");
        errorBox.textContent = chrome.runtime.lastError.message;
        errorBox.classList.remove("hidden");
        return;
      }

      if (response?.ok) {
        setStatus("success");
        $("topicOverride").value = "";
      } else {
        setStatus("error");
        errorBox.textContent = response?.error || "Something went wrong.";
        errorBox.classList.remove("hidden");
      }
    }
  );
});

// ── Open Dashboard ────────────────────────────────────────────────────────────
$("openViewerBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_VIEWER" });
});

// ── Clear All Notes (with inline confirmation) ────────────────────────────────
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
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
detectAndPopulateProviders();

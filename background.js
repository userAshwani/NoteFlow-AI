// ─────────────────────────────────────────────────────────────────────────────
// background.js — NoteFlow AI Service Worker
//
// Pipeline (4 phases):
//  [1] Extract page content from the user's active tab.
//  [2] Immediately open viewer.html and insert a skeleton/shimmer note so the
//      user has instant visual feedback — no blank waiting screens.
//  [3] Run the AI session silently in the background (active: false tabs).
//  [4] Replace the skeleton with the resolved note; dashboard card animates in.
//
// The user never loses focus on viewer.html during the entire process.
// ─────────────────────────────────────────────────────────────────────────────

importScripts("services/webSessionBridge.js");

// ── Content extraction ───────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  return tab;
}

async function extractContent(tabId) {
  // Inject content.js (idempotent — safe to call repeatedly).
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__notesFromAiExtract?.(),
  });
  if (!result?.text) throw new Error("Could not extract readable content from this page.");
  return result;
}

// ── Storage helpers ──────────────────────────────────────────────────────────

/**
 * Appends a skeleton/placeholder note to notesList in storage.
 * The dashboard detects this via chrome.storage.onChanged and renders a
 * shimmering "Generating…" card immediately.
 */
async function insertSkeletonNote(id, sourceUrl, provider, topicHint) {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  notesList.push({
    id,
    status: "generating",
    topicTitle: topicHint ? `Generating: ${topicHint}` : "Generating topic notes…",
    sourceUrl,
    provider,
    createdAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({ notesList });
}

/**
 * Replaces the skeleton entry (matched by id) with the fully resolved note.
 * The dashboard detects the status change and swaps skeleton → card.
 */
async function finaliseNote(id, resolvedFields) {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const idx = notesList.findIndex((n) => n.id === id);
  const finalNote = {
    ...resolvedFields,
    id,
    status: "done",
    createdAt: new Date().toISOString(),
  };
  if (idx !== -1) {
    notesList[idx] = finalNote;
  } else {
    notesList.push(finalNote);
  }
  await chrome.storage.local.set({ notesList });
}

/**
 * Marks the skeleton as errored so the dashboard can render an error card
 * instead of leaving the shimmer spinning indefinitely.
 */
async function markSkeletonFailed(id, errorMessage) {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const idx = notesList.findIndex((n) => n.id === id);
  if (idx !== -1) {
    notesList[idx] = { ...notesList[idx], status: "error", errorMessage };
    await chrome.storage.local.set({ notesList });
  }
}

// ── Viewer tab management ────────────────────────────────────────────────────

const VIEWER_PATH = "viewer.html";

async function openOrFocusViewer() {
  const viewerUrl = chrome.runtime.getURL(VIEWER_PATH);
  const tabs = await chrome.tabs.query({ url: viewerUrl });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return tab;
  }
  return chrome.tabs.create({ url: viewerUrl });
}

// ── Main pipeline ────────────────────────────────────────────────────────────

async function runPipeline(topicOverride, sendProgress) {
  const { selectedAIProvider: provider = "gemini-web" } =
    await chrome.storage.local.get("selectedAIProvider");

  // ── Phase 1: Extract content from the current tab ─────────────────────
  sendProgress("extracting");
  const sourceTab = await getActiveTab();
  const rawContent = await extractContent(sourceTab.id);

  // ── Phase 2: Open dashboard + inject skeleton note ────────────────────
  // Do both in parallel — the viewer opens while the skeleton write is in flight.
  sendProgress("opening");
  const noteId = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await Promise.all([
    openOrFocusViewer(),
    insertSkeletonNote(noteId, rawContent.url, provider, topicOverride || null),
  ]);

  // ── Phase 3: Silent background AI session ─────────────────────────────
  // The AI tab is opened with active:false (see webSessionBridge) so the
  // user's view of viewer.html is never interrupted.
  sendProgress("generating");
  let notes;
  try {
    notes = await self.WebSessionBridge.getNotesViaWebSession(
      provider,
      rawContent,
      topicOverride
    );
  } catch (err) {
    await markSkeletonFailed(noteId, err.message);
    throw err;
  }

  // ── Phase 4: Replace skeleton with finalised note ──────────────────────
  sendProgress("appending");
  await finaliseNote(noteId, {
    topicTitle: notes.topicTitle,
    summary: notes.summary,
    code: notes.code,
    codeLanguage: notes.codeLanguage,
    takeaways: notes.takeaways,
    sourceUrl: rawContent.url,
    provider,
  });

  sendProgress("success");
}

// ── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // ── GENERATE_NOTES: Run the full note-generation pipeline ─────────────
  if (message?.type === "GENERATE_NOTES") {
    runPipeline(message.topicOverride, (stage) => {
      chrome.runtime.sendMessage({ type: "PROGRESS", stage }).catch(() => {});
    })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // Keep message channel open for async response.
  }

  // ── OPEN_VIEWER: Focus or create the Notes Dashboard tab ──────────────
  if (message?.type === "OPEN_VIEWER") {
    openOrFocusViewer()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── CLEAR_NOTES: Wipe all saved notes ─────────────────────────────────
  if (message?.type === "CLEAR_NOTES") {
    chrome.storage.local
      .set({ notesList: [] })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── DETECT_PROVIDERS: Cookie-based provider login detection ───────────
  if (message?.type === "DETECT_PROVIDERS") {
    self.WebSessionBridge.detectActiveProviders()
      .then((providers) => sendResponse({ ok: true, providers }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

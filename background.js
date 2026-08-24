// ─────────────────────────────────────────────────────────────────────────────
// background.js — NoteFlow AI Service Worker  v5.1
//
// Pipeline phases:
//  [1] Extract page content from the active tab.
//  [2] Open viewer + write skeleton note → instant shimmer on dashboard.
//  [3] AI session runs silently (active:false tabs, never steals focus).
//  [4] Skeleton replaced by real note card with fade-in animation.
//
// v5.1 changes:
//  • Concurrency guard — only one scan runs at a time. Further clicks get a
//    friendly "busy" response instead of stacking broken skeletons.
// ─────────────────────────────────────────────────────────────────────────────

importScripts("services/webSessionBridge.js");

// ── Concurrency guard ─────────────────────────────────────────────────────────
// Service workers remain alive for the duration of an async operation, so this
// flag persists correctly across multiple clicks within the same scan session.
let _isScanning = false;

// ── Content extraction ────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  return tab;
}

async function extractContent(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__notesFromAiExtract?.(),
  });
  if (!result?.text) throw new Error("Couldn't extract readable content from this page. Try a different page or wait for it to fully load.");
  return result;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function insertSkeletonNote(id, sourceUrl, provider, topicHint) {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  notesList.push({
    id,
    status: "generating",
    topicTitle: topicHint ? `${topicHint}` : "Generating…",
    sourceUrl,
    provider,
    createdAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({ notesList });
}

async function finaliseNote(id, resolvedFields) {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const idx = notesList.findIndex((n) => n.id === id);
  const finalNote = { ...resolvedFields, id, status: "done", createdAt: new Date().toISOString() };
  if (idx !== -1) notesList[idx] = finalNote;
  else notesList.push(finalNote);
  await chrome.storage.local.set({ notesList });
}

async function markSkeletonFailed(id, errorMessage) {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const idx = notesList.findIndex((n) => n.id === id);
  if (idx !== -1) {
    notesList[idx] = { ...notesList[idx], status: "error", errorMessage };
    await chrome.storage.local.set({ notesList });
  }
}

// ── Viewer tab ────────────────────────────────────────────────────────────────

const VIEWER_PATH = "viewer.html";

async function openOrFocusViewer() {
  const viewerUrl = chrome.runtime.getURL(VIEWER_PATH);
  const tabs = await chrome.tabs.query({ url: viewerUrl });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return tabs[0];
  }
  return chrome.tabs.create({ url: viewerUrl });
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function runPipeline(topicOverride, sendProgress) {
  const { selectedAIProvider: provider = "gemini-web" } =
    await chrome.storage.local.get("selectedAIProvider");

  sendProgress("extracting");
  const sourceTab = await getActiveTab();
  const rawContent = await extractContent(sourceTab.id);

  sendProgress("opening");
  const noteId = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await Promise.all([
    openOrFocusViewer(),
    insertSkeletonNote(noteId, rawContent.url, provider, topicOverride || null),
  ]);

  sendProgress("generating");
  let notes;
  try {
    notes = await self.WebSessionBridge.getNotesViaWebSession(provider, rawContent, topicOverride);
  } catch (err) {
    await markSkeletonFailed(noteId, err.message);
    throw err;
  }

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

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  // ── GENERATE_NOTES ────────────────────────────────────────────────────────
  if (message?.type === "GENERATE_NOTES") {
    if (_isScanning) {
      // Politely refuse instead of stacking broken skeleton cards.
      sendResponse({ ok: false, busy: true, error: "A scan is already running. Please wait for it to finish." });
      return true;
    }
    _isScanning = true;
    runPipeline(message.topicOverride, (stage) => {
      chrome.runtime.sendMessage({ type: "PROGRESS", stage }).catch(() => {});
    })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }))
      .finally(() => { _isScanning = false; });
    return true;
  }

  // ── OPEN_VIEWER ───────────────────────────────────────────────────────────
  if (message?.type === "OPEN_VIEWER") {
    openOrFocusViewer()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── CLEAR_NOTES ───────────────────────────────────────────────────────────
  if (message?.type === "CLEAR_NOTES") {
    chrome.storage.local
      .set({ notesList: [], pinnedNoteIds: [] })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── DELETE_NOTE ───────────────────────────────────────────────────────────
  if (message?.type === "DELETE_NOTE") {
    (async () => {
      const { notesList = [] } = await chrome.storage.local.get("notesList");
      const filtered = notesList.filter((n) => n.id !== message.noteId);
      await chrome.storage.local.set({ notesList: filtered });
      sendResponse({ ok: true });
    })().catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── DETECT_PROVIDERS ──────────────────────────────────────────────────────
  if (message?.type === "DETECT_PROVIDERS") {
    self.WebSessionBridge.detectActiveProviders()
      .then((providers) => sendResponse({ ok: true, providers }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

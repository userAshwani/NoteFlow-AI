importScripts("services/webSessionBridge.js");

async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");

  // Inject content.js, then invoke the extractor it attaches to window.
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.__notesFromAiExtract(),
  });

  if (!result?.text) throw new Error("Could not extract any readable content from this page.");
  return result;
}

async function appendNoteToStorage(note) {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  notesList.push(note);
  await chrome.storage.local.set({ notesList });
  return notesList;
}

async function runPipeline(topicOverride, sendProgress) {
  const { provider = "gemini-web" } = await chrome.storage.local.get("provider");

  sendProgress("extracting"); // [1/3] Extracting page content...
  const rawContent = await scanActiveTab();

  sendProgress("sending"); // [2/3] Sending to Gemini / ChatGPT tab...
  const notes = await self.WebSessionBridge.getNotesViaWebSession(provider, rawContent, topicOverride);

  const note = {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    topicTitle: notes.topicTitle,
    summary: notes.summary,
    code: notes.code,
    codeLanguage: notes.codeLanguage,
    takeaways: notes.takeaways,
    sourceUrl: rawContent.url,
    provider,
    createdAt: new Date().toISOString(),
  };

  sendProgress("appending"); // [3/3] Generating & appending to Notes...
  await appendNoteToStorage(note);
  // The dashboard (if already open) picks this up live via chrome.storage.onChanged.

  sendProgress("success");

  // Auto-launch/focus the dashboard so the new note is immediately visible.
  await openOrFocusViewer();

  return note;
}

const VIEWER_PATH = "viewer.html";

async function openOrFocusViewer() {
  const viewerUrl = chrome.runtime.getURL(VIEWER_PATH);
  const tabs = await chrome.tabs.query({ url: viewerUrl });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: viewerUrl });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GENERATE_NOTES") {
    runPipeline(message.topicOverride, (stage) => {
      chrome.runtime.sendMessage({ type: "PROGRESS", stage }).catch(() => {});
    })
      .then((note) => sendResponse({ ok: true, note }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }

  if (message?.type === "OPEN_VIEWER") {
    openOrFocusViewer()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === "CLEAR_NOTES") {
    chrome.storage.local.set({ notesList: [] })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

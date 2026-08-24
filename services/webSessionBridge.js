// Web Session Automation bridge.
//
// Instead of calling a provider's HTTP API with a stored key, this drives the
// user's own already-logged-in Gemini Web / ChatGPT Web tab: it opens (or
// reuses) a tab, types a prompt into the chat box, "presses" send, waits for
// the reply to finish streaming, and scrapes the response text back out.
//
// CAVEATS (read before relying on this in production):
// - This depends entirely on the DOM structure of gemini.google.com /
//   chatgpt.com, which those products can change at any time without
//   notice. If notes generation stops working, the selectors in
//   PROVIDERS below are the first place to check.
// - This automates the same web UI a human would use, from a tab the user
//   already controls and is signed into. It does not touch credentials,
//   does not bypass logins/CAPTCHAs, and does not attempt to hide the
//   automation from the site. It may still be against a given provider's
//   terms of service for automated use of their consumer web app — that's
//   a decision left to whoever deploys this extension.
//
// Runs inside the extension's service worker (background.js), which
// imports this file via `importScripts`.
//
// Public API:
//   getNotesViaWebSession(provider, rawContent, topicOverride) -> Promise<StructuredNotes>

const PROVIDERS = {
  "gemini-web": {
    label: "Gemini Web",
    baseUrl: "https://gemini.google.com/app",
    hostPattern: "https://gemini.google.com/*",
    sessionStorageKey: "geminiActiveChatUrl",
    inputSelectors: [
      "rich-textarea .ql-editor",
      "div.ql-editor[contenteditable='true']",
      "div[contenteditable='true'][aria-label*='prompt' i]",
      "div[contenteditable='true']",
    ],
    sendSelectors: [
      "button[aria-label='Send message']",
      "button[aria-label*='Send' i]",
      "button.send-button",
    ],
    stopSelectors: [
      "button[aria-label='Stop response']",
      "button[aria-label*='Stop' i]",
    ],
    responseSelectors: [
      "message-content .markdown",
      ".model-response-text .markdown",
      "message-content",
    ],
    // Best-effort only — used to try to label a freshly created chat.
    titleSelectors: [
      "[data-test-id='conversation-title']",
      ".conversation-title",
    ],
  },
  "chatgpt-web": {
    label: "ChatGPT Web",
    baseUrl: "https://chatgpt.com/",
    hostPattern: "https://chatgpt.com/*",
    sessionStorageKey: "chatgptActiveChatUrl",
    inputSelectors: [
      "#prompt-textarea",
      "div[contenteditable='true'][id='prompt-textarea']",
      "div[contenteditable='true']",
      "textarea[data-id='root']",
    ],
    sendSelectors: [
      "button[data-testid='send-button']",
      "button[aria-label='Send prompt']",
    ],
    stopSelectors: [
      "button[data-testid='stop-button']",
      "button[aria-label='Stop generating']",
    ],
    responseSelectors: [
      "[data-message-author-role='assistant']",
    ],
    // Best-effort only — used to try to label a freshly created chat.
    titleSelectors: [
      "nav a[data-active='true'] div.truncate",
      "nav a.bg-token-sidebar-surface-secondary div.truncate",
    ],
  },
};

const SESSION_CHAT_TITLE = "AI Study Notes Hub";

const NOTES_SYSTEM_PROMPT = `You are an expert technical documentation summarizer.
Task: Summarize the following lesson page with extreme precision.
Rules:
- Exclude introductory fluff, polite phrases, and filler words.
- Deliver:
  1. Topic Title (Short, precise)
  2. Summary (Maximum 2 concise sentences explaining core concept)
  3. Key Points (3 to 5 bullet points strictly covering syntax, rules, or behavior)
  4. Code Example (Clean, practical code snippet with comments if applicable)
- Format output strictly as structured JSON, and reply with ONLY a single fenced JSON code
  block in exactly this shape — no other text before or after it:

\`\`\`json
{"topicTitle": "...", "summary": "...", "takeaways": ["..."], "code": "...", "codeLanguage": "javascript"}
\`\`\`

- If there is no meaningful code example, set "code" to null.
- This is a new, separate lesson from anything discussed earlier in this chat — do not
  reference or blend it with previous topics.

Here is the scraped page:
`;

function buildPrompt(rawContent, topicOverride) {
  const { title, url, text, headings, codeBlocks } = rawContent;
  let prompt = NOTES_SYSTEM_PROMPT;
  prompt += `\nPage title: ${title}\nURL: ${url}\n`;
  if (topicOverride) {
    prompt += `Use this as the topic title instead of inferring one: "${topicOverride}"\n`;
  }
  if (headings && headings.length) {
    prompt += `\nHeadings found on page:\n${headings.map((h) => `- ${h}`).join("\n")}\n`;
  }
  prompt += `\nContent:\n${text}\n`;
  if (codeBlocks && codeBlocks.length) {
    prompt += `\nCode blocks found on page:\n`;
    codeBlocks.forEach((block, i) => {
      prompt += `\n--- code block ${i + 1} ---\n${block}\n`;
    });
  }
  return prompt;
}

// Self-contained function injected into the AI web tab via chrome.scripting.executeScript.
// Must not close over anything outside its own body — only `cfg` and `promptText` are
// passed in as serializable args.
function automateChatInPage(cfg, promptText) {
  return (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function query(selectors) {
      for (const sel of selectors) {
        const found = document.querySelector(sel);
        if (found) return found;
      }
      return null;
    }

    function queryAll(selectors) {
      for (const sel of selectors) {
        const found = document.querySelectorAll(sel);
        if (found.length) return found;
      }
      return [];
    }

    // Wait briefly for the SPA to hydrate the input box after navigation.
    let input = null;
    const inputDeadline = Date.now() + 20000;
    while (Date.now() < inputDeadline) {
      input = query(cfg.inputSelectors);
      if (input) break;
      await sleep(300);
    }
    if (!input) {
      throw new Error(
        `Could not find the chat input box on ${cfg.label}. The page layout may have changed, ` +
          `or you may not be logged in.`
      );
    }

    // Fill the (contenteditable or textarea) input in a way that framework-bound
    // listeners (React etc.) will actually pick up.
    input.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, promptText);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText }));
    await sleep(400);

    // Send: prefer clicking the send button, fall back to an Enter keypress.
    const sendBtn = query(cfg.sendSelectors);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
      );
    }

    // Wait for generation to start (stop/streaming indicator appears).
    let started = false;
    const startDeadline = Date.now() + 15000;
    while (Date.now() < startDeadline) {
      if (query(cfg.stopSelectors)) {
        started = true;
        break;
      }
      await sleep(300);
    }

    // Wait for generation to finish: either the stop indicator disappears, or
    // (fallback, in case selectors are stale) the response text stops changing.
    let lastText = "";
    let stableTicks = 0;
    const finishDeadline = Date.now() + 120000;
    while (Date.now() < finishDeadline) {
      const stopEl = query(cfg.stopSelectors);
      const bubbles = queryAll(cfg.responseSelectors);
      const lastBubble = bubbles[bubbles.length - 1];
      const currentText = lastBubble ? lastBubble.innerText.trim() : "";

      if (started && !stopEl && currentText) {
        lastText = currentText;
        break;
      }

      if (currentText && currentText === lastText) {
        stableTicks++;
      } else {
        stableTicks = 0;
        lastText = currentText;
      }

      // If we never saw a stop indicator at all (selectors possibly stale),
      // fall back to "text hasn't changed for ~2s" as a done signal.
      if (!started && stableTicks >= 4) break;

      await sleep(500);
    }

    const bubbles = queryAll(cfg.responseSelectors);
    const lastBubble = bubbles[bubbles.length - 1];
    const finalText = (lastBubble ? lastBubble.innerText.trim() : "") || lastText;

    if (!finalText) {
      throw new Error(`Timed out waiting for a response from ${cfg.label}.`);
    }
    return finalText;
  })();
}

function extractJson(rawText) {
  let text = rawText.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  try {
    return JSON.parse(text);
  } catch (e) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Could not parse a JSON notes object out of the AI's reply.");
  }
}

function normalizeNotes(parsed) {
  return {
    topicTitle: parsed.topicTitle || "Untitled Notes",
    summary: parsed.summary || "",
    code: parsed.code || null,
    codeLanguage: parsed.codeLanguage || "javascript",
    takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
  };
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for the AI tab to finish loading."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);

    // In case the tab is already done loading by the time we attach the listener.
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

// Resolves the single reusable "AI Study Notes Hub" tab for a provider:
//   1. If we have a saved chat URL and a tab with that URL is already open, reuse it as-is
//      (no navigation) so the ongoing conversation — and the model's context — is preserved.
//   2. If we have a saved chat URL but no matching open tab, reopen that URL in a background,
//      pinned tab.
//   3. If we have no saved URL, or the reopened URL turned out to be dead/deleted (the site
//      redirected away from it back to a fresh/base composer), start a brand-new chat.
// Returns { tab, isNewChat }.
async function getOrCreateSessionTab(cfg) {
  const stored = await chrome.storage.local.get(cfg.sessionStorageKey);
  const savedUrl = stored[cfg.sessionStorageKey];

  if (savedUrl) {
    const openTabs = await chrome.tabs.query({ url: savedUrl });
    if (openTabs.length > 0) {
      return { tab: openTabs[0], isNewChat: false };
    }

    try {
      const tab = await chrome.tabs.create({ url: savedUrl, active: false, pinned: true });
      await waitForTabComplete(tab.id);
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const reopened = await chrome.tabs.get(tab.id);
      // If the provider redirected us away from the saved conversation (e.g. it was
      // deleted), the URL will no longer match what we stored — treat as gone.
      if (reopened.url && reopened.url.startsWith(savedUrl.split("?")[0])) {
        return { tab: reopened, isNewChat: false };
      }
      // Conversation is gone — fall through to creating a fresh one in this same tab.
      await chrome.tabs.update(tab.id, { url: cfg.baseUrl });
      await waitForTabComplete(tab.id);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { tab: reopened, isNewChat: true };
    } catch {
      // Reopening failed outright — fall through to creating a fresh tab below.
    }
  }

  const tab = await chrome.tabs.create({ url: cfg.baseUrl, active: false, pinned: true });
  await waitForTabComplete(tab.id);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return { tab, isNewChat: true };
}

// Best-effort attempt to rename a freshly created conversation. Wrapped so failures
// never break the main note-generation flow — provider UIs vary and change often.
function tryRenameConversation(cfg, title) {
  try {
    for (const sel of cfg.titleSelectors || []) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.focus?.();
      if ("innerText" in el) el.innerText = title;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    }
  } catch {
    // Non-fatal — the conversation just keeps its provider-assigned default title.
  }
  return false;
}

async function getNotesViaWebSession(provider, rawContent, topicOverride) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error("Unknown web session provider: " + provider);

  const [originalActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const { tab, isNewChat } = await getOrCreateSessionTab(cfg);

  // Bring the AI tab into focus while it works, per the requested UX — then restore
  // the user's original tab once we're done so their reading flow isn't disrupted.
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });

  const promptText = buildPrompt(rawContent, topicOverride);

  let result;
  try {
    // `func` must be fully self-contained (Chrome serializes it to source and
    // re-runs it inside the target page's isolated world) — automateChatInPage
    // only closes over its own locals, so passing it directly works.
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: automateChatInPage,
      args: [cfg, promptText],
    });
    result = injectionResults[0]?.result;

    if (isNewChat) {
      await chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: tryRenameConversation,
          args: [cfg, SESSION_CHAT_TITLE],
        })
        .catch(() => {});
    }
  } catch (err) {
    throw new Error(`Automation failed on ${cfg.label}: ${err.message}`);
  } finally {
    // Persist wherever this conversation ended up (sending the first message updates
    // the URL to include the new conversation's id) so future runs reuse this same chat.
    try {
      const finalTab = await chrome.tabs.get(tab.id);
      if (finalTab.url && finalTab.url.startsWith(cfg.hostPattern.replace("/*", ""))) {
        await chrome.storage.local.set({ [cfg.sessionStorageKey]: finalTab.url });
      }
    } catch {
      // Non-fatal — worst case, the next run re-detects/re-creates the session tab.
    }

    // Restore the user's original active tab/window.
    if (originalActiveTab?.id) {
      await chrome.tabs.update(originalActiveTab.id, { active: true }).catch(() => {});
      if (originalActiveTab.windowId) {
        await chrome.windows.update(originalActiveTab.windowId, { focused: true }).catch(() => {});
      }
    }
  }

  if (!result) throw new Error(`No response text was scraped from ${cfg.label}.`);

  const parsed = extractJson(result);
  return normalizeNotes(parsed);
}

// Exposed as a global for importScripts() in the service worker.
self.WebSessionBridge = { getNotesViaWebSession, PROVIDERS };

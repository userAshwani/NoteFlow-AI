// ─────────────────────────────────────────────────────────────────────────────
// services/webSessionBridge.js
//
// Drives the user's already-logged-in AI web tabs (Gemini, ChatGPT, Claude,
// Perplexity, DeepSeek) without touching credentials or bypassing logins.
//
// Key design:
//  • All AI tabs are opened with `active: false, pinned: true` — the user's
//    view is never stolen.
//  • Completion detection uses a MutationObserver (event-driven) instead of
//    busy-polling loops, making it CPU-friendly and more reliable.
//  • One reusable chat thread per provider is kept alive across scans.
//
// Public API (exposed on `self.WebSessionBridge`):
//   getNotesViaWebSession(provider, rawContent, topicOverride) → Promise<StructuredNotes>
//   detectActiveProviders()                                    → Promise<ProviderStatus[]>
// ─────────────────────────────────────────────────────────────────────────────

// ── Provider configs ─────────────────────────────────────────────────────────
// Each entry is a prioritised list of CSS selectors. The bridge tries each in
// order and uses the first match, so you can prepend a new selector without
// removing the old one when a provider updates its DOM.

const PROVIDERS = {
  "gemini-web": {
    label: "Gemini Web",
    baseUrl: "https://gemini.google.com/app",
    hostPattern: "https://gemini.google.com/",
    sessionStorageKey: "geminiActiveChatUrl",
    cookieDomain: "google.com",
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
    titleSelectors: [
      "[data-test-id='conversation-title']",
      ".conversation-title",
    ],
  },

  "chatgpt-web": {
    label: "ChatGPT Web",
    baseUrl: "https://chatgpt.com/",
    hostPattern: "https://chatgpt.com/",
    sessionStorageKey: "chatgptActiveChatUrl",
    cookieDomain: "chatgpt.com",
    inputSelectors: [
      "#prompt-textarea",
      "div[contenteditable='true'][id='prompt-textarea']",
      "div[contenteditable='true']",
      "textarea[data-id='root']",
    ],
    sendSelectors: [
      "button[data-testid='send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label*='Send' i]",
    ],
    stopSelectors: [
      "button[data-testid='stop-button']",
      "button[aria-label='Stop generating']",
      "button[aria-label*='Stop' i]",
    ],
    responseSelectors: [
      "[data-message-author-role='assistant']",
    ],
    titleSelectors: [
      "nav a[data-active='true'] div.truncate",
      "nav a.bg-token-sidebar-surface-secondary div.truncate",
    ],
  },

  "claude-web": {
    label: "Claude Web",
    baseUrl: "https://claude.ai/new",
    hostPattern: "https://claude.ai/",
    sessionStorageKey: "claudeActiveChatUrl",
    cookieDomain: "claude.ai",
    inputSelectors: [
      "div[contenteditable='true'].ProseMirror",
      "div[contenteditable='true'][data-placeholder]",
      "div[contenteditable='true']",
    ],
    sendSelectors: [
      "button[aria-label='Send Message']",
      "button[data-testid='send-button']",
      "button[aria-label*='Send' i]",
    ],
    stopSelectors: [
      "button[aria-label='Stop Response']",
      "button[aria-label*='Stop' i]",
    ],
    responseSelectors: [
      ".font-claude-message",
      "[data-is-streaming] .prose",
      ".prose",
    ],
    titleSelectors: [
      "nav [aria-current='page'] span",
      ".conversation-title",
    ],
  },

  "perplexity-web": {
    label: "Perplexity AI",
    baseUrl: "https://www.perplexity.ai/",
    hostPattern: "https://www.perplexity.ai/",
    sessionStorageKey: "perplexityActiveChatUrl",
    cookieDomain: "perplexity.ai",
    inputSelectors: [
      "textarea[placeholder*='Ask' i]",
      "textarea.overflow-auto",
      "textarea",
    ],
    sendSelectors: [
      "button[aria-label='Submit']",
      "button[data-testid='submit-button']",
      "button[type='submit']",
    ],
    stopSelectors: [
      "button[aria-label='Stop']",
      "button[aria-label*='Stop' i]",
    ],
    responseSelectors: [
      ".prose",
      "[data-testid='answer-text']",
      ".answer-text",
    ],
    titleSelectors: [
      "h1.line-clamp-1",
    ],
  },

  "deepseek-web": {
    label: "DeepSeek Web",
    baseUrl: "https://chat.deepseek.com/",
    hostPattern: "https://chat.deepseek.com/",
    sessionStorageKey: "deepseekActiveChatUrl",
    cookieDomain: "chat.deepseek.com",
    inputSelectors: [
      "textarea#chat-input",
      "textarea[placeholder*='message' i]",
      "textarea",
    ],
    sendSelectors: [
      "div[role='button'][aria-label*='Send' i]",
      "button[aria-label*='Send' i]",
      "button[type='submit']",
    ],
    stopSelectors: [
      "div[role='button'][aria-label*='Stop' i]",
      "button[aria-label*='Stop' i]",
    ],
    responseSelectors: [
      ".ds-markdown",
      ".chat-message-content .markdown-body",
      ".message-content",
    ],
    titleSelectors: [
      ".chat-title",
    ],
  },
};

// ── Prompt ───────────────────────────────────────────────────────────────────

const SESSION_CHAT_TITLE = "NoteFlow AI — Study Notes Hub";

const NOTES_SYSTEM_PROMPT = `You are an expert documentation summarizer. Summarize this lesson with zero fluff:
1. Topic Title (Short, precise)
2. Summary (Maximum 2 concise sentences explaining the core concept)
3. Key Points (3 to 5 bullet points covering syntax, properties, or rules)
4. Code Snippet (Clean, practical, commented where helpful)

Output must be formatted as structured JSON and reply with ONLY a single fenced JSON code block — no other text before or after:

\`\`\`json
{"topicTitle": "...", "summary": "...", "takeaways": ["..."], "code": "...", "codeLanguage": "javascript"}
\`\`\`

- If there is no meaningful code example, set "code" to null.
- This is a new, separate lesson — do not reference or blend it with previous topics.

Here is the scraped page:
`;

function buildPrompt(rawContent, topicOverride) {
  const { title, url, text, headings, codeBlocks } = rawContent;
  let prompt = NOTES_SYSTEM_PROMPT;
  prompt += `\nPage title: ${title}\nURL: ${url}\n`;
  if (topicOverride) {
    prompt += `Use this as the topic title instead of inferring one: "${topicOverride}"\n`;
  }
  if (headings?.length) {
    prompt += `\nHeadings found on page:\n${headings.map((h) => `- ${h}`).join("\n")}\n`;
  }
  prompt += `\nContent:\n${text}\n`;
  if (codeBlocks?.length) {
    prompt += `\nCode blocks found on page:\n`;
    codeBlocks.forEach((block, i) => {
      prompt += `\n--- code block ${i + 1} ---\n${block}\n`;
    });
  }
  return prompt;
}

// ── Page automation (injected into AI tab) ───────────────────────────────────
// IMPORTANT: This function is serialised by Chrome and re-executed inside the
// target page's isolated world. It must be completely self-contained — no
// references to anything outside its own body. Only `cfg` and `promptText`
// are passed in as serialisable args.

function automateChatInPage(cfg, promptText) {
  return (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

    // ── 1. Wait for the input box to hydrate (SPA may not be ready yet) ──
    let input = null;
    const inputDeadline = Date.now() + 20000;
    while (Date.now() < inputDeadline) {
      input = query(cfg.inputSelectors);
      if (input) break;
      await sleep(300);
    }
    if (!input) {
      throw new Error(
        `Could not find the chat input on ${cfg.label}. ` +
          `The UI may have changed, or you are not signed in.`
      );
    }

    // ── 2. Fill the input (handles both contenteditable and <textarea>) ──
    input.focus();
    if (input.tagName === "TEXTAREA") {
      // React / Vue controlled textarea: bypass synthetic event system
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      nativeSetter.call(input, promptText);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // contenteditable (Gemini, ChatGPT, Claude)
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, promptText);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText }));
    }
    await sleep(500);

    // ── 3. Send ─────────────────────────────────────────────────────────
    const sendBtn = query(cfg.sendSelectors);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true,
        })
      );
    }

    // ── 4. Wait for response via MutationObserver (event-driven) ────────
    const responseText = await new Promise((resolve, reject) => {
      const TIMEOUT_MS = 120_000;
      let generationStarted = false;
      let lastText = "";
      let debounceTimer = null;
      let done = false;

      function finish(text) {
        if (done) return;
        done = true;
        clearTimeout(hardTimeout);
        clearTimeout(debounceTimer);
        mo.disconnect();
        resolve(text);
      }

      // Hard deadline — we always resolve with whatever we have, or reject.
      const hardTimeout = setTimeout(() => {
        if (done) return;
        done = true;
        mo.disconnect();
        clearTimeout(debounceTimer);
        const bubbles = queryAll(cfg.responseSelectors);
        const last = bubbles[bubbles.length - 1];
        const text = last?.innerText?.trim();
        if (text) resolve(text);
        else reject(new Error(`Timed out waiting for a response from ${cfg.label}.`));
      }, TIMEOUT_MS);

      function check() {
        if (done) return;
        const stopEl = query(cfg.stopSelectors);
        if (stopEl) generationStarted = true;

        const bubbles = queryAll(cfg.responseSelectors);
        const last = bubbles[bubbles.length - 1];
        const text = last?.innerText?.trim() || "";

        // Primary signal: stop button gone after it appeared + we have text.
        if (generationStarted && !stopEl && text) {
          finish(text);
          return;
        }

        // Fallback: text hasn't changed in 2.5s (handles stale stop selectors).
        if (text !== lastText) {
          lastText = text;
          clearTimeout(debounceTimer);
          if (text) {
            debounceTimer = setTimeout(() => {
              if (!query(cfg.stopSelectors)) finish(text);
            }, 2500);
          }
        }
      }

      // MutationObserver fires on any DOM change in the page — event-driven,
      // no busy-polling, far gentler on CPU than setInterval.
      const mo = new MutationObserver(check);
      mo.observe(document.body, { childList: true, subtree: true });

      // Immediate check in case the response is already rendered.
      check();
    });

    if (!responseText) {
      throw new Error(`No response text was captured from ${cfg.label}.`);
    }
    return responseText;
  })();
}

// ── JSON extraction ──────────────────────────────────────────────────────────

function extractJson(rawText) {
  let text = rawText.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Could not parse a JSON notes object out of the AI reply.");
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

// ── Tab helpers ──────────────────────────────────────────────────────────────

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

    // Resolve immediately if already loaded.
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

// Resolve the single reusable session tab for a provider:
//   1. Saved URL + matching open tab → reuse as-is (preserves context).
//   2. Saved URL + no open tab → reopen in background pinned tab.
//   3. URL gone / redirect detected → start fresh chat.
//   4. No saved URL → start fresh chat.
// Returns { tab, isNewChat }.
async function getOrCreateSessionTab(cfg) {
  const stored = await chrome.storage.local.get(cfg.sessionStorageKey);
  const savedUrl = stored[cfg.sessionStorageKey];

  if (savedUrl) {
    // Try to find an already-open tab with this URL.
    const openTabs = await chrome.tabs.query({ url: `${savedUrl}*` });
    if (openTabs.length > 0) {
      return { tab: openTabs[0], isNewChat: false };
    }

    // Reopen in background.
    try {
      const tab = await chrome.tabs.create({ url: savedUrl, active: false, pinned: true });
      await waitForTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 1500));

      const reopened = await chrome.tabs.get(tab.id);
      const hostBase = cfg.hostPattern;
      if (reopened.url?.startsWith(hostBase)) {
        return { tab: reopened, isNewChat: false };
      }
      // Conversation was deleted — start fresh in this tab.
      await chrome.tabs.update(tab.id, { url: cfg.baseUrl });
      await waitForTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 1500));
      return { tab: await chrome.tabs.get(tab.id), isNewChat: true };
    } catch {
      // Fall through to creating a brand-new tab.
    }
  }

  // No saved URL — open a fresh conversation tab in the background.
  const tab = await chrome.tabs.create({ url: cfg.baseUrl, active: false, pinned: true });
  await waitForTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 1500));
  return { tab, isNewChat: true };
}

// Best-effort rename of a freshly created conversation. Failures are swallowed
// because provider UIs vary and this is purely cosmetic.
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
    // Non-fatal.
  }
  return false;
}

// ── Main public function ─────────────────────────────────────────────────────

async function getNotesViaWebSession(provider, rawContent, topicOverride) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error("Unknown web session provider: " + provider);

  const { tab, isNewChat } = await getOrCreateSessionTab(cfg);
  // AI tab stays in background — active: false preserves user focus.

  const promptText = buildPrompt(rawContent, topicOverride);

  let result;
  try {
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
    // Persist the chat URL (may include the new conversation ID) so the
    // next scan reuses this same thread.
    try {
      const finalTab = await chrome.tabs.get(tab.id);
      if (finalTab.url?.startsWith(cfg.hostPattern)) {
        await chrome.storage.local.set({ [cfg.sessionStorageKey]: finalTab.url });
      }
    } catch {
      // Non-fatal.
    }
  }

  if (!result) throw new Error(`No response text was scraped from ${cfg.label}.`);

  const parsed = extractJson(result);
  return normalizeNotes(parsed);
}

// ── Provider login detection ─────────────────────────────────────────────────
// Uses chrome.cookies to make a best-effort guess at whether the user is
// currently logged in to each provider. A cookie count > 2 is used as a
// heuristic — not 100% accurate, but reliable enough for UX purposes.

async function detectActiveProviders() {
  const candidates = Object.entries(PROVIDERS).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    domain: cfg.cookieDomain,
  }));

  const results = await Promise.all(
    candidates.map(async ({ key, label, domain }) => {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        return { key, label, active: cookies.length > 2 };
      } catch {
        return { key, label, active: false };
      }
    })
  );
  return results;
}

// ── Export ───────────────────────────────────────────────────────────────────
self.WebSessionBridge = { getNotesViaWebSession, detectActiveProviders, PROVIDERS };

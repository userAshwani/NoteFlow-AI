// ─────────────────────────────────────────────────────────────────────────────
// services/webSessionBridge.js  v5.1
//
// v5.1 key fix:
//  • automateChatInPage now captures `existingBubbleCount` BEFORE sending the
//    prompt and only watches for bubbles that appear AFTER that count. This
//    prevents the observer from immediately picking up the previous response
//    when multiple scans run on the same conversation thread — which caused
//    "No response text scraped" errors on the 2nd/3rd scan.
// ─────────────────────────────────────────────────────────────────────────────

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
      // Ordered by specificity — try narrow selectors first
      "[data-message-author-role='assistant'] .markdown.prose",
      "[data-message-author-role='assistant'] .prose",
      "[data-message-author-role='assistant']",
      ".group\\/conversation-turn .agent-turn .markdown",
      ".group\\/conversation-turn .agent-turn",
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
    titleSelectors: [".chat-title"],
  },
};

const SESSION_CHAT_TITLE = "NoteFlow AI — Study Hub";

const NOTES_SYSTEM_PROMPT = `You are an expert documentation summarizer. Summarize this lesson with zero fluff:
1. Topic Title (Short, precise)
2. Summary (Maximum 2 concise sentences explaining the core concept)
3. Key Points (3 to 5 bullet points covering syntax, properties, or rules)
4. Code Snippet (Clean, practical, commented where helpful)

Output as a single fenced JSON code block — absolutely no other text:

\`\`\`json
{"topicTitle": "...", "summary": "...", "takeaways": ["..."], "code": "...", "codeLanguage": "javascript"}
\`\`\`

- Set "code" to null if there is no meaningful example.
- This is a brand-new topic. Do not reference anything from earlier in this chat.

Page content follows:
`;

function buildPrompt(rawContent, topicOverride) {
  const { title, url, text, headings, codeBlocks } = rawContent;
  let prompt = NOTES_SYSTEM_PROMPT;
  prompt += `\nPage title: ${title}\nURL: ${url}\n`;
  if (topicOverride) prompt += `Topic title to use: "${topicOverride}"\n`;
  if (headings?.length) prompt += `\nPage headings:\n${headings.map((h) => `- ${h}`).join("\n")}\n`;
  prompt += `\nContent:\n${text}\n`;
  if (codeBlocks?.length) {
    prompt += `\nCode samples:\n`;
    codeBlocks.forEach((b, i) => (prompt += `--- [${i + 1}] ---\n${b}\n`));
  }
  return prompt;
}

// ── Page automation (injected into AI tab) ───────────────────────────────────
// Self-contained — must not close over anything outside its own body.
// Only `cfg` and `promptText` are passed as serialisable args.

function automateChatInPage(cfg, promptText) {
  return (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function query(selectors) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    function queryAll(selectors) {
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length) return els;
      }
      return [];
    }

    // ── 1. Wait for input ────────────────────────────────────────────────
    let input = null;
    const inputDeadline = Date.now() + 20000;
    while (Date.now() < inputDeadline) {
      input = query(cfg.inputSelectors);
      if (input) break;
      await sleep(300);
    }
    if (!input) {
      throw new Error(
        `Could not find the chat input on ${cfg.label}. Make sure you are signed in and the page is fully loaded.`
      );
    }

    // ── 2. Snapshot existing response count BEFORE sending ───────────────
    // This is the critical v5.1 fix: we only watch for bubbles that appear
    // AFTER our prompt, preventing the observer from resolving immediately
    // with the previous conversation's response.
    const existingBubbleCount = queryAll(cfg.responseSelectors).length;

    // ── 3. Fill the input ────────────────────────────────────────────────
    input.focus();
    if (input.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      ).set;
      setter.call(input, promptText);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, promptText);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText }));
    }
    await sleep(500);

    // ── 4. Send ──────────────────────────────────────────────────────────
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

    // ── 5. Wait for NEW response via MutationObserver ────────────────────
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

      const hardTimeout = setTimeout(() => {
        if (done) return;
        done = true;
        mo.disconnect();
        clearTimeout(debounceTimer);
        // Grab whatever we have as a last resort.
        const bubbles = queryAll(cfg.responseSelectors);
        const newBubbles = Array.from(bubbles).slice(existingBubbleCount);
        const last = newBubbles[newBubbles.length - 1];
        const text = last?.innerText?.trim();
        if (text) resolve(text);
        else reject(
          new Error(
            `${cfg.label} did not respond within 2 minutes. ` +
            `Make sure you're signed in and the tab isn't blocked. ` +
            `Try again — if the issue persists, the provider's selectors may have changed.`
          )
        );
      }, TIMEOUT_MS);

      function check() {
        if (done) return;
        const stopEl = query(cfg.stopSelectors);
        if (stopEl) generationStarted = true;

        const bubbles = queryAll(cfg.responseSelectors);
        // Only look at bubbles that appeared AFTER our prompt was sent.
        const newBubbles = Array.from(bubbles).slice(existingBubbleCount);
        if (!newBubbles.length) return;

        const last = newBubbles[newBubbles.length - 1];
        const text = last?.innerText?.trim() || "";

        // Primary: stop indicator gone after it appeared + text present.
        if (generationStarted && !stopEl && text) {
          finish(text);
          return;
        }

        // Fallback: text stable for 3s (handles stale stop selectors).
        if (text !== lastText) {
          lastText = text;
          clearTimeout(debounceTimer);
          if (text) {
            debounceTimer = setTimeout(() => {
              if (!query(cfg.stopSelectors)) finish(text);
            }, 3000);
          }
        }
      }

      const mo = new MutationObserver(check);
      mo.observe(document.body, { childList: true, subtree: true });
      check(); // Immediate check.
    });

    if (!responseText) throw new Error(`No response received from ${cfg.label}.`);
    return responseText;
  })();
}

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJson(rawText) {
  let text = rawText.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("Couldn't parse a JSON notes object from the AI reply. The model may have replied in an unexpected format — try again.");
  }
}

function normalizeNotes(parsed) {
  return {
    topicTitle: parsed.topicTitle || "Untitled",
    summary: parsed.summary || "",
    code: parsed.code || null,
    codeLanguage: parsed.codeLanguage || "javascript",
    takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
  };
}

// ── Tab helpers ───────────────────────────────────────────────────────────────

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for the AI tab to load."));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function getOrCreateSessionTab(cfg) {
  const stored = await chrome.storage.local.get(cfg.sessionStorageKey);
  const savedUrl = stored[cfg.sessionStorageKey];

  if (savedUrl) {
    const openTabs = await chrome.tabs.query({ url: `${savedUrl}*` });
    if (openTabs.length > 0) return { tab: openTabs[0], isNewChat: false };

    try {
      const tab = await chrome.tabs.create({ url: savedUrl, active: false, pinned: true });
      await waitForTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 1500));
      const reopened = await chrome.tabs.get(tab.id);
      if (reopened.url?.startsWith(cfg.hostPattern)) return { tab: reopened, isNewChat: false };
      await chrome.tabs.update(tab.id, { url: cfg.baseUrl });
      await waitForTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 1500));
      return { tab: await chrome.tabs.get(tab.id), isNewChat: true };
    } catch { /* fall through */ }
  }

  const tab = await chrome.tabs.create({ url: cfg.baseUrl, active: false, pinned: true });
  await waitForTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 1500));
  return { tab, isNewChat: true };
}

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
  } catch { /* non-fatal */ }
  return false;
}

// ── Main public function ──────────────────────────────────────────────────────

async function getNotesViaWebSession(provider, rawContent, topicOverride) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error("Unknown provider: " + provider);

  const { tab, isNewChat } = await getOrCreateSessionTab(cfg);

  const promptText = buildPrompt(rawContent, topicOverride);
  let result;
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: automateChatInPage,
      args: [cfg, promptText],
    });
    result = res[0]?.result;

    if (isNewChat) {
      await chrome.scripting
        .executeScript({ target: { tabId: tab.id }, func: tryRenameConversation, args: [cfg, SESSION_CHAT_TITLE] })
        .catch(() => {});
    }
  } catch (err) {
    throw new Error(`Automation failed on ${cfg.label}: ${err.message}`);
  } finally {
    try {
      const finalTab = await chrome.tabs.get(tab.id);
      if (finalTab.url?.startsWith(cfg.hostPattern)) {
        await chrome.storage.local.set({ [cfg.sessionStorageKey]: finalTab.url });
      }
    } catch { /* non-fatal */ }
  }

  if (!result) throw new Error(`No response captured from ${cfg.label}. Check that you're signed in and the provider's page loaded correctly.`);
  return normalizeNotes(extractJson(result));
}

// ── Provider detection ────────────────────────────────────────────────────────

async function detectActiveProviders() {
  const candidates = Object.entries(PROVIDERS).map(([key, cfg]) => ({
    key, label: cfg.label, domain: cfg.cookieDomain,
  }));
  return Promise.all(
    candidates.map(async ({ key, label, domain }) => {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        return { key, label, active: cookies.length > 2 };
      } catch {
        return { key, label, active: false };
      }
    })
  );
}

self.WebSessionBridge = { getNotesViaWebSession, detectActiveProviders, PROVIDERS };

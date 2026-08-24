// ─────────────────────────────────────────────────────────────────────────────
// services/webSessionBridge.js  v5.6
//
// Truly Silent Background AI Engine:
//  • Zero tab jumping, zero focus stealing — tabs run with active: false, pinned: true.
//  • Deep Angular/Quill (Gemini), Slate (ChatGPT), ProseMirror (Claude) DOM injection.
//  • Anti-throttling & unthrottled MessageChannel observation loop.
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
      "rich-textarea div[contenteditable='true']",
      "div[contenteditable='true']",
      "textarea",
    ],
    sendSelectors: [
      "button.send-button",
      "button[aria-label='Send message']",
      "button[aria-label*='Send' i]",
      "button.send-button-container button",
      "span.send-button-container button",
      "button[jsname='v39KGc']",
      "button[mat-icon-button]",
    ],
    stopSelectors: [
      "button[aria-label='Stop response']",
      "button[aria-label*='Stop' i]",
      "button[aria-label='Stop generating']",
      ".stop-button",
    ],
    responseSelectors: [
      "message-content .markdown",
      ".model-response-text .markdown",
      "message-content",
      ".response-container-content",
      "model-response",
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
      "textarea",
    ],
    sendSelectors: [
      "button[data-testid='send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label*='Send' i]",
      "button[aria-label='Submit']",
    ],
    stopSelectors: [
      "button[data-testid='stop-button']",
      "button[aria-label='Stop generating']",
      "button[aria-label*='Stop' i]",
    ],
    responseSelectors: [
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

// ── Injected Automation Function ─────────────────────────────────────────────
function automateChatInPage(cfg, promptText) {
  return (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ── 0. Anti-Throttling & Visibility Spoofing ─────────────────────────
    try {
      Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
      Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
      Object.defineProperty(document, "webkitHidden", { get: () => false, configurable: true });
      Object.defineProperty(document, "webkitVisibilityState", { get: () => "visible", configurable: true });
      document.hasFocus = () => true;

      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    } catch (e) {
      /* non-fatal */
    }

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
    const inputDeadline = Date.now() + 25000;
    while (Date.now() < inputDeadline) {
      input = query(cfg.inputSelectors);
      if (input) break;
      await sleep(200);
    }
    if (!input) {
      throw new Error(
        `Could not find chat input on ${cfg.label}. Please ensure you are logged in and the page is loaded.`
      );
    }

    // ── 2. Snapshot existing response count BEFORE sending ───────────────
    const existingBubbleCount = queryAll(cfg.responseSelectors).length;

    // ── 3. Fill input with full event propagation ────────────────────────
    input.focus();
    input.dispatchEvent(new FocusEvent("focus", { bubbles: true, composed: true }));
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));

    // A. Textarea / Input element (ChatGPT / Perplexity / DeepSeek)
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT" || input.id === "prompt-textarea") {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      if (setter) setter.call(input, promptText);
      else input.value = promptText;

      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          data: promptText,
          inputType: "insertText",
        })
      );
    }
    // B. Quill / Rich Textarea (Gemini Web)
    else if (input.classList.contains("ql-editor") || input.closest("rich-textarea")) {
      const paragraphs = promptText
        .split("\n")
        .filter(Boolean)
        .map((p) => `<p>${p}</p>`)
        .join("");
      input.innerHTML = paragraphs || `<p>${promptText}</p>`;

      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: promptText, inputType: "insertText" }));
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(new CustomEvent("text-change", { bubbles: true, composed: true }));

      const host = input.closest("rich-textarea");
      if (host) {
        host.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        host.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      }
    }
    // C. Contenteditable / ProseMirror (Claude / Other)
    else {
      input.innerHTML = `<p>${promptText.replace(/\n/g, "<br>")}</p>`;
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, promptText);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: promptText }));
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }

    await sleep(250);

    // ── 4. Trigger Send Button ───────────────────────────────────────────
    let sendBtn = null;
    const sendDeadline = Date.now() + 4000;
    while (Date.now() < sendDeadline) {
      sendBtn = query(cfg.sendSelectors);
      if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute("aria-disabled") !== "true") {
        break;
      }
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await sleep(150);
    }

    if (sendBtn) {
      sendBtn.removeAttribute("disabled");
      sendBtn.setAttribute("aria-disabled", "false");
      const mouseOpts = { bubbles: true, cancelable: true, view: window, composed: true, buttons: 1 };
      sendBtn.dispatchEvent(new PointerEvent("pointerdown", mouseOpts));
      sendBtn.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
      sendBtn.dispatchEvent(new PointerEvent("pointerup", mouseOpts));
      sendBtn.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
      sendBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }

    // ── 5. Unthrottled Observation Loop ──────────────────────────────────
    const responseText = await new Promise((resolve, reject) => {
      const TIMEOUT_MS = 120_000;
      let generationStarted = false;
      let lastText = "";
      let stableCount = 0;
      let done = false;

      function finish(text) {
        if (done) return;
        done = true;
        clearTimeout(hardTimeout);
        mo.disconnect();
        resolve(text);
      }

      const hardTimeout = setTimeout(() => {
        if (done) return;
        done = true;
        mo.disconnect();
        const bubbles = queryAll(cfg.responseSelectors);
        const newBubbles = Array.from(bubbles).slice(existingBubbleCount);
        const last = newBubbles[newBubbles.length - 1];
        const text = last?.innerText?.trim();
        if (text) resolve(text);
        else {
          reject(
            new Error(
              `${cfg.label} timed out. Make sure you are signed in and the session is active.`
            )
          );
        }
      }, TIMEOUT_MS);

      function check() {
        if (done) return;

        window.dispatchEvent(new Event("visibilitychange"));

        const stopEl = query(cfg.stopSelectors);
        if (stopEl) generationStarted = true;

        const bubbles = queryAll(cfg.responseSelectors);
        const newBubbles = Array.from(bubbles).slice(existingBubbleCount);
        if (!newBubbles.length) return;

        const last = newBubbles[newBubbles.length - 1];
        const text = last?.innerText?.trim() || "";

        if (generationStarted && !stopEl && text.length > 10) {
          finish(text);
          return;
        }

        if (text && text === lastText && text.length > 20) {
          stableCount++;
          if (!stopEl && stableCount >= 3) {
            finish(text);
            return;
          }
        } else {
          lastText = text;
          stableCount = 0;
        }
      }

      const mo = new MutationObserver(check);
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });

      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        if (done) return;
        check();
        setTimeout(() => {
          if (!done) channel.port2.postMessage(null);
        }, 250);
      };
      channel.port2.postMessage(null);

      check();
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
    throw new Error("Could not parse JSON response from the AI. Please try again.");
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

// ── Tab management ───────────────────────────────────────────────────────────

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
    if (openTabs.length > 0) {
      await chrome.tabs.update(openTabs[0].id, { autoDiscardable: false }).catch(() => {});
      return { tab: openTabs[0], isNewChat: false };
    }

    try {
      const tab = await chrome.tabs.create({ url: savedUrl, active: false, pinned: true });
      await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
      await waitForTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 1000));
      const reopened = await chrome.tabs.get(tab.id);
      if (reopened.url?.startsWith(cfg.hostPattern)) return { tab: reopened, isNewChat: false };
      await chrome.tabs.update(tab.id, { url: cfg.baseUrl });
      await waitForTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 1000));
      return { tab: await chrome.tabs.get(tab.id), isNewChat: true };
    } catch {
      /* fall through */
    }
  }

  const tab = await chrome.tabs.create({ url: cfg.baseUrl, active: false, pinned: true });
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  await waitForTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 1000));
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
  } catch {
    /* non-fatal */
  }
  return false;
}

// ── Note Synthesis (Strictly in Background) ──────────────────────────────────

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
    try {
      const finalTab = await chrome.tabs.get(tab.id);
      if (finalTab.url?.startsWith(cfg.hostPattern)) {
        await chrome.storage.local.set({ [cfg.sessionStorageKey]: finalTab.url });
      }
    } catch {
      /* non-fatal */
    }
  }

  if (!result) throw new Error(`No response captured from ${cfg.label}. Please make sure you are signed in.`);
  return normalizeNotes(extractJson(result));
}

// ── Interactive Multi-AI Chat Handoff ────────────────────────────────────────

async function sendChatMessageViaWebSession(provider, userMessage, contextHistory) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error("Unknown provider: " + provider);

  const { tab, isNewChat } = await getOrCreateSessionTab(cfg);

  let formattedPrompt = userMessage;
  if (contextHistory && contextHistory.trim()) {
    formattedPrompt = `[Context from prior conversation:\n${contextHistory.trim()}\n]\n\nUser Question: ${userMessage}`;
  }

  let result;
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: automateChatInPage,
      args: [cfg, formattedPrompt],
    });
    result = res[0]?.result;

    if (isNewChat) {
      await chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: tryRenameConversation,
          args: [cfg, "NoteFlow AI — Chat Hub"],
        })
        .catch(() => {});
    }
  } catch (err) {
    throw new Error(`Chat failed on ${cfg.label}: ${err.message}`);
  } finally {
    try {
      const finalTab = await chrome.tabs.get(tab.id);
      if (finalTab.url?.startsWith(cfg.hostPattern)) {
        await chrome.storage.local.set({ [cfg.sessionStorageKey]: finalTab.url });
      }
    } catch {
      /* non-fatal */
    }
  }

  if (!result) throw new Error(`No response from ${cfg.label}.`);
  return result;
}

// ── Provider detection ────────────────────────────────────────────────────────

async function detectActiveProviders() {
  const candidates = Object.entries(PROVIDERS).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    domain: cfg.cookieDomain,
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

self.WebSessionBridge = {
  getNotesViaWebSession,
  sendChatMessageViaWebSession,
  detectActiveProviders,
  PROVIDERS,
};

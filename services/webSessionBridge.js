// ─────────────────────────────────────────────────────────────────────────────
// services/webSessionBridge.js  v6.5
//
// Background AI Engine:
//  • Four approaches at "run this invisibly" were tried, in order:
//      - In-tab iframe (v6.0): breaks the AI site's own session cookies —
//        Chromium treats a cross-site iframe as third-party storage, so
//        ChatGPT/Gemini's internal session-sync calls start 403ing.
//      - Off-screen popup window (v6.1): Chrome outright refuses to create a
//        window positioned mostly off-screen ("bounds must be at least 50%
//        within visible screen space") — there is no way to make a real
//        window invisible this way.
//      - chrome.debugger (v6.3): DOES relieve background-tab throttling, but
//        Chrome deliberately surfaces a "started debugging this browser"
//        banner on the tab the user is actively looking at (not just the
//        debugged one) for as long as it's attached — a bigger, more
//        persistent visible disruption than the tab flash it was meant to
//        replace, plus a sensitive extra permission. Reverted.
//      - Same-window pinned background tab + focus flash (v6.2–v6.4): got
//        the Send button working reliably, but live testing showed
//        responses only ever got picked up once the user manually clicked
//        into the AI tab — Chromium suspends an occluded/non-selected tab's
//        actual rendering/paint, not just its timers, so the DOM answer
//        never gets committed until the tab is genuinely visible again.
//  • v6.5 (current): each AI session runs in its own dedicated, on-screen,
//    non-minimized window instead of a background tab sharing the user's
//    window. A tab is unconditionally "hidden" the moment it isn't the
//    selected tab of its window, regardless of OS focus — but a window that
//    is simply unfocused (not covered, not minimized) isn't occluded in that
//    same sense, so its one tab should keep rendering normally. A brief
//    (<1s) OS focus flash (withBriefTabFocus) is still used to unlock
//    Chromium's focus-gated execCommand()/selection APIs for the Send click,
//    then focus returns to the user immediately. UNVERIFIED beyond this
//    reasoning — no browser available in this environment to confirm it
//    actually resolves the symptom, and it depends on the window not ending
//    up covered by the user's own (e.g. maximized) browser window.
//  • Deep Angular/Quill (Gemini), Slate (ChatGPT), ProseMirror (Claude) DOM injection.
//  • Anti-throttling & unthrottled MessageChannel observation loop.
// ─────────────────────────────────────────────────────────────────────────────

// `conversationUrlPattern` is what makes single-session reuse actually work.
// A provider's base/composer URL (e.g. https://chatgpt.com/) is NOT a
// conversation — persisting it as the "active chat" is what caused a brand
// new chat to be spawned on every run. Only a URL matching this pattern is
// ever saved as the reusable session, and only such a URL is trusted when
// restoring one.
const PROVIDERS = {
  "gemini-web": {
    label: "Gemini Web",
    baseUrl: "https://gemini.google.com/app",
    hostPattern: "https://gemini.google.com/",
    conversationUrlPattern: /^https:\/\/gemini\.google\.com\/app\/[0-9a-zA-Z_-]{6,}/,
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
    // /c/<uuid> when signed in, /uc/<uuid> for a logged-out temporary chat,
    // /g/<id>/c/<uuid> inside a GPT.
    conversationUrlPattern: /^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?u?c\/[0-9a-fA-F-]{8,}/,
    sessionStorageKey: "chatgptActiveChatUrl",
    cookieDomain: "chatgpt.com",
    inputSelectors: [
      "div[contenteditable='true']#prompt-textarea",
      "#prompt-textarea",
      "div.ProseMirror[contenteditable='true']",
      "div[contenteditable='true']",
      "textarea[data-id='root']",
      "textarea",
    ],
    sendSelectors: [
      "button[data-testid='send-button']",
      "#composer-submit-button",
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
    conversationUrlPattern: /^https:\/\/claude\.ai\/chat\/[0-9a-fA-F-]{8,}/,
    sessionStorageKey: "claudeActiveChatUrl",
    cookieDomain: "claude.ai",
    inputSelectors: [
      "div[contenteditable='true'].ProseMirror",
      "div[contenteditable='true'][data-placeholder]",
      "fieldset div[contenteditable='true']",
      "div[contenteditable='true']",
    ],
    // Attribute-value matching is case-sensitive in CSS, and Claude has
    // shipped both "Send message" and "Send Message" — the `i` flag variants
    // cover either spelling.
    sendSelectors: [
      "button[aria-label='Send message' i]",
      "button[data-testid='send-button']",
      "button[aria-label*='Send' i]",
    ],
    stopSelectors: [
      "button[aria-label='Stop response' i]",
      "button[aria-label*='Stop' i]",
      "button[data-testid='stop-button']",
    ],
    responseSelectors: [
      "[data-testid='conversation-turn-assistant'] .font-claude-message",
      ".font-claude-message",
      "[data-is-streaming] .prose",
      "div.font-claude-response",
    ],
    titleSelectors: [
      "nav [aria-current='page'] span",
    ],
  },

  "perplexity-web": {
    label: "Perplexity AI",
    baseUrl: "https://www.perplexity.ai/",
    hostPattern: "https://www.perplexity.ai/",
    conversationUrlPattern: /^https:\/\/www\.perplexity\.ai\/search\/[^/?#]+/,
    sessionStorageKey: "perplexityActiveChatUrl",
    cookieDomain: "perplexity.ai",
    // Perplexity moved its composer from a <textarea> to a contenteditable
    // div (#ask-input); the textarea entries are kept as fallbacks for
    // older/alternate builds.
    inputSelectors: [
      "div[contenteditable='true']#ask-input",
      "#ask-input",
      "div[contenteditable='true'][role='textbox']",
      "div[contenteditable='true']",
      "textarea[placeholder*='Ask' i]",
      "textarea",
    ],
    sendSelectors: [
      "button[data-testid='submit-button']",
      "button[aria-label='Submit' i]",
      "button[aria-label*='Submit' i]",
      "button[type='submit']",
    ],
    stopSelectors: [
      "button[aria-label='Stop' i]",
      "button[aria-label*='Stop' i]",
    ],
    responseSelectors: [
      "[data-testid='answer-text']",
      ".prose",
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
    conversationUrlPattern: /^https:\/\/chat\.deepseek\.com\/a\/chat\/s\/[0-9a-fA-F-]{8,}/,
    sessionStorageKey: "deepseekActiveChatUrl",
    cookieDomain: "chat.deepseek.com",
    inputSelectors: [
      "textarea#chat-input",
      "textarea[placeholder*='message' i]",
      "textarea",
      "div[contenteditable='true']",
    ],
    // DeepSeek's send control is an unlabelled obfuscated-class <div
    // role=button>, so there's often nothing stable to match — the Enter-key
    // fallback in automateChatInPage is the real submission path here.
    sendSelectors: [
      "div[role='button'][aria-label*='Send' i]",
      "button[aria-label*='Send' i]",
      "button[type='submit']",
      "div[role='button'][aria-disabled='false']",
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

    // Counting bubbles with whichever selector happens to match first is
    // unsafe once we reuse one long-lived conversation (the normal case now):
    // the "before" count could come from one selector and the "after" list
    // from another, so slicing off the pre-existing bubbles would cut the
    // wrong number. Snapshot a count PER selector instead, then afterwards
    // use the first selector that actually grew — the counts always line up.
    function countsBySelector(selectors) {
      const counts = {};
      for (const sel of selectors) counts[sel] = document.querySelectorAll(sel).length;
      return counts;
    }

    // Returns the newest bubble that appeared after `baseline`, or null.
    function newestNewBubble(selectors, baseline) {
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > (baseline[sel] ?? 0)) return els[els.length - 1];
      }
      return null;
    }

    function anyNewBubble(selectors, baseline) {
      return !!newestNewBubble(selectors, baseline);
    }

    // `.innerText` is layout-aware — reading it forces Chromium to run a
    // reflow, which a backgrounded/non-visible tab can defer indefinitely.
    // That's exactly why this used to sit "stuck" showing nothing until the
    // user actually clicked into the AI tab (forcing that reflow) and back.
    // `.textContent` reads straight from the DOM tree with no layout
    // dependency, so it stays accurate even while this tab isn't active.
    function readText(el) {
      if (!el) return "";
      const rendered = el.innerText;
      if (rendered && rendered.trim().length > 0) return rendered.trim();
      return (el.textContent || "").trim();
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

    // ── 2. Snapshot existing response counts BEFORE sending ──────────────
    const baselineCounts = countsBySelector(cfg.responseSelectors);

    // ── 3. Fill input with full event propagation ────────────────────────
    input.focus();
    input.dispatchEvent(new FocusEvent("focus", { bubbles: true, composed: true }));
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));

    // Branch strictly on the ACTUAL element type. The previous version also
    // routed anything with id="prompt-textarea" down the <textarea> path —
    // but ChatGPT's #prompt-textarea is a contenteditable ProseMirror DIV,
    // and calling the HTMLTextAreaElement value setter on a div throws
    // "TypeError: Illegal invocation", which aborted the whole automation
    // before a single keystroke landed. That was the actual reason every
    // non-Gemini provider failed.
    const isFormField = input.tagName === "TEXTAREA" || input.tagName === "INPUT";
    const isQuill = !isFormField && (input.classList.contains("ql-editor") || !!input.closest("rich-textarea"));

    // A. Real <textarea> / <input> (DeepSeek, older Perplexity builds)
    if (isFormField) {
      const proto = input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
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
    // B. Quill / Rich Textarea (Gemini Web) — proven working, left as-is.
    else if (isQuill) {
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
    // C. Contenteditable rich editors — ProseMirror (ChatGPT, Claude),
    //    Lexical/Slate (Perplexity and friends).
    //
    //    These keep their own internal document model; writing .innerHTML
    //    directly leaves that model empty, so the framework still believes
    //    the composer is blank and keeps Send disabled. A synthetic paste
    //    with real clipboard data is the one path all of them implement
    //    natively (they all support pasting text), so it updates the model
    //    properly. execCommand("insertText") is kept as a fallback for any
    //    editor that ignores programmatic paste.
    else {
      // Clear whatever is there via the editor's own selection machinery.
      const range = document.createRange();
      range.selectNodeContents(input);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      let inserted = false;
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", promptText);
        const pasteEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: dt,
        });
        input.dispatchEvent(pasteEvent);
        // If the editor handled the paste, its model now has our text.
        inserted = (input.innerText || input.textContent || "").trim().length > 0;
      } catch {
        /* fall through to execCommand */
      }

      if (!inserted) {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, promptText);
      }

      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          data: promptText,
          inputType: "insertText",
        })
      );
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

    function pressEnter() {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }

    function clickSend(btn) {
      btn.removeAttribute("disabled");
      btn.setAttribute("aria-disabled", "false");
      const mouseOpts = { bubbles: true, cancelable: true, view: window, composed: true, buttons: 1 };
      btn.dispatchEvent(new PointerEvent("pointerdown", mouseOpts));
      btn.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
      btn.dispatchEvent(new PointerEvent("pointerup", mouseOpts));
      btn.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
      btn.click();
    }

    if (sendBtn) {
      clickSend(sendBtn);
    } else {
      pressEnter();
    }

    // ── 4b. Verify the send actually registered ──────────────────────────
    // If the framework's internal state never picked up the synthetic input
    // (a known Angular/React quirk when a tab hasn't held real OS focus), the
    // click/Enter above is a silent no-op: nothing gets sent, the stop
    // indicator never appears, and the observation loop below would
    // otherwise sit doing nothing for the full 120s timeout before failing —
    // exactly the "stuck" symptom. Detect that within ~2.5s and retry once
    // with the other input method before committing to the long wait, so a
    // genuine failure surfaces in seconds instead of two minutes.
    function hasUnsentText() {
      // For a real form field only `.value` is meaningful — `.innerText` on a
      // <textarea> returns its original default content, not what's typed
      // now, which would make a successful send look like a failed one.
      if (isFormField) return (input.value || "").trim().length > 0;
      return (input.innerText || input.textContent || "").trim().length > 0;
    }

    async function sendRegistered() {
      const checkDeadline = Date.now() + 2500;
      while (Date.now() < checkDeadline) {
        if (query(cfg.stopSelectors)) return true;
        if (anyNewBubble(cfg.responseSelectors, baselineCounts)) return true;
        if (!hasUnsentText()) return true; // most UIs clear the input on successful send
        await sleep(200);
      }
      return false;
    }

    if (!(await sendRegistered())) {
      // Retry once with the other submission method before giving up.
      if (sendBtn) pressEnter();
      else {
        const retryBtn = query(cfg.sendSelectors);
        if (retryBtn) clickSend(retryBtn);
      }
      if (!(await sendRegistered())) {
        throw new Error(
          `${cfg.label} didn't accept the prompt (the send control may not have responded). ` +
            `Try refreshing the ${cfg.label} tab once and running the scan again.`
        );
      }
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
        const text = readText(newestNewBubble(cfg.responseSelectors, baselineCounts));
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

        const last = newestNewBubble(cfg.responseSelectors, baselineCounts);
        if (!last) return;

        const text = readText(last);

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

// ── Session tab management ────────────────────────────────────────────────────

function waitForTabComplete(tabId, timeoutMs = 30000) {
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

// ── v6.5 experiment: dedicated window instead of a same-window background tab ──
//
// The Gemini live-test that motivated this change showed the prompt sending
// and the AI answering correctly — but NoteFlow's dashboard didn't pick up
// the finished response until the tab was manually clicked into. That's
// Chromium suspending an *occluded/non-selected-tab* renderer's actual
// painting/DOM-commit work (Section 2A of PROBLEM_ANALYSIS.md) — a
// compositor-level throttle no amount of document.hidden-spoofing or
// MutationObserver polling can see around, because the DOM genuinely isn't
// being updated in that process until it's visible again.
//
// A background *tab* is unconditionally treated as hidden by Chromium the
// moment it isn't the selected tab of its window — regardless of whether
// that window has OS focus. A tab that is the sole/active tab of its own
// separate, on-screen, non-minimized window is NOT "occluded" in the same
// sense purely for lacking OS focus — occlusion tracks actual visibility
// (covered by another window / minimized / off-screen), not keyboard focus.
// So: run each AI session in its own dedicated window instead of a pinned
// background tab in the user's window.
//
// Caveat (unverified without live testing on your actual screen layout):
// this only avoids throttling if that window doesn't end up genuinely
// covered by your main browser window — e.g. it's more likely to work with
// a non-maximized browser, and less guaranteed if your browser fills the
// whole screen. `chrome.windows.create` also refuses windows positioned
// mostly off-screen (a wall discovered in the v6.1 attempt), so this window
// stays fully on-screen at a modest size rather than tucked out of sight —
// a real, visible (if unobtrusive) second window, not an invisible one.
const SESSION_WINDOW_SIZE = { width: 1000, height: 780 };

// chrome.windows.create resolves with the Window, but `tabs` is only
// populated on success and can come back empty if the window was torn down
// immediately. Reading `win.tabs[0]` blind throws an opaque TypeError that
// surfaced to the user as a generic "Automation failed" with no clue why.
async function createSessionWindow(url) {
  const win = await chrome.windows.create({
    url,
    focused: false,
    type: "normal",
    ...SESSION_WINDOW_SIZE,
  });
  const tab = win?.tabs?.[0];
  if (!tab?.id) {
    throw new Error(
      "Chrome did not return a usable tab for the AI session window. " +
        "Check that pop-up windows aren't being blocked, then try again."
    );
  }
  return tab;
}

function isConversationUrl(cfg, url) {
  if (!url) return false;
  if (cfg.conversationUrlPattern) return cfg.conversationUrlPattern.test(url);
  // No pattern configured — fall back to "at least not the composer".
  return url.startsWith(cfg.hostPattern) && url !== cfg.baseUrl;
}

// chrome.tabs.query takes a MATCH PATTERN, which may not contain a query
// string or fragment — passing a raw saved URL like
// ".../search/foo?bar=1" throws "Invalid url pattern" and took the whole
// pipeline down with it. Build a legal pattern from origin + path only.
function toMatchPattern(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}*`;
  } catch {
    return null;
  }
}

async function findTabByUrl(url) {
  const pattern = toMatchPattern(url);
  if (!pattern) return null;
  try {
    const tabs = await chrome.tabs.query({ url: pattern });
    return tabs[0] || null;
  } catch {
    return null;
  }
}

// Persist the conversation this run ended up in, so every later run continues
// inside that same chat instead of spawning a new one.
//
// The previous version saved any URL under the provider's host — including
// the new-chat composer itself (e.g. "https://chatgpt.com/"). That poisoned
// the stored session: the next run "reused" a URL that is really just the
// composer, sent there, and created yet another chat — the endless pile of
// one-message conversations. Now only a URL matching the provider's
// conversation pattern is ever written, and a bad value never overwrites a
// good one.
//
// The URL is also polled for a few seconds: these SPAs rewrite it via
// history.pushState shortly AFTER the first message is accepted, so reading
// it immediately often still returns the composer URL.
async function persistSessionUrl(cfg, tabId) {
  const readUrl = async () => {
    try {
      return (await chrome.tabs.get(tabId)).url;
    } catch {
      return null; // tab closed — keep whatever was stored before
    }
  };

  // Fast path: already sitting in a conversation (the normal reuse case).
  const current = await readUrl();
  if (current === null) return;
  if (isConversationUrl(cfg, current)) {
    await chrome.storage.local.set({ [cfg.sessionStorageKey]: current });
    return;
  }

  // Not a conversation URL yet. If a good one is already stored, there's
  // nothing to learn here — don't stall the caller (this also runs on the
  // failure path, where waiting would just delay the error the user sees).
  const stored = await chrome.storage.local.get(cfg.sessionStorageKey);
  if (isConversationUrl(cfg, stored[cfg.sessionStorageKey])) return;

  // Genuinely a brand-new chat: the SPA rewrites the URL via history
  // .pushState shortly after the first message is accepted, so give it a
  // few seconds to settle before giving up.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const url = await readUrl();
    if (url === null) return;
    if (isConversationUrl(cfg, url)) {
      await chrome.storage.local.set({ [cfg.sessionStorageKey]: url });
      return;
    }
  }
}

async function getOrCreateSessionTab(cfg) {
  const stored = await chrome.storage.local.get(cfg.sessionStorageKey);
  const savedUrl = stored[cfg.sessionStorageKey];

  // Only trust a stored value that is genuinely a conversation URL. Anything
  // else (a composer URL saved by an older build, or a half-finished run) is
  // discarded so we create one real chat and settle on it, rather than
  // treating the "new chat" page as if it were an ongoing conversation.
  if (savedUrl && !isConversationUrl(cfg, savedUrl)) {
    await chrome.storage.local.remove(cfg.sessionStorageKey).catch(() => {});
  }

  if (savedUrl && isConversationUrl(cfg, savedUrl)) {
    // chrome.tabs.query searches across every window, so this still finds
    // the session tab regardless of which (dedicated) window it lives in.
    const existing = await findTabByUrl(savedUrl);
    if (existing) {
      let reused = existing;
      await chrome.tabs.update(reused.id, { autoDiscardable: false }).catch(() => {});

      if (reused.discarded) {
        // Chrome unloaded this tab's renderer to save memory (even with
        // autoDiscardable:false — that only prevents FUTURE discards, it
        // doesn't undo one already in effect from a prior session). Force
        // it back to life and wait for it, otherwise the very first
        // automation attempt races a not-yet-rendered page and script
        // injection silently comes back with zero results instead of a
        // helpful error — exactly what "No response captured" looks like.
        await chrome.tabs.reload(reused.id).catch(() => {});
        await waitForTabComplete(reused.id);
        await new Promise((r) => setTimeout(r, 1000));
        reused = await chrome.tabs.get(reused.id);
      } else if (reused.status !== "complete") {
        await waitForTabComplete(reused.id);
      }

      // Make sure the window is actually visible (not minimized) — if the
      // user minimized it themselves at some point, it would silently be
      // occlusion-throttled again despite still "being open".
      await chrome.windows.update(reused.windowId, { state: "normal" }).catch(() => {});

      return { tab: reused, isNewChat: false };
    }

    // Saved conversation isn't open anywhere — reopen it in its own window.
    try {
      const tab = await createSessionWindow(savedUrl);
      await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
      await waitForTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 1000));
      const reopened = await chrome.tabs.get(tab.id);

      // Check we actually landed back IN that conversation. The old check
      // only asked "is this still on the provider's domain", which a redirect
      // to the composer (deleted chat, signed-out, etc.) also satisfies — so a
      // dead conversation silently became "reuse this" and every note went
      // into a fresh chat instead.
      if (isConversationUrl(cfg, reopened.url)) {
        return { tab: reopened, isNewChat: false };
      }

      // Conversation is gone — forget it and start a fresh one in this window.
      await chrome.storage.local.remove(cfg.sessionStorageKey).catch(() => {});
      await chrome.tabs.update(tab.id, { url: cfg.baseUrl });
      await waitForTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 1000));
      return { tab: await chrome.tabs.get(tab.id), isNewChat: true };
    } catch {
      /* fall through */
    }
  }

  const tab = await createSessionWindow(cfg.baseUrl);
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  await waitForTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 1000));
  return { tab, isNewChat: true };
}

// Chromium ignores execCommand()/native selection APIs in a window that has
// never genuinely held OS focus — this is what leaves Gemini/ChatGPT's Send
// button permanently aria-disabled otherwise. Flash real OS focus onto the
// AI session's window just long enough to fill the input and click Send,
// then immediately restore focus to whatever window/tab the user was
// actually on. `func` runs while the AI window is focused; automation keeps
// running afterwards regardless of which window has focus — and, per the
// v6.5 change above, should now keep rendering/painting normally too, since
// it remains a visible, non-occluded, non-minimized window even once focus
// moves away (unlike a plain background tab, which Chromium always treats
// as hidden the instant it isn't the selected tab of its window).
async function withBriefTabFocus(tab, func) {
  const [previousActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const previousWindowId = previousActiveTab?.windowId;

  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  const resultPromise = func();

  // Slightly above the originally-verified 700ms: the added send-verification
  // retry (see automateChatInPage) can need a second round-trip of synthetic
  // events before the framework's input state registers, and holding focus
  // that whole time is cheap insurance against re-locking execCommand/
  // selection APIs mid-retry. Still comfortably under the documented <1s
  // flicker trade-off.
  await new Promise((r) => setTimeout(r, 900));

  if (previousWindowId && previousWindowId !== tab.windowId) {
    await chrome.windows.update(previousWindowId, { focused: true }).catch(() => {});
  }
  if (previousActiveTab?.id) {
    await chrome.tabs.update(previousActiveTab.id, { active: true }).catch(() => {});
  }

  return resultPromise;
}

// Runs automateChatInPage in the session tab, retrying once if the page
// navigated out from under the injected script.
//
// "Frame with ID 0 was removed" / "No frame with id 0" is what Chrome throws
// when the target frame is torn down mid-injection — which is exactly what a
// provider does on a *brand-new* chat when it swaps the composer route for
// the real conversation route. The script dies with it and the run is lost.
// Retrying after the navigation settles lands in the (now stable)
// conversation, so a first-run send no longer gets thrown away.
async function runAutomation(cfg, tab, promptText) {
  const attempt = async () =>
    withBriefTabFocus(tab, async () => {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: automateChatInPage,
        args: [cfg, promptText],
      });
      if (!res.length) {
        throw new Error("The tab reloaded or closed mid-automation — please try again.");
      }
      return res[0]?.result;
    });

  try {
    return await attempt();
  } catch (err) {
    const navigatedAway = /frame with id|frame was removed|no frame|reloaded or closed/i.test(
      err?.message || ""
    );
    if (!navigatedAway) throw err;

    await waitForTabComplete(tab.id).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    // If that navigation was the provider creating the conversation, the
    // prompt already went through — don't send it a second time.
    const settledUrl = await chrome.tabs.get(tab.id).then((t) => t.url).catch(() => null);
    if (isConversationUrl(cfg, settledUrl)) {
      const recovered = await chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: scrapeLatestResponse,
          args: [cfg],
        })
        .then((r) => r[0]?.result)
        .catch(() => null);
      if (recovered) return recovered;
    }

    return attempt();
  }
}

// Read the newest assistant message already present in the page, without
// sending anything. Used to recover a response whose automation run was
// killed by a mid-flight navigation.
function scrapeLatestResponse(cfg) {
  return (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    function readText(el) {
      if (!el) return "";
      const rendered = el.innerText;
      if (rendered && rendered.trim().length > 0) return rendered.trim();
      return (el.textContent || "").trim();
    }
    function latest() {
      for (const sel of cfg.responseSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length) return els[els.length - 1];
      }
      return null;
    }
    function stopping() {
      return cfg.stopSelectors.some((s) => document.querySelector(s));
    }

    const deadline = Date.now() + 120_000;
    let lastText = "";
    let stable = 0;
    while (Date.now() < deadline) {
      const text = readText(latest());
      if (text && !stopping()) {
        if (text === lastText) {
          if (++stable >= 3) return text;
        } else {
          stable = 0;
        }
      }
      lastText = text;
      await sleep(500);
    }
    return lastText;
  })();
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
    result = await runAutomation(cfg, tab, promptText);

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
    // Remember the conversation we ended up in, so the next note/message
    // continues inside it instead of opening yet another chat.
    await persistSessionUrl(cfg, tab.id).catch(() => {});
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
    result = await runAutomation(cfg, tab, formattedPrompt);

    if (isNewChat) {
      await chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          // Notes and the Chat Hub deliberately share one conversation per
          // provider, so they share one title too.
          func: tryRenameConversation,
          args: [cfg, SESSION_CHAT_TITLE],
        })
        .catch(() => {});
    }
  } catch (err) {
    throw new Error(`Chat failed on ${cfg.label}: ${err.message}`);
  } finally {
    // Remember the conversation we ended up in, so the next note/message
    // continues inside it instead of opening yet another chat.
    await persistSessionUrl(cfg, tab.id).catch(() => {});
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

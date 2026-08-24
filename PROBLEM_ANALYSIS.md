# NoteFlow AI — Technical Problem Analysis & Architecture Report

> **Document Target:** Comprehensive bug analysis and architectural specification for resolving background session automation and tab freezing in **NoteFlow AI (Chrome Extension Manifest V3)**.

---

## 1. Executive Summary & Problem Statement

### 🎯 The Goal
NoteFlow AI allows users to browse any webpage, click **"Capture Page Notes"**, and generate structured study notes (Topic Title, Summary, Key Takeaways, Code Snippets) using their **already logged-in web AI sessions** (Gemini Web, ChatGPT Web, Claude Web, Perplexity, DeepSeek) **without requiring paid API keys**.

### ❌ The Bug
1. When the user clicks **"Capture Page Notes"** from the popup or context menu:
   - `content.js` scrapes the page text and sends it to `background.js`.
   - `background.js` opens/focuses `viewer.html` (the user's Notes Dashboard), rendering a shimmering skeleton loading card (*"Synthesizing Notes with Gemini..."*).
   - `background.js` opens/reuses the AI web session tab (`https://gemini.google.com/app` or `https://chatgpt.com/`) in the background (`active: false, pinned: true`).
2. **The Stall / Freeze:**
   - As long as the user stays on `viewer.html`, the background AI tab stays idle or frozen. The prompt is either not submitted, or the Angular/React component in the AI tab pauses token streaming because the tab is in the background (`document.hidden = true`).
3. **The User Observation:**
   - The moment the user clicks on the background AI tab in Chrome's tab strip (e.g. clicks the **"Ask Gemini"** tab):
     - The AI tab immediately wakes up.
     - The prompt submits, and the AI streams its answer in 1-2 seconds.
     - When the user switches back to `viewer.html`, the note card is instantly populated.
4. **Constraint:**
   - The user **does not want visible tab jumps, screen flickering, or page switching** (e.g. activating the AI tab and switching back is visually unacceptable). The process must run **100% silently in the background** while the user remains on `viewer.html`.

---

## 2. Deep Technical Root Cause Analysis

### A. Chromium Background Tab Throttling (Budget Throttling)
Modern Chromium engines aggressively throttle background tabs (`active: false`):
1. **Timer Throttling:** `setTimeout` and `setInterval` are throttled to 1 execution per second (or 1 per minute on occluded tabs).
2. **Rendering Suspension:** `requestAnimationFrame`, CSS transitions, and DOM rendering are halted entirely until the tab is made active.
3. **WebSocket / Stream Pausing:** React and Angular web clients on `chatgpt.com` and `gemini.google.com` use internal listeners on `document.visibilityState` / `window.onblur`. When the tab is in the background, they pause or delay rendering responses to save memory and battery.

### B. Angular (Quill) and React (Slate) Input & Selection Binding
1. **Gemini Web (`gemini.google.com`):**
   - Uses `<rich-textarea>` wrapping `<div class="ql-editor" contenteditable="true">` (Quill.js inside Angular/Lit).
   - In Chromium, `document.execCommand("insertText")` and native selection ranges (`window.getSelection().addRange()`) are **deactivated or ignored** if the tab has never received OS/window focus.
   - Setting `input.innerHTML` or `input.textContent` without active Angular event dispatching does not update Angular's `NgModel` / `FormControl` state.
   - Because the internal model thinks the input is still empty, the **Send button** (`button.send-button` / `button[aria-label='Send message']`) **remains disabled (`aria-disabled="true"`)**, so synthetic clicks fail silently until the user activates the tab.
2. **ChatGPT Web (`chatgpt.com`):**
   - Uses a contenteditable or textarea `#prompt-textarea` controlled by React state.
   - If the React input event chain (`InputEvent` with `inputType: "insertText"`, `composed: true`, `bubbles: true`) is not synchronized, the send button (`button[data-testid="send-button"]`) remains disabled.

---

## 3. Codebase Map & File References

| File | Role |
| :--- | :--- |
| [`manifest.json`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/manifest.json) | Manifest V3 permissions: `activeTab`, `scripting`, `storage`, `tabs`, `cookies`, `declarativeNetRequest`. Host permissions for all 5 AI domains. |
| [`background.js`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/background.js) | Service worker pipeline. Controls `runPipeline()`, `openOrFocusViewer()`, `insertSkeletonNote()`, `finaliseNote()`, `SEND_CHAT_MESSAGE`. |
| [`services/webSessionBridge.js`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/services/webSessionBridge.js) | Tab management (`getOrCreateSessionTab`), content script injection (`automateChatInPage`), unthrottled `MessageChannel` loop, DOM selectors for all 5 AI engines. |
| [`rules.json`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/rules.json) | `declarativeNetRequest` header rules removing `x-frame-options`, `content-security-policy`, and `frame-ancestors`. |
| [`viewer.html`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/viewer.html) | Main Dashboard UI with **Study Notes Stream** and **Multi-AI Chat Hub**. |
| [`viewer.css`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/viewer.css) | Clean, high-contrast Light Theme design system, animated NoteFlow logo loading hero, code blocks, flashcard modal. |
| [`viewer.js`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/viewer.js) | Dashboard client logic: search, filter chips, pin/unpin, delete with undo, flashcard study mode, multi-model chat with cross-model context handoff. |
| [`popup.html`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/popup.html) / [`popup.js`](file:///d:/Projects/Ashwani_Space/Trial_Services/chrome_extensions/NoteFlow-AI/popup.js) | Extension popup with AI session detection, topic hint, and "Capture Page Notes" trigger. |

---

## 4. Selector Matrix for AI Providers

### Gemini Web (`https://gemini.google.com/app`)
- **Input:** `rich-textarea .ql-editor`, `div.ql-editor[contenteditable='true']`, `rich-textarea div[contenteditable='true']`
- **Send Button:** `button.send-button`, `button[aria-label='Send message']`, `button[aria-label*='Send' i]`, `button.send-button-container button`
- **Stop Button:** `button[aria-label='Stop response']`, `button[aria-label*='Stop' i]`, `.stop-button`
- **Response Bubbles:** `message-content .markdown`, `.model-response-text .markdown`, `message-content`, `model-response`

### ChatGPT Web (`https://chatgpt.com/`)
- **Input:** `#prompt-textarea`, `div[contenteditable='true'][id='prompt-textarea']`, `textarea[data-id='root']`
- **Send Button:** `button[data-testid='send-button']`, `button[aria-label='Send prompt']`, `button[aria-label='Submit']`
- **Stop Button:** `button[data-testid='stop-button']`, `button[aria-label='Stop generating']`
- **Response Bubbles:** `[data-message-author-role='assistant'] .markdown.prose`, `[data-message-author-role='assistant'] .prose`, `.group\/conversation-turn .agent-turn`

### Claude Web (`https://claude.ai/new`)
- **Input:** `div[contenteditable='true'].ProseMirror`, `div[contenteditable='true'][data-placeholder]`
- **Send Button:** `button[aria-label='Send Message']`, `button[data-testid='send-button']`
- **Response Bubbles:** `.font-claude-message`, `[data-is-streaming] .prose`, `.prose`

---

## 5. What Was Attempted & Current Status

1. **`document.visibilityState` / `hidden` Spoofing:**
   - Overrode `document.visibilityState = 'visible'`, `document.hidden = false`, and `document.hasFocus = () => true` inside the tab.
   - *Result:* Partially helps streaming, but does not solve Quill/Angular input disabling when the tab has never received native window focus.
2. **`MessageChannel` Microtask Loop:**
   - Bypasses `setTimeout` background throttling by using recursive `channel.port2.postMessage()` ticks.
   - *Result:* Checks the DOM at 300ms intervals smoothly once generation has started.
3. **Tab Focus Handshake (`chrome.tabs.update(tab.id, { active: true })`):**
   - Activated the AI tab for 150ms to dispatch events, then returned focus to `viewer.html`.
   - *Result:* Prompts sent 100% reliably, but **caused visible tab jumping/flickering**, which the user explicitly rejected.
4. **Iframe Header Stripping (`rules.json`):**
   - Added `declarativeNetRequest` rules to strip `x-frame-options` and `content-security-policy` headers.

---

## 6. Recommended Architectures to Resolve the Issue

### Solution Option 1: Off-Screen Window (Hidden OS Window)
Instead of opening a background tab in the user's active browser window (which Chromium aggressively throttles), create a small **detached background window positioned off-screen**:
```javascript
const offscreenWindow = await chrome.windows.create({
  url: cfg.baseUrl,
  type: "popup",
  focused: false,
  left: -9999,
  top: -9999,
  width: 800,
  height: 600
});
```
* **Why it works:** Because it is in its own window (even if off-screen or minimized), Chromium does NOT apply occluded background-tab throttling in the same way, native selection/focus events fire, and the user NEVER sees a tab in their main browser tab strip!

### Solution Option 2: Direct Web Session Internal API Fetch
Instead of automating the heavy React/Angular web UI via DOM clicking:
Extract the session cookies via `chrome.cookies.getAll({ domain: "google.com" })` or `chrome.cookies.getAll({ domain: "chatgpt.com" })` and call the web app's internal REST/Streaming endpoint directly from `background.js` or `content.js`:
- **Gemini:** `POST https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`
- **ChatGPT:** `POST https://chatgpt.com/backend-anon/conversation` or `POST https://chatgpt.com/backend-api/conversation`
* **Why it works:** Zero DOM automation, zero tabs, instant responses in <1.5 seconds directly inside the service worker.

### Solution Option 3: Chrome Offscreen Document API (`chrome.offscreen`)
Manifest V3 provides `chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["DOM_SCRAPING", "WORKERS"], justification: "Run silent AI web automation" })`.
- Inside `offscreen.html`, load the session iframe or perform DOM operations with full window privileges without affecting the user's active tabs.

---

## 7. Current Verification Checklist

- [ ] Extension loads in Chrome without manifest errors (`chrome://extensions`).
- [ ] User clicks "Capture Page Notes" -> `viewer.html` opens with shimmering NoteFlow logo animation.
- [ ] AI prompt is dispatched without switching the active tab or flickering the screen.
- [ ] Notes complete and replace the skeleton card within 3-5 seconds.
- [ ] Multi-AI Chat Hub allows interactive messaging with Cross-Model Context Handoff.

---

## 8. Resolution Implemented (v6.0.0) — In-Tab Hidden Iframe Host

The stall was caused by automating a **separate background browser tab**
(`active: false, pinned: true`). Chromium occlusion-throttles a tab like that
the moment it isn't the foreground tab of its window — timers slow to
~1/sec, rendering suspends, and Angular/React SPAs pause their own input
binding on `document.hidden`. The "spoof `document.hidden`" and
`MessageChannel` tricks (Section 5) only ever papered over this; the send
button stayed `aria-disabled` until the user physically clicked into that
tab, which is exactly the visible tab-jump the user rejected.

**Fix:** stop creating a second tab entirely. The AI provider now loads in a
hidden `<iframe class="ai-session-frame">` that lives **inside `viewer.html`
itself** (see `viewer.js` → `ensureAiFrame()` / `#aiSessionHost`, styled in
`viewer.css`). Because that iframe's parent tab is the dashboard tab the
user is actively looking at, it is never occluded and never throttled —
no spoofing needed.

- `background.js` → `openOrFocusViewer()` now waits for the dashboard tab to
  fully load, then passes its `tabId` down through the pipeline.
- `services/webSessionBridge.js` → `getOrCreateSessionFrame()` messages
  `viewer.js` (`ENSURE_AI_FRAME`) to create/reuse that hidden iframe instead
  of `chrome.tabs.create()`. `automateChatInPage()` is unchanged in logic but
  is now injected with `allFrames: true` into every frame of the dashboard
  tab; a hostname guard at the top makes it a no-op everywhere except the one
  iframe that actually matches the requested AI provider.
- The existing shimmer skeleton card (Study Notes) and the "Synthesizing…"
  spinner row (Chat Hub) are the loading overlay the user asked for — they
  already fully hide the raw chat UI and vanish automatically the instant
  `chrome.storage.local` is updated with the finished note/response, since
  both views are driven by `chrome.storage.onChanged`.
- `rules.json`'s header-stripping rules (Section 5, item 4) — previously
  unused — are now load-bearing: they're what allow the AI sites to be
  framed at all.

**Trade-off:** this still assumes the dashboard tab stays the active/focused
tab while generating (same assumption the original design already made —
`openOrFocusViewer()` force-focuses it). If the user switches away to a
different tab mid-generation, the dashboard tab itself would now be the one
subject to occlusion throttling. Solving that fully would require the
off-screen-window approach (Section 6, Option 1), which was not implemented
here since it wasn't what was requested and needs live-session testing this
environment can't perform.


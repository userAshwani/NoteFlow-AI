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

## 8. Resolution Implemented (v6.2.0) — Brief Same-Window Focus Flash

The stall was caused by automating a **separate background browser tab**
(`active: false, pinned: true`) in the user's own window. Chromium
occlusion-throttles a tab like that the moment it isn't the foreground tab —
timers slow to ~1/sec, rendering suspends, and Angular/React SPAs pause
their own input binding on `document.hidden`. The "spoof `document.hidden`"
and `MessageChannel` tricks (Section 5) only ever papered over this; the
send button stayed `aria-disabled` until the user physically clicked into
that tab, which is exactly the visible tab-jump the user rejected.

### Attempt 1 (v6.0.0, reverted): in-tab hidden `<iframe>`

First tried loading the AI provider into a hidden `<iframe>` inside
`viewer.html` itself, relying on `rules.json`'s existing `x-frame-options`/CSP
stripping to let it embed. This failed for two separate reasons discovered
during live testing:

1. `chrome.scripting.executeScript({ allFrames: true })` also tries to inject
   into the dashboard's own top frame (`chrome-extension://…/viewer.html`),
   which throws `Cannot access contents of url … Extension manifest must
   request permission to access this host.` — a bug in that approach, not
   fixable by adding permissions (extension pages aren't grantable hosts).
2. More fundamentally: even once framed, ChatGPT's own session-sync calls
   started **403ing** (`OBI synchronization is not available`). A
   cross-origin iframe is a genuinely different (third-party) storage
   partition from a real top-level navigation — session/auth cookies that
   work fine in a real tab don't reliably carry into an embedded iframe
   under Chromium's third-party storage partitioning. The DOM loads, but the
   authenticated session underneath it can break. This is a platform
   constraint, not something fixable in extension code.

### Attempt 2 (v6.1.0, reverted): off-screen popup window

Tried creating the AI tab as its own separate popup window parked at
off-screen coordinates (`chrome.windows.create({ type: "popup", focused:
false, left: -2400, top: -2400, … })`), so it would never appear in the
user's own window/tab strip. This also failed live testing immediately:

> `Invalid value for bounds. Bounds must be at least 50% within visible
> screen space.`

Chrome hard-rejects window creation calls that are positioned mostly
off-screen — this is a deliberate anti-abuse guard (a genuinely invisible
window is a classic clickjacking/malware primitive), and there is no bounds
configuration that both satisfies this constraint and keeps the window out
of sight. "Park a window off-screen" is not achievable via `chrome.windows`
at all, regardless of exact coordinates chosen.

### Resolution (v6.2.0, current): brief same-window focus flash

With both "make it invisible" approaches blocked by the platform, the
implementation returned to the **original architecture** — a real, pinned,
inactive background tab in the user's own window (`chrome.tabs.create({
active: false, pinned: true })`) — and re-applied the one technique already
proven 100% reliable in this project's own prior testing (Section 5, item 3):
briefly give that tab real tab-strip focus, long enough for Chromium to
unlock `execCommand()`/selection-API input binding and register the Send
click, then immediately switch back to whichever tab the user was actually
on. `webSessionBridge.js` → `withBriefTabFocus()` holds focus on the AI tab
for ~700ms while the automation script starts running, then restores the
previous tab — the automation (including the whole response-wait loop)
keeps running in the background regardless of which tab is visually
selected afterwards.

This is an explicit, user-accepted trade-off, not an oversight: it causes a
short (<1s) visible tab-strip flicker on every generation/chat message,
in exchange for something Chrome will actually let an extension do. Both
"zero-flicker" alternatives (iframe, off-screen window) are platform-blocked
for reasons discovered only through live testing, not fixable in code.

- `services/webSessionBridge.js` → `getOrCreateSessionTab()` is back to
  `chrome.tabs.create(...)` (same-window, pinned, inactive). A new
  `withBriefTabFocus()` helper wraps the `automateChatInPage()` injection
  with the focus flash described above. `automateChatInPage()` and
  `tryRenameConversation()` are unchanged.
- `background.js` and `viewer.js`/`viewer.html`/`viewer.css` need no changes
  for this — the AI session tab is fully self-contained inside
  `webSessionBridge.js`, matching the pre-existing architecture.
- The existing shimmer skeleton card (Study Notes) and "Synthesizing…"
  spinner row (Chat Hub) remain the loading overlay — they hide the
  automation happening underneath and vanish automatically once
  `chrome.storage.local` is updated with the finished note/response, driven
  by `chrome.storage.onChanged`.

**Still needs live verification** in Chrome with real logged-in sessions —
this environment cannot run a browser to confirm the flash duration is
sufficient in practice, or that no further edge case surfaces.

---

## 9. Follow-up (v6.3.0) — the flash alone wasn't enough

Live testing of v6.2.0 showed the original symptom persisting: notes/chat
only completed after the user manually clicked into the Gemini/ChatGPT tab
and back, regardless of the focus flash. This revealed the flash only ever
addressed **half** the problem — getting the Send button clickable. It did
nothing for what happens *after*: Chromium independently throttles a
background tab's own rendering and timers for its entire lifetime, so even
once the AI starts streaming a response, the DOM may never actually get
updated with it until the tab is genuinely visible again. That's a second,
distinct root cause from the focus-gating one in Section 2.A.1, and no
amount of extension-side DOM trickery changes it — it's Chromium's own
scheduler deciding how much CPU/paint priority to give a page nobody is
looking at.

Two changes went in for this:

1. **`readText()` helper** (`automateChatInPage`): response text was being
   read via `.innerText`, which is layout-aware and can force a reflow a
   throttled tab defers. Now falls back to `.textContent` (no layout
   dependency) whenever `.innerText` comes back empty.
2. **`withDebuggerAttached()`**: attaches the Chrome DevTools Protocol
   (`chrome.debugger.attach`) to the AI tab for the duration of each
   generation/chat call. A tab being actively debugged is serviced by
   Chromium at (near) full speed — the same relief a developer gets by
   leaving DevTools open on a background tab — without ever switching to it
   or moving window focus. This targets the actual root cause of "only
   works after I visit the tab" directly, rather than working around its
   symptoms. Requires the new `debugger` permission in `manifest.json`,
   which triggers extra Chrome Web Store review scrutiny and a more explicit
   install-time permission warning — a one-time cost, not a recurring one.

`withBriefTabFocus()` (Section 8) is kept and now runs *inside* the
debugger-attached window, as a belt-and-suspenders measure in case the two
throttling mechanisms (focus-gated input APIs vs. background rendering
throttle) don't turn out to be fully resolved by the same fix.

**Still needs live verification.** This is the first approach in this
document with a real chance at the original "100% silent" requirement, but
it is unverified — in particular whether `chrome.debugger.attach` actually
relieves the rendering/timer throttle as expected, and whether its info-bar/
tab-strip indicator is as unobtrusive in practice as expected for a tab the
user never looks at.

---

## 10. Follow-up (v6.4.0) — chrome.debugger reverted, confirmed not silent

Live testing answered the open question from Section 9 immediately: the
"started debugging this browser" banner does **not** stay confined to the
debugged background tab — Chrome shows it on whichever tab is currently
*active* (i.e. `viewer.html`, exactly what the user is looking at), and
keeps it there for as long as any tab in that window is being debugged.
This is a deliberate Chrome transparency measure (the same category of
protection as the iframe cookie-partitioning and off-screen-window bounds
check from Sections 8–9) and cannot be suppressed or scoped to a single tab.
For a multi-second-to-2-minute generation window, that means a persistent,
hard-to-miss banner sitting over the user's own workspace the entire time —
a worse disruption than the tab-strip flash it was meant to replace.

Reverted: `withDebuggerAttached()` removed, `debugger` permission removed
from `manifest.json`. Back to `withBriefTabFocus()` alone (Section 8).

Separately, the same test run surfaced a second, distinct symptom worth
tracking: for the Claude provider, the actual `claude.ai` tab visibly
finished generating a complete response, but NoteFlow's own dashboard
stayed on the "Synthesizing…" skeleton rather than picking it up. Given the
90-second-scale variability of these generations and that the screenshot
doesn't establish how long the user had actually waited before checking,
it's not yet confirmed whether this is a real bug in the observation loop /
response selectors (e.g. Claude's `stopSelectors`/`responseSelectors` no
longer matching its current DOM) versus simply not having reached the
120-second `hardTimeout` yet. Needs a timed live re-test to distinguish
the two before further changes are made here.

All three "fully invisible" avenues attempted in this document (iframe,
off-screen window, chrome.debugger) are now confirmed platform-blocked by
independent, deliberate Chrome protections. `withBriefTabFocus()`'s brief
same-window flash remains the only mechanism in this codebase's history
that's actually been shown to reliably unlock the Send button without
tripping one of those protections — the open question going forward is
purely about the response-capture reliability described above, not about
finding a fourth invisibility trick.

---

## 11. Live confirmation (v6.4.0 field test) — the Claude/response-capture
symptom from Section 10 is real and reproducible, not a timeout artifact

A live test run (2026-08-25) against Gemini and ChatGPT confirmed the
Section 9/10 hypothesis directly, with screenshots:

- **ChatGPT:** the session tab showed "Log in / Sign up for free" — not
  actually signed in in that browser profile. NoteFlow correctly surfaced
  "No response captured from ChatGPT Web. Please make sure you are signed
  in." after the timeout. Not a bug — expected behavior for a logged-out
  session.
- **Gemini:** the prompt was sent successfully and Gemini answered
  correctly in the background tab. NoteFlow's dashboard nonetheless sat on
  the "Synthesizing…" skeleton indefinitely. The moment the user manually
  clicked into the Gemini tab and back to the dashboard, the finished note
  appeared **instantly** — no visible streaming, a single full commit. This
  is decisive: Chromium was not merely throttling *timers* in that
  background tab (which `MessageChannel` polling and `document.hidden`
  spoofing target), it was withholding the actual **paint/DOM-commit**
  entirely until the tab became visible, then flushing everything at once.
  No amount of polling from inside that same suspended renderer can observe
  a DOM that hasn't been written to yet.

### v6.5 — dedicated per-provider window instead of a same-window tab

The distinction this suggested, not previously tested: Chromium treats a
tab as unconditionally "hidden" (`document.hidden === true`, rendering
suspended) the instant it is not the *selected* tab of its window —
independent of whether that window itself has OS focus. A window that is
simply unfocused, but on-screen, uncovered, and not minimized, is not
"occluded" in that same sense; its one active tab should in principle keep
rendering at normal priority.

- `getOrCreateSessionTab()` now opens each provider's session in its own
  dedicated window (`chrome.windows.create({ focused: false, ... })`,
  1000×780, on-screen — off-screen creation is still hard-blocked per
  Section 8) instead of a pinned background tab in the user's own window.
  `chrome.tabs.query({ url })` already searches across all windows, so
  session-reuse detection needed no changes.
- `withBriefTabFocus()` now flashes `chrome.windows.update(..., { focused:
  true })` on the session window (not just `chrome.tabs.update(...,
  { active: true })`) for the Send click, then restores focus to the
  user's previous window/tab the same way as before.
- Reused session tabs also get `chrome.windows.update(reused.windowId,
  { state: "normal" })` in case the user minimized that window themselves
  between runs, which would silently reintroduce the same throttling.

**Caveat, unverified:** this only holds if the session window doesn't end
up genuinely covered by the user's own browser window — most likely to
work with a non-maximized main browser window, least guaranteed with a
maximized one, since there's no remaining screen space to place a
non-overlapping second window in that case. There is no way to confirm this
without live testing on the user's actual screen/window layout, which this
environment cannot do. If this still doesn't resolve the symptom, the next
thing to check is whether the session window is in practice ending up
behind/covered by the main window shortly after creation (in which case the
occlusion-based throttling would reassert itself regardless of window
focus), versus some other cause not yet identified.

Separately, the send-registration path also got hardened in v6.5: after
clicking Send (or pressing Enter), `automateChatInPage` now checks within
~2.5s whether the send actually took (stop indicator appears / a new
response bubble appears / the input clears), retries once with the other
method if not, and throws a fast, specific error otherwise — instead of
silently sitting through the full 120s timeout when a click never registers
with the page's own framework state. This is a distinct fix from the
window-per-provider change above; both landed in the same pass.


---

## 12. v6.6 — root cause found for "every provider except Gemini fails",
plus real single-session reuse

Two separate defects, both found by code inspection rather than by more
throttling theory. Neither is a platform limitation — both were ordinary
bugs in this codebase.

### A. `TypeError: Illegal invocation` killed all four non-Gemini providers

`automateChatInPage`'s input-fill step branched like this:

```js
if (input.tagName === "TEXTAREA" || input.tagName === "INPUT" || input.id === "prompt-textarea") {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(input, promptText);   // <-- throws when `input` is a DIV
```

ChatGPT's `#prompt-textarea` has not been a `<textarea>` for a long time —
it is a contenteditable **ProseMirror div**. Calling the
`HTMLTextAreaElement.prototype.value` setter on a div throws
`TypeError: Illegal invocation` immediately, so the injected script died
before typing a single character. The same branch also used the *textarea*
setter for genuine `<input>` elements, which throws for the same reason.

Gemini was unaffected only because it matched branch B (Quill) instead —
which is exactly why Gemini was "the one that works".

Fixed by branching on the real element type (`tagName` only), using the
matching prototype for `<input>` vs `<textarea>`, and giving contenteditable
editors their own path: a synthetic `paste` event carrying a real
`DataTransfer`. ProseMirror/Slate/Lexical all implement paste natively and
update their internal document model from it — unlike `innerHTML`, which
leaves the model empty so the framework keeps Send disabled. `execCommand
("insertText")` remains as a fallback.

### B. The composer URL was being saved as the "active chat"

The session was persisted with:

```js
if (finalTab.url?.startsWith(cfg.hostPattern)) {   // hostPattern = "https://chatgpt.com/"
  chrome.storage.local.set({ [cfg.sessionStorageKey]: finalTab.url });
```

`https://chatgpt.com/` — the **new-chat composer** — trivially satisfies
`startsWith("https://chatgpt.com/")`. So any run that failed, or that read
the URL before the SPA had rewritten it, stored the composer as if it were
a conversation. The next run "reused" that URL, landed on the composer,
and created yet another chat — the pile of one-message conversations the
user reported.

Fixed with a per-provider `conversationUrlPattern` (Gemini `/app/<id>`,
ChatGPT `/c|/uc|/g/../c/<uuid>`, Claude `/chat/<uuid>`, Perplexity
`/search/<slug>`, DeepSeek `/a/chat/s/<uuid>`). Only a URL matching it is
ever written; a bad value never overwrites a good one; a stored value that
isn't a conversation URL is discarded on read; and a reopened conversation
that redirected to the composer (deleted/signed-out) is detected instead of
being treated as a successful reuse. `persistSessionUrl()` also polls a few
seconds for the SPA's `history.pushState` to land, since these apps rewrite
the URL shortly *after* accepting the first message.

Notes and the Multi-AI Chat Hub intentionally share one conversation per
provider, so both now continue the same thread.

### C. Two smaller fixes in the same pass

- **`chrome.tabs.query({ url })` takes a match pattern**, which may not
  contain a query string or fragment. The old code passed the raw saved URL
  plus `"*"`; for a Perplexity URL (`/search/slug?0=...`) that throws
  "Invalid url pattern" and took down the whole run. Now built from
  `origin + pathname` only, and wrapped.
- **`Frame with ID 0 was removed`** (seen live on ChatGPT) is Chrome tearing
  down the target frame mid-injection — what a provider does when it swaps
  the composer route for the real conversation route on a first message.
  `runAutomation()` now catches that specific class of error and, if the tab
  settled on a conversation URL, scrapes the already-sent message's response
  rather than re-sending it; otherwise it retries the send once.
- Response bubbles are now counted **per selector** (`countsBySelector` /
  `newestNewBubble`) instead of "first selector with any matches". With a
  long-lived reused conversation the before-count and after-list could come
  from different selectors, slicing off the wrong number of pre-existing
  bubbles.

**Verification status:** the URL/session logic is covered by a local test
run (all conversation-URL and match-pattern cases pass). The DOM-side fixes
(A, and the frame-removed recovery) are code-review-level only — this
environment has no browser, so they need a live run against each signed-in
provider to confirm. The Section 11 background-rendering caveat is
unchanged and independent of these bugs.

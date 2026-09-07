# NoteFlow AI — Smart Web Summarizer

> Turn any article, tutorial, or documentation page into clean, structured
> study notes — using the AI accounts you're **already logged into**.
> No API keys. No subscriptions. No data leaving your browser.

A Chrome extension (Manifest V3) that scrapes the page you're reading, sends it
to your own signed-in Gemini / ChatGPT / Claude / Perplexity / DeepSeek web
session, and files the result into a persistent, searchable knowledge
dashboard you can export to PDF, Word, HTML, Markdown, or JSON.

**Developed by [Ashwani Tiwari](https://ashwanitiwari.com)**

---

<!-- ══════════════════════════════════════════════════════════════════════════
     SCREENSHOTS — add your images to a /screenshots folder and they'll render
     ══════════════════════════════════════════════════════════════════════════ -->

## Screenshots

### Study Notes Dashboard
<!-- ![Study Notes Dashboard](screenshots/dashboard.png) -->
_Add `screenshots/dashboard.png`_

### Multi-AI Chat Hub
<!-- ![Multi-AI Chat Hub](screenshots/chat-hub.png) -->
_Add `screenshots/chat-hub.png`_

### Extension Popup
<!-- ![Extension Popup](screenshots/popup.png) -->
_Add `screenshots/popup.png`_

### Exported Word Document
<!-- ![DOCX Export](screenshots/docx-export.png) -->
_Add `screenshots/docx-export.png`_

### Flashcard Study Mode
<!-- ![Flashcards](screenshots/flashcards.png) -->
_Add `screenshots/flashcards.png`_

---

## Features

### Capture
- **One-click capture** — read any page, click the extension, get structured notes.
- **Five AI engines** — Gemini, ChatGPT, Claude, Perplexity, DeepSeek. The popup
  auto-detects which ones you're signed into and only offers those.
- **Zero-fluff prompt** — every note comes back as a short title, a 2-sentence
  summary, 3–5 key points, and one clean code example.
- **Single reusable chat** — all captures continue inside *one* conversation per
  provider ("NoteFlow AI — Study Hub"), so your AI account doesn't fill up with
  hundreds of one-message chats.

### Organise
- **Study Stream** — chronological feed of every topic you've captured.
- **Full-text search** across titles, summaries, takeaways, code, source URLs
  and engine names (multi-word: every word must match).
- **Filters** — All / Pinned / With Code · **Sort** — newest, oldest, A–Z, pinned first.
- **Sticky table of contents**, pin/unpin, delete-with-undo.
- **Flashcard mode** — turn your takeaways into a click-through study deck.

### Export
| Format | What you get |
| :-- | :-- |
| **PDF** | Browser print dialog with a print stylesheet (app chrome stripped) |
| **Word (.docx)** | Full-colour formatted document — indigo headings, tinted summary callouts, styled bullets, dark code blocks |
| **HTML** | Self-contained page with the dashboard's styling baked in |
| **Markdown** | Clean `.md` for Obsidian / Notion / GitHub |
| **JSON** | Raw backup of every note |

- **DOCX auto-sync** — pick a `.docx` file once, and every new note is written
  into it automatically (via the File System Access API).

### Chat
- **Multi-AI Chat Hub** — talk to any connected model right inside the dashboard.
- **Cross-model context handoff** — switch from Gemini to ChatGPT mid-conversation
  and the new model gets briefed on what came before.
- **Compare mode** — ask once, get answers from several models side by side.
- **Save any reply as a note** with one click.

### Everything else
- Dark / light theme.
- Notes persist in `chrome.storage.local` across restarts — only ever cleared
  by the explicit **Clear All Notes** button.
- No API keys, no accounts, no telemetry. Nothing is sent anywhere except to
  the AI tab you were already signed into.

---

## Install (Developer Mode)

1. Clone or download this repository.
   ```bash
   git clone https://github.com/<your-username>/notesFromAi.git
   ```
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder
   (the one containing `manifest.json` — not a subfolder).
5. Pin **NoteFlow AI** to your toolbar.

> **Troubleshooting:** if Chrome says *"File path cannot be resolved / Could not
> load manifest"*, an old entry is pointing at a folder that no longer exists.
> Remove that entry and run **Load unpacked** again on the correct folder.

### Sign in to at least one AI

The extension uses your existing browser sessions, so sign in to whichever you
want to use before capturing:

| Engine | URL |
| :-- | :-- |
| Gemini | https://gemini.google.com |
| ChatGPT | https://chatgpt.com |
| Claude | https://claude.ai |
| Perplexity | https://www.perplexity.ai |
| DeepSeek | https://chat.deepseek.com |

The popup shows which sessions it detected. If an engine isn't listed, you
aren't signed into it in this Chrome profile.

---

## How to use

1. Open any article, tutorial, or docs page.
2. Click the **NoteFlow AI** icon.
3. Pick your AI engine (remembered for next time) and, optionally, a topic hint.
4. Hit **Capture Page Notes**.
5. The dashboard opens with a shimmering placeholder, then fills in with the
   finished note. It's saved automatically.

### What happens under the hood

```
content.js          scrapes readable text, headings and code from the page
      ↓
background.js       inserts a placeholder note, opens the dashboard
      ↓
webSessionBridge.js finds (or creates) your single AI conversation window,
                    types the prompt, sends it, watches for the reply
      ↓
chrome.storage      the parsed note is saved; the dashboard updates live
```

---

## Known behaviour: the focus flash

When a note is generated, the AI session window is briefly given focus (under a
second) and then focus returns to you.

This is deliberate and unavoidable. Chromium refuses to let a page's
`execCommand`/selection APIs work in a window that has never held real OS
focus, which leaves the AI's Send button permanently disabled. Three
alternatives were tried and each is blocked by a deliberate Chrome protection:

| Attempt | Why it failed |
| :-- | :-- |
| Hidden `<iframe>` | Cross-site iframe = third-party storage partition; the AI site's own session calls start returning 403 |
| Off-screen window | Chrome refuses windows positioned mostly off-screen ("bounds must be at least 50% within visible screen space") |
| `chrome.debugger` | Shows a "started debugging this browser" banner on whatever tab you're looking at |

Current design runs each AI session in its **own dedicated window**, because
Chromium suspends rendering for a background *tab* unconditionally, but not for
an unfocused window that is still visible. Full history in
[`PROBLEM_ANALYSIS.md`](PROBLEM_ANALYSIS.md).

---

## Project structure

```
manifest.json               MV3 config, permissions, DNR ruleset
background.js               Service worker — capture pipeline, message router
content.js                  Page scraper (text, headings, code blocks)
rules.json                  declarativeNetRequest header rules
services/
  webSessionBridge.js       AI session windows, DOM automation, response capture
  docxSync.js               Hand-rolled OOXML/ZIP .docx writer + File System Access sync
popup.html / .js / .css     Engine detection, capture trigger
viewer.html / .js / .css    Dashboard: notes stream, chat hub, exports, flashcards
icons/                      Toolbar icons
PROBLEM_ANALYSIS.md         Engineering log of the background-automation problem
```

---

## When a provider changes its UI

This automates real web UIs, so provider redesigns will eventually break a
selector. Everything is centralised in the `PROVIDERS` map at the top of
[`services/webSessionBridge.js`](services/webSessionBridge.js):

```js
"gemini-web": {
  conversationUrlPattern: /…/,  // what a real conversation URL looks like
  inputSelectors:  [...],       // the chat text box
  sendSelectors:   [...],       // the send button
  stopSelectors:   [...],       // the "stop generating" button
  responseSelectors: [...],     // the assistant's reply bubble
}
```

Each is a prioritised list — the bridge uses the first selector that matches,
so you can add a new one without removing the old.

---

## Privacy & security

- **No API keys, no accounts, no servers.** The extension has no backend.
- **Nothing is transmitted** anywhere except to the AI tab you were already
  signed into, exactly as if you'd pasted the text yourself.
- **All notes stay local** in `chrome.storage.local`, on your device.
- AI-generated text is HTML-escaped before rendering, so it can't inject markup
  into the dashboard.
- `<all_urls>` is requested so you can capture from any page — `content.js` is
  only ever injected into the tab you explicitly capture from, never in the
  background.

### A note on terms of service

NoteFlow AI drives the same web interface a human clicks through, from your own
logged-in session. It does not touch credentials, bypass logins or CAPTCHAs, or
hide itself from the site. That said, automating a consumer web app may fall
outside a given provider's terms of service, separate from their official
developer APIs. Use your judgement.

---

## License

MIT — see [`LICENSE`](LICENSE) if present, otherwise released as-is for
personal and educational use.

---

<p align="center">
  Built by <a href="https://ashwanitiwari.com"><b>ashwanitiwari.com</b></a>
</p>

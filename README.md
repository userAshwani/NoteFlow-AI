<div align="center">

<img src="icons/icon128.png" alt="NoteFlow AI logo" width="88" />

# NoteFlow AI — Smart Web Summarizer

### Turn any webpage into structured study notes using the AI you're already logged into.

**No API keys · No subscriptions · No servers · 100% local storage**

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Version](https://img.shields.io/badge/version-6.6.0-2563eb)](https://github.com/userAshwani/NoteFlow-AI/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-4f46e5)](LICENSE)
[![No API Key Required](https://img.shields.io/badge/API%20key-not%20required-059669)](#-why-noteflow-ai)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-7c3aed)](https://github.com/userAshwani/NoteFlow-AI/pulls)

**Gemini · ChatGPT · Claude · Perplexity · DeepSeek**

[Install](#-installation) · [Features](#-features) · [How it works](#-how-it-works) · [FAQ](#-faq) · [Troubleshooting](#-troubleshooting)

</div>

---

**NoteFlow AI** is a free, open-source **Chrome extension (Manifest V3)** that reads the
article, tutorial, or documentation page you're on, sends it to your **own already-signed-in
AI web session** (Gemini, ChatGPT, Claude, Perplexity, or DeepSeek), and files the result
into a persistent, searchable **study notes dashboard** you can export to **PDF, Word (.docx),
HTML, Markdown, or JSON**.

Because it drives the AI accounts you already have open in your browser, there is **no API key
to buy, no token cost, and no backend** — your page content never touches a third-party server.

> Built by **[Ashwani Tiwari](https://ashwanitiwari.com)** · [ashwanitiwari.com](https://ashwanitiwari.com)

---

## 📸 Screenshots

> **Add your images to a `screenshots/` folder using the filenames below and they'll appear here.**

### Study Notes Dashboard
![NoteFlow AI study notes dashboard showing AI-generated summaries, key takeaways and code blocks](screenshots/dashboard.png)

### Multi-AI Chat Hub
![NoteFlow AI Multi-AI Chat Hub with Gemini, ChatGPT, Claude, Perplexity and DeepSeek](screenshots/chat-hub.png)

### Extension Popup
![NoteFlow AI Chrome extension popup with AI engine detection and capture button](screenshots/popup.png)

### Exported Word Document
![Colour-formatted Word document exported from NoteFlow AI study notes](screenshots/docx-export.png)

### Flashcard Study Mode
![NoteFlow AI flashcard study mode built from note takeaways](screenshots/flashcards.png)

---

## ⭐ Why NoteFlow AI?

| | NoteFlow AI | Typical AI summarizer extensions |
| :-- | :-- | :-- |
| **Cost** | Free — uses your existing AI logins | Monthly subscription or your own paid API key |
| **API key** | Not required | Usually required |
| **Where your data goes** | Only to the AI tab you're already signed into | Through a third-party server |
| **Note storage** | Permanent, local, searchable dashboard | Usually a one-off popup summary |
| **Export** | PDF · DOCX · HTML · Markdown · JSON | Copy-paste, if that |
| **AI engines** | 5, switchable, with cross-model context | Usually 1, locked in |
| **Chat history** | One reusable conversation per engine | Clutters your account with new chats |
| **Open source** | Yes, MIT | Rarely |

---

## ✨ Features

### 🎯 Capture
- **One-click capture** — read any page, click the extension, get clean structured notes.
- **5 AI engines** — Gemini, ChatGPT, Claude, Perplexity, DeepSeek. The popup auto-detects
  which sessions you're signed into and only offers those.
- **Zero-fluff output** — every note is a short title, a 2-sentence summary, 3–5 key points,
  and one clean code example. No "Certainly! Here's a summary…" padding.
- **One reusable chat per engine** — all captures continue inside a single
  *"NoteFlow AI — Study Hub"* conversation, so your AI account doesn't fill up with hundreds
  of throwaway one-message chats.
- **Smart page scraping** — pulls readable text, headings, and code blocks; skips nav, ads,
  cookie banners, and boilerplate.

### 🗂️ Organise
- **Study Stream** — a chronological feed of every topic you've captured.
- **Full-text search** across titles, summaries, takeaways, code, source URLs, and engine
  names. Multi-word queries require every word to match.
- **Filters** — All · Pinned · With Code   |   **Sort** — Newest · Oldest · A–Z · Pinned first
- **Sticky table of contents**, pin/unpin, and delete with undo.
- **Flashcard mode** — turn your key takeaways into a click-through revision deck.

### 📤 Export
| Format | What you get |
| :-- | :-- |
| **PDF** | Browser print dialog with a dedicated print stylesheet (app chrome stripped, no page-break-split cards) |
| **Word `.docx`** | Full-colour formatted document — indigo headings, tinted summary callouts, styled bullets, dark code blocks |
| **HTML** | Self-contained page with the dashboard styling baked in |
| **Markdown** | Clean `.md` for Obsidian, Notion, or GitHub |
| **JSON** | Complete raw backup of every note |

- **DOCX auto-sync** — pick a `.docx` file on your computer once, and every new note is
  written into it automatically (via the File System Access API). No repeated save prompts.

### 💬 Multi-AI Chat Hub
- Chat with any connected model **inside the dashboard**, without switching tabs.
- **Cross-model context handoff** — switch from Gemini to ChatGPT mid-conversation and the new
  model is automatically briefed on what came before.
- **Compare mode** — ask once, get answers from several models side by side.
- **Save any reply as a note** with one click.

### 🔒 Everything else
- Dark / light theme.
- Notes persist in `chrome.storage.local` across browser restarts — cleared **only** by the
  explicit *Clear All Notes* button.
- No accounts, no telemetry, no analytics, no backend.

---

## 🚀 Installation

NoteFlow AI is not on the Chrome Web Store yet — install it in Developer Mode:

```bash
git clone https://github.com/userAshwani/NoteFlow-AI.git
```

1. Open `chrome://extensions` in Chrome (or any Chromium browser — Edge, Brave, Opera).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the cloned project folder — the one **containing `manifest.json`**, not a subfolder.
5. Pin **NoteFlow AI** to your toolbar.

### Sign in to at least one AI

NoteFlow AI uses the browser sessions you already have. Sign in to whichever engine you want
to use **before** capturing:

| Engine | Sign in at |
| :-- | :-- |
| Google Gemini | https://gemini.google.com |
| OpenAI ChatGPT | https://chatgpt.com |
| Anthropic Claude | https://claude.ai |
| Perplexity AI | https://www.perplexity.ai |
| DeepSeek | https://chat.deepseek.com |

The popup lists the sessions it detected. If an engine isn't shown, you aren't signed into it
in this Chrome profile.

---

## 📖 How to use

1. Open any article, tutorial, blog post, or documentation page.
2. Click the **NoteFlow AI** toolbar icon.
3. Choose your AI engine (remembered for next time) and optionally type a topic hint.
4. Hit **Capture Page Notes**.
5. The dashboard opens with a loading placeholder, then fills in with the finished note —
   saved automatically.

---

## ⚙️ How it works

```
content.js            scrapes readable text, headings and code from the active page
        ↓
background.js         inserts a placeholder note, opens the dashboard
        ↓
webSessionBridge.js   finds (or creates) your single AI conversation window,
                      types the prompt, sends it, watches for the reply
        ↓
chrome.storage.local  the parsed note is saved; the dashboard updates live
```

### Project structure

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

## ⚡ Known behaviour: the focus flash

When a note is generated, the AI session window is briefly given focus (well under a second)
before focus returns to you.

This is deliberate and, as far as we can tell, unavoidable. Chromium refuses to let a page's
`execCommand`/selection APIs work in a window that has never held real OS focus — which leaves
the AI's Send button permanently disabled. Three alternatives were tried, and each is blocked
by a deliberate Chrome protection:

| Attempt | Why it failed |
| :-- | :-- |
| Hidden `<iframe>` | A cross-site iframe is a third-party storage partition — the AI site's own session calls start returning `403` |
| Off-screen window | Chrome refuses windows positioned mostly off-screen (*"bounds must be at least 50% within visible screen space"*) |
| `chrome.debugger` | Shows a *"started debugging this browser"* banner on whatever tab you're actually looking at |

Each AI session therefore runs in its **own dedicated window**: Chromium unconditionally
suspends rendering for a background *tab*, but not for an unfocused *window* that's still
visible. The full engineering log is in **[`PROBLEM_ANALYSIS.md`](PROBLEM_ANALYSIS.md)**.

---

## 🔧 Troubleshooting

<details>
<summary><b>"File path cannot be resolved / Could not load manifest"</b></summary>

An old `chrome://extensions` entry is pointing at a folder that no longer exists. Remove that
entry entirely, then run **Load unpacked** again on the correct folder — the one containing
`manifest.json`.
</details>

<details>
<summary><b>"No response captured from [engine]"</b></summary>

You're most likely not signed into that engine in this Chrome profile. Open the engine's site,
confirm you're logged in (not on a "Log in / Sign up" screen), then capture again.
</details>

<details>
<summary><b>Notes stall on "Synthesizing…" forever</b></summary>

Check that the AI session window isn't **minimised** or fully **covered** by another window —
Chromium throttles rendering for hidden windows, so the reply may never get painted for the
extension to read. Keeping it visible (even unfocused, in a corner) resolves it.
</details>

<details>
<summary><b>A provider changed its UI and capture broke</b></summary>

This automates real web UIs, so redesigns eventually break a selector. Everything is
centralised in the `PROVIDERS` map at the top of
[`services/webSessionBridge.js`](services/webSessionBridge.js):

```js
"gemini-web": {
  conversationUrlPattern: /…/,  // what a real conversation URL looks like
  inputSelectors:    [...],     // the chat text box
  sendSelectors:     [...],     // the send button
  stopSelectors:     [...],     // the "stop generating" button
  responseSelectors: [...],     // the assistant's reply bubble
}
```

Each is a **prioritised list** — the bridge uses the first selector that matches, so you can
add a new one without removing the old. PRs with updated selectors are very welcome.
</details>

---

## ❓ FAQ

<details>
<summary><b>Do I need an OpenAI / Gemini API key?</b></summary>

No. That's the entire point. NoteFlow AI uses the web sessions you're already signed into, so
there's nothing to buy and no per-token cost.
</details>

<details>
<summary><b>Is my browsing data sent anywhere?</b></summary>

No. There is no backend and no telemetry. Page content goes only to the AI tab you were
already signed into — exactly as if you had pasted it in yourself. Notes are stored locally in
`chrome.storage.local`.
</details>

<details>
<summary><b>Will this clutter my ChatGPT / Gemini account with chats?</b></summary>

No. All captures continue inside a **single reusable conversation per engine**. The extension
remembers that conversation's URL and returns to it every time.
</details>

<details>
<summary><b>Does it work in Edge, Brave, or Opera?</b></summary>

It should — they're all Chromium-based and support Manifest V3. Only Chrome is regularly
tested.
</details>

<details>
<summary><b>Is automating the AI web UI against their terms of service?</b></summary>

NoteFlow AI drives the same interface a human clicks through, from your own logged-in session.
It does not touch credentials, bypass logins or CAPTCHAs, or hide itself from the site. That
said, automating a consumer web app may fall outside a given provider's terms of service,
separately from their official developer APIs. Use your judgement.
</details>

<details>
<summary><b>Can I get my notes out if I stop using it?</b></summary>

Yes — export to JSON for a complete raw backup, or Markdown/DOCX/HTML/PDF for readable copies.
Nothing is locked in.
</details>

---

## 🔐 Privacy & security

- **No API keys, no accounts, no servers.** The extension has no backend.
- **Nothing is transmitted** anywhere except to the AI tab you were already signed into.
- **All notes stay local** in `chrome.storage.local`, on your device.
- AI-generated text is HTML-escaped before rendering, so it cannot inject markup into the
  dashboard.
- `<all_urls>` is requested so you can capture from any page. `content.js` is injected **only**
  into the tab you explicitly capture from — never in the background.

---

## 🤝 Contributing

Issues and pull requests are welcome — especially **updated provider selectors** when Gemini,
ChatGPT, Claude, Perplexity, or DeepSeek change their UI.

1. Fork the repo
2. Create a branch (`git checkout -b fix/gemini-selectors`)
3. Commit your changes
4. Open a pull request

---

## 📄 License

MIT — free for personal, educational, and commercial use. See [`LICENSE`](LICENSE).

---

<div align="center">

**If NoteFlow AI saves you time, consider giving it a ⭐**

Built by **[ashwanitiwari.com](https://ashwanitiwari.com)**

<sub>
chrome extension · ai summarizer · study notes · webpage summarizer · manifest v3 ·
gemini · chatgpt · claude · perplexity · deepseek · note taking · productivity ·
no api key · web scraping · docx export · pdf export · flashcards
</sub>

</div>

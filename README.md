# Ashwani Tiwari | Notes From AI — Chrome Extension

Extracts content from the active webpage and summarizes it into laser-focused
study notes by driving your own **already-logged-in** Gemini Web or ChatGPT
Web session — no API keys, no OAuth, no external service. All notes flow
into one reusable AI chat thread and a built-in **Notes Dashboard** tab.

## ⚠️ Read this before using

This automates the Gemini/ChatGPT **consumer web UI** (not their official
APIs) from a tab you're signed into:

- **Brittle by nature.** `services/webSessionBridge.js` locates the chat
  input, send button, response bubble, and (best-effort) conversation title
  via CSS selectors in the `PROVIDERS` config at the top of that file.
  Google and OpenAI change their web app's DOM without notice — when they
  do, this breaks silently or times out. That config is the first place to
  check and update.
- **Terms of service.** This scripts the same UI a human would click
  through, from your own logged-in tab — it does not touch credentials,
  bypass logins/CAPTCHAs, or hide the automation from the site. It may
  still fall outside a given provider's terms for automated use of their
  consumer web app, separate from their official developer APIs. That
  trade-off is yours to make.
- **Timing.** Each run polls for up to ~2 minutes for the reply to finish
  streaming. Slow connections or long pages may hit that ceiling.

## What's new in this version

1. **Single reusable chat session.** Instead of resetting the conversation
   on every scan, the extension now keeps one ongoing chat per provider —
   "AI Study Notes Hub" — and reuses it:
   - If that chat's tab is still open, the extension switches to it and
     appends the new prompt into the ongoing conversation.
   - If the tab was closed, it reopens the saved chat URL in a background,
     pinned tab.
   - If no chat is saved yet, or the saved one turns out to be gone
     (deleted), it starts a fresh chat and saves its URL
     (`geminiActiveChatUrl` / `chatgptActiveChatUrl` in
     `chrome.storage.local`) for every future run.
   - Each prompt still explicitly tells the model "this is a new, separate
     lesson" so it doesn't blend context across topics even though they
     share one thread.
2. **Branding.** Popup and dashboard headers show "Ashwani Tiwari | Notes
   From AI" with the `ashwanitiwari.com` logo (falls back to an inline SVG
   monogram if the remote image fails to load) and a "Developed by
   ashwanitiwari.com" footer badge.
3. **Auto-launch dashboard.** As soon as a note finishes generating, the
   extension automatically opens (or focuses, if already open)
   `viewer.html`, which shows a toast — *"New topic successfully
   appended!"* — and smooth-scrolls to the new topic.
4. **Zero-fluff prompt.** The system prompt now explicitly forbids
   introductory/filler text and caps the summary at 2 sentences, 3–5 key
   points, and one clean, commented code example.

## File structure

```
manifest.json                  Manifest V3 config, permissions
background.js                  Service worker: orchestrates scan -> web session -> storage -> auto-open dashboard
content.js                     Injected into the page to extract text/headings/code
services/webSessionBridge.js   Session-tab management + DOM automation + response parsing
popup.html/css/js              Provider picker + scan/clear/open-dashboard, branded header/footer
viewer.html/css/js             Notes Dashboard: renders, TOC, dark mode, export, branded header/footer
icons/                         Placeholder toolbar icons (replace with your own)
```

## 1. Load the extension (Developer Mode)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select this project folder.

No Google Cloud Console setup, no OAuth client, no credentials to manage.

## 2. Sign in

Before scanning, make sure you're signed in, in this Chrome profile, to
whichever provider you plan to use:

- Gemini Web: https://gemini.google.com
- ChatGPT Web: https://chatgpt.com

## 3. Use it

1. Click the extension icon and pick a provider (**Gemini Web** or
   **ChatGPT Web**) — saved automatically.
2. Navigate to the article/docs page you want notes from.
3. (Optional) Enter a topic title override.
4. Click **Scan & Add to Notes**. The status badge walks through:
   - `[1/3] Extracting page content...`
   - `[2/3] Sending to Gemini / ChatGPT tab...`
   - `[3/3] Generating & appending to Notes...`
   - `Appended Successfully`
5. The Notes Dashboard opens/focuses automatically with the new topic
   visible and a confirmation toast.
6. Because the dashboard also listens for `chrome.storage.onChanged`, if
   you leave it open and scan another page, the new topic appears
   instantly — no reload needed.
7. Use **Clear All Notes** in the popup (with confirmation) to wipe
   everything. This is the *only* way notes are ever deleted — they
   otherwise persist in `chrome.storage.local` across browser restarts and
   device reboots.

## Notes Dashboard features

- Sticky sidebar table of contents.
- Dark / light mode toggle, persisted per-browser.
- **Copy Code** button on every code block.
- **Export as HTML** — downloads a self-contained, styled HTML file.
- **Print / Save as PDF**.
- **Copy Full Document** — plain-text copy of all notes.

## Updating selectors when a provider's UI changes

Open `services/webSessionBridge.js` and edit the relevant entry in
`PROVIDERS`:

```js
"gemini-web": {
  inputSelectors: [...],   // the chat text box
  sendSelectors: [...],    // the send button
  stopSelectors: [...],    // the "stop generating" button shown while streaming
  responseSelectors: [...],// the assistant's reply bubble(s)
  titleSelectors: [...],   // (best-effort) the conversation's title element in the sidebar
}
```

Each is a prioritized list — the bridge tries each selector in order and
uses the first match, so you can add a new selector without removing the
old one.

## AI prompt contract

```json
{"topicTitle": "...", "summary": "...", "takeaways": ["..."], "code": "...", "codeLanguage": "javascript"}
```

`webSessionBridge.js` strips markdown fences and parses this before
`background.js` appends it, with a generated id/timestamp/source
URL/provider, to `chrome.storage.local.notesList`.

## Security notes

- No API keys exist anywhere in this extension.
- All notes are stored in `chrome.storage.local` (device-local, never
  synced or sent anywhere except to the AI tab you already had open).
- Note content is escaped before being inserted into the dashboard's DOM
  (`viewer.js`'s `escapeHtml`), so AI-generated text can't inject markup
  even though it's rendered via `innerHTML`.
- `<all_urls>` host permission is required so the popup can scan whatever
  page you're currently reading — the extension only ever injects
  `content.js` into the tab you explicitly scan from the popup, never in
  the background.

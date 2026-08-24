// ─────────────────────────────────────────────────────────────────────────────
// viewer.js — NoteFlow AI Notes Dashboard
//
// Rendering strategy:
//  • On load: full render of all notes (skeleton for "generating", card for "done").
//  • On chrome.storage.onChanged: surgical DOM diff —
//      - New note with status:"generating" → append shimmer skeleton.
//      - Status change "generating" → "done" → swap skeleton for real card (fade-in).
//      - Status change "generating" → "error" → swap skeleton for error card.
//      - All notes cleared → full re-render (empty state).
//    This avoids full innerHTML rewrites on every update.
// ─────────────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

function slugify(text, index) {
  const base = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `topic-${index}-${base || "untitled"}`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

const PROVIDER_LABELS = {
  "gemini-web":     "Gemini",
  "chatgpt-web":    "ChatGPT",
  "claude-web":     "Claude",
  "perplexity-web": "Perplexity",
  "deepseek-web":   "DeepSeek",
};

// ── DOM element ID conventions ────────────────────────────────────────────────
// Real card: id = "card-{noteId}"
// Skeleton:  id = "skel-{noteId}"

function cardIdFor(noteId)  { return `card-${noteId}`; }
function skelIdFor(noteId)  { return `skel-${noteId}`; }

// ── Branding fallback ─────────────────────────────────────────────────────────
$("brandLogoImg").addEventListener("error", () => {
  $("brandLogoImg").classList.add("hidden");
  $("brandLogoFallback").classList.remove("hidden");
});

// ── Theme ─────────────────────────────────────────────────────────────────────
async function loadTheme() {
  const { theme = "dark" } = await chrome.storage.local.get("theme");
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("themeToggleBtn").textContent = theme === "dark" ? "☀️" : "🌙";
}

$("themeToggleBtn").addEventListener("click", async () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

// ── Rendering ─────────────────────────────────────────────────────────────────

function buildNoteCardElement(note, index, anchorId) {
  const takeawaysHtml = (note.takeaways || [])
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join("");

  const codeHtml = note.code
    ? `<div class="section-label">Code</div>
       <div class="code-block" data-code="${encodeURIComponent(note.code)}">
         <div class="code-block-header">
           <span class="code-lang">${escapeHtml(note.codeLanguage || "code")}</span>
           <button class="copy-code-btn">Copy Code</button>
         </div>
         <pre><code>${escapeHtml(note.code)}</code></pre>
       </div>`
    : "";

  const takeawaysBlock = takeawaysHtml
    ? `<div class="section-label">Key Takeaways</div>
       <ul class="takeaways">${takeawaysHtml}</ul>`
    : "";

  const providerLabel = PROVIDER_LABELS[note.provider] || note.provider || "";
  const providerChip = providerLabel
    ? `<span class="provider-chip">${escapeHtml(providerLabel)}</span>`
    : "";

  const el = document.createElement("article");
  el.className = "topic";
  el.id = cardIdFor(note.id);
  el.dataset.noteId = note.id;
  el.setAttribute("data-anchor", anchorId);
  el.innerHTML = `
    <div class="topic-header">
      <h2 class="topic-title">${index + 1}. ${escapeHtml(note.topicTitle)}</h2>
    </div>
    <div class="topic-meta">
      <span>${formatDate(note.createdAt)}</span>
      ${providerChip}
      ${note.sourceUrl
        ? `<a href="${escapeHtml(note.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>`
        : ""}
    </div>
    <p class="topic-summary">${escapeHtml(note.summary)}</p>
    ${takeawaysBlock}
    ${codeHtml}
  `;

  // Wire up "Copy Code" buttons.
  el.querySelectorAll(".code-block").forEach((block) => {
    const btn  = block.querySelector(".copy-code-btn");
    const code = decodeURIComponent(block.dataset.code || "");
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(code);
      showToast("Code copied to clipboard");
    });
  });

  return el;
}

function buildSkeletonElement(note) {
  const el = document.createElement("article");
  el.className = "skeleton-topic topic";
  el.id = skelIdFor(note.id);
  el.dataset.noteId = note.id;
  el.innerHTML = `
    <div class="skeleton-header">
      <span class="skeleton-block" style="width:55%;height:22px;"></span>
      <span class="skeleton-block" style="width:35%;height:13px;margin-top:2px;"></span>
    </div>
    <div class="generating-badge">
      <span class="generating-dot"></span>
      Generating topic notes…
    </div>
    <div class="skeleton-lines">
      <span class="skeleton-block" style="width:94%;height:12px;"></span>
      <span class="skeleton-block" style="width:80%;height:12px;"></span>
      <span class="skeleton-block" style="width:87%;height:12px;"></span>
      <span class="skeleton-block" style="width:60%;height:12px;"></span>
    </div>
  `;
  return el;
}

function buildErrorElement(note, index) {
  const el = document.createElement("article");
  el.className = "topic error-topic";
  el.id = cardIdFor(note.id);
  el.dataset.noteId = note.id;
  el.innerHTML = `
    <h2 class="topic-title">⚠ Failed to generate note</h2>
    <div class="topic-meta"><span>${formatDate(note.createdAt)}</span></div>
    <div class="error-message">${escapeHtml(note.errorMessage || "An unknown error occurred.")}</div>
    ${note.sourceUrl
      ? `<div class="topic-meta" style="margin-top:10px;">
           <a href="${escapeHtml(note.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>
         </div>`
      : ""}
  `;
  return el;
}

// ── Full re-render (used for initial load and clear) ──────────────────────────

function renderAll(notesList) {
  const topicsRoot = $("topicsRoot");
  const emptyState = $("emptyState");

  const doneNotes = notesList.filter((n) => n.status !== "generating" && n.status !== "error");
  updateTopicCount(doneNotes.length, notesList.filter(n => n.status === "generating").length);

  if (!notesList.length) {
    emptyState.classList.remove("hidden");
    topicsRoot.innerHTML = "";
    updateTOC([]);
    return;
  }

  emptyState.classList.add("hidden");
  topicsRoot.innerHTML = "";

  let doneIdx = 0;
  notesList.forEach((note) => {
    if (note.status === "generating") {
      topicsRoot.appendChild(buildSkeletonElement(note));
    } else if (note.status === "error") {
      topicsRoot.appendChild(buildErrorElement(note, doneIdx));
      doneIdx++;
    } else {
      const anchorId = slugify(note.topicTitle, doneIdx);
      const el = buildNoteCardElement(note, doneIdx, anchorId);
      topicsRoot.appendChild(el);
      doneIdx++;
    }
  });

  updateTOC(notesList.filter((n) => n.status === "done"));
}

// ── Surgical DOM updates ──────────────────────────────────────────────────────

// Cache the current list in memory for fast diffing.
let _currentNotesList = [];

function syncToDOM(newList) {
  const oldList = _currentNotesList;

  // Detect a full clear.
  if (newList.length === 0) {
    renderAll([]);
    _currentNotesList = [];
    return;
  }

  const oldMap = new Map(oldList.map((n) => [n.id, n]));
  const newMap = new Map(newList.map((n) => [n.id, n]));
  const topicsRoot = $("topicsRoot");

  // Build the ordered index of done notes for correct numbering.
  const doneNotes = newList.filter((n) => n.status === "done");

  // 1. Handle new notes (present in new, absent in old).
  newList.forEach((note) => {
    if (oldMap.has(note.id)) return; // Not new.

    $("emptyState").classList.add("hidden");

    if (note.status === "generating") {
      topicsRoot.appendChild(buildSkeletonElement(note));
    } else if (note.status === "error") {
      const doneIdx = doneNotes.findIndex((n) => n.id === note.id);
      topicsRoot.appendChild(buildErrorElement(note, Math.max(doneIdx, 0)));
    } else {
      const doneIdx = doneNotes.findIndex((n) => n.id === note.id);
      const anchorId = slugify(note.topicTitle, doneIdx);
      const el = buildNoteCardElement(note, doneIdx, anchorId);
      el.classList.add("entering"); // Trigger fade-in animation.
      topicsRoot.appendChild(el);
      updateTOC(doneNotes);
    }
  });

  // 2. Handle status transitions (generating → done | error).
  newList.forEach((note) => {
    const old = oldMap.get(note.id);
    if (!old) return;                       // Already handled above.
    if (old.status === note.status) return; // No change.

    const skelEl = document.getElementById(skelIdFor(note.id));

    if (note.status === "done" && skelEl) {
      const doneIdx = doneNotes.findIndex((n) => n.id === note.id);
      const anchorId = slugify(note.topicTitle, doneIdx);
      const cardEl = buildNoteCardElement(note, doneIdx, anchorId);
      cardEl.classList.add("entering");
      skelEl.replaceWith(cardEl);
      updateTOC(doneNotes);
      showToast("✓ New topic appended!");
      setTimeout(() => {
        cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    } else if (note.status === "error" && skelEl) {
      const errorEl = buildErrorElement(note, 0);
      skelEl.replaceWith(errorEl);
      showToast("⚠ Note generation failed.");
    }
  });

  // 3. Handle deleted notes (present in old, absent in new).
  oldList.forEach((note) => {
    if (newMap.has(note.id)) return;
    const cardEl =
      document.getElementById(cardIdFor(note.id)) ||
      document.getElementById(skelIdFor(note.id));
    cardEl?.remove();
  });

  // Update topic count after all mutations.
  updateTopicCount(
    doneNotes.length,
    newList.filter((n) => n.status === "generating").length
  );

  if ($("topicsRoot").children.length === 0) {
    $("emptyState").classList.remove("hidden");
    updateTOC([]);
  }

  _currentNotesList = newList;
}

// ── TOC & count ───────────────────────────────────────────────────────────────

function updateTopicCount(doneCount, generatingCount) {
  const parts = [];
  if (doneCount)      parts.push(`${doneCount} topic${doneCount === 1 ? "" : "s"}`);
  if (generatingCount) parts.push(`${generatingCount} generating…`);
  $("topicCount").textContent = parts.join(" · ");
}

function updateTOC(doneNotes) {
  const tocList = $("tocList");
  if (!doneNotes.length) {
    tocList.innerHTML = `<li class="toc-empty">Nothing here yet</li>`;
    return;
  }
  tocList.innerHTML = doneNotes
    .map((note, i) => {
      const anchorId = slugify(note.topicTitle, i);
      return `<li><a href="#${anchorId}">${i + 1}. ${escapeHtml(note.topicTitle)}</a></li>`;
    })
    .join("");
}

// ── Storage listener (live updates from background) ───────────────────────────

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.notesList) return;
  const after = changes.notesList.newValue || [];
  syncToDOM(after);
});

// ── Toast ─────────────────────────────────────────────────────────────────────

let _toastTimer;
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.add("hidden"), 2400);
}

// ── Toolbar actions ───────────────────────────────────────────────────────────

$("printBtn").addEventListener("click", () => window.print());

$("copyAllBtn").addEventListener("click", async () => {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const text = notesList
    .filter((n) => n.status === "done")
    .map((note, i) => {
      let block = `${i + 1}. ${note.topicTitle}\n\n${note.summary}\n`;
      if (note.takeaways?.length) {
        block += `\nKey Takeaways:\n${note.takeaways.map((t) => `- ${t}`).join("\n")}\n`;
      }
      if (note.code) {
        block += `\nCode (${note.codeLanguage || "code"}):\n${note.code}\n`;
      }
      return block;
    })
    .join("\n" + "-".repeat(40) + "\n\n");

  await navigator.clipboard.writeText(text || "No notes yet.");
  showToast("Full document copied to clipboard");
});

$("exportHtmlBtn").addEventListener("click", async () => {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  const doneNotes = notesList.filter((n) => n.status === "done");

  const styleResp = await fetch("viewer.css");
  const css = await styleResp.text();

  const body = doneNotes
    .map((note, i) => {
      const anchorId = slugify(note.topicTitle, i);
      const el = buildNoteCardElement(note, i, anchorId);
      return el.outerHTML;
    })
    .join("");

  const doc = `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8" />
<title>NoteFlow AI — Notes Export</title>
<style>${css}
.topbar,.sidebar,.site-footer{display:none;}
.layout{display:block;}
.doc{max-width:900px;margin:0 auto;padding:32px 24px 80px;}
</style>
</head>
<body>
<main class="doc"><div id="topicsRoot">${body}</div></main>
</body>
</html>`;

  const blob = new Blob([doc], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `noteflow-export-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("HTML file exported");
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  await loadTheme();
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  _currentNotesList = notesList;
  renderAll(notesList);
}

init();

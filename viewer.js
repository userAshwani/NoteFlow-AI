// ─────────────────────────────────────────────────────────────────────────────
// viewer.js — NoteFlow AI Smart Knowledge Dashboard  v5.2
// ─────────────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── Utility Helpers ──────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(text, idx) {
  const base = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `topic-${idx}-${base || "item"}`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const PROVIDER_INFO = {
  "gemini-web":     { label: "Gemini", color: "var(--p-gemini)" },
  "chatgpt-web":    { label: "ChatGPT", color: "var(--p-chatgpt)" },
  "claude-web":     { label: "Claude", color: "var(--p-claude)" },
  "perplexity-web": { label: "Perplexity", color: "var(--p-perplexity)" },
  "deepseek-web":   { label: "DeepSeek", color: "var(--p-deepseek)" },
};

function cardIdFor(id) { return `card-${id}`; }
function skelIdFor(id) { return `skel-${id}`; }

// ── Branding Fallback ────────────────────────────────────────────────────────
$("brandLogoImg").addEventListener("error", () => {
  $("brandLogoImg").classList.add("hidden");
  $("brandLogoFallback").classList.remove("hidden");
});

// ── Theme Switcher ───────────────────────────────────────────────────────────
async function loadTheme() {
  const { theme = "dark" } = await chrome.storage.local.get("theme");
  applyTheme(theme);
}

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("themeIconDark").classList.toggle("hidden", t === "light");
  $("themeIconLight").classList.toggle("hidden", t === "dark");
}

$("themeBtn").addEventListener("click", async () => {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  const next = cur === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

// ── Pin Management ───────────────────────────────────────────────────────────
async function getPinnedIds() {
  const { pinnedNoteIds = [] } = await chrome.storage.local.get("pinnedNoteIds");
  return pinnedNoteIds;
}

async function togglePin(noteId) {
  const ids = await getPinnedIds();
  const i = ids.indexOf(noteId);
  if (i === -1) {
    ids.push(noteId);
    showToast("📌 Note pinned to top");
  } else {
    ids.splice(i, 1);
    showToast("Note unpinned");
  }
  await chrome.storage.local.set({ pinnedNoteIds: ids });
}

// ── Search & Filter State ────────────────────────────────────────────────────
let _searchText = "";
let _activeFilter = "all"; // 'all' | 'pinned' | 'code'
let _sortMode = "newest";

$("searchInput").addEventListener("input", (e) => {
  _searchText = e.target.value.toLowerCase().trim();
  $("searchClear").classList.toggle("hidden", !_searchText);
  refreshDisplay();
});

$("searchClear").addEventListener("click", () => {
  $("searchInput").value = "";
  _searchText = "";
  $("searchClear").classList.add("hidden");
  refreshDisplay();
});

// Global shortcut '/' to search
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("searchInput") && !$("fcOverlay").classList.contains("hidden") === false) {
    if (document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault();
      $("searchInput").focus();
    }
  }
  if (e.key === "Escape" && document.activeElement === $("searchInput")) {
    $("searchInput").blur();
  }
});

// Filter Chips
document.querySelectorAll(".filter-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    _activeFilter = btn.dataset.filter;
    refreshDisplay();
  });
});

$("sortSelect").addEventListener("change", (e) => {
  _sortMode = e.target.value;
  chrome.storage.local.set({ sortMode: _sortMode });
  refreshDisplay();
});

function applyFilterAndSort(notes, pinnedIds) {
  let list = [...notes];

  // 1. Text Search Filter
  if (_searchText) {
    list = list.filter((n) => {
      const corpus = [n.topicTitle, n.summary, ...(n.takeaways || []), n.code || ""].join(" ").toLowerCase();
      return corpus.includes(_searchText);
    });
  }

  // 2. Chip Filter
  if (_activeFilter === "pinned") {
    list = list.filter((n) => pinnedIds.includes(n.id));
  } else if (_activeFilter === "code") {
    list = list.filter((n) => Boolean(n.code));
  }

  // 3. Sort Mode
  function compareFn(a, b) {
    if (_sortMode === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (_sortMode === "alpha") return (a.topicTitle || "").localeCompare(b.topicTitle || "");
    return new Date(b.createdAt) - new Date(a.createdAt); // newest
  }

  if (_sortMode === "pinned") {
    const p = list.filter((n) => pinnedIds.includes(n.id)).sort(compareFn);
    const r = list.filter((n) => !pinnedIds.includes(n.id)).sort(compareFn);
    return [...p, ...r];
  }

  return list.sort(compareFn);
}

// ── Delete with Undo ─────────────────────────────────────────────────────────
let _deletedBackup = null;
let _deleteUndoTimer = null;

async function deleteNote(noteId) {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const idx = notesList.findIndex((n) => n.id === noteId);
  if (idx === -1) return;

  _deletedBackup = { note: notesList[idx], idx };
  notesList.splice(idx, 1);
  await chrome.storage.local.set({ notesList });

  showToastWithUndo("Note removed", async () => {
    if (!_deletedBackup) return;
    const { notesList: current = [] } = await chrome.storage.local.get("notesList");
    current.splice(Math.min(_deletedBackup.idx, current.length), 0, _deletedBackup.note);
    _deletedBackup = null;
    await chrome.storage.local.set({ notesList: current });
  });
}

// ── Copy Single Note ─────────────────────────────────────────────────────────
async function copySingleNote(note) {
  let doc = `# ${note.topicTitle}\n\n${note.summary}\n`;
  if (note.takeaways?.length) {
    doc += `\n### Key Takeaways\n${note.takeaways.map((t) => `- ${t}`).join("\n")}\n`;
  }
  if (note.code) {
    doc += `\n\`\`\`${note.codeLanguage || "text"}\n${note.code}\n\`\`\`\n`;
  }
  if (note.sourceUrl) {
    doc += `\nSource: ${note.sourceUrl}\n`;
  }
  await navigator.clipboard.writeText(doc);
  showToast("📋 Markdown copied to clipboard");
}

// ── Build DOM Elements ───────────────────────────────────────────────────────

function buildCardActions(note, pinnedIds) {
  const isPinned = pinnedIds.includes(note.id);
  const div = document.createElement("div");
  div.className = "card-action-bar";
  div.innerHTML = `
    <button class="btn-card-action${isPinned ? " is-pinned" : ""}" data-action="pin" title="${isPinned ? "Unpin Note" : "Pin Note to Top"}">
      ${isPinned ? "📌" : "🔖"}
    </button>
    <button class="btn-card-action" data-action="copy" title="Copy Note as Markdown">
      📋
    </button>
    <button class="btn-card-action" data-action="delete" title="Delete Note">
      🗑
    </button>
  `;

  div.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === "pin") await togglePin(note.id);
    if (act === "copy") await copySingleNote(note);
    if (act === "delete") await deleteNote(note.id);
  });

  return div;
}

function buildNoteCard(note, doneIdx, pinnedIds) {
  const anchorId = slugify(note.topicTitle, doneIdx);
  const isPinned = pinnedIds.includes(note.id);
  const provider = note.provider || "gemini-web";
  const pInfo = PROVIDER_INFO[provider] || { label: "AI", color: "var(--primary)" };

  const el = document.createElement("article");
  el.className = `note-card pv-${provider}`;
  el.id = cardIdFor(note.id);
  el.dataset.noteId = note.id;
  el.setAttribute("data-anchor", anchorId);

  // Card Header Top
  const header = document.createElement("div");
  header.className = "card-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "card-title-group";
  titleGroup.innerHTML = `
    <span class="card-num-chip">#${doneIdx + 1}</span>
    <h2 class="card-title" id="${anchorId}">
      ${escHtml(note.topicTitle)}
      ${isPinned ? '<span class="card-pin-badge">📌</span>' : ""}
    </h2>
  `;

  header.appendChild(titleGroup);
  header.appendChild(buildCardActions(note, pinnedIds));
  el.appendChild(header);

  // Meta Row
  const meta = document.createElement("div");
  meta.className = "card-meta-row";
  meta.innerHTML = `
    <span class="provider-badge">
      <span class="badge-dot"></span>
      ${escHtml(pInfo.label)}
    </span>
    <span>${fmtDate(note.createdAt)}</span>
    ${note.sourceUrl
      ? `<a href="${escHtml(note.sourceUrl)}" target="_blank" rel="noopener" class="source-link">
           Source
           <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5">
             <path d="M7 13L13 7M13 7H7M13 7V13"/>
           </svg>
         </a>`
      : ""}
  `;
  el.appendChild(meta);

  // Summary
  if (note.summary) {
    const summary = document.createElement("div");
    summary.className = "card-summary";
    summary.textContent = note.summary;
    el.appendChild(summary);
  }

  // Key Points
  if (note.takeaways?.length) {
    const sectionTitle = document.createElement("div");
    sectionTitle.className = "card-section-title";
    sectionTitle.textContent = "Key Takeaways";
    el.appendChild(sectionTitle);

    const list = document.createElement("ul");
    list.className = "takeaway-list";
    list.innerHTML = note.takeaways
      .map(
        (t) => `
      <li class="takeaway-item">
        <span class="takeaway-bullet">✦</span>
        <span>${escHtml(t)}</span>
      </li>
    `
      )
      .join("");
    el.appendChild(list);
  }

  // Code Block
  if (note.code) {
    const codeWrap = document.createElement("div");
    codeWrap.className = "code-container";
    codeWrap.innerHTML = `
      <div class="code-header">
        <div class="code-window-dots">
          <span class="win-dot"></span>
          <span class="win-dot"></span>
          <span class="win-dot"></span>
        </div>
        <span class="code-lang-tag">${escHtml(note.codeLanguage || "code")}</span>
        <button class="btn-copy-code" data-code="${encodeURIComponent(note.code)}">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="7" y="5" width="10" height="12" rx="2"/>
            <path d="M4 14V4a1 1 0 0 1 1-1h9"/>
          </svg>
          <span class="copy-text">Copy Code</span>
        </button>
      </div>
      <pre><code>${escHtml(note.code)}</code></pre>
    `;

    codeWrap.querySelector(".btn-copy-code").addEventListener("click", async function () {
      const code = decodeURIComponent(this.dataset.code || "");
      await navigator.clipboard.writeText(code);
      const textSpan = this.querySelector(".copy-text");
      const orig = textSpan.textContent;
      textSpan.textContent = "✓ Copied!";
      setTimeout(() => { textSpan.textContent = orig; }, 2000);
      showToast("Code copied to clipboard");
    });

    el.appendChild(codeWrap);
  }

  return el;
}

function buildSkeletonCard(note) {
  const provider = note.provider || "gemini-web";
  const pInfo = PROVIDER_INFO[provider] || { label: "AI Engine" };

  const el = document.createElement("article");
  el.className = `skeleton-card note-card pv-${provider}`;
  el.id = skelIdFor(note.id);
  el.dataset.noteId = note.id;
  el.innerHTML = `
    <div class="skeleton-status-pill">
      <span class="skeleton-spinner"></span>
      <span>Generating with ${escHtml(pInfo.label)} in background…</span>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <span class="shimmer-block" style="width: 60%; height: 22px;"></span>
      <span class="shimmer-block" style="width: 35%; height: 12px;"></span>
    </div>
    <span class="shimmer-block" style="width: 100%; height: 50px;"></span>
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
      <span class="shimmer-block" style="width: 90%; height: 14px;"></span>
      <span class="shimmer-block" style="width: 80%; height: 14px;"></span>
      <span class="shimmer-block" style="width: 85%; height: 14px;"></span>
    </div>
  `;
  return el;
}

function buildErrorCard(note) {
  const el = document.createElement("article");
  el.className = "note-card error-card";
  el.id = cardIdFor(note.id);
  el.dataset.noteId = note.id;
  el.innerHTML = `
    <div class="card-header">
      <h3 class="error-card-title">⚠ Note Generation Interrupted</h3>
      <button class="btn-card-action" data-action="delete" title="Dismiss Error">🗑</button>
    </div>
    <div class="error-card-msg">${escHtml(note.errorMessage || "An unexpected error occurred during synthesis.")}</div>
    ${note.sourceUrl
      ? `<div style="margin-top: 10px; font-size: 12px;">
           <a href="${escHtml(note.sourceUrl)}" target="_blank" rel="noopener" class="source-link">Source ↗</a>
         </div>`
      : ""}
  `;
  el.querySelector("[data-action='delete']")?.addEventListener("click", () => deleteNote(note.id));
  return el;
}

// ── Full Render ──────────────────────────────────────────────────────────────

async function renderAll(notesList) {
  const pinnedIds = await getPinnedIds();
  const root = $("topicsRoot");
  const emptyEl = $("emptyState");

  root.innerHTML = "";

  const doneNotes = notesList.filter((n) => n.status === "done");
  const generatingNotes = notesList.filter((n) => n.status === "generating");
  const errorNotes = notesList.filter((n) => n.status === "error");

  const filteredDone = applyFilterAndSort(doneNotes, pinnedIds);

  if (!notesList.length) {
    emptyEl.classList.remove("hidden");
    updateTOC([], []);
    updateStats(0, 0, "—");
    updateHeaderCount(0, 0);
    return;
  }

  emptyEl.classList.add("hidden");

  // Render cards: Filtered Dones first, then generating skeletons, then errors
  let doneIdx = 0;
  filteredDone.forEach((note) => {
    root.appendChild(buildNoteCard(note, doneIdx++, pinnedIds));
  });

  generatingNotes.forEach((note) => {
    root.appendChild(buildSkeletonCard(note));
  });

  errorNotes.forEach((note) => {
    root.appendChild(buildErrorCard(note));
  });

  updateSearchHint(filteredDone.length, doneNotes.length);
  updateTOC(filteredDone, pinnedIds);
  updateStats(doneNotes.length, doneNotes.filter((n) => pinnedIds.includes(n.id)).length, getProviderSummary(doneNotes));
  updateHeaderCount(doneNotes.length, generatingNotes.length);
}

// ── Live Storage Sync ────────────────────────────────────────────────────────

let _currentNotesList = [];

async function syncToDOM(newList) {
  if (newList.length === 0) {
    _currentNotesList = [];
    await renderAll([]);
    return;
  }

  const pinnedIds = await getPinnedIds();
  const oldMap = new Map(_currentNotesList.map((n) => [n.id, n]));
  const newMap = new Map(newList.map((n) => [n.id, n]));
  const root = $("topicsRoot");

  // 1. New Skeletons / Notes
  for (const note of newList) {
    if (oldMap.has(note.id)) continue;
    $("emptyState").classList.add("hidden");
    if (note.status === "generating") {
      root.appendChild(buildSkeletonCard(note));
    } else if (note.status === "error") {
      root.appendChild(buildErrorCard(note));
    } else {
      const doneIdx = newList.filter((n) => n.status === "done" && n.id !== note.id).length;
      const el = buildNoteCard(note, doneIdx, pinnedIds);
      el.classList.add("entering");
      root.appendChild(el);
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      showToast("✓ New topic notes captured!");
    }
  }

  // 2. Status Transitions (generating -> done / error)
  for (const note of newList) {
    const old = oldMap.get(note.id);
    if (!old || old.status === note.status) continue;
    const skelEl = document.getElementById(skelIdFor(note.id));

    if (note.status === "done" && skelEl) {
      const pinnedIds2 = await getPinnedIds();
      const doneIdx = newList.filter((n) => n.status === "done").indexOf(note);
      const cardEl = buildNoteCard(note, Math.max(doneIdx, 0), pinnedIds2);
      cardEl.classList.add("entering");
      skelEl.replaceWith(cardEl);
      setTimeout(() => cardEl.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      showToast("✓ Topic notes generated!");
    } else if (note.status === "error" && skelEl) {
      skelEl.replaceWith(buildErrorCard(note));
      showToast("⚠ Generation failed.");
    }
  }

  // 3. Removed notes
  for (const note of _currentNotesList) {
    if (newMap.has(note.id)) continue;
    document.getElementById(cardIdFor(note.id))?.remove();
    document.getElementById(skelIdFor(note.id))?.remove();
  }

  _currentNotesList = newList;

  const done = newList.filter((n) => n.status === "done");
  const gen = newList.filter((n) => n.status === "generating");
  const pinnedIdsF = await getPinnedIds();
  updateHeaderCount(done.length, gen.length);
  updateStats(done.length, done.filter((n) => pinnedIdsF.includes(n.id)).length, getProviderSummary(done));
  updateTOC(applyFilterAndSort(done, pinnedIdsF), pinnedIdsF);
}

// ── Sidebar & Header Helpers ─────────────────────────────────────────────────

function getProviderSummary(doneNotes) {
  const providers = [...new Set(doneNotes.map((n) => n.provider).filter(Boolean))];
  if (!providers.length) return "—";
  if (providers.length === 1) return PROVIDER_INFO[providers[0]]?.label || providers[0];
  return `${providers.length} Models`;
}

function updateHeaderCount(doneCount, genCount) {
  const parts = [];
  if (doneCount) parts.push(`${doneCount} Topic${doneCount === 1 ? "" : "s"}`);
  if (genCount) parts.push(`${genCount} in progress…`);
  $("topicCount").innerHTML = `
    <span class="status-indicator-dot"></span>
    ${parts.join(" · ") || "Knowledge Hub"}
  `;
}

function updateStats(notes, pinned, engine) {
  $("statNotes").textContent = notes;
  $("statPinned").textContent = pinned;
  $("statProviders").textContent = engine;
}

function updateSearchHint(shown, total) {
  const hint = $("searchHint");
  if (_searchText && shown < total) {
    hint.textContent = `Showing ${shown} of ${total} topics matching "${_searchText}"`;
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }
}

function updateTOC(doneNotes, pinnedIds) {
  const toc = $("tocList");
  $("tocCount").textContent = doneNotes.length;

  if (!doneNotes.length) {
    toc.innerHTML = `<li class="toc-empty">No topics matching filter</li>`;
    return;
  }

  toc.innerHTML = doneNotes
    .map((note, i) => {
      const anchor = slugify(note.topicTitle, i);
      const isPinned = pinnedIds.includes(note.id);
      return `
        <li>
          <a href="#${anchor}" class="toc-item-link" title="${escHtml(note.topicTitle)}">
            <span class="toc-num-badge">${i + 1}</span>
            ${isPinned ? '<span class="toc-pin-icon">📌</span>' : ""}
            <span>${escHtml(note.topicTitle)}</span>
          </a>
        </li>
      `;
    })
    .join("");
}

async function refreshDisplay() {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  _currentNotesList = notesList;
  await renderAll(notesList);
}

// ── Storage Watcher ──────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes.notesList) {
    const after = changes.notesList.newValue || [];
    await syncToDOM(after);
    _currentNotesList = after;
  }

  if (changes.pinnedNoteIds) {
    await refreshDisplay();
  }
});

// ── Toolbar Actions ──────────────────────────────────────────────────────────

// Clear All
$("clearAllBtn").addEventListener("click", () => {
  $("clearConfirmBar").classList.remove("hidden");
});

$("ccNo").addEventListener("click", () => {
  $("clearConfirmBar").classList.add("hidden");
});

$("ccYes").addEventListener("click", async () => {
  $("clearConfirmBar").classList.add("hidden");
  await chrome.storage.local.set({ notesList: [], pinnedNoteIds: [] });
  showToast("All notes cleared from workspace");
});

// Export HTML
$("exportHtmlBtn").addEventListener("click", async () => {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const pinnedIds = await getPinnedIds();
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  const done = notesList.filter((n) => n.status === "done");

  const styleResp = await fetch("viewer.css");
  const css = await styleResp.text();

  const body = done.map((n, i) => buildNoteCard(n, i, pinnedIds).outerHTML).join("");

  const doc = `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8"/>
  <title>NoteFlow AI — Exported Knowledge Base</title>
  <style>
    ${css}
    .app-topbar, .app-sidebar, .card-action-bar, .stream-toolbar, .confirm-alert-bar, .btn-copy-code { display: none !important; }
    .app-container { display: block; max-width: 900px; margin: 0 auto; }
    .app-main { padding: 40px 20px; }
  </style>
</head>
<body>
  <div class="app-container">
    <main class="app-main">
      <h1 style="font-size: 28px; font-weight: 800; margin-bottom: 24px; color: var(--text-main);">NoteFlow AI Notes</h1>
      <div class="notes-stream">${body}</div>
    </main>
  </div>
</body>
</html>`;

  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([doc], { type: "text/html" })),
    download: `noteflow-notes-${new Date().toISOString().slice(0, 10)}.html`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast("HTML document exported");
});

// Copy All
$("copyAllBtn").addEventListener("click", async () => {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const done = notesList.filter((n) => n.status === "done");
  const text = done
    .map((n, i) => {
      let s = `# ${i + 1}. ${n.topicTitle}\n\n${n.summary}`;
      if (n.takeaways?.length) {
        s += `\n\n### Key Takeaways:\n${n.takeaways.map((t) => `- ${t}`).join("\n")}`;
      }
      if (n.code) {
        s += `\n\n\`\`\`${n.codeLanguage || "text"}\n${n.code}\n\`\`\``;
      }
      if (n.sourceUrl) {
        s += `\n\nSource: ${n.sourceUrl}`;
      }
      return s;
    })
    .join("\n\n" + "─".repeat(50) + "\n\n");

  await navigator.clipboard.writeText(text || "No notes available.");
  showToast("Complete workspace copied to clipboard");
});

// ── Interactive Flashcard Study Mode ─────────────────────────────────────────

let _fcCards = [];
let _fcIdx = 0;
let _fcShown = false;

function openFlashcards() {
  const done = _currentNotesList.filter((n) => n.status === "done" && n.topicTitle);
  if (!done.length) {
    showToast("No notes available for flashcard study yet");
    return;
  }
  _fcCards = done;
  _fcIdx = 0;
  _fcShown = false;
  $("fcOverlay").classList.remove("hidden");
  renderFlashCard();
}

function renderFlashCard() {
  const card = _fcCards[_fcIdx];
  $("fcProgress").textContent = `${_fcIdx + 1} / ${_fcCards.length}`;
  $("fcQNum").textContent = `TOPIC ${_fcIdx + 1}`;
  $("fcTitle").textContent = card.topicTitle;
  $("fcSummary").textContent = card.summary || "";
  $("fcTakeaways").innerHTML = (card.takeaways || []).map((t) => `<li>${escHtml(t)}</li>`).join("");

  $("fcFront").classList.remove("hidden");
  $("fcBack").classList.add("hidden");
  $("fcRevealText").textContent = "Reveal Answer";
  $("fcPrev").disabled = _fcIdx === 0;
  $("fcNext").disabled = _fcIdx === _fcCards.length - 1;
  _fcShown = false;
}

$("flashcardBtn").addEventListener("click", openFlashcards);

$("fcClose").addEventListener("click", () => {
  $("fcOverlay").classList.add("hidden");
});

$("fcReveal").addEventListener("click", () => {
  if (!_fcShown) {
    $("fcBack").classList.remove("hidden");
    $("fcRevealText").textContent = "Next Card →";
    _fcShown = true;
  } else {
    if (_fcIdx < _fcCards.length - 1) {
      _fcIdx++;
      renderFlashCard();
    } else {
      showToast("🎉 Excellent! You reviewed all cards.");
      $("fcOverlay").classList.add("hidden");
    }
  }
});

$("fcPrev").addEventListener("click", () => {
  if (_fcIdx > 0) {
    _fcIdx--;
    renderFlashCard();
  }
});

$("fcNext").addEventListener("click", () => {
  if (_fcIdx < _fcCards.length - 1) {
    _fcIdx++;
    renderFlashCard();
  }
});

// Flashcard Keyboard Nav
document.addEventListener("keydown", (e) => {
  if ($("fcOverlay").classList.contains("hidden")) return;
  if (e.key === "ArrowLeft") {
    if (_fcIdx > 0) { _fcIdx--; renderFlashCard(); }
  }
  if (e.key === "ArrowRight") {
    if (_fcIdx < _fcCards.length - 1) { _fcIdx++; renderFlashCard(); }
  }
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    $("fcReveal").click();
  }
  if (e.key === "Escape") {
    $("fcOverlay").classList.add("hidden");
  }
});

// ── Notification Toast ───────────────────────────────────────────────────────

let _toastTimer = null;

function showToast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add("hidden"), 2500);
}

function showToastWithUndo(msg, undoFn) {
  const el = $("toast");
  el.innerHTML = "";
  el.appendChild(document.createTextNode(msg + " "));
  const btn = document.createElement("button");
  btn.className = "toast-btn-undo";
  btn.textContent = "Undo";
  btn.addEventListener(
    "click",
    () => {
      clearTimeout(_toastTimer);
      el.classList.add("hidden");
      undoFn();
    },
    { once: true }
  );
  el.appendChild(btn);
  el.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.add("hidden");
    _deletedBackup = null;
  }, 5000);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadTheme();

  const { sortMode = "newest" } = await chrome.storage.local.get("sortMode");
  _sortMode = sortMode;
  $("sortSelect").value = sortMode;

  const { notesList = [] } = await chrome.storage.local.get("notesList");
  _currentNotesList = notesList;
  await renderAll(notesList);
}

init();

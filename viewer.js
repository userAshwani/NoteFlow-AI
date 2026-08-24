// ─────────────────────────────────────────────────────────────────────────────
// viewer.js — NoteFlow AI Unified Knowledge & Multi-AI Chat Dashboard  v5.4
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
  const { theme = "light" } = await chrome.storage.local.get("theme");
  applyTheme(theme);
}

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("themeIconDark").classList.toggle("hidden", t === "light");
  $("themeIconLight").classList.toggle("hidden", t === "dark");
}

$("themeBtn").addEventListener("click", async () => {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const next = cur === "light" ? "dark" : "light";
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. WORKSPACE MODE SWITCHING (Notes vs Chat Hub)
// ═════════════════════════════════════════════════════════════════════════════

let _currentTab = "notes"; // 'notes' | 'chat'

function switchWorkspaceTab(tab) {
  _currentTab = tab;
  chrome.storage.local.set({ activeWorkspaceTab: tab });

  const isNotes = tab === "notes";
  $("tabNotesBtn").classList.toggle("active", isNotes);
  $("tabChatBtn").classList.toggle("active", !isNotes);

  $("notesWorkspace").classList.toggle("hidden", !isNotes);
  $("chatWorkspace").classList.toggle("hidden", isNotes);

  $("notesToolbarActions").classList.toggle("hidden", !isNotes);
  $("chatToolbarActions").classList.toggle("hidden", isNotes);

  if (!isNotes) {
    setTimeout(() => {
      $("chatInputText").focus();
      scrollChatToBottom();
    }, 50);
  }
}

$("tabNotesBtn").addEventListener("click", () => switchWorkspaceTab("notes"));
$("tabChatBtn").addEventListener("click", () => switchWorkspaceTab("chat"));

// ═════════════════════════════════════════════════════════════════════════════
// 2. STUDY NOTES STREAM LOGIC
// ═════════════════════════════════════════════════════════════════════════════

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

let _searchText = "";
let _activeFilter = "all";
let _sortMode = "newest";

$("searchInput").addEventListener("input", (e) => {
  _searchText = e.target.value.toLowerCase().trim();
  $("searchClear").classList.toggle("hidden", !_searchText);
  refreshNotesDisplay();
});

$("searchClear").addEventListener("click", () => {
  $("searchInput").value = "";
  _searchText = "";
  $("searchClear").classList.add("hidden");
  refreshNotesDisplay();
});

// Global shortcut '/'
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    _currentTab === "notes" &&
    document.activeElement !== $("searchInput") &&
    $("fcOverlay").classList.contains("hidden")
  ) {
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
    refreshNotesDisplay();
  });
});

$("sortSelect").addEventListener("change", (e) => {
  _sortMode = e.target.value;
  chrome.storage.local.set({ sortMode: _sortMode });
  refreshNotesDisplay();
});

function applyFilterAndSort(notes, pinnedIds) {
  let list = [...notes];

  if (_searchText) {
    list = list.filter((n) => {
      const corpus = [n.topicTitle, n.summary, ...(n.takeaways || []), n.code || ""].join(" ").toLowerCase();
      return corpus.includes(_searchText);
    });
  }

  if (_activeFilter === "pinned") {
    list = list.filter((n) => pinnedIds.includes(n.id));
  } else if (_activeFilter === "code") {
    list = list.filter((n) => Boolean(n.code));
  }

  function compareFn(a, b) {
    if (_sortMode === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (_sortMode === "alpha") return (a.topicTitle || "").localeCompare(b.topicTitle || "");
    return new Date(b.createdAt) - new Date(a.createdAt);
  }

  if (_sortMode === "pinned") {
    const p = list.filter((n) => pinnedIds.includes(n.id)).sort(compareFn);
    const r = list.filter((n) => !pinnedIds.includes(n.id)).sort(compareFn);
    return [...p, ...r];
  }

  return list.sort(compareFn);
}

let _deletedBackup = null;

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

function buildCardActions(note, pinnedIds) {
  const isPinned = pinnedIds.includes(note.id);
  const div = document.createElement("div");
  div.className = "card-action-bar";
  div.innerHTML = `
    <button class="btn-card-action${isPinned ? " is-pinned" : ""}" data-action="pin" title="${isPinned ? "Unpin Note" : "Pin Note to Top"}">
      ${isPinned ? "📌" : "🔖"}
    </button>
    <button class="btn-card-action" data-action="ask" title="Discuss this note in Multi-AI Chat">
      💬
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
    if (act === "ask") {
      switchWorkspaceTab("chat");
      const prompt = `Can you explain more about this topic: "${note.topicTitle}"?\nSummary: ${note.summary}`;
      $("chatInputText").value = prompt;
      $("chatInputText").focus();
    }
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

  if (note.summary) {
    const summary = document.createElement("div");
    summary.className = "card-summary";
    summary.textContent = note.summary;
    el.appendChild(summary);
  }

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

async function renderAllNotes(notesList) {
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

let _currentNotesList = [];

async function syncNotesToDOM(newList) {
  if (newList.length === 0) {
    _currentNotesList = [];
    await renderAllNotes([]);
    return;
  }

  const pinnedIds = await getPinnedIds();
  const oldMap = new Map(_currentNotesList.map((n) => [n.id, n]));
  const newMap = new Map(newList.map((n) => [n.id, n]));
  const root = $("topicsRoot");

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

async function refreshNotesDisplay() {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  _currentNotesList = notesList;
  await renderAllNotes(notesList);
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. MULTI-AI CHAT HUB LOGIC (Cross-Model Context Handoff & Compare Mode)
// ═════════════════════════════════════════════════════════════════════════════

let _selectedChatModel = "gemini-web";
let _previousChatModel = null;
let _chatMessages = []; // [{ id, sender: 'user'|'ai', model, text, timestamp, compareResults? }]
let _isChatSending = false;
let _detectedActiveProviders = [];

// Check detected providers
async function refreshChatProviders() {
  chrome.runtime.sendMessage({ type: "DETECT_PROVIDERS" }, (response) => {
    if (response?.ok && Array.isArray(response.providers)) {
      _detectedActiveProviders = response.providers;
      // Mark pills
      document.querySelectorAll(".model-pill").forEach((pill) => {
        const m = pill.dataset.model;
        const found = response.providers.find((p) => p.key === m);
        pill.title = found?.active ? `${pInfo(m).label} (Session Connected)` : `${pInfo(m).label} (Click to use)`;
      });
    }
  });
}

function pInfo(modelKey) {
  return PROVIDER_INFO[modelKey] || { label: modelKey, color: "var(--primary)" };
}

// Model Pill Selection
document.querySelectorAll(".model-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    const nextModel = btn.dataset.model;
    if (_selectedChatModel !== nextModel) {
      _previousChatModel = _selectedChatModel;
      _selectedChatModel = nextModel;
      chrome.storage.local.set({ selectedChatModel: nextModel });

      document.querySelectorAll(".model-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Update Context Handoff Banner Text
      const prevName = pInfo(_previousChatModel).label;
      const nextName = pInfo(nextModel).label;
      $("contextHandoffBanner").classList.remove("hidden");
      $("contextHandoffText").innerHTML = `
        <strong>Context Handoff:</strong> Switched from ${escHtml(prevName)} to <strong>${escHtml(nextName)}</strong>. Your prior conversation context will be referenced automatically.
      `;

      showToast(`Switched to ${nextName} with Context Handoff`);
    }
  });
});

// Auto-expand Textarea
$("chatInputText").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 140) + "px";
});

// Keydown send (Enter vs Shift+Enter)
$("chatInputText").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

$("chatSendBtn").addEventListener("click", sendChatMessage);

// Suggestion Prompts
document.querySelectorAll(".prompt-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("chatInputText").value = btn.dataset.prompt;
    $("chatInputText").focus();
    sendChatMessage();
  });
});

function scrollChatToBottom() {
  const vp = $("chatStream");
  vp.scrollTop = vp.scrollHeight;
}

// Build Context History String from recent turns
function buildRecentContextSummary() {
  if (!_chatMessages.length) return "";
  // Take last 4-6 messages
  const recent = _chatMessages.slice(-6);
  return recent
    .map((m) => {
      if (m.sender === "user") return `User: ${m.text}`;
      const name = pInfo(m.model).label;
      return `${name}: ${m.text}`;
    })
    .join("\n");
}

function renderChatMessages() {
  const container = $("chatMessagesList");
  const emptyState = $("chatEmptyState");

  if (!_chatMessages.length) {
    emptyState.classList.remove("hidden");
    container.innerHTML = "";
    return;
  }

  emptyState.classList.add("hidden");
  container.innerHTML = "";

  _chatMessages.forEach((msg) => {
    if (msg.sender === "user") {
      const row = document.createElement("div");
      row.className = "chat-row chat-row--user";
      row.innerHTML = `
        <div class="chat-bubble-user">
          <div>${escHtml(msg.text)}</div>
          <div class="meta-timestamp">${fmtDate(msg.timestamp)}</div>
        </div>
      `;
      container.appendChild(row);
    } else {
      // AI message
      const row = document.createElement("div");
      row.className = "chat-row chat-row--ai";

      if (msg.isCompare && Array.isArray(msg.compareResults)) {
        // Multi-Model Compare Grid
        const grid = document.createElement("div");
        grid.className = "chat-compare-grid";

        msg.compareResults.forEach((res) => {
          const card = document.createElement("div");
          card.className = `chat-card-ai pv-${res.provider}`;
          const p = pInfo(res.provider);

          card.innerHTML = `
            <div class="chat-ai-header">
              <span class="chat-ai-model-tag">
                <span class="model-dot pv-${res.provider.replace("-web", "")}"></span>
                ${escHtml(p.label)}
              </span>
              <div class="chat-ai-actions">
                <button class="btn-chat-action btn-save-note" title="Save this response as a Study Note">
                  📝 Save as Note
                </button>
                <button class="btn-chat-action btn-copy-chat" title="Copy Text">
                  📋 Copy
                </button>
              </div>
            </div>
            <div class="chat-ai-body">${formatMarkdown(res.text || res.error || "No response")}</div>
          `;

          wireChatCardButtons(card, res.text, p.label, res.provider);
          grid.appendChild(card);
        });

        row.appendChild(grid);
      } else {
        // Single Model Response
        const card = document.createElement("div");
        card.className = `chat-card-ai pv-${msg.model}`;
        const p = pInfo(msg.model);

        card.innerHTML = `
          <div class="chat-ai-header">
            <span class="chat-ai-model-tag">
              <span class="model-dot pv-${msg.model.replace("-web", "")}"></span>
              ${escHtml(p.label)}
            </span>
            <div class="chat-ai-actions">
              <button class="btn-chat-action btn-save-note" title="Save this response as a Study Note">
                📝 Save as Note
              </button>
              <button class="btn-chat-action btn-copy-chat" title="Copy Text">
                📋 Copy
              </button>
            </div>
          </div>
          <div class="chat-ai-body">${formatMarkdown(msg.text)}</div>
        `;

        wireChatCardButtons(card, msg.text, p.label, msg.model);
        row.appendChild(card);
      }

      container.appendChild(row);
    }
  });

  scrollChatToBottom();
}

function wireChatCardButtons(cardEl, text, modelLabel, providerKey) {
  cardEl.querySelector(".btn-copy-chat")?.addEventListener("click", async function () {
    await navigator.clipboard.writeText(text);
    this.textContent = "✓ Copied!";
    setTimeout(() => { this.textContent = "📋 Copy"; }, 1800);
    showToast("Chat response copied");
  });

  cardEl.querySelector(".btn-save-note")?.addEventListener("click", async function () {
    const firstLine = text.trim().split("\n")[0].replace(/^#*\s*/, "").slice(0, 60);
    const title = firstLine || `Insight from ${modelLabel}`;
    const summary = text.slice(0, 180) + (text.length > 180 ? "…" : "");

    chrome.runtime.sendMessage(
      {
        type: "SAVE_CHAT_TO_NOTE",
        note: {
          topicTitle: title,
          summary: summary,
          takeaways: [text.slice(0, 300)],
          provider: providerKey,
        },
      },
      (res) => {
        if (res?.ok) {
          this.textContent = "✓ Saved!";
          showToast(`Saved to Study Notes (#${title})`);
        }
      }
    );
  });
}

function formatMarkdown(raw) {
  if (!raw) return "";
  let clean = escHtml(raw);

  // Fenced Code Blocks
  clean = clean.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<div class="code-container" style="margin: 10px 0;"><div class="code-header"><span class="code-lang-tag">${lang || "code"}</span></div><pre><code>${code.trim()}</code></pre></div>`;
  });

  // Inline Code
  clean = clean.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  clean = clean.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Bullet items
  clean = clean.replace(/^\s*[-*•]\s+(.*)$/gm, "<li>$1</li>");
  clean = clean.replace(/(<li>.*<\/li>)/s, "<ul style='padding-left: 20px; margin: 8px 0;'>$1</ul>");

  // Paragraphs
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => (p.startsWith("<div") || p.startsWith("<ul") ? p : `<p>${p.replace(/\n/g, "<br/>")}</p>`));

  return paragraphs.join("");
}

async function sendChatMessage() {
  if (_isChatSending) return;
  const inputEl = $("chatInputText");
  const text = inputEl.value.trim();
  if (!text) return;

  _isChatSending = true;
  $("chatSendBtn").disabled = true;
  inputEl.value = "";
  inputEl.style.height = "auto";

  // 1. Append User Message
  const userMsg = {
    id: `msg_${Date.now()}`,
    sender: "user",
    text,
    timestamp: new Date().toISOString(),
  };
  _chatMessages.push(userMsg);
  renderChatMessages();

  // 2. Render Temporary Generating Indicator
  const container = $("chatMessagesList");
  const genRow = document.createElement("div");
  genRow.className = "chat-row chat-row--ai";
  genRow.id = "chatGenRow";
  const isCompare = $("compareModeCheck").checked;
  const targetLabel = isCompare ? "All Active AI Models" : pInfo(_selectedChatModel).label;

  genRow.innerHTML = `
    <div class="chat-generating-card">
      <span class="chat-spinner"></span>
      <span class="chat-gen-text">Synthesizing with ${escHtml(targetLabel)} in background…</span>
    </div>
  `;
  container.appendChild(genRow);
  scrollChatToBottom();

  const contextHistory = buildRecentContextSummary();

  try {
    if (isCompare) {
      // Dispatch to active models or all models
      const providersList = ["gemini-web", "chatgpt-web", "claude-web"];
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "SEND_CHAT_MESSAGE",
            isMultiModel: true,
            providersList,
            prompt: text,
            contextHistory,
          },
          resolve
        );
      });

      $("chatGenRow")?.remove();

      if (res?.ok && res.responses) {
        _chatMessages.push({
          id: `ai_${Date.now()}`,
          sender: "ai",
          isCompare: true,
          compareResults: res.responses,
          timestamp: new Date().toISOString(),
        });
      } else {
        showToast("⚠ Failed to get responses from some models.");
      }
    } else {
      // Single Model
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "SEND_CHAT_MESSAGE",
            provider: _selectedChatModel,
            prompt: text,
            contextHistory,
          },
          resolve
        );
      });

      $("chatGenRow")?.remove();

      if (res?.ok && res.text) {
        _chatMessages.push({
          id: `ai_${Date.now()}`,
          sender: "ai",
          model: _selectedChatModel,
          text: res.text,
          timestamp: new Date().toISOString(),
        });
      } else {
        _chatMessages.push({
          id: `ai_${Date.now()}`,
          sender: "ai",
          model: _selectedChatModel,
          text: `⚠ **Error:** ${res?.error || "Could not receive a response. Make sure you are logged in to " + pInfo(_selectedChatModel).label + "."}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    await chrome.storage.local.set({ chatMessages: _chatMessages });
  } catch (err) {
    $("chatGenRow")?.remove();
    showToast("⚠ Chat request error: " + err.message);
  } finally {
    _isChatSending = false;
    $("chatSendBtn").disabled = false;
    renderChatMessages();
  }
}

// Clear Chat Action
$("clearChatBtn").addEventListener("click", () => {
  $("confirmBarText").textContent = "Clear all messages in Multi-AI Chat?";
  $("clearConfirmBar").classList.remove("hidden");
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. STORAGE LISTENERS & EXPORT ACTIONS
// ═════════════════════════════════════════════════════════════════════════════

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes.notesList) {
    const after = changes.notesList.newValue || [];
    await syncNotesToDOM(after);
    _currentNotesList = after;
  }

  if (changes.pinnedNoteIds) {
    await refreshNotesDisplay();
  }
});

// Clear All in Notes
$("clearAllBtn").addEventListener("click", () => {
  $("confirmBarText").textContent = "Delete all saved notes from this workspace?";
  $("clearConfirmBar").classList.remove("hidden");
});

$("ccNo").addEventListener("click", () => {
  $("clearConfirmBar").classList.add("hidden");
});

$("ccYes").addEventListener("click", async () => {
  $("clearConfirmBar").classList.add("hidden");
  if (_currentTab === "chat") {
    _chatMessages = [];
    await chrome.storage.local.set({ chatMessages: [] });
    renderChatMessages();
    showToast("Chat conversation cleared");
  } else {
    await chrome.storage.local.set({ notesList: [], pinnedNoteIds: [] });
    showToast("All notes cleared from workspace");
  }
});

// Export HTML
$("exportHtmlBtn").addEventListener("click", async () => {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const pinnedIds = await getPinnedIds();
  const theme = document.documentElement.getAttribute("data-theme") || "light";
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

// ═════════════════════════════════════════════════════════════════════════════
// 5. FLASHCARD STUDY MODE
// ═════════════════════════════════════════════════════════════════════════════

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

// ── Boot Initializer ─────────────────────────────────────────────────────────

async function init() {
  await loadTheme();

  const {
    sortMode = "newest",
    activeWorkspaceTab = "notes",
    selectedChatModel = "gemini-web",
    chatMessages = [],
  } = await chrome.storage.local.get([
    "sortMode",
    "activeWorkspaceTab",
    "selectedChatModel",
    "chatMessages",
  ]);

  _sortMode = sortMode;
  $("sortSelect").value = sortMode;

  _selectedChatModel = selectedChatModel;
  document.querySelectorAll(".model-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.model === selectedChatModel);
  });

  _chatMessages = Array.isArray(chatMessages) ? chatMessages : [];
  renderChatMessages();
  refreshChatProviders();

  switchWorkspaceTab(activeWorkspaceTab);

  const { notesList = [] } = await chrome.storage.local.get("notesList");
  _currentNotesList = notesList;
  await renderAllNotes(notesList);
}

init();

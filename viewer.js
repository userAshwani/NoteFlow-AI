const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

// --- Branding: fall back to the inline SVG monogram if the remote logo fails to load ---
el("brandLogoImg").addEventListener("error", () => {
  el("brandLogoImg").classList.add("hidden");
  el("brandLogoFallback").classList.remove("hidden");
});

// --- Theme ---
async function loadTheme() {
  const { theme = "light" } = await chrome.storage.local.get("theme");
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  el("themeToggleBtn").textContent = theme === "dark" ? "☀️" : "🌙";
}

el("themeToggleBtn").addEventListener("click", async () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

// --- Rendering ---
function renderTopicHtml(note, index, anchorId) {
  const takeawaysHtml = (note.takeaways || [])
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join("");

  const codeHtml = note.code
    ? `
      <div class="section-label">Code</div>
      <div class="code-block" data-code="${encodeURIComponent(note.code)}">
        <div class="code-block-header">
          <span class="code-lang">${escapeHtml(note.codeLanguage || "code")}</span>
          <button class="copy-code-btn">Copy Code</button>
        </div>
        <pre><code>${escapeHtml(note.code)}</code></pre>
      </div>`
    : "";

  const takeawaysBlock = takeawaysHtml
    ? `<div class="section-label">Key Takeaways</div><ul class="takeaways">${takeawaysHtml}</ul>`
    : "";

  return `
    <article class="topic" id="${anchorId}">
      <div class="topic-header">
        <h2 class="topic-title">${index + 1}. ${escapeHtml(note.topicTitle)}</h2>
      </div>
      <div class="topic-meta">
        <span>${formatDate(note.createdAt)}</span>
        ${note.sourceUrl ? `<a href="${escapeHtml(note.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>` : ""}
      </div>
      <p class="topic-summary">${escapeHtml(note.summary)}</p>
      ${takeawaysBlock}
      ${codeHtml}
    </article>`;
}

function renderAll(notesList) {
  const emptyState = el("emptyState");
  const topicsRoot = el("topicsRoot");
  const tocList = el("tocList");
  const topicCount = el("topicCount");

  topicCount.textContent = notesList.length
    ? `${notesList.length} topic${notesList.length === 1 ? "" : "s"}`
    : "";

  if (!notesList.length) {
    emptyState.classList.remove("hidden");
    topicsRoot.innerHTML = "";
    tocList.innerHTML = `<li class="toc-empty">Nothing here yet</li>`;
    return;
  }

  emptyState.classList.add("hidden");

  const anchors = notesList.map((note, i) => slugify(note.topicTitle, i));

  topicsRoot.innerHTML = notesList
    .map((note, i) => renderTopicHtml(note, i, anchors[i]))
    .join("");

  tocList.innerHTML = notesList
    .map((note, i) => `<li><a href="#${anchors[i]}">${i + 1}. ${escapeHtml(note.topicTitle)}</a></li>`)
    .join("");

  // Wire up per-block "Copy Code" buttons.
  topicsRoot.querySelectorAll(".code-block").forEach((block) => {
    const btn = block.querySelector(".copy-code-btn");
    const code = decodeURIComponent(block.dataset.code || "");
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(code);
      showToast("Code copied to clipboard");
    });
  });
}

async function loadAndRender() {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  renderAll(notesList);
}

// Live updates: re-render whenever notesList changes in storage, no reload needed.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.notesList) {
    const before = changes.notesList.oldValue || [];
    const after = changes.notesList.newValue || [];
    renderAll(after);

    if (after.length > before.length) {
      showToast("New topic successfully appended!");
      const anchorId = slugify(after[after.length - 1].topicTitle, after.length - 1);
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
});

// --- Toast ---
let toastTimer;
function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2000);
}

// --- Toolbar actions ---
el("printBtn").addEventListener("click", () => window.print());

el("copyAllBtn").addEventListener("click", async () => {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const text = notesList
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

el("exportHtmlBtn").addEventListener("click", async () => {
  const { notesList = [] } = await chrome.storage.local.get("notesList");
  const theme = document.documentElement.getAttribute("data-theme") || "light";

  const styleResp = await fetch("viewer.css");
  const css = await styleResp.text();

  const anchors = notesList.map((note, i) => slugify(note.topicTitle, i));
  const body = notesList.map((note, i) => renderTopicHtml(note, i, anchors[i])).join("");

  const doc = `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8" />
<title>Notes Export</title>
<style>${css}
.topbar,.sidebar{display:none;}
.layout{display:block;}
.doc{max-width:900px;margin:0 auto;padding:32px 24px 80px;}
</style>
</head>
<body>
<main class="doc"><div id="topicsRoot">${body}</div></main>
</body>
</html>`;

  const blob = new Blob([doc], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `notes-export-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Exported HTML file");
});

loadTheme();
loadAndRender();

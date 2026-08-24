// Content script: extracts readable text, headings, and code from the active page.
// Injected on demand via chrome.scripting.executeScript (see background.js).

function extractPageContent() {
  const MAX_CHARS = 15000;

  const skipSelectors = [
    "script", "style", "noscript", "svg", "nav", "footer", "header",
    "iframe", "form", "button", "input", "textarea", "select",
    "[aria-hidden='true']", ".ad", ".ads", ".advertisement", ".cookie-banner",
  ];

  const clone = document.body.cloneNode(true);
  clone.querySelectorAll(skipSelectors.join(",")).forEach((el) => el.remove());

  // Prefer <main> or <article> if present, since they usually hold the core content.
  const primary = clone.querySelector("article") || clone.querySelector("main") || clone;

  // Headings give the AI a structural outline of the page.
  const headings = [];
  primary.querySelectorAll("h1, h2, h3").forEach((el) => {
    const text = el.innerText?.trim();
    if (text) headings.push(text);
  });

  // Collect code blocks separately so they aren't mangled by whitespace collapsing.
  const codeBlocks = [];
  primary.querySelectorAll("pre, code").forEach((el) => {
    const text = el.innerText?.trim();
    if (text && text.length > 10 && !codeBlocks.includes(text)) {
      codeBlocks.push(text);
    }
  });

  let text = primary.innerText || "";
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n...[truncated]";
  }

  return {
    url: window.location.href,
    title: document.title,
    text,
    headings: headings.slice(0, 20),
    codeBlocks: codeBlocks.slice(0, 10),
  };
}

// Expose on window so background.js can call it after injecting this file
// via chrome.scripting.executeScript({ files: ["content.js"] }).
window.__notesFromAiExtract = extractPageContent;

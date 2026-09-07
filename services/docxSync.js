// ─────────────────────────────────────────────────────────────────────────────
// services/docxSync.js — Auto-save Study Notes to a real .docx file
//
// Chrome extensions cannot silently write to an arbitrary filesystem path —
// there is no such API, by design (a sandboxing rule, not a limitation we can
// work around). The real mechanism is the File System Access API: the user
// picks a save location ONCE via a native file picker (window.showSaveFilePicker,
// which requires a real click — a user gesture), and the resulting file handle
// can then be reused to write updates automatically, with no further prompts,
// for as long as the browser keeps the permission granted.
//
// This file builds a minimal but genuinely valid .docx (OOXML packaged as a
// ZIP) entirely in vanilla JS — no bundler/CDN available in this extension,
// so the ZIP writer (STORE/uncompressed entries + CRC32) is hand-rolled below.
// ─────────────────────────────────────────────────────────────────────────────

// ── CRC32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Minimal growable byte buffer ─────────────────────────────────────────────

class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  writeUint16(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v & 0xffff, true);
    this.chunks.push(b);
    this.length += 2;
  }
  writeUint32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.chunks.push(b);
    this.length += 4;
  }
  writeBytes(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
  toUint8Array() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

// ── ZIP writer (STORE method only — no compression, but a fully valid ZIP) ──

function createZip(files) {
  const encoder = new TextEncoder();
  const localWriter = new ByteWriter();
  const centralWriter = new ByteWriter();
  const records = [];

  const DOS_TIME = 0;
  const DOS_DATE = 0x21; // fixed placeholder date; Word doesn't care

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const offset = localWriter.length;

    localWriter.writeUint32(0x04034b50);
    localWriter.writeUint16(20);
    localWriter.writeUint16(0);
    localWriter.writeUint16(0); // STORE
    localWriter.writeUint16(DOS_TIME);
    localWriter.writeUint16(DOS_DATE);
    localWriter.writeUint32(crc);
    localWriter.writeUint32(data.length);
    localWriter.writeUint32(data.length);
    localWriter.writeUint16(nameBytes.length);
    localWriter.writeUint16(0);
    localWriter.writeBytes(nameBytes);
    localWriter.writeBytes(data);

    records.push({ nameBytes, crc, size: data.length, offset });
  }

  for (const r of records) {
    centralWriter.writeUint32(0x02014b50);
    centralWriter.writeUint16(20);
    centralWriter.writeUint16(20);
    centralWriter.writeUint16(0);
    centralWriter.writeUint16(0);
    centralWriter.writeUint16(DOS_TIME);
    centralWriter.writeUint16(DOS_DATE);
    centralWriter.writeUint32(r.crc);
    centralWriter.writeUint32(r.size);
    centralWriter.writeUint32(r.size);
    centralWriter.writeUint16(r.nameBytes.length);
    centralWriter.writeUint16(0);
    centralWriter.writeUint16(0);
    centralWriter.writeUint16(0);
    centralWriter.writeUint16(0);
    centralWriter.writeUint32(0);
    centralWriter.writeUint32(r.offset);
    centralWriter.writeBytes(r.nameBytes);
  }

  const localBytes = localWriter.toUint8Array();
  const centralBytes = centralWriter.toUint8Array();

  const endWriter = new ByteWriter();
  endWriter.writeUint32(0x06054b50);
  endWriter.writeUint16(0);
  endWriter.writeUint16(0);
  endWriter.writeUint16(records.length);
  endWriter.writeUint16(records.length);
  endWriter.writeUint32(centralBytes.length);
  endWriter.writeUint32(localBytes.length);
  endWriter.writeUint16(0);
  const endBytes = endWriter.toUint8Array();

  const out = new Uint8Array(localBytes.length + centralBytes.length + endBytes.length);
  out.set(localBytes, 0);
  out.set(centralBytes, localBytes.length);
  out.set(endBytes, localBytes.length + centralBytes.length);
  return out;
}

// ── Minimal OOXML (word/document.xml) builder ────────────────────────────────

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── NoteFlow palette, mirrored from viewer.css so the .docx reads as the same
// document as the dashboard (indigo / tech-blue / slate, no warm accents) ────
const DX = {
  indigo: "4F46E5",
  indigoDeep: "3730A3",
  blue: "2563EB",
  slate900: "0F172A",
  slate700: "334155",
  slate500: "64748B",
  slate300: "CBD5E1",
  tintIndigo: "EEF2FF",
  tintSlate: "F1F5F9",
  codeBg: "0F172A",
  codeText: "E2E8F0",
  white: "FFFFFF",
};

function runXml(text, { bold, italic, size, font, color, caps, spacingPt } = {}) {
  // CT_RPr children must appear in schema order (rFonts, b, i, caps, color,
  // spacing, sz, ...) — Word tolerates some drift, but this keeps it strictly
  // valid so the file never opens as "repaired".
  const props = [];
  if (font) props.push(`<w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}"/>`);
  if (bold) props.push("<w:b/>");
  if (italic) props.push("<w:i/>");
  if (caps) props.push("<w:caps/>");
  if (color) props.push(`<w:color w:val="${color}"/>`);
  if (spacingPt) props.push(`<w:spacing w:val="${spacingPt}"/>`);
  if (size) props.push(`<w:sz w:val="${size}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";

  const lines = String(text ?? "").split("\n");
  const runs = lines
    .map((line, i) => (i === 0 ? "" : "<w:br/>") + `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    .join("");
  return `<w:r>${rPr}${runs}</w:r>`;
}

// CT_PPr children are order-sensitive: pBdr → shd → spacing → ind → jc.
// Getting this wrong is what makes Word offer to "repair" a document.
function paragraphXml(
  runsXml,
  { spacingAfter, spacingBefore, shade, leftBar, barColor, bottomRule, indentLeft, lineRule } = {}
) {
  const bits = [];

  if (leftBar || bottomRule) {
    const borders = [];
    if (leftBar) {
      borders.push(`<w:left w:val="single" w:sz="24" w:space="10" w:color="${barColor || DX.indigo}"/>`);
    }
    if (bottomRule) {
      borders.push(`<w:bottom w:val="single" w:sz="6" w:space="6" w:color="${DX.slate300}"/>`);
    }
    bits.push(`<w:pBdr>${borders.join("")}</w:pBdr>`);
  }

  if (shade) bits.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`);

  if (spacingAfter || spacingBefore || lineRule) {
    const attrs = [];
    if (spacingBefore) attrs.push(`w:before="${spacingBefore}"`);
    if (spacingAfter) attrs.push(`w:after="${spacingAfter}"`);
    if (lineRule) attrs.push(`w:line="${lineRule}" w:lineRule="auto"`);
    bits.push(`<w:spacing ${attrs.join(" ")}/>`);
  }

  if (indentLeft) bits.push(`<w:ind w:left="${indentLeft}"/>`);

  const pPr = bits.length ? `<w:pPr>${bits.join("")}</w:pPr>` : "";
  return `<w:p>${pPr}${runsXml}</w:p>`;
}

const PROVIDER_LABELS = {
  "gemini-web": "Gemini",
  "chatgpt-web": "ChatGPT",
  "claude-web": "Claude",
  "perplexity-web": "Perplexity",
  "deepseek-web": "DeepSeek",
};

function fmtDocxDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// Mirrors the dashboard card layout: indigo numbered heading, a muted meta
// line, the summary in a tinted callout with an indigo left bar, small-caps
// section labels, indigo diamond bullets, and code in a dark block.
function buildDocumentXml(notes) {
  const parts = [];

  // ── Masthead ──────────────────────────────────────────────────────────────
  parts.push(
    paragraphXml(runXml("NoteFlow AI", { bold: true, size: 48, color: DX.indigoDeep }), { spacingAfter: 40 })
  );
  parts.push(
    paragraphXml(
      runXml("STUDY NOTES WORKSPACE", { bold: true, size: 18, color: DX.slate500, caps: true, spacingPt: 60 }),
      { spacingAfter: 120 }
    )
  );
  parts.push(
    paragraphXml(
      runXml(
        `${notes.length} topic${notes.length === 1 ? "" : "s"}  ·  Updated ${fmtDocxDate(new Date().toISOString())}`,
        { size: 18, color: DX.slate500 }
      ),
      { spacingAfter: 160, bottomRule: true }
    )
  );
  parts.push(paragraphXml("", { spacingAfter: 200 }));

  if (!notes.length) {
    parts.push(
      paragraphXml(runXml("No notes captured yet.", { italic: true, size: 22, color: DX.slate500 }), {
        shade: DX.tintSlate,
        spacingAfter: 200,
      })
    );
  }

  notes.forEach((note, i) => {
    // ── Numbered topic heading ──────────────────────────────────────────────
    parts.push(
      paragraphXml(
        runXml(`${i + 1}.  `, { bold: true, size: 30, color: DX.blue }) +
          runXml(note.topicTitle || "Untitled", { bold: true, size: 30, color: DX.slate900 }),
        { spacingBefore: 240, spacingAfter: 60 }
      )
    );

    // ── Meta line: engine · date · source ───────────────────────────────────
    const meta = [];
    if (note.provider) meta.push(PROVIDER_LABELS[note.provider] || note.provider);
    if (note.createdAt) meta.push(fmtDocxDate(note.createdAt));
    if (meta.length) {
      parts.push(
        paragraphXml(runXml(meta.join("  ·  "), { size: 17, color: DX.slate500 }), { spacingAfter: 140 })
      );
    }

    // ── Summary callout: tinted background + indigo left bar ────────────────
    if (note.summary) {
      parts.push(
        paragraphXml(runXml(note.summary, { size: 22, color: DX.slate700 }), {
          shade: DX.tintIndigo,
          leftBar: true,
          barColor: DX.indigo,
          indentLeft: 180,
          spacingAfter: 200,
          lineRule: 276,
        })
      );
    }

    // ── Key takeaways ───────────────────────────────────────────────────────
    if (note.takeaways?.length) {
      parts.push(
        paragraphXml(
          runXml("KEY TAKEAWAYS", { bold: true, size: 17, color: DX.indigoDeep, caps: true, spacingPt: 60 }),
          { spacingAfter: 90 }
        )
      );
      note.takeaways.forEach((t) => {
        parts.push(
          paragraphXml(
            runXml("◆   ", { size: 20, color: DX.indigo }) + runXml(String(t), { size: 21, color: DX.slate700 }),
            { indentLeft: 220, spacingAfter: 80, lineRule: 264 }
          )
        );
      });
      parts.push(paragraphXml("", { spacingAfter: 100 }));
    }

    // ── Code block: dark slate panel, light monospace text ──────────────────
    if (note.code) {
      parts.push(
        paragraphXml(
          runXml((note.codeLanguage || "code").toUpperCase(), {
            bold: true,
            size: 15,
            color: DX.slate500,
            caps: true,
            spacingPt: 60,
          }),
          { spacingAfter: 60 }
        )
      );
      parts.push(
        paragraphXml(runXml(note.code, { font: "Consolas", size: 18, color: DX.codeText }), {
          shade: DX.codeBg,
          indentLeft: 160,
          spacingAfter: 180,
          lineRule: 264,
        })
      );
    }

    // ── Source link ─────────────────────────────────────────────────────────
    if (note.sourceUrl) {
      parts.push(
        paragraphXml(
          runXml("Source:  ", { size: 17, color: DX.slate500 }) +
            runXml(note.sourceUrl, { size: 17, color: DX.blue }),
          { spacingAfter: 120 }
        )
      );
    }

    // ── Divider between topics ──────────────────────────────────────────────
    if (i < notes.length - 1) {
      parts.push(paragraphXml("", { bottomRule: true, spacingAfter: 240 }));
    }
  });

  parts.push(
    paragraphXml(
      runXml("Generated by NoteFlow AI — ashwanitiwari.com", { size: 16, color: DX.slate500, italic: true }),
      { spacingBefore: 360 }
    )
  );

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${parts.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function buildDocxBytes(notes) {
  const encoder = new TextEncoder();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const documentXml = buildDocumentXml(notes);

  const files = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
  ];

  return createZip(files);
}

// ── Persisting the chosen FileSystemFileHandle (IndexedDB — handles aren't
// structured-cloneable into chrome.storage) ──────────────────────────────────

const IDB_NAME = "noteflow-docx";
const IDB_STORE = "handles";
const HANDLE_KEY = "docxHandle";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────

async function connectDocxFile() {
  if (!window.showSaveFilePicker) {
    throw new Error("This Chrome version doesn't support choosing a save file (File System Access API).");
  }
  const handle = await window.showSaveFilePicker({
    suggestedName: "NoteFlow-AI-Notes.docx",
    types: [
      {
        description: "Word Document",
        accept: {
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
        },
      },
    ],
  });
  await idbSet(HANDLE_KEY, handle);
  await chrome.storage.local.set({ docxAutoSaveEnabled: true });
  return handle;
}

async function disconnectDocxFile() {
  await idbDelete(HANDLE_KEY);
  await chrome.storage.local.set({ docxAutoSaveEnabled: false });
}

async function getDocxStatus() {
  const handle = await idbGet(HANDLE_KEY).catch(() => null);
  const { docxAutoSaveEnabled = false } = await chrome.storage.local.get("docxAutoSaveEnabled");

  if (!handle) return { connected: false, enabled: false };

  let permission = "unknown";
  try {
    permission = await handle.queryPermission({ mode: "readwrite" });
  } catch {
    /* non-fatal */
  }

  return { connected: true, enabled: docxAutoSaveEnabled, name: handle.name, permission };
}

// Writes the FULL current note set to the connected file each time (simpler
// and safer than incremental append — always leaves a consistent document,
// never a half-written or duplicated one).
async function syncDocxNow(notesList) {
  const handle = await idbGet(HANDLE_KEY).catch(() => null);
  if (!handle) return { ok: false, reason: "no-handle" };

  let permission;
  try {
    permission = await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return { ok: false, reason: "error" };
  }

  if (permission !== "granted") {
    // Only succeeds if called from within a real user gesture (e.g. the
    // "Sync now" button click) — a background/auto-triggered call will just
    // fail here, which the caller surfaces as "needs reconnect".
    try {
      permission = await handle.requestPermission({ mode: "readwrite" });
    } catch {
      return { ok: false, reason: "permission" };
    }
  }
  if (permission !== "granted") return { ok: false, reason: "permission" };

  try {
    const doneNotes = (notesList || []).filter((n) => n.status === "done");
    const bytes = buildDocxBytes(doneNotes);
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return { ok: true, count: doneNotes.length, name: handle.name };
  } catch (err) {
    return { ok: false, reason: "write-failed", error: err.message };
  }
}

window.NoteFlowDocx = {
  connect: connectDocxFile,
  disconnect: disconnectDocxFile,
  sync: syncDocxNow,
  getStatus: getDocxStatus,
  // Exposed so the viewer's "Export → Word" uses the exact same builder as
  // the auto-sync path — a downloaded file and a synced file are identical.
  buildBytes: buildDocxBytes,
};

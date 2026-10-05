import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import { PDFArray, PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const pagesEl = document.getElementById("pages");
const infoEl = document.getElementById("info");
const textFieldBtn = document.getElementById("text-field-btn");
const fileInput = document.getElementById("file");
const textOptions = document.getElementById("text-options");
const textColorEl = document.getElementById("text-color");
const fillColorEl = document.getElementById("fill-color");
const fillTransparentEl = document.getElementById("fill-transparent");
const fontSizeEl = document.getElementById("font-size");
const fontFamilyEl = document.getElementById("font-family");
const fontBoldEl = document.getElementById("font-bold");
const fontItalicEl = document.getElementById("font-italic");
const saveBtn = document.getElementById("save-btn");
const deleteBtn = document.getElementById("delete-btn");

// Must match the .text-box / .text-field CSS so the saved output lines up with the screen.
const BOX_INSET = 5;
const TEXT_PAD_X = 4;
const TEXT_PAD_Y = 2;
const FONT_SIZE = 14;
const LINE_HEIGHT = 1.2;

// Page dictionary entries that let a saved PDF's text fields be restored for editing.
const FIELDS_KEY = PDFName.of("PdfEditorFields");
const STREAMS_KEY = PDFName.of("PdfEditorStreams");
const CONTENTS_KEY = PDFName.of("Contents");

const CSS_FONTS = {
  Helvetica: "Helvetica, Arial, sans-serif",
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

// Indexed by [bold][italic].
const PDF_FONTS = {
  Helvetica: [[StandardFonts.Helvetica, StandardFonts.HelveticaOblique], [StandardFonts.HelveticaBold, StandardFonts.HelveticaBoldOblique]],
  Times: [[StandardFonts.TimesRoman, StandardFonts.TimesRomanItalic], [StandardFonts.TimesRomanBold, StandardFonts.TimesRomanBoldItalic]],
  Courier: [[StandardFonts.Courier, StandardFonts.CourierOblique], [StandardFonts.CourierBold, StandardFonts.CourierBoldOblique]],
};

let currentFile = null;

document.getElementById("open-btn").addEventListener("click", () => fileInput.click());

function setPlacing(on) {
  pagesEl.classList.toggle("placing", on);
  textFieldBtn.classList.toggle("active", on);
}

textFieldBtn.addEventListener("click", () => {
  setPlacing(!pagesEl.classList.contains("placing"));
});

// Percentages keep boxes anchored when the canvas is scaled down.
const pct = (value, total) => `${(value / total) * 100}%`;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function select(box) {
  for (const el of pagesEl.querySelectorAll(".text-box.selected")) {
    if (el === box) continue;
    el.classList.remove("selected");
    el.querySelector(".text-field").readOnly = true;
  }
  box?.classList.add("selected");

  textOptions.hidden = !box;
  if (!box) return;
  textColorEl.value = box.dataset.color;
  fillTransparentEl.checked = !box.dataset.fill;
  if (box.dataset.fill) fillColorEl.value = box.dataset.fill;
  fillColorEl.disabled = fillTransparentEl.checked;
  fontSizeEl.value = Math.round(box.dataset.maxSize);
  fontFamilyEl.value = box.dataset.font;
  fontBoldEl.checked = !!box.dataset.bold;
  fontItalicEl.checked = !!box.dataset.italic;
}

function applyStyle(box) {
  const field = box.querySelector(".text-field");
  field.style.color = box.dataset.color;
  field.style.backgroundColor = box.dataset.fill || "transparent";
  field.style.fontFamily = CSS_FONTS[box.dataset.font];
  field.style.fontWeight = box.dataset.bold ? "bold" : "normal";
  field.style.fontStyle = box.dataset.italic ? "italic" : "normal";
}

function updateSelectedStyle() {
  fillColorEl.disabled = fillTransparentEl.checked;
  const box = pagesEl.querySelector(".text-box.selected");
  if (!box) return;
  box.dataset.color = textColorEl.value;
  box.dataset.fill = fillTransparentEl.checked ? "" : fillColorEl.value;
  box.dataset.font = fontFamilyEl.value;
  box.dataset.bold = fontBoldEl.checked ? "1" : "";
  box.dataset.italic = fontItalicEl.checked ? "1" : "";
  const size = Number(fontSizeEl.value);
  if (size >= Number(fontSizeEl.min) && size <= Number(fontSizeEl.max)) box.dataset.maxSize = size;
  applyStyle(box);
  fitFontSize(box);
}

for (const el of [textColorEl, fillColorEl, fillTransparentEl, fontSizeEl, fontFamilyEl, fontBoldEl, fontItalicEl]) {
  el.addEventListener("input", updateSelectedStyle);
}

document.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#toolbar")) return;
  select(e.target.closest(".text-box"));
});

function deleteSelected() {
  const box = pagesEl.querySelector(".text-box.selected");
  if (!box) return;
  box.remove();
  select(null);
}

deleteBtn.addEventListener("click", deleteSelected);

// While typing, Backspace/Delete edit the text; Delete in an empty field removes it.
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest("input, textarea");
  const emptyField = e.target.classList.contains("text-field") && !e.target.value;
  if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
    deleteSelected();
  } else if (e.key === "Delete" && emptyField) {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target.classList.contains("text-field")) {
    // Shift+Enter falls through to the textarea's default newline.
    e.preventDefault();
    e.target.blur();
    select(null);
  }
});

function setBounds(box, { left, top, width, height }) {
  const pageW = box.parentElement.clientWidth;
  const pageH = box.parentElement.clientHeight;
  box.style.left = pct(left, pageW);
  box.style.top = pct(top, pageH);
  box.style.width = pct(width, pageW);
  box.style.height = pct(height, pageH);
}

function setFontSize(box, size) {
  box.dataset.size = size;
  box.querySelector(".text-field").style.fontSize = `${size}px`;
}

function createBox(pageEl, {
  left, top, width, height, text = "", size = FONT_SIZE, maxSize = FONT_SIZE,
  color = "#000000", fill = "", font = "Helvetica", bold = false, italic = false,
}) {
  const box = document.createElement("div");
  box.className = "text-box";
  box.dataset.color = color;
  box.dataset.fill = fill;
  box.dataset.maxSize = maxSize;
  box.dataset.font = font;
  box.dataset.bold = bold ? "1" : "";
  box.dataset.italic = italic ? "1" : "";

  const input = document.createElement("textarea");
  input.className = "text-field";
  input.value = text;

  const handle = document.createElement("div");
  handle.className = "resize-handle";

  box.append(input, handle);
  pageEl.appendChild(box);
  setBounds(box, { left, top, width, height });
  setFontSize(box, size);
  applyStyle(box);
  return box;
}

// Box padding/border plus textarea padding around one line of text.
const LINE_CHROME = 2 * (BOX_INSET + TEXT_PAD_Y);
const MIN_BOX = { width: 30, height: 16 };

// Largest font size, up to the chosen one, at which the whole text is visible in the box.
function fitFontSize(box) {
  const field = box.querySelector(".text-field");
  const fits = () => field.scrollHeight <= field.clientHeight && field.scrollWidth <= field.clientWidth;
  let lo = 1;
  let hi = Number(box.dataset.maxSize);
  setFontSize(box, hi);
  if (fits()) return;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    setFontSize(box, mid);
    if (fits()) lo = mid;
    else hi = mid;
  }
  setFontSize(box, lo);
}

pagesEl.addEventListener("keyup", (e) => {
  if (e.target.classList.contains("text-field") && !e.target.readOnly) fitFontSize(e.target.parentElement);
});

// Drag out a bounding box to place a field; a plain click places one at the default size.
pagesEl.addEventListener("pointerdown", (e) => {
  const pageEl = e.target.closest(".page");
  if (!pagesEl.classList.contains("placing") || !pageEl || e.target.closest(".text-box")) return;
  e.preventDefault();

  const rect = pageEl.getBoundingClientRect();
  const point = (ev) => ({
    x: clamp(ev.clientX - rect.left, 0, rect.width),
    y: clamp(ev.clientY - rect.top, 0, rect.height),
  });
  const start = point(e);
  const box = createBox(pageEl, { left: start.x, top: start.y, width: 0, height: 0 });
  box.classList.add("drawing");

  const onMove = (ev) => {
    const { x, y } = point(ev);
    setBounds(box, { left: Math.min(x, start.x), top: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
    fitFontSize(box);
  };

  pageEl.setPointerCapture(e.pointerId);
  pageEl.addEventListener("pointermove", onMove);
  pageEl.addEventListener("lostpointercapture", () => {
    pageEl.removeEventListener("pointermove", onMove);
    box.classList.remove("drawing");
    if (box.offsetWidth < MIN_BOX.width || box.offsetHeight < MIN_BOX.height) {
      setBounds(box, {
        left: start.x,
        top: start.y,
        width: Math.min(160, rect.width - start.x),
        height: Math.min(FONT_SIZE * LINE_HEIGHT + LINE_CHROME, rect.height - start.y),
      });
      setFontSize(box, FONT_SIZE);
    }
    select(box);
    box.querySelector(".text-field").focus();
    setPlacing(false);
  }, { once: true });
});

// Fields are read-only once deselected; double-click to edit their text again.
pagesEl.addEventListener("dblclick", (e) => {
  const field = e.target.closest(".text-box")?.querySelector(".text-field");
  if (!field) return;
  select(field.parentElement);
  field.readOnly = false;
  field.focus();
});

// Drag the box (or a read-only field) to move it, or the corner handle to resize it.
pagesEl.addEventListener("pointerdown", (e) => {
  const box = e.target.closest(".text-box");
  if (!box || (e.target.classList.contains("text-field") && !e.target.readOnly)) return;
  e.preventDefault();
  // preventDefault keeps focus in the textarea, which would swallow the Delete key.
  document.activeElement?.blur();

  const page = box.parentElement;
  const pageW = page.clientWidth;
  const pageH = page.clientHeight;
  const resizing = e.target.classList.contains("resize-handle");
  const start = { x: e.clientX, y: e.clientY, left: box.offsetLeft, top: box.offsetTop, width: box.offsetWidth, height: box.offsetHeight };

  const onMove = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (resizing) {
      box.style.width = pct(clamp(start.width + dx, 30, pageW - start.left), pageW);
      box.style.height = pct(clamp(start.height + dy, 16, pageH - start.top), pageH);
    } else {
      box.style.left = pct(clamp(start.left + dx, 0, pageW - start.width), pageW);
      box.style.top = pct(clamp(start.top + dy, 0, pageH - start.height), pageH);
    }
  };

  box.setPointerCapture(e.pointerId);
  box.addEventListener("pointermove", onMove);
  box.addEventListener("lostpointercapture", () => box.removeEventListener("pointermove", onMove), { once: true });
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  pagesEl.replaceChildren();
  select(null);
  saveBtn.disabled = true;
  infoEl.textContent = "Loading...";

  try {
    const { bytes, fields } = await extractFields(await file.arrayBuffer());
    // pdf.js detaches the buffer it receives, so keep the original for saving.
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    currentFile = { name: file.name, bytes };
    infoEl.textContent = `${file.name} - ${pdf.numPages} page(s)`;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const pageEl = document.createElement("div");
      pageEl.className = "page";
      pageEl.appendChild(canvas);
      pagesEl.appendChild(pageEl);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

      const s = (page.view[2] - page.view[0]) / pageEl.clientWidth;
      for (const f of fields[i - 1] ?? []) {
        const box = createBox(pageEl, {
          left: f.left / s - BOX_INSET,
          top: f.top / s - BOX_INSET,
          width: f.width / s + 2 * BOX_INSET,
          height: f.height / s + 2 * BOX_INSET,
          size: f.size / s,
          maxSize: (f.maxSize ?? f.size) / s,
          text: f.text,
          color: f.color,
          fill: f.fill,
          font: f.font,
          bold: f.bold,
          italic: f.italic,
        });
        box.querySelector(".text-field").readOnly = true;
      }
    }
    saveBtn.disabled = false;
  } catch (err) {
    infoEl.textContent = `Failed to open PDF: ${err.message}`;
  }
});

function contentRefs(page) {
  const contents = page.node.get(CONTENTS_KEY);
  if (contents instanceof PDFArray) return contents.asArray();
  return contents ? [contents] : [];
}

// Removes the drawn text fields of a PDF saved by this app and returns their data per page.
async function extractFields(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes);
  } catch {
    return { bytes, fields: [] };
  }

  const removed = new Set();
  const fields = doc.getPages().map((page) => {
    const json = page.node.lookupMaybe(FIELDS_KEY, PDFHexString);
    const streams = page.node.lookupMaybe(STREAMS_KEY, PDFArray)?.asArray() ?? [];
    const contents = page.node.lookup(CONTENTS_KEY);
    // Without a separable content array (e.g. rewritten by another tool) the fields stay flattened.
    if (!json || !(contents instanceof PDFArray)) return [];

    for (let i = contents.size() - 1; i >= 0; i--) {
      if (streams.includes(contents.get(i))) contents.remove(i);
    }
    streams.forEach((ref) => removed.add(ref));
    page.node.delete(FIELDS_KEY);
    page.node.delete(STREAMS_KEY);
    return JSON.parse(json.decodeText());
  });
  if (!removed.size && !fields.some((f) => f.length)) return { bytes, fields };

  const stillUsed = new Set(doc.getPages().flatMap(contentRefs));
  for (const ref of removed) {
    if (!stillUsed.has(ref)) doc.context.delete(ref);
  }
  return { bytes: await doc.save(), fields };
}

const hexToRgb = (hex) => rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));

async function buildPdf() {
  const doc = await PDFDocument.load(currentFile.bytes);
  const fonts = new Map();
  const embed = async (name) => {
    if (!fonts.has(name)) {
      const font = await doc.embedFont(name);
      fonts.set(name, { font, charset: new Set(font.getCharacterSet()) });
    }
    return fonts.get(name);
  };
  const pdfPages = doc.getPages();

  for (const [i, pageEl] of pagesEl.querySelectorAll(".page").entries()) {
    const page = pdfPages[i];
    const crop = page.getCropBox();
    const s = crop.width / pageEl.clientWidth;
    const before = new Set(contentRefs(page));
    const fields = [];

    for (const box of pageEl.querySelectorAll(".text-box")) {
      const x = crop.x + (box.offsetLeft + BOX_INSET) * s;
      const top = crop.y + crop.height - (box.offsetTop + BOX_INSET) * s;
      const width = (box.offsetWidth - 2 * BOX_INSET) * s;
      const height = (box.offsetHeight - 2 * BOX_INSET) * s;
      const size = Number(box.dataset.size) * s;
      const maxSize = Number(box.dataset.maxSize) * s;
      const value = box.querySelector(".text-field").value;
      const { color, fill } = box.dataset;
      const style = { font: box.dataset.font, bold: !!box.dataset.bold, italic: !!box.dataset.italic };
      fields.push({ left: x - crop.x, top: crop.y + crop.height - top, width, height, size, maxSize, text: value, color, fill, ...style });
      const { font, charset } = await embed(PDF_FONTS[style.font][+style.bold][+style.italic]);

      if (fill) {
        page.drawRectangle({ x, y: top - height, width, height, color: hexToRgb(fill) });
      }

      // Standard fonts only cover WinAnsi; replace anything else so drawText doesn't throw.
      const text = [...value].map((c) => (c === "\n" || charset.has(c.codePointAt(0)) ? c : "?")).join("");
      if (!text.trim()) continue;

      page.drawText(text, {
        x: x + TEXT_PAD_X * s,
        y: top - TEXT_PAD_Y * s - size,
        size,
        font,
        color: hexToRgb(color),
        lineHeight: size * LINE_HEIGHT,
        maxWidth: width - 2 * TEXT_PAD_X * s,
      });
    }

    if (!fields.length) continue;
    page.node.set(FIELDS_KEY, PDFHexString.fromText(JSON.stringify(fields)));
    page.node.set(STREAMS_KEY, doc.context.obj(contentRefs(page).filter((ref) => !before.has(ref))));
  }

  return doc.save();
}

saveBtn.addEventListener("click", async () => {
  const suggestedName = currentFile.name.replace(/\.pdf$/i, "") + "-edited.pdf";
  try {
    if (window.showSaveFilePicker) {
      // Open the picker first; it requires the click's user activation.
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(await buildPdf());
      await writable.close();
    } else {
      const url = URL.createObjectURL(new Blob([await buildPdf()], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (err) {
    if (err.name !== "AbortError") infoEl.textContent = `Failed to save PDF: ${err.message}`;
  }
});

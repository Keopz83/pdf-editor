import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import { PDFDocument, StandardFonts, rgb } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

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
const saveBtn = document.getElementById("save-btn");

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
    if (el !== box) el.classList.remove("selected");
  }
  box?.classList.add("selected");

  textOptions.hidden = !box;
  if (!box) return;
  textColorEl.value = box.dataset.color;
  fillTransparentEl.checked = !box.dataset.fill;
  if (box.dataset.fill) fillColorEl.value = box.dataset.fill;
  fillColorEl.disabled = fillTransparentEl.checked;
}

function applyStyle(box) {
  const field = box.querySelector(".text-field");
  field.style.color = box.dataset.color;
  field.style.backgroundColor = box.dataset.fill || "transparent";
}

function updateSelectedStyle() {
  fillColorEl.disabled = fillTransparentEl.checked;
  const box = pagesEl.querySelector(".text-box.selected");
  if (!box) return;
  box.dataset.color = textColorEl.value;
  box.dataset.fill = fillTransparentEl.checked ? "" : fillColorEl.value;
  applyStyle(box);
}

for (const el of [textColorEl, fillColorEl, fillTransparentEl]) {
  el.addEventListener("input", updateSelectedStyle);
}

document.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#toolbar")) return;
  select(e.target.closest(".text-box"));
});

pagesEl.addEventListener("click", (e) => {
  const pageEl = e.target.closest(".page");
  if (!pagesEl.classList.contains("placing") || !pageEl || e.target.closest(".text-box")) return;

  const rect = pageEl.getBoundingClientRect();
  const box = document.createElement("div");
  box.className = "text-box";
  box.style.left = pct(e.clientX - rect.left, rect.width);
  box.style.top = pct(e.clientY - rect.top, rect.height);
  box.style.width = pct(Math.min(160, rect.width), rect.width);
  box.style.height = pct(Math.min(32, rect.height), rect.height);
  box.dataset.color = "#000000";
  box.dataset.fill = "";

  const input = document.createElement("textarea");
  input.className = "text-field";

  const handle = document.createElement("div");
  handle.className = "resize-handle";

  box.append(input, handle);
  pageEl.appendChild(box);
  applyStyle(box);
  select(box);
  input.focus();
  setPlacing(false);
});

// Drag the box border to move it, or the corner handle to resize it.
pagesEl.addEventListener("pointerdown", (e) => {
  const box = e.target.closest(".text-box");
  if (!box || e.target.classList.contains("text-field")) return;
  e.preventDefault();

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
    const bytes = await file.arrayBuffer();
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
    }
    saveBtn.disabled = false;
  } catch (err) {
    infoEl.textContent = `Failed to open PDF: ${err.message}`;
  }
});

// Must match the .text-box / .text-field CSS so the saved output lines up with the screen.
const BOX_INSET = 5;
const TEXT_PAD_X = 4;
const TEXT_PAD_Y = 2;
const FONT_SIZE = 14;
const LINE_HEIGHT = 1.2;

const hexToRgb = (hex) => rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));

async function buildPdf() {
  const doc = await PDFDocument.load(currentFile.bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  const pdfPages = doc.getPages();

  pagesEl.querySelectorAll(".page").forEach((pageEl, i) => {
    const page = pdfPages[i];
    const crop = page.getCropBox();
    const s = crop.width / pageEl.clientWidth;

    for (const box of pageEl.querySelectorAll(".text-box")) {
      const x = crop.x + (box.offsetLeft + BOX_INSET) * s;
      const top = crop.y + crop.height - (box.offsetTop + BOX_INSET) * s;
      const width = (box.offsetWidth - 2 * BOX_INSET) * s;
      const height = (box.offsetHeight - 2 * BOX_INSET) * s;

      if (box.dataset.fill) {
        page.drawRectangle({ x, y: top - height, width, height, color: hexToRgb(box.dataset.fill) });
      }

      // Helvetica only covers WinAnsi; replace anything else so drawText doesn't throw.
      const text = [...box.querySelector(".text-field").value]
        .map((c) => (c === "\n" || charset.has(c.codePointAt(0)) ? c : "?"))
        .join("");
      if (!text.trim()) continue;

      const size = FONT_SIZE * s;
      page.drawText(text, {
        x: x + TEXT_PAD_X * s,
        y: top - TEXT_PAD_Y * s - size,
        size,
        font,
        color: hexToRgb(box.dataset.color),
        lineHeight: size * LINE_HEIGHT,
        maxWidth: width - 2 * TEXT_PAD_X * s,
      });
    }
  });

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

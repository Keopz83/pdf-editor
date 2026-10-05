import { DEFAULT_PDFIUM_WASM_URL, init } from "https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.1/dist/index.browser.js";

const TEXT_OBJECT = 1;
// PDF points around the pointer that still hit a character.
const HIT_TOLERANCE = 3;
// In font sizes: how far text objects of one editable run may be apart, and off each other's baseline.
const MAX_WORD_GAP = 1;
const MAX_BASELINE_OFFSET = 0.2;
// Font descriptor flags.
const FIXED_PITCH = 1;
const SERIF = 2;
const ITALIC = 1 << 6;
const FORCE_BOLD = 1 << 18;

// Indexed by [bold][italic].
const STANDARD_FONTS = {
  Helvetica: [["Helvetica", "Helvetica-Oblique"], ["Helvetica-Bold", "Helvetica-BoldOblique"]],
  Times: [["Times-Roman", "Times-Italic"], ["Times-Bold", "Times-BoldItalic"]],
  Courier: [["Courier", "Courier-Oblique"], ["Courier-Bold", "Courier-BoldOblique"]],
};

let loading = null;

// The WASM binary is several MB, so it's only fetched once text is first edited.
function load() {
  loading ??= (async () => {
    const res = await fetch(DEFAULT_PDFIUM_WASM_URL);
    if (!res.ok) throw new Error(`could not load PDFium (HTTP ${res.status})`);
    const m = await init({ wasmBinary: await res.arrayBuffer() });
    m.PDFiumExt_Init();
    return m;
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

function withMemory(m, sizes, fn) {
  const ptrs = sizes.map((size) => m.pdfium.wasmExports.malloc(size));
  try {
    return fn(...ptrs);
  } finally {
    ptrs.forEach((ptr) => m.pdfium.wasmExports.free(ptr));
  }
}

function withPage(m, bytes, pageIndex, fn) {
  const data = new Uint8Array(bytes);
  // PDFium reads from this buffer for as long as the document is open.
  return withMemory(m, [data.length], (buf) => {
    m.pdfium.HEAPU8.set(data, buf);
    const doc = m.FPDF_LoadMemDocument(buf, data.length, "");
    if (!doc) throw new Error(`PDFium could not load the document (error ${m.FPDF_GetLastError()})`);
    try {
      const page = m.FPDF_LoadPage(doc, pageIndex);
      if (!page) throw new Error(`PDFium could not load page ${pageIndex + 1}`);
      try {
        return fn(doc, page);
      } finally {
        m.FPDF_ClosePage(page);
      }
    } finally {
      m.FPDF_CloseDocument(doc);
    }
  });
}

function withTextPage(m, page, fn) {
  const textPage = m.FPDFText_LoadPage(page);
  try {
    return fn(textPage);
  } finally {
    m.FPDFText_ClosePage(textPage);
  }
}

function readText(m, page, obj) {
  return withTextPage(m, page, (textPage) => {
    const size = m.FPDFTextObj_GetText(obj, textPage, 0, 0);
    if (!size) return "";
    return withMemory(m, [size], (buf) => {
      m.FPDFTextObj_GetText(obj, textPage, buf, size);
      return m.pdfium.UTF16ToString(buf);
    });
  });
}

function setText(m, obj, text) {
  const size = (text.length + 1) * 2;
  return withMemory(m, [size], (buf) => {
    m.pdfium.stringToUTF16(text, buf, size);
    return m.FPDFText_SetText(obj, buf);
  });
}

const readFloats = (m, count, fn) =>
  withMemory(m, [count * 4], (buf) => {
    fn(...Array.from({ length: count }, (_, i) => buf + i * 4));
    return Array.from({ length: count }, (_, i) => m.pdfium.getValue(buf + i * 4, "float"));
  });

// Index among the page's top-level objects; text inside form XObjects isn't reachable this way.
function objectIndex(m, page, obj) {
  const count = m.FPDFPage_CountObjects(page);
  for (let i = 0; i < count; i++) {
    if (m.FPDFPage_GetObject(page, i) === obj) return i;
  }
  return -1;
}

function fontStyle(m, obj) {
  const font = m.FPDFTextObj_GetFont(obj);
  const length = m.FPDFFont_GetBaseFontName(font, 0, 0);
  const name = length ? withMemory(m, [length], (buf) => {
    m.FPDFFont_GetBaseFontName(font, buf, length);
    return m.pdfium.UTF8ToString(buf);
  }) : "";
  const flags = m.FPDFFont_GetFlags(font);
  return {
    font: flags & FIXED_PITCH || /courier|mono/i.test(name) ? "Courier"
      : flags & SERIF || /times|roman|georgia|garamond|(?<!sans-?)serif/i.test(name) ? "Times"
        : "Helvetica",
    bold: m.FPDFFont_GetWeight(font) >= 600 || !!(flags & FORCE_BOLD) || /bold|black|heavy/i.test(name),
    italic: !!(flags & ITALIC) || /italic|oblique/i.test(name),
  };
}

function textStyle(m, obj) {
  const [fontSize] = readFloats(m, 1, (ptr) => m.FPDFTextObj_GetFontSize(obj, ptr));
  const [a, b, c, d] = readFloats(m, 6, (ptr) => m.FPDFPageObj_GetMatrix(obj, ptr));
  const rgba = withMemory(m, [16], (ptr) => {
    m.FPDFPageObj_GetFillColor(obj, ptr, ptr + 4, ptr + 8, ptr + 12);
    return [0, 4, 8, 12].map((o) => m.pdfium.getValue(ptr + o, "i32"));
  });
  const size = fontSize * Math.sqrt(Math.abs(a * d - b * c));
  return {
    size,
    color: `#${rgba.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`,
    // Objects with the same key look alike, so they can be merged into one.
    key: [m.FPDFTextObj_GetFont(obj), size.toFixed(2), Math.atan2(b, a).toFixed(2), ...rgba, m.FPDFTextObj_GetTextRenderMode(obj)].join(),
  };
}

function placement(m, obj) {
  const [a, b, , , e, f] = readFloats(m, 6, (ptr) => m.FPDFPageObj_GetMatrix(obj, ptr));
  const [left, bottom, right, top] = readFloats(m, 4, (...ptrs) => m.FPDFPageObj_GetBounds(obj, ...ptrs));
  return { a, b, e, f, left, bottom, right, top };
}

// Whether two text objects are neighboring words or letters of the same line.
function adjacent(m, objA, objB, size) {
  const p = placement(m, objA);
  const q = placement(m, objB);
  const baselineOffset = Math.abs(p.a * (q.f - p.f) - p.b * (q.e - p.e)) / Math.hypot(p.a, p.b);
  const gap = Math.hypot(Math.max(0, q.left - p.right, p.left - q.right), Math.max(0, q.bottom - p.top, p.bottom - q.top));
  return baselineOffset <= size * MAX_BASELINE_OFFSET && gap <= size * MAX_WORD_GAP;
}

function pageText(m, textPage, start, count) {
  return withMemory(m, [(count + 1) * 2], (buf) => {
    m.FPDFText_GetText(textPage, start, count, buf);
    return m.pdfium.UTF16ToString(buf);
  });
}

// The text objects around the hit character that share its style and line, e.g. the words of a
// sentence that a PDF draws one by one, in reading order.
function findRun(m, textPage, hit) {
  const hitObj = m.FPDFText_GetTextObject(textPage, hit);
  if (!hitObj || m.FPDFPageObj_GetType(hitObj) !== TEXT_OBJECT) return null;
  const style = textStyle(m, hitObj);
  const count = m.FPDFText_CountChars(textPage);
  const objects = [hitObj];
  const extend = (step) => {
    let end = hit;
    let last = hitObj;
    for (let i = hit + step; i >= 0 && i < count; i += step) {
      // PDFium adds spaces for gaps between words, and line breaks.
      if (m.FPDFText_IsGenerated(textPage, i)) {
        if (m.FPDFText_GetUnicode(textPage, i) === 0x20) continue;
        break;
      }
      const obj = m.FPDFText_GetTextObject(textPage, i);
      if (obj !== last) {
        if (!obj || textStyle(m, obj).key !== style.key || !adjacent(m, last, obj, style.size)) break;
        if (!objects.includes(obj)) step > 0 ? objects.push(obj) : objects.unshift(obj);
        last = obj;
      }
      end = i;
    }
    return end;
  };
  const start = extend(-1);
  const end = extend(1);
  return { objects, style, text: pageText(m, textPage, start, end - start + 1) };
}

const sameText = (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

// Subset fonts only contain the glyphs the document used, so new characters may need a standard font.
function replaceWithStandardFont(m, doc, page, obj, index, text) {
  const { font, bold, italic } = fontStyle(m, obj);
  const standardFont = m.FPDFText_LoadStandardFont(doc, STANDARD_FONTS[font][+bold][+italic]);
  const [size] = readFloats(m, 1, (ptr) => m.FPDFTextObj_GetFontSize(obj, ptr));
  const replacement = m.FPDFPageObj_CreateTextObj(doc, standardFont, size);
  m.FPDFFont_Close(standardFont);
  setText(m, replacement, text);

  withMemory(m, [24], (matrix) => {
    m.FPDFPageObj_GetMatrix(obj, matrix);
    m.FPDFPageObj_SetMatrix(replacement, matrix);
  });
  withMemory(m, [16], (rgba) => {
    m.FPDFPageObj_GetFillColor(obj, rgba, rgba + 4, rgba + 8, rgba + 12);
    m.FPDFPageObj_SetFillColor(replacement, ...[0, 4, 8, 12].map((o) => m.pdfium.getValue(rgba + o, "i32")));
  });
  m.FPDFTextObj_SetTextRenderMode(replacement, m.FPDFTextObj_GetTextRenderMode(obj));

  m.FPDFPage_InsertObjectAtIndex(page, replacement, index);
  m.FPDFPage_RemoveObject(page, obj);
  m.FPDFPageObj_Destroy(obj);
  if (!sameText(readText(m, page, replacement), text)) {
    throw new Error("the text contains characters that neither the PDF's font nor a standard font can display");
  }
}

function save(m, doc) {
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    if (!m.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error("PDFium could not save the document");
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    return withMemory(m, [size], (buf) => {
      m.PDFiumExt_GetFileWriterData(writer, buf, size);
      return m.pdfium.HEAPU8.slice(buf, buf + size);
    });
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
}

// The run of same-style text at a point in PDF user space, or null if there is no text there.
export async function findText(bytes, pageIndex, x, y) {
  const m = await load();
  return withPage(m, bytes, pageIndex, (doc, page) => {
    const run = withTextPage(m, page, (textPage) => {
      const char = m.FPDFText_GetCharIndexAtPos(textPage, x, y, HIT_TOLERANCE, HIT_TOLERANCE);
      return char >= 0 ? findRun(m, textPage, char) : null;
    });
    if (!run) return null;
    const indices = run.objects.map((obj) => objectIndex(m, page, obj));
    if (indices.includes(-1)) throw new Error("text inside a form XObject isn't supported");

    const boxes = run.objects.map((obj) => placement(m, obj));
    return {
      indices,
      text: run.text,
      bounds: [
        Math.min(...boxes.map((b) => b.left)),
        Math.min(...boxes.map((b) => b.bottom)),
        Math.max(...boxes.map((b) => b.right)),
        Math.max(...boxes.map((b) => b.top)),
      ],
      size: run.style.size,
      color: run.style.color,
      ...fontStyle(m, run.objects[0]),
    };
  });
}

// Replaces the text of the page's objects at `indices` and returns the new document bytes.
// The first object takes the whole text and keeps its position; the others are removed.
export async function replaceText(bytes, pageIndex, indices, text) {
  const m = await load();
  return withPage(m, bytes, pageIndex, (doc, page) => {
    const [obj, ...rest] = indices.map((i) => m.FPDFPage_GetObject(page, i));
    for (const other of rest) {
      m.FPDFPage_RemoveObject(page, other);
      m.FPDFPageObj_Destroy(other);
    }
    const index = objectIndex(m, page, obj);
    if (!text.trim()) {
      m.FPDFPage_RemoveObject(page, obj);
      m.FPDFPageObj_Destroy(obj);
    } else {
      setText(m, obj, text);
      // Characters missing from the font's encoding read back differently.
      if (!sameText(readText(m, page, obj), text)) replaceWithStandardFont(m, doc, page, obj, index, text);
    }
    if (!m.FPDFPage_GenerateContent(page)) throw new Error("PDFium could not update the page");
    return save(m, doc);
  });
}

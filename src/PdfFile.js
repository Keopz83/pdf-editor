import { PageSizes, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";
import { LINE_HEIGHT, TEXT_PAD_X, TEXT_PAD_Y } from "./layout.js";

// Page dictionary entries that let a saved PDF's text fields be restored for editing.
const FIELDS_KEY = PDFName.of("PdfEditorFields");
const STREAMS_KEY = PDFName.of("PdfEditorStreams");
const IMAGES_KEY = PDFName.of("PdfEditorImages");
const CONTENTS_KEY = PDFName.of("Contents");
const XOBJECT_KEY = PDFName.of("XObject");
const SMASK_KEY = PDFName.of("SMask");

// Indexed by [bold][italic].
const PDF_FONTS = {
  Helvetica: [[StandardFonts.Helvetica, StandardFonts.HelveticaOblique], [StandardFonts.HelveticaBold, StandardFonts.HelveticaBoldOblique]],
  Times: [[StandardFonts.TimesRoman, StandardFonts.TimesRomanItalic], [StandardFonts.TimesRomanBold, StandardFonts.TimesRomanBoldItalic]],
  Courier: [[StandardFonts.Courier, StandardFonts.CourierOblique], [StandardFonts.CourierBold, StandardFonts.CourierBoldOblique]],
};

const hexToRgb = (hex) => rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));

function contentRefs(page) {
  const contents = page.node.get(CONTENTS_KEY);
  if (contents instanceof PDFArray) return contents.asArray();
  return contents ? [contents] : [];
}

function xobjectDict(page) {
  return page.node.Resources()?.lookupMaybe(XOBJECT_KEY, PDFDict);
}

// Removes the drawn text fields and signatures of a PDF saved by this app and returns their data per page.
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

    const images = page.node.lookupMaybe(IMAGES_KEY, PDFArray)?.asArray() ?? [];
    const xobjects = xobjectDict(page);
    for (const name of images) {
      const ref = xobjects?.get(name);
      if (ref) removed.add(ref);
      xobjects?.delete(name);
    }

    page.node.delete(FIELDS_KEY);
    page.node.delete(STREAMS_KEY);
    page.node.delete(IMAGES_KEY);
    return JSON.parse(json.decodeText());
  });
  if (!removed.size && !fields.some((f) => f.length)) return { bytes, fields };

  const stillUsed = new Set(doc.getPages().flatMap((page) => [...contentRefs(page), ...(xobjectDict(page)?.values() ?? [])]));
  for (const ref of removed) {
    if (stillUsed.has(ref)) continue;
    // Images keep their transparency in a separate soft mask object.
    const smask = doc.context.lookup(ref)?.dict?.get(SMASK_KEY);
    doc.context.delete(ref);
    if (smask) doc.context.delete(smask);
  }
  return { bytes: await doc.save(), fields };
}

// The opened document: its original bytes (without editable fields) and where to save it.
export class PdfFile {
  constructor(name, bytes, handle, fields) {
    this.name = name;
    this.bytes = bytes;
    this.handle = handle;
    // Editable fields found in the PDF, per page.
    this.fields = fields;
    // Counts edits of the document's own text, which replace `bytes`.
    this.revision = 0;
  }

  static async load(name, bytes, handle = null) {
    const extracted = await extractFields(bytes);
    return new PdfFile(name, extracted.bytes, handle, extracted.fields);
  }

  static async blank() {
    const doc = await PDFDocument.create();
    doc.addPage(PageSizes.A4);
    return doc.save();
  }

  // Draws the boxes of each Page into the PDF and stores them so they can be edited again.
  async build(pages) {
    const doc = await PDFDocument.load(this.bytes);
    const fonts = new Map();
    const embedFont = async (name) => {
      if (!fonts.has(name)) {
        const font = await doc.embedFont(name);
        fonts.set(name, { font, charset: new Set(font.getCharacterSet()) });
      }
      return fonts.get(name);
    };
    const images = new Map();
    const embedImage = async (src) => {
      if (!images.has(src)) images.set(src, await doc.embedPng(src));
      return images.get(src);
    };
    const pdfPages = doc.getPages();

    for (const [i, view] of pages.entries()) {
      const page = pdfPages[i];
      const crop = page.getCropBox();
      const s = crop.width / view.width;
      const before = new Set(contentRefs(page));
      const xobjectsBefore = new Set(xobjectDict(page)?.keys());
      const fields = view.boxes.map((box) => box.toField(s));

      for (const f of fields) {
        const x = crop.x + f.left;
        const top = crop.y + crop.height - f.top;

        if (f.type === "signature") {
          page.drawImage(await embedImage(f.src), { x, y: top - f.height, width: f.width, height: f.height });
          continue;
        }

        const { font, charset } = await embedFont(PDF_FONTS[f.font][+f.bold][+f.italic]);
        if (f.fill) {
          page.drawRectangle({ x, y: top - f.height, width: f.width, height: f.height, color: hexToRgb(f.fill) });
        }

        // Standard fonts only cover WinAnsi; replace anything else so drawText doesn't throw.
        const text = [...f.text].map((c) => (c === "\n" || charset.has(c.codePointAt(0)) ? c : "?")).join("");
        if (!text.trim()) continue;

        page.drawText(text, {
          x: x + TEXT_PAD_X * s,
          y: top - TEXT_PAD_Y * s - f.size,
          size: f.size,
          font,
          color: hexToRgb(f.color),
          lineHeight: f.size * LINE_HEIGHT,
          maxWidth: f.width - 2 * TEXT_PAD_X * s,
        });
      }

      if (!fields.length) continue;
      page.node.set(FIELDS_KEY, PDFHexString.fromText(JSON.stringify(fields)));
      page.node.set(STREAMS_KEY, doc.context.obj(contentRefs(page).filter((ref) => !before.has(ref))));
      const newImages = xobjectDict(page)?.keys().filter((name) => !xobjectsBefore.has(name)) ?? [];
      page.node.set(IMAGES_KEY, doc.context.obj(newImages));
    }

    return doc.save();
  }

  async writeTo(handle, pages) {
    const writable = await handle.createWritable();
    await writable.write(await this.build(pages));
    await writable.close();
  }

  async download(pages, name) {
    const url = URL.createObjectURL(new Blob([await this.build(pages)], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

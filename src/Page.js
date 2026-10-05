import { Box } from "./Box.js";
import { SignatureBox } from "./SignatureBox.js";
import { TextBox } from "./TextBox.js";

const pages = new WeakMap();

// A rendered PDF page holding the boxes placed on it.
export class Page {
  static of(el) {
    return pages.get(el?.closest(".page")) ?? null;
  }

  constructor(container) {
    this.canvas = document.createElement("canvas");
    this.el = document.createElement("div");
    this.el.className = "page";
    this.el.appendChild(this.canvas);
    container.appendChild(this.el);
    pages.set(this.el, this);
  }

  get width() {
    return this.el.clientWidth;
  }

  // Text fields first, so signatures are drawn on top of them in the saved PDF.
  get boxes() {
    return [...this.el.querySelectorAll(".text-box"), ...this.el.querySelectorAll(".signature-box")].map(Box.of);
  }

  // Renders the pdf.js page and restores the fields this app saved on it.
  async render(pdfPage, fields) {
    const viewport = pdfPage.getViewport({ scale: 1.5 });
    this.canvas.width = viewport.width;
    this.canvas.height = viewport.height;
    await pdfPage.render({ canvasContext: this.canvas.getContext("2d"), viewport }).promise;

    const s = (pdfPage.view[2] - pdfPage.view[0]) / this.width;
    for (const f of fields) {
      if (f.type === "signature") SignatureBox.fromField(this, f, s);
      else TextBox.fromField(this, f, s);
    }
  }
}

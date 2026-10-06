import { Box } from "./Box.js";
import { SignatureBox } from "./SignatureBox.js";
import { TextBox } from "./TextBox.js";

const pages = new WeakMap();

// A page outline with `sign` drawn inside it.
const pageIcon = (sign) =>
  '<svg class="page-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">' +
  `<path d="M3 1.5h6.5l3.5 3.5v9.5h-10z M9.5 1.5v3.5h3.5" fill="#fff"/><path d="${sign}" stroke-linecap="round"/></svg>`;

const PLUS = "M8 7v5M5.5 9.5h5";
const MINUS = "M5.5 9.5h5";

// A rendered PDF page holding the boxes placed on it.
export class Page {
  static of(el) {
    return pages.get(el?.closest(".page")) ?? null;
  }

  constructor(container, before = null) {
    this.canvas = document.createElement("canvas");
    this.el = document.createElement("div");
    this.el.className = "page";
    const actions = document.createElement("div");
    actions.className = "page-actions";
    actions.append(
      Page.button("add-page", "Insert blank page after", PLUS),
      Page.button("remove-page", "Remove page", MINUS),
    );
    this.el.append(this.canvas, actions);
    container.insertBefore(this.el, before);
    pages.set(this.el, this);
  }

  static button(className, label, sign) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = pageIcon(sign);
    return button;
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
    await this.renderCanvas(pdfPage);
    const s = (pdfPage.view[2] - pdfPage.view[0]) / this.width;
    for (const f of fields) {
      if (f.type === "signature") SignatureBox.fromField(this, f, s);
      else TextBox.fromField(this, f, s);
    }
  }

  // Draws into a fresh canvas that replaces the old one when done, so re-rendering doesn't flash.
  async renderCanvas(pdfPage) {
    const viewport = pdfPage.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    this.canvas.replaceWith(canvas);
    this.canvas = canvas;
    this.viewport = viewport;
  }

  // CSS pixels per PDF unit.
  get scale() {
    return (this.viewport.scale * this.width) / this.canvas.width;
  }

  toPdfPoint(e) {
    const rect = this.el.getBoundingClientRect();
    const k = this.canvas.width / rect.width;
    return this.viewport.convertToPdfPoint((e.clientX - rect.left) * k, (e.clientY - rect.top) * k);
  }

  // `bounds` is [left, bottom, right, top] in PDF user space.
  toScreenRect(bounds) {
    const [x1, y1, x2, y2] = this.viewport.convertToViewportRectangle(bounds);
    const k = this.width / this.canvas.width;
    return {
      left: Math.min(x1, x2) * k,
      top: Math.min(y1, y2) * k,
      width: Math.abs(x2 - x1) * k,
      height: Math.abs(y2 - y1) * k,
    };
  }
}

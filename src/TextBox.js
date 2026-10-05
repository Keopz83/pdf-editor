import { Box } from "./Box.js";
import { BOX_INSET, clamp, FONT_SIZE, LINE_HEIGHT, TEXT_PAD_Y } from "./layout.js";

export const CSS_FONTS = {
  Helvetica: "Helvetica, Arial, sans-serif",
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

// Box padding/border plus textarea padding around one line of text.
const LINE_CHROME = 2 * (BOX_INSET + TEXT_PAD_Y);
const MIN_BOX = { width: 30, height: 16 };

export class TextBox extends Box {
  constructor(page, {
    text = "", size = FONT_SIZE, maxSize = FONT_SIZE, color = "#000000", fill = "",
    font = "Helvetica", bold = false, italic = false, ...bounds
  }) {
    const field = document.createElement("textarea");
    field.className = "text-field";
    field.value = text;
    super(page, "text-box", field, bounds);
    this.field = field;
    Object.assign(this, { maxSize, color, fill, font, bold, italic });
    this.setFontSize(size);
    this.applyStyle();
    field.addEventListener("keyup", () => {
      if (this.editing) this.fit();
    });
  }

  // Drag out a bounding box to place a field; a plain click places one at the default size.
  static draw(page, e) {
    e.preventDefault();
    const rect = page.el.getBoundingClientRect();
    const point = (ev) => ({
      x: clamp(ev.clientX - rect.left, 0, rect.width),
      y: clamp(ev.clientY - rect.top, 0, rect.height),
    });
    const start = point(e);
    const box = new TextBox(page, { left: start.x, top: start.y, width: 0, height: 0 });
    box.el.classList.add("drawing");

    const onMove = (ev) => {
      const { x, y } = point(ev);
      box.setBounds({ left: Math.min(x, start.x), top: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
      box.fit();
    };

    page.el.setPointerCapture(e.pointerId);
    page.el.addEventListener("pointermove", onMove);
    return new Promise((resolve) => {
      page.el.addEventListener("lostpointercapture", () => {
        page.el.removeEventListener("pointermove", onMove);
        box.el.classList.remove("drawing");
        if (box.el.offsetWidth < MIN_BOX.width || box.el.offsetHeight < MIN_BOX.height) {
          box.setBounds({
            left: start.x,
            top: start.y,
            width: Math.min(160, rect.width - start.x),
            height: Math.min(FONT_SIZE * LINE_HEIGHT + LINE_CHROME, rect.height - start.y),
          });
          box.setFontSize(FONT_SIZE);
        }
        resolve(box);
      }, { once: true });
    });
  }

  // `s` converts screen pixels to PDF units.
  static fromField(page, f, s) {
    const box = new TextBox(page, {
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
    box.field.readOnly = true;
    return box;
  }

  toField(s) {
    const { el, size, maxSize, color, fill, font, bold, italic } = this;
    return {
      left: (el.offsetLeft + BOX_INSET) * s,
      top: (el.offsetTop + BOX_INSET) * s,
      width: (el.offsetWidth - 2 * BOX_INSET) * s,
      height: (el.offsetHeight - 2 * BOX_INSET) * s,
      size: size * s,
      maxSize: maxSize * s,
      text: this.field.value,
      color,
      fill,
      font,
      bold,
      italic,
    };
  }

  get state() {
    const { size, maxSize, color, fill, font, bold, italic } = this;
    return { ...super.state, text: this.field.value, size, maxSize, color, fill, font, bold, italic };
  }

  get editing() {
    return !this.field.readOnly;
  }

  // Fields are read-only once deselected; this makes the text writable again.
  edit() {
    this.field.readOnly = false;
    this.field.focus();
  }

  setSelected(on) {
    super.setSelected(on);
    if (!on) this.field.readOnly = true;
  }

  setStyle(style) {
    Object.assign(this, style);
    this.applyStyle();
    this.fit();
  }

  applyStyle() {
    Object.assign(this.field.style, {
      color: this.color,
      backgroundColor: this.fill || "transparent",
      fontFamily: CSS_FONTS[this.font],
      fontWeight: this.bold ? "bold" : "normal",
      fontStyle: this.italic ? "italic" : "normal",
    });
  }

  setFontSize(size) {
    this.size = size;
    this.el.dataset.size = size;
    this.field.style.fontSize = `${size}px`;
  }

  // Largest font size, up to the chosen one, at which the whole text is visible in the box.
  fit() {
    const { field } = this;
    const fits = () => field.scrollHeight <= field.clientHeight && field.scrollWidth <= field.clientWidth;
    let lo = 1;
    let hi = this.maxSize;
    this.setFontSize(hi);
    if (fits()) return;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      this.setFontSize(mid);
      if (fits()) lo = mid;
      else hi = mid;
    }
    this.setFontSize(lo);
  }

  drag(e) {
    // An editable field keeps the pointer for selecting text.
    if (e.target === this.field && this.editing) return;
    super.drag(e);
  }
}

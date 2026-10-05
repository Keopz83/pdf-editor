import { Box } from "./Box.js";
import { clamp, pct } from "./layout.js";

const PNG_DATA_URL = "data:image/png;base64,";

// Paints every stroke pixel in the color while keeping its alpha, so the background stays transparent.
async function recolor(src, color) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export class SignatureBox extends Box {
  constructor(page, { src, color = "#000000", ...bounds }) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Signature";
    img.draggable = false;
    super(page, "signature-box", img, bounds);
    this.img = img;
    this.ratio = bounds.width / bounds.height;
    this.color = color;
  }

  // `s` converts screen pixels to PDF units.
  static fromField(page, f, s) {
    // Only accept embedded PNGs so a crafted PDF can't point the image at a remote URL.
    if (typeof f.src !== "string" || !f.src.startsWith(PNG_DATA_URL)) return null;
    return new SignatureBox(page, { left: f.left / s, top: f.top / s, width: f.width / s, height: f.height / s, src: f.src, color: f.color });
  }

  toField(s) {
    const { el } = this;
    return {
      type: "signature",
      left: el.offsetLeft * s,
      top: el.offsetTop * s,
      width: el.offsetWidth * s,
      height: el.offsetHeight * s,
      src: this.img.src,
      color: this.color,
    };
  }

  get state() {
    return { ...super.state, src: this.img.src, color: this.color };
  }

  async setColor(color) {
    this.color = color;
    const src = await recolor(this.img.src, color);
    // Ignore results overtaken by a newer color pick.
    if (this.color === color) this.img.src = src;
  }

  // Signatures keep their aspect ratio.
  resize(start, dx) {
    const width = clamp(start.width + dx, 30, Math.min(start.pageW - start.left, (start.pageH - start.top) * this.ratio));
    this.el.style.width = pct(width, start.pageW);
    this.el.style.height = pct(width / this.ratio, start.pageH);
  }
}

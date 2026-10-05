import { SignatureBox } from "./SignatureBox.js";
import { TextBox } from "./TextBox.js";

const $ = (id) => document.getElementById(id);

const BASIC_COLORS = {
  Black: "#000000", Gray: "#808080", White: "#ffffff", Red: "#ff0000",
  Orange: "#ff8000", Yellow: "#ffff00", Green: "#008000", Blue: "#0000ff",
};

// Toolbar controls that show and change the style of the selected box.
export class OptionsPanel {
  box = null;

  constructor() {
    this.textOptions = $("text-options");
    this.textColor = $("text-color");
    this.fillColor = $("fill-color");
    this.fillTransparent = $("fill-transparent");
    this.fontSize = $("font-size");
    this.fontFamily = $("font-family");
    this.fontBold = $("font-bold");
    this.fontItalic = $("font-italic");
    this.signatureOptions = $("signature-options");
    this.signatureColor = $("signature-color");

    for (const el of [this.textColor, this.fillColor, this.fillTransparent, this.fontSize, this.fontFamily, this.fontBold, this.fontItalic]) {
      el.addEventListener("input", () => this.updateText());
    }
    this.signatureColor.addEventListener("input", () => {
      if (this.box instanceof SignatureBox) this.box.setColor(this.signatureColor.value);
    });
    for (const container of document.querySelectorAll(".swatches")) {
      this.addSwatches(container, $(container.dataset.for));
    }
  }

  addSwatches(container, input) {
    for (const [name, color] of Object.entries(BASIC_COLORS)) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch";
      swatch.title = name;
      swatch.setAttribute("aria-label", name);
      swatch.style.backgroundColor = color;
      swatch.addEventListener("click", () => {
        if (input === this.fillColor) this.fillTransparent.checked = false;
        input.value = color;
        input.dispatchEvent(new Event("input"));
      });
      container.appendChild(swatch);
    }
  }

  show(box) {
    this.box = box;
    const isText = box instanceof TextBox;
    const isSignature = box instanceof SignatureBox;
    this.textOptions.hidden = !isText;
    this.signatureOptions.hidden = !isSignature;
    if (isSignature) this.signatureColor.value = box.color;
    if (!isText) return;
    this.textColor.value = box.color;
    this.fillTransparent.checked = !box.fill;
    if (box.fill) this.fillColor.value = box.fill;
    this.fillColor.disabled = this.fillTransparent.checked;
    this.fontSize.value = Math.round(box.maxSize);
    this.fontFamily.value = box.font;
    this.fontBold.checked = !!box.bold;
    this.fontItalic.checked = !!box.italic;
  }

  updateText() {
    this.fillColor.disabled = this.fillTransparent.checked;
    const { box } = this;
    if (!(box instanceof TextBox)) return;
    const size = Number(this.fontSize.value);
    const validSize = size >= Number(this.fontSize.min) && size <= Number(this.fontSize.max);
    box.setStyle({
      color: this.textColor.value,
      fill: this.fillTransparent.checked ? "" : this.fillColor.value,
      font: this.fontFamily.value,
      bold: this.fontBold.checked,
      italic: this.fontItalic.checked,
      maxSize: validSize ? size : box.maxSize,
    });
  }
}

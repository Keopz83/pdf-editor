import { CSS_FONTS } from "./TextBox.js";

// An input over a text object of the page that hides the original text while it's edited.
export class TextObjectInput {
  constructor(page, found) {
    const { left, top, width, height } = page.toScreenRect(found.bounds);
    const fontSize = found.size * page.scale;
    // The bounds hug the glyphs; leave room for the full line so nothing is clipped.
    const lineHeight = Math.max(height, fontSize * 1.2);
    const input = document.createElement("input");
    input.className = "text-object-input";
    input.value = found.text;
    input.spellcheck = false;
    Object.assign(input.style, {
      left: `${left}px`,
      top: `${top - (lineHeight - height) / 2}px`,
      minWidth: `${width}px`,
      height: `${lineHeight}px`,
      fontSize: `${fontSize}px`,
      fontFamily: CSS_FONTS[found.font],
      fontWeight: found.bold ? "bold" : "normal",
      fontStyle: found.italic ? "italic" : "normal",
      color: found.color,
    });
    page.el.appendChild(input);
    this.el = input;

    let cancelled = false;
    // Resolves to the edited text, or null if editing was cancelled with Escape.
    this.result = new Promise((resolve) => {
      input.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        if (e.key === "Escape") cancelled = true;
        if (e.key === "Enter" || e.key === "Escape") input.blur();
      });
      input.addEventListener("blur", () => resolve(cancelled ? null : input.value), { once: true });
    });
    input.focus();
    input.select();
  }

  remove() {
    this.el.remove();
  }
}

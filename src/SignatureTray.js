import { clamp } from "./layout.js";
import { Page } from "./Page.js";
import { SignatureBox } from "./SignatureBox.js";

const SIGNATURE_WIDTH = 150;

// The toolbar preview of the drawn signature, which can be dragged onto pages.
export class SignatureTray {
  constructor(onPlace) {
    this.tray = document.getElementById("signature-tray");
    this.preview = document.getElementById("signature-preview");
    this.onPlace = onPlace;
    this.preview.addEventListener("pointerdown", (e) => this.drag(e));
  }

  show(src) {
    this.preview.src = src;
    this.tray.hidden = false;
  }

  drag(e) {
    e.preventDefault();
    const { preview } = this;
    const ratio = preview.naturalWidth / preview.naturalHeight;
    const ghost = document.createElement("img");
    ghost.className = "signature-ghost";
    ghost.src = preview.src;
    ghost.alt = "";
    ghost.style.width = `${SIGNATURE_WIDTH}px`;
    ghost.style.height = `${SIGNATURE_WIDTH / ratio}px`;
    document.body.appendChild(ghost);

    const onMove = (ev) => {
      ghost.style.left = `${ev.clientX - SIGNATURE_WIDTH / 2}px`;
      ghost.style.top = `${ev.clientY - SIGNATURE_WIDTH / ratio / 2}px`;
    };
    const onDrop = (ev) => {
      const page = Page.of(document.elementFromPoint(ev.clientX, ev.clientY));
      if (!page) return;
      const rect = page.el.getBoundingClientRect();
      const width = Math.min(SIGNATURE_WIDTH, rect.width, rect.height * ratio);
      const height = width / ratio;
      this.onPlace(new SignatureBox(page, {
        left: clamp(ev.clientX - rect.left - width / 2, 0, rect.width - width),
        top: clamp(ev.clientY - rect.top - height / 2, 0, rect.height - height),
        width,
        height,
        src: preview.src,
      }));
    };
    onMove(e);

    preview.setPointerCapture(e.pointerId);
    preview.addEventListener("pointermove", onMove);
    preview.addEventListener("pointerup", onDrop, { once: true });
    preview.addEventListener("lostpointercapture", () => {
      preview.removeEventListener("pointermove", onMove);
      preview.removeEventListener("pointerup", onDrop);
      ghost.remove();
    }, { once: true });
  }
}

import { clamp, pct } from "./layout.js";

const boxes = new WeakMap();

// A movable, resizable element placed on a page.
export class Box {
  static of(el) {
    return boxes.get(el?.closest(".box")) ?? null;
  }

  constructor(page, className, content, bounds) {
    this.page = page;
    this.el = document.createElement("div");
    this.el.className = `box ${className}`;
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    this.el.append(content, handle);
    page.el.appendChild(this.el);
    boxes.set(this.el, this);
    this.setBounds(bounds);
  }

  // Compared between saves to detect unsaved changes.
  get state() {
    return { bounds: this.el.style.cssText };
  }

  setBounds({ left, top, width, height }) {
    const { clientWidth: w, clientHeight: h } = this.page.el;
    Object.assign(this.el.style, { left: pct(left, w), top: pct(top, h), width: pct(width, w), height: pct(height, h) });
  }

  setSelected(on) {
    this.el.classList.toggle("selected", on);
  }

  remove() {
    this.el.remove();
  }

  // Drag the box to move it, or the corner handle to resize it.
  drag(e) {
    e.preventDefault();
    // preventDefault keeps focus in the textarea, which would swallow the Delete key.
    document.activeElement?.blur();

    const { el } = this;
    const resizing = e.target.classList.contains("resize-handle");
    const start = {
      x: e.clientX,
      y: e.clientY,
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
      pageW: this.page.el.clientWidth,
      pageH: this.page.el.clientHeight,
    };

    const onMove = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (resizing) {
        this.resize(start, dx, dy);
      } else {
        el.style.left = pct(clamp(start.left + dx, 0, start.pageW - start.width), start.pageW);
        el.style.top = pct(clamp(start.top + dy, 0, start.pageH - start.height), start.pageH);
      }
    };

    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("lostpointercapture", () => el.removeEventListener("pointermove", onMove), { once: true });
  }

  resize(start, dx, dy) {
    this.el.style.width = pct(clamp(start.width + dx, 30, start.pageW - start.left), start.pageW);
    this.el.style.height = pct(clamp(start.height + dy, 16, start.pageH - start.top), start.pageH);
  }
}

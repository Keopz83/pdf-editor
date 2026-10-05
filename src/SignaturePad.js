const $ = (id) => document.getElementById(id);

// The dialog in which the user draws a signature.
export class SignaturePad {
  strokes = [];
  result = null;

  constructor() {
    this.dialog = $("signature-dialog");
    this.canvas = $("signature-pad");
    this.ctx = this.canvas.getContext("2d");
    this.smoothing = $("signature-smoothing");
    this.doneBtn = $("signature-done");

    this.smoothing.addEventListener("input", () => this.redraw());
    this.canvas.addEventListener("pointerdown", (e) => this.stroke(e));
    $("signature-clear").addEventListener("click", () => this.clear());
    $("signature-cancel").addEventListener("click", () => this.dialog.close());
    this.doneBtn.addEventListener("click", () => {
      this.result = this.trimmed();
      this.dialog.close();
    });
  }

  // Resolves to the signature as a PNG data URL, or null if nothing was drawn or the dialog was cancelled.
  open() {
    this.result = null;
    this.clear();
    this.dialog.showModal();
    return new Promise((resolve) => {
      this.dialog.addEventListener("close", () => resolve(this.result), { once: true });
    });
  }

  clear() {
    this.strokes = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.doneBtn.disabled = true;
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokes.forEach((points) => this.drawSmooth(points));
  }

  stroke(e) {
    e.preventDefault();
    const { canvas, ctx } = this;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const point = (ev) => [(ev.clientX - rect.left) * scale, (ev.clientY - rect.top) * scale];
    Object.assign(ctx, { lineWidth: 3 * scale, lineCap: "round", lineJoin: "round", strokeStyle: "#000" });

    const points = [point(e)];
    const segmentTo = (ev) => {
      const next = point(ev);
      ctx.beginPath();
      ctx.moveTo(...points.at(-1));
      ctx.lineTo(...next);
      ctx.stroke();
      points.push(next);
    };
    segmentTo(e);
    this.doneBtn.disabled = false;

    const onMove = (ev) => (ev.getCoalescedEvents?.() ?? [ev]).forEach(segmentTo);
    canvas.setPointerCapture(e.pointerId);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("lostpointercapture", () => {
      canvas.removeEventListener("pointermove", onMove);
      this.strokes.push(points);
      this.redraw();
    }, { once: true });
  }

  // Redraws a finished stroke with a light moving average and curves through the midpoints.
  drawSmooth(points) {
    const { ctx } = this;
    const radius = Number(this.smoothing.value);
    if (radius === 0) {
      ctx.beginPath();
      ctx.moveTo(...points[0]);
      points.forEach((p) => ctx.lineTo(...p));
      ctx.stroke();
      return;
    }
    const smoothed = points.map((p, i) => {
      if (i === 0 || i === points.length - 1) return p;
      const near = points.slice(Math.max(0, i - radius), i + radius + 1);
      return [0, 1].map((k) => near.reduce((sum, q) => sum + q[k], 0) / near.length);
    });
    ctx.beginPath();
    ctx.moveTo(...smoothed[0]);
    for (let i = 1; i < smoothed.length - 1; i++) {
      const [x, y] = smoothed[i];
      const [nx, ny] = smoothed[i + 1];
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    ctx.lineTo(...smoothed.at(-1));
    ctx.stroke();
  }

  // Crops the drawing to its strokes; the unpainted canvas stays transparent in the PNG.
  trimmed() {
    const { width, height } = this.canvas;
    const { data } = this.ctx.getImageData(0, 0, width, height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!data[(y * width + x) * 4 + 3]) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) return null;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d").drawImage(this.canvas, minX, minY, w, h, 0, 0, w, h);
    return out.toDataURL("image/png");
  }
}

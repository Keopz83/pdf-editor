import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const pagesEl = document.getElementById("pages");
const infoEl = document.getElementById("info");
const textFieldBtn = document.getElementById("text-field-btn");
const fileInput = document.getElementById("file");

document.getElementById("open-btn").addEventListener("click", () => fileInput.click());

function setPlacing(on) {
  pagesEl.classList.toggle("placing", on);
  textFieldBtn.classList.toggle("active", on);
}

textFieldBtn.addEventListener("click", () => {
  setPlacing(!pagesEl.classList.contains("placing"));
});

pagesEl.addEventListener("click", (e) => {
  const pageEl = e.target.closest(".page");
  if (!pagesEl.classList.contains("placing") || !pageEl || e.target.tagName === "INPUT") return;

  const rect = pageEl.getBoundingClientRect();
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-field";
  // Percentages keep the field anchored when the canvas is scaled down.
  input.style.left = `${((e.clientX - rect.left) / rect.width) * 100}%`;
  input.style.top = `${((e.clientY - rect.top) / rect.height) * 100}%`;
  pageEl.appendChild(input);
  input.focus();
  setPlacing(false);
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  pagesEl.replaceChildren();
  infoEl.textContent = "Loading...";

  try {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    infoEl.textContent = `${file.name} - ${pdf.numPages} page(s)`;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const pageEl = document.createElement("div");
      pageEl.className = "page";
      pageEl.appendChild(canvas);
      pagesEl.appendChild(pageEl);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    }
  } catch (err) {
    infoEl.textContent = `Failed to open PDF: ${err.message}`;
  }
});

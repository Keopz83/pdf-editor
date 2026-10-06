import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import { Box } from "./Box.js";
import { OptionsPanel } from "./OptionsPanel.js";
import { Page } from "./Page.js";
import { PdfFile } from "./PdfFile.js";
import { findText, replaceText } from "./pdfium.js";
import { SignaturePad } from "./SignaturePad.js";
import { SignatureTray } from "./SignatureTray.js";
import { TextBox } from "./TextBox.js";
import { TextObjectInput } from "./TextObjectInput.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const PDF_TYPES = [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }];

const $ = (id) => document.getElementById(id);

// Opens, edits and saves one document at a time.
export class Editor {
  file = null;
  pages = [];
  selected = null;
  // State of the boxes when the document was last opened or saved, to detect unsaved changes.
  savedSnapshot = "";
  // Changes to the document bytes and the re-renders after them, in order.
  edits = Promise.resolve();

  constructor() {
    this.pagesEl = $("pages");
    this.infoEl = $("info");
    this.fileInput = $("file");
    this.textFieldBtn = $("text-field-btn");
    this.saveBtn = $("save-btn");
    this.saveAsBtn = $("save-as-btn");
    this.closeBtn = $("close-btn");
    this.deleteBtn = $("delete-btn");
    this.addPageBtn = $("add-page-btn");
    this.removePageBtn = $("remove-page-btn");
    this.pageNumberEl = $("page-number");
    this.closeDialog = $("close-dialog");
    this.options = new OptionsPanel();
    this.signaturePad = new SignaturePad();
    this.signatureTray = new SignatureTray((box) => this.select(box));

    $("new-btn").addEventListener("click", () => this.newPdf());
    $("open-btn").addEventListener("click", () => this.openPicker());
    $("start-new").addEventListener("click", () => this.newPdf());
    $("start-open").addEventListener("click", () => this.openPicker());
    $("signature-btn").addEventListener("click", () => this.addSignature());
    this.fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this.open(file.name, () => file.arrayBuffer());
    });
    this.saveBtn.addEventListener("click", () => this.save());
    this.saveAsBtn.addEventListener("click", () => this.saveAs());
    this.closeBtn.addEventListener("click", async () => {
      if (await this.confirmClose()) this.close();
    });
    this.textFieldBtn.addEventListener("click", () => this.setPlacing(!this.placing));
    this.deleteBtn.addEventListener("click", () => this.deleteSelected());
    this.addPageBtn.addEventListener("click", () => this.addPage(this.currentPage));
    this.removePageBtn.addEventListener("click", () => this.removePage(this.currentPage));

    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest("#toolbar, dialog")) this.select(Box.of(e.target));
    });
    document.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.pagesEl.addEventListener("pointerdown", (e) => this.onPagePointerDown(e));
    this.pagesEl.addEventListener("scroll", () => this.updatePageControls(), { passive: true });
    this.pagesEl.addEventListener("click", (e) => {
      // The second click of a double-click would act again, possibly on a page moved into place.
      if (e.detail > 1) return;
      if (e.target.closest(".remove-page")) this.removePage(Page.of(e.target));
      else if (e.target.closest(".add-page")) this.addPage(Page.of(e.target));
    });
    this.pagesEl.addEventListener("dblclick", (e) => {
      const box = Box.of(e.target);
      const page = Page.of(e.target);
      if (box instanceof TextBox) {
        this.select(box);
        box.edit();
      } else if (page && e.target === page.canvas && !this.placing) {
        this.editPageText(page, e);
      }
    });
  }

  setDocumentOpen(open) {
    document.body.classList.toggle("no-document", !open);
  }

  get placing() {
    return this.pagesEl.classList.contains("placing");
  }

  setPlacing(on) {
    this.pagesEl.classList.toggle("placing", on);
    this.textFieldBtn.classList.toggle("active", on);
  }

  select(box) {
    if (this.selected !== box) this.selected?.setSelected(false);
    this.selected = box;
    box?.setSelected(true);
    this.deleteBtn.hidden = !box;
    this.options.show(box);
    this.updatePageControls();
  }

  deleteSelected() {
    if (!this.selected) return;
    this.selected.remove();
    this.select(null);
  }

  // Moves a box, or places a new text field in placing mode.
  async onPagePointerDown(e) {
    if (e.target.closest(".page-actions")) return;
    const box = Box.of(e.target);
    const page = Page.of(e.target);
    if (box) {
      box.drag(e);
    } else if (page && this.placing) {
      const placed = await TextBox.draw(page, e);
      this.select(placed);
      placed.edit();
      this.setPlacing(false);
    }
  }

  // While typing, Backspace/Delete edit the text; Delete in an empty field removes it.
  onKeyDown(e) {
    if (document.querySelector("dialog[open]")) return;
    const typing = e.target.closest("input, textarea");
    const inField = e.target.classList.contains("text-field");
    if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
      this.deleteSelected();
    } else if (e.key === "Delete" && inField && !e.target.value) {
      e.preventDefault();
      this.deleteSelected();
    } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing && inField) {
      // Shift+Enter falls through to the textarea's default newline.
      e.preventDefault();
      e.target.blur();
      this.select(null);
    }
  }

  // Edits the document's own text under the pointer, e.g. of PDFs without form fields.
  async editPageText(page, e) {
    const { file } = this;
    const [x, y] = page.toPdfPoint(e);
    let input = null;
    try {
      const found = await this.queue(() => {
        const index = this.pages.indexOf(page);
        return index < 0 ? null : findText(file.bytes, index, x, y);
      });
      if (!found || this.file !== file) return;
      input = new TextObjectInput(page, found);
      const text = await input.result;
      if (text === null || text === found.text || this.file !== file) return;

      await this.queue(async () => {
        const index = this.pages.indexOf(page);
        if (this.file !== file || index < 0) return;
        file.bytes = await replaceText(file.bytes, index, found.indices, text);
        file.revision++;
        await this.renderPage(file, page);
      });
    } catch (err) {
      if (this.file === file) this.infoEl.textContent = `Failed to edit text: ${err.message}`;
    } finally {
      // Removed only after re-rendering, so the old text doesn't flash up.
      input?.remove();
    }
  }

  // The selected box's page, otherwise the page taking up most of the view.
  get currentPage() {
    if (this.selected) return this.selected.page;
    const view = this.pagesEl.getBoundingClientRect();
    let current = null;
    let mostVisible = -Infinity;
    for (const page of this.pages) {
      const rect = page.el.getBoundingClientRect();
      const visible = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
      if (visible > mostVisible) [current, mostVisible] = [page, visible];
    }
    return current;
  }

  updatePageControls() {
    this.addPageBtn.disabled = !this.pages.length;
    this.removePageBtn.disabled = this.pages.length < 2;
    const current = this.pages.indexOf(this.currentPage) + 1;
    this.pageNumberEl.textContent = current ? `${current} / ${this.pages.length}` : "";
  }

  queue(fn) {
    const run = this.edits.then(fn);
    this.edits = run.catch(() => {});
    return run;
  }

  // Removes the page from the document bytes first, so page indices stay in sync with them.
  async removePage(page) {
    const { file } = this;
    try {
      await this.queue(async () => {
        const index = this.pages.indexOf(page);
        if (this.file !== file || index < 0 || this.pages.length < 2) return;
        await file.removePage(index);
        if (this.file !== file) return;
        if (this.selected?.page === page) this.select(null);
        this.pages.splice(index, 1);
        page.el.remove();
        this.updatePageControls();
        this.infoEl.textContent = `${file.name} - ${this.pages.length} page(s)`;
      });
    } catch (err) {
      if (this.file === file) this.infoEl.textContent = `Failed to remove page: ${err.message}`;
    }
  }

  // Inserts a blank page of the same size after `page`.
  async addPage(page) {
    const { file } = this;
    try {
      await this.queue(async () => {
        const index = this.pages.indexOf(page) + 1;
        if (this.file !== file || !index) return;
        await file.insertBlankPage(index);
        if (this.file !== file) return;
        const added = new Page(this.pagesEl, page.el.nextSibling);
        this.pages.splice(index, 0, added);
        this.infoEl.textContent = `${file.name} - ${this.pages.length} page(s)`;
        await this.renderPage(file, added);
        // After rendering, once the new page has its final size.
        this.updatePageControls();
      });
    } catch (err) {
      if (this.file === file) this.infoEl.textContent = `Failed to add page: ${err.message}`;
    }
  }

  async renderPage(file, page) {
    if (this.file !== file) return;
    const pdf = await pdfjsLib.getDocument({ data: file.bytes.slice(0) }).promise;
    try {
      await page.renderCanvas(await pdf.getPage(this.pages.indexOf(page) + 1));
    } finally {
      pdf.destroy();
    }
  }

  async addSignature() {
    this.setPlacing(false);
    const src = await this.signaturePad.open();
    if (src) this.signatureTray.show(src);
  }

  snapshot() {
    const boxes = this.pages.flatMap((page) => page.boxes).map((box) => box.state);
    return JSON.stringify({ revision: this.file?.revision, boxes });
  }

  markSaved() {
    this.savedSnapshot = this.snapshot();
  }

  askToSave() {
    $("close-name").textContent = this.file.name;
    this.closeDialog.returnValue = "";
    this.closeDialog.showModal();
    return new Promise((resolve) => {
      this.closeDialog.addEventListener("close", () => resolve(this.closeDialog.returnValue), { once: true });
    });
  }

  // Resolves to false if the user cancels or saving fails.
  async confirmClose() {
    if (!this.file || this.snapshot() === this.savedSnapshot) return true;
    const choice = await this.askToSave();
    if (choice === "save") return this.save();
    if (choice === "save-as") return this.saveAs();
    return choice === "discard";
  }

  async newPdf() {
    if (!(await this.confirmClose())) return;
    this.open("Untitled.pdf", () => PdfFile.blank());
  }

  async openPicker() {
    if (!(await this.confirmClose())) return;
    if (!window.showOpenFilePicker) {
      this.fileInput.click();
      return;
    }
    try {
      // Unlike the file input, a picker handle lets Save write back to the opened file.
      const [handle] = await window.showOpenFilePicker({ types: PDF_TYPES });
      const file = await handle.getFile();
      this.open(file.name, () => file.arrayBuffer(), handle);
    } catch (err) {
      if (err.name !== "AbortError") this.infoEl.textContent = `Failed to open PDF: ${err.message}`;
    }
  }

  async open(name, readBytes, handle = null) {
    this.close();
    this.infoEl.textContent = "Loading...";

    try {
      const file = await PdfFile.load(name, await readBytes(), handle);
      // pdf.js detaches the buffer it receives, so keep the original for saving.
      const pdf = await pdfjsLib.getDocument({ data: file.bytes.slice(0) }).promise;
      this.file = file;
      this.setDocumentOpen(true);
      this.infoEl.textContent = `${name} - ${pdf.numPages} page(s)`;

      for (let i = 1; i <= pdf.numPages; i++) {
        const pdfPage = await pdf.getPage(i);
        const page = new Page(this.pagesEl);
        this.pages.push(page);
        await page.render(pdfPage, file.fields[i - 1] ?? []);
      }
      this.markSaved();
      this.saveBtn.disabled = false;
      this.saveAsBtn.disabled = false;
    } catch (err) {
      this.infoEl.textContent = `Failed to open PDF: ${err.message}`;
    } finally {
      // Also lets a partially rendered document be cleared after a failure.
      this.closeBtn.disabled = false;
      this.updatePageControls();
    }
  }

  close() {
    this.pagesEl.replaceChildren();
    this.pages = [];
    this.select(null);
    this.setPlacing(false);
    this.file = null;
    this.setDocumentOpen(false);
    this.saveBtn.disabled = true;
    this.saveAsBtn.disabled = true;
    this.closeBtn.disabled = true;
    this.updatePageControls();
    this.infoEl.textContent = "";
    // Lets the same file be picked again after closing.
    this.fileInput.value = "";
  }

  // Overwrites the opened file; documents without a writable file fall back to Save as.
  async save() {
    const { handle } = this.file;
    if (!handle) return this.saveAs();
    try {
      if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
        this.infoEl.textContent = "Failed to save PDF: permission denied";
        return false;
      }
      await this.file.writeTo(handle, this.pages);
      this.markSaved();
      return true;
    } catch (err) {
      this.infoEl.textContent = `Failed to save PDF: ${err.message}`;
      return false;
    }
  }

  async saveAs() {
    const suggestedName = this.file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
    try {
      if (window.showSaveFilePicker) {
        // Open the picker first; it requires the click's user activation.
        const handle = await window.showSaveFilePicker({ suggestedName, types: PDF_TYPES });
        await this.file.writeTo(handle, this.pages);
        // Later saves go to the new file.
        Object.assign(this.file, { handle, name: handle.name });
        this.infoEl.textContent = `${handle.name} - ${this.pages.length} page(s)`;
      } else {
        await this.file.download(this.pages, suggestedName);
      }
      this.markSaved();
      return true;
    } catch (err) {
      if (err.name !== "AbortError") this.infoEl.textContent = `Failed to save PDF: ${err.message}`;
      return false;
    }
  }
}

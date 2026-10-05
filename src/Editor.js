import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import { Box } from "./Box.js";
import { OptionsPanel } from "./OptionsPanel.js";
import { Page } from "./Page.js";
import { PdfFile } from "./PdfFile.js";
import { SignaturePad } from "./SignaturePad.js";
import { SignatureTray } from "./SignatureTray.js";
import { TextBox } from "./TextBox.js";

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

  constructor() {
    this.pagesEl = $("pages");
    this.infoEl = $("info");
    this.fileInput = $("file");
    this.textFieldBtn = $("text-field-btn");
    this.saveBtn = $("save-btn");
    this.saveAsBtn = $("save-as-btn");
    this.closeBtn = $("close-btn");
    this.deleteBtn = $("delete-btn");
    this.closeDialog = $("close-dialog");
    this.options = new OptionsPanel();
    this.signaturePad = new SignaturePad();
    this.signatureTray = new SignatureTray((box) => this.select(box));

    $("new-btn").addEventListener("click", () => this.newPdf());
    $("open-btn").addEventListener("click", () => this.openPicker());
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

    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest("#toolbar, dialog")) this.select(Box.of(e.target));
    });
    document.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.pagesEl.addEventListener("pointerdown", (e) => this.onPagePointerDown(e));
    this.pagesEl.addEventListener("dblclick", (e) => {
      const box = Box.of(e.target);
      if (!(box instanceof TextBox)) return;
      this.select(box);
      box.edit();
    });
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
  }

  deleteSelected() {
    if (!this.selected) return;
    this.selected.remove();
    this.select(null);
  }

  // Moves a box, or places a new text field in placing mode.
  async onPagePointerDown(e) {
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

  async addSignature() {
    this.setPlacing(false);
    const src = await this.signaturePad.open();
    if (src) this.signatureTray.show(src);
  }

  snapshot() {
    return JSON.stringify(this.pages.flatMap((page) => page.boxes).map((box) => box.state));
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
    }
  }

  close() {
    this.pagesEl.replaceChildren();
    this.pages = [];
    this.select(null);
    this.setPlacing(false);
    this.file = null;
    this.saveBtn.disabled = true;
    this.saveAsBtn.disabled = true;
    this.closeBtn.disabled = true;
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

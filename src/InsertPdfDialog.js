const $ = (id) => document.getElementById(id);

// The dialog in which the user picks a PDF and where to insert its pages.
export class InsertPdfDialog {
  pageCount = 1;

  constructor() {
    this.dialog = $("insert-dialog");
    this.fileInput = $("insert-file");
    this.pageInput = $("insert-page");
    this.afterRadio = $("insert-after");
    this.confirmBtn = $("insert-confirm");

    this.fileInput.addEventListener("change", () => (this.confirmBtn.disabled = !this.fileInput.files.length));
    this.pageInput.addEventListener("focus", () => (this.afterRadio.checked = true));
    $("insert-cancel").addEventListener("click", () => this.dialog.close());
  }

  // Resolves to { file, where: "start" | "after" | "end", pageNumber }, or null if cancelled.
  open(pageNumber, pageCount) {
    this.pageCount = pageCount;
    this.fileInput.value = "";
    this.confirmBtn.disabled = true;
    this.pageInput.max = pageCount;
    this.pageInput.value = pageNumber;
    this.afterRadio.checked = true;
    this.dialog.returnValue = "";
    this.dialog.showModal();
    return new Promise((resolve) => {
      this.dialog.addEventListener("close", () => resolve(this.dialog.returnValue === "insert" ? this.choice() : null), { once: true });
    });
  }

  choice() {
    const where = this.dialog.querySelector('[name="insert-at"]:checked').value;
    const pageNumber = Math.min(Math.max(Math.round(Number(this.pageInput.value)) || 1, 1), this.pageCount);
    return { file: this.fileInput.files[0], where, pageNumber };
  }
}

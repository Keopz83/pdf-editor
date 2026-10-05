import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const PDF_WIDTH = 400;
const PDF_HEIGHT = 300;

function makePdf() {
  const content = "BT /F1 24 Tf 50 150 Td (Hello PDF) Tj ET";
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PDF_WIDTH} ${PDF_HEIGHT}]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>`,
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((obj, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// Plain Enter completes editing, so line breaks are typed with Shift+Enter.
async function typeLines(page, text) {
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press("Shift+Enter");
    await page.keyboard.type(line);
  }
}

async function placeTextField(page, text) {
  await page.click("#text-field-btn");
  await page.click(".page", { position: { x: 60, y: 60 } });
  await typeLines(page, text);
}

test.beforeEach(async ({ page }) => {
  // Force the download fallback so the test doesn't hit the native save dialog.
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto("/");
  await page.setInputFiles("#file", { name: "test.pdf", mimeType: "application/pdf", buffer: makePdf() });
  await expect(page.locator("#info")).toHaveText("test.pdf - 1 page(s)");
  await expect(page.locator("#save-btn")).toBeEnabled();
});

test("places a multiline text field with a transparent background", async ({ page }) => {
  await placeTextField(page, "line one\nline two");

  await expect(page.locator(".text-field")).toHaveValue("line one\nline two");
  await expect(page.locator(".text-field")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator("#text-options")).toBeVisible();
  await expect(page.locator("#fill-transparent")).toBeChecked();
  await expect(page.locator("#fill-color")).toBeDisabled();
});

test("Enter completes editing while Shift+Enter inserts a new line", async ({ page }) => {
  await placeTextField(page, "first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await page.keyboard.press("Enter");

  const field = page.locator(".text-field");
  await expect(field).toHaveValue("first\nsecond");
  await expect(field).not.toBeFocused();
  await expect(field).toHaveJSProperty("readOnly", true);
  await expect(page.locator(".text-box")).not.toHaveClass(/selected/);
  await expect(page.locator("#text-options")).toBeHidden();
});

test("applies text and fill colors and keeps them per field", async ({ page }) => {
  await placeTextField(page, "hello");
  await page.fill("#text-color", "#ff0000");
  await page.uncheck("#fill-transparent");
  await page.fill("#fill-color", "#ffff00");

  const field = page.locator(".text-field");
  await expect(field).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(field).toHaveCSS("background-color", "rgb(255, 255, 0)");
  await expect(page.locator(".text-box")).toHaveClass(/selected/);

  await page.click(".page", { position: { x: 300, y: 250 } });
  await expect(page.locator("#text-options")).toBeHidden();

  await page.click(".text-box", { position: { x: 2, y: 2 } });
  await expect(page.locator("#text-options")).toBeVisible();
  await expect(page.locator("#text-color")).toHaveValue("#ff0000");
  await expect(page.locator("#fill-color")).toHaveValue("#ffff00");
  await expect(page.locator("#fill-transparent")).not.toBeChecked();
});

test("basic color swatches set text and fill colors", async ({ page }) => {
  await placeTextField(page, "hello");
  await page.click('.swatches[data-for="text-color"] .swatch[title="Blue"]');
  await page.click('.swatches[data-for="fill-color"] .swatch[title="Yellow"]');

  const field = page.locator(".text-field");
  await expect(page.locator("#text-color")).toHaveValue("#0000ff");
  await expect(field).toHaveCSS("color", "rgb(0, 0, 255)");
  await expect(page.locator("#fill-transparent")).not.toBeChecked();
  await expect(page.locator("#fill-color")).toBeEnabled();
  await expect(field).toHaveCSS("background-color", "rgb(255, 255, 0)");
  await expect(page.locator(".text-box")).toHaveClass(/selected/);
});

test("applies font size and style and keeps them through save and reopen", async ({ page }) => {
  await page.click("#text-field-btn");
  const origin = await page.locator(".page").boundingBox();
  await page.mouse.move(origin.x + 50, origin.y + 50);
  await page.mouse.down();
  await page.mouse.move(origin.x + 350, origin.y + 150, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.type("Styled");

  await expect(page.locator("#font-size")).toHaveValue("14");
  await page.fill("#font-size", "24");
  await page.selectOption("#font-family", "Times");
  await page.check("#font-bold");
  await page.check("#font-italic");

  const field = page.locator(".text-field");
  await expect(field).toHaveCSS("font-size", "24px");
  await expect(field).toHaveCSS("font-weight", "700");
  await expect(field).toHaveCSS("font-style", "italic");
  expect(await field.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Times");

  const pdf = await savePdf(page);
  const doc = await getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
  }).promise;
  const pdfPage = await doc.getPage(1);
  await pdfPage.getOperatorList();
  const { items } = await pdfPage.getTextContent();
  const styled = items.find((i) => i.str === "Styled");
  const font = pdfPage.commonObjs.get(styled.fontName);
  expect(font.name).toMatch(/Times-BoldItalic/);

  await page.setInputFiles("#file", { name: "saved.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.locator("#info")).toHaveText("saved.pdf - 1 page(s)");
  await page.click(".text-box", { position: { x: 2, y: 2 } });
  await expect(page.locator("#font-size")).toHaveValue("24");
  await expect(page.locator("#font-family")).toHaveValue("Times");
  await expect(page.locator("#font-bold")).toBeChecked();
  await expect(page.locator("#font-italic")).toBeChecked();
});

test("deletes the selected text field via button or Delete key", async ({ page }) => {
  await placeTextField(page, "remove me");
  // Backspace while typing edits the text instead of deleting the field.
  await page.keyboard.press("Backspace");
  await expect(page.locator(".text-field")).toHaveValue("remove m");

  await page.click("#delete-btn");
  await expect(page.locator(".text-box")).toHaveCount(0);
  await expect(page.locator("#text-options")).toBeHidden();

  await placeTextField(page, "again");
  await page.click(".text-box", { position: { x: 2, y: 2 } });
  await page.keyboard.press("Delete");
  await expect(page.locator(".text-box")).toHaveCount(0);

  // A freshly placed, still empty field can be removed straight away.
  await placeTextField(page, "");
  await page.keyboard.press("Delete");
  await expect(page.locator(".text-box")).toHaveCount(0);
});

test("dragging a bounding box places a field with the default font size", async ({ page }) => {
  await page.click("#text-field-btn");
  const origin = await page.locator(".page").boundingBox();
  await page.mouse.move(origin.x + 50, origin.y + 50);
  await page.mouse.down();
  await page.mouse.move(origin.x + 250, origin.y + 110, { steps: 5 });
  const drawing = page.locator(".text-box.drawing");
  await expect(drawing).toBeVisible();
  expect(await drawing.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.mouse.up();
  await expect(page.locator(".text-box.drawing")).toHaveCount(0);
  await page.keyboard.type("Big");

  const box = await page.locator(".text-box").boundingBox();
  expect(box.x - origin.x).toBeCloseTo(50, 0);
  expect(box.y - origin.y).toBeCloseTo(50, 0);
  expect(box.width).toBeCloseTo(200, 0);
  expect(box.height).toBeCloseTo(60, 0);

  const field = page.locator(".text-field");
  await expect(field).toHaveValue("Big");
  const fontSize = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeCloseTo(14, 1);
  expect(await field.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  await expect(page.locator("#text-field-btn")).not.toHaveClass(/active/);
});

test("typing shrinks the font so the text fits the box without scrollbars", async ({ page }) => {
  await placeTextField(page, "short");
  const field = page.locator(".text-field");
  const fontSize = () => field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const fits = () => field.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth);
  expect(await fontSize()).toBeCloseTo(14, 0);
  await expect(field).toHaveCSS("overflow", "hidden");

  await typeLines(page, " text that is far too long\nfor one line");
  expect(await fontSize()).toBeLessThan(10);
  expect(await fits()).toBe(true);

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("hi");
  expect(await fontSize()).toBeCloseTo(14, 0);
});

test("Save as writes text fields into the PDF", async ({ page }) => {
  await placeTextField(page, "Grüezi\nsecond ✓");
  await page.fill("#text-color", "#ff0000");
  await page.uncheck("#fill-transparent");
  await page.fill("#fill-color", "#ffff00");

  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save-btn")]);
  expect(download.suggestedFilename()).toBe("test-edited.pdf");

  const doc = await getDocument({
    data: new Uint8Array(await readFile(await download.path())),
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
  }).promise;
  const pdfPage = await doc.getPage(1);
  const { items } = await pdfPage.getTextContent();
  const texts = items.map((i) => i.str).filter(Boolean);
  // Characters outside WinAnsi are replaced with "?".
  expect(texts).toEqual(["Hello PDF", "Grüezi", "second ?"]);

  // Expected position mirrors the box/padding offsets used by the app.
  const scale = PDF_WIDTH / (await page.locator(".page").evaluate((el) => el.clientWidth));
  const fontSize = Number(await page.locator(".text-box").getAttribute("data-size"));
  const first = items.find((i) => i.str === "Grüezi");
  expect(first.transform[4]).toBeCloseTo((60 + 5 + 4) * scale, 1);
  expect(first.transform[5]).toBeCloseTo(PDF_HEIGHT - (60 + 5 + 2 + fontSize) * scale, 1);

  const { fnArray, argsArray } = await pdfPage.getOperatorList();
  const fillColors = fnArray
    .map((fn, i) => (fn === OPS.setFillRGBColor ? argsArray[i].join(",") : null))
    .filter(Boolean);
  expect(fillColors).toEqual(expect.arrayContaining(["255,255,0", "255,0,0"]));
});

async function savePdf(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save-btn")]);
  return readFile(await download.path());
}

async function pdfTexts(buffer) {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
  }).promise;
  const { items } = await (await doc.getPage(1)).getTextContent();
  return items.map((i) => i.str).filter(Boolean);
}

test("reopening a saved PDF restores its text fields for editing via double-click", async ({ page }) => {
  await placeTextField(page, "hello");
  await page.fill("#text-color", "#ff0000");
  const box = page.locator(".text-box");
  const before = await box.boundingBox();

  await page.setInputFiles("#file", { name: "saved.pdf", mimeType: "application/pdf", buffer: await savePdf(page) });
  await expect(page.locator("#info")).toHaveText("saved.pdf - 1 page(s)");

  const field = page.locator(".text-field");
  await expect(field).toHaveValue("hello");
  await expect(field).toHaveJSProperty("readOnly", true);
  await expect(field).toHaveCSS("color", "rgb(255, 0, 0)");
  const after = await box.boundingBox();
  for (const key of ["x", "y", "width", "height"]) expect(after[key]).toBeCloseTo(before[key], 0);

  await field.dblclick();
  await expect(field).toHaveJSProperty("readOnly", false);
  await page.keyboard.press("End");
  await page.keyboard.type(" world");

  // The previously drawn text is replaced, not duplicated.
  expect(await pdfTexts(await savePdf(page))).toEqual(["Hello PDF", "hello world"]);
});

async function drawSignature(page) {
  await page.click("#signature-btn");
  await expect(page.locator("#signature-dialog")).toBeVisible();
  await expect(page.locator("#signature-done")).toBeDisabled();
  const pad = await page.locator("#signature-pad").boundingBox();
  await page.mouse.move(pad.x + 50, pad.y + 100);
  await page.mouse.down();
  await page.mouse.move(pad.x + 200, pad.y + 60, { steps: 5 });
  await page.mouse.move(pad.x + 350, pad.y + 140, { steps: 5 });
  await page.mouse.up();
  await page.click("#signature-done");
  await expect(page.locator("#signature-dialog")).toBeHidden();
}

async function dropSignature(page, x, y) {
  await page.locator("#signature-preview").dragTo(page.locator(".page"), { targetPosition: { x, y } });
}

async function pdfImageCount(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const { fnArray } = await (await doc.getPage(1)).getOperatorList();
  return fnArray.filter((fn) => fn === OPS.paintImageXObject).length;
}

const imageObjectCount = (buffer) => (buffer.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;

test("draws a transparent signature and drags it onto the page", async ({ page }) => {
  await page.click("#signature-btn");
  await page.click("#signature-cancel");
  await expect(page.locator("#signature-dialog")).toBeHidden();
  await expect(page.locator("#signature-tray")).toBeHidden();

  await drawSignature(page);
  const preview = page.locator("#signature-preview");
  await expect(preview).toBeVisible();
  expect(await preview.getAttribute("src")).toMatch(/^data:image\/png;base64,/);

  const alpha = await preview.evaluate((img) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const alphas = data.filter((_, i) => i % 4 === 3);
    return { corner: alphas[0], max: Math.max(...alphas) };
  });
  expect(alpha.corner).toBe(0);
  expect(alpha.max).toBe(255);

  await dropSignature(page, 200, 150);
  const box = page.locator(".signature-box");
  await expect(box).toHaveCount(1);
  await expect(box).toHaveClass(/selected/);
  await expect(page.locator("#delete-btn")).toBeVisible();
  await expect(page.locator("#text-options")).toBeHidden();
  await expect(box.locator("img")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const origin = await page.locator(".page").boundingBox();
  const bounds = await box.boundingBox();
  expect(bounds.width).toBeCloseTo(150, 0);
  expect(bounds.x + bounds.width / 2 - origin.x).toBeCloseTo(200, 0);
  expect(bounds.y + bounds.height / 2 - origin.y).toBeCloseTo(150, 0);
});

test("signature resizes with its aspect ratio and can be deleted", async ({ page }) => {
  await drawSignature(page);
  await dropSignature(page, 150, 100);
  const box = page.locator(".signature-box");
  const before = await box.boundingBox();

  const handle = await box.locator(".resize-handle").boundingBox();
  await page.mouse.move(handle.x + 5, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x + 65, handle.y + 5, { steps: 5 });
  await page.mouse.up();
  const after = await box.boundingBox();
  expect(after.width).toBeCloseTo(before.width + 60, 0);
  expect(after.width / after.height).toBeCloseTo(before.width / before.height, 1);

  await page.click("#delete-btn");
  await expect(box).toHaveCount(0);
  await expect(page.locator("#delete-btn")).toBeHidden();
});

test("Save as embeds the signature and reopening restores it without duplicating the image", async ({ page }) => {
  await drawSignature(page);
  await dropSignature(page, 200, 150);
  const box = page.locator(".signature-box");
  const before = await box.boundingBox();

  const saved = await savePdf(page);
  expect(await pdfImageCount(saved)).toBe(1);
  // The image plus its soft mask, which carries the transparency.
  expect(imageObjectCount(saved)).toBe(2);

  await page.setInputFiles("#file", { name: "saved.pdf", mimeType: "application/pdf", buffer: saved });
  await expect(page.locator("#info")).toHaveText("saved.pdf - 1 page(s)");
  await expect(box).toHaveCount(1);
  const after = await box.boundingBox();
  for (const key of ["x", "y", "width", "height"]) expect(after[key]).toBeCloseTo(before[key], 0);

  const resaved = await savePdf(page);
  expect(await pdfImageCount(resaved)).toBe(1);
  expect(imageObjectCount(resaved)).toBe(2);
});

// Color of the most opaque pixel plus the transparent corner's alpha.
const signaturePixels = (img) => img.evaluate(async (el) => {
  await el.decode();
  const canvas = document.createElement("canvas");
  canvas.width = el.naturalWidth;
  canvas.height = el.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(el, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let best = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > data[best + 3]) best = i - 3;
  return { stroke: [...data.slice(best, best + 4)], cornerAlpha: data[3] };
});

test("changes the signature color and keeps it through save and reopen", async ({ page }) => {
  await drawSignature(page);
  await dropSignature(page, 200, 150);
  await expect(page.locator("#signature-options")).toBeVisible();
  await expect(page.locator("#signature-color")).toHaveValue("#000000");

  const img = page.locator(".signature-box img");
  const blackSrc = await img.getAttribute("src");
  await page.click('.swatches[data-for="signature-color"] .swatch[title="Blue"]');
  await expect(page.locator("#signature-color")).toHaveValue("#0000ff");
  await expect(img).not.toHaveAttribute("src", blackSrc);
  expect(await signaturePixels(img)).toEqual({ stroke: [0, 0, 255, 255], cornerAlpha: 0 });

  await page.fill("#signature-color", "#ff0000");
  await expect.poll(async () => (await signaturePixels(img)).stroke).toEqual([255, 0, 0, 255]);

  // Selecting a text field swaps the option panels.
  await placeTextField(page, "x");
  await expect(page.locator("#signature-options")).toBeHidden();
  await expect(page.locator("#text-options")).toBeVisible();

  await page.setInputFiles("#file", { name: "saved.pdf", mimeType: "application/pdf", buffer: await savePdf(page) });
  await expect(page.locator("#info")).toHaveText("saved.pdf - 1 page(s)");
  await page.click(".signature-box");
  await expect(page.locator("#signature-color")).toHaveValue("#ff0000");
  expect((await signaturePixels(img)).stroke).toEqual([255, 0, 0, 255]);
});

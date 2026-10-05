# PDF Editor

A small browser-based PDF editor. Open a PDF, place text fields on its pages, and save a new PDF with the text included.

Rendering uses [PDF.js](https://mozilla.github.io/pdf.js/), and saving uses [pdf-lib](https://pdf-lib.js.org/). Both load from a CDN.

## Features

- Open and view PDF files
- Add text fields by clicking or dragging. Move, resize, edit, and delete them.
- Text options: color, fill (or transparent), font size, font family (Helvetica, Times, Courier), bold, and italic
- Save as a new PDF. Text fields stay editable when you open the saved file in this editor again.

## Usage

```sh
npm install
npm start        # serves on http://localhost:8765
```

Then open http://localhost:8765 in a browser.

## Tests

End-to-end tests use Playwright:

```sh
npm test
```

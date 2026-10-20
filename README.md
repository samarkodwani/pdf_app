# PDF Reader

Turns a PDF into reflowing, phone-friendly text. Runs entirely in the browser (no server); installable as a PWA.

- Text PDFs: extracts the text layer, rebuilds paragraphs, joins hyphenated words, handles two-column papers, strips running headers/page numbers.
- Scanned / image pages: detected automatically and read with on-device OCR (Tesseract.js).
- Per page: **Original** shows the rendered page (for figures/equations/tables), **Re-run OCR** retries a bad page.
- Remembers reading position, caches processed documents, works offline.

## Develop
```
npm install
npm run dev -- --host      # open the LAN URL on your phone
npm run build && npm run preview
```

## Deploy (GitHub Pages)
Push to `main` of a GitHub repo and enable Pages → Source: "GitHub Actions" in the repo settings.
`.github/workflows/deploy.yml` builds with the right base path. Then open the site on your phone and "Add to Home Screen"
(on Android you can also share a PDF straight to the app).

## Tests (need Python + PyMuPDF and Chrome)
```
npm run test:fixtures      # generate sample PDFs
npm run build
npm run test:book          # prose; also test:paper, test:mixed (OCR), test:scan (all-image)
npm run test:app           # position restore, library cache, Original toggle
npm run test:pwa           # manifest, service worker, offline
npm run test:share         # Android share-target flow
```

## Notes
- First OCR needs network once (Tesseract worker + English data load from a CDN, then are cached for offline use).
- Math, tables and figures aren't reconstructed; use the **Original** toggle for those.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildLines, findRunning, stripRunning, linesToBlocks, needsOcr, stripOcrEdges } from './layout.js';
import { ocrPage } from './ocr.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PRESCAN_PAGES = 8;

export function loadPdf(buffer) {
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  return pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
}

async function readPage(pdf, num) {
  const page = await pdf.getPage(num);
  const [x0, y0, x1, y1] = page.view;
  const { items } = await page.getTextContent();
  page.cleanup();
  return buildLines(items.filter((i) => 'str' in i), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

// Pass 1: text-layer pages (fast). Pages with no usable text are returned as 'ocr-pending'.
// page = {num, status: 'text'|'ocr'|'ocr-pending'|'ocr-running'|'ocr-failed', blocks}
export async function extractText(pdf, { onPage, onProgress, signal }) {
  const n = pdf.numPages;
  const pre = [];
  for (let i = 1; i <= Math.min(n, PRESCAN_PAGES); i++) pre[i] = await readPage(pdf, i);
  const preList = pre.filter(Boolean);
  const running = findRunning(preList);
  const sizes = preList.map((p) => p.bodySize).filter(Boolean).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 0;

  const pages = [];
  for (let i = 1; i <= n; i++) {
    if (signal?.aborted) return { pages, running: [...running] };
    const built = pre[i] || (await readPage(pdf, i));
    const lines = stripRunning(built.lines, built.pageH, running);
    const page = needsOcr(lines)
      ? { num: i, status: 'ocr-pending', blocks: [] }
      : { num: i, status: 'text', blocks: linesToBlocks(lines, bodySize) };
    pages.push(page);
    onPage(page);
    onProgress?.(i, n);
  }
  return { pages, running: [...running] };
}

// Pass 2: OCR the given page numbers one by one. `running` = known header/footer texts to drop.
export async function runOcr(pdf, nums, { onPage, onProgress, onSave, signal, running = new Set() }) {
  let done = 0;
  for (const num of nums) {
    if (signal?.aborted) break;
    onPage({ num, status: 'ocr-running', blocks: [], progress: 0 });
    let page;
    try {
      const blocks = await ocrPage(pdf, num, (p) => onProgress?.(num, p));
      page = { num, status: 'ocr', blocks: stripOcrEdges(blocks, running) };
    } catch (e) {
      console.error('OCR failed on page', num, e);
      page = { num, status: 'ocr-failed', blocks: [] };
    }
    onPage(page);
    done++;
    if (done % 5 === 0) onSave?.();
  }
  onSave?.();
}

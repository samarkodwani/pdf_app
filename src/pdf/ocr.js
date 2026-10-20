import { createWorker } from 'tesseract.js';
import { textToBlocks } from './layout.js';

let workerPromise = null;
let progressCb = null;
let chain = Promise.resolve(); // OCR jobs run one at a time

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && progressCb) progressCb(m.progress);
      },
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

// Render a pdf.js page to a canvas, ~1800px wide (good OCR accuracy without exhausting phone memory).
export async function renderPage(pdf, pageNum, targetWidth = 1800) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1, targetWidth / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  page.cleanup();
  return canvas;
}

// A near-white canvas is a blank page: skip the slow OCR.
function isBlank(canvas) {
  const w = 120, h = Math.max(1, Math.round((120 * canvas.height) / canvas.width));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) ink++;
  return ink / (w * h) < 0.001;
}

export function ocrPage(pdf, pageNum, onProgress) {
  const job = chain.then(async () => {
    const canvas = await renderPage(pdf, pageNum);
    try {
      if (isBlank(canvas)) return [];
      const worker = await getWorker();
      progressCb = onProgress || null;
      const { data } = await worker.recognize(canvas);
      return textToBlocks(data.text || '');
    } finally {
      progressCb = null;
      canvas.width = canvas.height = 0;
    }
  });
  chain = job.catch(() => {});
  return job;
}

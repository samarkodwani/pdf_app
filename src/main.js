import './style.css';
import { loadPdf, extractText, runOcr } from './pdf/extract.js';
import { renderPage } from './pdf/ocr.js';
import { createReader } from './reader.js';
import { findRunningBlocks, stripOcrEdges } from './pdf/layout.js';
import { hashBuffer, saveDoc, getDoc, saveFile, getFile, listDocs, deleteDoc, loadPos, savePos, loadSettings, saveSettings } from './store.js';

const app = document.getElementById('app');
const settings = loadSettings();
let session = null; // the currently open document

function applySettings() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty('--font-size', settings.fontSize + 'px');
  document.querySelector('meta[name="theme-color"]').content = { light: '#fafaf7', dark: '#111111', sepia: '#f4ecd8' }[settings.theme];
  document.querySelector('.reader')?.classList.toggle('serif', settings.serif);
  saveSettings(settings);
}

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

// ---------- home / library ----------
async function showHome() {
  closeSession();
  app.textContent = '';
  const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  input.onchange = () => input.files[0] && openFile(input.files[0]);
  const pick = el('button', { className: 'pick', textContent: 'Open a PDF' });
  pick.onclick = () => input.click();
  const list = el('ul', { className: 'lib' });
  app.append(el('div', { className: 'home' }, el('h1', { textContent: 'PDF Reader' }), el('p', { className: 'sub', textContent: 'Turns a PDF into reflowing text that fits your screen. Everything stays on this device.' }), pick, input, list));

  for (const d of await listDocs()) {
    const name = el('div', { className: 'name' }, el('b', { textContent: d.name }), el('small', { textContent: `${d.total} pages` }));
    name.onclick = () => openCached(d.id);
    const del = el('button', { textContent: 'Delete' });
    del.onclick = async () => {
      if (confirm(`Delete "${d.name}" from this device?`)) {
        await deleteDoc(d.id);
        showHome();
      }
    };
    list.append(el('li', {}, name, del));
  }
}

// ---------- opening documents ----------
async function openFile(file) {
  const buffer = await file.arrayBuffer();
  history.pushState({ reading: true }, '');
  await openDoc(hashBuffer(buffer), file.name.replace(/\.pdf$/i, ''), buffer);
}

async function openCached(id) {
  history.pushState({ reading: true }, '');
  await openDoc(id);
}

function closeSession() {
  if (!session) return;
  session.abort.abort();
  session.reader?.destroy();
  session = null;
}

async function openDoc(id, name, bufferHint) {
  closeSession();
  const abort = new AbortController();
  const s = (session = { id, abort, reader: null });
  const alive = () => session === s;

  // shell
  const status = el('span', { className: 'status', textContent: 'Loading…' });
  const title = el('span', { className: 'title', textContent: name || '' });
  const back = el('button', { textContent: '←' });
  back.onclick = () => history.back();
  const gear = el('button', { textContent: 'Aa' });
  const bar = el('div', { className: 'bar' }, back, title, status, gear);
  const panel = el('div', { className: 'settings' });
  const root = el('main', { className: 'reader' });
  app.textContent = '';
  app.append(bar, panel, root);
  buildSettings(panel);
  gear.onclick = () => panel.classList.toggle('open');
  applySettings();
  window.scrollTo(0, 0);

  try {
    let doc = await getDoc(id);
    const buffer = bufferHint || (await getFile(id));
    if (!buffer) throw new Error('The stored file is missing.');
    let pdfPromise = null;
    const getPdf = () => (pdfPromise ||= loadPdf(buffer));

    if (!doc) {
      const pdf = await getPdf();
      doc = { id, name, total: pdf.numPages, pages: [] };
      await saveFile(id, buffer);
    }
    if (!alive()) return;
    title.textContent = doc.name;

    const pageStatus = () => {
      const left = doc.pages.filter((p) => p && /^ocr-(pending|running)$/.test(p.status)).length;
      return left ? `OCR: ${left} page${left > 1 ? 's' : ''} left` : '';
    };

    let busy = false;
    const reader = (s.reader = createReader(root, {
      total: doc.total,
      topOffset: () => bar.offsetHeight,
      renderOriginal: async (n) => renderPage(await getPdf(), n, 1200),
      rerunOcr: (n) => runOcrFor([n]),
      onPosition: (pos) => {
        savePos(id, pos);
        if (!busy) status.textContent = `p. ${pos.page}/${doc.total}`;
      },
    }));
    applySettings();

    const setPage = (p) => {
      if (!alive()) return;
      doc.pages[p.num - 1] = p;
      reader.setPage(p);
    };
    const save = () => alive() && saveDoc(doc);

    // Scanned books have no text pages to learn headers from: strip first/last blocks repeated across OCR'd pages.
    function stripRepeatedOcrEdges() {
      const ocr = doc.pages.filter((p) => p?.status === 'ocr');
      const repeated = findRunningBlocks(ocr.map((p) => p.blocks));
      if (!repeated.size) return;
      for (const p of ocr) {
        const blocks = stripOcrEdges(p.blocks, repeated);
        if (blocks.length !== p.blocks.length) setPage({ ...p, blocks });
      }
    }

    async function runOcrFor(nums) {
      const pdf = await getPdf();
      busy = true;
      try {
        await runOcr(pdf, nums, {
          signal: abort.signal,
          onPage: (p) => {
            setPage(p);
            status.textContent = pageStatus() || 'OCR…';
          },
          onProgress: (n, p) => reader.setProgress(n, p),
          onSave: save,
          running: new Set(doc.running || []),
        });
        stripRepeatedOcrEdges();
        save();
      } finally {
        busy = false;
        if (alive()) status.textContent = pageStatus() || `p. ${loadPos(id)?.page || 1}/${doc.total}`;
      }
    }

    // Render what we have, then fill in the rest.
    doc.pages.forEach((p) => p && reader.setPage(p));
    reader.restore(loadPos(id));

    if (doc.pages.length < doc.total) {
      const pdf = await getPdf();
      busy = true;
      doc.pages = [];
      const { running } = await extractText(pdf, {
        signal: abort.signal,
        onPage: setPage,
        onProgress: (i, n) => alive() && (status.textContent = `Extracting ${i}/${n}`),
      });
      busy = false;
      if (!alive()) return;
      doc.running = running;
      await saveDoc(doc);
    } else {
      await saveDoc(doc); // bump lastOpened
    }

    const pending = doc.pages.filter((p) => p && /^ocr-(pending|running)$/.test(p.status)).map((p) => p.num);
    if (pending.length) await runOcrFor(pending);
    else status.textContent = `p. ${loadPos(id)?.page || 1}/${doc.total}`;
  } catch (e) {
    console.error(e);
    if (alive()) root.replaceChildren(el('p', { className: 'empty', textContent: `Couldn't open this PDF: ${e.message || e}` }));
    if (alive()) status.textContent = '';
  }
}

function buildSettings(panel) {
  const size = el('input', { type: 'range', min: 14, max: 30, step: 1, value: settings.fontSize });
  size.oninput = () => { settings.fontSize = +size.value; applySettings(); };
  const mk = (label, fn) => { const b = el('button', { textContent: label }); b.onclick = fn; return b; };
  panel.append(
    mk('A−', () => { size.value = settings.fontSize = Math.max(14, settings.fontSize - 1); applySettings(); }),
    size,
    mk('A+', () => { size.value = settings.fontSize = Math.min(30, settings.fontSize + 1); applySettings(); }),
    mk('Light', () => { settings.theme = 'light'; applySettings(); }),
    mk('Sepia', () => { settings.theme = 'sepia'; applySettings(); }),
    mk('Dark', () => { settings.theme = 'dark'; applySettings(); }),
    mk('Serif / Sans', () => { settings.serif = !settings.serif; applySettings(); }),
  );
}

// A PDF shared to the installed app (see sw.js) is waiting in the 'shared' cache.
async function openShared() {
  history.replaceState(null, '', import.meta.env.BASE_URL);
  const cache = await caches.open('shared');
  const res = await cache.match('file');
  if (!res) return;
  await cache.delete('file');
  const name = decodeURIComponent(res.headers.get('x-name') || 'shared.pdf');
  history.pushState({ reading: true }, '');
  await openDoc(hashBuffer(await res.clone().arrayBuffer()), name.replace(/\.pdf$/i, ''), await res.arrayBuffer());
}

window.addEventListener('popstate', () => showHome());
applySettings();
showHome();
if (new URLSearchParams(location.search).has('shared')) openShared();

// Renders pages as reflowed text sections. One <section> per PDF page, filled in as pages become ready.

const STATUS_BADGE = { ocr: 'OCR', 'ocr-pending': 'image page', 'ocr-running': 'image page', 'ocr-failed': 'OCR failed' };

export function createReader(root, { total, renderOriginal, rerunOcr, onPosition, topOffset = () => 0 }) {
  root.textContent = '';
  const sections = [];
  const loaded = [];
  let pendingRestore = null;

  for (let i = 1; i <= total; i++) {
    const s = document.createElement('section');
    s.dataset.page = i;
    s.append(marker(i, null), emptyNote('Loading…'));
    root.append(s);
    sections.push(s);
    loaded[i] = false;
  }

  function emptyNote(text) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    return p;
  }

  function marker(num, page) {
    const m = document.createElement('div');
    m.className = 'page-mark';
    const label = document.createElement('span');
    label.textContent = `p. ${num}`;
    m.append(label);
    if (page && STATUS_BADGE[page.status]) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = STATUS_BADGE[page.status];
      m.append(b);
    }
    if (page) {
      const orig = document.createElement('button');
      orig.textContent = 'Original';
      orig.onclick = async () => {
        const sec = sections[num - 1];
        const existing = sec.querySelector('.page-img');
        if (existing) return existing.remove();
        orig.disabled = true;
        try {
          const canvas = await renderOriginal(num);
          canvas.className = 'page-img';
          m.after(canvas);
        } finally {
          orig.disabled = false;
        }
      };
      m.append(orig);
      if (page.status !== 'ocr-running') {
        const ocr = document.createElement('button');
        ocr.textContent = 'Re-run OCR';
        ocr.onclick = () => rerunOcr(num);
        m.append(ocr);
      }
    }
    return m;
  }

  function setPage(page) {
    const sec = sections[page.num - 1];
    if (!sec) return;
    const keepImg = sec.querySelector('.page-img');
    sec.textContent = '';
    sec.append(marker(page.num, page));
    if (keepImg) sec.append(keepImg);

    if (page.status === 'ocr-pending') sec.append(emptyNote('Image page — waiting to be read with OCR…'));
    else if (page.status === 'ocr-running') sec.append(emptyNote(`Reading page with OCR… ${Math.round((page.progress || 0) * 100)}%`));
    else if (page.status === 'ocr-failed') sec.append(emptyNote('OCR failed on this page. Tap "Re-run OCR" to retry or "Original" to view it.'));
    else if (!page.blocks.length) sec.append(emptyNote('(no text on this page)'));
    else {
      for (const b of page.blocks) {
        const el = document.createElement(b.type === 'p' ? 'p' : b.type);
        el.textContent = b.text;
        sec.append(el);
      }
    }
    loaded[page.num] = true;
    tryRestore();
  }

  function setProgress(num, p) {
    const note = sections[num - 1]?.querySelector('.empty');
    if (note && /^Reading page/.test(note.textContent)) note.textContent = `Reading page with OCR… ${Math.round(p * 100)}%`;
  }

  // --- reading position ---
  function currentPosition() {
    const y = window.scrollY + topOffset() + 8;
    let lo = 0, hi = sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sections[mid].offsetTop <= y) lo = mid;
      else hi = mid - 1;
    }
    const s = sections[lo];
    return { page: lo + 1, frac: Math.max(0, Math.min(1, (y - s.offsetTop) / Math.max(1, s.offsetHeight))) };
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking || pendingRestore) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      onPosition?.(currentPosition());
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  function tryRestore() {
    if (!pendingRestore) return;
    const { page, frac } = pendingRestore;
    for (let i = 1; i <= page; i++) if (!loaded[i]) return;
    pendingRestore = null;
    const s = sections[page - 1];
    window.scrollTo(0, s.offsetTop + frac * s.offsetHeight - topOffset() - 8);
  }

  return {
    setPage,
    setProgress,
    restore(pos) {
      if (!pos || !sections[pos.page - 1]) return;
      pendingRestore = pos;
      tryRestore();
    },
    destroy() {
      window.removeEventListener('scroll', onScroll);
      root.textContent = '';
    },
  };
}

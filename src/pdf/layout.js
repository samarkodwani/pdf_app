// Turns raw pdf.js text items into reading-order lines, then into paragraph/heading blocks.
// Pure functions (no DOM / pdf.js imports) so they are easy to test in Node.

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

export function cleanText(s) {
  return s
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] || c)
    .replace(/­/g, '')
    .replace(/\s+/g, ' ');
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
function weightedMedian(pairs) {
  if (!pairs.length) return 0;
  const s = [...pairs].sort((a, b) => a[0] - b[0]);
  const half = s.reduce((t, p) => t + p[1], 0) / 2;
  let acc = 0;
  for (const [v, w] of s) {
    acc += w;
    if (acc >= half) return v;
  }
  return s[s.length - 1][0];
}

// Join text pieces, removing end-of-line hyphenation ("exam-" + "ple" -> "example").
export function joinLines(parts) {
  let out = parts[0] || '';
  for (let i = 1; i < parts.length; i++) {
    const next = parts[i];
    if (/[A-Za-zÀ-ɏ][-‐]$/.test(out) && /^[a-zß-ÿ]/.test(next)) {
      out = out.slice(0, -1) + next;
    } else {
      out += ' ' + next;
    }
  }
  return out;
}

// Cluster items into rows by baseline y (PDF y grows upward, so rows are returned top to bottom).
function clusterRows(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - it.y) <= Math.max(2, row.size * 0.5)) {
      row.items.push(it);
    } else {
      rows.push({ y: it.y, size: it.size, items: [it] });
    }
  }
  return rows;
}

// Find a vertical gutter (two-column layout). Returns its x, or null.
function detectGutter(items, pageW) {
  if (items.length < 20) return null;
  const rows = clusterRows(items);
  if (rows.length < 8) return null;
  const step = pageW / 200;
  const runs = [];
  let run = null;
  for (let g = pageW * 0.35; g <= pageW * 0.65; g += step) {
    let blocked = 0, leftRows = 0, rightRows = 0;
    for (const row of rows) {
      let crosses = false, l = false, r = false;
      for (const it of row.items) {
        if (it.x + it.w <= g) l = true;
        else if (it.x >= g) r = true;
        else crosses = true;
      }
      if (crosses) blocked++;
      if (l) leftRows++;
      if (r) rightRows++;
    }
    // Title/abstract rows span the gutter (can be ~30% of page 1); single-column prose blocks ~85% of rows.
    const ok = blocked / rows.length <= 0.35 &&leftRows >= rows.length * 0.3 && rightRows >= rows.length * 0.3;
    if (ok) {
      if (!run) runs.push((run = { from: g, to: g }));
      run.to = g;
    } else {
      run = null;
    }
  }
  if (!runs.length) return null;
  const best = runs.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  if (best.to - best.from < pageW * 0.012) return null;
  return (best.from + best.to) / 2;
}

function buildLine(group, items) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = '', prevEnd = null;
  for (const it of sorted) {
    if (prevEnd !== null && it.x - prevEnd > it.size * 0.12 && !text.endsWith(' ') && !it.s.startsWith(' ')) text += ' ';
    text += it.s;
    prevEnd = it.x + it.w;
  }
  const size = Math.max(...sorted.map((i) => i.size));
  return {
    text: cleanText(text).trim(),
    x0: sorted[0].x,
    x1: Math.max(...sorted.map((i) => i.x + i.w)),
    y: sorted[0].y,
    size,
    group,
  };
}

// items: pdf.js TextItems; page: {w, h, x, y} = unrotated page box.
// Returns {lines (reading order), bodySize, pageH}.
export function buildLines(items, page) {
  const its = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, , d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2) continue; // rotated text (side stamps, watermarks)
    its.push({ s: it.str, x: e - page.x, y: f - page.y, w: it.width, size: Math.abs(d) || it.height || 10 });
  }
  if (!its.length) return { lines: [], bodySize: 0, pageH: page.h };

  const gutter = detectGutter(its, page.w);
  let groups; // Map<key, items[]>, key order = reading order
  if (gutter === null) {
    groups = [[0, its]];
  } else {
    // Rows that cross the gutter (titles, abstracts) split the page into zones.
    const spanning = its.filter((i) => i.x < gutter && i.x + i.w > gutter);
    const spanYs = [];
    for (const y of spanning.map((i) => i.y).sort((a, b) => b - a)) {
      if (!spanYs.length || Math.abs(spanYs[spanYs.length - 1] - y) > 3) spanYs.push(y);
    }
    const buckets = new Map();
    for (const it of its) {
      const isSpan = it.x < gutter && it.x + it.w > gutter;
      const zone = spanYs.filter((y) => y > it.y + 3).length;
      const col = isSpan ? 2 : it.x >= gutter ? 1 : 0;
      const key = zone * 3 + col;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }
    groups = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  }

  const lines = [];
  for (const [key, group] of groups) {
    for (const row of clusterRows(group)) {
      const line = buildLine(key, row.items);
      if (line.text) lines.push(line);
    }
  }
  const bodySize = weightedMedian(lines.map((l) => [l.size, l.text.length]));
  return { lines, bodySize, pageH: page.h };
}

const isMargin = (line, pageH) => line.y > pageH * 0.92 || line.y < pageH * 0.08;
const PAGE_NUM = /^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s+of\s+\d+)?$/i;
export const normalizeLine = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

// Lines that repeat in the page margins across several pages (running headers/footers).
export function findRunning(pagesLines) {
  const n = pagesLines.length;
  if (n < 3) return new Set();
  const counts = new Map();
  for (const { lines, pageH } of pagesLines) {
    const seen = new Set();
    for (const l of lines) if (isMargin(l, pageH)) seen.add(normalizeLine(l.text));
    for (const k of seen) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const need = Math.max(3, Math.ceil(n * 0.4));
  return new Set([...counts].filter(([, c]) => c >= need).map(([k]) => k));
}

export function stripRunning(lines, pageH, running) {
  return lines.filter((l) => {
    if (!isMargin(l, pageH)) return true;
    if (PAGE_NUM.test(l.text.trim())) return false;
    return !running.has(normalizeLine(l.text));
  });
}

const ENDS_SENTENCE = /[.!?:;'")\]”’]$/;

// lines (reading order, already stripped) -> [{type:'p'|'h2'|'h3', text}]
export function linesToBlocks(lines, bodySize) {
  if (!lines.length) return [];
  const body = bodySize || weightedMedian(lines.map((l) => [l.size, l.text.length]));
  const blocks = [];
  const byGroup = new Map();
  for (const l of lines) {
    if (!byGroup.has(l.group)) byGroup.set(l.group, []);
    byGroup.get(l.group).push(l);
  }

  for (const group of byGroup.values()) {
    const bodyLines = group.filter((l) => l.size <= body * 1.18);
    const spacings = [];
    for (let i = 1; i < group.length; i++) {
      const d = group[i - 1].y - group[i].y;
      if (d > 0 && d < group[i].size * 3) spacings.push(d);
    }
    const typical = median(spacings) || body * 1.2;
    const left = percentile(bodyLines.map((l) => l.x0), 0.2);
    const right = percentile(bodyLines.map((l) => l.x1), 0.9);
    const width = Math.max(1, right - left);

    let cur = null; // {type, parts, last}
    const flush = () => {
      if (cur) blocks.push({ type: cur.type, text: joinLines(cur.parts), group: cur.group });
      cur = null;
    };
    for (const l of group) {
      const heading = l.size > body * 1.18;
      const type = heading ? (l.size > body * 1.5 ? 'h2' : 'h3') : 'p';
      let start = !cur || cur.type !== type;
      if (!start && type === 'p') {
        const p = cur.last;
        start =
          p.y - l.y > typical * 1.45 ||
          l.x0 - left > l.size * 0.9 ||
          p.x1 < right - width * 0.22;
      } else if (!start) {
        start = cur.last.y - l.y > l.size * 2.2 || Math.abs(cur.last.size - l.size) > 1;
      }
      if (start) {
        flush();
        cur = { type, parts: [], last: l, group: l.group };
      }
      cur.parts.push(l.text);
      cur.last = l;
    }
    flush();
  }

  // A paragraph cut by a column break continues in the next block.
  const merged = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === 'p' && b.type === 'p' && prev.group !== b.group && !ENDS_SENTENCE.test(prev.text) && /^[a-z]/.test(b.text)) {
      prev.text = joinLines([prev.text, b.text]);
    } else {
      merged.push(b);
    }
  }
  return merged.map(({ type, text }) => ({ type, text }));
}

// OCR pages have no coordinates, so headers/footers are the first/last block. Drop those that are
// bare page numbers or match a known running header (from the text pages, or findRunningBlocks).
export function stripOcrEdges(blocks, running) {
  const out = [...blocks];
  const drop = (b) => b && b.type === 'p' && (PAGE_NUM.test(b.text.trim()) || running.has(normalizeLine(b.text)));
  if (drop(out[0])) out.shift();
  if (drop(out[out.length - 1])) out.pop();
  return out;
}

// For fully scanned books: first/last blocks that repeat across several OCR'd pages.
export function findRunningBlocks(pagesBlocks) {
  const n = pagesBlocks.length;
  if (n < 3) return new Set();
  const counts = new Map();
  for (const blocks of pagesBlocks) {
    const seen = new Set([blocks[0], blocks[blocks.length - 1]].filter((b) => b && b.text.length < 120).map((b) => normalizeLine(b.text)));
    for (const k of seen) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const need = Math.max(3, Math.ceil(n * 0.4));
  return new Set([...counts].filter(([, c]) => c >= need).map(([k]) => k));
}

// Plain OCR text (paragraphs separated by blank lines) -> blocks.
export function textToBlocks(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => joinLines(p.split('\n').map((l) => cleanText(l).trim()).filter(Boolean)))
    .filter((p) => p.trim())
    .map((p) => ({ type: 'p', text: p }));
}

// True when the text layer is missing or unusable and the page should be OCR'd.
export function needsOcr(lines) {
  const text = lines.map((l) => l.text).join(' ');
  const meaningful = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  if (meaningful < 30) return true;
  const bad = (text.match(/[�-]/g) || []).length;
  return bad / text.length > 0.2;
}

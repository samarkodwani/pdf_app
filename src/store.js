import { get, set, del, entries } from 'idb-keyval';

// IndexedDB: doc:<id> = {id,name,total,pages[]}, file:<id> = ArrayBuffer, meta:<id> = list entry.
// localStorage: pos:<id> = reading position, settings.

export function hashBuffer(buf) {
  // FNV-1a (crypto.subtle is unavailable on plain-http LAN dev URLs).
  const bytes = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + '-' + bytes.length.toString(16);
}

export async function saveDoc(doc) {
  await set('doc:' + doc.id, doc);
  await set('meta:' + doc.id, { id: doc.id, name: doc.name, total: doc.total, lastOpened: Date.now() });
}
export const getDoc = (id) => get('doc:' + id);
export const saveFile = (id, buf) => set('file:' + id, buf);
export const getFile = (id) => get('file:' + id);

export async function listDocs() {
  const all = await entries();
  return all
    .filter(([k]) => typeof k === 'string' && k.startsWith('meta:'))
    .map(([, v]) => v)
    .sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function deleteDoc(id) {
  await Promise.all([del('doc:' + id), del('file:' + id), del('meta:' + id)]);
  localStorage.removeItem('pos:' + id);
}

export const loadPos = (id) => {
  try { return JSON.parse(localStorage.getItem('pos:' + id)); } catch { return null; }
};
export const savePos = (id, pos) => localStorage.setItem('pos:' + id, JSON.stringify(pos));

const DEFAULTS = { fontSize: 18, theme: 'light', font: 'serif' };
export const loadSettings = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('settings')) || {};
    if (!saved.font && 'serif' in saved) saved.font = saved.serif ? 'serif' : 'sans'; // from the old Serif/Sans toggle
    delete saved.serif;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
};
export const saveSettings = (s) => localStorage.setItem('settings', JSON.stringify(s));

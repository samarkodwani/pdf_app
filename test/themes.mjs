// Screenshots every theme (settings panel open) into test/themes/<id>.png and checks text/background contrast.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 4183;
fs.mkdirSync('test/themes', { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', PORT, '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => /Local/.test(String(d)) && res()); server.on('exit', rej); setTimeout(() => rej(new Error('no preview')), 20000); });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.setInputFiles('input[type=file]', 'test/fixtures/book.pdf');
  await page.waitForSelector('.reader section p:not(.empty)');
  await page.click('.bar button:last-child'); // Aa
  const ids = await page.$$eval('.swatch', (b) => b.map((x) => x.dataset.theme));
  for (const id of ids) {
    await page.click(`.swatch[data-theme="${id}"]`);
    const c = await page.evaluate(() => {
      const cs = (e, p) => getComputedStyle(e)[p];
      return {
        theme: document.documentElement.dataset.theme, pressed: document.querySelector('.swatch[aria-pressed=true]')?.dataset.theme,
        bg: cs(document.body, 'backgroundColor'), fg: cs(document.querySelector('.reader p'), 'color'),
        muted: cs(document.querySelector('.page-mark span'), 'color'), meta: document.querySelector('meta[name=theme-color]').content,
      };
    });
    const t = ratio(rgb(c.fg), rgb(c.bg)), m = ratio(rgb(c.muted), rgb(c.bg));
    console.log(`${t >= 7 && m >= 3.5 && c.pressed === id && c.theme === id ? 'PASS' : 'FAIL'}  ${id.padEnd(9)} text ${t.toFixed(1)}:1  muted ${m.toFixed(1)}:1  pressed=${c.pressed} meta=${c.meta}`);
    await page.screenshot({ path: `test/themes/${id}.png` });
  }
  // persists across reload
  await page.reload();
  console.log('persisted theme after reload:', await page.evaluate(() => document.documentElement.dataset.theme));
} finally {
  await browser.close();
  server.kill();
}

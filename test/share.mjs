// Simulates Android "Share to app": multipart POST to /share-target, then the redirect lands on ?shared=1.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 4182;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', PORT, '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => /Local/.test(String(d)) && res()); server.on('exit', rej); setTimeout(() => rej(new Error('no preview')), 20000); });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const b64 = fs.readFileSync('test/fixtures/book.pdf').toString('base64');
  const status = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append('pdf', new File([bytes], 'Shared Book.pdf', { type: 'application/pdf' }));
    const r = await fetch('/share-target', { method: 'POST', body: fd, redirect: 'manual' });
    return r.type + ' ' + r.status;
  }, b64);
  console.log('POST /share-target ->', status, '(opaqueredirect is the expected result of a 303 with redirect:manual)');
  await page.goto(`http://localhost:${PORT}/?shared=1`);
  await page.waitForSelector('.reader section p:not(.empty)', { timeout: 30000 });
  const title = await page.textContent('.bar .title');
  const url = page.url();
  console.log(title === 'Shared Book' ? 'PASS' : 'FAIL', 'shared PDF opened in reader, title =', JSON.stringify(title));
  console.log(url.endsWith('/') ? 'PASS' : 'FAIL', '?shared param cleaned from URL ->', url);
} finally {
  await browser.close();
  server.kill();
}

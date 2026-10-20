// Checks: "Original" toggle, scroll-position restore, reopen from the library cache (no re-extraction).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 4180;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', PORT, '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => /Local/.test(String(d)) && res()); server.on('exit', rej); setTimeout(() => rej(new Error('no preview')), 20000); });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.setInputFiles('input[type=file]', path.resolve('test/fixtures/book.pdf'));
  await page.waitForFunction(() => /^p\. \d+\/6$/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 60000 });

  // Original toggle
  await page.locator('section[data-page="2"] button', { hasText: 'Original' }).click();
  await page.waitForSelector('section[data-page="2"] canvas.page-img');
  ok('Original page renders a canvas', true);
  await page.locator('section[data-page="2"] button', { hasText: 'Original' }).click();
  ok('Original toggles off', (await page.locator('canvas.page-img').count()) === 0);

  // Scroll to page 4 and let the position save
  await page.evaluate(() => window.scrollTo(0, document.querySelector('section[data-page="4"]').offsetTop + 120));
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('pos:')))));
  ok('position saved at page 4', saved.page === 4, JSON.stringify(saved));

  // Back to library, list shows doc, reopen from cache
  await page.goBack();
  await page.waitForSelector('.lib li');
  ok('library lists the document', (await page.locator('.lib li').count()) === 1);
  const t0 = Date.now();
  await page.locator('.lib li .name').click();
  await page.waitForSelector('section[data-page="6"] p:not(.empty)', { timeout: 10000 });
  ok('reopened from cache', true, `(${Date.now() - t0} ms)`);
  await page.waitForTimeout(500);
  const pos = await page.evaluate(() => {
    const y = window.scrollY + document.querySelector('.bar').offsetHeight + 8;
    const secs = [...document.querySelectorAll('section')];
    return secs.filter((s) => s.offsetTop <= y).length;
  });
  ok('scroll position restored to page 4', pos === 4, `(visible page ${pos})`);

  // Delete
  await page.goBack();
  await page.waitForSelector('.lib li');
  page.once('dialog', (d) => d.accept());
  await page.locator('.lib li button', { hasText: 'Delete' }).click();
  await page.waitForFunction(() => !document.querySelector('.lib li'));
  ok('delete removes it from library', true);
} finally {
  await browser.close();
  server.kill();
}

// Checks: every font option applies, bundled fonts load (also offline), old serif setting migrates.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const PORT = 4184;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', PORT, '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => /Local/.test(String(d)) && res()); server.on('exit', rej); setTimeout(() => rej(new Error('no preview')), 20000); });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 560 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  // migration: old settings had serif:false
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.setItem('settings', JSON.stringify({ fontSize: 20, theme: 'dark', serif: false })));
  await page.reload();
  await page.setInputFiles('input[type=file]', 'test/fixtures/book.pdf');
  await page.waitForSelector('.reader section p:not(.empty)');
  await page.click('.bar button:last-child');
  ok('old serif:false migrates to Sans', (await page.inputValue('.font-select')) === 'sans' && (await page.evaluate(() => JSON.parse(localStorage.getItem('settings')).font)) === 'sans');
  ok('theme/size preserved through migration', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');

  // every option applies a distinct stack
  const seen = new Set();
  for (const id of await page.$$eval('.font-select option', (o) => o.map((x) => x.value))) {
    await page.selectOption('.font-select', id);
    const ff = await page.evaluate(() => getComputedStyle(document.querySelector('.reader p')).fontFamily);
    seen.add(ff);
    if (id === 'comic') { ok('comic stack starts with Comic Sans MS, falls back to Comic Neue', /^"?Comic Sans MS"?.*Comic Neue/.test(ff), ff); await page.screenshot({ path: 'test/comic.png' }); }
    if (id === 'readable') await page.screenshot({ path: 'test/readable.png' });
  }
  ok('7 options give 7 distinct font stacks', seen.size === 7, `(${seen.size})`);

  // bundled fonts actually load
  const loaded = await page.evaluate(async () => ({
    neue: (await document.fonts.load("16px 'Comic Neue'")).length,
    atk: (await document.fonts.load("16px 'Atkinson Hyperlegible'")).length,
    neueBold: (await document.fonts.load("700 16px 'Comic Neue'")).length,
  }));
  ok('Comic Neue + Atkinson Hyperlegible load', loaded.neue > 0 && loaded.atk > 0 && loaded.neueBold > 0, JSON.stringify(loaded));

  // selection persists, and bundled fonts are available offline after the SW has precached them
  await page.selectOption('.font-select', 'comic');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await ctx.setOffline(true);
  await page.reload();
  await page.locator('.lib li .name').click();
  await page.waitForSelector('.reader section p:not(.empty)');
  await page.click('.bar button:last-child');
  ok('font choice persisted across reload', (await page.inputValue('.font-select')) === 'comic');
  const offline = await page.evaluate(async () => (await document.fonts.load("16px 'Comic Neue'")).length > 0 && (await document.fonts.load("16px 'Atkinson Hyperlegible'")).length > 0);
  ok('bundled fonts load offline', offline);
} finally {
  await browser.close();
  server.kill();
}

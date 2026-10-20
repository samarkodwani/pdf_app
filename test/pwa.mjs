// Checks the PWA bits: manifest (incl. share target), service worker control, and offline reload.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const PORT = 4181;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', PORT, '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => /Local/.test(String(d)) && res()); server.on('exit', rej); setTimeout(() => rej(new Error('no preview')), 20000); });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/`);

  const manifest = await (await page.request.get(`http://localhost:${PORT}/manifest.webmanifest`)).json();
  ok('manifest has share_target', manifest.share_target?.params?.files?.[0]?.name === 'pdf', JSON.stringify(manifest.share_target));
  ok('manifest is standalone', manifest.display === 'standalone');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  ok('service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));

  await ctx.setOffline(true);
  await page.reload();
  ok('app loads offline', (await page.locator('.pick').count()) === 1);
} finally {
  await browser.close();
  server.kill();
}

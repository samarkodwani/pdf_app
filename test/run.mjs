// Usage: node test/run.mjs <fixture.pdf> [--shot out.png]
// Serves dist/ with `vite preview`, opens the fixture in headless Chrome at a phone viewport, dumps the reader text.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';

const fixture = path.resolve(process.argv[2]);
const shotIdx = process.argv.indexOf('--shot');
const shot = shotIdx > 0 ? process.argv[shotIdx + 1] : null;
const PORT = 4179;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', PORT, '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => /Local/.test(String(d)) && resolve());
  server.on('exit', reject);
  setTimeout(() => reject(new Error('preview did not start')), 20000);
});

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log('[browser]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.setInputFiles('input[type=file]', fixture);
  await page.waitForSelector('.reader section', { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const t = document.querySelector('.status')?.textContent || '';
      return t && !/^(Loading|Extracting|OCR)/.test(t);
    },
    null,
    { timeout: 240000, polling: 500 },
  );
  const out = await page.evaluate(() =>
    [...document.querySelectorAll('.reader section')].map((s) => ({
      page: s.dataset.page,
      badge: s.querySelector('.badge')?.textContent || '',
      blocks: [...s.children].filter((c) => /^(P|H\d)$/.test(c.tagName)).map((c) => (c.tagName === 'P' ? '' : `[${c.tagName}] `) + c.textContent),
    })),
  );
  for (const p of out) {
    console.log(`\n=== page ${p.page} ${p.badge ? `(${p.badge})` : ''}  ${p.blocks.length} blocks`);
    for (const b of p.blocks) console.log('  - ' + (b.length > 220 && !process.argv.includes('--full') ?b.slice(0, 110) + ' … ' + b.slice(-90) : b));
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('\nhorizontal overflow:', overflow);
  if (shot) await page.screenshot({ path: shot });
} finally {
  await browser.close();
  server.kill();
}

import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:4390';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'demo@tasktick.local');
await page.fill('#password', 'tasktick-demo-1234');
const ok = page.waitForResponse((r) => r.url().includes('/api/auth/sign-in') && r.status() === 200);
await page.click('button[type="submit"]');
await ok;
await ctx.addCookies([{ name: 'tasktick-demo', value: '1', url: BASE }]);

let phase = 'load';
page.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('/api/period')) return;
  let extra = '';
  if (u.includes('/api/period?') && r.request().method() === 'GET') {
    const body = await r.json().catch(() => null);
    extra = body?.data ? ` cycles=${body.data.cycles.length} dayLogs=${body.data.dayLogs.length}` : '';
  }
  console.log(phase, r.request().method(), r.status(), u.replace(BASE, '').slice(0, 70), extra);
});

await page.goto(`${BASE}/period`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-hero="value"]');
await page.waitForTimeout(1500);
console.log('sw controller:', await page.evaluate(() => !!navigator.serviceWorker?.controller));

phase = 'after-write';
const created = page.waitForResponse((r) => r.url().includes('/api/period/cycles') && r.request().method() === 'POST');
await page.locator('section[aria-label="Cycle estimate"] button').first().click();
console.log('POST status', (await created).status());
await page.waitForTimeout(8000);
console.log('pill:', (await page.locator('section[aria-label="Cycle estimate"] button').first().innerText()).trim());
await browser.close();

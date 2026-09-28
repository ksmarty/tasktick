/**
 * Probe for the Today-screen rework: the week strip, the hero, the insights row.
 *
 * Run from /workspace/tasktick, with the app deployed and a demo cookie so the
 * API serves the sample account's eight cycles of history:
 *
 *   BASE=http://127.0.0.1:4390 OUT=/var/tmp/shots-today-strip node .probe-today-strip.mjs
 *
 * ## What it measures, and why this way
 *
 * Every claim is a measurement on the rendered page — a node count, a bounding
 * box, a computed background, `scrollWidth` — or a comparison against the API's
 * own response. The hero in particular is *recomputed from the JSON* by the rule
 * the screen documents ("ovulation or period, whichever is next"), so a hardcoded
 * number, a stale one, or one measured from the wrong day all fail rather than
 * agreeing with themselves.
 *
 * The period fill is checked four weeks back rather than on today: the sample's
 * most recent period ended 24 days ago, so the current week genuinely has no
 * bleeding in it, and inventing one would be the probe agreeing with itself
 * again. Walking the strip back is also the only way to prove the week
 * navigation refetches the window the marks come from.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4390';
const OUT = process.env.OUT ?? '/var/tmp/shots-today-strip';
const VIEWPORT = { width: 390, height: 844 };

mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const DAY = 86_400_000;
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const diff = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (date) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const countValue = (n) => (n === 0 ? 'Today' : n === 1 ? '1 day' : `${n} days`);

/** The user's week start (0 = Sunday), from the same setting the app reads. */
function startOfWeek(date, weekStartsOn) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shift(date, -((dow - weekStartsOn + 7) % 7));
}

/**
 * What the hero must say, derived from the prediction payload by the documented
 * rule — not by importing the screen's own module, which would let a bug in it
 * pass.
 */
function heroExpectation(prediction, date) {
  const { ovulationDate, nextPeriodStart } = prediction;
  if (prediction.dataSufficient) {
    if (ovulationDate && date <= ovulationDate) {
      const days = diff(date, ovulationDate);
      return { lead: days === 0 ? 'Ovulation' : 'Ovulation in', value: countValue(days), branch: 'ovulation' };
    }
    if (nextPeriodStart && date <= nextPeriodStart) {
      const days = diff(date, nextPeriodStart);
      return { lead: days === 0 ? 'Period' : 'Period in', value: countValue(days), branch: 'period' };
    }
    if (nextPeriodStart) return { lead: 'Cycle day', value: String(diff(nextPeriodStart, date) + 1), branch: 'cycleDay' };
  }
  if (prediction.lastPeriodStart && date >= prediction.lastPeriodStart) {
    return { lead: 'Cycle day', value: String(diff(prediction.lastPeriodStart, date) + 1), branch: 'cycleDay' };
  }
  return { lead: 'No history yet', value: '—', branch: 'none' };
}

const browser = await chromium.launch();
const consoleErrors = [];
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'demo@tasktick.local');
await page.fill('#password', 'tasktick-demo-1234');
const signedIn = page.waitForResponse(
  (response) => response.url().includes('/api/auth/sign-in') && response.status() === 200,
  { timeout: 30000 },
);
await page.click('button[type="submit"]');
await signedIn;

/* Demo mode: every request from here runs as the sample account, which is the
   only account with period history. */
await context.addCookies([{ name: 'tasktick-demo', value: '1', url: BASE }]);

async function api(path) {
  const response = await context.request.fetch(`${BASE}${path}`);
  const body = await response.json().catch(() => null);
  if (!response.ok() || body?.ok === false) throw new Error(`${path} -> ${response.status()} ${JSON.stringify(body)}`);
  return body.data;
}

const boot = await api('/api/bootstrap');
const weekStartsOn = boot.settings?.weekStartsOn ?? 1;
const prediction = await api('/api/period/prediction');
console.log(`server today ${prediction.asOf}, weekStartsOn ${weekStartsOn}, dataSufficient ${prediction.dataSufficient}`);

await page.goto(`${BASE}/period`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-week-strip]', { timeout: 30000 });
await page.waitForSelector('[data-hero="value"]', { timeout: 30000 });
await page.waitForTimeout(800);

const today = await page.locator('[data-week-strip] > button[aria-current="date"]').first().getAttribute('data-date');
check('the day the app marks as current is the server’s today', today === prediction.asOf, `${today} vs ${prediction.asOf}`);

await page.screenshot({ path: `${OUT}/today.png`, fullPage: true });
await page.screenshot({ path: `${OUT}/today-viewport.png` });

/* ========================================================================== */
/* 1 — the week strip                                                         */
/* ========================================================================== */
const buttons = page.locator('[data-week-strip] > button');
check('the strip renders seven days', (await buttons.count()) === 7, `${await buttons.count()} days`);

const weekStart = await page.locator('[data-week-strip]').getAttribute('data-week-strip');
check(
  'the strip starts on the configured week start',
  weekStart === startOfWeek(today, weekStartsOn),
  `weekStart=${weekStart} weekStartsOn=${weekStartsOn}`,
);

const pressed = page.locator('[data-week-strip] > button[aria-pressed="true"]');
check('exactly one day is pressed, and it is today', (await pressed.count()) === 1 && (await pressed.first().getAttribute('data-date')) === today);
check('today carries aria-current="date" once', (await page.locator('[data-week-strip] > button[aria-current="date"]').count()) === 1);

/** Every day's painted disc, measured rather than read off a class name. */
async function discGeometry() {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-week-strip]');
    return [...strip.querySelectorAll(':scope > button')].map((button) => {
      const disc = button.querySelector('[data-day-disc]');
      const rect = disc.getBoundingClientRect();
      const style = getComputedStyle(disc);
      return {
        date: button.dataset.date,
        pressed: button.getAttribute('aria-pressed') === 'true',
        state: disc.dataset.dayDisc,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        shadow: style.boxShadow,
        background: style.backgroundColor,
        right: Math.round(button.getBoundingClientRect().right),
        tail: button.querySelectorAll('svg').length,
      };
    });
  });
}

const discs = await discGeometry();
const selectedDisc = discs.find((disc) => disc.pressed);
const plainDiscs = discs.filter((disc) => disc.state === 'plain');
check(
  'the selected day is a raised disc: card-coloured, shadowed and larger than the row',
  selectedDisc.width === 44 && selectedDisc.height === 44 && selectedDisc.shadow !== 'none',
  `size=${selectedDisc.width}x${selectedDisc.height} shadow=${selectedDisc.shadow}`,
);
check(
  'plain days are the smaller, shadowless discs',
  plainDiscs.every((disc) => disc.width === 36 && disc.shadow === 'none' && disc.background === 'rgba(0, 0, 0, 0)'),
  JSON.stringify(plainDiscs.map((disc) => [disc.width, disc.shadow, disc.background])),
);
check('the tail hangs under the selected day only', selectedDisc.tail > 0 && plainDiscs.every((disc) => disc.tail === 0));
check('the seven cells fit the 390px viewport', discs.every((disc) => disc.right <= 391), JSON.stringify(discs.map((d) => d.right)));

/* ========================================================================== */
/* 2 — tapping a day moves everything below it                                */
/* ========================================================================== */
const other = discs.map((disc) => disc.date).at(-1);
const lineBefore = await page.locator('#today-day-log > p').first().innerText();
const heroBefore = await page.locator('[data-hero="value"]').innerText();

await page.click(`[data-date="${other}"]`);
await page.waitForFunction(
  (date) => document.querySelector('[data-date][aria-pressed="true"]')?.dataset.date === date,
  other,
  { timeout: 10000 },
);
await page.waitForTimeout(400);

const lineAfter = await page.locator('#today-day-log > p').first().innerText();
const heroAfter = await page.locator('[data-hero="value"]').innerText();
check('the day line under the hero names the day that was tapped', lineAfter !== lineBefore && lineAfter.includes(shortDate(other)), `“${lineBefore}” -> “${lineAfter}”`);

const expectedOther = heroExpectation(prediction, other);
check(
  'the hero’s number is the API countdown for the tapped day',
  (await page.locator('[data-hero="lead"]').innerText()) === expectedOther.lead && heroAfter === expectedOther.value,
  `${await page.locator('[data-hero="lead"]').innerText()} ${heroAfter} (expected ${expectedOther.lead} ${expectedOther.value}; was ${heroBefore} for today)`,
);

/* The sentence is the API's, not ours: each branch must name the date or window
   the payload actually carries. */
const sentence = await page.locator('[data-hero="sentence"]').innerText();
const nextStart = prediction.nextPeriodStart ? shortDate(prediction.nextPeriodStart) : '';
if (expectedOther.branch === 'period') {
  const band = `± ${prediction.uncertainty.days} ${prediction.uncertainty.days === 1 ? 'day' : 'days'}`;
  check('the hero sentence carries the API’s range and ± band', sentence.includes(band) && sentence.includes(nextStart), `“${sentence}”`);
} else if (expectedOther.branch === 'ovulation') {
  const windowEnd = prediction.fertileWindow ? shortDate(prediction.fertileWindow.end) : '';
  check(
    'the hero sentence names the API’s fertile window',
    sentence.includes('fertile window') || (windowEnd !== '' && sentence.includes(windowEnd)),
    `“${sentence}”`,
  );
} else {
  check(
    'the hero sentence counts from the API’s expected period',
    sentence.includes('expected') && nextStart !== '' && sentence.includes(nextStart),
    `“${sentence}”`,
  );
}
check('the hero never states a probability', !/%|chance|probab|pregnan/i.test(sentence), `“${sentence}”`);

await page.screenshot({ path: `${OUT}/today-picked-day.png`, fullPage: true });

/* The prediction card stays anchored to the API's own today while the hero is on
   the tapped day: its sentences ('Expected tomorrow', 'Today is day N') are
   relative to the prediction's `asOf`, so a selected day would make them false. */
const cardText = await page.locator('section[aria-label="Next period prediction"]').innerText();
const until = diff(prediction.asOf, prediction.nextPeriodStart);
const expectedPhrase = until === 0 ? 'Expected today.' : until === 1 ? 'Expected tomorrow.' : `Expected in ${until} days.`;
check(
  'the prediction card keeps describing the API’s today',
  cardText.includes(expectedPhrase),
  `looking for “${expectedPhrase}” in ${JSON.stringify(cardText.slice(0, 120))}`,
);

/* Back to today for the remaining checks. */
await page.locator('[data-week-strip] > button[aria-current="date"]').click();
await page.waitForTimeout(400);

/* ========================================================================== */
/* 3 — the period fill, four weeks back                                       */
/* ========================================================================== */
for (let step = 0; step < 4; step += 1) {
  const before = await page.locator('[data-week-strip]').getAttribute('data-week-strip');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.waitForFunction((week) => document.querySelector('[data-week-strip]')?.dataset.weekStrip !== week, before, {
    timeout: 15000,
  });
  await page.waitForTimeout(300);
}
const backDiscs = await discGeometry();
const filled = backDiscs.filter((disc) => disc.state.startsWith('period'));
check(
  'a week holding a recorded period paints those days filled',
  filled.length > 0 && filled.every((disc) => disc.background !== 'rgba(0, 0, 0, 0)'),
  JSON.stringify(backDiscs.map((disc) => [disc.date, disc.state, disc.background])),
);
await page.screenshot({ path: `${OUT}/week-with-period.png`, fullPage: true });

/* ========================================================================== */
/* 4 — the insights row scrolls horizontally                                  */
/* ========================================================================== */
const row = page.locator('[data-insights-row="today"]');
const geometry = await row.evaluate((node) => ({
  scrollWidth: node.scrollWidth,
  clientWidth: node.clientWidth,
  scrollLeft: node.scrollLeft,
}));
check(
  'the insights row is wider than its viewport, so it scrolls',
  geometry.scrollWidth > geometry.clientWidth,
  `scrollWidth=${geometry.scrollWidth} clientWidth=${geometry.clientWidth}`,
);
check('the first card is the action', (await page.locator('[data-insight-card="log"]').count()) === 1);
check(
  'the row carries content cards behind the action',
  (await page.locator('[data-insight-card]:not([data-insight-card="log"])').count()) >= 1,
  `cards: ${(await page.locator('[data-insight-card]').count())}`,
);

await row.evaluate((node) => {
  node.scrollLeft = node.scrollWidth;
});
await page.waitForTimeout(400);
const scrolled = await row.evaluate((node) => node.scrollLeft);
check(
  'the row scrolls to its end',
  scrolled > 0 && scrolled >= geometry.scrollWidth - geometry.clientWidth - 2,
  `scrollLeft=${scrolled}`,
);

/* The heading, not the row: the row scrolled into view can land behind the
   floating tab bar, which would put the bar in the middle of the screenshot. */
await page.evaluate(() => document.getElementById('today-insights-heading')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(400);
const box = await row.boundingBox();
await page.screenshot({
  path: `${OUT}/insights-scrolled.png`,
  clip: {
    x: 0,
    y: Math.max(0, Math.round(box.y) - 36),
    width: VIEWPORT.width,
    height: Math.min(200, VIEWPORT.height - Math.max(0, Math.round(box.y) - 36)),
  },
});

/* The row's cards are not clipped by its own gutter: card one starts on the
   gutter line and the row spans the full width. Measured from the left edge, so
   the row must be back at its start first. */
await row.evaluate((node) => {
  node.scrollLeft = 0;
});
await page.waitForTimeout(200);
const gutters = await row.evaluate((node) => {
  const first = node.querySelector('[data-insight-card="log"]').getBoundingClientRect();
  const last = [...node.querySelectorAll('[data-insight-card]')].at(-1).getBoundingClientRect();
  return { firstLeft: Math.round(first.left), lastRight: Math.round(last.right), nodeLeft: Math.round(node.getBoundingClientRect().left) };
});
check(
  'the row is full-bleed and its first card sits on the 1rem gutter',
  gutters.nodeLeft === 0 && gutters.firstLeft === 16 && gutters.lastRight > VIEWPORT.width - 32,
  JSON.stringify(gutters),
);

/* ========================================================================== */
/* 5 — the action card reveals the one form                                   */
/* ========================================================================== */
const formBefore = await page.evaluate(() => document.getElementById('today-day-log').getBoundingClientRect().top);
await page.locator('[data-insight-card="log"]').click();
await page.waitForTimeout(900);
const formAfter = await page.evaluate(() => document.getElementById('today-day-log').getBoundingClientRect().top);
const focused = await page.evaluate(() => document.activeElement?.id ?? null);
check(
  'the action card brings the day log into view and focuses it',
  formAfter < formBefore && focused === 'today-day-log',
  `top ${Math.round(formBefore)} -> ${Math.round(formAfter)}, focus=${focused}`,
);

/* ========================================================================== */
/* 6 — nothing overflows                                                      */
/* ========================================================================== */
await page.goto(`${BASE}/period`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-hero="value"]', { timeout: 30000 });
await page.waitForTimeout(800);
const overflow = await page.evaluate((viewportWidth) => {
  const bad = [];
  for (const node of document.querySelectorAll('body *')) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right <= viewportWidth + 1) continue;
    const style = getComputedStyle(node);
    if (style.position === 'fixed') continue;
    let parent = node.parentElement;
    let inScroller = false;
    while (parent) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.overflowX === 'auto' || parentStyle.overflowX === 'scroll') {
        inScroller = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!inScroller) bad.push({ tag: node.tagName, cls: String(node.className).slice(0, 50), right: Math.round(rect.right) });
  }
  return { bad: bad.slice(0, 6), doc: document.documentElement.scrollWidth, body: document.body.scrollWidth };
}, VIEWPORT.width);
check(
  'nothing overflows the page horizontally',
  overflow.bad.length === 0 && overflow.doc <= 391 && overflow.body <= 391,
  JSON.stringify(overflow),
);

/* The hero is the widest card and stops at the gutter. */
const heroBox = await page.locator('section[aria-label="Cycle estimate"]').boundingBox();
check(
  'the hero card fills the width between the gutters',
  Math.round(heroBox.x) === 16 && Math.round(heroBox.width) === VIEWPORT.width - 32,
  JSON.stringify(heroBox),
);

/* A tall viewport, so the whole screen is in one image: the shell scrolls its
   own `main`, so a `fullPage` screenshot of the document is only ever one
   viewport tall. */
await page.setViewportSize({ width: VIEWPORT.width, height: 2600 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/today-tall.png` });

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('failed:', failed.map((result) => result.name).join('; '));
  process.exit(1);
}

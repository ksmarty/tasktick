#!/usr/bin/env node
/**
 * Geometry check for the quick-add highlight mirror.
 *
 * Why this is a browser script and not a unit test: the mirror's whole job is
 * that its glyphs land on top of the input's glyphs, and that each tint is a
 * pill around its own word. Both are *layout* — jsdom reports every rectangle as
 * zero, so no vitest case can see either one.
 *
 * It exists because the previous attempt at "more horizontal padding" passed
 * every measurement it was given and was still wrong: the tint reached 6px past
 * its word in each direction, adjacent tints overlapped by 7.2px, two fills
 * merged into one band and the outlined kinds drew their ring straight through
 * the neighbouring word. Nothing here checked that tints *clear each other*.
 *
 * Four things are asserted, in the order they can break:
 *
 *   1. both layers carry the same word spacing — if only one does, the mirror
 *      drifts off the caret by a space-width per word;
 *   2. the two layers agree on the text's total advance (sub-pixel);
 *   3. every tint has its glyphs strictly inside its own box (padding inside);
 *   4. no tint reaches into a neighbouring word, and no two tints overlap.
 *
 * Needs a deployed server and Playwright (`npx playwright install-deps
 * chromium` for the system libraries). Not part of `npm test` or CI.
 *
 * Usage: node scripts/smoke/highlights.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('this check needs Playwright: npm i -D playwright && npx playwright install-deps chromium');
  process.exit(2);
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`  ${ok ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m'} ${name}${ok ? '' : ` — ${detail ?? ''}`}`);
}

/**
 * Long enough to overflow the field. That matters: an input's `scrollWidth`
 * reports its text only while the text overflows — when it fits, `scrollWidth`
 * is the content box and says nothing about the text at all. The sentence has to
 * be wider than the field for the advance comparison to mean anything.
 */
const SENTENCE = 'Pay rent tomorrow 5pm !high #home and call the plumber tomorrow 9am !low #home';

let cookies = '';
function merge(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    const rest = cookies.split('; ').filter(Boolean).filter((x) => !x.startsWith(`${name}=`));
    rest.push(pair);
    cookies = rest.join('; ');
  }
}

const email = `highlights-${Date.now()}@example.com`;

/**
 * `SMOKE_EMAIL`/`SMOKE_PASSWORD` sign in to an existing account; without them a
 * throwaway account is registered. Registration is invite-gated by default
 * (`REGISTRATION_MODE`), so on a locked-down instance the credentials are the
 * only way in.
 */
const smokeEmail = process.env.SMOKE_EMAIL;
const smokePassword = process.env.SMOKE_PASSWORD;
const auth = smokeEmail
  ? await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
    })
  : await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ email, password: 'smoke-test-password-1234', name: 'Highlights' }),
    });
merge(auth);
if (auth.status !== 200) {
  console.error(
    smokeEmail ? 'could not sign in:' : 'could not create an account:',
    auth.status,
    (await auth.text()).slice(0, 200),
  );
  if (!smokeEmail) {
    console.error('set SMOKE_EMAIL/SMOKE_PASSWORD to use an existing account, or run against an instance with REGISTRATION_MODE=open');
  }
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
await context.addCookies(
  cookies.split('; ').map((pair) => {
    const [name, ...rest] = pair.split('=');
    return { name, value: rest.join('='), url: BASE };
  }),
);
const page = await context.newPage();

console.log(`\nquick-add highlight geometry on ${BASE}\n`);
try {
  /*
   * `networkidle`, not `domcontentloaded`. Opening the sheet from the
   * server-rendered button before hydration settles closes it again ~200ms
   * later — measured, not guessed: the field is present when the click returns
   * and gone two frames on. Waiting for the page to settle avoids that and keeps
   * this check about the tint rather than about hydration timing.
   */
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="Add a task"]:visible', { timeout: 30000 });
  await page.locator('button[aria-label="Add a task"]:visible').first().click();
  const input = page.locator('[role="dialog"] input[aria-label="Quick add a task"]:visible').first();
  await input.waitFor({ timeout: 30000 });
  await input.fill(SENTENCE);
  await page.waitForTimeout(700);

  const data = await page.evaluate((sentence) => {
    const el = document.querySelector('input[aria-label="Quick add a task"]');
    const mirror = [...document.querySelectorAll('div')].find((d) =>
      String(d.className).includes('text-transparent'),
    );
    if (!el || !mirror) return null;
    const inner = mirror.querySelector(':scope > span');
    const cs = getComputedStyle(el);
    const rows = [...inner.querySelectorAll(':scope > span')].map((s) => {
      const box = s.getBoundingClientRect();
      const whole = document.createRange();
      whole.selectNodeContents(s);
      const t = whole.getBoundingClientRect();
      /*
       * A plain segment usually ends in the space separating it from the next
       * word, and that space is part of its glyph range. A tint is *meant* to
       * reach into that space, so "does it clip the word before it?" has to be
       * asked of the last real glyph rather than of the trailing whitespace.
       */
      const trimmed = s.textContent.replace(/\s+$/, '').length;
      const only = document.createRange();
      only.setStart(s.firstChild, 0);
      only.setEnd(s.firstChild, trimmed);
      const tTrim = trimmed > 0 ? only.getBoundingClientRect() : t;
      return {
        text: s.textContent,
        tinted: String(s.className).length > 0,
        box: [box.left, box.right],
        glyphs: [t.left, t.right],
        // `null` for a whitespace-only segment: it has no glyph to be clipped.
        lastGlyphEnd: trimmed > 0 ? +tTrim.right.toFixed(2) : null,
      };
    });
    return {
      rows,
      inputSpacing: cs.wordSpacing,
      mirrorSpacing: getComputedStyle(mirror).wordSpacing,
      inputAdvance: el.scrollWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      mirrorAdvance: inner.getBoundingClientRect().width,
      spaces: (sentence.match(/ /g) ?? []).length,
    };
  }, SENTENCE);

  if (!data) {
    record('the highlight mirror renders', false, 'no input or no tint layer found');
  } else {
    const tinted = data.rows.filter((r) => r.tinted);

    record(
      'both layers carry the same word spacing',
      data.inputSpacing === data.mirrorSpacing && parseFloat(data.inputSpacing) > 0,
      `input ${data.inputSpacing} vs mirror ${data.mirrorSpacing}`,
    );

    /*
     * `scrollWidth` is an integer, so a sub-pixel difference is rounding rather
     * than drift. A real desync is a space-width per word — with five spaces at
     * 0.4em that is ~32px, an order of magnitude clear of this threshold.
     */
    const drift = Math.abs(data.inputAdvance - data.mirrorAdvance);
    record(
      'the layers agree on the text advance',
      drift < 2,
      `input ${data.inputAdvance.toFixed(2)}px vs mirror ${data.mirrorAdvance.toFixed(2)}px (drift ${drift.toFixed(2)}px)`,
    );

    record(
      'the padding sits inside the tint',
      tinted.length > 0 && tinted.every((t) => t.glyphs[0] > t.box[0] && t.glyphs[1] < t.box[1]),
      tinted.map((t) => `${t.text}:${(t.glyphs[0] - t.box[0]).toFixed(1)}`).join(' '),
    );

    let worst = Infinity;
    let clipped = null;
    for (let i = 0; i < tinted.length; i += 1) {
      if (i > 0) worst = Math.min(worst, tinted[i].box[0] - tinted[i - 1].box[1]);
      /*
       * Walk back to the nearest segment that actually has a glyph. A tint is
       * allowed to reach across the space before it — that is where its padding
       * lives — so a whitespace-only neighbour has nothing to clip.
       */
      let j = data.rows.indexOf(tinted[i]) - 1;
      while (j >= 0 && data.rows[j].lastGlyphEnd === null) j -= 1;
      if (j >= 0 && tinted[i].box[0] < data.rows[j].lastGlyphEnd) {
        clipped = `${tinted[i].text} reaches into ${JSON.stringify(data.rows[j].text)}`;
      }
    }
    record(
      'no two tints overlap',
      worst > 0,
      `worst gap ${worst.toFixed(2)}px`,
    );
    record('no tint reaches into the word before it', clipped === null, clipped ?? '');
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? '\u001b[32m✓' : '\u001b[31m✗'} ${results.length - failed.length}/${results.length} highlight checks passed\u001b[0m\n`);
if (failed.length) process.exitCode = 1;

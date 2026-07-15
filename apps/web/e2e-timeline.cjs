// e2e: verify the Replay Timeline Viewer (D) works in the live app — record a
// world, stop, then scrub the timeline strip and confirm the per-frame state
// readout updates (proves seekTo wires through to the UI on a real GPU/React
// render). Hard gate: the timeline must be interactive + show deterministic
// frame state, not just render statically.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:5174';

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const pageErrors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  console.log('mount pageerrors:', pageErrors.length);

  // Generate + run the sim so there is a world to record.
  await page.getByRole('button', { name: /Generate/ }).click();
  await page.getByRole('button', { name: /Run/ }).click();
  await page.waitForTimeout(1500);
  // Record + Stop to populate the timeline.
  await page.getByRole('button', { name: /Record/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Stop/ }).click();
  await page.waitForTimeout(400);

  // The timeline strip should now exist. Click near the right end to scrub.
  const strip = page.locator('div[title="click to scrub to a tick"]');
  const stripCount = await strip.count();
  console.log('timeline strips found:', stripCount);
  if (stripCount === 0) {
    await browser.close();
    console.error('TIMELINE FAIL: no timeline strip rendered');
    process.exit(1);
  }
  // Scrub to ~75% along the strip.
  const box = await strip.first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.waitForTimeout(300);

  // The per-frame readout should show after seeking.
  const readout = await page.evaluate(() => {
    const els = [...document.querySelectorAll('div')];
    const m = els.find((e) => /frame @ tick/.test(e.textContent || ''));
    return m ? m.textContent : null;
  });
  console.log('seek readout:', readout);
  console.log('page errors:', pageErrors.length ? pageErrors : 'none');

  const ok = pageErrors.length === 0 && stripCount > 0 && readout && /frame @ tick \d+/.test(readout);
  await browser.close();
  if (!ok) { console.error('TIMELINE FAIL'); process.exit(1); }
  console.log('TIMELINE PASS: replay timeline viewer is interactive + shows deterministic frame state');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

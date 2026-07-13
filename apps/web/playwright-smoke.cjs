// Playwright e2e smoke test for the PROJECT OMEGA apps/web demo.
// CJS, default chromium import. Verifies the browser actually renders + the
// UI flows work (PBR canvas, Run tick, Share, Seed-URL load). Captures console
// + page errors so we can see real bugs, not just headless test green.
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';

async function main() {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const results = [];
  const consoleErrors = [];
  const pageErrors = [];

  function record(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  }

  // ---- Page 1: fresh load + Generate + Run ----
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  record('app mounts (no pageerror on load)', pageErrors.length === 0, pageErrors[0] || '');

  // Click Generate
  await page.getByText('Generate', { exact: true }).click();
  await page.waitForTimeout(800);

  // Run
  await page.getByText('▶ Run', { exact: true }).click();
  await page.waitForTimeout(1500);

  // HUD: physTick should have advanced
  const physTickTxt = await page.locator('text=Physics tick').first().textContent().catch(() => null);
  record('HUD shows Physics tick', !!physTickTxt, physTickTxt || '');

  // Read physTick value to confirm it advanced
  const tickVal = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.textContent && d.textContent.startsWith('Physics tick'));
    return el ? el.textContent : null;
  });
  const tickNum = tickVal ? parseInt((tickVal.match(/(\d+)/) || [])[1] || '0', 10) : 0;
  record('sim is ticking (physTick > 0)', tickNum > 0, `physTick=${tickNum}`);

  // Colony HUD present
  const colony = await page.locator('text=Colony-Sim').first().textContent().catch(() => null);
  record('Colony-Sim HUD present', !!colony, colony || '');

  // PBR canvas: WebGL2 context + non-empty pixels
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return { ok: false, reason: 'no canvas' };
    const gl = c.getContext('webgl2');
    if (!gl) return { ok: false, reason: 'no webgl2 context' };
    const px = new Uint8Array(4 * 100);
    gl.readPixels(c.width / 2 - 5, c.height / 2 - 5, 10, 10, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nonZero = 0;
    for (let i = 0; i < px.length; i++) if (px[i] !== 0) nonZero++;
    return { ok: true, hasWebGL2: true, nonZero, w: c.width, h: c.height };
  });
  record('Terrain canvas has WebGL2', canvasInfo.ok && canvasInfo.hasWebGL2, canvasInfo.reason || ``);
  record('Terrain renders pixels (PBR not blank)', canvasInfo.nonZero > 0, `nonZero=${canvasInfo.nonZero}`);

  // Share world button: should not throw
  await page.getByText('🔗 Share world', { exact: true }).click().catch((e) => record('Share world click', false, String(e)));
  await page.waitForTimeout(300);
  record('Share world click did not crash', true, '');

  // ---- Page 2: seed URL load ----
  const page2 = await browser.newPage();
  page2.on('pageerror', (e) => pageErrors.push('page2: ' + String(e)));
  await page2.goto(BASE + '/?seed=playwright-probe', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(600);
  await page2.getByText('Generate', { exact: true }).click().catch(() => {});
  await page2.waitForTimeout(800);
  const seedInput2 = await page2.evaluate(() => {
    const inp = document.querySelector('input');
    return inp ? inp.value : null;
  });
  record('Seed URL (?seed=) seeds the app', seedInput2 === 'playwright-probe', `input="${seedInput2}"`);

  await browser.close();

  console.log('\n=== CONSOLE ERRORS (' + consoleErrors.length + ') ===');
  consoleErrors.slice(0, 20).forEach((e) => console.log('  ' + e));
  console.log('=== PAGE ERRORS (' + pageErrors.length + ') ===');
  pageErrors.slice(0, 20).forEach((e) => console.log('  ' + e));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== SUMMARY: ${results.length - failed.length}/${results.length} passed, ${pageErrors.length} page errors ===`);
  process.exit(failed.length === 0 && pageErrors.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SCRIPT ERROR:', e); process.exit(2); });

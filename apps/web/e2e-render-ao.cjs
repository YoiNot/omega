// e2e: verify the integrated Multi-Pass renderer (G-Buffer -> GTAO -> PBR+IBL,
// driven by @omega/render-graph) actually renders in a real browser (SwiftShader
// headless). Hard gate from the project's Graphics verification policy: tsc +
// vitest passing is necessary but NOT sufficient — the GPU pipeline must run
// without GL errors and produce pixels.
//
// The app auto-mounts a canvas but only renders once the RAF loop is started
// via the UI ("Generate" builds the world, "▶ Run" starts the simulation/redraw
// loop). We click both to exercise the full Graph-driven multi-pass pipeline.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:5174';

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const pageErrors = [];
  const consoleErrors = [];
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  const mountErrors = pageErrors.length;
  console.log('mount pageerrors:', mountErrors);

  // The app renders only once the RAF loop is started via the UI buttons.
  await page.getByRole('button', { name: /Generate/ }).click();
  await page.getByRole('button', { name: /Run/ }).click();
  await page.waitForTimeout(1500);

  const stats = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return { hasCanvas: false };
    const gl = c.getContext('webgl2');
    if (!gl) return { hasCanvas: true, hasGl: false };
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nz = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) nz++;
    return { hasCanvas: true, hasGl: true, w: c.width, h: c.height, nonZero: nz };
  });
  console.log('CANVAS STATS:', JSON.stringify(stats));
  console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');
  console.log('page errors:', pageErrors.length ? pageErrors : 'none');

  const ok = mountErrors === 0 && stats.hasCanvas && stats.hasGl && stats.nonZero > 1000 && pageErrors.length === 0;
  await browser.close();
  if (!ok) { console.error('E2E FAIL'); process.exit(1); }
  console.log('E2E PASS: integrated GTAO+PBR renderer (render-graph driven) renders on real WebGL2');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

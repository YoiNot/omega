// UI/UX audit for apps/web — measures the live DOM, computes WCAG contrast,
// detects the duplicated "What this proves" list, text overflow, button
// hit-targets, and captures a screenshot for visual inspection.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.click('text=Generate');
  await page.waitForTimeout(1500);

  // Screenshot for visual inspection.
  await page.screenshot({ path: '/tmp/omega-ui.png', fullPage: false });

  const audit = await page.evaluate(() => {
    const rgb = (s) => {
      const m = s.match(/\d+/g);
      return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : null;
    };
    const lum = ([r, g, b]) => {
      const f = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (fg, bg) => {
      const L1 = lum(rgb(fg)), L2 = lum(rgb(bg));
      const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
      return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
    };

    const out = {};

    // Buttons in header.
    const btns = [...document.querySelectorAll('header button, header label')];
    out.buttons = btns.map((b) => {
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return {
        text: b.textContent.trim().slice(0, 24),
        w: Math.round(r.width), h: Math.round(r.height),
        fs: cs.fontSize, bg: cs.backgroundColor, color: cs.color,
        hover: cs.cursor,
      };
    });

    // Sidebar.
    const aside = document.querySelector('aside');
    const acs = aside ? getComputedStyle(aside) : null;
    out.sidebar = aside ? { w: Math.round(aside.getBoundingClientRect().width), bg: acs.backgroundColor, fs: acs.fontSize } : null;

    // Metric labels contrast vs sidebar bg.
    const labels = [...document.querySelectorAll('aside div')].filter((d) => d.children.length === 2);
    out.labelContrast = labels.slice(0, 4).map((d) => {
      const span = d.querySelector('span');
      const cs = getComputedStyle(span);
      return { text: span.textContent.slice(0, 20), color: cs.color, contrast: contrast(cs.color, acs.backgroundColor) };
    });

    // Count "What this proves" lists + duplicate detection.
    const uls = [...document.querySelectorAll('aside ul')];
    out.ulCount = uls.length;
    out.liCounts = uls.map((u) => u.querySelectorAll('li').length);
    // Detect near-duplicate lists by their first item text.
    out.ulFirstItems = uls.map((u) => u.querySelector('li')?.textContent.slice(0, 30));

    // Status text overflow.
    const status = [...document.querySelectorAll('aside h3')].find((h) => h.textContent === 'Status');
    const statusVal = status?.nextElementSibling;
    out.status = statusVal ? { text: statusVal.textContent.slice(0, 60), overflow: statusVal.scrollWidth > statusVal.clientWidth } : null;

    // Header height + button row overflow (do buttons wrap on narrow widths?).
    const header = document.querySelector('header');
    out.header = header ? { h: Math.round(header.getBoundingClientRect().height) } : null;

    return out;
  });

  // Narrow-viewport check (responsive?).
  await page.setViewportSize({ width: 720, height: 800 });
  await page.waitForTimeout(400);
  const narrow = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const header = document.querySelector('header');
    return {
      asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : null,
      headerOverflows: header ? header.scrollWidth > header.clientWidth : null,
    };
  });

  console.log(JSON.stringify({ audit, narrow, errors }, null, 2));
  await browser.close();
})();

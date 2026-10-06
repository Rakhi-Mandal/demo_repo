// backend/tests/fixtures/walker_fixture.js
//
// Playwright fixture that captures DOM after each test (pass or fail).
// Writes catalog to test-results/dom_catalog_insession_<ts>_<title>.json

// Resolve @playwright/test from the project's node_modules (where playwright.config.js lives).
// This avoids "Requiring @playwright/test second time" errors when the project has its
// own node_modules separate from the framework root.
const fs = require('fs');
const path = require('path');
function resolveProjectPlaywright() {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, 'node_modules', '@playwright', 'test'),
    path.resolve(cwd, '..', 'node_modules', '@playwright', 'test'),
    path.resolve(cwd, '..', '..', 'node_modules', '@playwright', 'test'),
  ];
  for (const candidate of candidates) {
    try {
      const indexPath = require('path').join(candidate, 'index.js');
      if (require('fs').existsSync(indexPath) || require('fs').existsSync(candidate)) {
        return require(candidate);
      }
    } catch (_) {}
  }
  // Fallback: use the regular resolution (might still hit the "second time" issue)
  return require('@playwright/test');
}

const { test: base } = resolveProjectPlaywright();

function findBrowserScript() {
  // Walk up from this file's directory looking for src/healing/browser_script.js
  let cur = path.resolve(__dirname);
  for (let i = 0; i < 10; i++) {
    const candidate = path.resolve(cur, 'src', 'healing', 'browser_script.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // Fallback: cwd-based lookup
  cur = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.resolve(cur, 'src', 'healing', 'browser_script.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function loadBrowserScript() {
  const scriptPath = findBrowserScript();
  if (!scriptPath) return '';
  try {
    return fs.readFileSync(scriptPath, 'utf8');
  } catch (e) {
    return '';
  }
}

async function buildFramePath(frame) {
  const fp = [];
  let f = frame;
  while (f) {
    if (f.parentFrame() === null) {
      fp.push('main');
    } else {
      let label = '';
      try {
        const el = await f.frameElement();
        if (el) {
          for (const attr of ['id', 'name', 'data-testid']) {
            const v = await el.getAttribute(attr);
            if (v) {
              label = (attr === 'id') ? `iframe#${v}` : `iframe[${attr}=${v}]`;
              break;
            }
          }
          if (!label) {
            const src = (await el.getAttribute('src')) || '';
            if (src) label = `iframe[src=${src.slice(0, 50)}]`;
          }
          if (!label) label = 'iframe';
        }
      } catch (_) {
        label = 'iframe';
      }
      fp.push(label);
    }
    f = f.parentFrame();
  }
  return fp.reverse();
}

async function walkPage(page, browserScript) {
  const result = {
    url: page.url(),
    captured_at: new Date().toISOString(),
    frames: [],
    has_iframe: false,
    has_shadow_dom: false,
    error: null,
    capture_mode: 'in-session',
  };

  try {
    const frames = page.frames();
    for (const frame of frames) {
      const fp = await buildFramePath(frame);
      let data;
      try {
        data = await frame.evaluate(browserScript);
      } catch (e) {
        data = { error: String(e), elements: [] };
      }
      const elements = (data && data.elements) || [];
      for (const el of elements) {
        el.frame_path = fp;
        if (el.shadow_path && el.shadow_path.length) {
          result.has_shadow_dom = true;
        }
      }
      if (fp.length > 1) result.has_iframe = true;
      result.frames.push({
        frame_path: fp,
        url: frame.url(),
        title: (data && data.title) || '',
        elements,
        total_seen: (data && data.total_seen) || elements.length,
      });
    }

    const paths = result.frames
      .map(fr => fr.frame_path)
      .sort((a, b) => (a.length - b.length) || a.join('>').localeCompare(b.join('>')));
    result.frame_tree_summary = paths.map(p => p.join(' > ')).join('\n');
  } catch (e) {
    result.error = `walk failed: ${e.message}`;
  }
  return result;
}

function catalogFilename(testInfo) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTitle = (testInfo.title || 'test').replace(/[^\w.-]/g, '_').slice(0, 60);
  return `dom_catalog_insession_${stamp}_${safeTitle}.json`;
}

exports.test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);

    if (page.isClosed()) {
      console.log('[walker-fixture] page closed before walk — skipping');
      return;
    }

    const browserScript = loadBrowserScript();
    if (!browserScript) {
      console.log('[walker-fixture] browser script missing — skipping');
      return;
    }

    try {
      const catalog = await walkPage(page, browserScript);
      catalog.test_title = testInfo.title;
      catalog.test_status = testInfo.status || 'unknown';
      catalog.test_file = testInfo.file || '';

      const outDir = path.resolve(process.cwd(), 'test-results');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, catalogFilename(testInfo));
      fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');

      const elementCount = catalog.frames.reduce(
        (n, f) => n + (f.elements || []).length, 0
      );
      console.log(
        `[walker-fixture] captured ${elementCount} element(s) across ` +
        `${catalog.frames.length} frame(s) → ${path.relative(process.cwd(), outPath)}`
      );
    } catch (e) {
      console.error('[walker-fixture] walk error:', e.message);
    }
  },
});

exports.expect = base.expect;
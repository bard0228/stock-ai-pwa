import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BUNDLE =
  process.env.PUPPETEER_BUNDLE ||
  '/usr/local/lib/node_modules/chrome-devtools-mcp/build/src/third_party/index.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('No headless Chrome/Chromium binary found in VM.');
}

function startStaticServer(entryFile) {
  const absFile = path.resolve(entryFile);
  if (!fs.existsSync(absFile)) {
    throw new Error(`Target HTML file not found: ${absFile}`);
  }
  const rootDir = path.dirname(absFile);
  const entryName = path.basename(absFile);

  const server = http.createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    const relPath = reqPath === '/' ? entryName : reqPath.replace(/^\/+/, '');
    const safePath = path.resolve(rootDir, relPath);
    if (!safePath.startsWith(rootDir)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
      res.writeHead(404).end('Not Found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(safePath).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}/${encodeURIComponent(entryName)}`,
      });
    });
  });
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runVerification(options = {}) {
  const {
    url: inputUrl,
    file: inputFile,
    width = 412,
    height = 915,
    isMobile = true,
    clicks = [],
    waitMs = 350,
    expectTexts = [],
    expectSelectors = [],
    checkOverflow = true,
    checkTouchTargets = false,
    minTouchPx = 48,
    strictNetwork = false,
    customScript = null,
    timeoutMs = 15000,
  } = options;

  if (!inputUrl && !inputFile) {
    throw new Error('Must provide either "url" or "file" option.');
  }

  let serverHandle = null;
  let browser = null;

  try {
    let targetUrl = inputUrl;
    if (inputFile) {
      serverHandle = await startStaticServer(inputFile);
      targetUrl = serverHandle.url;
    }

    const targetOrigin = new URL(targetUrl).origin;
    const { puppeteer } = await import(DEFAULT_BUNDLE);
    browser = await puppeteer.launch({
      executablePath: findChromeExecutable(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.setViewport({ width, height, isMobile, hasTouch: isMobile });

    const consoleErrors = [];
    const pageErrors = [];
    const networkErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        const locUrl = msg.location()?.url || '';
        if (locUrl.endsWith('/favicon.ico') && txt.includes('404')) return;
        if (
          !strictNetwork &&
          locUrl &&
          !locUrl.startsWith(targetOrigin) &&
          txt.startsWith('Failed to load resource:')
        ) {
          return;
        }
        consoleErrors.push(locUrl ? `${txt} (${locUrl})` : txt);
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err?.message || String(err));
    });
    page.on('response', (res) => {
      const status = res.status();
      if (status < 400) return;
      const reqUrl = res.url();
      const sameOrigin = reqUrl.startsWith(targetOrigin);
      if (sameOrigin && reqUrl.endsWith('/favicon.ico') && status === 404) return;
      if (sameOrigin || strictNetwork) {
        networkErrors.push(`${status} ${reqUrl}`);
      }
    });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await new Promise((r) => setTimeout(r, 250));

    for (const selector of clicks) {
      await page.waitForSelector(selector, { visible: true, timeout: timeoutMs });
      const probe = await page.evaluate(
        ({ sel, minPx }) => {
          const el = document.querySelector(sel);
          if (!el) return { found: false };
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const topEl = document.elementFromPoint(cx, cy);
          const unoccluded = Boolean(topEl && (topEl === el || el.contains(topEl)));
          const topDesc = topEl
            ? `${topEl.tagName.toLowerCase()}${topEl.id ? '#' + topEl.id : ''}${
                typeof topEl.className === 'string' && topEl.className.trim()
                  ? '.' + topEl.className.trim().split(/\s+/).join('.')
                  : ''
              }`
            : 'null';
          return {
            found: true,
            width: Math.round(r.width),
            height: Math.round(r.height),
            meetsTouch: r.width >= minPx && r.height >= minPx,
            unoccluded,
            topDesc,
          };
        },
        { sel: selector, minPx: minTouchPx }
      );

      assert(probe.found, `Click target not found: ${selector}`);
      assert(
        probe.unoccluded,
        `Click intercepted on "${selector}" by top element <${probe.topDesc}> (z-index / glass overlay bug)`
      );
      if (checkTouchTargets) {
        assert(
          probe.meetsTouch,
          `Touch target "${selector}" is ${probe.width}x${probe.height}px (< ${minTouchPx}px)`
        );
      }
      await page.click(selector);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (customScript) {
      const mod = await import(pathToFileURL(path.resolve(customScript)).href);
      const fn = mod.default || mod.run;
      assert(typeof fn === 'function', `Custom script ${customScript} must export a default async function.`);
      await fn({ page, url: targetUrl, assert, browser });
      await new Promise((r) => setTimeout(r, 150));
    }

    for (const sel of expectSelectors) {
      await page.waitForSelector(sel, { visible: true, timeout: timeoutMs });
    }

    if (expectTexts.length > 0) {
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      for (const expected of expectTexts) {
        assert(
          bodyText.includes(expected),
          `Expected text "${expected}" not found in page body.`
        );
      }
    }

    if (checkOverflow) {
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert(
        metrics.scrollWidth <= metrics.clientWidth,
        `Horizontal overflow at ${width}px viewport: scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth}`
      );
    }

    assert(pageErrors.length === 0, `Uncaught pageerror(s): ${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `Console error(s): ${consoleErrors.join(' | ')}`);
    assert(networkErrors.length === 0, `Network error(s): ${networkErrors.join(' | ')}`);

    return {
      ok: true,
      viewport: `${width}x${height}`,
      clicks: clicks.length,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverHandle?.server) {
      await new Promise((r) => serverHandle.server.close(r));
    }
  }
}

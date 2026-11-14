import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runVerification } from './verify-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexFile = path.join(repoRoot, 'index.html');
const screenshotPath = process.env.VERIFY_SCREENSHOT_PATH || '';

export default async function verifyLiquidGlass({ page, url, assert, browser }) {
  const origin = new URL(url).origin;
  try {
    await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write']);
  } catch (_) {}

  await page.waitForFunction(
    () => document.querySelectorAll('#overviewCardsContainer article').length >= 10,
    { timeout: 10000 }
  );

  const overflowInitial = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  assert(overflowInitial.sw <= overflowInitial.cw, `Initial horizontal overflow: ${overflowInitial.sw} > ${overflowInitial.cw}`);

  // 1. Typography, smoothing, tabular-nums, letter-spacing & Liquid Glass surfaces
  const typoCheck = await page.evaluate(() => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
    const hasFonts = links.some((h) => h.includes('Plus+Jakarta+Sans') && h.includes('Noto+Sans+TC'));
    const bodyCs = getComputedStyle(document.body);
    const kpiEl = document.getElementById('kpiTotalCount');
    const kpiCs = kpiEl ? getComputedStyle(kpiEl) : null;
    const header = document.querySelector('header');
    const headerCs = header ? getComputedStyle(header) : null;
    const mainSection = document.querySelector('#mainPanel') || document.querySelectorAll('section')[1];
    const mainSectionCs = mainSection ? getComputedStyle(mainSection) : null;
    const article = document.querySelector('#overviewCardsContainer article');
    const articleCs = article ? getComputedStyle(article) : null;
    const logoBox = document.querySelector('header img')?.parentElement;
    const logoCs = logoBox ? getComputedStyle(logoBox) : null;
    const syncBtn = document.getElementById('btnSyncNow');
    const syncCs = syncBtn ? getComputedStyle(syncBtn) : null;

    const ruleTexts = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          ruleTexts.push(rule.cssText);
        }
      } catch (_) {}
    }
    const allCss = ruleTexts.join('\n');

    return {
      hasFonts,
      bodyFont: bodyCs.fontFamily,
      bodyLetterSpacing: parseFloat(bodyCs.letterSpacing || '0'),
      overscrollY: bodyCs.overscrollBehaviorY,
      kpiVariant: kpiCs ? kpiCs.fontVariantNumeric : '',
      headerBackdrop: headerCs ? (headerCs.backdropFilter || headerCs.webkitBackdropFilter) : '',
      headerRadius: headerCs ? parseFloat(headerCs.borderRadius || '0') : 0,
      mainRadius: mainSectionCs ? parseFloat(mainSectionCs.borderRadius || '0') : 0,
      articleBackdrop: articleCs ? (articleCs.backdropFilter || articleCs.webkitBackdropFilter) : '',
      articleRadius: articleCs ? parseFloat(articleCs.borderRadius || '0') : 0,
      logoRadius: logoCs ? parseFloat(logoCs.borderRadius || '0') : 0,
      ctrlRadius: syncCs ? parseFloat(syncCs.borderRadius || '0') : 0,
      hasActiveScale096: allCss.includes('scale(0.96)') && (allCss.includes('0.08s') || allCss.includes('80ms')),
      hasHoverFloat: allCss.includes('translateY(-2px)'),
      hasAccordion42: allCss.includes('0.42s') && allCss.includes('grid-template-rows'),
      hasBounceIn: allCss.includes('cubic-bezier(0.34, 1.56, 0.64, 1)'),
      hasShrinkOut: allCss.includes('cubic-bezier(0.4, 0, 1, 1)'),
      hasAppShell: Boolean(document.getElementById('app-shell')),
    };
  });

  assert(typoCheck.hasFonts, 'Missing Google Fonts Plus Jakarta Sans + Noto Sans TC link.');
  assert(typoCheck.bodyFont.includes('Plus Jakarta Sans') && typoCheck.bodyFont.includes('Noto Sans TC'), `Invalid body font-family: ${typoCheck.bodyFont}`);
  assert(typoCheck.bodyLetterSpacing < 0, `Expected negative letter-spacing (-0.005em), got ${typoCheck.bodyLetterSpacing}`);
  assert(typoCheck.kpiVariant.includes('tabular-nums'), `Missing tabular-nums on numeric KPI: ${typoCheck.kpiVariant}`);
  assert(typoCheck.overscrollY === 'contain', `Expected overscroll-behavior-y: contain on body, got ${typoCheck.overscrollY}`);
  assert(typoCheck.headerBackdrop.includes('blur('), `Header missing backdrop-filter blur: ${typoCheck.headerBackdrop}`);
  assert(typoCheck.headerRadius >= 24 && typoCheck.headerRadius <= 28, `Header border-radius must be 24-28px, got ${typoCheck.headerRadius}`);
  assert(typoCheck.mainRadius >= 24 && typoCheck.mainRadius <= 28, `Main panel border-radius must be 24-28px, got ${typoCheck.mainRadius}`);
  assert(typoCheck.articleRadius >= 16 && typoCheck.articleRadius <= 24, `Card article border-radius must be >= 16px, got ${typoCheck.articleRadius}`);
  assert(typoCheck.logoRadius >= 10 && typoCheck.logoRadius <= 14, `Icon frame radius must be 10-14px, got ${typoCheck.logoRadius}`);
  assert(typoCheck.ctrlRadius >= 12, `Control border-radius must be >= 12px (or pill), got ${typoCheck.ctrlRadius}`);
  assert(typoCheck.hasActiveScale096, 'Missing .lg-btn:active 0.08s scale(0.96) CSS rule.');
  assert(typoCheck.hasHoverFloat, 'Missing :hover translateY(-2px) CSS rule.');
  assert(typoCheck.hasAccordion42, 'Missing 0.42s CSS Grid accordion transition rule.');
  assert(typoCheck.hasBounceIn, 'Missing cubic-bezier(0.34, 1.56, 0.64, 1) entrance animation.');
  assert(typoCheck.hasShrinkOut, 'Missing cubic-bezier(0.4, 0, 1, 1) exit animation.');
  assert(typoCheck.hasAppShell, 'Missing #app-shell wrapper for Android 12 edge stretch isolation.');

  // 2. Zero-Noise UI & Monochrome Stroke SVG Checks
  const checkZeroNoise = async (contextLabel) => {
    const res = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const emojiMatches = text.match(/[\p{Extended_Pictographic}↗✕⚡]/gu) || [];
      const bannedPhrases = [
        '可回對話框輸入分析',
        '含 ETF・已過濾低流動性標的',
        '美股已收盤',
        '點擊僅顯示',
        '點擊篩選',
        '點擊同步',
      ].filter((p) => {
        if (text.includes(p)) return true;
        return [...document.querySelectorAll('[title]')].some((el) => (el.getAttribute('title') || '').includes(p));
      });
      const badSvgs = [...document.querySelectorAll('svg')]
        .filter((s) => s.getAttribute('fill') !== 'none' || s.getAttribute('stroke-width') !== '2')
        .map((s) => s.outerHTML.slice(0, 80));
      return { emojiMatches, bannedPhrases, badSvgs };
    });
    assert(res.emojiMatches.length === 0, `[${contextLabel}] Disallowed emoji/symbol characters in UI: ${JSON.stringify(res.emojiMatches)}`);
    assert(res.bannedPhrases.length === 0, `[${contextLabel}] Disallowed instructional/helper/subtitle text: ${JSON.stringify(res.bannedPhrases)}`);
    assert(res.badSvgs.length === 0, `[${contextLabel}] Non-conforming SVGs (must use fill="none" stroke-width="2"): ${JSON.stringify(res.badSvgs)}`);
  };
  await checkZeroNoise('initial-results');

  // 3. Touch Target Checks (>= 48x48px on mobile controls)
  const touchCheck = await page.evaluate(() => {
    const selectors = [
      '#btnSyncNow',
      '#tabBtnResults',
      '#tabBtnLeaderboard',
      '#filterMarketAnchor .filter-trigger',
      '#filterRatingAnchor .filter-trigger',
      '#filterSortAnchor .filter-trigger',
    ];
    const small = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) {
        small.push(`${sel}: missing`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.height < 48 || r.width < 48) {
        small.push(`${sel}: ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return small;
  });
  assert(touchCheck.length === 0, `Controls below 48px touch target: ${touchCheck.join(', ')}`);

  // 4. Portal Dropdowns + Dual-Layer Ice Crystal + Accordion 0.42s + Filtering
  const dropdownTests = [
    { trigger: '#filterMarketAnchor .filter-trigger', menuAttr: 'market', optionSel: '[data-filter-market="TW"]', labelSel: '#filterMarketLabel', expectedLabel: '台股 (TW)', resetSel: '[data-filter-market="ALL"]' },
    { trigger: '#filterRatingAnchor .filter-trigger', menuAttr: 'rating', optionSel: '[data-filter-rating="BUY"]', labelSel: '#filterRatingLabel', expectedLabel: '買進 / 偏多', resetSel: '[data-filter-rating="ALL"]' },
    { trigger: '#filterSortAnchor .filter-trigger', menuAttr: 'sort', optionSel: '[data-filter-sort="KRONOS"]', labelSel: '#filterSortLabel', expectedLabel: 'Kronos 預測漲幅', resetSel: '[data-filter-sort="DATE"]' },
  ];

  for (const dd of dropdownTests) {
    await page.click(dd.trigger);
    await new Promise((r) => setTimeout(r, 480));

    const portalProbe = await page.evaluate((attr) => {
      const menu = document.querySelector(`[data-portal-menu="${attr}"]`);
      if (!menu) return { exists: false };
      const parentIsBody = menu.parentElement === document.body;
      const frame = menu.classList.contains('lg-ice-frame') ? menu : menu.querySelector('.lg-ice-frame');
      const inner = frame ? frame.querySelector('.lg-inner-glass') : null;
      const acc = menu.querySelector('.lg-accordion');
      const frameCs = frame ? getComputedStyle(frame) : null;
      const accCs = acc ? getComputedStyle(acc) : null;
      const r = menu.getBoundingClientRect();
      return {
        exists: true,
        parentIsBody,
        visible: r.width > 0 && r.height > 0 && getComputedStyle(menu).display !== 'none',
        inViewport: r.left >= 0 && r.right <= 412,
        hasDualLayer: Boolean(frame && inner),
        framePadding: frameCs ? parseFloat(frameCs.paddingLeft || '0') : 0,
        frameBackdrop: frameCs ? (frameCs.backdropFilter || frameCs.webkitBackdropFilter) : '',
        accOpen: acc ? acc.classList.contains('is-open') : false,
        accTransition: accCs ? accCs.transitionDuration : '',
      };
    }, dd.menuAttr);

    assert(portalProbe.exists, `Portal dropdown [data-portal-menu="${dd.menuAttr}"] not found.`);
    assert(portalProbe.parentIsBody, `Portal dropdown "${dd.menuAttr}" must mount directly under document.body.`);
    assert(portalProbe.visible, `Portal dropdown "${dd.menuAttr}" is not visible after click.`);
    assert(portalProbe.inViewport, `Portal dropdown "${dd.menuAttr}" overflows 412px mobile viewport.`);
    assert(portalProbe.hasDualLayer, `Portal dropdown "${dd.menuAttr}" missing .lg-ice-frame > .lg-inner-glass dual layer.`);
    assert(portalProbe.framePadding >= 6, `Portal dropdown "${dd.menuAttr}" outer frame padding too small: ${portalProbe.framePadding}`);
    assert(portalProbe.frameBackdrop.includes('blur('), `Portal dropdown "${dd.menuAttr}" missing backdrop-filter blur.`);
    assert(portalProbe.accOpen && portalProbe.accTransition.includes('0.42s'), `Portal dropdown "${dd.menuAttr}" missing 0.42s accordion transition: ${portalProbe.accTransition}`);

    const optionVisible = await page.waitForSelector(`${dd.optionSel}`, { visible: true, timeout: 3000 });
    assert(Boolean(optionVisible), `Option ${dd.optionSel} not visible in portal.`);
    await page.click(dd.optionSel);
    await new Promise((r) => setTimeout(r, 320));

    const labelText = await page.$eval(dd.labelSel, (el) => el.textContent.trim());
    assert(labelText === dd.expectedLabel, `Expected label "${dd.expectedLabel}", got "${labelText}"`);

    await page.click(dd.trigger);
    await new Promise((r) => setTimeout(r, 480));
    await page.click(dd.resetSel);
    await new Promise((r) => setTimeout(r, 320));
  }

  // 5. KPI Filters & Latest Analysis Data Contract
  const recordsProbe = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      has3711: text.includes('3711') && text.includes('日月光投控'),
      has3231: text.includes('3231') && text.includes('緯創'),
      has3413: text.includes('3413') && text.includes('京鼎'),
      has2330: text.includes('2330') && text.includes('台積電'),
    };
  });
  assert(recordsProbe.has3711 && recordsProbe.has3231 && recordsProbe.has3413 && recordsProbe.has2330, `Missing expected overview.json records: ${JSON.stringify(recordsProbe)}`);

  await page.click('#kpiCardTotal');
  await new Promise((r) => setTimeout(r, 200));
  await page.click('#kpiCardTotal');
  await new Promise((r) => setTimeout(r, 200));

  // 6. Card Expand -> PDF links + Kronos Chart Modal (Portal + Dual-Layer) -> Collapse
  const firstToggleSel = '#overviewCardsContainer article:first-child .card-header-toggle';
  await page.click(firstToggleSel);
  await new Promise((r) => setTimeout(r, 480));

  const cardExpandedProbe = await page.evaluate(() => {
    const article = document.querySelector('#overviewCardsContainer article:first-child');
    const drawer = article.querySelector('.accordion-shell');
    const drawerCs = getComputedStyle(drawer);
    const pdfLinks = [...article.querySelectorAll('a[href*="drive.google.com"]')].map((a) => ({
      text: a.innerText.trim(),
      href: a.href,
      target: a.target,
    }));
    const kronosTrigger = article.querySelector('.kronos-preview-trigger');
    return {
      isOpen: drawer.classList.contains('is-open'),
      transition: drawerCs.transitionDuration,
      pdfCount: pdfLinks.length,
      hasKronosTrigger: Boolean(kronosTrigger),
    };
  });
  assert(cardExpandedProbe.isOpen, 'First stock card failed to expand.');
  assert(cardExpandedProbe.transition.includes('0.42s'), `Card accordion must use 0.42s transition, got ${cardExpandedProbe.transition}`);
  assert(cardExpandedProbe.pdfCount >= 2, `Expected at least 2 Google Drive links, got ${cardExpandedProbe.pdfCount}`);
  assert(cardExpandedProbe.hasKronosTrigger, 'Missing .kronos-preview-trigger button on expanded card.');

  await checkZeroNoise('expanded-card');

  await page.click('#overviewCardsContainer article:first-child .kronos-preview-trigger');
  await new Promise((r) => setTimeout(r, 400));

  const modalProbe = await page.evaluate(() => {
    const modal = document.getElementById('kronosModal');
    if (!modal) return { exists: false };
    const parentIsBody = modal.parentElement === document.body;
    const isOpen = modal.hasAttribute('open') || getComputedStyle(modal).display !== 'none';
    const frame = modal.querySelector('.lg-ice-frame');
    const inner = frame ? frame.querySelector('.lg-inner-glass') : null;
    const r = frame ? frame.getBoundingClientRect() : { width: 0, height: 0, left: -1, right: 999 };
    return {
      exists: true,
      parentIsBody,
      isOpen,
      hasDualLayer: Boolean(frame && inner),
      inViewport: r.width > 0 && r.left >= 0 && r.right <= 412,
    };
  });
  assert(modalProbe.exists && modalProbe.isOpen, 'Kronos preview modal failed to open.');
  assert(modalProbe.parentIsBody, 'Modal must mount directly under document.body.');
  assert(modalProbe.hasDualLayer, 'Modal missing .lg-ice-frame > .lg-inner-glass dual layer.');
  assert(modalProbe.inViewport, 'Modal overflows 412px mobile viewport.');

  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath.replace(/\.png$/, '_modal.png') });
  }

  await page.click('#btnCloseKronosModal');
  await new Promise((r) => setTimeout(r, 300));

  await page.click('#overviewCardsContainer article:first-child .card-collapse-btn');
  await new Promise((r) => setTimeout(r, 480));

  // 7. Leaderboard Tab, Market Switch, Copy Ticker Toast (Portal + Dual-Layer), & Zero-Noise Check
  await page.click('#tabBtnLeaderboard');
  await page.waitForFunction(() => document.querySelectorAll('#leaderboardContainer article').length >= 10, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 300));

  await checkZeroNoise('leaderboard-tw');

  await page.click('#lbMarketBtnUS');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#lbMarketBtnTW');
  await new Promise((r) => setTimeout(r, 300));

  if (await page.$('#leaderboardContainer .lb-copy-btn')) {
    await page.click('#leaderboardContainer .lb-copy-btn');
    await new Promise((r) => setTimeout(r, 250));

    const toastProbe = await page.evaluate(() => {
      const toast = document.getElementById('toastNotification');
      if (!toast) return { exists: false };
      const parentIsBody = toast.parentElement === document.body;
      const frame = toast.classList.contains('lg-ice-frame') ? toast : toast.querySelector('.lg-ice-frame');
      const inner = frame ? frame.querySelector('.lg-inner-glass') : null;
      const visible = !toast.classList.contains('hidden') && getComputedStyle(toast).display !== 'none';
      const r = toast.getBoundingClientRect();
      return {
        exists: true,
        parentIsBody,
        visible,
        hasDualLayer: Boolean(frame && inner),
        text: toast.innerText.trim(),
        inViewport: r.width > 0 && r.left >= 0 && r.right <= 412,
      };
    });
    assert(toastProbe.exists && toastProbe.visible, 'Toast notification did not appear.');
    assert(toastProbe.parentIsBody, 'Toast must mount directly under document.body.');
    assert(toastProbe.hasDualLayer, 'Toast missing .lg-ice-frame > .lg-inner-glass dual layer.');
    assert(!toastProbe.text.includes('可回對話框輸入分析'), `Toast still contains helper text: ${toastProbe.text}`);
    assert(toastProbe.inViewport, 'Toast overflows 412px viewport.');
  }

  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath.replace(/\.png$/, '_leaderboard.png') });
  }

  await page.click('#tabBtnResults');
  await new Promise((r) => setTimeout(r, 300));

  // 8. Android 12 Edge Overscroll Physical Stretch Verification
  const overscrollProbe = await page.evaluate(async () => {
    const shell = document.getElementById('app-shell');
    if (!shell) return { ok: false, reason: 'no #app-shell' };

    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 50));

    const makeTouch = (y) =>
      new Touch({
        identifier: 1,
        target: shell,
        clientX: 206,
        clientY: y,
        pageX: 206,
        pageY: y,
      });

    window.dispatchEvent(new TouchEvent('touchstart', { touches: [makeTouch(200)], bubbles: true }));
    window.dispatchEvent(new TouchEvent('touchmove', { touches: [makeTouch(360)], bubbles: true }));
    const topTransform = shell.style.transform;
    const topOrigin = shell.style.transformOrigin;
    window.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));
    const afterRelease = shell.style.transform;

    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: maxScroll, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 50));
    window.dispatchEvent(new TouchEvent('touchstart', { touches: [makeTouch(600)], bubbles: true }));
    window.dispatchEvent(new TouchEvent('touchmove', { touches: [makeTouch(420)], bubbles: true }));
    const bottomTransform = shell.style.transform;
    const bottomOrigin = shell.style.transformOrigin;
    window.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));

    window.scrollTo({ top: 0, behavior: 'instant' });
    return {
      ok: true,
      topTransform,
      topOrigin,
      afterRelease,
      bottomTransform,
      bottomOrigin,
    };
  });

  assert(overscrollProbe.ok, `Android overscroll probe error: ${overscrollProbe.reason}`);
  assert(
    overscrollProbe.topTransform.startsWith('scaleY(') && parseFloat(overscrollProbe.topTransform.slice(7)) > 1.005,
    `Top edge overscroll failed: transform="${overscrollProbe.topTransform}"`
  );
  assert(overscrollProbe.topOrigin.includes('top'), `Expected top transform-origin, got "${overscrollProbe.topOrigin}"`);
  assert(
    overscrollProbe.bottomTransform.startsWith('scaleY(') && parseFloat(overscrollProbe.bottomTransform.slice(7)) > 1.005,
    `Bottom edge overscroll failed: transform="${overscrollProbe.bottomTransform}"`
  );
  assert(overscrollProbe.bottomOrigin.includes('bottom'), `Expected bottom transform-origin, got "${overscrollProbe.bottomOrigin}"`);

  // 9. Preserve backend contract checks
  const htmlRaw = fs.readFileSync(indexFile, 'utf8');
  assert(htmlRaw.includes('./overview.json'), 'Missing ./overview.json fetch contract.');
  assert(htmlRaw.includes('./api/overview'), 'Missing ./api/overview fetch fallback contract.');
  assert(htmlRaw.includes('./leaderboard.json'), 'Missing ./leaderboard.json fetch contract.');

  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVerification({
    file: indexFile,
    width: 412,
    height: 915,
    isMobile: true,
    customScript: fileURLToPath(import.meta.url),
  })
    .then((res) => {
      console.log(`PASS verify_liquid_glass (${res.viewport}, consoleErrors=0, overflow=0)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`FAIL verify_liquid_glass: ${err.message}`);
      process.exit(1);
    });
}

'use strict';

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browser');
const { runAxe } = require('./axe_runner');
const { runKeyboardFocusPass } = require('./keyboard_focus_pass');
const { runTargetSizeCheck } = require('./wcag22_target_size');
const { runDraggingCheck } = require('./wcag22_dragging');
const { runFormTest } = require('./form_test');
const { runSupplementalRuntimeChecks } = require('./supplemental_runtime_checks');

async function scrollToTop(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const scrollRoots = [window, document.documentElement, document.body];
    for (const root of scrollRoots) {
      if (!root) continue;
      try {
        if (typeof root.scrollTo === 'function') {
          root.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        }
      } catch (_) {
        try {
          root.scrollTo(0, 0);
        } catch (_) {
          /* ignore */
        }
      }
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      if (y <= 1) break;
      await sleep(50);
    }
    await sleep(150);
  });
}

async function lazyLoadPageContent(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch (_) {
    // ignore — many SPAs never go fully idle
  }
  try {
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const maxPasses = 24;
      for (let pass = 0; pass < maxPasses; pass += 1) {
        const { scrollHeight, clientHeight } = document.documentElement;
        const y = window.scrollY + clientHeight * 0.92;
        if (y >= scrollHeight - 4) break;
        window.scrollTo(0, y);
        await sleep(100);
      }
    });
  } catch (_) {
    // ignore — e.g. cross-origin frames
  }
  await scrollToTop(page);
}

async function settlePageForScan(page) {
  await lazyLoadPageContent(page);
}

function injectBaseHref(html, baseHref) {
  if (!html || html.includes('<base')) return html;
  const baseTag = `<base href="${baseHref}">`;
  if (html.includes('<head')) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n  ${baseTag}`);
  }
  return `${baseTag}\n${html}`;
}

async function configureRemoteScanPage(page, timeoutMs) {
  page.setDefaultNavigationTimeout(timeoutMs);
  page.setDefaultTimeout(timeoutMs);
}

async function navigateForScan(page, url, timeoutMs) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'commit', timeout: timeoutMs });
  } catch (err) {
    throw err;
  }

  try {
    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(45000, timeoutMs) });
  } catch (_) {
    const hasContent = await page.evaluate(() => Boolean(document.body && document.body.innerText.trim().length > 0));
    if (!hasContent) {
      throw new Error(`Page did not render content within ${timeoutMs}ms`);
    }
  }

  return response;
}

async function scanPage({ url, htmlFile, artifactsDir, outputDir, options }) {
  const partialFailures = [];
  const { browser, page } = await launchBrowser(options);

  const consoleEntries = [];
  page.on('console', (msg) => {
    const entry = {
      type: msg.type(),
      text: msg.text(),
      location: msg.location()
    };
    if (['warning', 'error'].includes(entry.type)) {
      consoleEntries.push(entry);
    }
  });
  page.on('pageerror', (err) => {
    consoleEntries.push({ type: 'pageerror', text: err.message || String(err) });
  });

  let response;
  try {
    if (htmlFile) {
      const html = fs.readFileSync(htmlFile, 'utf8');
      const baseHref = `file://${path.dirname(htmlFile).replace(/\\/g, '/')}/`;
      const htmlWithBase = injectBaseHref(html, baseHref);
      await page.setContent(htmlWithBase, { waitUntil: 'domcontentloaded' });
    } else {
      await configureRemoteScanPage(page, options.timeoutMs);
      response = await navigateForScan(page, url, options.timeoutMs);
    }
  } catch (err) {
    await browser.close();
    throw err;
  }

  await page.waitForTimeout(options.settleMs);
  await scrollToTop(page);

  const finalUrl = htmlFile ? `file://${htmlFile}` : page.url();
  const title = await page.title();
  const status = response ? response.status() : null;

  const screenshotPath = path.join(artifactsDir, 'screenshot-full.png');
  const viewportScreenshotPath = path.join(artifactsDir, 'screenshot-viewport.jpg');
  const htmlPath = path.join(artifactsDir, 'html-snapshot.html');
  const consolePath = path.join(artifactsDir, 'console.log');
  const toRel = (p) => path.relative(outputDir, p);
  let viewportScreenshot = null;

  try {
    await page.screenshot({ path: viewportScreenshotPath, fullPage: false, type: 'jpeg', quality: 55 });
    viewportScreenshot = toRel(viewportScreenshotPath);
  } catch (err) {
    partialFailures.push('viewport-screenshot');
  }

  await settlePageForScan(page);

  let fullPageScreenshot = null;
  if (options.fullPageScreenshot) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    fullPageScreenshot = toRel(screenshotPath);
  }
  const html = await page.content();
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(consolePath, consoleEntries.map((e) => JSON.stringify(e)).join('\n'), 'utf8');

  const findings = [];

  let axeResult;
  try {
    axeResult = await runAxe(page, artifactsDir, outputDir);
    findings.push(...axeResult.findings);
  } catch (err) {
    partialFailures.push('axe');
  }

  try {
    const keyboardResult = await runKeyboardFocusPass(page, artifactsDir, outputDir, options.keyboardTabSteps);
    findings.push(...keyboardResult.findings);
  } catch (err) {
    partialFailures.push('keyboard');
  }

  try {
    const targetSizeFindings = await runTargetSizeCheck(page, artifactsDir, outputDir);
    findings.push(...targetSizeFindings);
  } catch (err) {
    partialFailures.push('target-size');
  }

  try {
    const draggingFindings = await runDraggingCheck(page, artifactsDir);
    findings.push(...draggingFindings);
  } catch (err) {
    partialFailures.push('dragging');
  }

  try {
    const supplementalFindings = await runSupplementalRuntimeChecks(page);
    findings.push(...supplementalFindings);
  } catch (err) {
    partialFailures.push('supplemental-runtime');
  }

  if (options.formTest) {
    try {
      const formFindings = await runFormTest(page, artifactsDir);
      findings.push(...formFindings);
    } catch (err) {
      partialFailures.push('form-test');
    }
  }

  await browser.close();

  return {
    page: {
      url: url || `file://${htmlFile}`,
      finalUrl,
      status,
      title,
      artifacts: {
        screenshot: fullPageScreenshot || viewportScreenshot,
        viewportScreenshot,
        html: toRel(htmlPath),
        consoleLog: toRel(consolePath),
        axeRaw: axeResult ? toRel(axeResult.rawPath) : null,
        ariaSnapshot: null
      }
    },
    findings,
    partialFailures
  };
}

module.exports = { scanPage };

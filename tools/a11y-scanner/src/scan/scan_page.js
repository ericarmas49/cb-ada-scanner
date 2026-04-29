'use strict';

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browser');
const { runAxe } = require('./axe_runner');
const { runKeyboardFocusPass } = require('./keyboard_focus_pass');
const { runTargetSizeCheck } = require('./wcag22_target_size');
const { runDraggingCheck } = require('./wcag22_dragging');
const { runFormTest } = require('./form_test');

function injectBaseHref(html, baseHref) {
  if (!html || html.includes('<base')) return html;
  const baseTag = `<base href="${baseHref}">`;
  if (html.includes('<head')) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n  ${baseTag}`);
  }
  return `${baseTag}\n${html}`;
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
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    }
  } catch (err) {
    await browser.close();
    throw err;
  }

  await page.waitForTimeout(options.settleMs);
  try {
    await page.waitForLoadState('networkidle', { timeout: 2000 });
  } catch (_) {
    // ignore
  }

  const finalUrl = htmlFile ? `file://${htmlFile}` : page.url();
  const title = await page.title();
  const status = response ? response.status() : null;

  const screenshotPath = path.join(artifactsDir, 'screenshot-full.png');
  const htmlPath = path.join(artifactsDir, 'html-snapshot.html');
  const consolePath = path.join(artifactsDir, 'console.log');
  const toRel = (p) => path.relative(outputDir, p);

  await page.screenshot({ path: screenshotPath, fullPage: true });
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
        screenshot: toRel(screenshotPath),
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

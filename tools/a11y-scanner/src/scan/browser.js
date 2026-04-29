'use strict';

const { chromium } = require('playwright');

async function launchBrowser(options) {
  const browser = await chromium.launch({ headless: !options.headed });
  const context = await browser.newContext({
    viewport: options.viewport,
    userAgent: options.userAgent || undefined
  });
  const page = await context.newPage();
  return { browser, context, page };
}

module.exports = { launchBrowser };

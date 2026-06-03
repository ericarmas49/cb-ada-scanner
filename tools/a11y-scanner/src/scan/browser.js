'use strict';

const { chromium } = require('playwright');
const serverlessChromium = require('@sparticuz/chromium');

async function launchBrowser(options) {
  const isVercel = Boolean(process.env.VERCEL);
  const launchOptions = {
    headless: isVercel ? true : !options.headed
  };

  if (isVercel) {
    launchOptions.args = serverlessChromium.args;
    launchOptions.executablePath = await serverlessChromium.executablePath();
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: options.viewport,
    userAgent: options.userAgent || undefined
  });
  const page = await context.newPage();
  return { browser, context, page };
}

module.exports = { launchBrowser };

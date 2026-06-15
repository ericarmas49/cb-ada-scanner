'use strict';

const { chromium } = require('playwright');
const serverlessChromium = require('@sparticuz/chromium');

async function launchBrowser(options) {
  const isVercel = Boolean(process.env.VERCEL);
  const isServerHost = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.LOW_MEMORY_MODE === 'true');
  const launchOptions = {
    headless: isVercel ? true : !options.headed,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking'
    ]
  };

  if (isVercel) {
    launchOptions.args = [...serverlessChromium.args, ...launchOptions.args];
    launchOptions.executablePath = await serverlessChromium.executablePath();
  } else if (isServerHost) {
    launchOptions.args.push('--no-sandbox');
  }

  const browser = await chromium.launch(launchOptions);
  const defaultUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const context = await browser.newContext({
    viewport: options.viewport,
    userAgent: options.userAgent || (isServerHost || isVercel ? defaultUserAgent : undefined)
  });
  const page = await context.newPage();
  return { browser, context, page };
}

module.exports = { launchBrowser };

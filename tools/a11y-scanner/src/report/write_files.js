'use strict';

const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { buildReportHtml } = require('./build_report_html');

async function writePdfFromHtml(htmlPath, pdfPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfPath,
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in'
      }
    });
  } finally {
    await browser.close();
  }
}

async function writeReportFiles(report, paths, outputDir) {
  fs.writeFileSync(paths.jsonPath, JSON.stringify(report, null, 2), 'utf8');
  try {
    const html = buildReportHtml(report);
    fs.writeFileSync(paths.htmlPath, html, 'utf8');
    if (paths.pdfPath) {
      try {
        await writePdfFromHtml(paths.htmlPath, paths.pdfPath);
        return { htmlSuccess: true, pdfSuccess: true };
      } catch (_pdfError) {
        return { htmlSuccess: true, pdfSuccess: false };
      }
    }
    return { htmlSuccess: true, pdfSuccess: false };
  } catch (_error) {
    return { htmlSuccess: false, pdfSuccess: false };
  }
}

module.exports = { writeReportFiles };

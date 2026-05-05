'use strict';

const fs = require('fs');
const { buildReportHtml } = require('./build_report_html');

async function writeReportFiles(report, paths, outputDir) {
  fs.writeFileSync(paths.jsonPath, JSON.stringify(report, null, 2), 'utf8');
  try {
    const html = buildReportHtml(report);
    fs.writeFileSync(paths.htmlPath, html, 'utf8');
    return { htmlSuccess: true };
  } catch (_error) {
    return { htmlSuccess: false };
  }
}

module.exports = { writeReportFiles };

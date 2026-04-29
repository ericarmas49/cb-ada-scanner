'use strict';

const fs = require('fs');
const path = require('path');
const { AxeBuilder } = require('@axe-core/playwright');
const { normalizeAxeFindings } = require('../report/normalize_findings');

async function runAxe(page, artifactsDir, outputDir) {
  const results = await new AxeBuilder({ page }).analyze();
  const rawPath = path.join(artifactsDir, 'axe-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(results, null, 2), 'utf8');
  const findings = normalizeAxeFindings(results);
  return { rawPath, findings };
}

module.exports = { runAxe };

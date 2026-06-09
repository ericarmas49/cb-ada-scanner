'use strict';

const fs = require('fs');
const path = require('path');
const { scanPage } = require('./scan/scan_page');
const { dedupeFindings } = require('./report/dedupe');
const { enrichFindings } = require('./report/enrich_findings');
const { scoreReport } = require('./report/scoring');
const { writeReportFiles } = require('./report/write_files');
const { info, warn, error } = require('./utils/logger');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function parseViewport(viewportStr) {
  if (!viewportStr) return { width: 1280, height: 720 };
  const match = String(viewportStr).toLowerCase().split('x');
  if (match.length !== 2) return { width: 1280, height: 720 };
  const width = parseInt(match[0], 10);
  const height = parseInt(match[1], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: 1280, height: 720 };
  }
  return { width, height };
}

function parseBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  return String(value).toLowerCase() !== 'false';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestampFolder() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function upgradeToHttpsIfReachable(inputUrl) {
  try {
    const urlObj = new URL(inputUrl);
    if (urlObj.protocol === 'https:') return inputUrl;
    if (urlObj.protocol !== 'http:') return inputUrl;
    const httpsUrl = new URL(inputUrl);
    httpsUrl.protocol = 'https:';

    const https = require('https');
    await new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: 'HEAD',
          host: httpsUrl.hostname,
          path: httpsUrl.pathname + httpsUrl.search,
          timeout: 3000
        },
        (res) => {
          if (res.statusCode && res.statusCode < 400) resolve();
          else reject(new Error(`HTTPS status ${res.statusCode}`));
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('HTTPS timeout'));
      });
      req.end();
    });
    return httpsUrl.toString();
  } catch (err) {
    return inputUrl;
  }
}

function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const urlObj = new URL(url);
    urlObj.hash = '';
    return urlObj.toString();
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const urlArg = args.url || args.u;
  const htmlFileArg = args.htmlFile || null;
  if (!urlArg && !htmlFileArg) {
    error('Missing --url or --htmlFile');
    process.exitCode = 1;
    return;
  }

  let normalizedUrl = urlArg ? normalizeUrl(urlArg) : null;
  if (urlArg && !normalizedUrl) {
    error('Invalid or empty URL');
    process.exitCode = 1;
    return;
  }
  if (normalizedUrl) {
    normalizedUrl = await upgradeToHttpsIfReachable(normalizedUrl);
  }

  const options = {
    url: normalizedUrl,
    htmlFile: htmlFileArg ? path.resolve(htmlFileArg) : null,
    timeoutMs: Number(args.timeoutMs || 30000),
    headed: Boolean(args.headed || false),
    outputDir: args.output || path.join('output', timestampFolder()),
    formTest: parseBoolean(args.formTest, true),
    fullPageScreenshot: parseBoolean(args.fullPageScreenshot, true),
    pdf: parseBoolean(args.pdf, true),
    keyboardTabSteps: Number(args.keyboardTabSteps || 25),
    settleMs: Number(args.settleMs || 2500),
    viewport: parseViewport(args.viewport || '1280x720'),
    userAgent: args.userAgent || null
  };

  ensureDir(options.outputDir);
  const artifactsDir = path.join(options.outputDir, 'artifacts');
  ensureDir(artifactsDir);

  const startedAt = new Date().toISOString();

  let scanResult;
  try {
    info(`Scanning ${options.url || options.htmlFile}`);
    scanResult = await scanPage({
      url: options.url,
      htmlFile: options.htmlFile,
      artifactsDir,
      outputDir: options.outputDir,
      options
    });
  } catch (err) {
    error('Fatal: could not load page', err.message || err);
    process.exitCode = 1;
    return;
  }

  const deduped = dedupeFindings(scanResult.findings);
  const enrichedFindings = enrichFindings(deduped, {
    pageUrl: scanResult.page.finalUrl
  });
  const summary = scoreReport(enrichedFindings);

  const report = {
    scan: {
      version: '0.1.0',
      startedAt,
      finishedAt: new Date().toISOString(),
      inputUrl: options.url || `file://${options.htmlFile}`,
      finalUrl: scanResult.page.finalUrl,
      options: {
        timeoutMs: options.timeoutMs,
        headed: options.headed,
        formTest: options.formTest,
        keyboardTabSteps: options.keyboardTabSteps,
        settleMs: options.settleMs,
        viewport: options.viewport,
        userAgent: options.userAgent
      }
    },
    page: scanResult.page,
    findings: enrichedFindings,
    summary
  };

  const reportPaths = {
    jsonPath: path.join(options.outputDir, 'report.json'),
    htmlPath: path.join(options.outputDir, 'report.html'),
    pdfPath: options.pdf ? path.join(options.outputDir, 'report.pdf') : null
  };

  const writeResult = await writeReportFiles(report, reportPaths, options.outputDir);
  if (!writeResult.htmlSuccess) {
    warn('Report HTML generation failed. JSON report created.');
    process.exitCode = 2;
  } else if (!writeResult.pdfSuccess) {
    warn('Report PDF generation failed. HTML and JSON reports created.');
    process.exitCode = 2;
  } else if (scanResult.partialFailures.length > 0) {
    warn('Partial success: some steps failed');
    process.exitCode = 2;
  } else {
    process.exitCode = 0;
  }
}

main();

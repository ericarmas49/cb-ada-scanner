import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromScanner = createRequire(import.meta.url);
const { calculateScore } = requireFromScanner('../tools/a11y-scanner/src/report/scoring.js');

function normalizeScanUrl(input) {
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

function runScanner(scannerRoot, args) {
  const result = spawnSync('node', [path.join(scannerRoot, 'src/cli.js'), ...args], {
    cwd: scannerRoot,
    env: process.env,
    encoding: 'utf8'
  });

  return {
    status: result.status ?? 1,
    signal: result.signal || null,
    error: result.error ? String(result.error.message || result.error) : null,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function normalizeSeverity(severity) {
  if (severity === 'serious') return 'high';
  if (severity === 'minor') return 'low';
  if (severity === 'critical' || severity === 'moderate') return severity;
  return 'moderate';
}

function buildSummary(report) {
  const totals = report?.summary?.totals || { critical: 0, serious: 0, moderate: 0, minor: 0 };
  return {
    critical: totals.critical || 0,
    high: totals.serious || 0,
    moderate: totals.moderate || 0,
    low: totals.minor || 0
  };
}

function summaryFromNormalizedIssues(issues) {
  const out = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const issue of issues) {
    const sev = issue.severity;
    if (sev === 'critical') out.critical += 1;
    else if (sev === 'high') out.high += 1;
    else if (sev === 'moderate') out.moderate += 1;
    else if (sev === 'low') out.low += 1;
  }
  return out;
}

function isAaaIssue(issue) {
  return String(issue?.complianceLevel || '').toUpperCase() === 'AAA';
}

function accessibilityScoreFromSummary(summary) {
  return calculateScore({
    critical: summary.critical || 0,
    serious: summary.high || 0,
    moderate: summary.moderate || 0,
    minor: summary.low || 0
  });
}

function gradeAndRiskFromScore(score) {
  if (score >= 90) return { grade: 'A', complianceRisk: 'minimal' };
  if (score >= 80) return { grade: 'B', complianceRisk: 'low' };
  if (score >= 70) return { grade: 'C', complianceRisk: 'high' };
  if (score >= 60) return { grade: 'D', complianceRisk: 'very-high' };
  return { grade: 'F', complianceRisk: 'severe' };
}

function buildDashboard(issues, summary) {
  const violationCount = issues.length;
  const criticalCount = summary.critical || 0;
  const accessibilityScore = accessibilityScoreFromSummary(summary);
  const { grade, complianceRisk } = gradeAndRiskFromScore(accessibilityScore);
  return {
    violationCount,
    criticalCount,
    accessibilityScore,
    grade,
    complianceRisk
  };
}

function runArtifactUrl(origin, runId, artifactPath) {
  if (!artifactPath) return null;
  const normalizedPath = String(artifactPath).replace(/\\/g, '/');
  return `${origin}/runs/${runId}/${normalizedPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function artifactDataUrl(filePath, mimeType) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function artifactText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function safeFilePart(value) {
  return String(value || '')
    .trim()
    .replace(/^www\./i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'site';
}

function siteNameForPdf(report, fallbackUrl) {
  try {
    return safeFilePart(new URL(report.page?.finalUrl || report.page?.url || report.scan?.finalUrl || fallbackUrl).hostname);
  } catch {
    return safeFilePart(report.page?.title || report.scan?.inputUrl || fallbackUrl);
  }
}

function addTechnology(matches, name, type, evidence) {
  if (!matches.some((item) => item.name === name)) {
    matches.push({ name, type, evidence });
  }
}

function detectTechnologies({ html = '', finalUrl = '' }) {
  const source = String(html || '');
  const lower = source.toLowerCase();
  const matches = [];

  if (
    /wp-content|wp-includes|wp-json|wp-emoji-release|wp-block-library|<meta[^>]+generator[^>]+wordpress/i.test(source) ||
    /<body\b[^>]*class\s*=\s*["'][^"']*\bwp-[^"']*["']/i.test(source)
  ) {
    addTechnology(matches, 'WordPress', 'CMS', 'WordPress body classes, asset paths, scripts, or generator metadata');
  }
  if (
    /shopify-section|shopifycdn|cdn\.shopify\.com|data-shopify|shopify\.theme|window\.shopify|myshopify/i.test(source) ||
    /myshopify/i.test(finalUrl)
  ) {
    addTechnology(matches, 'Shopify', 'Commerce platform', 'Shopify section, CDN, data attribute, global, or domain markers');
  }
  if (/__NEXT_DATA__|\/_next\/static\//i.test(source)) {
    addTechnology(matches, 'Next.js', 'Framework', 'Next.js data or static asset markers');
  }
  if (/data-reactroot|react-dom|react\.production|react\.development|__react/i.test(source)) {
    addTechnology(matches, 'React', 'JavaScript framework', 'React DOM markers or script names');
  }
  if (/__NUXT__|\/_nuxt\//i.test(source)) {
    addTechnology(matches, 'Nuxt', 'Framework', 'Nuxt data or asset markers');
  }
  if (/data-v-[a-f0-9]+|vue\.runtime|vue\.global|vue\.js/i.test(source)) {
    addTechnology(matches, 'Vue', 'JavaScript framework', 'Vue scoped attributes or script names');
  }
  if (/ng-version|angular\.min\.js|angular\.js/i.test(source)) {
    addTechnology(matches, 'Angular', 'JavaScript framework', 'Angular attributes or script names');
  }
  if (/webflow\.js|data-wf-page|data-wf-site/i.test(source)) {
    addTechnology(matches, 'Webflow', 'Site builder', 'Webflow scripts or data attributes');
  }
  if (/wixstatic\.com|x-wix-|wix-code|wixsite\.com/i.test(source)) {
    addTechnology(matches, 'Wix', 'Site builder', 'Wix assets or platform markers');
  }
  if (/squarespace\.com|static1\.squarespace\.com/i.test(source)) {
    addTechnology(matches, 'Squarespace', 'Site builder', 'Squarespace asset markers');
  }
  if (/drupal-settings-json|\/sites\/default\/files|drupal\.js/i.test(source)) {
    addTechnology(matches, 'Drupal', 'CMS', 'Drupal settings or asset paths');
  }
  if (/joomla|\/media\/system\/js\//i.test(source)) {
    addTechnology(matches, 'Joomla', 'CMS', 'Joomla generator or asset paths');
  }
  if (/gatsby-focus-wrapper|___gatsby|\/page-data\//i.test(source)) {
    addTechnology(matches, 'Gatsby', 'Framework', 'Gatsby app or page-data markers');
  }

  const primary = matches.find((item) => ['WordPress', 'Shopify'].includes(item.name)) || matches[0] || null;
  return {
    primary: primary?.name || 'Not detected',
    technologies: matches,
    summary: matches.length
      ? matches.map((item) => item.name).join(', ')
      : lower.includes('<html') ? 'No common CMS or framework markers detected.' : 'No HTML snapshot available.'
  };
}

function listFiles(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const entries = [];
  const walk = (currentDir, prefix = '') => {
    for (const name of fs.readdirSync(currentDir)) {
      const absolute = path.join(currentDir, name);
      const relative = path.join(prefix, name);
      const stat = fs.statSync(absolute);
      if (stat.isDirectory()) {
        walk(absolute, relative);
      } else {
        entries.push(relative);
      }
    }
  };

  walk(targetDir);
  return entries.sort();
}

export function runAccessibilityDemo({ appRoot, outputRoot = appRoot, url, origin }) {
  const normalizedUrl = normalizeScanUrl(url);
  if (!normalizedUrl) {
    throw new Error('Invalid or empty url');
  }

  const runId = crypto.randomUUID();
  const scannerRoot = path.join(appRoot, 'tools', 'a11y-scanner');
  const runRoot = path.join(outputRoot, 'runs', runId);

  fs.mkdirSync(runRoot, { recursive: true });

  const scanTimeoutMs = String(process.env.SCAN_TIMEOUT_MS || '120000');
  const scanSettleMs = String(process.env.SCAN_SETTLE_MS || '2000');
  const scanKeyboardSteps = String(process.env.SCAN_KEYBOARD_STEPS || '10');

  const scanResult = runScanner(scannerRoot, [
    '--url',
    normalizedUrl,
    '--output',
    runRoot,
    '--settleMs',
    scanSettleMs,
    '--timeoutMs',
    scanTimeoutMs,
    '--keyboardTabSteps',
    scanKeyboardSteps,
    '--formTest',
    'false',
    '--fullPageScreenshot',
    'false',
    '--lazyLoadPasses',
    '6',
    '--networkIdleTimeoutMs',
    '2500'
  ]);
  if (scanResult.status === 1 || scanResult.error) {
    throw new Error(`Scan failed: ${scanResult.error || scanResult.stderr || scanResult.stdout}`);
  }

  const reportPath = path.join(runRoot, 'report.json');
  const reportHtmlPath = path.join(runRoot, 'report.html');
  if (!fs.existsSync(reportPath) || !fs.existsSync(reportHtmlPath)) {
    const files = listFiles(runRoot);
    throw new Error(
      `Scan did not generate the expected files. status=${scanResult.status} signal=${scanResult.signal || 'none'} ` +
        `stdout=${JSON.stringify(scanResult.stdout)} stderr=${JSON.stringify(scanResult.stderr)} files=${JSON.stringify(files)}`
    );
  }

  const report = readJson(reportPath);
  // Scanner report uses top-level `findings` (per-node rows).
  let findingList = Array.isArray(report.findings) ? report.findings : [];
  if (findingList.length === 0) {
    const axeRawPath = path.join(runRoot, 'artifacts', 'axe-raw.json');
    if (fs.existsSync(axeRawPath)) {
      try {
        const raw = readJson(axeRawPath);
        if (Array.isArray(raw?.violations) && raw.violations.length > 0) {
          const { normalizeAxeFindings } = requireFromScanner(
            path.join(scannerRoot, 'src/report/normalize_findings.js')
          );
          const { dedupeFindings } = requireFromScanner(path.join(scannerRoot, 'src/report/dedupe.js'));
          const { enrichFindings } = requireFromScanner(path.join(scannerRoot, 'src/report/enrich_findings.js'));
          const pageUrl = report.page?.finalUrl || report.scan?.finalUrl || '';
          const rebuilt = enrichFindings(dedupeFindings(normalizeAxeFindings(raw)), { pageUrl });
          findingList = rebuilt;
        }
      } catch {
        /* keep empty */
      }
    }
  }

  const issues = findingList.map((finding) => ({
    id: String(finding.id || '').replace(/^AXE-/i, ''),
    criterionId: finding.criterionId || '',
    criterionTitle: finding.criterionTitle || '',
    complianceLevel: finding.complianceLevel || '',
    principle: finding.principle || '',
    severity: normalizeSeverity(finding.severity),
    title: finding.title,
    wcagReference: finding?.evidence?.extra?.helpUrl || '',
    page: finding?.reportContext?.page || report.page?.finalUrl || report.page?.url || '',
    template: finding?.reportContext?.template || null,
    component: finding?.reportContext?.component || finding.selector || '',
    instanceCount: finding?.reportContext?.instanceCount || finding.occurrences || 1,
    selector: finding.selector || '',
    confidence: finding.confidence || 'medium',
    manual_review_required: Boolean(finding.manual_review_required),
    automation: finding.automation || '',
    remediation: finding.remediation || finding.fix || '',
    category: finding.category || ''
  }));

  const scoredIssues = issues.filter((issue) => !isAaaIssue(issue));
  const summary = summaryFromNormalizedIssues(scoredIssues);
  const dashboard = buildDashboard(scoredIssues, summary);
  const snapshotArtifact = report?.page?.artifacts?.viewportScreenshot || report?.page?.artifacts?.screenshot;
  const snapshotUrl = runArtifactUrl(
    origin,
    runId,
    snapshotArtifact
  );
  const snapshotPath = snapshotArtifact ? path.join(runRoot, snapshotArtifact) : null;
  const htmlArtifact = report?.page?.artifacts?.html;
  const htmlPath = htmlArtifact ? path.join(runRoot, htmlArtifact) : null;
  const htmlSnapshot = htmlPath && fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const technologies = detectTechnologies({
    html: htmlSnapshot,
    finalUrl: report.page?.finalUrl || report.page?.url || normalizedUrl
  });
  const rawPdfPath = path.join(runRoot, 'report.pdf');
  const pdfFileName = `CircleBlox-ADA-Scan-${siteNameForPdf(report, normalizedUrl)}.pdf`;
  const namedPdfPath = path.join(runRoot, pdfFileName);
  if (fs.existsSync(rawPdfPath)) {
    fs.copyFileSync(rawPdfPath, namedPdfPath);
  }
  const hasNamedPdf = fs.existsSync(namedPdfPath);
  const reportPdfDataUrl = artifactDataUrl(namedPdfPath, 'application/pdf');
  const inlineArtifacts = {
    reportHtml: artifactText(reportHtmlPath),
    reportPdfDataUrl,
    snapshotDataUrl: artifactDataUrl(snapshotPath, snapshotArtifact?.endsWith('.png') ? 'image/png' : 'image/jpeg'),
    pdfFileName: hasNamedPdf ? pdfFileName : null
  };

  const result = {
    runId,
    status: 'done',
    reportUrl: `${origin}/runs/${runId}/report.html`,
    reportPdfUrl: hasNamedPdf ? `${origin}/runs/${runId}/${encodeURIComponent(pdfFileName)}` : null,
    reportJsonUrl: `${origin}/runs/${runId}/report.json`,
    snapshotUrl,
    summary,
    dashboard,
    technologies,
    inlineArtifacts,
    issues
  };

  fs.writeFileSync(path.join(runRoot, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}

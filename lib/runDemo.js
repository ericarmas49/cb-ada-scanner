import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromScanner = createRequire(import.meta.url);

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

function accessibilityScoreFromReport(report, violationCount) {
  const raw = report?.summary?.score;
  const n = Number(raw);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  return violationCount === 0 ? 100 : 0;
}

/** High if any critical finding or automated score at or below 70; else Low at 85+; otherwise Medium. */
function complianceRiskLevel(criticalCount, accessibilityScore) {
  if (criticalCount > 0 || accessibilityScore <= 70) return 'high';
  if (accessibilityScore >= 85) return 'low';
  return 'medium';
}

function buildDashboard(report, issues, summary) {
  const violationCount = issues.length;
  const criticalCount = summary.critical || 0;
  const accessibilityScore = accessibilityScoreFromReport(report, violationCount);
  const complianceRisk = complianceRiskLevel(criticalCount, accessibilityScore);
  return {
    violationCount,
    criticalCount,
    accessibilityScore,
    complianceRisk
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

export function runAccessibilityDemo({ appRoot, url, origin }) {
  const normalizedUrl = normalizeScanUrl(url);
  if (!normalizedUrl) {
    throw new Error('Invalid or empty url');
  }

  const runId = crypto.randomUUID();
  const scannerRoot = path.join(appRoot, 'tools', 'a11y-scanner');
  const runRoot = path.join(appRoot, 'runs', runId);

  fs.mkdirSync(runRoot, { recursive: true });

  const scanResult = runScanner(scannerRoot, [
    '--url',
    normalizedUrl,
    '--output',
    runRoot,
    '--settleMs',
    '4000'
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

  const summaryFromReport = buildSummary(report);
  const summaryFromList = summaryFromNormalizedIssues(issues);
  const summaryEmpty =
    !summaryFromReport.critical &&
    !summaryFromReport.high &&
    !summaryFromReport.moderate &&
    !summaryFromReport.low;
  const listNonEmpty =
    summaryFromList.critical ||
    summaryFromList.high ||
    summaryFromList.moderate ||
    summaryFromList.low;
  const summary = summaryEmpty && listNonEmpty ? summaryFromList : summaryFromReport;
  const dashboard = buildDashboard(report, issues, summary);

  const result = {
    runId,
    status: 'done',
    reportUrl: `${origin}/runs/${runId}/report.html`,
    reportJsonUrl: `${origin}/runs/${runId}/report.json`,
    summary,
    dashboard,
    issues
  };

  fs.writeFileSync(path.join(runRoot, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}

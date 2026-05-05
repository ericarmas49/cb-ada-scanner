import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { remediateHtml } from './remediateHtml.js';

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

export async function runAccessibilityDemo({ appRoot, url, origin }) {
  const runId = crypto.randomUUID();
  const scannerRoot = path.join(appRoot, 'tools', 'a11y-scanner');
  const runRoot = path.join(appRoot, 'runs', runId);
  const beforeDir = path.join(runRoot, 'before');
  const afterDir = path.join(runRoot, 'after');
  const remediatedDir = path.join(runRoot, 'remediated');

  fs.mkdirSync(beforeDir, { recursive: true });
  fs.mkdirSync(afterDir, { recursive: true });
  fs.mkdirSync(remediatedDir, { recursive: true });

  const beforeScan = runScanner(scannerRoot, ['--url', url, '--output', beforeDir]);
  if (beforeScan.status === 1 || beforeScan.error) {
    throw new Error(`Before scan failed: ${beforeScan.error || beforeScan.stderr || beforeScan.stdout}`);
  }

  const beforeReportPath = path.join(beforeDir, 'report.json');
  const beforeHtmlPath = path.join(beforeDir, 'report.html');
  const snapshotPath = path.join(beforeDir, 'artifacts', 'html-snapshot.html');
  if (!fs.existsSync(beforeReportPath) || !fs.existsSync(snapshotPath) || !fs.existsSync(beforeHtmlPath)) {
    const files = listFiles(beforeDir);
    throw new Error(
      `Before scan did not generate the expected files. status=${beforeScan.status} signal=${beforeScan.signal || 'none'} ` +
      `stdout=${JSON.stringify(beforeScan.stdout)} stderr=${JSON.stringify(beforeScan.stderr)} files=${JSON.stringify(files)}`
    );
  }

  const beforeReport = readJson(beforeReportPath);
  const originalHtml = fs.readFileSync(snapshotPath, 'utf8');
  const remediation = await remediateHtml(originalHtml);

  const remediatedHtmlPath = path.join(remediatedDir, 'index.html');
  fs.writeFileSync(remediatedHtmlPath, remediation.remediatedHtml, 'utf8');

  const afterScan = runScanner(scannerRoot, ['--htmlFile', remediatedHtmlPath, '--output', afterDir]);
  if (afterScan.status === 1 || afterScan.error) {
    throw new Error(`After scan failed: ${afterScan.error || afterScan.stderr || afterScan.stdout}`);
  }

  const afterReportPath = path.join(afterDir, 'report.json');
  const afterHtmlPath = path.join(afterDir, 'report.html');
  if (!fs.existsSync(afterReportPath) || !fs.existsSync(afterHtmlPath)) {
    const files = listFiles(afterDir);
    throw new Error(
      `After scan did not generate the expected files. status=${afterScan.status} signal=${afterScan.signal || 'none'} ` +
      `stdout=${JSON.stringify(afterScan.stdout)} stderr=${JSON.stringify(afterScan.stderr)} files=${JSON.stringify(files)}`
    );
  }

  const afterReport = readJson(afterReportPath);
  const afterMap = new Map();
  for (const finding of afterReport.findings || []) {
    afterMap.set(`${finding.id}::${finding.selector}::${finding.title}`, finding);
  }

  const aiGeneratedIds = new Set(
    remediation.remediationLog
      .filter((entry) => entry.aiGenerated && entry.issueId)
      .map((entry) => entry.issueId)
  );

  const issues = (beforeReport.findings || []).map((finding) => {
    const key = `${finding.id}::${finding.selector}::${finding.title}`;
    return {
      id: finding.id,
      criterionId: finding.criterionId || '',
      criterionTitle: finding.criterionTitle || '',
      complianceLevel: finding.complianceLevel || '',
      principle: finding.principle || '',
      severity: normalizeSeverity(finding.severity),
      title: finding.title,
      wcagReference: finding?.evidence?.extra?.helpUrl || '',
      page: finding?.reportContext?.page || beforeReport.page?.finalUrl || beforeReport.page?.url || '',
      template: finding?.reportContext?.template || null,
      component: finding?.reportContext?.component || finding.selector || '',
      instanceCount: finding?.reportContext?.instanceCount || finding.occurrences || 1,
      selector: finding.selector || '',
      fixed: !afterMap.has(key),
      aiGenerated: aiGeneratedIds.has(finding.id),
      confidence: finding.confidence || 'medium',
      manual_review_required: Boolean(finding.manual_review_required),
      automation: finding.automation || '',
      remediation: finding.remediation || finding.fix || '',
      category: finding.category || ''
    };
  });

  const result = {
    runId,
    status: 'done',
    previewUrl: `${origin}/runs/${runId}/remediated/index.html`,
    beforeReportUrl: `${origin}/runs/${runId}/before/report.html`,
    afterReportUrl: `${origin}/runs/${runId}/after/report.html`,
    summaryBefore: buildSummary(beforeReport),
    summaryAfter: buildSummary(afterReport),
    remediationLog: remediation.remediationLog,
    warnings: [
      ...remediation.warnings,
      'This demo only indicates passes for automated checks and known best practices. Manual accessibility review is still required.'
    ],
    issues
  };

  fs.writeFileSync(path.join(runRoot, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}

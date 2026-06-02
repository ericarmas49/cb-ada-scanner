'use strict';

const fs = require('fs');
const path = require('path');
const assetCssPath = path.resolve(__dirname, '../../report/assets/report.css');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function groupFindings(findings) {
  const map = new Map();
  for (const finding of findings || []) {
    if (!map.has(finding.id)) {
      map.set(finding.id, []);
    }
    map.get(finding.id).push(finding);
  }
  return Array.from(map.entries());
}

function fixTypeLabel(item) {
  const fixType = item.fixType || item?.evidence?.extra?.fixType || '';
  if (fixType === 'safe-auto-fix') return 'Safe auto-fix';
  if (fixType === 'manual-review') return 'Manual review';
  if (fixType === 'suggested-fix') return 'Suggested fix';
  return '';
}

function formatReportDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function formatShortReportDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function siteNameFromReport(report) {
  const title = String(report.page?.title || '').trim();
  if (title) return title;

  try {
    return new URL(report.scan?.finalUrl || report.scan?.inputUrl || '').hostname.replace(/^www\./i, '');
  } catch {
    return report.scan?.inputUrl || '';
  }
}

function renderFindingItem(item) {
  const screenshot = item?.evidence?.screenshot
    ? `<img class="screenshot" src="${escapeHtml(item.evidence.screenshot)}" alt="Evidence screenshot" />`
    : '';
  const manual = item.manual_review_required ? '<span class="pill warn">Manual review</span>' : '';
  const wcagLine = item.criterionId
    ? `<p class="meta">WCAG ${escapeHtml(item.criterionId)} | ${escapeHtml(item.criterionTitle || '')} | Level ${escapeHtml(item.complianceLevel || '')} | ${escapeHtml(item.principle || '')}</p>`
    : '<p class="meta">WCAG mapping not yet assigned</p>';
  const automationLine = item.automation
    ? `<p class="meta">Check type: ${escapeHtml(item.automation)} | Category: ${escapeHtml(item.category || '')}</p>`
    : '';
  const fixType = fixTypeLabel(item);
  const fixTypePill = fixType ? `<span class="pill">${escapeHtml(fixType)}</span>` : '';

  return `
    <div class="finding-item">
      <div class="finding-meta">
        <span class="pill ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span>
        ${fixTypePill}
        ${manual}
      </div>
      ${wcagLine}
      ${automationLine}
      ${screenshot}
      <div class="selector">${escapeHtml(item.selector || '')}</div>
    </div>
  `;
}

function renderFindingGroup(ruleId, items) {
  const first = items[0];

  return `
    <div class="finding-group">
      <h3>${escapeHtml(first.title)}</h3>
      ${items.map(renderFindingItem).join('')}
    </div>
  `;
}

function renderManualReview(items) {
  if (!items.length) {
    return '<p>No manual review items were flagged.</p>';
  }

  return items.map((item) => `
    <div class="finding-item">
      <div class="finding-meta">
        <span class="pill ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span>
      </div>
      <div><strong>${escapeHtml(item.title)}</strong></div>
      ${item.criterionId ? `<p class="meta">WCAG ${escapeHtml(item.criterionId)} | ${escapeHtml(item.criterionTitle || '')} | Level ${escapeHtml(item.complianceLevel || '')} | ${escapeHtml(item.principle || '')}</p>` : ''}
      <div class="selector">${escapeHtml(item.selector || '')}</div>
      <p>${escapeHtml(item.why || '')}</p>
    </div>
  `).join('');
}

function buildReportHtml(report) {
  const css = fs.existsSync(assetCssPath) ? fs.readFileSync(assetCssPath, 'utf8') : '';
  const grouped = groupFindings(report.findings);
  const manualReview = (report.findings || []).filter((item) => item.manual_review_required || item.confidence === 'low');
  const notes = (report.summary?.notes || []).map((note) => `<p>${escapeHtml(note)}</p>`).join('');
  const groupsHtml = grouped.length
    ? grouped.map(([ruleId, items]) => renderFindingGroup(ruleId, items)).join('')
    : '<p>No issues detected by automated checks.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Accessibility Report</title>
  <style>${css}</style>
</head>
<body>
  <header class="header">
    <div>
      <h1>Accessibility Report</h1>
      <p class="report-site">${escapeHtml(siteNameFromReport(report))}</p>
      <p class="report-generated">Generated ${escapeHtml(formatReportDate())}</p>
    </div>
  </header>

  <section class="section">
    <h2>Executive Summary</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <div class="label">Critical</div>
        <div class="value critical">${escapeHtml(report.summary?.totals?.critical ?? 0)}</div>
      </div>
      <div class="summary-item">
        <div class="label">Serious</div>
        <div class="value serious">${escapeHtml(report.summary?.totals?.serious ?? 0)}</div>
      </div>
      <div class="summary-item">
        <div class="label">Moderate</div>
        <div class="value moderate">${escapeHtml(report.summary?.totals?.moderate ?? 0)}</div>
      </div>
      <div class="summary-item">
        <div class="label">Minor</div>
        <div class="value minor">${escapeHtml(report.summary?.totals?.minor ?? 0)}</div>
      </div>
    </div>
    <div class="notes">${notes}</div>
  </section>

  <section class="section">
    <h2>What Was Tested</h2>
    <ul class="meta-list">
      <li><strong>Input URL:</strong> ${escapeHtml(report.scan?.inputUrl || '')}</li>
      <li><strong>Title:</strong> ${escapeHtml(report.page?.title || '')}</li>
      <li><strong>Scan Started:</strong> ${escapeHtml(formatShortReportDate(report.scan?.startedAt))}</li>
    </ul>
  </section>

  <section class="section">
    <h2>Top Issues</h2>
    ${groupsHtml}
  </section>

  <section class="section">
    <h2>Manual Review Needed</h2>
    ${renderManualReview(manualReview)}
  </section>

  <footer class="footer">
    <p>Report generated by Single-URL WCAG 2.2 AA Scanner.</p>
  </footer>
</body>
</html>`;
}

module.exports = { buildReportHtml };

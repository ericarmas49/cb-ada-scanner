const steps = [
  { id: 'queued', label: 'Queued' },
  { id: 'scanning', label: 'Scanning' },
  { id: 'done', label: 'Complete' }
];

const form = document.querySelector('#demo-form');
const urlInput = document.querySelector('#url');
const submitButton = document.querySelector('#submit-button');
const demoDataButton = document.querySelector('#demo-data-button');
const statusGrid = document.querySelector('#status-grid');
const statusPanel = document.querySelector('#status-panel');
const errorBox = document.querySelector('#error-box');
const results = document.querySelector('#results');
const reportLink = document.querySelector('#report-link');
const reportPdfLink = document.querySelector('#report-pdf-link');
const reportJsonLink = document.querySelector('#report-json-link');
const scanSummary = document.querySelector('#scan-summary');
const resultsDashboard = document.querySelector('#results-dashboard');
const dashViolationCount = document.querySelector('#dash-violation-count');
const dashStatusCopy = document.querySelector('#dash-status-copy');
const dashScoreValue = document.querySelector('#dash-score-value');
const dashRiskValue = document.querySelector('#dash-risk-value');
const dashRiskCopy = document.querySelector('#dash-risk-copy');
const snapshotImage = document.querySelector('#snapshot-image');
const snapshotPlaceholder = document.querySelector('#snapshot-placeholder');
const scanProgressValue = document.querySelector('#scan-progress-value');
const scanProgressBar = document.querySelector('#scan-progress-bar');
const scanProgressCopy = document.querySelector('#scan-progress-copy');
const issuesBody = document.querySelector('#issues-body');
const issuesFilterSummary = document.querySelector('#issues-filter-summary');
const sortButtons = Array.from(document.querySelectorAll('[data-sort-key]'));
const filterInputs = Array.from(document.querySelectorAll('[data-filter-group]'));
const demoStrip = document.querySelector('#demo-strip');

const LEVEL_FILTERS = ['A', 'AA', 'AAA'];
const SEVERITY_FILTERS = ['critical', 'high', 'moderate', 'low'];
const levelOrder = new Map(LEVEL_FILTERS.map((level, index) => [level, index]));
const severityOrder = new Map(SEVERITY_FILTERS.map((severity, index) => [severity, index]));
const tableCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
let currentIssues = [];
let issueSort = { key: null, direction: 'asc' };

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('http://')) return trimmed.replace('http://', 'https://');
  return `https://${trimmed}`;
}

function renderStatuses(activeState) {
  statusGrid.innerHTML = '';
  const activeIndex = steps.findIndex((step) => step.id === activeState);
  steps.forEach((step, index) => {
    const card = document.createElement('div');
    const isComplete = activeState === 'done' ? index < steps.length : index < activeIndex;
    const isActive = step.id === activeState;
    card.className = 'status-card';
    if (isComplete) card.classList.add('complete');
    if (isActive) card.classList.add('active');
    if (activeState === 'error' && step.id === 'scanning') card.classList.add('error');
    card.innerHTML = `<strong>${step.label}</strong><p>${isActive ? 'In progress' : isComplete ? 'Complete' : 'Pending'}</p>`;
    statusGrid.appendChild(card);
  });
}

function normalizeSummary(raw) {
  const s = raw && typeof raw === 'object' ? raw : null;
  return {
    critical: Number(s?.critical) || 0,
    high: Number(s?.high) || 0,
    moderate: Number(s?.moderate) || 0,
    low: Number(s?.low) || 0
  };
}

/** Prefer current API shape; fall back to legacy before/after scan payloads. */
function pickSummary(data) {
  if (data?.summary) return normalizeSummary(data.summary);
  if (data?.summaryBefore) return normalizeSummary(data.summaryBefore);
  return { critical: 0, high: 0, moderate: 0, low: 0 };
}

function summaryMarkup(summary) {
  const s = normalizeSummary(summary);
  return `
    <span>Scan summary</span>
    <strong>Critical ${s.critical} | High ${s.high}</strong>
    <p>Moderate ${s.moderate} | Low ${s.low}</p>
  `;
}

function gradeAndRiskFromScore(score) {
  if (score >= 90) return { grade: 'A', complianceRisk: 'minimal' };
  if (score >= 80) return { grade: 'B', complianceRisk: 'low' };
  if (score >= 70) return { grade: 'C', complianceRisk: 'high' };
  if (score >= 60) return { grade: 'D', complianceRisk: 'very-high' };
  return { grade: 'F', complianceRisk: 'severe' };
}

/** Server sends dashboard; derive a minimal one for older saved payloads. */
function pickDashboard(data) {
  const d = data?.dashboard;
  if (d && typeof d.violationCount === 'number' && typeof d.accessibilityScore === 'number') {
    return d;
  }
  const issues = data.issues || [];
  const s = pickSummary(data);
  const violationCount = issues.length;
  const criticalCount = s.critical;
  const accessibilityScore = violationCount === 0 ? 100 : 0;
  const { grade, complianceRisk } = gradeAndRiskFromScore(accessibilityScore);
  return {
    violationCount,
    criticalCount,
    accessibilityScore,
    grade,
    complianceRisk
  };
}

function renderDashboard(data) {
  if (!resultsDashboard || !dashViolationCount || !dashStatusCopy || !dashScoreValue || !dashRiskValue || !dashRiskCopy) {
    return;
  }

  results.classList.remove('scanning');

  if (snapshotImage && snapshotPlaceholder) {
    if (data.snapshotUrl) {
      snapshotImage.src = data.snapshotUrl;
      snapshotImage.classList.remove('hidden');
      snapshotPlaceholder.classList.add('hidden');
    } else {
      snapshotImage.removeAttribute('src');
      snapshotImage.classList.add('hidden');
      snapshotPlaceholder.classList.remove('hidden');
    }
  }

  const d = pickDashboard(data);
  const findingCount = (data.issues || []).length;
  dashViolationCount.textContent = `${findingCount} violation${findingCount === 1 ? '' : 's'}`;

  if (findingCount === 0) {
    dashStatusCopy.textContent =
      'No automated WCAG 2.2 AA failures were detected on this page snapshot.';
  } else {
    dashStatusCopy.textContent = 'Your site is not complying with WCAG 2.2 AA.';
  }

  dashScoreValue.textContent = `${d.accessibilityScore}%`;

  dashRiskValue.className = 'dashboard-risk-label';
  const risk = d.complianceRisk || gradeAndRiskFromScore(d.accessibilityScore).complianceRisk;
  if (risk === 'minimal') {
    dashRiskValue.classList.add('compliance-risk-low');
    dashRiskValue.textContent = 'Minimal';
    dashRiskCopy.textContent =
      findingCount === 0
        ? 'Automated risk is minimal on this snapshot; continue with manual verification before making a compliance claim.'
        : 'Automated risk is minimal, with remaining findings likely limited in severity or impact.';
  } else if (risk === 'low') {
    dashRiskValue.classList.add('compliance-risk-low');
    dashRiskValue.textContent = 'Low';
    dashRiskCopy.textContent = 'Low risk: resolve remaining findings to improve confidence in accessibility compliance.';
  } else if (risk === 'high') {
    dashRiskValue.classList.add('compliance-risk-high');
    dashRiskValue.textContent = 'High';
    dashRiskCopy.textContent = 'High risk: score falls in the C range and findings should be prioritized.';
  } else if (risk === 'very-high') {
    dashRiskValue.classList.add('compliance-risk-high');
    dashRiskValue.textContent = 'Very High';
    dashRiskCopy.textContent = 'Very high risk: score falls in the D range and major remediation is likely needed.';
  } else {
    dashRiskValue.classList.add('compliance-risk-high');
    dashRiskValue.textContent = 'Severe';
    dashRiskCopy.textContent =
      'Severe risk: score falls below passing range and accessibility failures need immediate attention.';
  }
}

function setScanProgress(progress) {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  if (scanProgressValue) scanProgressValue.textContent = `${value}%`;
  if (scanProgressBar) scanProgressBar.style.width = `${value}%`;
  if (scanProgressCopy) {
    if (value < 35) {
      scanProgressCopy.textContent = 'Loading the page and waiting for the first stable render.';
    } else if (value < 70) {
      scanProgressCopy.textContent = 'Running automated checks and collecting page evidence.';
    } else {
      scanProgressCopy.textContent = 'Preparing the report and snapshot preview.';
    }
  }
}

function renderScanningDashboard(progress = 0) {
  results.classList.add('scanning');
  results.classList.remove('hidden');
  if (snapshotImage) {
    snapshotImage.removeAttribute('src');
    snapshotImage.classList.add('hidden');
  }
  snapshotPlaceholder?.classList.remove('hidden');
  setScanProgress(progress);
}

const WCAG_OVERVIEW_URL = 'https://www.w3.org/WAI/standards-guidelines/wcag/';
const WCAG22_UNDERSTANDING_BASE = 'https://www.w3.org/WAI/WCAG22/Understanding/';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Slug matches W3C Understanding / TR fragment IDs for success criteria titles (e.g. non-text-content). */
function wcagCriterionSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, ' $1 ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function wcagRefForIssue(issue) {
  const ref = issue.wcagReference ? String(issue.wcagReference).trim() : '';
  if (ref.startsWith('https://www.w3.org/') || ref.startsWith('http://www.w3.org/')) {
    const href = ref.startsWith('http://') ? ref.replace('http://', 'https://') : ref;
    return { href, label: issue.criterionId ? `${issue.criterionId} (W3C)` : 'W3C' };
  }

  const slug = wcagCriterionSlug(issue.criterionTitle);
  if (issue.criterionId && slug) {
    return {
      href: `${WCAG22_UNDERSTANDING_BASE}${slug}.html`,
      label: `${issue.criterionId} · Understanding`
    };
  }

  if (issue.criterionId) {
    return {
      href: WCAG_OVERVIEW_URL,
      label: `${issue.criterionId} · WCAG overview`
    };
  }

  return { href: WCAG_OVERVIEW_URL, label: 'WCAG overview' };
}

function wcagRefCell(issue) {
  const { href, label } = wcagRefForIssue(issue);
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function boolText(value) {
  return value ? 'Yes' : 'No';
}

function selectedFilterValues(group) {
  return new Set(
    filterInputs
      .filter((input) => input.dataset.filterGroup === group && input.checked)
      .map((input) => input.value)
  );
}

function issueMatchesFilters(issue) {
  const selectedLevels = selectedFilterValues('level');
  const selectedSeverities = selectedFilterValues('severity');
  const level = String(issue.complianceLevel || '').toUpperCase();
  const severity = String(issue.severity || '').toLowerCase();

  if (LEVEL_FILTERS.includes(level) && !selectedLevels.has(level)) return false;
  if (SEVERITY_FILTERS.includes(severity) && !selectedSeverities.has(severity)) return false;
  return true;
}

function sortValueForIssue(issue, key) {
  if (key === 'id') return issue.id || '';
  if (key === 'criterion') return `${issue.criterionId || ''} ${issue.criterionTitle || ''}`.trim();
  if (key === 'level') return String(issue.complianceLevel || '').toUpperCase();
  if (key === 'severity') return String(issue.severity || '').toLowerCase();
  if (key === 'title') return issue.title || '';
  if (key === 'wcagRef') return wcagRefForIssue(issue).label;
  if (key === 'selector') return issue.selector || '';
  if (key === 'manualReview') return issue.manual_review_required ? 1 : 0;
  return '';
}

function compareIssues(left, right) {
  const { key, direction } = issueSort;
  if (!key) return 0;

  let result = 0;
  if (key === 'level') {
    const leftValue = sortValueForIssue(left, key);
    const rightValue = sortValueForIssue(right, key);
    result = (levelOrder.get(leftValue) ?? Number.MAX_SAFE_INTEGER) - (levelOrder.get(rightValue) ?? Number.MAX_SAFE_INTEGER);
  } else if (key === 'severity') {
    const leftValue = sortValueForIssue(left, key);
    const rightValue = sortValueForIssue(right, key);
    result =
      (severityOrder.get(leftValue) ?? Number.MAX_SAFE_INTEGER) -
      (severityOrder.get(rightValue) ?? Number.MAX_SAFE_INTEGER);
  } else if (key === 'manualReview') {
    result = sortValueForIssue(left, key) - sortValueForIssue(right, key);
  } else {
    result = tableCollator.compare(String(sortValueForIssue(left, key)), String(sortValueForIssue(right, key)));
  }

  if (result === 0) {
    result = tableCollator.compare(String(left.id || ''), String(right.id || ''));
  }
  return direction === 'asc' ? result : result * -1;
}

function visibleIssues() {
  const filtered = currentIssues.filter(issueMatchesFilters);
  if (!issueSort.key) return filtered;
  return [...filtered].sort(compareIssues);
}

function updateSortControls() {
  sortButtons.forEach((button) => {
    const isActive = button.dataset.sortKey === issueSort.key;
    const direction = isActive ? issueSort.direction : 'none';
    const header = button.closest('th');
    if (header) header.setAttribute('aria-sort', direction);
    button.dataset.sortDirection = direction;
    button.setAttribute(
      'aria-label',
      `${button.textContent.trim()}, ${isActive ? `${direction} sort active` : 'not sorted'}`
    );
  });
}

function renderIssuesTable() {
  if (!issuesBody) return;

  const rows = visibleIssues();
  issuesBody.innerHTML = '';
  rows.forEach((issue) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(issue.id)}</td>
      <td>${escapeHtml(issue.criterionId || '-')}</td>
      <td>${escapeHtml(issue.complianceLevel || '-')}</td>
      <td>${escapeHtml(issue.severity)}</td>
      <td>${escapeHtml(issue.title)}</td>
      <td>${wcagRefCell(issue)}</td>
      <td>${escapeHtml(issue.selector || '-')}</td>
      <td>${boolText(issue.manual_review_required)}</td>
    `;
    issuesBody.appendChild(row);
  });

  if (rows.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="8">No violations match the selected filters.</td>';
    issuesBody.appendChild(row);
  }

  if (issuesFilterSummary) {
    issuesFilterSummary.textContent = `Showing ${rows.length} of ${currentIssues.length} violation${
      currentIssues.length === 1 ? '' : 's'
    }`;
  }
  updateSortControls();
}

function renderResults(data) {
  document.body.classList.remove('is-scanning');
  document.body.classList.add('scan-active');
  renderDashboard(data);
  const isDemoPayload =
    data.runId === '00000000-0000-4000-8000-00000000demo' ||
    (typeof data.reportUrl === 'string' && data.reportUrl.startsWith('#'));
  if (reportLink) {
    reportLink.href = data.reportUrl || '#';
    reportLink.title = isDemoPayload ? 'Demo only — no report file is available.' : '';
  }
  if (reportPdfLink) {
    reportPdfLink.href = data.reportPdfUrl || '#';
    reportPdfLink.title = isDemoPayload || !data.reportPdfUrl ? 'Demo only — no PDF file is available.' : '';
    reportPdfLink.toggleAttribute('aria-disabled', !data.reportPdfUrl);
  }
  if (reportJsonLink) {
    reportJsonLink.href = data.reportJsonUrl || '#';
    reportJsonLink.title = isDemoPayload ? 'Demo only — no JSON file is available.' : '';
  }
  if (scanSummary) scanSummary.innerHTML = summaryMarkup(pickSummary(data));

  currentIssues = data.issues || [];
  renderIssuesTable();

  if (demoStrip) {
    if (data.isDemo) {
      demoStrip.textContent = 'Sample data — no live scan was run. Rows below are static examples.';
      demoStrip.classList.remove('hidden');
    } else {
      demoStrip.textContent = '';
      demoStrip.classList.add('hidden');
    }
  }

  results.classList.remove('hidden');
}

async function runDemo(url) {
  document.body.classList.add('scan-active', 'is-scanning');
  statusPanel?.removeAttribute('aria-hidden');
  const sequence = ['queued', 'scanning'];
  let tick = 0;
  let progress = 7;
  renderStatuses(sequence[tick]);
  renderScanningDashboard(progress);
  const timer = window.setInterval(() => {
    tick = Math.min(tick + 1, sequence.length - 1);
    renderStatuses(sequence[tick]);
  }, 1500);
  const progressTimer = window.setInterval(() => {
    progress = Math.min(93, progress + Math.max(1, Math.round((94 - progress) * 0.12)));
    setScanProgress(progress);
  }, 900);

  try {
    const response = await fetch('/api/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Scan failed');
    }
    window.clearInterval(timer);
    window.clearInterval(progressTimer);
    setScanProgress(100);
    renderStatuses('done');
    renderResults(data);
  } catch (error) {
    document.body.classList.remove('is-scanning');
    window.clearInterval(timer);
    window.clearInterval(progressTimer);
    results.classList.add('hidden');
    results.classList.remove('scanning');
    renderStatuses('error');
    errorBox.textContent = error instanceof Error ? error.message : 'Unknown error';
    errorBox.classList.remove('hidden');
  } finally {
    submitButton.disabled = false;
    if (demoDataButton) demoDataButton.disabled = false;
    submitButton.textContent = 'Scan website';
  }
}

renderStatuses('queued');

const MOCK_DATA_URL = '/mock-scan-data.json';

async function loadMockScanData() {
  const response = await fetch(MOCK_DATA_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load demo data (${response.status})`);
  }
  return response.json();
}

async function runDataDemo() {
  errorBox.classList.add('hidden');
  results.classList.add('hidden');
  if (demoDataButton) demoDataButton.disabled = true;
  if (submitButton) submitButton.disabled = true;

  try {
    const data = await loadMockScanData();
    renderStatuses('done');
    renderResults(data);
  } catch (err) {
    renderStatuses('error');
    errorBox.textContent = err instanceof Error ? err.message : 'Demo data failed';
    errorBox.classList.remove('hidden');
  } finally {
    if (demoDataButton) demoDataButton.disabled = false;
    if (submitButton) submitButton.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.classList.add('hidden');
  results.classList.add('hidden');
  const normalizedUrl = normalizeUrl(urlInput.value);
  if (!normalizedUrl) return;
  submitButton.disabled = true;
  if (demoDataButton) demoDataButton.disabled = true;
  submitButton.textContent = 'Scanning…';
  await runDemo(normalizedUrl);
  if (demoDataButton) demoDataButton.disabled = false;
});

demoDataButton?.addEventListener('click', () => {
  void runDataDemo();
});

sortButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.sortKey;
    if (issueSort.key === key) {
      issueSort = { key, direction: issueSort.direction === 'asc' ? 'desc' : 'asc' };
    } else {
      issueSort = { key, direction: 'asc' };
    }
    renderIssuesTable();
  });
});

filterInputs.forEach((input) => {
  input.addEventListener('change', renderIssuesTable);
});

snapshotImage?.addEventListener('error', () => {
  snapshotImage.removeAttribute('src');
  snapshotImage.classList.add('hidden');
  snapshotPlaceholder?.classList.remove('hidden');
});

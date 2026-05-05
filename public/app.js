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
const errorBox = document.querySelector('#error-box');
const results = document.querySelector('#results');
const reportLink = document.querySelector('#report-link');
const reportJsonLink = document.querySelector('#report-json-link');
const scanSummary = document.querySelector('#scan-summary');
const resultsDashboard = document.querySelector('#results-dashboard');
const dashViolationCount = document.querySelector('#dash-violation-count');
const dashStatusCopy = document.querySelector('#dash-status-copy');
const dashScoreValue = document.querySelector('#dash-score-value');
const dashRiskValue = document.querySelector('#dash-risk-value');
const dashRiskCopy = document.querySelector('#dash-risk-copy');
const issuesBody = document.querySelector('#issues-body');
const demoStrip = document.querySelector('#demo-strip');

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

function complianceRiskLevelClient(criticalCount, accessibilityScore) {
  if (criticalCount > 0 || accessibilityScore <= 70) return 'high';
  if (accessibilityScore >= 85) return 'low';
  return 'medium';
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
  return {
    violationCount,
    criticalCount,
    accessibilityScore,
    complianceRisk: complianceRiskLevelClient(criticalCount, accessibilityScore)
  };
}

function renderDashboard(data) {
  if (!resultsDashboard || !dashViolationCount || !dashStatusCopy || !dashScoreValue || !dashRiskValue || !dashRiskCopy) {
    return;
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
  const risk = d.complianceRisk;
  if (risk === 'high') {
    dashRiskValue.classList.add('compliance-risk-high');
    dashRiskValue.textContent = 'High';
    dashRiskCopy.textContent = `${findingCount} violation${findingCount === 1 ? '' : 's'} detected may impact accessibility compliance.`;
  } else if (risk === 'medium') {
    dashRiskValue.classList.add('compliance-risk-medium');
    dashRiskValue.textContent = 'Medium';
    dashRiskCopy.textContent =
      'Elevated risk: resolve findings to improve confidence in WCAG 2.2 AA alignment.';
  } else {
    dashRiskValue.classList.add('compliance-risk-low');
    dashRiskValue.textContent = 'Low';
    dashRiskCopy.textContent =
      findingCount === 0
        ? 'Lower automated risk on this snapshot; continue with full manual verification.'
        : 'Fewer high-severity signals on this snapshot; review each finding and validate manually.';
  }
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

function renderResults(data) {
  renderDashboard(data);
  const isDemoPayload =
    data.runId === '00000000-0000-4000-8000-00000000demo' ||
    (typeof data.reportUrl === 'string' && data.reportUrl.startsWith('#'));
  if (reportLink) {
    reportLink.href = data.reportUrl || '#';
    reportLink.title = isDemoPayload ? 'Demo only — no report file is available.' : '';
  }
  if (reportJsonLink) {
    reportJsonLink.href = data.reportJsonUrl || '#';
    reportJsonLink.title = isDemoPayload ? 'Demo only — no JSON file is available.' : '';
  }
  if (scanSummary) scanSummary.innerHTML = summaryMarkup(pickSummary(data));

  issuesBody.innerHTML = '';
  (data.issues || []).forEach((issue) => {
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
  const sequence = ['queued', 'scanning'];
  let tick = 0;
  renderStatuses(sequence[tick]);
  const timer = window.setInterval(() => {
    tick = Math.min(tick + 1, sequence.length - 1);
    renderStatuses(sequence[tick]);
  }, 1500);

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
    renderStatuses('done');
    renderResults(data);
  } catch (error) {
    window.clearInterval(timer);
    renderStatuses('error');
    errorBox.textContent = error instanceof Error ? error.message : 'Unknown error';
    errorBox.classList.remove('hidden');
  } finally {
    submitButton.disabled = false;
    if (demoDataButton) demoDataButton.disabled = false;
    submitButton.textContent = 'Run scan';
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

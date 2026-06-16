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
const scanFailedPanel = document.querySelector('#scan-failed-panel');
const scanFailedCopy = document.querySelector('#scan-failed-copy');
const results = document.querySelector('#results');
const reportLink = document.querySelector('#report-link');
const reportPdfLink = document.querySelector('#report-pdf-link');
const pdfEmailModal = document.querySelector('#pdf-email-modal');
const pdfEmailForm = document.querySelector('#pdf-email-form');
const pdfEmailInput = document.querySelector('#pdf-email');
const pdfEmailCopy = document.querySelector('#pdf-email-copy');
const pdfEmailError = document.querySelector('#pdf-email-error');
const scanSummary = document.querySelector('#scan-summary');
const technologySummary = document.querySelector('#technology-summary');
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
const aaaIssuesBody = document.querySelector('#aaa-issues-body');
const issuesFilterSummary = document.querySelector('#issues-filter-summary');
const aaaIssuesSummary = document.querySelector('#aaa-issues-summary');
const sortButtons = Array.from(document.querySelectorAll('[data-sort-key]'));
const filterInputs = Array.from(document.querySelectorAll('[data-filter-group]'));
const demoStrip = document.querySelector('#demo-strip');
const servicesMenu = document.querySelector('[data-services-menu]');
const servicesButton = document.querySelector('[data-services-button]');
const servicesDropdown = document.querySelector('[data-services-dropdown]');
const mobileToggle = document.querySelector('[data-mobile-toggle]');
const mobileMenu = document.querySelector('[data-mobile-menu]');
const chatButtons = Array.from(document.querySelectorAll('[data-open-chat]'));

const LEVEL_FILTERS = ['A', 'AA', 'AAA'];
const SEVERITY_FILTERS = ['critical', 'high', 'moderate', 'low'];
const levelOrder = new Map(LEVEL_FILTERS.map((level, index) => [level, index]));
const severityOrder = new Map(SEVERITY_FILTERS.map((severity, index) => [severity, index]));
const tableCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
let currentIssues = [];
let issueSort = { key: null, direction: 'asc' };
let activeArtifactUrls = [];
let currentScanData = null;
let pendingPdfDownload = null;
let servicesCloseTimer = null;

const frontendConfig = window.ACCESSIBILITY_DEMO_CONFIG || {};
const API_BASE_URL = String(frontendConfig.apiBaseUrl || '').replace(/\/+$/, '');

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('http://')) return trimmed.replace('http://', 'https://');
  return `https://${trimmed}`;
}

function setServicesOpen(isOpen, focusFirstItem = false) {
  if (!servicesButton || !servicesDropdown) return;
  servicesButton.setAttribute('aria-expanded', String(isOpen));
  servicesDropdown.hidden = !isOpen;
  if (isOpen && focusFirstItem) {
    servicesDropdown.querySelector('a')?.focus();
  }
}

function scheduleServicesClose() {
  window.clearTimeout(servicesCloseTimer);
  servicesCloseTimer = window.setTimeout(() => setServicesOpen(false), 150);
}

function setMobileMenuOpen(isOpen) {
  if (!mobileToggle || !mobileMenu) return;
  mobileToggle.setAttribute('aria-expanded', String(isOpen));
  mobileToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  mobileMenu.hidden = !isOpen;
}

function openCircleBloxChat() {
  if (window.LiveChatWidget?.call) {
    window.LiveChatWidget.call('maximize');
    return;
  }
  window.location.href = 'https://circleblox.com/';
}

const SCAN_FAILED_COPY =
  'We couldn\u2019t complete this scan. Check the URL and try again.';

function showScanFailed(error, copy = SCAN_FAILED_COPY) {
  if (error) {
    console.error('Scan failed:', error);
  }
  if (scanFailedCopy) scanFailedCopy.textContent = copy;
  scanFailedPanel?.classList.remove('hidden');
}

function hideScanFailed() {
  scanFailedPanel?.classList.add('hidden');
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

function technologyMarkup(technologies) {
  const data = technologies && typeof technologies === 'object' ? technologies : {};
  const items = Array.isArray(data.technologies) ? data.technologies : [];
  const primary = data.primary || (items[0]?.name) || 'Not detected';
  const detail = items.length
    ? items.slice(0, 5).map((item) => `${item.name}${item.type ? ` (${item.type})` : ''}`).join(', ')
    : data.summary || 'No common CMS or framework markers detected.';

  return `
    <span>Technology detected</span>
    <strong>${escapeHtml(primary)}</strong>
    <p>${escapeHtml(detail)}</p>
  `;
}

function gradeAndRiskFromScore(score) {
  if (score >= 90) return { grade: 'A', complianceRisk: 'minimal' };
  if (score >= 80) return { grade: 'B', complianceRisk: 'low' };
  if (score >= 70) return { grade: 'C', complianceRisk: 'high' };
  if (score >= 60) return { grade: 'D', complianceRisk: 'very-high' };
  return { grade: 'F', complianceRisk: 'severe' };
}

function scoreFromIssues(issues) {
  const totals = { critical: 0, high: 0, moderate: 0, low: 0 };
  issues.forEach((issue) => {
    const severity = String(issue.severity || '').toLowerCase();
    if (totals[severity] !== undefined) totals[severity] += 1;
  });

  const deduction =
    Math.min(totals.critical * 5, 40) +
    Math.min(totals.high * 3, 30) +
    Math.min(totals.moderate * 1.5, 12) +
    Math.min(totals.low * 0.5, 5);
  let score = Math.max(0, Math.min(100, 100 - deduction));
  if (totals.critical > 0) score = Math.min(score, 89);
  return Math.round(score);
}

/** Server sends dashboard; derive a minimal one for older saved payloads. */
function pickDashboard(data) {
  const d = data?.dashboard;
  const issues = data.issues || [];
  const scoredIssues = issues.filter((issue) => !isAaaIssue(issue));
  if (scoredIssues.length > 0 || issues.length > 0) {
    const violationCount = scoredIssues.length;
    const criticalCount = scoredIssues.filter((issue) => String(issue.severity || '').toLowerCase() === 'critical').length;
    const accessibilityScore = scoreFromIssues(scoredIssues);
    const { grade, complianceRisk } = gradeAndRiskFromScore(accessibilityScore);
    return {
      violationCount,
      criticalCount,
      accessibilityScore,
      grade,
      complianceRisk
    };
  }
  if (d && typeof d.violationCount === 'number' && typeof d.accessibilityScore === 'number') {
    return d;
  }
  const s = pickSummary(data);
  const violationCount = d?.violationCount || 0;
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
    const snapshotSrc = data.inlineArtifacts?.snapshotDataUrl || data.snapshotUrl;
    if (snapshotSrc) {
      snapshotImage.src = snapshotSrc;
      snapshotImage.classList.remove('hidden');
      snapshotPlaceholder.classList.add('hidden');
    } else {
      snapshotImage.removeAttribute('src');
      snapshotImage.classList.add('hidden');
      snapshotPlaceholder.classList.remove('hidden');
    }
  }

  const d = pickDashboard(data);
  const findingCount = d.violationCount || 0;
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

function revokeArtifactUrls() {
  activeArtifactUrls.forEach((url) => URL.revokeObjectURL(url));
  activeArtifactUrls = [];
}

function blobUrl(content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  activeArtifactUrls.push(url);
  return url;
}

async function dataUrlToBlobUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  activeArtifactUrls.push(url);
  return url;
}

function siteNameFromScan(data) {
  const source = data?.finalUrl || data?.inputUrl || urlInput?.value || '';
  try {
    return new URL(normalizeUrl(source)).hostname.replace(/^www\./i, '');
  } catch {
    return source || 'your site';
  }
}

function closePdfEmailModal() {
  pdfEmailModal?.classList.add('hidden');
  pdfEmailError?.classList.add('hidden');
  if (pdfEmailError) pdfEmailError.textContent = '';
}

function openPdfEmailModal() {
  if (!pendingPdfDownload || !pdfEmailModal || !pdfEmailInput || !pdfEmailCopy) return;
  const siteName = siteNameFromScan(currentScanData);
  pdfEmailCopy.textContent = `Please enter your email to get your free ADA Compliance results for ${siteName}.`;
  pdfEmailInput.value = '';
  pdfEmailError?.classList.add('hidden');
  pdfEmailModal.classList.remove('hidden');
  pdfEmailInput.focus();
}

function triggerPdfDownload() {
  if (!pendingPdfDownload?.href) return;
  const link = document.createElement('a');
  link.href = pendingPdfDownload.href;
  if (pendingPdfDownload.fileName) link.download = pendingPdfDownload.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function submitPdfLead(email) {
  const response = await fetch(apiUrl('/api/pdf-lead'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      siteName: siteNameFromScan(currentScanData),
      runId: currentScanData?.runId || '',
      reportUrl: currentScanData?.reportUrl || ''
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Could not submit email.');
  }
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

function displayCriterionId(issue) {
  return issue.criterionId || 'Update';
}

function displayComplianceLevel(issue) {
  return issue.complianceLevel || 'AA';
}

function friendlyIssueId(id) {
  return String(id || '')
    .replace(/^WP-STATIC-/i, '')
    .replace(/^AXE-/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Update';
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
  const level = String(displayComplianceLevel(issue)).toUpperCase();
  const severity = String(issue.severity || '').toLowerCase();

  if (LEVEL_FILTERS.includes(level) && !selectedLevels.has(level)) return false;
  if (SEVERITY_FILTERS.includes(severity) && !selectedSeverities.has(severity)) return false;
  return true;
}

function isAaaIssue(issue) {
  return String(displayComplianceLevel(issue)).toUpperCase() === 'AAA';
}

function sortValueForIssue(issue, key) {
  if (key === 'id') return friendlyIssueId(issue.id);
  if (key === 'criterion') return `${displayCriterionId(issue)} ${issue.criterionTitle || ''}`.trim();
  if (key === 'level') return String(displayComplianceLevel(issue)).toUpperCase();
  if (key === 'severity') return String(issue.severity || '').toLowerCase();
  if (key === 'title') return issue.title || '';
  if (key === 'wcagRef') return wcagRefForIssue(issue).label;
  if (key === 'selector') return issue.selector || '';
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
  } else {
    result = tableCollator.compare(String(sortValueForIssue(left, key)), String(sortValueForIssue(right, key)));
  }

  if (result === 0) {
    result = tableCollator.compare(String(left.id || ''), String(right.id || ''));
  }
  return direction === 'asc' ? result : result * -1;
}

function visibleIssues() {
  const filtered = currentIssues.filter((issue) => !isAaaIssue(issue) && issueMatchesFilters(issue));
  if (!issueSort.key) return filtered;
  return [...filtered].sort(compareIssues);
}

function sortedAaaIssues() {
  const aaaIssues = currentIssues.filter(isAaaIssue);
  if (!issueSort.key) return aaaIssues;
  return [...aaaIssues].sort(compareIssues);
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
    row.innerHTML = issueRowHtml(issue);
    issuesBody.appendChild(row);
  });

  if (rows.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="7">No violations match the selected filters.</td>';
    issuesBody.appendChild(row);
  }

  if (issuesFilterSummary) {
    const mainIssueCount = currentIssues.filter((issue) => !isAaaIssue(issue)).length;
    issuesFilterSummary.textContent = `Showing ${rows.length} of ${mainIssueCount} A/AA violation${
      mainIssueCount === 1 ? '' : 's'
    }`;
  }
  renderAaaIssuesTable();
  updateSortControls();
}

function issueRowHtml(issue) {
  return `
    <td title="${escapeHtml(issue.id || '')}">${escapeHtml(friendlyIssueId(issue.id))}</td>
    <td>${escapeHtml(displayCriterionId(issue))}</td>
    <td>${escapeHtml(displayComplianceLevel(issue))}</td>
    <td>${escapeHtml(issue.severity)}</td>
    <td>${escapeHtml(issue.title)}</td>
    <td>${wcagRefCell(issue)}</td>
    <td>${escapeHtml(issue.selector || '-')}</td>
  `;
}

function renderAaaIssuesTable() {
  if (!aaaIssuesBody) return;

  const rows = sortedAaaIssues();
  aaaIssuesBody.innerHTML = '';
  rows.forEach((issue) => {
    const row = document.createElement('tr');
    row.innerHTML = issueRowHtml(issue);
    aaaIssuesBody.appendChild(row);
  });

  if (rows.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="7">No AAA issues found.</td>';
    aaaIssuesBody.appendChild(row);
  }

  if (aaaIssuesSummary) {
    aaaIssuesSummary.textContent = `${rows.length} AAA issue${rows.length === 1 ? '' : 's'} - not included in WCAG 2.2 score`;
  }
}

async function renderResults(data) {
  revokeArtifactUrls();
  currentScanData = data;
  pendingPdfDownload = null;
  document.body.classList.remove('is-scanning');
  document.body.classList.add('scan-active');
  renderDashboard(data);
  const isDemoPayload =
    data.runId === '00000000-0000-4000-8000-00000000demo' ||
    (typeof data.reportUrl === 'string' && data.reportUrl.startsWith('#'));
  if (reportLink) {
    reportLink.href = data.inlineArtifacts?.reportHtml ? blobUrl(data.inlineArtifacts.reportHtml, 'text/html') : data.reportUrl || '#';
    reportLink.title = isDemoPayload ? 'Demo only — no report file is available.' : '';
  }
  if (reportPdfLink) {
    const hasPdf = Boolean(data.reportPdfUrl || data.inlineArtifacts?.reportPdfDataUrl);
    const pdfHref = data.inlineArtifacts?.reportPdfDataUrl
      ? await dataUrlToBlobUrl(data.inlineArtifacts.reportPdfDataUrl)
      : data.reportPdfUrl || '#';
    reportPdfLink.href = pdfHref;
    if (hasPdf) {
      pendingPdfDownload = {
        href: pdfHref,
        fileName: data.inlineArtifacts?.pdfFileName || ''
      };
      reportPdfLink.removeAttribute('download');
    } else {
      reportPdfLink.removeAttribute('download');
    }
    reportPdfLink.title = isDemoPayload || !hasPdf ? 'Demo only — no PDF file is available.' : '';
    reportPdfLink.toggleAttribute('aria-disabled', !hasPdf);
  }
  if (scanSummary) scanSummary.innerHTML = summaryMarkup(pickSummary(data));
  if (technologySummary) technologySummary.innerHTML = technologyMarkup(data.technologies);

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
    const response = await fetch(apiUrl('/api/demo'), {
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
    await renderResults(data);
  } catch (error) {
    document.body.classList.remove('is-scanning');
    window.clearInterval(timer);
    window.clearInterval(progressTimer);
    results.classList.add('hidden');
    results.classList.remove('scanning');
    renderStatuses('error');
    showScanFailed(error);
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
  hideScanFailed();
  results.classList.add('hidden');
  if (demoDataButton) demoDataButton.disabled = true;
  if (submitButton) submitButton.disabled = true;

  try {
    const data = await loadMockScanData();
    renderStatuses('done');
    await renderResults(data);
  } catch (err) {
    renderStatuses('error');
    showScanFailed(err, 'Demo data could not be loaded. Try again in a moment.');
  } finally {
    if (demoDataButton) demoDataButton.disabled = false;
    if (submitButton) submitButton.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const normalizedUrl = normalizeUrl(urlInput.value);
  if (!normalizedUrl) return;
  await startScanFromUrl(normalizedUrl);
});

async function startScanFromUrl(normalizedUrl) {
  hideScanFailed();
  results.classList.add('hidden');
  submitButton.disabled = true;
  if (demoDataButton) demoDataButton.disabled = true;
  submitButton.textContent = 'Scanning…';
  await runDemo(normalizedUrl);
  if (demoDataButton) demoDataButton.disabled = false;
}

function parseScanQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const rawSite = (params.get('url') || params.get('site') || '').trim();
  const autostartValue = String(params.get('scan') || params.get('autostart') || params.get('auto') || '')
    .trim()
    .toLowerCase();
  const shouldAutostart = ['1', 'true', 'yes', 'scan'].includes(autostartValue);
  return {
    rawSite,
    normalizedUrl: normalizeUrl(rawSite),
    shouldAutostart
  };
}

function applyScanQueryParams() {
  if (!urlInput) return;
  const { rawSite, normalizedUrl, shouldAutostart } = parseScanQueryParams();
  if (!rawSite || !normalizedUrl) return;

  urlInput.value = rawSite;
  if (shouldAutostart) {
    void startScanFromUrl(normalizedUrl);
  }
}

applyScanQueryParams();

demoDataButton?.addEventListener('click', () => {
  void runDataDemo();
});

servicesMenu?.addEventListener('mouseenter', () => {
  window.clearTimeout(servicesCloseTimer);
  setServicesOpen(true);
});

servicesMenu?.addEventListener('mouseleave', scheduleServicesClose);

servicesDropdown?.addEventListener('mouseenter', () => {
  window.clearTimeout(servicesCloseTimer);
  setServicesOpen(true);
});

servicesDropdown?.addEventListener('mouseleave', () => setServicesOpen(false));

servicesButton?.addEventListener('click', () => {
  const isOpen = servicesButton.getAttribute('aria-expanded') === 'true';
  setServicesOpen(!isOpen, !isOpen);
});

servicesButton?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const isOpen = servicesButton.getAttribute('aria-expanded') === 'true';
    setServicesOpen(!isOpen, !isOpen);
  } else if (event.key === 'Escape') {
    setServicesOpen(false);
    servicesButton.focus();
  }
});

servicesDropdown?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setServicesOpen(false);
    servicesButton?.focus();
  }
});

mobileToggle?.addEventListener('click', () => {
  const isOpen = mobileToggle.getAttribute('aria-expanded') === 'true';
  setMobileMenuOpen(!isOpen);
});

mobileMenu?.querySelectorAll('a, button').forEach((item) => {
  item.addEventListener('click', () => setMobileMenuOpen(false));
});

chatButtons.forEach((button) => {
  button.addEventListener('click', openCircleBloxChat);
});

reportPdfLink?.addEventListener('click', (event) => {
  if (!pendingPdfDownload) return;
  event.preventDefault();
  openPdfEmailModal();
});

pdfEmailModal?.querySelectorAll('[data-modal-close]').forEach((button) => {
  button.addEventListener('click', closePdfEmailModal);
});

pdfEmailForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pdfEmailInput) return;
  const email = pdfEmailInput.value.trim();
  if (!email) return;
  const submitButtonEl = pdfEmailForm.querySelector('button[type="submit"]');
  if (submitButtonEl) submitButtonEl.disabled = true;
  try {
    await submitPdfLead(email);
    closePdfEmailModal();
    triggerPdfDownload();
  } catch (error) {
    if (pdfEmailError) {
      pdfEmailError.textContent = error instanceof Error ? error.message : 'Could not submit email.';
      pdfEmailError.classList.remove('hidden');
    }
  } finally {
    if (submitButtonEl) submitButtonEl.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !pdfEmailModal?.classList.contains('hidden')) {
    closePdfEmailModal();
  }
  if (event.key === 'Escape') {
    setMobileMenuOpen(false);
  }
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

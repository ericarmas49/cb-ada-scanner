const steps = [
  { id: 'queued', label: 'Queued' },
  { id: 'scanning_before', label: 'Scanning Before' },
  { id: 'remediating', label: 'Remediating Snapshot' },
  { id: 'scanning_after', label: 'Scanning After' },
  { id: 'publishing', label: 'Publishing Assets' },
  { id: 'done', label: 'Done' }
];

const form = document.querySelector('#demo-form');
const urlInput = document.querySelector('#url');
const submitButton = document.querySelector('#submit-button');
const statusGrid = document.querySelector('#status-grid');
const errorBox = document.querySelector('#error-box');
const results = document.querySelector('#results');
const previewLink = document.querySelector('#preview-link');
const beforeLink = document.querySelector('#before-link');
const afterLink = document.querySelector('#after-link');
const beforeSummary = document.querySelector('#before-summary');
const afterSummary = document.querySelector('#after-summary');
const issuesBody = document.querySelector('#issues-body');
const remediationLog = document.querySelector('#remediation-log');
const warningsList = document.querySelector('#warnings-list');

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
    if (activeState === 'error' && step.id === 'publishing') card.classList.add('error');
    card.innerHTML = `<strong>${step.label}</strong><p>${isActive ? 'In progress' : isComplete ? 'Complete' : 'Pending'}</p>`;
    statusGrid.appendChild(card);
  });
}

function summaryMarkup(title, summary) {
  return `
    <span>${title}</span>
    <strong>Critical ${summary.critical} | High ${summary.high}</strong>
    <p>Moderate ${summary.moderate} | Low ${summary.low}</p>
  `;
}

function linkify(url) {
  return url ? `<a href="${url}" target="_blank" rel="noreferrer">Reference</a>` : '-';
}

function boolText(value) {
  return value ? 'Yes' : 'No';
}

function renderResults(data) {
  previewLink.href = data.previewUrl;
  beforeLink.href = data.beforeReportUrl;
  afterLink.href = data.afterReportUrl;
  beforeSummary.innerHTML = summaryMarkup('Before', data.summaryBefore);
  afterSummary.innerHTML = summaryMarkup('After', data.summaryAfter);

  issuesBody.innerHTML = '';
  data.issues.forEach((issue) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${issue.id}</td>
      <td>${issue.severity}</td>
      <td>${issue.title}</td>
      <td>${linkify(issue.wcagReference)}</td>
      <td>${issue.selector || '-'}</td>
      <td>${boolText(issue.fixed)}</td>
      <td>${boolText(issue.aiGenerated)}</td>
      <td>${issue.confidence}</td>
      <td>${boolText(issue.manual_review_required)}</td>
    `;
    issuesBody.appendChild(row);
  });

  remediationLog.innerHTML = '';
  (data.remediationLog || []).forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = `${entry.action} (${entry.confidence}, ${entry.aiGenerated ? 'AI-generated' : 'deterministic'})`;
    remediationLog.appendChild(item);
  });
  if (!data.remediationLog?.length) {
    remediationLog.innerHTML = '<li>No automatic changes were applied.</li>';
  }

  warningsList.innerHTML = '';
  (data.warnings || []).forEach((warning) => {
    const item = document.createElement('li');
    item.textContent = warning;
    warningsList.appendChild(item);
  });
  if (!data.warnings?.length) {
    warningsList.innerHTML = '<li>No warnings were generated.</li>';
  }

  results.classList.remove('hidden');
}

async function runDemo(url) {
  const sequence = ['queued', 'scanning_before', 'remediating', 'scanning_after', 'publishing'];
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
      throw new Error(data.error || 'Demo failed');
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
    submitButton.textContent = 'Run Demo';
  }
}

renderStatuses('queued');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.classList.add('hidden');
  results.classList.add('hidden');
  const normalizedUrl = normalizeUrl(urlInput.value);
  if (!normalizedUrl) return;
  submitButton.disabled = true;
  submitButton.textContent = 'Running Demo...';
  await runDemo(normalizedUrl);
});

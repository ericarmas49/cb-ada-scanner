const form = document.querySelector('[data-scan-form]');
const urlInput = document.querySelector('[data-url-input]');
const statusBox = document.querySelector('[data-status]');
const resultPanel = document.querySelector('[data-result-panel]');
const violationCount = document.querySelector('[data-violation-count]');
const scoreValue = document.querySelector('[data-score-value]');
const riskValue = document.querySelector('[data-risk-value]');
const htmlReport = document.querySelector('[data-html-report]');
const pdfReport = document.querySelector('[data-pdf-report]');
const jsonReport = document.querySelector('[data-json-report]');
const issueList = document.querySelector('[data-issue-list]');
const sampleButton = document.querySelector('[data-sample-button]');

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function setStatus(message, tone = '') {
  if (!statusBox) return;
  statusBox.textContent = message;
  if (tone) statusBox.dataset.tone = tone;
  else statusBox.removeAttribute('data-tone');
}

function riskLabel(risk) {
  if (risk === 'high') return 'High risk';
  if (risk === 'medium') return 'Medium risk';
  return 'Lower risk';
}

function setLink(link, url) {
  if (!link) return;
  link.href = url || '#';
  link.toggleAttribute('aria-disabled', !url);
}

function renderIssues(issues) {
  if (!issueList) return;
  issueList.innerHTML = '';
  const topIssues = (issues || []).slice(0, 3);
  for (const issue of topIssues) {
    const card = document.createElement('article');
    card.className = 'issue-card';
    card.innerHTML = `
      <span class="severity">${issue.severity || 'review'}</span>
      <strong>${issue.title || 'Accessibility finding'}</strong>
      <p>${issue.criterionId ? `WCAG ${issue.criterionId} · ` : ''}${issue.criterionTitle || 'Review recommended'}</p>
    `;
    issueList.appendChild(card);
  }
}

function renderResults(data) {
  const issues = data.issues || [];
  const dashboard = data.dashboard || {};
  if (violationCount) violationCount.textContent = String(issues.length || dashboard.violationCount || 0);
  if (scoreValue) scoreValue.textContent = `${dashboard.accessibilityScore ?? 0}%`;
  if (riskValue) riskValue.textContent = riskLabel(dashboard.complianceRisk);
  setLink(htmlReport, data.reportUrl);
  setLink(pdfReport, data.reportPdfUrl);
  setLink(jsonReport, data.reportJsonUrl);
  renderIssues(issues);
  resultPanel?.classList.add('is-visible');
}

async function runScan(url) {
  setStatus('Scanning page. This may take a moment.');
  resultPanel?.classList.remove('is-visible');
  const response = await fetch('/api/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Scan failed');
  }
  renderResults(data);
  setStatus('Scan complete. Review the summary and downloadable reports below.', 'success');
}

async function loadSample() {
  setStatus('Loading sample scan data.');
  const response = await fetch('/mock-scan-data.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Sample data failed to load');
  const data = await response.json();
  renderResults(data);
  setStatus('Sample data loaded. No live scan was run.', 'success');
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const url = normalizeUrl(urlInput?.value || '');
  if (!url) {
    setStatus('Enter a valid URL to scan.', 'error');
    urlInput?.focus();
    return;
  }
  button.disabled = true;
  sampleButton?.setAttribute('disabled', '');
  try {
    await runScan(url);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Scan failed', 'error');
  } finally {
    button.disabled = false;
    sampleButton?.removeAttribute('disabled');
  }
});

sampleButton?.addEventListener('click', async () => {
  sampleButton.disabled = true;
  try {
    await loadSample();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Sample data failed', 'error');
  } finally {
    sampleButton.disabled = false;
  }
});

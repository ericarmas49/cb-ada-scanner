const form = document.querySelector('#theme-scan-form');
const fileInput = document.querySelector('#theme-zip');
const submitButton = document.querySelector('#theme-submit-button');
const statusBox = document.querySelector('#theme-status');
const results = document.querySelector('#theme-results');
const meta = document.querySelector('#theme-meta');
const violationCount = document.querySelector('#theme-violation-count');
const score = document.querySelector('#theme-score');
const risk = document.querySelector('#theme-risk');
const reportLink = document.querySelector('#theme-report-link');
const pdfLink = document.querySelector('#theme-pdf-link');
const jsonLink = document.querySelector('#theme-json-link');
const remediationLink = document.querySelector('#theme-remediation-link');
const fixedLink = document.querySelector('#theme-fixed-link');
const summaryBox = document.querySelector('#theme-summary');
const remediationBox = document.querySelector('#theme-remediation');
const remediationDetailBox = document.querySelector('#theme-remediation-detail');
const reviewCountsBox = document.querySelector('#theme-review-counts');
const learningQueueBox = document.querySelector('#theme-learning-queue');
const issuesBody = document.querySelector('#theme-issues-body');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function riskLabel(value) {
  if (value === 'minimal') return 'Minimal';
  if (value === 'low') return 'Low';
  if (value === 'high') return 'High';
  if (value === 'very-high') return 'Very High';
  if (value === 'severe') return 'Severe';
  return 'Not scanned';
}

function fixTypeLabel(value) {
  if (value === 'safe-auto-fix') return 'Safe auto-fix';
  if (value === 'conditional-auto-fix') return 'Conditional auto-fix';
  if (value === 'manual-review') return 'Manual review';
  return 'Suggested fix';
}

function normalizeSummary(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    critical: Number(s.critical) || 0,
    high: Number(s.high) || 0,
    moderate: Number(s.moderate) || 0,
    low: Number(s.low) || 0
  };
}

function renderSummary(summary) {
  const s = normalizeSummary(summary);
  summaryBox.innerHTML = `
    <span>Scan summary</span>
    <strong>Critical ${s.critical} | High ${s.high}</strong>
    <p>Moderate ${s.moderate} | Low ${s.low}</p>
  `;
}

function renderFixability(fixability) {
  if (!fixability) return '';
  return `
    <p>
      Safe auto-fix ${Number(fixability.safeAutoFix) || 0} |
      Conditional auto-fix ${Number(fixability.conditionalAutoFix) || 0} |
      Suggested fix ${Number(fixability.suggestedFix) || 0} |
      Manual review ${Number(fixability.manualReview) || 0}
    </p>
  `;
}

function renderRemediation(remediation) {
  const appliedCount = Number(remediation?.appliedFixCount) || 0;
  const postFix = remediation?.afterScan || remediation?.postFixScan;
  if (!appliedCount) {
    remediationBox.innerHTML = `
      <span>Remediation</span>
      <strong>No safe auto-fixes applied</strong>
      <p>The scanner only auto-fixes mechanical changes it can make without changing content meaning.</p>
    `;
    remediationDetailBox.innerHTML = `
      <span>Validation</span>
      <strong>No fixed ZIP to validate</strong>
      <p>Suggested fixes and manual review items remain available in the findings table.</p>
    `;
    return;
  }

  remediationBox.innerHTML = `
    <span>Remediation</span>
    <strong>${appliedCount} safe ${appliedCount === 1 ? 'fix was' : 'fixes were'} applied</strong>
    <p>
      Fixed ZIP generated${postFix ? ` | Issues reduced by ${Number(remediation.issueDelta) || 0} | Score change ${Number(remediation.scoreDelta) || 0}` : ''}
    </p>
  `;

  const validation = remediation?.validation || {};
  const originalValidation = remediation?.originalValidation || {};
  const originalPhpSyntax = originalValidation.phpSyntax || {};
  const phpSyntax = validation.phpSyntax || {};
  const changedFiles = remediation?.changedFiles || [];
  const appliedFixes = remediation?.appliedFixes || [];
  remediationDetailBox.innerHTML = `
    <span>Validation</span>
    <strong>ZIP ${escapeHtml(validation.status || 'unknown')} | PHP ${escapeHtml(phpSyntax.status || 'skipped')}</strong>
    <p>Original PHP: ${escapeHtml(originalPhpSyntax.status || 'skipped')} | Fixed PHP: ${escapeHtml(phpSyntax.status || 'skipped')}</p>
    <p>${escapeHtml(validation.message || '')}</p>
    <p>${escapeHtml(phpSyntax.message || '')}${phpSyntax.filesChecked ? ` ${Number(phpSyntax.filesChecked)} PHP files checked.` : ''}</p>
    <p>Changed files: ${changedFiles.length ? changedFiles.map((file) => `<code>${escapeHtml(file)}</code>`).join(', ') : 'None'}</p>
    <p>Applied fixes: ${appliedFixes.length ? appliedFixes.map((fix) => `${escapeHtml(fix.ruleId)} (${Number(fix.count) || 0})`).join(', ') : 'None'}</p>
  `;
}

function renderReviewGroupList(groups) {
  if (!groups?.length) return '<p>No outstanding grouped rules in this bucket.</p>';
  return `
    <ul class="review-list">
      ${groups.slice(0, 8).map((group) => `
        <li>
          <strong>${escapeHtml(group.ruleId)}</strong>
          <span>${Number(group.count) || 0} issue${Number(group.count) === 1 ? '' : 's'} | ${escapeHtml(fixTypeLabel(group.fixType))}</span>
          <p>${escapeHtml(group.title || '')}</p>
          ${group.files?.length ? `<p>Examples: ${group.files.slice(0, 3).map((file) => `<code>${escapeHtml(file)}</code>`).join(', ')}</p>` : ''}
          ${(group.examples || []).slice(0, 2).map((example, index) => `
            <details class="review-packet">
              <summary>Review packet ${index + 1}: ${escapeHtml(example.file || 'unknown file')}${example.line ? `:${Number(example.line)}` : ''}</summary>
              ${example.snippet ? `<pre><code>${escapeHtml(example.snippet)}</code></pre>` : ''}
              <p><strong>Question:</strong> ${escapeHtml(example.reviewQuestion || 'What is the correct remediation for this pattern?')}</p>
              <textarea readonly rows="14">${escapeHtml(example.reviewPrompt || '')}</textarea>
            </details>
          `).join('')}
        </li>
      `).join('')}
    </ul>
  `;
}

function fallbackReviewFromIssues(issues) {
  const groups = new Map();
  for (const issue of issues || []) {
    const id = issue.id || 'UNKNOWN';
    if (!groups.has(id)) {
      groups.set(id, {
        ruleId: id,
        title: issue.title || id,
        fixType: issue.fixType || 'suggested-fix',
        count: 0,
        files: [],
        examples: []
      });
    }
    const group = groups.get(id);
    group.count += 1;
    const file = issue.template || issue.page || '';
    if (file && !group.files.includes(file)) group.files.push(file);
    if (group.examples.length < 3) {
      group.examples.push({
        file,
        line: issue.line,
        snippet: issue.snippet || '',
        reviewQuestion: 'What is the correct remediation for this exact code pattern, and can this pattern be auto-fixed in the future?',
        reviewPrompt: [
          `Rule: ${id}`,
          `Issue: ${issue.title || ''}`,
          `File: ${file}`,
          `Line: ${issue.line || ''}`,
          '',
          'Problem code:',
          issue.snippet || '[snippet unavailable]',
          '',
          'Current scanner recommendation:',
          issue.remediation || '[recommendation unavailable]',
          '',
          'Reviewer answer:',
          '[fill in]',
          '',
          'Preferred fixed code:',
          '[paste corrected code]',
          '',
          'Can this be auto-fixed in the future?',
          '[Always / Sometimes / Never]'
        ].join('\n')
      });
    }
  }

  const learningQueue = Array.from(groups.values()).sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId));
  const needsInput = (issues || []).filter((issue) => issue.manual_review_required || issue.fixType === 'manual-review').length;
  const suggestedFix = (issues || []).filter((issue) => issue.fixType === 'suggested-fix').length;
  return {
    counts: {
      allIssues: (issues || []).length,
      autoFixed: 0,
      outstanding: (issues || []).length,
      needsInput,
      suggestedFix,
      skippedUnsafe: 0,
      unknownPattern: 0
    },
    learningQueue
  };
}

function renderRemediationReview(review, issues) {
  const resolvedReview = review?.counts ? review : fallbackReviewFromIssues(issues);
  const counts = resolvedReview.counts || {};
  reviewCountsBox.innerHTML = `
    <article class="metric-card">
      <span>All issues found</span>
      <strong>${Number(counts.allIssues) || 0}</strong>
    </article>
    <article class="metric-card">
      <span>Auto-fixed</span>
      <strong>${Number(counts.autoFixed) || 0}</strong>
    </article>
    <article class="metric-card">
      <span>Still outstanding</span>
      <strong>${Number(counts.outstanding) || 0}</strong>
    </article>
    <article class="metric-card">
      <span>Needs your input</span>
      <strong>${Number(counts.needsInput) || 0}</strong>
    </article>
  `;

  learningQueueBox.innerHTML = `
    <span>Learning queue</span>
    <strong>${Number(counts.needsInput) || 0} need input | ${Number(counts.suggestedFix) || 0} suggested | ${Number(counts.skippedUnsafe) || 0} skipped unsafe</strong>
    <p>Use this list to decide which unresolved rule patterns need examples or approved remediation guidance next.</p>
    ${renderReviewGroupList(resolvedReview.learningQueue || [])}
  `;
}

function renderIssues(issues) {
  issuesBody.innerHTML = '';
  for (const issue of issues || []) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(issue.severity)}</td>
      <td>${escapeHtml(issue.criterionId || 'Unmapped')}</td>
      <td>${escapeHtml(issue.title)}</td>
      <td><code>${escapeHtml(issue.template || issue.page || '')}</code></td>
      <td>${escapeHtml(issue.line || '')}</td>
      <td>${escapeHtml(fixTypeLabel(issue.fixType))}</td>
      <td>${issue.manual_review_required ? 'Yes' : 'No'}</td>
    `;
    issuesBody.appendChild(row);
  }
}

function setLink(link, url) {
  link.href = url || '#';
  link.toggleAttribute('aria-disabled', !url);
}

function setStatus(message, tone = '') {
  statusBox.textContent = message;
  statusBox.dataset.tone = tone;
}

function renderResults(data) {
  const issues = data.issues || [];
  const dashboard = data.dashboard || {};
  meta.textContent = `${data.themeName || 'Theme'} | ${data.filesScanned || 0} files scanned`;
  violationCount.textContent = String(issues.length || dashboard.violationCount || 0);
  score.textContent = `${dashboard.accessibilityScore ?? 0}%`;
  risk.textContent = riskLabel(dashboard.complianceRisk);
  setLink(reportLink, data.reportUrl);
  setLink(pdfLink, data.reportPdfUrl);
  setLink(jsonLink, data.reportJsonUrl);
  setLink(remediationLink, data.remediationReportUrl);
  setLink(fixedLink, data.fixedThemeUrl);
  renderSummary(data.summary);
  if (summaryBox) summaryBox.insertAdjacentHTML('beforeend', renderFixability(data.fixability));
  renderRemediation(data.remediation);
  renderRemediationReview(data.remediation?.review, issues);
  renderIssues(issues);
  results.classList.remove('hidden');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus('Choose a WordPress theme ZIP before scanning.', 'error');
    fileInput.focus();
    return;
  }

  results.classList.add('hidden');
  submitButton.disabled = true;
  submitButton.textContent = 'Scanning...';
  setStatus('Uploading and scanning theme files. PHP is not executed.', 'scanning');

  try {
    const body = new FormData();
    body.append('themeZip', file);
    const response = await fetch('/api/wp-theme-scan', {
      method: 'POST',
      body
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Theme scan failed');
    }
    renderResults(data);
    setStatus('Theme scan complete. Review the report and findings below.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Theme scan failed', 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Scan theme';
  }
});

'use strict';

function mapImpactToSeverity(impact) {
  switch (impact) {
    case 'critical':
      return 'critical';
    case 'serious':
      return 'serious';
    case 'moderate':
      return 'moderate';
    case 'minor':
      return 'minor';
    default:
      return 'moderate';
  }
}

function normalizeAxeFindings(results) {
  if (!results || !results.violations) return [];
  const findings = [];

  for (const violation of results.violations) {
    const severity = mapImpactToSeverity(violation.impact);
    for (const node of violation.nodes || []) {
      findings.push({
        id: `AXE-${violation.id}`,
        title: violation.help || violation.description || violation.id,
        standard: 'WCAG 2.2',
        level: 'AA',
        severity,
        confidence: 'high',
        source: 'axe-core',
        manual_review_required: false,
        selector: (node.target || [])[0] || '',
        node: {
          htmlSnippet: node.html || '',
          boundingBox: { x: 0, y: 0, w: 0, h: 0 }
        },
        why: violation.description || 'Automated accessibility violation detected by axe-core.',
        fix: violation.help || violation.description || '',
        evidence: {
          screenshot: null,
          extra: {
            helpUrl: violation.helpUrl || null,
            impact: violation.impact,
            tags: violation.tags || []
          }
        },
        occurrences: 1
      });
    }
  }

  return findings;
}

module.exports = { normalizeAxeFindings };

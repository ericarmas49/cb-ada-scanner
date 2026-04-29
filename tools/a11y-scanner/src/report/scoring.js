'use strict';

function scoreReport(findings) {
  const totals = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const finding of findings) {
    if (totals[finding.severity] !== undefined) {
      totals[finding.severity] += 1;
    }
  }

  let score = 100;
  score -= totals.critical * 25;
  score -= totals.serious * 15;
  score -= totals.moderate * 8;
  score -= totals.minor * 3;
  score = Math.max(0, Math.min(100, score));

  const topRules = findings
    .reduce((acc, f) => {
      acc[f.id] = (acc[f.id] || 0) + 1;
      return acc;
    }, {});

  const topRulesSorted = Object.entries(topRules)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));

  return {
    totals,
    topRules: topRulesSorted,
    score,
    notes: [
      'Single-page automated scan. Some criteria require manual review.'
    ]
  };
}

module.exports = { scoreReport };

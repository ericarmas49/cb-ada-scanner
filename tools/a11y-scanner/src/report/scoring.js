'use strict';

const DEDUCTION_RULES = {
  critical: { weight: 5, cap: 40 },
  serious: { weight: 3, cap: 30 },
  moderate: { weight: 1.5, cap: 12 },
  minor: { weight: 0.5, cap: 5 }
};

function riskFromScore(score) {
  if (score >= 90) return { grade: 'A', risk: 'minimal' };
  if (score >= 80) return { grade: 'B', risk: 'low' };
  if (score >= 70) return { grade: 'C', risk: 'high' };
  if (score >= 60) return { grade: 'D', risk: 'very-high' };
  return { grade: 'F', risk: 'severe' };
}

function calculateScore(totals) {
  let deduction = 0;
  for (const [severity, rule] of Object.entries(DEDUCTION_RULES)) {
    deduction += Math.min((totals[severity] || 0) * rule.weight, rule.cap);
  }

  let score = Math.max(0, Math.min(100, 100 - deduction));
  if ((totals.critical || 0) > 0) {
    score = Math.min(score, 89);
  }
  return Math.round(score);
}

function scoreReport(findings) {
  const totals = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const finding of findings) {
    if (totals[finding.severity] !== undefined) {
      totals[finding.severity] += 1;
    }
  }

  const score = calculateScore(totals);
  const { grade, risk } = riskFromScore(score);

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
    grade,
    risk,
    notes: [
      'Single-page automated scan. Some criteria require manual review.'
    ]
  };
}

module.exports = { calculateScore, riskFromScore, scoreReport };

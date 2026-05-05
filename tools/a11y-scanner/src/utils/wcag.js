'use strict';

const { WCAG_21_BASELINE_CRITERIA, WCAG_CRITERIA } = require('../data/wcag-checklist');

const criterionById = new Map(WCAG_CRITERIA.map((criterion) => [criterion.id, criterion]));
const aliasToCriterionId = new Map();

for (const criterion of WCAG_CRITERIA) {
  for (const alias of criterion.aliases || []) {
    aliasToCriterionId.set(alias, criterion.id);
  }
  for (const sourceRuleId of criterion.sourceRuleIds || []) {
    aliasToCriterionId.set(`AXE-${sourceRuleId}`, criterion.id);
  }
}

function getCriterionById(id) {
  return criterionById.get(id) || null;
}

function getCriteriaByLevel(level) {
  return WCAG_21_BASELINE_CRITERIA.filter((criterion) => criterion.level === level);
}

function getCriteriaByPrinciple(principle) {
  return WCAG_CRITERIA.filter((criterion) => criterion.principle === principle);
}

function getCriteriaForTargetLevel(level) {
  if (level === 'A') {
    return WCAG_21_BASELINE_CRITERIA.filter((criterion) => criterion.level === 'A');
  }

  if (level === 'AA') {
    return WCAG_21_BASELINE_CRITERIA.filter((criterion) => criterion.level === 'A' || criterion.level === 'AA');
  }

  return [];
}

function parseWcagTag(tag) {
  const match = /^wcag(\d)(\d)(\d+)$/.exec(String(tag || ''));
  if (!match) {
    return null;
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function extractCriterionIdsFromIssue(issue) {
  const ids = new Set();
  const tags = issue?.evidence?.extra?.tags || [];
  for (const tag of tags) {
    const criterionId = parseWcagTag(tag);
    if (criterionId && criterionById.has(criterionId)) {
      ids.add(criterionId);
    }
  }

  const aliasMatch = aliasToCriterionId.get(issue.id);
  if (aliasMatch) {
    ids.add(aliasMatch);
  }

  return Array.from(ids);
}

function mapIssueToCriterion(issue) {
  const criterionIds = extractCriterionIdsFromIssue(issue);
  if (!criterionIds.length) {
    return null;
  }

  return criterionIds
    .map((criterionId) => getCriterionById(criterionId))
    .filter(Boolean);
}

function enrichIssueWithCriteria(issue) {
  const criteria = mapIssueToCriterion(issue);
  if (!criteria || !criteria.length) {
    return {
      ...issue,
      wcagCriteria: [],
      automation: issue.manual_review_required ? 'manual' : 'automated'
    };
  }

  const primaryCriterion = criteria[0];
  return {
    ...issue,
    criterionId: primaryCriterion.id,
    criterionTitle: primaryCriterion.title,
    complianceLevel: primaryCriterion.level,
    principle: primaryCriterion.principle,
    automation: primaryCriterion.automation,
    category: primaryCriterion.category,
    wcagVersion: primaryCriterion.version,
    remediation: issue.fix || primaryCriterion.remediation,
    suggestedSeverity: primaryCriterion.severity,
    description: issue.why || primaryCriterion.description,
    wcagCriteria: criteria.map((criterion) => ({
      id: criterion.id,
      title: criterion.title,
      level: criterion.level,
      principle: criterion.principle,
      version: criterion.version,
      automation: criterion.automation,
      category: criterion.category,
      remediation: criterion.remediation,
      suggestedSeverity: criterion.severity
    }))
  };
}

module.exports = {
  getCriterionById,
  getCriteriaByLevel,
  getCriteriaByPrinciple,
  getCriteriaForTargetLevel,
  mapIssueToCriterion,
  enrichIssueWithCriteria
};

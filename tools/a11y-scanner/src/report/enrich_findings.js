'use strict';

const { enrichIssueWithCriteria } = require('../utils/wcag');

function enrichFindings(findings, context = {}) {
  return (findings || []).map((finding) => {
    const enriched = enrichIssueWithCriteria(finding);
    return {
      ...enriched,
      reportContext: {
        page: context.pageUrl || null,
        template: context.template || null,
        component: finding.selector || null,
        instanceCount: finding.occurrences || 1
      }
    };
  });
}

module.exports = { enrichFindings };

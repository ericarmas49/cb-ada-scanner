'use strict';

const { normalizeSelector, normalizeMessage } = require('../utils/selectors');

function dedupeFindings(findings) {
  const map = new Map();
  for (const finding of findings) {
    const key = [
      finding.id,
      normalizeSelector(finding.selector),
      normalizeMessage(finding.title)
    ].join('::');

    if (!map.has(key)) {
      map.set(key, { ...finding, occurrences: finding.occurrences || 1 });
    } else {
      const existing = map.get(key);
      existing.occurrences += 1;
      if (existing.evidence && finding.evidence && finding.evidence.screenshot && !existing.evidence.screenshot) {
        existing.evidence.screenshot = finding.evidence.screenshot;
      }
      map.set(key, existing);
    }
  }
  return Array.from(map.values());
}

module.exports = { dedupeFindings };

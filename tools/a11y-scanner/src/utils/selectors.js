'use strict';

function normalizeSelector(selector) {
  return String(selector || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeMessage(message) {
  return String(message || '')
    .trim()
    .replace(/\s+/g, ' ');
}

module.exports = {
  normalizeSelector,
  normalizeMessage
};

'use strict';

const path = require('path');
const slugify = require('../utils/slugify');

async function runTargetSizeCheck(page, artifactsDir, outputDir) {
  const targets = await page.evaluate(() => {
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
      return true;
    }

    function isInlineTextLink(el) {
      if (el.tagName.toLowerCase() !== 'a') return false;
      const style = window.getComputedStyle(el);
      const text = (el.innerText || '').trim();
      return style.display === 'inline' && text.length > 0;
    }

    const selectorList = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[tabindex]:not([tabindex="-1"])'
    ];

    const nodes = Array.from(document.querySelectorAll(selectorList.join(',')));
    return nodes
      .filter((el) => isVisible(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          selector: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}`,
          text: (el.innerText || '').trim().slice(0, 120),
          width: rect.width,
          height: rect.height,
          boundingBox: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
          inlineTextLink: isInlineTextLink(el)
        };
      });
  });

  const findings = [];

  for (const target of targets) {
    if (target.inlineTextLink) continue;
    if (target.width >= 24 && target.height >= 24) continue;

    const clip = await safeClip(page, target.boundingBox, 10);
    const shotName = `target-${slugify(target.selector)}-${Math.round(target.width)}x${Math.round(target.height)}.png`;
    const shotPath = path.join(artifactsDir, shotName);
    await page.screenshot({ path: shotPath, clip });
    const shotRel = path.relative(outputDir, shotPath);

    findings.push({
      id: 'A11Y-TARGET-SIZE-MIN',
      title: 'Clickable target is smaller than 24x24px',
      standard: 'WCAG 2.2',
      level: 'AA',
      severity: 'moderate',
      confidence: 'high',
      source: 'custom-runtime',
      manual_review_required: false,
      selector: target.selector,
      node: {
        htmlSnippet: target.text,
        boundingBox: target.boundingBox
      },
      why: 'Targets smaller than 24x24px can be difficult for users with limited dexterity or who are using touch input.',
      fix: 'Increase padding or spacing to provide a 24x24px minimum target size.',
      evidence: {
        screenshot: shotRel,
        extra: {
          width: target.width,
          height: target.height
        }
      },
      occurrences: 1
    });
  }

  return findings;
}

async function safeClip(page, boundingBox, padding) {
  const viewport = page.viewportSize();
  const x = Math.max(0, boundingBox.x - padding);
  const y = Math.max(0, boundingBox.y - padding);
  const width = Math.min(viewport.width - x, boundingBox.w + padding * 2);
  const height = Math.min(viewport.height - y, boundingBox.h + padding * 2);
  return {
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

module.exports = { runTargetSizeCheck };

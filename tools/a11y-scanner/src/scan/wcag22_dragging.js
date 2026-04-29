'use strict';

async function runDraggingCheck(page) {
  const dragInfo = await page.evaluate(() => {
    function hasAltControls(container) {
      if (!container) return false;
      const buttons = container.querySelectorAll('button, [role="button"], a');
      return Array.from(buttons).some((btn) => {
        const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
        return label.includes('next') || label.includes('prev') || label.includes('previous') || label.includes('up') || label.includes('down');
      });
    }

    const draggable = Array.from(document.querySelectorAll('[draggable="true"]'));
    const sliders = Array.from(document.querySelectorAll('input[type="range"], [role="slider"]'));
    const carouselLike = Array.from(document.querySelectorAll('[class*="carousel" i], [class*="slider" i], [class*="drag" i]'));

    const items = [];
    draggable.forEach((el) => items.push({ type: 'draggable', selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(), hasAlt: hasAltControls(el.parentElement) }));
    sliders.forEach((el) => items.push({ type: 'slider', selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(), hasAlt: hasAltControls(el.parentElement) }));
    carouselLike.forEach((el) => items.push({ type: 'carousel', selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(), hasAlt: hasAltControls(el) || hasAltControls(el.parentElement) }));

    return items;
  });

  const findings = [];
  for (const item of dragInfo) {
    if (item.hasAlt) continue;
    findings.push({
      id: 'A11Y-DRAGGING-MOVEMENTS',
      title: 'Potential dragging-only interaction',
      standard: 'WCAG 2.2',
      level: 'AA',
      severity: 'moderate',
      confidence: 'low',
      source: 'custom-runtime',
      manual_review_required: true,
      selector: item.selector,
      node: {
        htmlSnippet: '',
        boundingBox: { x: 0, y: 0, w: 0, h: 0 }
      },
      why: 'Dragging interactions should have a simple, non-drag alternative. This element may require dragging.',
      fix: 'Provide buttons or other non-drag controls to complete the same action.',
      evidence: {
        screenshot: null,
        extra: {
          type: item.type
        }
      },
      occurrences: 1
    });
  }

  return findings;
}

module.exports = { runDraggingCheck };

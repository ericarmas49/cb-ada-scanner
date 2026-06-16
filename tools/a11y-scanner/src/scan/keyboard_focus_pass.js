'use strict';

const path = require('path');
const slugify = require('../utils/slugify');

async function runKeyboardFocusPass(page, artifactsDir, outputDir, maxSteps) {
  const findings = [];
  const focusHistory = [];
  const focusSelectors = [];
  const orderJumps = [];

  for (let i = 0; i < maxSteps; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    const focusInfo = await page.evaluate(() => {
      function buildSelector(el) {
        if (!el || !el.tagName) return '';
        if (el.id) return `#${el.id}`;
        const parts = [];
        let node = el;
        for (let depth = 0; depth < 3 && node && node.tagName; depth++) {
          let part = node.tagName.toLowerCase();
          if (node.classList && node.classList.length) {
            part += '.' + Array.from(node.classList).slice(0, 2).join('.');
          }
          if (node.parentElement) {
            const siblings = Array.from(node.parentElement.children);
            const index = siblings.indexOf(node) + 1;
            part += `:nth-child(${index})`;
          }
          parts.unshift(part);
          node = node.parentElement;
          if (node && node.tagName && node.id) {
            parts.unshift(`#${node.id}`);
            break;
          }
        }
        return parts.join(' > ');
      }

      const el = document.activeElement;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const outlineWidth = parseFloat(style.outlineWidth || '0');
      const outlineStyle = style.outlineStyle;
      const boxShadow = style.boxShadow;
      const focusVisible = (outlineStyle && outlineStyle !== 'none' && outlineWidth > 0) || (boxShadow && boxShadow !== 'none');

      const steps = 5;
      let obscured = 0;
      let total = 0;
      let obscuredByFixed = false;
      for (let x = 0; x < steps; x++) {
        for (let y = 0; y < steps; y++) {
          const px = rect.left + (x + 0.5) * (rect.width / steps);
          const py = rect.top + (y + 0.5) * (rect.height / steps);
          if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue;
          total++;
          const topEl = document.elementFromPoint(px, py);
          if (topEl && topEl !== el && !el.contains(topEl)) {
            obscured++;
            const topStyle = window.getComputedStyle(topEl);
            if (topStyle.position === 'fixed' || topStyle.position === 'sticky') {
              obscuredByFixed = true;
            }
          }
        }
      }
      const obscuredRatio = total > 0 ? obscured / total : 0;

      return {
        selector: buildSelector(el),
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className || null,
        role: el.getAttribute('role'),
        name: el.getAttribute('name'),
        href: el.getAttribute('href'),
        type: el.getAttribute('type'),
        text: (el.innerText || '').trim().slice(0, 120),
        boundingBox: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        focusVisible,
        focusStyle: {
          outlineStyle,
          outlineWidth,
          boxShadow
        },
        obscuredRatio,
        obscuredByFixed
      };
    });

    if (!focusInfo) continue;
    focusHistory.push(focusInfo);
    focusSelectors.push(focusInfo.selector || '');

    const clip = await safeClip(page, focusInfo.boundingBox, 12);
    const shotName = `focus-${String(i + 1).padStart(2, '0')}-${slugify(focusInfo.selector || focusInfo.tagName)}.png`;
    const shotPath = path.join(artifactsDir, shotName);
    await page.screenshot({ path: shotPath, clip });
    const shotRel = path.relative(outputDir, shotPath);

    if (!focusInfo.focusVisible) {
      findings.push({
        id: 'A11Y-FOCUS-VISIBLE',
        title: 'Focus indicator is not clearly visible',
        standard: 'WCAG 2.2',
        level: 'AA',
        severity: 'serious',
        confidence: 'medium',
        source: 'keyboard-pass',
        manual_review_required: false,
        selector: focusInfo.selector,
        node: {
          htmlSnippet: focusInfo.text,
          boundingBox: focusInfo.boundingBox
        },
        why: 'Keyboard users must be able to see where focus is located. This element has no obvious outline or shadow when focused.',
        fix: 'Ensure a visible focus style using outline, box-shadow, or border changes for focused elements.',
        evidence: {
          screenshot: shotRel,
          extra: {
            focusStyle: focusInfo.focusStyle
          }
        },
        occurrences: 1
      });
    }

    if (focusInfo.obscuredRatio > 0.2 && focusInfo.obscuredByFixed) {
      findings.push({
        id: 'A11Y-FOCUS-NOT-OBSCURED',
        title: 'Focused element is obscured by overlay',
        standard: 'WCAG 2.2',
        level: 'AA',
        severity: 'serious',
        confidence: 'medium',
        source: 'custom-runtime',
        manual_review_required: false,
        selector: focusInfo.selector,
        node: {
          htmlSnippet: focusInfo.text,
          boundingBox: focusInfo.boundingBox
        },
        why: 'Focused elements should not be hidden by sticky headers or overlays. This focus target appears partially covered.',
        fix: 'Adjust layout or scroll behavior so focused items remain visible, or provide offset scroll padding.',
        evidence: {
          screenshot: shotRel,
          extra: {
            obscuredRatio: focusInfo.obscuredRatio
          }
        },
        occurrences: 1
      });
    }

    const prev = focusHistory[focusHistory.length - 2];
    if (prev && focusInfo.boundingBox && prev.boundingBox) {
      const dy = focusInfo.boundingBox.y - prev.boundingBox.y;
      if (dy < -300) orderJumps.push({ from: prev.selector, to: focusInfo.selector, dy });
    }

    if (focusSelectors.length >= 8) {
      const recent = focusSelectors.slice(-8).filter(Boolean);
      const unique = new Set(recent);
      if (unique.size <= 3) {
        findings.push({
          id: 'A11Y-FOCUS-TRAP',
          title: 'Potential focus trap detected',
          standard: 'WCAG 2.2',
          level: 'AA',
          severity: 'serious',
          confidence: 'low',
          source: 'keyboard-pass',
          manual_review_required: true,
          selector: focusInfo.selector,
          node: {
            htmlSnippet: focusInfo.text,
            boundingBox: focusInfo.boundingBox
          },
          why: 'Keyboard focus appears to cycle within a small set of elements, suggesting a possible trap.',
          fix: 'Ensure focus can move forward and backward through all interactive elements.',
          evidence: {
            screenshot: shotRel,
            extra: {
              recentSelectors: Array.from(unique)
            }
          },
          occurrences: 1
        });
        break;
      }
    }
  }

  if (orderJumps.length >= 2) {
    findings.push({
      id: 'A11Y-FOCUS-ORDER',
      title: 'Potential focus order anomaly',
      standard: 'WCAG 2.2',
      level: 'AA',
      severity: 'moderate',
      confidence: 'low',
      source: 'keyboard-pass',
      manual_review_required: true,
      selector: orderJumps[0].to,
      node: {
        htmlSnippet: '',
        boundingBox: { x: 0, y: 0, w: 0, h: 0 }
      },
      why: 'Focus appears to jump upward unexpectedly during keyboard navigation, which may indicate an illogical tab order.',
      fix: 'Review tabindex usage and DOM order to ensure focus follows a logical reading order.',
      evidence: {
        screenshot: null,
        extra: {
          jumps: orderJumps.slice(0, 5)
        }
      },
      occurrences: orderJumps.length
    });
  }

  return { findings };
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

module.exports = { runKeyboardFocusPass };

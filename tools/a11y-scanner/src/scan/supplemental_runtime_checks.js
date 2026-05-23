'use strict';

function finding(id, title, severity, selector, htmlSnippet, why, fix, extra = {}) {
  return {
    id,
    title,
    standard: 'WCAG 2.2',
    level: extra.level || 'AA',
    severity,
    confidence: extra.confidence || 'medium',
    source: 'custom-runtime',
    manual_review_required: extra.manual_review_required !== false,
    selector,
    node: {
      htmlSnippet: htmlSnippet || '',
      boundingBox: { x: 0, y: 0, w: 0, h: 0 }
    },
    why,
    fix,
    evidence: {
      screenshot: null,
      extra
    },
    occurrences: extra.occurrences || 1
  };
}

async function runSupplementalRuntimeChecks(page) {
  const items = await page.evaluate(() => {
    const out = [];
    const MAX_PER_RULE = 80;

    function normalizeText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeComparable(value) {
      return normalizeText(value).toLowerCase();
    }

    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    function selectorFor(el) {
      if (!el || !el.tagName) return '';
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts = [];
      let node = el;
      for (let depth = 0; depth < 3 && node && node.tagName; depth++) {
        let part = node.tagName.toLowerCase();
        if (node.classList && node.classList.length) {
          part += '.' + Array.from(node.classList).slice(0, 2).map((name) => CSS.escape(name)).join('.');
        }
        if (node.parentElement) {
          const index = Array.from(node.parentElement.children).indexOf(node) + 1;
          part += `:nth-child(${index})`;
        }
        parts.unshift(part);
        node = node.parentElement;
        if (node && node.id) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
      }
      return parts.join(' > ');
    }

    function htmlFor(el) {
      return String(el?.outerHTML || '').replace(/\s+/g, ' ').slice(0, 700);
    }

    function textFromIds(ids) {
      return String(ids || '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || '')
        .join(' ');
    }

    function accessibleName(el) {
      return normalizeText(
        el.getAttribute('aria-label') ||
          textFromIds(el.getAttribute('aria-labelledby')) ||
          el.getAttribute('alt') ||
          el.getAttribute('title') ||
          el.innerText ||
          ''
      );
    }

    function emit(item) {
      const count = out.filter((existing) => existing.id === item.id).length;
      if (count < MAX_PER_RULE) out.push(item);
    }

    const interactiveSelector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="link"], input[type="button"], input[type="submit"]'))) {
      if (!isVisible(el)) continue;
      const ariaLabel = normalizeComparable(el.getAttribute('aria-label'));
      const visibleText = normalizeComparable(el.innerText || el.value || '');
      if (ariaLabel && visibleText && !ariaLabel.includes(visibleText)) {
        emit({
          id: 'A11Y-LABEL-IN-NAME',
          selector: selectorFor(el),
          htmlSnippet: htmlFor(el),
          visibleText,
          ariaLabel
        });
      }
    }

    for (const hiddenRoot of Array.from(document.querySelectorAll('[aria-hidden="true"]'))) {
      for (const focusable of Array.from(hiddenRoot.querySelectorAll(interactiveSelector))) {
        if (isVisible(focusable) && !focusable.hasAttribute('disabled')) {
          emit({
            id: 'A11Y-ARIA-HIDDEN-FOCUSABLE',
            selector: selectorFor(focusable),
            htmlSnippet: htmlFor(focusable),
            ancestor: selectorFor(hiddenRoot)
          });
        }
      }
    }

    const framesByTitle = new Map();
    for (const frame of Array.from(document.querySelectorAll('iframe, frame'))) {
      const title = normalizeText(frame.getAttribute('title'));
      if (!title) {
        emit({ id: 'A11Y-FRAME-TITLE', selector: selectorFor(frame), htmlSnippet: htmlFor(frame) });
      } else {
        if (!framesByTitle.has(title)) framesByTitle.set(title, []);
        framesByTitle.get(title).push(frame);
      }
    }
    for (const [title, frames] of framesByTitle) {
      if (frames.length > 1) {
        frames.forEach((frame) => {
          emit({
            id: 'A11Y-DUPLICATE-FRAME-TITLE',
            selector: selectorFor(frame),
            htmlSnippet: htmlFor(frame),
            title,
            occurrences: frames.length
          });
        });
      }
    }

    const visibleH1s = Array.from(document.querySelectorAll('h1')).filter(isVisible);
    if (visibleH1s.length !== 1) {
      emit({
        id: 'A11Y-H1-COUNT',
        selector: visibleH1s[0] ? selectorFor(visibleH1s[0]) : 'h1',
        htmlSnippet: visibleH1s.map(htmlFor).join('\n').slice(0, 700),
        count: visibleH1s.length,
        occurrences: Math.max(1, visibleH1s.length)
      });
    }

    let previousHeadingLevel = 0;
    for (const heading of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(isVisible)) {
      const currentLevel = Number(heading.tagName.slice(1));
      if (previousHeadingLevel && currentLevel - previousHeadingLevel > 1) {
        emit({
          id: 'A11Y-HEADING-LEVEL-SKIPPED',
          selector: selectorFor(heading),
          htmlSnippet: htmlFor(heading),
          previousHeadingLevel,
          currentHeadingLevel: currentLevel
        });
      }
      previousHeadingLevel = currentLevel;
    }

    for (const el of Array.from(document.querySelectorAll('[id=""]'))) {
      emit({ id: 'A11Y-EMPTY-ID', selector: selectorFor(el), htmlSnippet: htmlFor(el) });
    }

    for (const list of Array.from(document.querySelectorAll('ul, ol, [role="list"]')).filter(isVisible)) {
      if (!list.querySelector('li, [role="listitem"]')) {
        emit({ id: 'A11Y-LIST-EMPTY', selector: selectorFor(list), htmlSnippet: htmlFor(list) });
      }
    }

    for (const media of Array.from(document.querySelectorAll('video[autoplay], audio[autoplay]')).filter(isVisible)) {
      emit({ id: 'A11Y-AUTOPLAY-MEDIA', selector: selectorFor(media), htmlSnippet: htmlFor(media), level: 'A' });
    }

    const imagesByAlt = new Map();
    for (const img of Array.from(document.querySelectorAll('img')).filter(isVisible)) {
      const alt = normalizeText(img.getAttribute('alt'));
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (alt) {
        if (!imagesByAlt.has(alt)) imagesByAlt.set(alt, []);
        imagesByAlt.get(alt).push({ img, src });
      }
      if (/\b(image|picture|photo|graphic|icon)\b/i.test(alt) || /\.(jpe?g|png|gif|webp|svg)\b/i.test(alt)) {
        emit({ id: 'A11Y-ALT-EXTRANEOUS-TEXT', selector: selectorFor(img), htmlSnippet: htmlFor(img), alt, level: 'A' });
      }
    }
    for (const [alt, records] of imagesByAlt) {
      const uniqueSrc = new Set(records.map((record) => record.src).filter(Boolean));
      if (records.length > 1 && uniqueSrc.size > 1) {
        records.forEach(({ img }) => {
          emit({ id: 'A11Y-DUPLICATE-ALT-TEXT', selector: selectorFor(img), htmlSnippet: htmlFor(img), alt, occurrences: records.length, level: 'A' });
        });
      }
    }

    for (const button of Array.from(document.querySelectorAll('button, [role="button"]')).filter(isVisible)) {
      const tabindexDescendant = button.querySelector('[tabindex]');
      if (tabindexDescendant) {
        emit({
          id: 'A11Y-TABINDEX-IN-BUTTON',
          selector: selectorFor(tabindexDescendant),
          htmlSnippet: htmlFor(button),
          button: selectorFor(button)
        });
      }
    }

    for (const outer of Array.from(document.querySelectorAll('a[href], button')).filter(isVisible)) {
      const nested = Array.from(outer.querySelectorAll('a[href], button')).find((el) => el !== outer && isVisible(el));
      if (nested) {
        emit({
          id: 'A11Y-NESTED-INTERACTIVE',
          selector: selectorFor(nested),
          htmlSnippet: htmlFor(outer),
          outer: selectorFor(outer)
        });
      }
    }

    for (const link of Array.from(document.querySelectorAll('a[target="_blank"]')).filter(isVisible)) {
      const name = normalizeComparable(accessibleName(link));
      if (!/(new tab|new window|opens|external)/.test(name)) {
        emit({ id: 'A11Y-TARGET-BLANK-WARNING', selector: selectorFor(link), htmlSnippet: htmlFor(link), accessibleName: name, level: 'AAA' });
      }
    }

    const linksByHref = new Map();
    for (const link of Array.from(document.querySelectorAll('a[href]')).filter(isVisible)) {
      const href = new URL(link.getAttribute('href'), document.baseURI).href.replace(/#.*$/, '');
      const name = normalizeComparable(accessibleName(link));
      if (!href || !name) continue;
      if (!linksByHref.has(href)) linksByHref.set(href, []);
      linksByHref.get(href).push({ link, name });
    }
    for (const [href, records] of linksByHref) {
      const names = new Set(records.map((record) => record.name));
      if (records.length > 1 && names.size > 1) {
        records.slice(0, 8).forEach(({ link, name }) => {
          emit({
            id: 'A11Y-INCONSISTENT-LINK-TEXT',
            selector: selectorFor(link),
            htmlSnippet: htmlFor(link),
            href,
            accessibleName: name,
            distinctNames: Array.from(names).slice(0, 8),
            occurrences: records.length
          });
        });
      }
    }

    for (const el of Array.from(document.querySelectorAll('s, del, [class*="slash" i], [class*="strike" i], [style*="line-through" i]')).filter(isVisible)) {
      const text = normalizeText(el.innerText);
      if (/\$\s?\d/.test(text)) {
        emit({ id: 'A11Y-PRICE-RELATIONSHIP', selector: selectorFor(el), htmlSnippet: htmlFor(el), text });
      }
    }

    for (const svg of Array.from(document.querySelectorAll('button svg[role="img"][aria-label], a svg[role="img"][aria-label]')).filter(isVisible)) {
      emit({
        id: 'A11Y-REDUNDANT-SVG-IMG',
        selector: selectorFor(svg),
        htmlSnippet: htmlFor(svg),
        parentName: accessibleName(svg.closest('button, a'))
      });
    }

    return out;
  });

  return items.map((item) => {
    switch (item.id) {
      case 'A11Y-LABEL-IN-NAME':
        return finding(
          item.id,
          'Accessible name does not include visible label',
          'moderate',
          item.selector,
          item.htmlSnippet,
          'Visible labels should be included in the accessible name so speech input and screen reader users encounter the same control name.',
          'Update aria-label/aria-labelledby so the accessible name contains the visible text, or remove the overriding aria-label.',
          item
        );
      case 'A11Y-ARIA-HIDDEN-FOCUSABLE':
        return finding(
          item.id,
          'Focusable element is hidden from assistive technology',
          'serious',
          item.selector,
          item.htmlSnippet,
          'Elements inside aria-hidden content can still receive keyboard focus while being unavailable to screen reader users.',
          'Remove the element from the tab order, remove aria-hidden from the ancestor, or hide the entire subtree from all users.',
          item
        );
      case 'A11Y-FRAME-TITLE':
        return finding(item.id, 'Frame is missing a descriptive title', 'serious', item.selector, item.htmlSnippet, 'Frames need a title so users can identify their purpose.', 'Add a concise title attribute that describes the frame content.', item);
      case 'A11Y-DUPLICATE-FRAME-TITLE':
        return finding(item.id, 'Multiple frames use the same title', 'moderate', item.selector, item.htmlSnippet, 'Frame titles should distinguish different embedded regions.', 'Use unique frame titles that describe each frame purpose.', item);
      case 'A11Y-H1-COUNT':
        return finding(item.id, 'Page does not expose a single visible h1', 'moderate', item.selector, item.htmlSnippet, 'A page should expose one primary heading that describes the page topic.', 'Use one visible h1 for the page title and nest lower-level headings in order.', item);
      case 'A11Y-HEADING-LEVEL-SKIPPED':
        return finding(item.id, 'Heading level is skipped', 'moderate', item.selector, item.htmlSnippet, 'Skipped heading levels can make the page outline harder to understand.', 'Adjust heading levels so they follow a logical sequence.', item);
      case 'A11Y-EMPTY-ID':
        return finding(item.id, 'Element has an empty id attribute', 'moderate', item.selector, item.htmlSnippet, 'Empty IDs can break relationships and create unreliable markup for assistive technology.', 'Remove the empty id or replace it with a unique non-empty value.', item);
      case 'A11Y-LIST-EMPTY':
        return finding(item.id, 'List container has no list items', 'moderate', item.selector, item.htmlSnippet, 'List semantics are only useful when the list contains list items.', 'Use li elements or role=listitem children, or remove list semantics.', item);
      case 'A11Y-AUTOPLAY-MEDIA':
        return finding(item.id, 'Media starts automatically', 'moderate', item.selector, item.htmlSnippet, 'Autoplaying media can distract users and must be pausable, stoppable, or hideable.', 'Disable autoplay or provide an easy pause, stop, or hide control.', item);
      case 'A11Y-ALT-EXTRANEOUS-TEXT':
        return finding(item.id, 'Image alt text contains redundant words', 'minor', item.selector, item.htmlSnippet, 'Alt text usually should not include words like image, picture, photo, graphic, or icon because screen readers already announce image semantics.', 'Rewrite the alt text to describe the content or purpose directly.', item);
      case 'A11Y-DUPLICATE-ALT-TEXT':
        return finding(item.id, 'Different images use identical alt text', 'minor', item.selector, item.htmlSnippet, 'Repeated alt text on different images may hide meaningful differences between images.', 'Use distinct alt text for distinct meaningful images, or empty alt for decorative duplicates.', item);
      case 'A11Y-TABINDEX-IN-BUTTON':
        return finding(item.id, 'Button contains a descendant with tabindex', 'serious', item.selector, item.htmlSnippet, 'Focusable descendants inside buttons can create confusing or invalid keyboard interaction.', 'Remove tabindex from descendants and make the button itself the single focus target.', item);
      case 'A11Y-NESTED-INTERACTIVE':
        return finding(item.id, 'Interactive control is nested inside another interactive control', 'serious', item.selector, item.htmlSnippet, 'Nested links or buttons create invalid, unpredictable keyboard and assistive technology behavior.', 'Separate the controls or make only one parent element interactive.', item);
      case 'A11Y-TARGET-BLANK-WARNING':
        return finding(item.id, 'Link opens a new tab without warning', 'minor', item.selector, item.htmlSnippet, 'Opening a new browsing context can disorient users when the link text or accessible name does not warn them.', 'Add visible or assistive text such as "opens in a new tab" when target="_blank" is used.', item);
      case 'A11Y-INCONSISTENT-LINK-TEXT':
        return finding(item.id, 'Links with the same target use different text', 'minor', item.selector, item.htmlSnippet, 'Links that perform the same action or go to the same target should be named consistently.', 'Use consistent link text and accessible names for links that share the same destination and purpose.', item);
      case 'A11Y-PRICE-RELATIONSHIP':
        return finding(item.id, 'Struck-through price may not expose its meaning', 'moderate', item.selector, item.htmlSnippet, 'Sale and original prices need semantic or text cues so assistive technology users understand which price is original and which is current.', 'Label original and discounted prices in text or with programmatic relationships.', item);
      case 'A11Y-REDUNDANT-SVG-IMG':
        return finding(item.id, 'Icon SVG inside a named control is exposed as an image', 'minor', item.selector, item.htmlSnippet, 'Decorative icons inside named controls can add redundant or confusing announcements.', 'Hide decorative SVGs with aria-hidden="true" or ensure the icon has a necessary, distinct purpose.', item);
      default:
        return finding(item.id, item.id, 'moderate', item.selector, item.htmlSnippet, 'Potential accessibility issue detected.', 'Review and remediate this pattern.', item);
    }
  });
}

module.exports = { runSupplementalRuntimeChecks };

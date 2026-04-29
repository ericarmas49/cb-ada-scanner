'use strict';

async function runFormTest(page) {
  const findings = [];
  const formInfo = await page.evaluate(() => {
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return true;
    }

    const form = Array.from(document.querySelectorAll('form')).find(isVisible);
    if (!form) return null;

    const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (!submit) return null;

    return {
      formSelector: form.id ? `#${form.id}` : 'form',
      submitSelector: submit.id ? `#${submit.id}` : 'button'
    };
  });

  if (!formInfo) return findings;

  try {
    await page.click(formInfo.submitSelector);
    await page.waitForTimeout(800);
  } catch (_) {
    return findings;
  }

  const validationInfo = await page.evaluate(() => {
    const invalidFields = Array.from(document.querySelectorAll(':invalid'));
    const ariaInvalid = Array.from(document.querySelectorAll('[aria-invalid="true"]'));
    const errors = Array.from(document.querySelectorAll('[role="alert"], .error, .field-error, .validation-error'));

    return {
      invalidCount: invalidFields.length,
      ariaInvalidCount: ariaInvalid.length,
      errorTextCount: errors.filter((el) => (el.innerText || '').trim().length > 0).length
    };
  });

  if (validationInfo.invalidCount > 0 && validationInfo.errorTextCount === 0) {
    findings.push({
      id: 'A11Y-FORM-ERROR-IDENTIFICATION',
      title: 'Form validation errors are not described',
      standard: 'WCAG 2.2',
      level: 'AA',
      severity: 'serious',
      confidence: 'medium',
      source: 'custom-runtime',
      manual_review_required: true,
      selector: formInfo.formSelector,
      node: {
        htmlSnippet: '',
        boundingBox: { x: 0, y: 0, w: 0, h: 0 }
      },
      why: 'When errors occur, users need clear text describing the issue and which fields require attention.',
      fix: 'Provide visible error messages and associate them with fields using aria-describedby.',
      evidence: {
        screenshot: null,
        extra: validationInfo
      },
      occurrences: 1
    });
  } else if (validationInfo.invalidCount > 0 && validationInfo.ariaInvalidCount === 0) {
    findings.push({
      id: 'A11Y-FORM-ARIA-INVALID',
      title: 'Invalid fields lack aria-invalid state',
      standard: 'WCAG 2.2',
      level: 'AA',
      severity: 'moderate',
      confidence: 'medium',
      source: 'custom-runtime',
      manual_review_required: false,
      selector: formInfo.formSelector,
      node: {
        htmlSnippet: '',
        boundingBox: { x: 0, y: 0, w: 0, h: 0 }
      },
      why: 'aria-invalid should be set on fields that fail validation to inform assistive tech users.',
      fix: 'Set aria-invalid="true" on invalid fields and ensure error text is associated.',
      evidence: {
        screenshot: null,
        extra: validationInfo
      },
      occurrences: 1
    });
  }

  return findings;
}

module.exports = { runFormTest };

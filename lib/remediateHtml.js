import * as cheerio from 'cheerio';

function coalesceText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getEnv(name) {
  return process.env[name] || '';
}

async function callOpenAI(prompt) {
  const apiKey = getEnv('OPENAI_API_KEY');
  if (!apiKey) {
    return null;
  }

  const model = getEnv('OPENAI_MODEL') || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: 'Return only JSON with keys "text" and "confidence". Keep text short, conservative, and factual.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.text === 'string' && typeof parsed.confidence === 'number') {
      return {
        text: parsed.text.trim(),
        confidence: parsed.confidence
      };
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function normalizeConfidence(value) {
  if (value > 0.7) return 'high';
  if (value > 0.4) return 'medium';
  return 'low';
}

export async function remediateHtml(originalHtml) {
  const $ = cheerio.load(originalHtml, { decodeEntities: false });
  const remediationLog = [];
  const warnings = [];

  const htmlTag = $('html');
  if (htmlTag.length && !htmlTag.attr('lang')) {
    htmlTag.attr('lang', 'en');
    remediationLog.push({
      issueId: 'A11Y-LANG-DEFAULT',
      action: 'Added lang="en" to the page root.',
      confidence: 'high',
      aiGenerated: false
    });
  }

  $('iframe').each((_index, element) => {
    const frame = $(element);
    if (!frame.attr('title')) {
      frame.attr('title', 'Embedded content');
      remediationLog.push({
        issueId: 'A11Y-IFRAME-TITLE',
        action: 'Added a generic iframe title.',
        confidence: 'medium',
        aiGenerated: false
      });
      warnings.push('A generic iframe title was added. Review it for accuracy.');
    }
  });

  $('[aria-label]').each((_index, element) => {
    const node = $(element);
    const ariaLabel = coalesceText(node.attr('aria-label'));
    const visibleText = coalesceText(node.text());
    if (ariaLabel && visibleText) {
      node.removeAttr('aria-label');
      remediationLog.push({
        issueId: 'A11Y-ARIA-LABEL-OVERRIDE',
        action: 'Removed aria-label from an element with visible text.',
        confidence: 'medium',
        aiGenerated: false
      });
    }
  });

  $('form button').each((_index, element) => {
    const button = $(element);
    if (button.attr('type')) {
      return;
    }
    const text = coalesceText(button.text()).toLowerCase();
    if (text.match(/submit|send|sign up|signup|register|contact|get started|start/i)) {
      button.attr('type', 'submit');
      remediationLog.push({
        issueId: 'A11Y-BUTTON-TYPE',
        action: 'Added type="submit" to a submit-like button.',
        confidence: 'high',
        aiGenerated: false
      });
    }
  });

  const seenIds = new Map();
  $('[id]').each((_index, element) => {
    const node = $(element);
    const id = node.attr('id');
    if (!id) {
      return;
    }
    const count = seenIds.get(id) || 0;
    seenIds.set(id, count + 1);
    if (count > 0) {
      const nextId = `${id}-${count + 1}`;
      node.attr('id', nextId);
      remediationLog.push({
        issueId: 'A11Y-DUPLICATE-ID',
        action: `Renamed duplicate id "${id}" to "${nextId}".`,
        confidence: 'medium',
        aiGenerated: false
      });
      warnings.push(`Duplicate id "${id}" was renamed. Verify references still make sense.`);
    }
  });

  const imagesMissingAlt = $('img').filter((_index, element) => {
    const alt = $(element).attr('alt');
    return alt === undefined || alt === null || alt.trim() === '';
  });

  for (const element of imagesMissingAlt.toArray()) {
    const image = $(element);
    const src = image.attr('src') || '';
    const aiResult = await callOpenAI(`Generate short alt text for an image. Only describe visible content. src: ${src}`);
    if (aiResult?.text) {
      image.attr('alt', aiResult.text);
      remediationLog.push({
        issueId: 'AXE-image-alt',
        action: `Added AI-generated alt text: "${aiResult.text}".`,
        confidence: normalizeConfidence(aiResult.confidence),
        aiGenerated: true
      });
      warnings.push('An AI-generated alt text value was added. Review it before treating the page as final.');
    } else {
      image.before('<!-- TODO(A11Y): Add descriptive alt text for this image -->');
      remediationLog.push({
        issueId: 'AXE-image-alt',
        action: 'Inserted a TODO comment for missing alt text.',
        confidence: 'low',
        aiGenerated: false
      });
      warnings.push('Some missing alt text could not be confidently generated. Manual review is required.');
    }
  }

  const unlabeledButtons = $('button, [role="button"]').filter((_index, element) => {
    const node = $(element);
    return !coalesceText(node.text()) && !coalesceText(node.attr('aria-label')) && !coalesceText(node.attr('title'));
  });

  for (const element of unlabeledButtons.toArray()) {
    const node = $(element);
    const context = coalesceText(node.parent().text()).slice(0, 140);
    const aiResult = await callOpenAI(`Suggest a short aria-label for an icon-only button. Nearby text: "${context}".`);
    if (aiResult?.text) {
      node.attr('aria-label', aiResult.text);
      remediationLog.push({
        issueId: 'AXE-button-name',
        action: `Added AI-generated aria-label: "${aiResult.text}".`,
        confidence: normalizeConfidence(aiResult.confidence),
        aiGenerated: true
      });
      warnings.push('An AI-generated button label was added. Review it before treating the page as final.');
    } else {
      node.before('<!-- TODO(A11Y): Add an accessible label for this control -->');
      remediationLog.push({
        issueId: 'AXE-button-name',
        action: 'Inserted a TODO comment for an unlabeled control.',
        confidence: 'low',
        aiGenerated: false
      });
      warnings.push('An unlabeled control needs manual review.');
    }
  }

  return {
    remediatedHtml: $.html(),
    remediationLog,
    warnings
  };
}

import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { getRemediationSolution } from './remediationSolutions.js';

const requireFromScanner = createRequire(import.meta.url);

const { enrichFindings } = requireFromScanner('../tools/a11y-scanner/src/report/enrich_findings.js');
const { scoreReport } = requireFromScanner('../tools/a11y-scanner/src/report/scoring.js');
const { writeReportFiles } = requireFromScanner('../tools/a11y-scanner/src/report/write_files.js');

const MAX_ENTRIES = 2500;
const MAX_EXTRACTED_BYTES = 75 * 1024 * 1024;
const MAX_SCAN_FILE_BYTES = 2 * 1024 * 1024;
const SCAN_EXTENSIONS = new Set(['.php', '.html', '.htm', '.js', '.jsx', '.css', '.json']);
const SKIP_DIRS = new Set(['.git', '__MACOSX', 'node_modules', 'vendor', 'dist', 'build', '.cache']);

function normalizeSeverity(severity) {
  if (severity === 'serious') return 'high';
  if (severity === 'minor') return 'low';
  if (severity === 'critical' || severity === 'moderate') return severity;
  return 'moderate';
}

function buildSummary(report) {
  const totals = report?.summary?.totals || { critical: 0, serious: 0, moderate: 0, minor: 0 };
  return {
    critical: totals.critical || 0,
    high: totals.serious || 0,
    moderate: totals.moderate || 0,
    low: totals.minor || 0
  };
}

function gradeAndRiskFromScore(score) {
  if (score >= 90) return { grade: 'A', complianceRisk: 'minimal' };
  if (score >= 80) return { grade: 'B', complianceRisk: 'low' };
  if (score >= 70) return { grade: 'C', complianceRisk: 'high' };
  if (score >= 60) return { grade: 'D', complianceRisk: 'very-high' };
  return { grade: 'F', complianceRisk: 'severe' };
}

function runArtifactUrl(origin, runId, artifactPath) {
  if (!artifactPath) return null;
  const normalizedPath = String(artifactPath).replace(/\\/g, '/');
  return `${origin}/runs/${runId}/${normalizedPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function assertSafeZipEntry(entryName) {
  const normalized = entryName.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error(`Unsafe zip entry: ${entryName}`);
  }
  const parts = normalized.split('/');
  if (parts.includes('..')) {
    throw new Error(`Unsafe zip entry path traversal: ${entryName}`);
  }
  return normalized;
}

function extractThemeZip(zipPath, extractRoot) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Theme zip has too many files (${entries.length}). Limit is ${MAX_ENTRIES}.`);
  }

  let totalBytes = 0;
  for (const entry of entries) {
    const entryName = assertSafeZipEntry(entry.entryName);
    if (entry.isDirectory) continue;
    totalBytes += entry.header.size || 0;
    if (totalBytes > MAX_EXTRACTED_BYTES) {
      throw new Error('Theme zip is too large after extraction.');
    }

    const destination = path.resolve(extractRoot, entryName);
    if (!destination.startsWith(path.resolve(extractRoot) + path.sep)) {
      throw new Error(`Unsafe zip extraction path: ${entry.entryName}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.getData());
  }
}

function findThemeRoot(extractRoot) {
  const directStyle = path.join(extractRoot, 'style.css');
  if (fs.existsSync(directStyle)) return extractRoot;

  const children = fs.readdirSync(extractRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const child of children) {
    const candidate = path.join(extractRoot, child.name);
    if (fs.existsSync(path.join(candidate, 'style.css'))) {
      return candidate;
    }
  }

  return null;
}

function validateTheme(themeRoot) {
  if (!themeRoot) {
    throw new Error('Uploaded zip does not appear to contain a WordPress theme style.css file.');
  }

  const hasIndex = fs.existsSync(path.join(themeRoot, 'index.php'));
  const hasTemplates = fs.existsSync(path.join(themeRoot, 'templates')) || fs.existsSync(path.join(themeRoot, 'template-parts'));
  if (!hasIndex && !hasTemplates) {
    throw new Error('Theme must include index.php, templates/, or template-parts/.');
  }
}

function shouldScanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  if (!SCAN_EXTENSIONS.has(ext)) return false;
  if (base.endsWith('.min.js') || base.endsWith('.min.css')) return false;
  return true;
}

function walkFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const filePath = path.join(dir, entry.name);
        if (shouldScanFile(filePath)) files.push(filePath);
      }
    }
  };
  walk(root);
  return files.sort();
}

function positionForIndex(source, index) {
  const before = source.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function lineSnippetForIndex(source, index) {
  const start = source.lastIndexOf('\n', index);
  const end = source.indexOf('\n', index);
  return source.slice(start === -1 ? 0 : start + 1, end === -1 ? source.length : end).trim().replace(/\s+/g, ' ').slice(0, 900);
}

function openingTagAt(source, index) {
  let quote = '';
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      return source.slice(index, cursor + 1);
    }
    if (char === '\n') {
      return source.slice(index, cursor);
    }
  }
  return source.slice(index);
}

function stripTags(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\?php[\s\S]*?\?>/gi, ' dynamic-content ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attrValue(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*([\"'])(.*?)\\1`, 'i').exec(tag);
  return match ? match[2] : '';
}

function hrefValue(tag) {
  return attrValue(tag, 'href');
}

function hasAttr(tag, name) {
  return new RegExp(`\\b${name}(\\s*=|\\s|>|$)`, 'i').test(tag);
}

function hasDynamicTemplateSyntax(tag) {
  return /<\?|\?>|<%|{{|}}/.test(tag);
}

function hasNewTabCue(value) {
  return /(new tab|new window|opens)/i.test(String(value || ''));
}

function inferGithubLinkName(href) {
  try {
    const url = new URL(href);
    if (!/github\.com$/i.test(url.hostname)) return '';
    if (/\/issues(\/|$)/i.test(url.pathname)) return 'View issue tracker on GitHub';
    return 'View GitHub link';
  } catch {
    return '';
  }
}

function accessibleNameForAnchor(openingTag, innerHtml = '') {
  const ariaLabel = attrValue(openingTag, 'aria-label').trim();
  if (ariaLabel) return ariaLabel;

  const text = stripTags(innerHtml);
  if (text && !hasDynamicTemplateSyntax(innerHtml)) return text;

  const title = attrValue(openingTag, 'title').trim();
  if (title) return title;

  return inferGithubLinkName(hrefValue(openingTag));
}

function canAutoFixTargetBlankWarning(openingTag, innerHtml = '') {
  if (hasDynamicTemplateSyntax(openingTag)) return false;
  const existingCue = [attrValue(openingTag, 'aria-label'), attrValue(openingTag, 'title'), stripTags(innerHtml)].some(hasNewTabCue);
  if (existingCue) return false;
  return Boolean(accessibleNameForAnchor(openingTag, innerHtml));
}

function hasVisibleFocusReplacement(source) {
  const focusBlockPattern = /[^{}]*(?::focus-visible|:focus)[^{]*\{[^}]*\}/gi;
  for (const match of source.matchAll(focusBlockPattern)) {
    const block = match[0];
    const outlineMatch = /outline\s*:\s*([^;]+);?/i.exec(block);
    if (outlineMatch && !/^(0|none)\b/i.test(outlineMatch[1].trim())) {
      return true;
    }

    const boxShadowMatch = /box-shadow\s*:\s*([^;]+);?/i.exec(block);
    if (boxShadowMatch && !/^none\b/i.test(boxShadowMatch[1].trim())) {
      return true;
    }
  }
  return false;
}

function canAutoFixWordPressHelper(id, tag) {
  if (hasDynamicTemplateSyntax(tag)) return false;
  if (id === 'WP-STATIC-LANGUAGE-ATTRIBUTES') {
    return !hasAttr(tag, 'lang') && !hasAttr(tag, 'dir');
  }
  if (id === 'WP-STATIC-BODY-CLASS') {
    return !hasAttr(tag, 'class');
  }
  if (id === 'WP-STATIC-WP-BODY-OPEN') {
    return true;
  }
  return false;
}

function createFinding({
  id,
  title,
  severity,
  file,
  line,
  column,
  snippet,
  why,
  fix,
  tags,
  confidence = 'medium',
  manual = false,
  fixType
}) {
  const remediationSolution = getRemediationSolution(id);
  const resolvedFixType = fixType || remediationSolution?.fixType || (manual ? 'manual-review' : 'suggested-fix');
  const autoFixable = resolvedFixType === 'safe-auto-fix' || resolvedFixType === 'conditional-auto-fix';
  return {
    id,
    title,
    standard: 'WCAG 2.2',
    level: 'AA',
    severity,
    confidence,
    source: 'wordpress-static',
    manual_review_required: manual,
    autoFixable,
    fixType: resolvedFixType,
    selector: `${file}:${line}:${column}`,
    node: {
      htmlSnippet: snippet,
      boundingBox: { x: 0, y: 0, w: 0, h: 0 }
    },
    why,
    fix,
    evidence: {
      screenshot: null,
      extra: {
        file,
        line,
        column,
        tags,
        autoFixable,
        fixType: resolvedFixType,
        remediationSolution
      }
    },
    occurrences: 1
  };
}

function scanMarkupFile(source, relativeFile) {
  const findings = [];

  const addFinding = (match, config) => {
    const position = positionForIndex(source, match.index);
    findings.push(createFinding({
      ...config,
      file: relativeFile,
      line: position.line,
      column: position.column,
      snippet: (/<\?/.test(match[0]) ? lineSnippetForIndex(source, match.index) : match[0].replace(/\s+/g, ' ').slice(0, 700))
    }));
  };

  for (const match of source.matchAll(/<img\b/gi)) {
    const tag = openingTagAt(source, match.index);
    const tagMatch = { 0: tag, index: match.index };
    if (!hasAttr(tag, 'alt')) {
      addFinding(tagMatch, {
        id: 'WP-STATIC-IMG-ALT',
        title: 'Image is missing alt text',
        severity: 'critical',
        why: 'Images need text alternatives so screen reader users can understand their purpose.',
        fix: 'Add meaningful alt text, or use alt="" for decorative images.',
        tags: ['wcag111'],
        confidence: 'high',
        manual: true
      });
    } else {
      const alt = attrValue(tag, 'alt');
      if (/\b(image|picture|photo|graphic|icon)\b/i.test(alt)) {
        addFinding(tagMatch, {
          id: 'WP-STATIC-ALT-EXTRANEOUS',
          title: 'Image alt text may contain redundant words',
          severity: 'minor',
          why: 'Screen readers already announce image semantics, so words like image or photo are usually redundant.',
          fix: 'Rewrite alt text to describe the content or purpose directly.',
          tags: ['wcag111'],
          manual: true
        });
      }
    }
  }

  for (const match of source.matchAll(/<iframe\b[^>]*>/gi)) {
    if (!attrValue(match[0], 'title').trim()) {
      addFinding(match, {
        id: 'WP-STATIC-FRAME-TITLE',
        title: 'Frame is missing a title',
        severity: 'serious',
        why: 'Frames need descriptive titles so assistive technology users can identify their purpose.',
        fix: 'Add a concise title attribute that describes the embedded content.',
        tags: ['wcag241'],
        confidence: 'high',
        fixType: 'suggested-fix'
      });
    }
  }

  for (const match of source.matchAll(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi)) {
    const tag = match[0];
    const hasDynamicPhp = hasDynamicTemplateSyntax(tag);
    const rel = attrValue(tag, 'rel').toLowerCase();
    const title = attrValue(tag, 'title').toLowerCase();
    const ariaLabel = attrValue(tag, 'aria-label').toLowerCase();
    if (!rel.includes('noopener') || !rel.includes('noreferrer')) {
      addFinding(match, {
        id: 'WP-STATIC-TARGET-BLANK-REL',
        title: 'Link opens a new tab without safe rel attributes',
        severity: 'minor',
        why: 'Links opening new tabs should include rel="noopener noreferrer" to avoid opener security risks.',
        fix: 'Add rel="noopener noreferrer" to the link.',
        tags: ['wcag325'],
        fixType: hasDynamicPhp ? 'suggested-fix' : 'safe-auto-fix'
      });
    }
    if (!hasNewTabCue(title) && !hasNewTabCue(ariaLabel)) {
      addFinding(match, {
        id: 'WP-STATIC-TARGET-BLANK-WARNING',
        title: 'Link opens a new tab without warning users',
        severity: 'minor',
        why: 'Opening a new tab or window can disorient users when the link text or accessible name does not warn them.',
        fix: 'Add an aria-label that preserves the link purpose and adds "(opens in a new tab)."',
        tags: ['wcag325'],
        fixType: canAutoFixTargetBlankWarning(tag) ? 'conditional-auto-fix' : 'suggested-fix',
        manual: !canAutoFixTargetBlankWarning(tag)
      });
    }
  }

  for (const match of source.matchAll(/\btabindex\s*=\s*["']([1-9]\d*)["']/gi)) {
    addFinding(match, {
      id: 'WP-STATIC-POSITIVE-TABINDEX',
      title: 'Positive tabindex can create illogical keyboard order',
      severity: 'serious',
      why: 'Positive tabindex values override natural focus order and often create keyboard navigation problems.',
      fix: 'Remove positive tabindex values and rely on DOM order, or use tabindex="0" only when necessary.',
      tags: ['wcag211'],
        confidence: 'high',
        fixType: 'suggested-fix'
    });
  }

  for (const match of source.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    if (!stripTags(match[2])) {
      addFinding(match, {
        id: 'WP-STATIC-EMPTY-HEADING',
        title: 'Heading is empty',
        severity: 'moderate',
        why: 'Empty headings create confusing navigation landmarks for assistive technology users.',
        fix: 'Remove empty headings or add meaningful heading text.',
        tags: ['wcag246'],
        confidence: 'high',
        manual: true
      });
    }
  }

  for (const match of source.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    const openingTag = match[0].match(/<button\b[^>]*>/i)?.[0] || '';
    const hasName = attrValue(openingTag, 'aria-label').trim() || attrValue(openingTag, 'aria-labelledby').trim() || stripTags(match[1]);
    if (!hasName) {
      addFinding(match, {
        id: 'WP-STATIC-BUTTON-NAME',
        title: 'Button has no accessible name',
        severity: 'critical',
        why: 'Buttons need accessible names so users know what action they perform.',
        fix: 'Add visible button text, aria-label, or aria-labelledby.',
        tags: ['wcag412'],
        confidence: 'high',
        manual: true
      });
    }
  }

  for (const match of source.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const openingTag = match[0].match(/<a\b[^>]*>/i)?.[0] || '';
    const hasName = attrValue(openingTag, 'aria-label').trim() || attrValue(openingTag, 'aria-labelledby').trim() || attrValue(openingTag, 'title').trim() || stripTags(match[1]);
    if (!hasName) {
      addFinding(match, {
        id: 'WP-STATIC-LINK-NAME',
        title: 'Link has no accessible name',
        severity: 'critical',
        why: 'Links need accessible names so users can understand their destination or action.',
        fix: 'Add visible link text, aria-label, aria-labelledby, or title text.',
        tags: ['wcag244'],
        confidence: 'high',
        manual: true
      });
    }
  }

  for (const match of source.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (/<(a|button)\b/i.test(match[2])) {
      addFinding(match, {
        id: 'WP-STATIC-NESTED-INTERACTIVE',
        title: 'Interactive element is nested inside another interactive element',
        severity: 'serious',
        why: 'Nested links or buttons create invalid and unpredictable keyboard behavior.',
        fix: 'Separate the controls or make only one element interactive.',
        tags: ['wcag211'],
        confidence: 'medium',
        fixType: 'suggested-fix'
      });
    }
  }

  for (const match of source.matchAll(/<[^>]+\bid\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
    if (!match[1].trim()) {
      addFinding(match, {
        id: 'WP-STATIC-EMPTY-ID',
        title: 'Element has an empty id attribute',
        severity: 'moderate',
        why: 'Empty IDs can break programmatic relationships and create unreliable markup.',
        fix: 'Remove the empty id or replace it with a unique non-empty value.',
        tags: ['wcag411'],
        confidence: 'high',
        fixType: 'safe-auto-fix'
      });
    }
  }

  const ids = new Map();
  for (const match of source.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    const id = match[1].trim();
    if (!id) continue;
    if (!ids.has(id)) ids.set(id, []);
    ids.get(id).push(match);
  }
  for (const matches of ids.values()) {
    if (matches.length > 1) {
      for (const match of matches) {
        addFinding(match, {
          id: 'WP-STATIC-DUPLICATE-ID',
          title: 'Duplicate id value appears in the same file',
          severity: 'moderate',
          why: 'Duplicate IDs can break labels, ARIA references, and in-page navigation.',
          fix: 'Use unique id values within each rendered template.',
          tags: ['wcag411'],
          confidence: 'medium',
          fixType: 'suggested-fix'
        });
      }
    }
  }

  for (const match of source.matchAll(/<[^>]+aria-hidden\s*=\s*["']true["'][^>]*>[\s\S]*?<(a\b|button\b|input\b|select\b|textarea\b|[^>]+tabindex=)[\s\S]*?<\/[^>]+>/gi)) {
    addFinding(match, {
      id: 'WP-STATIC-ARIA-HIDDEN-FOCUSABLE',
      title: 'Focusable content may be hidden from assistive technology',
      severity: 'serious',
      why: 'Focusable descendants inside aria-hidden content can be reached by keyboard but not announced by screen readers.',
      fix: 'Remove focusable descendants, remove aria-hidden, or hide the subtree from all users.',
      tags: ['wcag412'],
      manual: true
    });
  }

  return findings;
}

function scanCssFile(source, relativeFile) {
  const findings = [];
  if (hasVisibleFocusReplacement(source)) return findings;

  for (const match of source.matchAll(/outline\s*:\s*(0|none)\b/gi)) {
    const position = positionForIndex(source, match.index);
    findings.push(createFinding({
      id: 'WP-STATIC-FOCUS-OUTLINE',
      title: 'CSS removes focus outline',
      severity: 'moderate',
      file: relativeFile,
      line: position.line,
      column: position.column,
      snippet: match[0],
      why: 'Removing focus outlines can make keyboard focus invisible.',
      fix: 'Provide a visible replacement focus style when suppressing default outlines.',
      tags: ['wcag247'],
      fixType: 'conditional-auto-fix'
    }));
  }
  return findings;
}

function scanWordPressFile(source, relativeFile) {
  const findings = [];
  const lowerFile = relativeFile.toLowerCase();

  const addTemplateFinding = (id, title, fix, pattern, tags = ['wcag131']) => {
    const match = pattern.exec(source);
    if (!match) return;
    const position = positionForIndex(source, match.index);
    findings.push(createFinding({
      id,
      title,
      severity: 'moderate',
      file: relativeFile,
      line: position.line,
      column: position.column,
      snippet: match[0].replace(/\s+/g, ' ').slice(0, 700),
      why: 'WordPress template helpers expose important semantic, language, or body state information.',
      fix,
      tags,
      confidence: 'medium',
      fixType: canAutoFixWordPressHelper(id, match[0]) ? 'conditional-auto-fix' : 'suggested-fix'
    }));
  };

  if (lowerFile.endsWith('header.php')) {
    addTemplateFinding(
      'WP-STATIC-LANGUAGE-ATTRIBUTES',
      'HTML element may be missing language_attributes()',
      'Use <html <?php language_attributes(); ?>> so WordPress outputs the page language.',
      /<html\b(?![^>]*language_attributes\s*\()/i
    );
    addTemplateFinding(
      'WP-STATIC-BODY-CLASS',
      'Body element may be missing body_class()',
      'Use <body <?php body_class(); ?>> so WordPress exposes page state classes consistently.',
      /<body\b(?![^>]*body_class\s*\()/i
    );
    if (/<body\b/i.test(source) && !/wp_body_open\s*\(/i.test(source)) {
      const match = /<body\b[^>]*>/i.exec(source);
      if (match) {
        addTemplateFinding(
          'WP-STATIC-WP-BODY-OPEN',
          'Theme header may be missing wp_body_open()',
          'Call <?php wp_body_open(); ?> immediately after the opening body tag.',
          /<body\b[^>]*>/i
        );
      }
    }
  }

  return findings;
}

function scanFile(filePath, themeRoot) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_SCAN_FILE_BYTES) return [];

  const relativeFile = path.relative(themeRoot, filePath).replace(/\\/g, '/');
  const source = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();

  const findings = [];
  if (['.php', '.html', '.htm', '.jsx'].includes(ext)) {
    findings.push(...scanMarkupFile(source, relativeFile));
  }
  if (ext === '.css') {
    findings.push(...scanCssFile(source, relativeFile));
  }
  if (ext === '.php') {
    findings.push(...scanWordPressFile(source, relativeFile));
  }
  return findings;
}

function buildDashboard(report, issues, summary) {
  const accessibilityScore = Math.max(0, Math.min(100, Math.round(Number(report?.summary?.score) || 0)));
  const { grade, complianceRisk } = gradeAndRiskFromScore(accessibilityScore);
  return {
    violationCount: issues.length,
    criticalCount: summary.critical || 0,
    accessibilityScore,
    grade,
    complianceRisk
  };
}

function buildFixabilitySummary(issues) {
  const summary = {
    safeAutoFix: 0,
    conditionalAutoFix: 0,
    suggestedFix: 0,
    manualReview: 0
  };
  for (const issue of issues) {
    if (issue.fixType === 'safe-auto-fix') summary.safeAutoFix += 1;
    else if (issue.fixType === 'conditional-auto-fix') summary.conditionalAutoFix += 1;
    else if (issue.fixType === 'manual-review') summary.manualReview += 1;
    else summary.suggestedFix += 1;
  }
  return summary;
}

function issueFromFinding(finding) {
  return {
    id: String(finding.id || '').replace(/^AXE-/i, ''),
    criterionId: finding.criterionId || '',
    criterionTitle: finding.criterionTitle || '',
    complianceLevel: finding.complianceLevel || '',
    principle: finding.principle || '',
    severity: normalizeSeverity(finding.severity),
    title: finding.title,
    wcagReference: finding?.evidence?.extra?.helpUrl || '',
    page: finding?.evidence?.extra?.file || '',
    template: finding?.evidence?.extra?.file || null,
    component: finding.selector || '',
    instanceCount: finding.occurrences || 1,
    selector: finding.selector || '',
    confidence: finding.confidence || 'medium',
    manual_review_required: Boolean(finding.manual_review_required),
    autoFixable: Boolean(finding.autoFixable || finding?.evidence?.extra?.autoFixable),
    fixType: finding.fixType || finding?.evidence?.extra?.fixType || 'suggested-fix',
    remediationSolution: finding?.evidence?.extra?.remediationSolution || null,
    automation: finding.automation || 'static',
    remediation: finding.remediation || finding.fix || '',
    category: finding.category || '',
    snippet: finding?.node?.htmlSnippet || '',
    line: finding?.evidence?.extra?.line || null,
    column: finding?.evidence?.extra?.column || null
  };
}

function countByRule(issues) {
  const counts = {};
  for (const issue of issues) {
    const id = issue.id || 'UNKNOWN';
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function buildScanSnapshot({ issues, score, risk, summary, fixability }) {
  return {
    issueCount: issues.length,
    score: Math.max(0, Math.min(100, Math.round(Number(score) || 0))),
    risk,
    summary,
    fixability,
    ruleCounts: countByRule(issues)
  };
}

function issueKey(issue) {
  return [
    issue.id || '',
    issue.template || issue.page || '',
    issue.line || '',
    issue.column || '',
    issue.title || ''
  ].join('|');
}

function bucketIssue(issue) {
  if (issue.fixType === 'safe-auto-fix' || issue.fixType === 'conditional-auto-fix') return 'skippedUnsafe';
  if (issue.manual_review_required || issue.fixType === 'manual-review') return 'needsInput';
  if (issue.fixType === 'suggested-fix') return 'suggestedFix';
  return 'unknownPattern';
}

function reviewQuestionForIssue(issue) {
  if (issue.id === 'WP-STATIC-IMG-ALT') {
    return 'What should this image communicate? If decorative, should it use alt="" and aria-hidden="true"?';
  }
  if (issue.id === 'WP-STATIC-LINK-NAME') {
    return 'What accessible name should this link expose to screen reader users?';
  }
  if (issue.id === 'WP-STATIC-BUTTON-NAME') {
    return 'What action does this button perform, and what visible or aria-label text should it use?';
  }
  if (issue.id === 'WP-STATIC-TARGET-BLANK-WARNING') {
    return 'What visible or accessible cue should tell users this link opens in a new tab?';
  }
  if (issue.id === 'WP-STATIC-DUPLICATE-ID') {
    return 'Which duplicate id should be renamed, and what unique id should replace it?';
  }
  return 'What is the correct remediation for this exact code pattern, and can this pattern be auto-fixed in the future?';
}

function buildReviewPrompt(issue) {
  const file = issue.template || issue.page || '';
  return [
    `Rule: ${issue.id || 'UNKNOWN'}`,
    `Issue: ${issue.title || ''}`,
    `Severity: ${issue.severity || ''}`,
    `File: ${file}`,
    `Line: ${issue.line || ''}`,
    '',
    'Problem code:',
    issue.snippet || '[snippet unavailable]',
    '',
    'Current scanner recommendation:',
    issue.remediation || '[recommendation unavailable]',
    '',
    'Question for reviewer:',
    reviewQuestionForIssue(issue),
    '',
    'Reviewer answer:',
    '[fill in the intended meaning or correction]',
    '',
    'Preferred fixed code:',
    '[paste corrected code]',
    '',
    'Can this be auto-fixed in the future?',
    '[Always / Sometimes / Never]',
    '',
    'If sometimes, when?',
    '[describe the safe pattern]'
  ].join('\n');
}

function groupIssuesByRule(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const id = issue.id || 'UNKNOWN';
    if (!groups.has(id)) {
      groups.set(id, {
        ruleId: id,
        title: issue.title || id,
        severity: issue.severity || 'moderate',
        fixType: issue.fixType || 'suggested-fix',
        count: 0,
        files: [],
        examples: [],
        remediationSolution: issue.remediationSolution || null
      });
    }
    const group = groups.get(id);
    group.count += 1;
    const file = issue.template || issue.page || '';
    if (file && !group.files.includes(file)) group.files.push(file);
    if (group.examples.length < 3) {
      group.examples.push({
        file,
        line: issue.line,
        column: issue.column,
        title: issue.title,
        fixType: issue.fixType,
        remediation: issue.remediation || '',
        snippet: issue.snippet || '',
        reviewQuestion: reviewQuestionForIssue(issue),
        reviewPrompt: buildReviewPrompt(issue)
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId));
}

function buildRemediationReview({ originalIssues, postFixIssues = [], appliedFixes = [] }) {
  const remainingKeys = new Set(postFixIssues.map(issueKey));
  const appliedRuleCounts = appliedFixes.reduce((counts, fix) => {
    counts[fix.ruleId] = (counts[fix.ruleId] || 0) + (fix.count || 0);
    return counts;
  }, {});

  const autoFixed = [];
  const outstanding = [];
  for (const issue of originalIssues) {
    if (remainingKeys.has(issueKey(issue))) {
      outstanding.push(issue);
    } else if (appliedRuleCounts[issue.id] > 0) {
      autoFixed.push(issue);
    } else {
      outstanding.push(issue);
    }
  }

  const buckets = {
    allIssues: originalIssues,
    autoFixed,
    outstanding,
    needsInput: outstanding.filter((issue) => bucketIssue(issue) === 'needsInput'),
    suggestedFix: outstanding.filter((issue) => bucketIssue(issue) === 'suggestedFix'),
    skippedUnsafe: outstanding.filter((issue) => bucketIssue(issue) === 'skippedUnsafe'),
    unknownPattern: outstanding.filter((issue) => bucketIssue(issue) === 'unknownPattern')
  };

  return {
    counts: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length])),
    groups: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, groupIssuesByRule(value)])),
    learningQueue: groupIssuesByRule([
      ...buckets.needsInput,
      ...buckets.suggestedFix,
      ...buckets.skippedUnsafe,
      ...buckets.unknownPattern
    ])
  };
}

function mergeRelAttribute(tag) {
  const relMatch = /\srel\s*=\s*(["'])(.*?)\1/i.exec(tag);
  const required = ['noopener', 'noreferrer'];
  if (!relMatch) {
    return tag.replace(/\s*>$/, ' rel="noopener noreferrer">');
  }

  const current = relMatch[2].split(/\s+/).filter(Boolean);
  const merged = Array.from(new Set([...current, ...required]));
  return tag.replace(relMatch[0], ` rel="${merged.join(' ')}"`);
}

function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function ariaLabelWithNewTabCue(name) {
  const normalized = String(name || '').trim().replace(/\s*\(?opens in a new tab\)?\.?$/i, '').trim();
  return `${normalized} (opens in a new tab)`;
}

function mergeAriaLabelAttribute(tag, label) {
  const safeLabel = escapeAttribute(label);
  const ariaMatch = /\saria-label\s*=\s*(["'])(.*?)\1/i.exec(tag);
  if (ariaMatch) {
    return tag.replace(ariaMatch[0], ` aria-label="${safeLabel}"`);
  }
  return tag.replace(/\s*>$/, ` aria-label="${safeLabel}">`);
}

function applyTargetBlankRelFix(source) {
  let count = 0;
  const output = source.replace(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi, (tag) => {
    if (hasDynamicTemplateSyntax(tag)) return tag;
    const rel = attrValue(tag, 'rel').toLowerCase();
    if (rel.includes('noopener') && rel.includes('noreferrer')) return tag;
    count += 1;
    return mergeRelAttribute(tag);
  });
  return { output, count };
}

function applyTargetBlankWarningFix(source) {
  let count = 0;
  const withFullAnchorFixes = source.replace(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>([\s\S]*?)<\/a>/gi, (anchor, innerHtml) => {
    const openingTag = anchor.match(/<a\b[^>]*>/i)?.[0] || '';
    if (!canAutoFixTargetBlankWarning(openingTag, innerHtml)) return anchor;

    const label = ariaLabelWithNewTabCue(accessibleNameForAnchor(openingTag, innerHtml));
    count += 1;
    return anchor.replace(openingTag, mergeAriaLabelAttribute(openingTag, label));
  });

  const output = withFullAnchorFixes.replace(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi, (tag) => {
    if (!canAutoFixTargetBlankWarning(tag)) return tag;

    const label = ariaLabelWithNewTabCue(accessibleNameForAnchor(tag));
    count += 1;
    return mergeAriaLabelAttribute(tag, label);
  });
  return { output, count };
}

function applyEmptyIdFix(source) {
  let count = 0;
  const output = source.replace(/\s+id\s*=\s*(["'])\s*\1/gi, () => {
    count += 1;
    return '';
  });
  return { output, count };
}

function applyFocusOutlineFix(source) {
  if (hasVisibleFocusReplacement(source)) {
    return { output: source, count: 0 };
  }

  const focusBlock = [
    '',
    'a:focus-visible,',
    'button:focus-visible,',
    'input:focus-visible,',
    'select:focus-visible,',
    'textarea:focus-visible {',
    '  outline: 2px solid #2271b1;',
    '  outline-offset: 2px;',
    '}'
  ].join('\n');
  return { output: `${source.trimEnd()}\n${focusBlock}\n`, count: 1 };
}

function applyLanguageAttributesFix(source) {
  let count = 0;
  const output = source.replace(/<html\b([^>]*)>/i, (tag, attrs = '') => {
    if (hasDynamicTemplateSyntax(tag) || /language_attributes\s*\(/i.test(tag) || hasAttr(tag, 'lang') || hasAttr(tag, 'dir')) {
      return tag;
    }
    count += 1;
    return `<html <?php language_attributes(); ?>${attrs}>`;
  });
  return { output, count };
}

function applyBodyClassFix(source) {
  let count = 0;
  const output = source.replace(/<body\b([^>]*)>/i, (tag, attrs = '') => {
    if (hasDynamicTemplateSyntax(tag) || /body_class\s*\(/i.test(tag) || hasAttr(tag, 'class')) {
      return tag;
    }
    count += 1;
    return `<body${attrs} <?php body_class(); ?>>`;
  });
  return { output, count };
}

function applyWpBodyOpenFix(source) {
  if (/wp_body_open\s*\(/i.test(source)) {
    return { output: source, count: 0 };
  }

  let count = 0;
  const output = source.replace(/<body\b[^>]*>/i, (tag) => {
    if (hasDynamicTemplateSyntax(tag)) return tag;
    count += 1;
    return `${tag}\n<?php wp_body_open(); ?>`;
  });
  return { output, count };
}

function applyWordPressHelperFixes(source, relativeFile, ids) {
  if (!relativeFile.toLowerCase().endsWith('header.php')) {
    return { output: source, fixes: [] };
  }

  let output = source;
  const fixes = [];
  if (ids.has('WP-STATIC-LANGUAGE-ATTRIBUTES')) {
    const result = applyLanguageAttributesFix(output);
    output = result.output;
    if (result.count > 0) {
      fixes.push({
        ruleId: 'WP-STATIC-LANGUAGE-ATTRIBUTES',
        count: result.count,
        description: 'Added language_attributes() to the html element.'
      });
    }
  }

  if (ids.has('WP-STATIC-WP-BODY-OPEN')) {
    const result = applyWpBodyOpenFix(output);
    output = result.output;
    if (result.count > 0) {
      fixes.push({
        ruleId: 'WP-STATIC-WP-BODY-OPEN',
        count: result.count,
        description: 'Added wp_body_open() after the opening body tag.'
      });
    }
  }

  if (ids.has('WP-STATIC-BODY-CLASS')) {
    const result = applyBodyClassFix(output);
    output = result.output;
    if (result.count > 0) {
      fixes.push({
        ruleId: 'WP-STATIC-BODY-CLASS',
        count: result.count,
        description: 'Added body_class() to the body element.'
      });
    }
  }

  return { output, fixes };
}

function applySafeFixes(themeRoot, issues) {
  const issuesByFile = new Map();
  for (const issue of issues) {
    if (issue.fixType !== 'safe-auto-fix' && issue.fixType !== 'conditional-auto-fix') continue;
    const file = issue.template || issue.page;
    if (!file) continue;
    if (!issuesByFile.has(file)) issuesByFile.set(file, []);
    issuesByFile.get(file).push(issue);
  }

  const appliedFixes = [];
  for (const [relativeFile, fileIssues] of issuesByFile.entries()) {
    const filePath = path.resolve(themeRoot, relativeFile);
    if (!filePath.startsWith(path.resolve(themeRoot) + path.sep)) continue;
    if (!fs.existsSync(filePath)) continue;

    const ids = new Set(fileIssues.map((issue) => issue.id));
    const before = fs.readFileSync(filePath, 'utf8');
    let output = before;

    if (ids.has('WP-STATIC-TARGET-BLANK-REL')) {
      const result = applyTargetBlankRelFix(output);
      output = result.output;
      if (result.count > 0) {
        appliedFixes.push({
          file: relativeFile,
          ruleId: 'WP-STATIC-TARGET-BLANK-REL',
          count: result.count,
          description: 'Added missing rel="noopener noreferrer" tokens.'
        });
      }
    }

    if (ids.has('WP-STATIC-TARGET-BLANK-WARNING')) {
      const result = applyTargetBlankWarningFix(output);
      output = result.output;
      if (result.count > 0) {
        appliedFixes.push({
          file: relativeFile,
          ruleId: 'WP-STATIC-TARGET-BLANK-WARNING',
          count: result.count,
          description: 'Added non-visual aria-label cues for links that open in a new tab.'
        });
      }
    }

    if (ids.has('WP-STATIC-EMPTY-ID')) {
      const result = applyEmptyIdFix(output);
      output = result.output;
      if (result.count > 0) {
        appliedFixes.push({
          file: relativeFile,
          ruleId: 'WP-STATIC-EMPTY-ID',
          count: result.count,
          description: 'Removed empty id attributes.'
        });
      }
    }

    if (ids.has('WP-STATIC-FOCUS-OUTLINE')) {
      const result = applyFocusOutlineFix(output);
      output = result.output;
      if (result.count > 0) {
        appliedFixes.push({
          file: relativeFile,
          ruleId: 'WP-STATIC-FOCUS-OUTLINE',
          count: result.count,
          description: 'Added a visible :focus-visible outline replacement for keyboard users.'
        });
      }
    }

    const helperResult = applyWordPressHelperFixes(output, relativeFile, ids);
    output = helperResult.output;
    for (const fix of helperResult.fixes) {
      appliedFixes.push({
        file: relativeFile,
        ...fix
      });
    }

    if (output !== before) {
      fs.writeFileSync(filePath, output, 'utf8');
    }
  }
  return appliedFixes;
}

function packageTheme(themeRoot, zipPath) {
  const zip = new AdmZip();
  zip.addLocalFolder(themeRoot, path.basename(themeRoot));
  zip.writeZip(zipPath);
}

function phpSyntaxValidation(themeRoot) {
  const phpCheck = spawnSync('php', ['-v'], { encoding: 'utf8' });
  if (phpCheck.error || phpCheck.status !== 0) {
    return {
      status: 'skipped',
      message: 'PHP CLI is not available, so PHP syntax validation was skipped.',
      filesChecked: 0,
      failures: []
    };
  }

  const phpFiles = walkFiles(themeRoot).filter((filePath) => path.extname(filePath).toLowerCase() === '.php');
  const failures = [];
  for (const filePath of phpFiles) {
    const result = spawnSync('php', ['-l', filePath], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push({
        file: path.relative(themeRoot, filePath).replace(/\\/g, '/'),
        message: `${result.stdout || ''}${result.stderr || ''}`.trim()
      });
    }
  }

  return {
    status: failures.length ? 'failed' : 'passed',
    message: failures.length ? 'PHP syntax validation found errors.' : 'PHP syntax validation passed.',
    filesChecked: phpFiles.length,
    failures
  };
}

function validateFixedZip(zipPath, validationRoot) {
  fs.rmSync(validationRoot, { recursive: true, force: true });
  fs.mkdirSync(validationRoot, { recursive: true });
  extractThemeZip(zipPath, validationRoot);
  const themeRoot = findThemeRoot(validationRoot);
  validateTheme(themeRoot);
  const files = walkFiles(themeRoot);
  return {
    status: 'passed',
    message: 'Fixed ZIP contains a valid WordPress theme structure.',
    themeName: path.basename(themeRoot),
    filesScanned: files.length,
    phpSyntax: phpSyntaxValidation(themeRoot)
  };
}

function validateThemeDirectory(themeRoot) {
  validateTheme(themeRoot);
  const files = walkFiles(themeRoot);
  return {
    status: 'passed',
    message: 'Source theme contains a valid WordPress theme structure.',
    themeName: path.basename(themeRoot),
    filesScanned: files.length,
    phpSyntax: phpSyntaxValidation(themeRoot)
  };
}

function summarizeThemeScan(themeRoot) {
  const files = walkFiles(themeRoot);
  const rawFindings = files.flatMap((filePath) => scanFile(filePath, themeRoot));
  const enrichedFindings = enrichFindings(rawFindings, {
    pageUrl: `theme://${path.basename(themeRoot)}`
  });
  const summary = scoreReport(enrichedFindings);
  const issues = enrichedFindings.map(issueFromFinding);
  const severitySummary = buildSummary({ summary });
  const fixability = buildFixabilitySummary(issues);
  return {
    filesScanned: files.length,
    issueCount: issues.length,
    score: summary.score,
    risk: summary.risk,
    summary: severitySummary,
    fixability,
    ruleCounts: countByRule(issues),
    issues
  };
}

export async function runWpThemeScan({ appRoot, zipPath, originalName, origin }) {
  const runId = crypto.randomUUID();
  const runRoot = path.join(appRoot, 'runs', runId);
  const extractRoot = path.join(runRoot, 'theme-source');
  const reportPath = path.join(runRoot, 'report.json');
  const reportHtmlPath = path.join(runRoot, 'report.html');
  const reportPdfPath = path.join(runRoot, 'report.pdf');
  const remediationReportPath = path.join(runRoot, 'remediation-report.json');

  fs.mkdirSync(extractRoot, { recursive: true });
  extractThemeZip(zipPath, extractRoot);

  const themeRoot = findThemeRoot(extractRoot);
  validateTheme(themeRoot);

  const files = walkFiles(themeRoot);
  const rawFindings = files.flatMap((filePath) => scanFile(filePath, themeRoot));
  const enrichedFindings = enrichFindings(rawFindings, {
    pageUrl: `theme://${originalName || 'uploaded-theme'}`
  });
  const summaryReport = scoreReport(enrichedFindings);

  const report = {
    scan: {
      version: '0.1.0',
      type: 'wordpress-theme-static',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      inputUrl: originalName || 'uploaded-theme.zip',
      finalUrl: `theme://${path.basename(themeRoot)}`,
      options: {
        filesScanned: files.length,
        mode: 'static-code-review'
      }
    },
    page: {
      url: `theme://${path.basename(themeRoot)}`,
      finalUrl: `theme://${path.basename(themeRoot)}`,
      status: null,
      title: `WordPress Theme Static Scan: ${path.basename(themeRoot)}`,
      artifacts: {
        screenshot: null,
        viewportScreenshot: null,
        html: null,
        consoleLog: null,
        axeRaw: null,
        ariaSnapshot: null
      }
    },
    findings: enrichedFindings,
    summary: summaryReport
  };

  await writeReportFiles(report, {
    jsonPath: reportPath,
    htmlPath: reportHtmlPath,
    pdfPath: reportPdfPath
  }, runRoot);

  const summary = buildSummary(report);
  const issues = enrichedFindings.map(issueFromFinding);
  const dashboard = buildDashboard(report, issues, summary);
  const fixability = buildFixabilitySummary(issues);
  const originalValidation = validateThemeDirectory(themeRoot);
  const beforeScan = buildScanSnapshot({
    issues,
    score: dashboard.accessibilityScore,
    risk: dashboard.complianceRisk,
    summary,
    fixability
  });
  const appliedFixes = applySafeFixes(themeRoot, issues);
  const fixedThemePath = path.join(runRoot, `${path.basename(themeRoot)}-fixed.zip`);
  const validationRoot = path.join(runRoot, 'fixed-validation');
  let fixedThemeUrl = null;
  let postFixScan = null;
  let validation = {
    status: 'skipped',
    message: 'No fixed ZIP was generated because no safe auto-fixes were applied.',
    phpSyntax: {
      status: 'skipped',
      message: 'No fixed ZIP was generated.',
      filesChecked: 0,
      failures: []
    }
  };
  if (appliedFixes.length > 0) {
    packageTheme(themeRoot, fixedThemePath);
    fixedThemeUrl = `${origin}/runs/${runId}/${encodeURIComponent(path.basename(fixedThemePath))}`;
    postFixScan = summarizeThemeScan(themeRoot);
    try {
      validation = validateFixedZip(fixedThemePath, validationRoot);
    } catch (error) {
      validation = {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Fixed ZIP validation failed.',
        phpSyntax: {
          status: 'skipped',
          message: 'PHP syntax validation was skipped because ZIP validation failed.',
          filesChecked: 0,
          failures: []
        }
      };
    }
  }
  const changedFiles = Array.from(new Set(appliedFixes.map((fix) => fix.file))).sort();
  const remediationReview = buildRemediationReview({
    originalIssues: issues,
    postFixIssues: postFixScan?.issues || [],
    appliedFixes
  });
  const remediation = {
    status: appliedFixes.length > 0 ? 'fixed-zip-created' : 'no-safe-fixes',
    beforeScan,
    afterScan: postFixScan,
    originalValidation,
    changedFiles,
    appliedFixes,
    appliedFixCount: appliedFixes.reduce((sum, fix) => sum + (fix.count || 0), 0),
    review: remediationReview,
    postFixScan,
    validation,
    issueDelta: postFixScan ? beforeScan.issueCount - postFixScan.issueCount : 0,
    scoreDelta: postFixScan ? Math.round(Number(postFixScan.score) || 0) - beforeScan.score : 0
  };
  fs.writeFileSync(remediationReportPath, JSON.stringify(remediation, null, 2), 'utf8');

  const result = {
    runId,
    status: 'done',
    scanType: 'wordpress-theme-static',
    themeName: path.basename(themeRoot),
    filesScanned: files.length,
    reportUrl: `${origin}/runs/${runId}/report.html`,
    reportPdfUrl: fs.existsSync(reportPdfPath) ? `${origin}/runs/${runId}/report.pdf` : null,
    reportJsonUrl: `${origin}/runs/${runId}/report.json`,
    remediationReportUrl: `${origin}/runs/${runId}/remediation-report.json`,
    fixedThemeUrl,
    snapshotUrl: null,
    summary,
    dashboard,
    fixability,
    remediation,
    issues
  };

  fs.writeFileSync(path.join(runRoot, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}

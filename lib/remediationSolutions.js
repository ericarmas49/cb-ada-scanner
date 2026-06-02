const REMEDIATION_SOLUTIONS = {
  'WP-STATIC-TARGET-BLANK-REL': {
    fixType: 'safe-auto-fix',
    title: 'Add safe rel attributes to static new-tab links',
    detectionSummary: 'Finds static anchor tags using target="_blank" without both noopener and noreferrer.',
    safeAutoFix: 'Add missing noopener and noreferrer tokens to the rel attribute.',
    conditionalAutoFix: 'Only apply when the opening anchor tag does not contain inline PHP or other dynamic template syntax.',
    suggestedFix: 'Add rel="noopener noreferrer" to links that open in a new tab.',
    manualReviewReason: 'Dynamic PHP-generated attributes need developer review before rewriting.',
    badExamples: ['<a href="https://example.com" target="_blank">Example</a>'],
    goodExamples: ['<a href="https://example.com" target="_blank" rel="noopener noreferrer">Example</a>'],
    validationChecks: ['Rescan the fixed theme.', 'Run PHP syntax validation when PHP files are changed.'],
    riskNotes: 'This is a mechanical security and accessibility-adjacent fix when the tag is static.'
  },
  'WP-STATIC-TARGET-BLANK-WARNING': {
    fixType: 'conditional-auto-fix',
    title: 'Add a non-visual new-tab warning',
    detectionSummary: 'Finds links that open a new tab without an accessible cue warning screen reader users.',
    safeAutoFix: 'Add or update aria-label to include "(opens in a new tab)" without changing visual text.',
    conditionalAutoFix: 'Only apply when the anchor is static and the existing accessible name can be preserved or safely inferred.',
    suggestedFix: 'Add an aria-label that preserves the link purpose and adds "(opens in a new tab)".',
    manualReviewReason: 'If the link purpose cannot be inferred, a reviewer must provide the accessible name.',
    badExamples: ['<a href="https://github.com/webguyio/blankslate/issues/57" class="button-primary" target="_blank" rel="noopener noreferrer">'],
    goodExamples: [
      '<a href="https://github.com/webguyio/blankslate/issues/57" class="button-primary" target="_blank" rel="noopener noreferrer" aria-label="View issue tracker on GitHub (opens in a new tab)">'
    ],
    validationChecks: ['Rescan the fixed theme.', 'Run PHP syntax validation when PHP files are changed.'],
    riskNotes: 'Prefer non-visual accessible labels for this product. The generated aria-label must include the visible label text when visible text exists.'
  },
  'WP-STATIC-IMG-ALT': {
    fixType: 'manual-review',
    title: 'Add or verify image alt text',
    detectionSummary: 'Finds image tags that do not include an alt attribute in the source code.',
    safeAutoFix: '',
    conditionalAutoFix: 'Do not auto-label images unless a separate approved pattern proves the image is decorative or the alt source is known.',
    suggestedFix: 'Add meaningful alt text, or use alt="" for decorative images.',
    manualReviewReason: 'The scanner should accept static or dynamic alt attributes as satisfying the code-level requirement, but missing alt requires content judgment.',
    badExamples: ['<img src="hero.jpg">'],
    goodExamples: ['<img src="<?php echo esc_url( $att_image[0] ); ?>" alt="<?php echo esc_attr( $post->post_excerpt ); ?>">'],
    validationChecks: ['Rescan to confirm the missing-alt finding is removed.'],
    riskNotes: 'For this WordPress theme product, the code-level issue is missing alt attributes. Quality of individual media alt text is handled outside static theme code review.'
  },
  'WP-STATIC-EMPTY-ID': {
    fixType: 'safe-auto-fix',
    title: 'Remove empty id attributes',
    detectionSummary: 'Finds markup with id="" or an id containing only whitespace.',
    safeAutoFix: 'Remove the empty id attribute.',
    conditionalAutoFix: 'Only apply to static markup attributes.',
    suggestedFix: 'Remove the empty id or replace it with a unique meaningful id.',
    manualReviewReason: 'If script logic depends on the empty id selector, review manually before changing.',
    badExamples: ['<section id="">Content</section>'],
    goodExamples: ['<section>Content</section>', '<section id="featured-content">Content</section>'],
    validationChecks: ['Rescan the fixed theme.', 'Run PHP syntax validation when PHP files are changed.'],
    riskNotes: 'Empty ids are invalid and usually safe to remove from static markup.'
  },
  'WP-STATIC-LANGUAGE-ATTRIBUTES': {
    fixType: 'conditional-auto-fix',
    title: 'Add WordPress language attributes',
    detectionSummary: 'Finds header.php templates whose html element does not call language_attributes().',
    safeAutoFix: 'Add <?php language_attributes(); ?> to a simple static html opening tag.',
    conditionalAutoFix: 'Only apply in header.php when the html opening tag is static and does not already contain PHP.',
    suggestedFix: 'Use <html <?php language_attributes(); ?>> so WordPress outputs the page language.',
    manualReviewReason: 'Complex html attributes or inline PHP should be reviewed before rewriting the opening tag.',
    badExamples: ['<html>'],
    goodExamples: ['<html <?php language_attributes(); ?>>'],
    validationChecks: ['Run PHP syntax validation.', 'Rescan to confirm the language_attributes finding is removed.'],
    riskNotes: 'This improves document language output, but complex templates may need custom handling.'
  },
  'WP-STATIC-BODY-CLASS': {
    fixType: 'conditional-auto-fix',
    title: 'Add WordPress body classes',
    detectionSummary: 'Finds header.php templates whose body element does not call body_class().',
    safeAutoFix: 'Add <?php body_class(); ?> to a simple static body opening tag.',
    conditionalAutoFix: 'Only apply in header.php when the body opening tag is static and does not already contain PHP.',
    suggestedFix: 'Use <body <?php body_class(); ?>> so WordPress exposes page state classes consistently.',
    manualReviewReason: 'Existing body class logic should be reviewed to avoid changing theme styling behavior.',
    badExamples: ['<body>'],
    goodExamples: ['<body <?php body_class(); ?>>'],
    validationChecks: ['Run PHP syntax validation.', 'Rescan to confirm the body_class finding is removed.'],
    riskNotes: 'This can affect styling hooks positively, but complex body class output should stay manual.'
  },
  'WP-STATIC-WP-BODY-OPEN': {
    fixType: 'conditional-auto-fix',
    title: 'Add wp_body_open hook',
    detectionSummary: 'Finds header.php templates with a body tag but no wp_body_open() call.',
    safeAutoFix: 'Insert <?php wp_body_open(); ?> immediately after a simple static opening body tag.',
    conditionalAutoFix: 'Only apply when the body opening tag is static and the hook is not already present.',
    suggestedFix: 'Call <?php wp_body_open(); ?> immediately after the opening body tag.',
    manualReviewReason: 'Complex body markup should be reviewed to place the hook in the correct runtime location.',
    badExamples: ['<body>'],
    goodExamples: ['<body>\\n<?php wp_body_open(); ?>'],
    validationChecks: ['Run PHP syntax validation.', 'Rescan to confirm the wp_body_open finding is removed.'],
    riskNotes: 'This is a WordPress theme compatibility fix that enables plugins and accessibility tools to inject body-open content.'
  },
  'WP-STATIC-FOCUS-OUTLINE': {
    fixType: 'conditional-auto-fix',
    title: 'Add visible keyboard focus styles',
    detectionSummary: 'Finds CSS that removes outlines without an apparent replacement focus style.',
    safeAutoFix: 'Append a generic :focus-visible rule for common interactive elements.',
    conditionalAutoFix: 'Only apply when the stylesheet removes outlines and does not already include a visible :focus or :focus-visible replacement.',
    suggestedFix: 'Provide a visible replacement focus style when suppressing default outlines.',
    manualReviewReason: 'If a theme already has a compliant custom focus treatment, do not change it.',
    badExamples: ['outline: 0;', 'outline: none;'],
    goodExamples: [
      'a:focus-visible,\\nbutton:focus-visible,\\ninput:focus-visible,\\nselect:focus-visible,\\ntextarea:focus-visible {\\n  outline: 2px solid #2271b1;\\n  outline-offset: 2px;\\n}'
    ],
    validationChecks: ['Rescan to confirm the focus-outline finding is removed.'],
    riskNotes: 'This changes only keyboard focus styling and should avoid overriding existing compliant focus systems.'
  }
};

export function getRemediationSolution(ruleId) {
  return REMEDIATION_SOLUTIONS[ruleId] || null;
}

export function solutionFixType(ruleId, fallback = 'suggested-fix') {
  return getRemediationSolution(ruleId)?.fixType || fallback;
}


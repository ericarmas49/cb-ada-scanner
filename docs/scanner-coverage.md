# Scanner Coverage

This project currently has a rendered page scanner. It loads one URL in Playwright, runs axe-core, runs custom runtime checks, and maps findings to the WCAG reference data in `tools/a11y-scanner/src/data/wcag-checklist.js`.

Automated findings are useful triage signals, not a complete WCAG audit. Some rules are deterministic, some are heuristics, and some are manual-review prompts.

## Coverage Sources

- `axe-core`: Browser-based automated rules for rendered DOM failures.
- `custom-runtime`: Supplemental page heuristics for patterns seen in scanner comparisons.
- `keyboard-pass`: Tab-order, visible focus, focus trap, and focus-obscured checks.
- `form-test`: Basic form validation and error-state checks.

## Comparison Baseline

The first comparison used external scanner findings for `https://www.brooklinen.com/` from AccessibilityChecker, accessiBe, and UserWay.

Findings fell into these buckets:

- Already detected but previously under-mapped: ARIA role misuse, heading order, landmarks/regions, image alt, and unique landmark checks.
- Good custom runtime candidates: label-in-name mismatches, focusable content inside `aria-hidden`, frame title quality, duplicate/extraneous alt text, autoplay media, nested interactive controls, empty IDs, and new-tab warnings.
- Manual-review candidates: inconsistent same-target link text, price relationship semantics, redundant SVG icon exposure, and duplicate image alt text.
- Still outside rendered single-page scope: cross-page consistency, full media caption quality, full contrast interpretation beyond axe, and source-only theme issues.

## Adding New Definitions

Use this format when adding scanner definitions:

```md
Rule:
WCAG:
Level:
Scan type: rendered / static / both
What to flag:
What should pass:
What should fail:
Severity:
Recommended action:
Automation confidence: automated / semi-automated / manual
```

After adding a definition, wire it to detection by using either:

- `sourceRuleIds` for axe rule IDs, without the `AXE-` prefix.
- `aliases` for custom rule IDs emitted by our scanner.

Adding a criterion entry alone does not create detection. A scanner pass must emit a matching axe rule ID or custom alias.

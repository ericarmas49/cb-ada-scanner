# Single-URL WCAG 2.2 AA Scanner

Node + Playwright accessibility scanner that runs on a single URL and outputs a developer JSON report plus a printable HTML client report.

## Quick Start

```bash
npm install
node src/cli.js --url https://example.com
```

Outputs:
- `output/<timestamp>/report.json`
- `output/<timestamp>/report.html`
- `output/<timestamp>/artifacts/*`

## CLI Options

Required:
- `--url <string>`

Optional:
- `--timeoutMs 30000`
- `--headed` (default false)
- `--output ./output/<timestamped_folder>`
- `--formTest true|false` (default true)
- `--keyboardTabSteps 25` (default 25)
- `--settleMs 1500`
- `--viewport "1280x720"`
- `--userAgent "<ua>"`

## Notes

- HTML report is generated via Python with Jinja2.
- This version scans only a single URL (no crawling).

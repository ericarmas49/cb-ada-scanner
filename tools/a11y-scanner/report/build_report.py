import json
import sys
from pathlib import Path
from collections import defaultdict
from datetime import datetime

from jinja2 import Environment, FileSystemLoader, select_autoescape


def load_report(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def group_findings(findings):
    grouped = defaultdict(list)
    for item in findings:
        grouped[item['id']].append(item)
    return grouped


def main():
    if len(sys.argv) < 3:
        print('Usage: build_report.py <report.json> <report.html>')
        sys.exit(1)

    report_path = Path(sys.argv[1])
    html_path = Path(sys.argv[2])

    data = load_report(report_path)
    findings = data.get('findings', [])
    grouped = group_findings(findings)

    manual_review = [f for f in findings if f.get('manual_review_required') or f.get('confidence') == 'low']

    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent / 'templates'),
        autoescape=select_autoescape(['html'])
    )

    template = env.get_template('report.html.j2')
    css_path = Path(__file__).parent / 'assets' / 'report.css'
    css = css_path.read_text(encoding='utf-8') if css_path.exists() else ''

    html = template.render(
        report=data,
        grouped=grouped,
        manual_review=manual_review,
        css=css,
        generated_at=datetime.utcnow().isoformat() + 'Z'
    )

    html_path.write_text(html, encoding='utf-8')


if __name__ == '__main__':
    main()

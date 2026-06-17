import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromScanner = createRequire(import.meta.url);

export function getRunRoot(dataRoot, runId) {
  const safeRunId = String(runId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(safeRunId)) {
    return null;
  }
  return path.join(dataRoot, 'runs', safeRunId);
}

export function findRunPdfPath(runRoot) {
  if (!runRoot || !fs.existsSync(runRoot)) return null;

  const entries = fs.readdirSync(runRoot);
  const namedPdf = entries.find((name) => name.startsWith('CircleBlox-ADA-Scan-') && name.endsWith('.pdf'));
  if (namedPdf) {
    return path.join(runRoot, namedPdf);
  }

  const reportPdf = path.join(runRoot, 'report.pdf');
  if (fs.existsSync(reportPdf)) {
    return reportPdf;
  }

  return null;
}

export async function ensureRunPdf(runRoot) {
  const existing = findRunPdfPath(runRoot);
  if (existing) {
    return existing;
  }

  const reportHtmlPath = path.join(runRoot, 'report.html');
  if (!fs.existsSync(reportHtmlPath)) {
    return null;
  }

  const reportPdfPath = path.join(runRoot, 'report.pdf');
  const { writeReportFiles } = requireFromScanner('../tools/a11y-scanner/src/report/write_files.js');
  const report = JSON.parse(fs.readFileSync(path.join(runRoot, 'report.json'), 'utf8'));
  const result = await writeReportFiles(
    report,
    {
      jsonPath: path.join(runRoot, 'report.json'),
      htmlPath: reportHtmlPath,
      pdfPath: reportPdfPath
    },
    runRoot
  );

  if (!result.pdfSuccess || !fs.existsSync(reportPdfPath)) {
    return null;
  }

  return reportPdfPath;
}

export function pdfDownloadName(pdfPath) {
  if (!pdfPath) return 'CircleBlox-ADA-Scan.pdf';
  return path.basename(pdfPath);
}

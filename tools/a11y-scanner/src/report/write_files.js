'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

async function writeReportFiles(report, paths, outputDir) {
  fs.writeFileSync(paths.jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const pythonArgs = ['report/build_report.py', paths.jsonPath, paths.htmlPath];
  const result = spawnSync('python3', pythonArgs, {
    cwd: process.cwd(),
    stdio: 'ignore'
  });

  const htmlSuccess = result.status === 0 && fs.existsSync(paths.htmlPath);
  return { htmlSuccess };
}

module.exports = { writeReportFiles };

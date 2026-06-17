import { savePdfLead } from '../lib/savePdfLead.js';

try {
  const result = await savePdfLead({
    email: 'local-test@circleblox.com',
    siteName: 'example.com',
    runId: 'local-test',
    reportUrl: 'https://example.com/report'
  });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}

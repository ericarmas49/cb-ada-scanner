import express from 'express';
import fs from 'node:fs';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAccessibilityDemo } from './lib/runDemo.js';
import { runWpThemeScan } from './lib/runWpThemeScan.js';
import { savePdfLead } from './lib/savePdfLead.js';
import { getSupabaseConfigStatus, probeSupabaseLeadStorage } from './lib/supabaseDiagnostics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const dataRoot = process.env.DATA_ROOT || (process.env.VERCEL ? path.join('/tmp', 'accessibility-demo-app') : __dirname);
const runsRoot = path.join(dataRoot, 'runs');
const uploadRoot = path.join(runsRoot, '_uploads');
fs.mkdirSync(uploadRoot, { recursive: true });
const upload = multer({
  dest: uploadRoot,
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 1
  }
});

app.set('trust proxy', 1);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

function normalizeOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '');
}

function isAllowedOrigin(origin) {
  if (!origin || allowedOrigins.length === 0) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  return allowedOrigins.includes(normalizedOrigin);
}

function requestOrigin(req) {
  const configuredOrigin = normalizeOrigin(process.env.PUBLIC_BACKEND_ORIGIN);
  if (configuredOrigin) return configuredOrigin;
  return `${req.protocol}://${req.get('host')}`;
}

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (isAllowedOrigin(origin)) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(isAllowedOrigin(origin) ? 204 : 403);
    return;
  }

  next();
});

app.use(express.json({ limit: '2mb' }));
app.use('/runs', express.static(runsRoot, { extensions: ['html'] }));
app.use('/runs', (_req, res) => {
  res.status(404).type('text/plain').send('Artifact not found');
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', async (_req, res) => {
  try {
    const supabaseConfig = getSupabaseConfigStatus();
    let supabase = { configured: supabaseConfig.configured };

    if (supabaseConfig.configured) {
      supabase.keyRole = supabaseConfig.keyRole;
      supabase.keyLooksValid = supabaseConfig.keyLooksValid;
      if (!supabaseConfig.keyLooksValid) {
        supabase.ok = false;
        supabase.error = `Expected service_role key but got "${supabaseConfig.keyRole || 'unknown'}".`;
      } else {
        const probe = await probeSupabaseLeadStorage({ writeProbe: false });
        supabase.ok = probe.ok;
        if (!probe.ok) {
          supabase.error = probe.error;
          supabase.code = probe.code;
          supabase.hint = probe.hint;
        }
      }
    } else {
      supabase.ok = false;
      supabase.error = 'Supabase env vars are not configured.';
    }

    res.json({
      ok: true,
      supabase
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Health check failed.'
    });
  }
});

for (const name of ['ex1', 'ex2', 'ex3', 'ex4']) {
  app.get(`/${name}`, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${name}.html`));
  });
}

app.get('/wp-theme-scanner', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wp-theme-scanner.html'));
});

app.post('/api/demo', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      res.status(400).json({ error: 'Missing url' });
      return;
    }

    const origin = requestOrigin(req);
    const result = runAccessibilityDemo({
      appRoot: __dirname,
      outputRoot: dataRoot,
      url,
      origin
    });

    res.json(result);
  } catch (error) {
    console.error('Accessibility demo failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Invalid or empty url' ? 400 : 500;
    res.status(status).json({
      status: 'error',
      error: message
    });
  }
});

app.post('/api/pdf-lead', async (req, res) => {
  const { email, siteName, runId, reportUrl } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }

  try {
    await savePdfLead({
      email: normalizedEmail,
      siteName: String(siteName || ''),
      runId: String(runId || ''),
      reportUrl: String(reportUrl || '')
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('PDF lead save failed:', error);
    res.status(500).json({ error: 'Could not save your email. Please try again.' });
  }
});

app.post('/api/wp-theme-scan', upload.single('themeZip'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Missing themeZip upload' });
      return;
    }
    if (!/\.zip$/i.test(req.file.originalname || '')) {
      res.status(400).json({ error: 'Uploaded file must be a .zip archive' });
      return;
    }

    const origin = requestOrigin(req);
    const result = await runWpThemeScan({
      appRoot: dataRoot,
      zipPath: req.file.path,
      originalName: req.file.originalname,
      origin
    });

    res.json(result);
  } catch (error) {
    console.error('WordPress theme scan failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      error: message
    });
  } finally {
    if (req.file?.path) {
      fs.rm(req.file.path, { force: true }, () => {});
    }
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export function startServer(port = Number(process.env.PORT || 3000)) {
  return app.listen(port, () => {
    console.log(`Accessibility demo app listening on http://localhost:${port}`);
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  startServer();
}

export default app;

import express from 'express';
import fs from 'node:fs';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAccessibilityDemo } from './lib/runDemo.js';
import { runWpThemeScan } from './lib/runWpThemeScan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const dataRoot = process.env.VERCEL ? path.join('/tmp', 'accessibility-demo-app') : __dirname;
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

app.use(express.json({ limit: '2mb' }));
app.use('/runs', express.static(runsRoot, { extensions: ['html'] }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
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

    const origin = `${req.protocol}://${req.get('host')}`;
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

    const origin = `${req.protocol}://${req.get('host')}`;
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

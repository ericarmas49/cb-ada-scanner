import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAccessibilityDemo } from './lib/runDemo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use('/runs', express.static(path.join(__dirname, 'runs'), { extensions: ['html'] }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

for (const name of ['ex1', 'ex2', 'ex3', 'ex4']) {
  app.get(`/${name}`, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${name}.html`));
  });
}

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

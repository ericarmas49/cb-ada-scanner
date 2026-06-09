import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const outputPath = path.join(appRoot, 'public', 'config.js');

const config = {
  apiBaseUrl: String(process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '')
};

const contents = `window.ACCESSIBILITY_DEMO_CONFIG = ${JSON.stringify(config, null, 2)};\n`;

fs.writeFileSync(outputPath, contents, 'utf8');
console.log(`Wrote ${path.relative(appRoot, outputPath)}`);

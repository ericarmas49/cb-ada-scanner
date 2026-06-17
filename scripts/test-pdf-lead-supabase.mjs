import { loadEnvFile } from '../lib/loadEnvFile.js';
import { probeSupabaseLeadStorage } from '../lib/supabaseDiagnostics.js';

loadEnvFile();

const result = await probeSupabaseLeadStorage();
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

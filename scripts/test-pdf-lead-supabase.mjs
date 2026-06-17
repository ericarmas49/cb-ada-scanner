import { probeSupabaseLeadStorage } from '../lib/supabaseDiagnostics.js';

const result = await probeSupabaseLeadStorage();
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

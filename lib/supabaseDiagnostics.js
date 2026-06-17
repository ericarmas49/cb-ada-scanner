import { getSupabaseAdmin, isSupabaseConfigured } from './supabase.js';

function decodeJwtRole(key) {
  try {
    const segment = String(key || '').split('.')[1];
    if (!segment) return null;
    const payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return payload?.role || null;
  } catch {
    return null;
  }
}

function getUrlHost(url) {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

export function getSupabaseConfigStatus() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const configured = isSupabaseConfigured();
  const role = configured ? decodeJwtRole(key) : null;

  return {
    configured,
    urlHost: getUrlHost(url),
    keyRole: role,
    keyLooksValid: role === 'service_role'
  };
}

export async function probeSupabaseLeadStorage({ writeProbe = true } = {}) {
  const config = getSupabaseConfigStatus();
  if (!config.configured) {
    return {
      ok: false,
      config,
      error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set.'
    };
  }

  if (config.keyRole && config.keyRole !== 'service_role') {
    return {
      ok: false,
      config,
      error: `Expected service_role key but got "${config.keyRole}". Use Project Settings → API → service_role on Render.`
    };
  }

  const supabase = getSupabaseAdmin();
  const tableCheck = await supabase.from('pdf_leads').select('id').limit(1);
  if (tableCheck.error) {
    return {
      ok: false,
      config,
      error: tableCheck.error.message,
      code: tableCheck.error.code,
      hint: tableCheck.error.hint,
      details: tableCheck.error.details
    };
  }

  if (!writeProbe) {
    return {
      ok: true,
      config,
      message: 'pdf_leads table is readable.'
    };
  }

  const testEmail = `probe-${Date.now()}@ada-scanner.invalid`;
  const insertCheck = await supabase
    .from('pdf_leads')
    .insert({
      email: testEmail,
      site_name: 'supabase-probe',
      run_id: 'probe',
      report_url: 'https://example.com/probe',
      source: 'ada-scanner-probe'
    })
    .select('id')
    .single();

  if (insertCheck.error) {
    return {
      ok: false,
      config,
      error: insertCheck.error.message,
      code: insertCheck.error.code,
      hint: insertCheck.error.hint,
      details: insertCheck.error.details
    };
  }

  const insertedId = insertCheck.data?.id;
  if (insertedId) {
    await supabase.from('pdf_leads').delete().eq('id', insertedId);
  }

  return {
    ok: true,
    config,
    message: 'pdf_leads table is readable and writable.'
  };
}

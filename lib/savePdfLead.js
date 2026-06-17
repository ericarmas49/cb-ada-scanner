import { getSupabaseAdmin, isSupabaseConfigured } from './supabase.js';

export async function savePdfLead({ email, siteName, runId, reportUrl, source = 'ada-scanner' }) {
  const lead = {
    email,
    site_name: siteName,
    run_id: runId,
    report_url: reportUrl,
    source
  };

  if (!isSupabaseConfigured()) {
    console.info('PDF lead submitted (Supabase not configured):', {
      ...lead,
      submitted_at: new Date().toISOString()
    });
    return { stored: false, lead };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('pdf_leads').insert(lead).select('id').single();

  if (error) {
    console.error('Supabase pdf_leads insert failed:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    throw new Error(`Could not save lead: ${error.message}`);
  }

  return { stored: true, id: data?.id };
}

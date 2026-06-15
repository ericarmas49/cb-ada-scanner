-- Run this in the Supabase SQL editor for your project.

create table if not exists public.pdf_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  site_name text,
  run_id text,
  report_url text,
  source text not null default 'ada-scanner',
  submitted_at timestamptz not null default now()
);

create index if not exists pdf_leads_submitted_at_idx on public.pdf_leads (submitted_at desc);
create index if not exists pdf_leads_email_idx on public.pdf_leads (email);

alter table public.pdf_leads enable row level security;

-- No public policies: inserts are server-side only via service role key.

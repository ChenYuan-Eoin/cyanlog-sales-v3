-- G5 canonical baseline reconciliation.
--
-- Production contains the final review-workbench schema, but the migration
-- ledger does not contain the historical 20260714000002-00005 files that
-- produced it. A data-less Supabase Preview therefore rebuilds without these
-- three tables. This migration restores only the final G5 prerequisite schema.
--
-- Deliberately excluded:
--   * all historical UPDATE/backfill statements (workflow_state is not
--     replay-safe and would reopen valid NEEDS_REVISION decisions),
--   * 20260714000001 contract draft versioning (G7 scope),
--   * later G5 source-identity/lease changes (kept in the next migration).

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  missing_prerequisites text;
  existing_targets integer;
begin
  select string_agg(name, ', ' order by name)
    into missing_prerequisites
    from (values
      ('organizations'),
      ('contracts'),
      ('contract_reviews'),
      ('contract_risk_cards'),
      ('users'),
      ('contract_skill_bundles'),
      ('contract_analysis_jobs')
    ) as prerequisites(name)
   where to_regclass(format('public.%I', name)) is null;

  if missing_prerequisites is not null then
    raise exception 'G5 baseline reconciliation is missing prerequisite tables: %', missing_prerequisites
      using errcode = '42P01';
  end if;

  select count(*)
    into existing_targets
    from (values
      ('contract_review_submission_batches'),
      ('contract_review_decision_drafts'),
      ('contract_source_page_maps')
    ) as targets(name)
   where to_regclass(format('public.%I', name)) is not null;

  if existing_targets not in (0, 3) then
    raise exception 'G5 baseline reconciliation found a partial target schema (% of 3 tables); stop and audit the baseline', existing_targets
      using errcode = '55000';
  end if;
end;
$$;

create table if not exists public.contract_review_submission_batches (
  id uuid default gen_random_uuid(),
  org_id uuid not null,
  contract_id uuid not null,
  source_review_id uuid not null,
  new_review_id uuid,
  submitted_by uuid not null,
  review_style text not null,
  status text not null default 'checking'::text,
  decision_snapshot jsonb not null default '[]'::jsonb,
  conflict_report jsonb not null default '[]'::jsonb,
  rule_bundle_id uuid,
  rule_bundle_version integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  analysis_job_id uuid,
  constraint contract_review_submission_batches_pkey primary key (id),
  constraint contract_review_submission_batches_org_id_fkey
    foreign key (org_id) references public.organizations(id) on delete cascade,
  constraint contract_review_submission_batches_contract_id_fkey
    foreign key (contract_id) references public.contracts(id) on delete cascade,
  constraint contract_review_submission_batches_source_review_id_fkey
    foreign key (source_review_id) references public.contract_reviews(id) on delete cascade,
  constraint contract_review_submission_batches_new_review_id_fkey
    foreign key (new_review_id) references public.contract_reviews(id) on delete set null,
  constraint contract_review_submission_batches_submitted_by_fkey
    foreign key (submitted_by) references public.users(id) on delete restrict,
  constraint contract_review_submission_batches_rule_bundle_id_fkey
    foreign key (rule_bundle_id) references public.contract_skill_bundles(id) on delete set null,
  constraint contract_review_submission_batches_analysis_job_id_fkey
    foreign key (analysis_job_id) references public.contract_analysis_jobs(id) on delete set null,
  constraint contract_review_submission_batches_review_style_check
    check (review_style in ('lenient', 'balanced', 'strict')),
  constraint contract_review_submission_batches_status_check
    check (status in ('checking', 'conflict', 'review_running', 'completed', 'failed'))
);

create table if not exists public.contract_review_decision_drafts (
  id uuid default gen_random_uuid(),
  org_id uuid not null,
  contract_id uuid not null,
  review_id uuid not null,
  risk_id uuid not null,
  created_by uuid not null,
  status text not null default 'draft_selected'::text,
  decision_kind text,
  selected_option_id text,
  selected_option_snapshot jsonb,
  feedback text,
  comment_preview text,
  source_anchor jsonb not null default '{}'::jsonb,
  rule_bundle_id uuid,
  rule_bundle_version integer,
  submission_batch_id uuid,
  optimistic_version integer not null default 1,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  internal_note text,
  customer_comment text,
  resolution_strategy_id text,
  resolution_strategy_snapshot jsonb,
  negotiation_result text,
  translation_input_snapshot jsonb,
  revision_text text,
  evidence_anchors jsonb not null default '[]'::jsonb,
  workflow_state text not null default 'OPEN'::text,
  constraint contract_review_decision_drafts_pkey primary key (id),
  constraint contract_review_decision_drafts_org_id_fkey
    foreign key (org_id) references public.organizations(id) on delete cascade,
  constraint contract_review_decision_drafts_contract_id_fkey
    foreign key (contract_id) references public.contracts(id) on delete cascade,
  constraint contract_review_decision_drafts_review_id_fkey
    foreign key (review_id) references public.contract_reviews(id) on delete cascade,
  constraint contract_review_decision_drafts_risk_id_fkey
    foreign key (risk_id) references public.contract_risk_cards(id) on delete cascade,
  constraint contract_review_decision_drafts_created_by_fkey
    foreign key (created_by) references public.users(id) on delete cascade,
  constraint contract_review_decision_drafts_rule_bundle_id_fkey
    foreign key (rule_bundle_id) references public.contract_skill_bundles(id) on delete set null,
  constraint contract_review_decision_drafts_submission_batch_id_fkey
    foreign key (submission_batch_id) references public.contract_review_submission_batches(id) on delete set null,
  constraint contract_review_decision_draft_review_id_risk_id_created_by_key
    unique (review_id, risk_id, created_by),
  constraint contract_review_decision_drafts_status_check
    check (status in ('draft_selected', 'batch_submitted')),
  constraint contract_review_decision_drafts_decision_kind_check
    check (decision_kind in ('customer_agreed', 'customer_feedback', 'exception_requested')),
  constraint contract_review_decision_drafts_negotiation_result_check
    check (
      negotiation_result is null
      or negotiation_result in ('customer_agreed', 'customer_feedback', 'exception_requested')
    ),
  constraint contract_review_decision_drafts_workflow_state_check
    check (workflow_state in (
      'OPEN', 'STRATEGY_SELECTED', 'RESULT_RECORDED', 'DRAFT_READY',
      'REVIEW_QUEUED', 'REVIEW_PASSED', 'NEEDS_REVISION'
    ))
);

create table if not exists public.contract_source_page_maps (
  contract_id uuid,
  storage_path text not null,
  source_hash text not null,
  render_mode text not null,
  page_count integer not null,
  locator text not null,
  page_map jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  constraint contract_source_page_maps_pkey primary key (contract_id),
  constraint contract_source_page_maps_contract_id_fkey
    foreign key (contract_id) references public.contracts(id) on delete cascade,
  constraint contract_source_page_maps_render_mode_check
    check (render_mode in ('native-pdf', 'docx-to-pdf')),
  constraint contract_source_page_maps_page_count_check
    check (page_count > 0),
  constraint contract_source_page_maps_locator_check
    check (locator in ('rendered', 'provisional'))
);

create index if not exists idx_contract_review_submission_batches_contract
  on public.contract_review_submission_batches using btree (contract_id, created_at desc);

create index if not exists idx_contract_review_decision_drafts_workbench
  on public.contract_review_decision_drafts using btree (contract_id, review_id, created_by, status);

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'contract_review_submission_batches',
    'contract_review_decision_drafts',
    'contract_source_page_maps'
  ]
  loop
    if not (
      select c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = target_table
    ) then
      execute format('alter table public.%I enable row level security', target_table);
    end if;
  end loop;
end;
$$;

revoke all on table public.contract_review_submission_batches from public, anon, authenticated;
revoke all on table public.contract_review_decision_drafts from public, anon, authenticated;
revoke all on table public.contract_source_page_maps from public, anon, authenticated;

grant all on table public.contract_review_submission_batches to service_role;
grant all on table public.contract_review_decision_drafts to service_role;
grant all on table public.contract_source_page_maps to service_role;

-- Fail closed if the result is not byte-for-byte equivalent at the catalog
-- definition level to the audited Production prerequisite schema.
do $$
declare
  column_fingerprint text;
  constraint_fingerprint text;
  index_fingerprint text;
begin
  with target_tables(table_name) as (
    values ('contract_review_submission_batches'),
           ('contract_review_decision_drafts'),
           ('contract_source_page_maps')
  )
  select encode(extensions.digest(jsonb_agg(
    jsonb_build_object(
      'table', c.relname,
      'ordinal', a.attnum,
      'column', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'nullable', not a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid)
    ) order by c.relname, a.attnum
  )::text, 'sha256'), 'hex')
    into column_fingerprint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join target_tables t on t.table_name = c.relname
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where n.nspname = 'public';

  with target_tables(table_name) as (
    values ('contract_review_submission_batches'),
           ('contract_review_decision_drafts'),
           ('contract_source_page_maps')
  )
  select encode(extensions.digest(jsonb_agg(
    jsonb_build_object(
      'table', c.relname,
      'name', con.conname,
      'type', con.contype,
      'validated', con.convalidated,
      'definition', pg_get_constraintdef(con.oid, true)
    ) order by c.relname, con.conname
  )::text, 'sha256'), 'hex')
    into constraint_fingerprint
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join target_tables t on t.table_name = c.relname
   where n.nspname = 'public';

  with target_tables(table_name) as (
    values ('contract_review_submission_batches'),
           ('contract_review_decision_drafts'),
           ('contract_source_page_maps')
  )
  select encode(extensions.digest(jsonb_agg(
    jsonb_build_object(
      'table', i.tablename,
      'name', i.indexname,
      'definition', i.indexdef
    ) order by i.tablename, i.indexname
  )::text, 'sha256'), 'hex')
    into index_fingerprint
    from pg_indexes i
    join target_tables t on t.table_name = i.tablename
   where i.schemaname = 'public';

  if column_fingerprint <> '5548efb63e415820e279935c5e76d65b310af3a7a6a06dfbbf5dbaade2064597' then
    raise exception 'G5 baseline column fingerprint mismatch: %', column_fingerprint
      using errcode = '55000';
  end if;

  if constraint_fingerprint <> '61e906266672bfcc6bf8fd37d6809dd97b5df1c83d78f90396752fd996fa82a0' then
    raise exception 'G5 baseline constraint fingerprint mismatch: %', constraint_fingerprint
      using errcode = '55000';
  end if;

  if index_fingerprint <> '066ce7987d29e09a6f4795928b00a5b164b5c9bd557b0a2f5d52e6eac6b90e21' then
    raise exception 'G5 baseline index fingerprint mismatch: %', index_fingerprint
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in (
         'contract_review_submission_batches',
         'contract_review_decision_drafts',
         'contract_source_page_maps'
       )
       and not c.relrowsecurity
  ) then
    raise exception 'G5 baseline reconciliation requires RLS on all target tables'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
      left join pg_roles role on role.oid = acl.grantee
     where n.nspname = 'public'
       and c.relname in (
         'contract_review_submission_batches',
         'contract_review_decision_drafts',
         'contract_source_page_maps'
       )
       and (acl.grantee = 0 or role.rolname in ('anon', 'authenticated'))
  ) then
    raise exception 'G5 baseline reconciliation left public Data API privileges on a service-only table'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from (values
        ('contract_review_submission_batches'),
        ('contract_review_decision_drafts'),
        ('contract_source_page_maps')
      ) as targets(name)
     where not (
       has_table_privilege('service_role', format('public.%I', name), 'SELECT')
       and has_table_privilege('service_role', format('public.%I', name), 'INSERT')
       and has_table_privilege('service_role', format('public.%I', name), 'UPDATE')
       and has_table_privilege('service_role', format('public.%I', name), 'DELETE')
     )
  ) then
    raise exception 'G5 baseline reconciliation did not preserve service_role CRUD access'
      using errcode = '42501';
  end if;
end;
$$;

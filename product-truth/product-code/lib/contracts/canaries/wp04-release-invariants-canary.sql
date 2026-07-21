-- WP04 Preview-only transactional release-invariant canary.
-- Target: isolated project vsfropnfsmnonkotywsx. Never run against Production.
-- Expected result: one JSON object with status=passed, followed by ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ACL is checked before role switching so a missing RLS policy cannot hide an
-- accidental table grant. Authenticated browsers receive SELECT only on the
-- five owner-facing tables; users and every anonymous target-table privilege
-- remain unavailable.
do $canary$
declare
  target_table regclass;
  privilege_name text;
begin
  if pg_catalog.has_table_privilege('authenticated', 'public.users', 'SELECT')
     or pg_catalog.has_column_privilege(
       'authenticated', 'public.users', 'password_hash', 'SELECT'
     ) then
    raise exception 'authenticated can read the internal user directory or password_hash';
  end if;

  foreach target_table in array array[
    'public.user_organizations'::regclass,
    'public.contracts'::regclass,
    'public.contract_versions'::regclass,
    'public.contract_reviews'::regclass,
    'public.contract_analysis_jobs'::regclass
  ]
  loop
    if not pg_catalog.has_table_privilege('authenticated', target_table, 'SELECT') then
      raise exception 'authenticated is missing required SELECT on %', target_table;
    end if;
    foreach privilege_name in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    loop
      if pg_catalog.has_table_privilege('authenticated', target_table, privilege_name) then
        raise exception 'authenticated retains % on %', privilege_name, target_table;
      end if;
    end loop;
  end loop;

  foreach target_table in array array[
    'public.users'::regclass,
    'public.user_organizations'::regclass,
    'public.contracts'::regclass,
    'public.contract_versions'::regclass,
    'public.contract_reviews'::regclass,
    'public.contract_analysis_jobs'::regclass
  ]
  loop
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    loop
      if pg_catalog.has_table_privilege('anon', target_table, privilege_name) then
        raise exception 'anon retains % on %', privilege_name, target_table;
      end if;
    end loop;
  end loop;
end
$canary$;

insert into public.organizations (id, name, slug)
values
  ('a0000000-0000-4000-8000-000000000001', 'WP04 Release Canary A', 'wp04-release-canary-a'),
  ('b0000000-0000-4000-8000-000000000001', 'WP04 Release Canary B', 'wp04-release-canary-b');

insert into public.users (
  id, org_id, email, display_name, password_hash, status, login_enabled
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'wp04-owner@example.invalid',
    'WP04 Owner',
    'not-a-real-password-hash',
    'active',
    true
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'wp04-peer@example.invalid',
    'WP04 Same Org Peer',
    null,
    'active',
    true
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000001',
    'wp04-inactive@example.invalid',
    'WP04 Inactive Owner',
    null,
    'inactive',
    true
  ),
  (
    'a1000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000001',
    'wp04-login-disabled@example.invalid',
    'WP04 Login Disabled Owner',
    null,
    'active',
    false
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'wp04-other@example.invalid',
    'WP04 Other Org',
    null,
    'active',
    true
  );

insert into public.user_organizations (user_id, org_id, is_default)
values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', true),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', true),
  ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', true),
  ('a1000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', true),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', true);

insert into public.contracts (
  id, filename, storage_path, size, mime_type, status, parsed_text, created_by, org_id
)
values (
  'c1000000-0000-4000-8000-000000000001',
  'wp04-release-canary.docx',
  'c1000000-0000-4000-8000-000000000001/8c026deb-a2ad-8ba0-b4c2-6975c29e73b0/source',
  1,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'PENDING',
  'wp04-release-canary',
  'a1000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001'
);

insert into public.contract_versions (
  id, contract_id, version_number, source, storage_path, file_size, mime_type,
  uploaded_by, upload_id, file_sha256, text_sha256, parsed_text, ingest_status
)
values (
  'c2000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  1,
  'original',
  'c1000000-0000-4000-8000-000000000001/8c026deb-a2ad-8ba0-b4c2-6975c29e73b0/source',
  1,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'a1000000-0000-4000-8000-000000000001',
  '8c026deb-a2ad-8ba0-b4c2-6975c29e73b0',
  repeat('a', 64),
  pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to('wp04-release-canary', 'UTF8'), 'sha256'),
    'hex'
  ),
  'wp04-release-canary',
  'SOURCE_READY'
);

-- This valid source binding proves the trigger exists and accepts a matching
-- immutable version without relying on any protected-snapshot-only table.
update public.contracts
   set current_version_id = 'c2000000-0000-4000-8000-000000000001'
 where id = 'c1000000-0000-4000-8000-000000000001';

insert into public.contract_source_page_maps (
  contract_id, contract_version_id, storage_path, source_hash, source_text_hash,
  render_mode, page_count, locator, page_map
)
values (
  'c1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001/8c026deb-a2ad-8ba0-b4c2-6975c29e73b0/source',
  repeat('a', 64),
  pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to('wp04-release-canary', 'UTF8'), 'sha256'),
    'hex'
  ),
  'browser-ooxml',
  1,
  'provisional',
  '[{"page":1,"start":0,"end":18,"locator":"provisional"}]'::jsonb
);

-- A stale upload fence is a deterministic 23514 conflict, never 40001.
do $canary$
begin
  begin
    perform *
      from public.start_initial_contract_review_fenced(
        'a0000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000001',
        'PENDING',
        null,
        null,
        repeat('b', 64)
      );
    raise exception 'stale source hash unexpectedly started a ReviewRun'
      using errcode = 'P0001';
  exception
    when sqlstate '40001' then
      raise exception 'deterministic source conflict still exposes retryable SQLSTATE 40001';
    when sqlstate '23514' then null;
  end;

  begin
    update public.contracts
       set filename = 'wp04-release-canary-renamed.docx'
     where id = 'c1000000-0000-4000-8000-000000000001';
    raise exception 'source mutation without a new version unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '23514' then null;
  end;

  begin
    insert into public.contract_reviews (
      contract_id, contract_version_id, status, review_trigger,
      source_storage_path, source_hash, source_text_hash
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      'PENDING',
      'initial_upload',
      'c1000000-0000-4000-8000-000000000001/8c026deb-a2ad-8ba0-b4c2-6975c29e73b0/source',
      repeat('b', 64),
      pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to('wp04-release-canary', 'UTF8'), 'sha256'),
        'hex'
      )
    );
    raise exception 'mismatched ReviewRun source identity unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '23514' then null;
  end;
end
$canary$;

insert into public.contract_reviews (
  id, contract_id, contract_version_id, status, review_trigger,
  source_storage_path, source_hash, source_text_hash
)
values (
  'c3000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'PENDING',
  'initial_upload',
  'c1000000-0000-4000-8000-000000000001/8c026deb-a2ad-8ba0-b4c2-6975c29e73b0/source',
  repeat('a', 64),
  pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to('wp04-release-canary', 'UTF8'), 'sha256'),
    'hex'
  )
);

insert into public.contract_analysis_jobs (
  id, contract_id, review_id, requested_by, status
)
values (
  'c4000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'queued'
);

-- Exercise a worker-state conflict too: a leased job cannot move a contract
-- from PENDING to ANALYZING, and the failure must not invite a transaction retry.
update public.contract_analysis_jobs
   set status = 'running',
       lock_token = 'c5000000-0000-4000-8000-000000000001',
       locked_by = 'wp04-release-canary',
       locked_at = pg_catalog.clock_timestamp()
 where id = 'c4000000-0000-4000-8000-000000000001';

do $canary$
begin
  begin
    perform *
      from public.mark_contract_analysis_job_running(
        'c4000000-0000-4000-8000-000000000001',
        'c5000000-0000-4000-8000-000000000001',
        'wp04-release-canary'
      );
    raise exception 'invalid worker state transition unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '40001' then
      raise exception 'deterministic worker conflict still exposes retryable SQLSTATE 40001';
    when sqlstate '23514' then null;
  end;
end
$canary$;

update public.contract_analysis_jobs
   set status = 'queued',
       lock_token = null,
       locked_by = null,
       locked_at = null
 where id = 'c4000000-0000-4000-8000-000000000001';

do $canary$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc as routine_proc
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = routine_proc.pronamespace
     where namespace.nspname = 'public'
       and routine_proc.proname = any(array[
         'finalize_contract_source_version',
         'start_initial_contract_review',
         'start_initial_contract_review_fenced',
         'mark_contract_analysis_job_running',
         'mark_contract_analysis_job_completed',
         'mark_contract_analysis_job_failed'
       ])
       and pg_catalog.pg_get_functiondef(routine_proc.oid) like '%40001%'
  ) then
    raise exception 'an active WP04 deterministic state fence still uses SQLSTATE 40001';
  end if;
end
$canary$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $canary$
begin
  begin
    perform 1 from public.users;
    raise exception 'authenticated user directory SELECT unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when insufficient_privilege then null;
  end;

  if (select count(*) from public.user_organizations
       where user_id = 'a1000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'owner cannot read their own organization membership';
  end if;
  if (select count(*) from public.contracts
       where id = 'c1000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.contract_versions
          where id = 'c2000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.contract_reviews
          where id = 'c3000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.contract_analysis_jobs
          where id = 'c4000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'owner cannot read the complete own-contract review chain';
  end if;

  begin
    perform 1 from public.contract_source_page_maps
     where contract_id = 'c1000000-0000-4000-8000-000000000001';
    raise exception 'authenticated page-map SELECT unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when insufficient_privilege then null;
  end;
end
$canary$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $canary$
begin
  if (select count(*) from public.contracts
       where id = 'c1000000-0000-4000-8000-000000000001') <> 0
     or (select count(*) from public.contract_versions
          where id = 'c2000000-0000-4000-8000-000000000001') <> 0
     or (select count(*) from public.contract_reviews
          where id = 'c3000000-0000-4000-8000-000000000001') <> 0
     or (select count(*) from public.contract_analysis_jobs
          where id = 'c4000000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'same-org non-owner can read an owner-only contract row';
  end if;
end
$canary$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $canary$
begin
  if (select count(*) from public.contracts
       where id = 'c1000000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'other-organization user can read an owner-only contract row';
  end if;
end
$canary$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);

do $canary$
begin
  if (select count(*) from public.user_organizations) <> 0
     or (select count(*) from public.contracts) <> 0 then
    raise exception 'inactive user received an organization identity';
  end if;
end
$canary$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);

do $canary$
begin
  if (select count(*) from public.user_organizations) <> 0
     or (select count(*) from public.contracts) <> 0 then
    raise exception 'login-disabled user received an organization identity';
  end if;
end
$canary$;

reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);

do $canary$
begin
  begin
    perform 1 from public.contracts;
    raise exception 'anonymous contract SELECT unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when insufficient_privilege then null;
  end;
end
$canary$;

reset role;
set local role service_role;

do $canary$
begin
  if (select count(*) from public.users
       where id = 'a1000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.contracts
          where id = 'c1000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.contract_versions
          where id = 'c2000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.contract_reviews
          where id = 'c3000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.contract_analysis_jobs
          where id = 'c4000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.contract_source_page_maps
          where contract_id = 'c1000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'service_role cannot read the complete source/review chain';
  end if;
end
$canary$;

reset role;

select pg_catalog.jsonb_build_object(
  'status', 'passed',
  'project', 'vsfropnfsmnonkotywsx',
  'owner_chain_visible', true,
  'same_org_nonowner_visible', false,
  'other_org_visible', false,
  'inactive_user_org_visible', false,
  'login_disabled_user_org_visible', false,
  'anon_acl', false,
  'browser_user_directory_select', false,
  'browser_password_hash_select', false,
  'browser_page_map_select', false,
  'deterministic_conflict_sqlstate', '23514',
  'service_role_visible', true,
  'rolled_back', true
) as wp04_release_invariants_canary;

rollback;

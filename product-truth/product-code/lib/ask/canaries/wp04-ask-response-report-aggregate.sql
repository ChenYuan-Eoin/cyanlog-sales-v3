-- Preview-only WP04 canary for submit_ask_response_report_aggregate.
-- It first forces the report insert to fail and proves that no response, ASK
-- transition, audit or current rollover leaks. It then removes the fault,
-- proves the complete aggregate, and rolls every fixture back.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if exists (select 1 from public.organizations where id = '24300000-0000-4000-8000-000000000001')
     or exists (select 1 from public.users where id = '24310000-0000-4000-8000-000000000001')
     or exists (select 1 from public.contracts where id = '24320000-0000-4000-8000-000000000001')
     or exists (select 1 from public.contract_versions where id = '24330000-0000-4000-8000-000000000001')
     or exists (select 1 from public.contract_reviews where id = '24340000-0000-4000-8000-000000000001')
     or exists (
       select 1 from public.ask_items
        where id in (
          '24350000-0000-4000-8000-000000000001'::uuid,
          '24350000-0000-4000-8000-000000000002'::uuid
        )
     )
     or exists (select 1 from public.report_versions where id = '24360000-0000-4000-8000-000000000001')
     or pg_catalog.to_regprocedure('public.wp04_canary_fail_ask_report()') is not null then
    raise exception 'WP04 ASK aggregate canary fixture already exists';
  end if;
end;
$preflight$;

insert into public.organizations (id, name, slug)
values (
  '24300000-0000-4000-8000-000000000001',
  'WP04 ASK aggregate canary',
  'wp04-ask-aggregate-canary-2430'
);

insert into public.users (
  id, org_id, email, display_name, password_hash, status, login_enabled
) values (
  '24310000-0000-4000-8000-000000000001',
  '24300000-0000-4000-8000-000000000001',
  'wp04-ask-aggregate@example.invalid',
  'WP04 ASK aggregate responder',
  null,
  'active',
  true
);

insert into public.user_organizations (user_id, org_id, is_default)
values (
  '24310000-0000-4000-8000-000000000001',
  '24300000-0000-4000-8000-000000000001',
  true
);

do $fixture$
declare
  v_contract_id constant uuid := '24320000-0000-4000-8000-000000000001';
  v_version_id constant uuid := '24330000-0000-4000-8000-000000000001';
  v_review_id constant uuid := '24340000-0000-4000-8000-000000000001';
  v_user_id constant uuid := '24310000-0000-4000-8000-000000000001';
  v_source_text constant text := 'WP04 ASK aggregate response report canary source.';
  v_file_hash constant text := '2430243024302430243024302430243024302430243024302430243024302430';
  v_text_hash text;
  v_upload_id uuid;
  v_source_path text;
begin
  v_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_source_text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_upload_id := private.wp04_expected_source_upload_id(v_contract_id, v_file_hash);
  v_source_path := v_contract_id::text || '/' || v_upload_id::text || '/source';

  insert into public.contracts (
    id, filename, storage_path, size, mime_type, status, parsed_text,
    created_by, org_id
  ) values (
    v_contract_id,
    'wp04-ask-aggregate.docx',
    v_source_path,
    128,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'PENDING',
    v_source_text,
    v_user_id,
    '24300000-0000-4000-8000-000000000001'
  );

  insert into public.contract_versions (
    id, contract_id, version_number, source, storage_path, file_size, mime_type,
    uploaded_by, upload_id, file_sha256, text_sha256, parsed_text, ingest_status
  ) values (
    v_version_id,
    v_contract_id,
    1,
    'original',
    v_source_path,
    128,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    v_user_id,
    v_upload_id,
    v_file_hash,
    v_text_hash,
    v_source_text,
    'SOURCE_READY'
  );

  update public.contracts
     set current_version_id = v_version_id
   where id = v_contract_id;

  insert into public.contract_source_page_maps (
    contract_id, contract_version_id, storage_path, source_hash,
    source_text_hash, render_mode, page_count, locator, page_map
  ) values (
    v_contract_id,
    v_version_id,
    v_source_path,
    v_file_hash,
    v_text_hash,
    'browser-ooxml',
    1,
    'provisional',
    '[{"page":1,"start":0,"end":48,"locator":"provisional"}]'::jsonb
  );

  insert into public.contract_reviews (
    id, contract_id, contract_version_id, status, review_trigger,
    source_storage_path, source_hash, source_text_hash, created_at
  ) values (
    v_review_id,
    v_contract_id,
    v_version_id,
    'COMPLETED',
    'initial_upload',
    v_source_path,
    v_file_hash,
    v_text_hash,
    '2026-07-21T15:00:00Z'::timestamptz
  );

  insert into public.ask_items (
    id, contract_id, ask_code, risk_name, initial_level, question_type,
    required_roles, question_text, qualified_std, status, trigger_user_id,
    review_id, contract_version_id, binding_state, created_at, updated_at
  ) values
  (
    '24350000-0000-4000-8000-000000000001',
    v_contract_id,
    'ASK-WP04-2430-A',
    'ASK aggregate atomicity',
    'red',
    'legal',
    array['legal'],
    'Can response and report commit separately?',
    'They must commit in one transaction.',
    'pending',
    v_user_id,
    v_review_id,
    v_version_id,
    'bound',
    '2026-07-21T15:01:00Z'::timestamptz,
    '2026-07-21T15:01:00Z'::timestamptz
  ),
  (
    '24350000-0000-4000-8000-000000000002',
    v_contract_id,
    'ASK-WP04-2430-B',
    'Unanswered snapshot control',
    'yellow',
    'financial',
    array['finance'],
    'Does the snapshot retain other pending tasks?',
    'The pending task remains in the report.',
    'pending',
    v_user_id,
    v_review_id,
    v_version_id,
    'bound',
    '2026-07-21T15:02:00Z'::timestamptz,
    '2026-07-21T15:02:00Z'::timestamptz
  );

  insert into public.report_versions (
    id, contract_id, review_id, contract_version_id, binding_state, version,
    trigger_event, trigger_user_id, report_data, is_current, created_at
  ) values (
    '24360000-0000-4000-8000-000000000001',
    v_contract_id,
    v_review_id,
    v_version_id,
    'bound',
    1,
    'initial_generate',
    v_user_id,
    '{"canary":"initial"}'::jsonb,
    true,
    '2026-07-21T15:03:00Z'::timestamptz
  );
end;
$fixture$;

create function public.wp04_canary_fail_ask_report()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.review_id = '24340000-0000-4000-8000-000000000001'::uuid
     and new.trigger_event = 'ask_responded' then
    raise exception 'forced report publication failure';
  end if;
  return new;
end;
$function$;

create trigger wp04_canary_fail_ask_report
before insert on public.report_versions
for each row execute function public.wp04_canary_fail_ask_report();

do $forced_failure$
declare
  v_error text;
begin
  begin
    perform *
      from public.submit_ask_response_report_aggregate(
        '24350000-0000-4000-8000-000000000001',
        '24320000-0000-4000-8000-000000000001',
        '24340000-0000-4000-8000-000000000001',
        '24330000-0000-4000-8000-000000000001',
        '24310000-0000-4000-8000-000000000001',
        'legal',
        'WP04 ASK aggregate responder',
        'The aggregate must roll back when report publication fails.',
        '[]'::jsonb
      );
    raise exception 'forced report failure was unexpectedly accepted';
  exception
    when raise_exception then
      get stacked diagnostics v_error = message_text;
      if v_error <> 'forced report publication failure' then
        raise;
      end if;
  end;

  if exists (
    select 1 from public.ask_responses
     where ask_id = '24350000-0000-4000-8000-000000000001'
  ) then
    raise exception 'response leaked after forced report failure';
  end if;

  if not exists (
    select 1 from public.ask_items
     where id = '24350000-0000-4000-8000-000000000001'
       and status = 'pending'
       and response_id is null
  ) then
    raise exception 'ASK state leaked after forced report failure';
  end if;

  if exists (
    select 1 from public.ask_audit_logs
     where ask_id = '24350000-0000-4000-8000-000000000001'
  ) then
    raise exception 'audit row leaked after forced report failure';
  end if;

  if (select count(*) from public.report_versions
       where review_id = '24340000-0000-4000-8000-000000000001') <> 1
     or not exists (
       select 1 from public.report_versions
        where id = '24360000-0000-4000-8000-000000000001'
          and version = 1
          and is_current = true
     ) then
    raise exception 'report rollover leaked after forced report failure';
  end if;
end;
$forced_failure$;

drop trigger wp04_canary_fail_ask_report on public.report_versions;
drop function public.wp04_canary_fail_ask_report();

do $success$
declare
  v_result record;
  v_report_data jsonb;
  v_response_id uuid;
begin
  select *
    into v_result
    from public.submit_ask_response_report_aggregate(
      '24350000-0000-4000-8000-000000000001',
      '24320000-0000-4000-8000-000000000001',
      '24340000-0000-4000-8000-000000000001',
      '24330000-0000-4000-8000-000000000001',
      '24310000-0000-4000-8000-000000000001',
      'legal',
      'WP04 ASK aggregate responder',
      'The complete response is present in report version 2.',
      '[{"name":"evidence.txt"}]'::jsonb
    );

  v_response_id := (v_result.response ->> 'id')::uuid;
  if v_result.ask_status_after <> 'responded'
     or (v_result.report_version ->> 'version')::integer <> 2
     or (v_result.report_version ->> 'is_current')::boolean is not true then
    raise exception 'successful ASK aggregate did not return the committed identities';
  end if;

  if not exists (
    select 1 from public.ask_items
     where id = '24350000-0000-4000-8000-000000000001'
       and status = 'responded'
       and response_id = v_response_id
  ) or not exists (
    select 1 from public.ask_responses
     where id = v_response_id
       and ask_id = '24350000-0000-4000-8000-000000000001'
       and response_text = 'The complete response is present in report version 2.'
  ) then
    raise exception 'response and ASK state were not committed together';
  end if;

  if (select count(*) from public.ask_audit_logs
       where ask_id = '24350000-0000-4000-8000-000000000001'
         and event_type in ('responded', 'report_generated')) <> 2 then
    raise exception 'ASK aggregate audit chain is incomplete';
  end if;

  if (select count(*) from public.report_versions
       where review_id = '24340000-0000-4000-8000-000000000001'
         and is_current = true) <> 1
     or not exists (
       select 1 from public.report_versions
        where id = '24360000-0000-4000-8000-000000000001'
          and is_current = false
     ) then
    raise exception 'report current rollover is inconsistent';
  end if;

  select report.report_data
    into v_report_data
    from public.report_versions as report
   where report.review_id = '24340000-0000-4000-8000-000000000001'
     and report.version = 2
     and report.is_current = true;

  if (v_report_data #>> '{summary,total}')::integer <> 2
     or (v_report_data #>> '{summary,pending}')::integer <> 1
     or (v_report_data #>> '{summary,responded}')::integer <> 1
     or not exists (
       select 1
         from pg_catalog.jsonb_array_elements(v_report_data -> 'ask_items') as item
        where item ->> 'id' = '24350000-0000-4000-8000-000000000001'
          and item #>> '{response,response_text}' =
            'The complete response is present in report version 2.'
     ) then
    raise exception 'report snapshot does not contain the committed response';
  end if;
end;
$success$;

rollback;

select pg_catalog.jsonb_build_object(
  'status', case when count(*) = 0 then 'passed' else 'failed' end,
  'project', 'vsfropnfsmnonkotywsx',
  'rolled_back', true,
  'fixture_rows_after_rollback', count(*)
) as wp04_ask_response_report_aggregate_canary
from (
  select id::text as fixture_id from public.organizations
   where id = '24300000-0000-4000-8000-000000000001'
  union all
  select id::text from public.users
   where id = '24310000-0000-4000-8000-000000000001'
  union all
  select id::text from public.contracts
   where id = '24320000-0000-4000-8000-000000000001'
  union all
  select id::text from public.contract_versions
   where id = '24330000-0000-4000-8000-000000000001'
  union all
  select id::text from public.contract_reviews
   where id = '24340000-0000-4000-8000-000000000001'
  union all
  select id::text from public.ask_items
   where id in (
     '24350000-0000-4000-8000-000000000001'::uuid,
     '24350000-0000-4000-8000-000000000002'::uuid
   )
  union all
  select id::text from public.ask_responses
   where ask_id in (
     '24350000-0000-4000-8000-000000000001'::uuid,
     '24350000-0000-4000-8000-000000000002'::uuid
   )
  union all
  select id::text from public.ask_audit_logs
   where ask_id in (
     '24350000-0000-4000-8000-000000000001'::uuid,
     '24350000-0000-4000-8000-000000000002'::uuid
   )
  union all
  select id::text from public.report_versions
   where review_id = '24340000-0000-4000-8000-000000000001'
) as canary_fixture;

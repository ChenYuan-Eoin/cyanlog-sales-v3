-- WP04: an ASK response is not complete until the response, ASK state,
-- audit trail and the next current report snapshot all commit together.
-- Serialize on the current contract source and ReviewRun so concurrent ASK
-- responses cannot race report max(version), current rollover or snapshots.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.submit_ask_response_report_aggregate(
  p_ask_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_contract_version_id uuid,
  p_responder_id uuid,
  p_responder_role text,
  p_responder_name text,
  p_response_text text,
  p_attachments jsonb default '[]'::jsonb
)
returns table (
  response jsonb,
  ask_status_after text,
  report_version jsonb
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_contract public.contracts%rowtype;
  v_version public.contract_versions%rowtype;
  v_review public.contract_reviews%rowtype;
  v_ask public.ask_items%rowtype;
  v_response public.ask_responses%rowtype;
  v_latest_report public.report_versions%rowtype;
  v_report public.report_versions%rowtype;
  v_report_data jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_next_report_version integer;
begin
  if p_ask_id is null
     or p_contract_id is null
     or p_review_id is null
     or p_contract_version_id is null
     or p_responder_id is null
     or nullif(pg_catalog.btrim(p_responder_role), '') is null
     or nullif(pg_catalog.btrim(p_responder_name), '') is null
     or nullif(pg_catalog.btrim(p_response_text), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_response_text)) > 10000
     or p_attachments is null
     or pg_catalog.jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'complete ASK response aggregate payload is required'
      using errcode = '23514';
  end if;

  -- Keep the same contract -> source version -> ReviewRun lock order as the
  -- review worker.  The contract lock also fences a source switch or a newer
  -- ReviewRun from becoming current halfway through the response transaction.
  select contract.*
    into v_contract
    from public.contracts as contract
   where contract.id = p_contract_id
   for update;

  if not found
     or v_contract.current_version_id is distinct from p_contract_version_id then
    raise exception 'ASK response requires the current contract source version'
      using errcode = '55000';
  end if;

  select version.*
    into v_version
    from public.contract_versions as version
   where version.id = p_contract_version_id
     and version.contract_id = p_contract_id
     and version.ingest_status = 'SOURCE_READY'
   for share;

  if not found then
    raise exception 'ASK response source version is not ready'
      using errcode = '55000';
  end if;

  select review.*
    into v_review
    from public.contract_reviews as review
   where review.contract_id = p_contract_id
     and review.contract_version_id = p_contract_version_id
   order by review.created_at desc nulls last, review.id desc
   limit 1
   for update;

  if not found
     or v_review.id is distinct from p_review_id
     or pg_catalog.upper(coalesce(v_review.status, '')) not in ('COMPLETED', 'DEGRADED')
     or v_review.source_storage_path is distinct from v_version.storage_path
     or v_review.source_hash is distinct from v_version.file_sha256
     or v_review.source_text_hash is distinct from v_version.text_sha256 then
    raise exception 'ASK response requires the latest completed review for the current source'
      using errcode = '55000';
  end if;

  perform 1
    from public.contract_source_page_maps as page_map
   where page_map.contract_id = p_contract_id
     and page_map.contract_version_id = p_contract_version_id
     and page_map.storage_path = v_version.storage_path
     and page_map.source_hash = v_version.file_sha256
     and page_map.source_text_hash is not distinct from v_version.text_sha256
   for share;

  if not found then
    raise exception 'ASK response source page map is missing or stale'
      using errcode = '55000';
  end if;

  select ask.*
    into v_ask
    from public.ask_items as ask
   where ask.id = p_ask_id
     and ask.contract_id = p_contract_id
     and ask.review_id = p_review_id
     and ask.contract_version_id = p_contract_version_id
     and ask.binding_state = 'bound'
   for update;

  if not found then
    raise exception 'ASK is not bound to the current review source'
      using errcode = '23514';
  end if;

  if v_ask.status is distinct from 'pending' or v_ask.response_id is not null then
    raise exception 'ASK is no longer pending'
      using errcode = '23514';
  end if;

  insert into public.ask_responses (
    ask_id,
    responder_id,
    responder_role,
    responder_name,
    response_text,
    attachments,
    created_at
  ) values (
    p_ask_id,
    p_responder_id,
    pg_catalog.btrim(p_responder_role),
    pg_catalog.btrim(p_responder_name),
    pg_catalog.btrim(p_response_text),
    p_attachments,
    v_now
  )
  returning * into v_response;

  update public.ask_items as ask
     set status = 'responded',
         response_id = v_response.id,
         updated_at = v_now
   where ask.id = v_ask.id
     and ask.status = 'pending'
     and ask.response_id is null
  returning * into v_ask;

  if not found then
    raise exception 'ASK state changed while the response was being submitted'
      using errcode = '40001';
  end if;

  insert into public.ask_audit_logs (
    ask_id,
    contract_id,
    actor_id,
    actor_role,
    event_type,
    from_status,
    to_status,
    payload,
    created_at
  ) values (
    v_ask.id,
    p_contract_id,
    p_responder_id,
    pg_catalog.btrim(p_responder_role),
    'responded',
    'pending',
    'responded',
    pg_catalog.jsonb_build_object('response_id', v_response.id),
    v_now
  );

  -- Build the report from the state visible inside this transaction. The
  -- response inserted above and the ASK status transition therefore cannot be
  -- missing from the report that this same transaction publishes.
  select pg_catalog.jsonb_build_object(
    'generated_at', v_now,
    'trigger_event', 'ask_responded',
    'trigger_ask_id', p_ask_id,
    'summary', pg_catalog.jsonb_build_object(
      'total', pg_catalog.count(*),
      'pending', pg_catalog.count(*) filter (where ask.status = 'pending'),
      'responded', pg_catalog.count(*) filter (where ask.status = 'responded'),
      'closed', pg_catalog.count(*) filter (where ask.status = 'closed')
    ),
    'ask_items', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', ask.id,
          'ask_code', ask.ask_code,
          'clause_ref', ask.clause_ref,
          'risk_name', ask.risk_name,
          'initial_level', ask.initial_level,
          'question_type', ask.question_type,
          'required_roles', ask.required_roles,
          'question_text', ask.question_text,
          'qualified_std', ask.qualified_std,
          'status', ask.status,
          'response_id', ask.response_id,
          'closed_reason', ask.closed_reason,
          'created_at', ask.created_at,
          'updated_at', ask.updated_at,
          'response', case
            when answer.id is null then null
            else pg_catalog.jsonb_build_object(
              'id', answer.id,
              'responder_id', answer.responder_id,
              'responder_role', answer.responder_role,
              'responder_name', answer.responder_name,
              'response_text', answer.response_text,
              'attachments', answer.attachments,
              'created_at', answer.created_at
            )
          end
        ) order by ask.created_at, ask.id
      ),
      '[]'::jsonb
    )
  )
    into v_report_data
    from public.ask_items as ask
    left join public.ask_responses as answer
      on answer.id = ask.response_id
     and answer.ask_id = ask.id
   where ask.contract_id = p_contract_id
     and ask.review_id = p_review_id
     and ask.contract_version_id = p_contract_version_id
     and ask.binding_state = 'bound';

  -- The ReviewRun row lock serializes every caller of this RPC, including the
  -- empty-report case. Locking the latest row additionally fences a legacy
  -- writer while max(version), current rollover and insert happen atomically.
  select report.*
    into v_latest_report
    from public.report_versions as report
   where report.review_id = p_review_id
     and report.contract_version_id = p_contract_version_id
     and report.binding_state = 'bound'
   order by report.version desc, report.id desc
   limit 1
   for update;

  v_next_report_version := coalesce(v_latest_report.version, 0) + 1;

  update public.report_versions as report
     set is_current = false
   where report.review_id = p_review_id
     and report.contract_version_id = p_contract_version_id
     and report.binding_state = 'bound'
     and report.is_current = true;

  insert into public.report_versions (
    contract_id,
    review_id,
    contract_version_id,
    binding_state,
    version,
    trigger_event,
    trigger_ask_id,
    trigger_user_id,
    no_ask_reason,
    report_data,
    report_file_url,
    is_current,
    created_at
  ) values (
    p_contract_id,
    p_review_id,
    p_contract_version_id,
    'bound',
    v_next_report_version,
    'ask_responded',
    p_ask_id,
    p_responder_id,
    null,
    v_report_data,
    null,
    true,
    v_now
  )
  returning * into v_report;

  insert into public.ask_audit_logs (
    ask_id,
    contract_id,
    actor_id,
    actor_role,
    event_type,
    from_status,
    to_status,
    payload,
    created_at
  ) values (
    v_ask.id,
    p_contract_id,
    p_responder_id,
    pg_catalog.btrim(p_responder_role),
    'report_generated',
    'responded',
    'responded',
    pg_catalog.jsonb_build_object(
      'response_id', v_response.id,
      'report_version_id', v_report.id,
      'report_version', v_report.version,
      'trigger_event', 'ask_responded'
    ),
    v_now
  );

  return query
  select
    pg_catalog.to_jsonb(v_response),
    'responded'::text,
    pg_catalog.jsonb_build_object(
      'id', v_report.id,
      'version', v_report.version,
      'is_current', v_report.is_current,
      'trigger_event', v_report.trigger_event,
      'created_at', v_report.created_at
    );
end;
$function$;

revoke all on function public.submit_ask_response_report_aggregate(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.submit_ask_response_report_aggregate(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) to service_role;

commit;

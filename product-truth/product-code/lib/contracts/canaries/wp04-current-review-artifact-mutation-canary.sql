-- WP04 Preview-only current ReviewRun ASK mutation canary.
-- Target: isolated project vsfropnfsmnonkotywsx. Never run against Production.
-- Expected result: one JSON object with status=passed, followed by ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into public.organizations (id, name, slug)
values (
  'f0000000-0000-4000-8000-000000000001',
  'WP04 Current Review ASK Canary',
  'wp04-current-review-ask-canary'
);

insert into public.users (
  id, org_id, email, display_name, password_hash, status, login_enabled
)
values (
  'f1000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  'wp04-current-review-ask@example.invalid',
  'WP04 Current Review ASK',
  null,
  'active',
  true
);

insert into public.user_organizations (user_id, org_id, is_default)
values (
  'f1000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  true
);

do $canary$
declare
  target_contract_id constant uuid := 'f2000000-0000-4000-8000-000000000001';
  target_version_id constant uuid := 'f3000000-0000-4000-8000-000000000001';
  replacement_version_id constant uuid := 'f3000000-0000-4000-8000-000000000002';
  older_review_id constant uuid := 'f4000000-0000-4000-8000-000000000001';
  current_review_id constant uuid := 'f4000000-0000-4000-8000-000000000002';
  older_ask_id constant uuid := 'f7000000-0000-4000-8000-000000000001';
  current_ask_id constant uuid := 'f7000000-0000-4000-8000-000000000002';
  source_text constant text := 'WP04 只有当前文件的最新审核任务允许业务写入。';
  replacement_text constant text := 'WP04 当前文件已经替换，上一版本审核任务必须只读。';
  source_file_hash constant text := repeat('f', 64);
  replacement_file_hash constant text := repeat('a', 64);
  source_text_hash text;
  replacement_text_hash text;
  source_upload_id uuid;
  replacement_upload_id uuid;
  source_path text;
  replacement_path text;
begin
  source_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(source_text, 'UTF8'), 'sha256'),
    'hex'
  );
  source_upload_id := private.wp04_expected_source_upload_id(
    target_contract_id,
    source_file_hash
  );
  source_path := target_contract_id::text || '/' || source_upload_id::text || '/source';
  replacement_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(replacement_text, 'UTF8'), 'sha256'),
    'hex'
  );
  replacement_upload_id := private.wp04_expected_source_upload_id(
    target_contract_id,
    replacement_file_hash
  );
  replacement_path := target_contract_id::text || '/' || replacement_upload_id::text || '/source';

  insert into public.contracts (
    id, filename, storage_path, size, mime_type, status, parsed_text,
    created_by, org_id
  ) values (
    target_contract_id,
    'wp04-current-review-ask.docx',
    source_path,
    256,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'COMPLETED',
    source_text,
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001'
  );

  insert into public.contract_versions (
    id, contract_id, version_number, source, storage_path, file_size, mime_type,
    uploaded_by, upload_id, file_sha256, text_sha256, parsed_text, ingest_status
  ) values (
    target_version_id,
    target_contract_id,
    1,
    'original',
    source_path,
    256,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'f1000000-0000-4000-8000-000000000001',
    source_upload_id,
    source_file_hash,
    source_text_hash,
    source_text,
    'SOURCE_READY'
  );

  update public.contracts
     set current_version_id = target_version_id
   where id = target_contract_id;

  insert into public.contract_source_page_maps (
    contract_id, contract_version_id, storage_path, source_hash,
    source_text_hash, render_mode, page_count, locator, page_map
  ) values (
    target_contract_id,
    target_version_id,
    source_path,
    source_file_hash,
    source_text_hash,
    'browser-ooxml',
    1,
    'provisional',
    '[{"page":1,"start":0,"end":25,"locator":"provisional"}]'::jsonb
  );

  set constraints all immediate;
  set constraints all deferred;

  insert into public.contract_reviews (
    id, contract_id, contract_version_id, status, review_trigger,
    source_storage_path, source_hash, source_text_hash, created_at
  ) values (
    older_review_id,
    target_contract_id,
    target_version_id,
    'COMPLETED',
    'initial_upload',
    source_path,
    source_file_hash,
    source_text_hash,
    '2026-07-21T15:00:00Z'::timestamptz
  );

  insert into public.ask_items (
    id, contract_id, ask_code, risk_name, initial_level, question_type,
    required_roles, question_text, qualified_std, status, trigger_user_id,
    review_id, contract_version_id, binding_state
  ) values (
    older_ask_id,
    target_contract_id,
    'ASK-WP04-2390-OLD',
    '历史审核任务',
    'yellow',
    'legal',
    array['legal'],
    '历史审核任务还能修改吗？',
    '不能；只允许当前文件的最新审核任务写入。',
    'pending',
    'f1000000-0000-4000-8000-000000000001',
    older_review_id,
    target_version_id,
    'bound'
  );

  insert into public.contract_reviews (
    id, contract_id, contract_version_id, status, review_trigger,
    source_storage_path, source_hash, source_text_hash, created_at
  ) values (
    current_review_id,
    target_contract_id,
    target_version_id,
    'COMPLETED',
    'direct',
    source_path,
    source_file_hash,
    source_text_hash,
    '2026-07-21T15:10:00Z'::timestamptz
  );

  insert into public.ask_items (
    id, contract_id, ask_code, risk_name, initial_level, question_type,
    required_roles, question_text, qualified_std, status, trigger_user_id,
    review_id, contract_version_id, binding_state
  ) values (
    current_ask_id,
    target_contract_id,
    'ASK-WP04-2390-CURRENT',
    '当前审核任务',
    'yellow',
    'legal',
    array['legal'],
    '当前审核任务可以修改吗？',
    '可以；仍须通过业务状态机和当前来源校验。',
    'pending',
    'f1000000-0000-4000-8000-000000000001',
    current_review_id,
    target_version_id,
    'bound'
  );

  begin
    update public.ask_items
       set status = 'closed',
           closed_by = 'f1000000-0000-4000-8000-000000000001',
           closed_reason = 'This historical write must fail.'
     where id = older_ask_id;
    raise exception 'historical ReviewRun ASK mutation unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when check_violation then null;
  end;

  update public.ask_items
     set status = 'closed',
         closed_by = 'f1000000-0000-4000-8000-000000000001',
         closed_reason = 'Current ReviewRun write accepted.'
   where id = current_ask_id;

  if not exists (
    select 1
      from public.ask_items
     where id = older_ask_id
       and status = 'pending'
  ) or not exists (
    select 1
      from public.ask_items
     where id = current_ask_id
       and status = 'closed'
  ) then
    raise exception 'current/historical ReviewRun ASK mutation outcome is wrong';
  end if;

  insert into public.contract_versions (
    id, contract_id, version_number, source, storage_path, file_size, mime_type,
    uploaded_by, upload_id, file_sha256, text_sha256, parsed_text, ingest_status
  ) values (
    replacement_version_id,
    target_contract_id,
    2,
    'original',
    replacement_path,
    300,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'f1000000-0000-4000-8000-000000000001',
    replacement_upload_id,
    replacement_file_hash,
    replacement_text_hash,
    replacement_text,
    'SOURCE_READY'
  );

  delete from public.contract_source_page_maps
   where contract_id = target_contract_id;

  insert into public.contract_source_page_maps (
    contract_id, contract_version_id, storage_path, source_hash,
    source_text_hash, render_mode, page_count, locator, page_map
  ) values (
    target_contract_id,
    replacement_version_id,
    replacement_path,
    replacement_file_hash,
    replacement_text_hash,
    'browser-ooxml',
    1,
    'provisional',
    '[{"page":1,"start":0,"end":26,"locator":"provisional"}]'::jsonb
  );

  update public.contracts
     set current_version_id = replacement_version_id,
         storage_path = replacement_path,
         filename = 'wp04-current-review-ask-v2.docx',
         size = 300,
         parsed_text = replacement_text
   where id = target_contract_id;

  begin
    update public.ask_items
       set status = 'pending', closed_by = null, closed_reason = null
     where id = current_ask_id;
    raise exception 'non-current source ASK mutation unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when check_violation then null;
  end;
end
$canary$;

select pg_catalog.jsonb_build_object(
  'status', 'passed',
  'project', 'vsfropnfsmnonkotywsx',
  'rolled_back', true,
  'historical_review_immutable', true,
  'current_review_mutable', true,
  'non_current_source_immutable', true
) as wp04_current_review_artifact_mutation_canary;

rollback;

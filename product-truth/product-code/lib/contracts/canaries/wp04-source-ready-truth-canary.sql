-- WP04 Preview-only SOURCE_READY truth canary.
-- Target: isolated project vsfropnfsmnonkotywsx. Never run against Production.
-- Expected result: one JSON object with status=passed, followed by ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into public.organizations (id, name, slug)
values (
  'd0000000-0000-4000-8000-000000000001',
  'WP04 Source Truth Canary',
  'wp04-source-truth-canary'
);

insert into public.users (
  id, org_id, email, display_name, password_hash, status, login_enabled
)
values (
  'd1000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'wp04-source-truth@example.invalid',
  'WP04 Source Truth',
  null,
  'active',
  true
);

insert into public.user_organizations (user_id, org_id, is_default)
values (
  'd1000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  true
);

do $canary$
declare
  target_contract_id constant uuid := 'd2000000-0000-4000-8000-000000000001';
  first_version_id constant uuid := 'd3000000-0000-4000-8000-000000000001';
  second_version_id constant uuid := 'd3000000-0000-4000-8000-000000000002';
  first_file_hash constant text := repeat('d', 64);
  second_file_hash constant text := repeat('e', 64);
  first_text constant text := '第一版合同付款期限为三十日。';
  second_text constant text := '第二版合同付款期限为十五日。';
  first_text_hash text;
  second_text_hash text;
  first_upload_id uuid;
  second_upload_id uuid;
  first_path text;
  second_path text;
begin
  first_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(first_text, 'UTF8'), 'sha256'),
    'hex'
  );
  second_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(second_text, 'UTF8'), 'sha256'),
    'hex'
  );
  first_upload_id := private.wp04_expected_source_upload_id(target_contract_id, first_file_hash);
  second_upload_id := private.wp04_expected_source_upload_id(target_contract_id, second_file_hash);
  first_path := target_contract_id::text || '/' || first_upload_id::text || '/source';
  second_path := target_contract_id::text || '/' || second_upload_id::text || '/source';

  insert into public.contracts (
    id, filename, storage_path, size, mime_type, status, parsed_text, created_by, org_id
  ) values (
    target_contract_id,
    'wp04-source-truth-v1.docx',
    first_path,
    128,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'PENDING',
    first_text,
    'd1000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001'
  );

  insert into public.contract_versions (
    id, contract_id, version_number, source, storage_path, file_size, mime_type,
    uploaded_by, upload_id, file_sha256, text_sha256, parsed_text, ingest_status
  ) values (
    first_version_id,
    target_contract_id,
    1,
    'original',
    first_path,
    128,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'd1000000-0000-4000-8000-000000000001',
    first_upload_id,
    first_file_hash,
    first_text_hash,
    first_text,
    'SOURCE_READY'
  );

  update public.contracts
     set current_version_id = first_version_id
   where id = target_contract_id;

  insert into public.contract_source_page_maps (
    contract_id, contract_version_id, storage_path, source_hash, source_text_hash,
    render_mode, page_count, locator, page_map, generated_at
  ) values (
    target_contract_id,
    first_version_id,
    first_path,
    first_file_hash,
    first_text_hash,
    'browser-ooxml',
    1,
    'provisional',
    '[{"page":1,"start":0,"end":13,"locator":"provisional"}]'::jsonb,
    '2026-07-21T15:00:00Z'::timestamptz
  );

  set constraints all immediate;
  if not private.wp04_contract_source_version_ready_truth(first_version_id) then
    raise exception 'complete SOURCE_READY identity was rejected';
  end if;
  set constraints all deferred;

  begin
    insert into public.contract_versions (
      id, contract_id, version_number, source, storage_path, file_size, mime_type,
      uploaded_by, file_sha256, text_sha256, parsed_text, ingest_status
    ) values (
      'd3000000-0000-4000-8000-000000000099',
      target_contract_id,
      99,
      'review_revision',
      'legacy/output.docx',
      128,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'd1000000-0000-4000-8000-000000000001',
      null,
      null,
      null,
      'SOURCE_READY'
    );
    raise exception 'incomplete SOURCE_READY unexpectedly committed';
  exception
    when check_violation then null;
  end;

  insert into public.contract_versions (
    id, contract_id, version_number, source, storage_path, file_size, mime_type,
    parent_version_id, uploaded_by, upload_id, file_sha256, text_sha256,
    parsed_text, ingest_status
  ) values (
    second_version_id,
    target_contract_id,
    2,
    'manual_revision',
    second_path,
    128,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    first_version_id,
    'd1000000-0000-4000-8000-000000000001',
    second_upload_id,
    second_file_hash,
    second_text_hash,
    second_text,
    'SOURCE_READY'
  );

  update public.contracts
     set filename = 'wp04-source-truth-v2.docx',
         storage_path = second_path,
         size = 128,
         mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         parsed_text = second_text,
         current_version_id = second_version_id
   where id = target_contract_id;

  insert into public.contract_source_page_maps (
    contract_id, contract_version_id, storage_path, source_hash, source_text_hash,
    render_mode, page_count, locator, page_map, generated_at
  ) values (
    target_contract_id,
    second_version_id,
    second_path,
    second_file_hash,
    second_text_hash,
    'browser-ooxml',
    1,
    'provisional',
    '[{"page":1,"start":0,"end":13,"locator":"provisional"}]'::jsonb,
    '2026-07-21T15:01:00Z'::timestamptz
  )
  on conflict (contract_id) do update
    set contract_version_id = excluded.contract_version_id,
        storage_path = excluded.storage_path,
        source_hash = excluded.source_hash,
        source_text_hash = excluded.source_text_hash,
        render_mode = excluded.render_mode,
        page_count = excluded.page_count,
        locator = excluded.locator,
        page_map = excluded.page_map,
        generated_at = excluded.generated_at;

  set constraints all immediate;
  if not private.wp04_contract_source_version_ready_truth(first_version_id)
     or not private.wp04_contract_source_version_ready_truth(second_version_id) then
    raise exception 'historical version lost immutable page-map evidence';
  end if;

  if (select count(*) from public.contract_source_page_map_evidence
       where contract_id = target_contract_id) <> 2 then
    raise exception 'version-bound page-map evidence count is incorrect';
  end if;
end
$canary$;

select pg_catalog.jsonb_build_object(
  'status', 'passed',
  'project', 'vsfropnfsmnonkotywsx',
  'rolled_back', true,
  'valid_ready_preserved', true,
  'incomplete_ready_rejected', true,
  'historical_evidence_preserved', true
) as wp04_source_ready_truth_canary;

rollback;

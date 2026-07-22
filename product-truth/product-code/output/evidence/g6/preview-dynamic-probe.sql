-- G6 Preview-only transactional database contract probe.
--
-- This script deliberately uses synthetic frozen paths because it verifies the
-- database contract, not Storage. The application/browser acceptance separately
-- proves that those paths contain byte-for-byte frozen objects.
--
-- Every mutation below is enclosed in one transaction and rolled back. The final
-- SELECT executes after ROLLBACK and is the zero-residue proof surface.

begin;

do $probe$
declare
  old_contract_id constant uuid := '11165ce4-7b16-4d77-8d72-6a4a90c6d07e';
  new_contract_id constant uuid := '863119df-4e1a-46b5-9780-bedee49065c7';
  unavailable_contract_id constant uuid := 'd80953fc-ec49-44bd-b234-fbc854979d31';
  membership_org_id uuid := extensions.gen_random_uuid();
  original_org_id uuid;
  probe_org_id uuid;
  probe_creator_id uuid;
  valid_comparison_id uuid;
  failed_comparison_id uuid;
  comparison_diff_id uuid;
  old_source jsonb;
  new_source jsonb;
  unavailable_source jsonb;
  unreadable_new_source jsonb;
  bad_source jsonb;
  forged_source jsonb;
  forged_text text;
  first_new_character text;
  valid_diff jsonb;
  observed_status text;
  observed_error text;
  observed_count integer;
begin
  select contract.org_id, contract.created_by
    into original_org_id, probe_creator_id
    from public.contracts as contract
   where contract.id = old_contract_id;

  if original_org_id is null or probe_creator_id is null then
    raise exception 'PROBE_FIXTURE_IDENTITY_MISSING';
  end if;

  if not exists (
    select 1
      from public.contracts as contract
     where contract.id in (new_contract_id, unavailable_contract_id)
       and contract.org_id = original_org_id
       and contract.created_by = probe_creator_id
     group by contract.org_id, contract.created_by
    having count(*) = 2
  ) then
    raise exception 'PROBE_FIXTURE_ORG_MISMATCH';
  end if;

  -- Prove the forward migration fixed the real multi-org edge: the active
  -- creator remains anchored to users.org_id, while the comparison is created
  -- through a separate user_organizations membership. Everything is rolled
  -- back with the rest of this transaction.
  insert into public.organizations (id, name, slug, status)
  values (
    membership_org_id,
    'G6 transactional membership probe',
    'g6-membership-probe-' || pg_catalog.replace(membership_org_id::text, '-', ''),
    'active'
  );

  insert into public.user_organizations (user_id, org_id, is_default)
  values (probe_creator_id, membership_org_id, false);

  if exists (
    select 1
      from public.users as creator
     where creator.id = probe_creator_id
       and creator.org_id = membership_org_id
  ) then
    raise exception 'PROBE_SECOND_ORG_IS_NOT_A_MEMBERSHIP_ONLY_PATH';
  end if;

  update public.contracts
     set org_id = membership_org_id
   where id in (old_contract_id, new_contract_id, unavailable_contract_id);
  get diagnostics observed_count = row_count;
  if observed_count <> 3 then
    raise exception 'PROBE_FIXTURE_REHOME_FAILED';
  end if;
  probe_org_id := membership_org_id;

  select pg_catalog.jsonb_build_object(
    'contract_id', contract.id::text,
    'origin_storage_path', contract.storage_path,
    'storage_path', 'g6-frozen/' || probe_org_id::text || '/' ||
      extensions.gen_random_uuid()::text || '/old-' || contract.filename,
    'file_name', contract.filename,
    'file_size', contract.size,
    'mime_type', contract.mime_type,
    'file_sha256', page_map.source_hash,
    'text_sha256', page_map.source_text_hash,
    'parsed_text', coalesce(contract.parsed_text, ''),
    'text_reliability', 'verified',
    'render_mode', page_map.render_mode,
    'page_map', page_map.page_map
  )
    into old_source
    from public.contracts as contract
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
     and page_map.storage_path = contract.storage_path
   where contract.id = old_contract_id;

  select pg_catalog.jsonb_build_object(
    'contract_id', contract.id::text,
    'origin_storage_path', contract.storage_path,
    'storage_path', 'g6-frozen/' || probe_org_id::text || '/' ||
      extensions.gen_random_uuid()::text || '/new-' || contract.filename,
    'file_name', contract.filename,
    'file_size', contract.size,
    'mime_type', contract.mime_type,
    'file_sha256', page_map.source_hash,
    'text_sha256', page_map.source_text_hash,
    'parsed_text', coalesce(contract.parsed_text, ''),
    'text_reliability', 'verified',
    'render_mode', page_map.render_mode,
    'page_map', page_map.page_map
  )
    into new_source
    from public.contracts as contract
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
     and page_map.storage_path = contract.storage_path
   where contract.id = new_contract_id;

  first_new_character := public.contract_utf16_slice(new_source->>'parsed_text', 0, 1);
  if first_new_character is null or first_new_character = '' then
    raise exception 'PROBE_READABLE_FIXTURE_EMPTY';
  end if;

  valid_diff := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'diff_type', 'added',
    'baseline_text', '',
    'compare_text', first_new_character,
    'baseline_position', pg_catalog.jsonb_build_object('page', 1, 'start', 0, 'end', 0),
    'compare_position', pg_catalog.jsonb_build_object('page', 1, 'start', 0, 'end', 1),
    'semantic_change', 'Preview database probe only',
    'risk_level', 'green'
  ));

  valid_comparison_id := public.create_contract_comparison_v1(
    probe_org_id,
    probe_creator_id,
    'uploaded',
    old_source,
    new_source,
    valid_diff,
    'Transactional Preview probe',
    'No release data'
  );

  select comparison.status
    into observed_status
    from public.contract_comparisons as comparison
   where comparison.id = valid_comparison_id;
  if observed_status is distinct from 'completed' then
    raise exception 'PROBE_VALID_COMPARISON_NOT_COMPLETED';
  end if;

  select pg_catalog.count(*)
    into observed_count
    from public.contract_comparison_sources as source
   where source.comparison_id = valid_comparison_id
     and source.storage_path like 'g6-frozen/' || probe_org_id::text || '/%'
     and source.origin_storage_path <> source.storage_path;
  if observed_count <> 2 then
    raise exception 'PROBE_VALID_SOURCE_PAIR_NOT_FROZEN';
  end if;

  select diff.id
    into comparison_diff_id
    from public.comparison_diffs as diff
   where diff.comparison_id = valid_comparison_id;
  if comparison_diff_id is null then
    raise exception 'PROBE_VALID_DIFF_MISSING';
  end if;

  -- A self-consistent forged text/hash must still fail current-source identity.
  forged_text := pg_catalog.repeat(
    'X',
    public.contract_utf16_codeunit_length(old_source->>'parsed_text')
  );
  forged_source := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(old_source, '{parsed_text}', pg_catalog.to_jsonb(forged_text)),
    '{text_sha256}',
    pg_catalog.to_jsonb(pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(forged_text, 'UTF8'), 'sha256'),
      'hex'
    ))
  );
  begin
    perform public.create_contract_comparison_v1(
      probe_org_id, probe_creator_id, 'uploaded', forged_source, new_source,
      valid_diff, null, null
    );
    raise exception 'PROBE_FORGED_TEXT_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_SOURCE_CURRENT_IDENTITY_MISMATCH%' then
      raise;
    end if;
  end;

  -- A fake byte hash and a non-frozen path must both fail before persistence.
  bad_source := pg_catalog.jsonb_set(
    old_source,
    '{file_sha256}',
    pg_catalog.to_jsonb(pg_catalog.repeat('0', 64))
  );
  begin
    perform public.create_contract_comparison_v1(
      probe_org_id, probe_creator_id, 'uploaded', bad_source, new_source,
      valid_diff, null, null
    );
    raise exception 'PROBE_FAKE_FILE_HASH_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_SOURCE_CURRENT_IDENTITY_MISMATCH%' then
      raise;
    end if;
  end;

  bad_source := pg_catalog.jsonb_set(
    old_source,
    '{storage_path}',
    pg_catalog.to_jsonb('contracts/not-a-frozen-copy.docx'::text)
  );
  begin
    perform public.create_contract_comparison_v1(
      probe_org_id, probe_creator_id, 'uploaded', bad_source, new_source,
      valid_diff, null, null
    );
    raise exception 'PROBE_NON_FROZEN_PATH_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_OLD_SOURCE_HASH_OR_SIZE_INVALID%' then
      raise;
    end if;
  end;

  -- Exact source text and UTF-16 offsets are contractual, not advisory.
  begin
    perform public.create_contract_comparison_v1(
      probe_org_id,
      probe_creator_id,
      'uploaded',
      pg_catalog.jsonb_set(
        old_source,
        '{storage_path}',
        pg_catalog.to_jsonb('g6-frozen/' || probe_org_id::text || '/' ||
          extensions.gen_random_uuid()::text || '/old-range.docm')
      ),
      pg_catalog.jsonb_set(
        new_source,
        '{storage_path}',
        pg_catalog.to_jsonb('g6-frozen/' || probe_org_id::text || '/' ||
          extensions.gen_random_uuid()::text || '/new-range.docm')
      ),
      pg_catalog.jsonb_set(valid_diff, '{0,compare_text}', pg_catalog.to_jsonb('forged'::text)),
      null,
      null
    );
    raise exception 'PROBE_FALSE_DIFF_TEXT_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_DIFF_NEW_TEXT_RANGE_MISMATCH%' then
      raise;
    end if;
  end;

  -- Final comparison, source snapshots, and positioned diffs are immutable.
  begin
    update public.comparison_diffs
       set compare_text = compare_text || 'tamper'
     where comparison_diffs.id = comparison_diff_id;
    raise exception 'PROBE_FINAL_DIFF_UPDATE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_DIFF_IMMUTABLE%' then raise; end if;
  end;

  begin
    delete from public.comparison_diffs
     where comparison_diffs.id = comparison_diff_id;
    raise exception 'PROBE_FINAL_DIFF_DELETE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_DIFF_IMMUTABLE%' then raise; end if;
  end;

  begin
    insert into public.comparison_diffs (
      comparison_id, diff_type, baseline_position, compare_position,
      baseline_text, compare_text, sort_order
    ) values (
      valid_comparison_id, 'added',
      '{"page":1,"start":0,"end":0}'::jsonb,
      '{"page":1,"start":0,"end":1}'::jsonb,
      '', first_new_character, 99
    );
    raise exception 'PROBE_FINAL_DIFF_INSERT_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_DIFF_IMMUTABLE%' then raise; end if;
  end;

  begin
    update public.contract_comparison_sources
       set file_name = 'tampered.docm'
     where contract_comparison_sources.comparison_id = valid_comparison_id
       and contract_comparison_sources.role = 'old';
    raise exception 'PROBE_SOURCE_UPDATE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_SOURCE_IMMUTABLE%' then raise; end if;
  end;

  begin
    delete from public.contract_comparison_sources
     where contract_comparison_sources.comparison_id = valid_comparison_id
       and contract_comparison_sources.role = 'old';
    raise exception 'PROBE_SOURCE_DELETE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_SOURCE_IMMUTABLE%' then raise; end if;
  end;

  begin
    update public.contract_comparisons
       set ai_summary = 'tampered'
     where contract_comparisons.id = valid_comparison_id;
    raise exception 'PROBE_FINAL_PARENT_UPDATE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_IDENTITY_IMMUTABLE%' then raise; end if;
  end;

  begin
    delete from public.contract_comparisons
     where contract_comparisons.id = valid_comparison_id;
    raise exception 'PROBE_FINAL_PARENT_DELETE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_COMPARISON_IMMUTABLE%' then raise; end if;
  end;

  -- Direct post-migration legacy inserts are forbidden.
  begin
    insert into public.contract_comparisons (
      contract_id, created_by, baseline_type, baseline_doc_id, compare_doc_id,
      status, org_id, source_snapshot_version
    ) values (
      old_contract_id, probe_creator_id, 'uploaded', old_contract_id,
      new_contract_id, 'completed', null, 0
    );
    raise exception 'PROBE_LEGACY_INSERT_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%G6_LEGACY_COMPARISON_INSERT_FORBIDDEN%' then raise; end if;
  end;

  -- UPDATEs of an existing v1 diff are dynamically rejected above. The
  -- legacy-to-v1 re-parent edge has no Preview fixture after the insert gate;
  -- the migration contract test therefore locks the trigger's OLD+NEW check.

  -- An unreadable/empty source can be recorded only as failed, with zero diffs.
  select pg_catalog.jsonb_build_object(
    'contract_id', contract.id::text,
    'origin_storage_path', contract.storage_path,
    'storage_path', 'g6-frozen/' || probe_org_id::text || '/' ||
      extensions.gen_random_uuid()::text || '/unavailable-' || contract.filename,
    'file_name', contract.filename,
    'file_size', contract.size,
    'mime_type', contract.mime_type,
    'file_sha256', page_map.source_hash,
    'text_sha256', page_map.source_text_hash,
    'parsed_text', '',
    'text_reliability', 'unavailable',
    'render_mode', page_map.render_mode,
    'page_map', page_map.page_map
  )
    into unavailable_source
    from public.contracts as contract
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
     and page_map.storage_path = contract.storage_path
   where contract.id = unavailable_contract_id;

  unreadable_new_source := pg_catalog.jsonb_set(
    new_source,
    '{storage_path}',
    pg_catalog.to_jsonb('g6-frozen/' || probe_org_id::text || '/' ||
      extensions.gen_random_uuid()::text || '/unavailable-pair-new.docm')
  );
  failed_comparison_id := public.create_contract_comparison_v1(
    probe_org_id,
    probe_creator_id,
    'uploaded',
    unavailable_source,
    unreadable_new_source,
    '[]'::jsonb,
    'SOURCE_TEXT_UNAVAILABLE',
    null
  );

  select comparison.status, comparison.error_message
    into observed_status, observed_error
    from public.contract_comparisons as comparison
   where comparison.id = failed_comparison_id;
  if observed_status is distinct from 'failed'
     or observed_error is distinct from 'SOURCE_TEXT_UNAVAILABLE' then
    raise exception 'PROBE_UNREADABLE_SOURCE_FAKE_COMPLETION';
  end if;

  select pg_catalog.count(*)
    into observed_count
    from public.comparison_diffs as diff
   where diff.comparison_id = failed_comparison_id;
  if observed_count <> 0 then
    raise exception 'PROBE_UNREADABLE_SOURCE_HAS_FAKE_DIFFS';
  end if;
end;
$probe$;

rollback;

select
  'all_expected_rejections_and_multi_org_membership_passed' as outcome,
  (select pg_catalog.count(*) from public.contract_comparisons) as comparisons_after_rollback,
  (select pg_catalog.count(*) from public.comparison_diffs) as diffs_after_rollback,
  (select pg_catalog.count(*) from public.contract_comparison_sources) as sources_after_rollback,
  not pg_catalog.has_table_privilege('service_role', 'public.contract_comparison_sources', 'INSERT')
    as service_role_direct_insert_denied,
  pg_catalog.has_table_privilege('service_role', 'public.contract_comparison_sources', 'SELECT')
    as service_role_select_allowed,
  not pg_catalog.has_function_privilege(
    'anon',
    'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) as anon_rpc_denied,
  pg_catalog.has_function_privilege(
    'service_role',
    'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) as service_role_rpc_allowed;

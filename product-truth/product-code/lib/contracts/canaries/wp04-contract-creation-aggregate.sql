-- Preview-only WP04 canary. The transaction creates a complete aggregate,
-- simulates a legacy missing copied item, proves idempotent repair/no duplicate
-- behavior, verifies changed aggregate intent is rejected, then rolls back.

begin;

do $canary$
declare
  v_request_id constant uuid := '04c23600-0000-4000-8000-000000000001';
  v_org_id constant uuid := '04c23600-0000-4000-8000-000000000010';
  v_user_id constant uuid := '04c23600-0000-4000-8000-000000000011';
  v_quote_id constant uuid := '04c23600-0000-4000-8000-000000000012';
  v_other_quote_id uuid := gen_random_uuid();
  v_payload jsonb;
  v_created record;
  v_replayed record;
  v_deleted_quote_item_id uuid;
  v_expected_count integer;
  v_row_count integer;
  v_distinct_count integer;
begin
  if exists (
    select 1
      from public.contracts as stale_fixture
     where stale_fixture.client_request_id = v_request_id
  ) or exists (
    select 1 from public.organizations where id = v_org_id
  ) or exists (
    select 1 from public.users where id = v_user_id
  ) or exists (
    select 1 from public.quotes where id = v_quote_id
  ) or exists (
    select 1
      from public.quote_items
     where id in (
       '04c23600-0000-4000-8000-000000000013'::uuid,
       '04c23600-0000-4000-8000-000000000014'::uuid
     )
  ) then
    raise exception 'WP04 aggregate canary fixture already exists before transaction';
  end if;

  insert into public.organizations (id, name, slug)
  values (v_org_id, 'WP04 aggregate canary org', 'wp04-aggregate-canary-2360');

  insert into public.users (id, org_id, display_name)
  values (v_user_id, v_org_id, 'WP04 aggregate canary user');

  insert into public.quotes (
    id,
    quote_no,
    customer_name,
    subtotal,
    tax_amount,
    total_amount,
    status,
    created_by,
    org_id
  ) values (
    v_quote_id,
    'WP04-CANARY-Q-2360',
    'WP04 aggregate canary customer',
    300,
    0,
    300,
    'CONFIRMED',
    v_user_id,
    v_org_id
  );

  insert into public.quote_items (
    id,
    quote_id,
    product_type,
    name,
    quantity,
    unit_price,
    line_total,
    sort_order
  ) values
    (
      '04c23600-0000-4000-8000-000000000013'::uuid,
      v_quote_id,
      'service',
      'WP04 canary item A',
      1,
      100,
      100,
      1
    ),
    (
      '04c23600-0000-4000-8000-000000000014'::uuid,
      v_quote_id,
      'service',
      'WP04 canary item B',
      2,
      100,
      200,
      2
    );

  select count(*)::integer
    into v_expected_count
    from public.quote_items as source_item
   where source_item.quote_id = v_quote_id;

  v_payload := jsonb_build_object(
    'quote_id', v_quote_id,
    'party_b_name', 'WP04 aggregate canary'
  );

  select *
    into v_created
    from public.create_contract_aggregate_idempotent(
      v_org_id,
      v_user_id,
      v_request_id,
      v_payload,
      true
    );

  if v_created.recovered
    or v_created.item_count <> v_expected_count
    or v_created.contract_no !~ '^CT-[0-9]{8}-[0-9]{3,}$' then
    raise exception 'first aggregate create was not complete';
  end if;

  delete from public.contract_items as copied_item
   where copied_item.id = (
     select candidate_item.id
       from public.contract_items as candidate_item
      where candidate_item.contract_id = v_created.contract_id
      order by candidate_item.quote_item_id
      limit 1
   )
  returning copied_item.quote_item_id into v_deleted_quote_item_id;

  if v_deleted_quote_item_id is null then
    raise exception 'canary could not simulate a missing copied item';
  end if;

  select *
    into v_replayed
    from public.create_contract_aggregate_idempotent(
      v_org_id,
      v_user_id,
      v_request_id,
      v_payload,
      true
    );

  if not v_replayed.recovered
    or v_replayed.contract_id <> v_created.contract_id
    or v_replayed.item_count <> v_expected_count then
    raise exception 'idempotent replay did not repair the original aggregate';
  end if;

  select count(*)::integer, count(distinct copied_item.quote_item_id)::integer
    into v_row_count, v_distinct_count
    from public.contract_items as copied_item
   where copied_item.contract_id = v_created.contract_id;

  if v_row_count <> v_expected_count
    or v_distinct_count <> v_expected_count then
    raise exception 'idempotent replay produced missing or duplicate contract items';
  end if;

  begin
    perform *
      from public.create_contract_aggregate_idempotent(
        v_org_id,
        v_user_id,
        v_request_id,
        v_payload,
        false
      );
    raise exception 'changed quote item copy choice was accepted';
  exception
    when check_violation then null;
  end;

  begin
    perform *
      from public.create_contract_aggregate_idempotent(
        v_org_id,
        v_user_id,
        v_request_id,
        jsonb_set(v_payload, '{quote_id}', to_jsonb(v_other_quote_id::text)),
        true
      );
    raise exception 'changed quote identity was accepted';
  exception
    when check_violation then null;
  end;

  begin
    perform *
      from public.create_contract_aggregate_idempotent(
        v_org_id,
        v_user_id,
        v_request_id,
        jsonb_set(
          v_payload,
          '{party_b_name}',
          to_jsonb('changed business customer'::text)
        ),
        true
      );
    raise exception 'changed business payload was accepted';
  exception
    when check_violation then null;
  end;
end;
$canary$;

rollback;

select jsonb_build_object(
  'status', case when count(*) = 0 then 'passed' else 'failed' end,
  'project', 'vsfropnfsmnonkotywsx',
  'rolled_back', true,
  'fixture_rows_after_rollback', count(*)
) as wp04_contract_creation_aggregate_canary
from (
  select id::text as fixture_id
    from public.contracts
   where client_request_id = '04c23600-0000-4000-8000-000000000001'
  union all
  select id::text from public.organizations
   where id = '04c23600-0000-4000-8000-000000000010'
  union all
  select id::text from public.users
   where id = '04c23600-0000-4000-8000-000000000011'
  union all
  select id::text from public.quotes
   where id = '04c23600-0000-4000-8000-000000000012'
  union all
  select id::text from public.quote_items
   where id in (
     '04c23600-0000-4000-8000-000000000013'::uuid,
     '04c23600-0000-4000-8000-000000000014'::uuid
   )
) as canary_fixture;

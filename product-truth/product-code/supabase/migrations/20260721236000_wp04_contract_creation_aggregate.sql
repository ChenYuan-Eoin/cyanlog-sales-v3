-- WP04: contract creation is one aggregate, not a contract-head write followed
-- by a best-effort contract_items write. A browser retry with the same request
-- identity serializes here, recovers the head and fills any missing quote items
-- left by the legacy two-step route.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.contracts
  add column if not exists creation_include_quote_items boolean,
  add column if not exists creation_quote_item_ids uuid[];

comment on column public.contracts.creation_include_quote_items is
  'Immutable contract-create choice: copy the linked quote item set into the contract aggregate.';

comment on column public.contracts.creation_quote_item_ids is
  'Immutable quote item identity snapshot used to repair an idempotent contract-create replay.';

create or replace function public.create_contract_aggregate_idempotent(
  p_org_id uuid,
  p_created_by uuid,
  p_client_request_id uuid,
  p_contract jsonb,
  p_include_quote_items boolean default false
)
returns table (
  contract_id uuid,
  contract_no text,
  status text,
  party_b_name text,
  contract_amount numeric,
  recovered boolean,
  item_count integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_contract public.contracts%rowtype;
  v_requested_quote_id uuid;
  v_copy_quote_items boolean := coalesce(p_include_quote_items, false);
  v_quote_item_ids uuid[] := array[]::uuid[];
  v_recovered boolean := false;
  v_expected_item_count integer := 0;
  v_present_item_count integer := 0;
begin
  if p_org_id is null or p_created_by is null then
    raise exception 'contract aggregate requires organization and creator'
      using errcode = '23514';
  end if;

  if jsonb_typeof(p_contract) is distinct from 'object' then
    raise exception 'contract aggregate payload must be an object'
      using errcode = '23514';
  end if;

  v_requested_quote_id := nullif(p_contract ->> 'quote_id', '')::uuid;
  if v_requested_quote_id is null then
    v_copy_quote_items := false;
  end if;

  -- The unique index remains the final identity invariant. The transaction
  -- advisory lock additionally ensures a concurrent replay cannot observe a
  -- head before its items or race the legacy-item repair path.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_org_id::text || ':' || p_created_by::text || ':' || p_client_request_id::text,
        0
      )
    );

    select c.*
      into v_contract
      from public.contracts as c
     where c.org_id = p_org_id
       and c.created_by = p_created_by
       and c.client_request_id = p_client_request_id
     for update;

    v_recovered := found;
  end if;

  if v_recovered then
    -- A request identity is bound to one aggregate payload. Business metadata
    -- is first-write-wins; changing the quote or item-copy choice is rejected
    -- rather than silently mixing two contract creations.
    if v_contract.quote_id is distinct from v_requested_quote_id then
      raise exception 'client_request_id is already bound to another quote'
        using errcode = '23514';
    end if;

    if v_contract.creation_include_quote_items is not null
      and v_contract.creation_include_quote_items is distinct from v_copy_quote_items then
      raise exception 'client_request_id is already bound to another quote item choice'
        using errcode = '23514';
    end if;

    if v_contract.creation_quote_item_ids is null then
      -- Legacy heads did not persist aggregate intent. The first valid replay
      -- freezes the current server-owned quote item identities, then repairs
      -- only that frozen set.
      if v_copy_quote_items then
        select coalesce(array_agg(source_item.id order by source_item.id), array[]::uuid[])
          into v_quote_item_ids
          from public.quote_items as source_item
         where source_item.quote_id = v_contract.quote_id;
      end if;

      update public.contracts as c
         set creation_include_quote_items = v_copy_quote_items,
             creation_quote_item_ids = v_quote_item_ids
       where c.id = v_contract.id
      returning c.* into v_contract;
    else
      v_quote_item_ids := v_contract.creation_quote_item_ids;
    end if;
  else
    -- Repeat the quote authorization/business check inside the same database
    -- transaction as creation so a route-level check cannot become stale.
    if v_requested_quote_id is not null and not exists (
      select 1
        from public.quotes as source_quote
       where source_quote.id = v_requested_quote_id
         and source_quote.org_id = p_org_id
         and source_quote.status = 'CONFIRMED'
    ) then
      raise exception 'contract quote is unavailable or no longer confirmed'
        using errcode = '23514';
    end if;

    if v_copy_quote_items then
      select coalesce(array_agg(source_item.id order by source_item.id), array[]::uuid[])
        into v_quote_item_ids
        from public.quote_items as source_item
       where source_item.quote_id = v_requested_quote_id;
    end if;

    insert into public.contracts (
      contract_no,
      quote_id,
      party_a_name,
      party_b_name,
      party_b_contact,
      contract_amount,
      tax_amount,
      contract_date,
      effective_date,
      expiry_date,
      payment_terms,
      delivery_terms,
      notes,
      filename,
      storage_path,
      size,
      mime_type,
      status,
      created_by,
      org_id,
      client_request_id,
      creation_include_quote_items,
      creation_quote_item_ids
    ) values (
      nullif(p_contract ->> 'contract_no', ''),
      v_requested_quote_id,
      coalesce(nullif(p_contract ->> 'party_a_name', ''), '甲方（从配置读取）'),
      coalesce(nullif(p_contract ->> 'party_b_name', ''), '未命名合同'),
      nullif(p_contract ->> 'party_b_contact', ''),
      coalesce((p_contract ->> 'contract_amount')::numeric, 0),
      coalesce((p_contract ->> 'tax_amount')::numeric, 0),
      nullif(p_contract ->> 'contract_date', '')::date,
      nullif(p_contract ->> 'effective_date', '')::date,
      nullif(p_contract ->> 'expiry_date', '')::date,
      nullif(p_contract ->> 'payment_terms', ''),
      nullif(p_contract ->> 'delivery_terms', ''),
      nullif(p_contract ->> 'notes', ''),
      '',
      '',
      0,
      'application/octet-stream',
      'DRAFT',
      p_created_by,
      p_org_id,
      p_client_request_id,
      v_copy_quote_items,
      v_quote_item_ids
    )
    returning * into v_contract;
  end if;

  -- Values are copied from server-owned quote_items, never from arbitrary item
  -- fields in the client payload. NOT EXISTS is safe under the request lock and
  -- repairs only missing members of the frozen item identity snapshot.
  insert into public.contract_items (
    contract_id,
    quote_item_id,
    name,
    specification,
    quantity,
    unit,
    unit_price,
    line_total,
    sort_order
  )
  select
    v_contract.id,
    source_item.id,
    source_item.name,
    source_item.specification,
    source_item.quantity,
    source_item.unit,
    source_item.unit_price,
    source_item.line_total,
    source_item.sort_order
  from public.quote_items as source_item
  where source_item.id = any(v_quote_item_ids)
    and source_item.quote_id = v_contract.quote_id
    and not exists (
      select 1
        from public.contract_items as existing_item
       where existing_item.contract_id = v_contract.id
         and existing_item.quote_item_id = source_item.id
    );

  v_expected_item_count := coalesce(array_length(v_quote_item_ids, 1), 0);

  select count(distinct existing_item.quote_item_id)::integer
    into v_present_item_count
    from public.contract_items as existing_item
   where existing_item.contract_id = v_contract.id
     and existing_item.quote_item_id = any(v_quote_item_ids);

  if v_present_item_count <> v_expected_item_count then
    raise exception 'contract aggregate item set is incomplete'
      using errcode = '23514';
  end if;

  return query
  select
    v_contract.id,
    v_contract.contract_no,
    v_contract.status,
    v_contract.party_b_name,
    v_contract.contract_amount,
    v_recovered,
    (
      select count(*)::integer
        from public.contract_items as existing_item
       where existing_item.contract_id = v_contract.id
    );
end;
$function$;

revoke all on function public.create_contract_aggregate_idempotent(
  uuid,
  uuid,
  uuid,
  jsonb,
  boolean
) from public, anon, authenticated;

grant execute on function public.create_contract_aggregate_idempotent(
  uuid,
  uuid,
  uuid,
  jsonb,
  boolean
) to service_role;

commit;

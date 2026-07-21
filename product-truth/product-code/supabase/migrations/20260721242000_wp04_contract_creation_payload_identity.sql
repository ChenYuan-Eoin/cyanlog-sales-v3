-- WP04 forward repair: bind a browser request identity to the complete
-- normalized business payload, not only quote/copy-item choices. Automatic
-- contract numbering also moves under the aggregate transaction lock so two
-- different requests cannot both calculate the same max+1 value in the route.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.contracts
  add column if not exists creation_payload_fingerprint text,
  add column if not exists creation_contract_no_explicit boolean;

alter table public.contracts
  drop constraint if exists contracts_creation_payload_fingerprint_check;
alter table public.contracts
  add constraint contracts_creation_payload_fingerprint_check
  check (
    creation_payload_fingerprint is null
    or creation_payload_fingerprint ~ '^[0-9a-f]{64}$'
  );

comment on column public.contracts.creation_payload_fingerprint is
  'SHA-256 of the normalized immutable contract-create business payload.';

comment on column public.contracts.creation_contract_no_explicit is
  'True when contract_no came from the user; false when generated atomically by the create RPC.';

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
  v_requested_contract_no text;
  v_contract_no text;
  v_contract_no_explicit boolean;
  v_copy_quote_items boolean := coalesce(p_include_quote_items, false);
  v_quote_item_ids uuid[] := array[]::uuid[];
  v_recovered boolean := false;
  v_expected_item_count integer := 0;
  v_present_item_count integer := 0;
  v_canonical_payload jsonb;
  v_stored_payload jsonb;
  v_payload_fingerprint text;
  v_stored_payload_fingerprint text;
  v_number_prefix text;
  v_number_sequence integer;
  v_quote_status text;
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
  v_requested_contract_no := nullif(btrim(p_contract ->> 'contract_no'), '');
  v_contract_no_explicit := v_requested_contract_no is not null;
  if v_requested_quote_id is null then
    v_copy_quote_items := false;
  end if;

  v_canonical_payload := jsonb_build_object(
    'contract_no', v_requested_contract_no,
    'quote_id', v_requested_quote_id,
    'include_quote_items', v_copy_quote_items,
    'party_a_name', coalesce(nullif(p_contract ->> 'party_a_name', ''), '甲方（从配置读取）'),
    'party_b_name', coalesce(nullif(p_contract ->> 'party_b_name', ''), '未命名合同'),
    'party_b_contact', nullif(p_contract ->> 'party_b_contact', ''),
    'contract_amount', trim_scale(coalesce((p_contract ->> 'contract_amount')::numeric, 0)),
    'tax_amount', trim_scale(coalesce((p_contract ->> 'tax_amount')::numeric, 0)),
    'contract_date', nullif(p_contract ->> 'contract_date', ''),
    'effective_date', nullif(p_contract ->> 'effective_date', ''),
    'expiry_date', nullif(p_contract ->> 'expiry_date', ''),
    'payment_terms', nullif(p_contract ->> 'payment_terms', ''),
    'delivery_terms', nullif(p_contract ->> 'delivery_terms', ''),
    'notes', nullif(p_contract ->> 'notes', '')
  );
  v_payload_fingerprint := encode(
    extensions.digest(convert_to(v_canonical_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

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
    if v_contract.quote_id is distinct from v_requested_quote_id then
      raise exception 'client_request_id is already bound to another quote'
        using errcode = '23514';
    end if;

    if v_contract.creation_include_quote_items is not null
      and v_contract.creation_include_quote_items is distinct from v_copy_quote_items then
      raise exception 'client_request_id is already bound to another quote item choice'
        using errcode = '23514';
    end if;

    if v_contract.creation_contract_no_explicit is not null
      and v_contract.creation_contract_no_explicit is distinct from v_contract_no_explicit then
      raise exception 'client_request_id is already bound to another contract number mode'
        using errcode = '23514';
    end if;

    if v_contract.creation_payload_fingerprint is null then
      -- Rows created by 236000 predate payload fingerprints. Compare the
      -- complete incoming payload with their stored business values once,
      -- treating an omitted number as the original automatic-number mode.
      v_stored_payload := jsonb_build_object(
        'contract_no', case
          when v_contract_no_explicit then v_contract.contract_no
          else null
        end,
        'quote_id', v_contract.quote_id,
        'include_quote_items', coalesce(
          v_contract.creation_include_quote_items,
          v_copy_quote_items
        ),
        'party_a_name', coalesce(nullif(v_contract.party_a_name, ''), '甲方（从配置读取）'),
        'party_b_name', coalesce(nullif(v_contract.party_b_name, ''), '未命名合同'),
        'party_b_contact', nullif(v_contract.party_b_contact, ''),
        'contract_amount', trim_scale(coalesce(v_contract.contract_amount, 0)),
        'tax_amount', trim_scale(coalesce(v_contract.tax_amount, 0)),
        'contract_date', v_contract.contract_date::text,
        'effective_date', v_contract.effective_date::text,
        'expiry_date', v_contract.expiry_date::text,
        'payment_terms', nullif(v_contract.payment_terms, ''),
        'delivery_terms', nullif(v_contract.delivery_terms, ''),
        'notes', nullif(v_contract.notes, '')
      );
      v_stored_payload_fingerprint := encode(
        extensions.digest(convert_to(v_stored_payload::text, 'UTF8'), 'sha256'),
        'hex'
      );

      if v_stored_payload_fingerprint is distinct from v_payload_fingerprint then
        raise exception 'client_request_id is already bound to another business payload'
          using errcode = '23514';
      end if;
    elsif v_contract.creation_payload_fingerprint is distinct from v_payload_fingerprint then
      raise exception 'client_request_id is already bound to another business payload'
        using errcode = '23514';
    end if;

    if v_contract.creation_quote_item_ids is null then
      if v_copy_quote_items then
        select coalesce(array_agg(locked_item.id order by locked_item.id), array[]::uuid[])
          into v_quote_item_ids
          from (
            select source_item.id
              from public.quote_items as source_item
             where source_item.quote_id = v_contract.quote_id
             order by source_item.id
             for share
          ) as locked_item;
      end if;
    else
      v_quote_item_ids := v_contract.creation_quote_item_ids;
    end if;

    update public.contracts as c
       set creation_include_quote_items = v_copy_quote_items,
           creation_quote_item_ids = v_quote_item_ids,
           creation_payload_fingerprint = v_payload_fingerprint,
           creation_contract_no_explicit = v_contract_no_explicit
     where c.id = v_contract.id
    returning c.* into v_contract;
  else
    if v_requested_quote_id is not null then
      -- FOR SHARE keeps the CONFIRMED decision stable until the contract head
      -- and copied item snapshot have committed; a concurrent status update or
      -- delete cannot slip between validation and aggregate creation.
      select source_quote.status
        into v_quote_status
        from public.quotes as source_quote
       where source_quote.id = v_requested_quote_id
         and source_quote.org_id = p_org_id
       for share;

      if not found or v_quote_status is distinct from 'CONFIRMED' then
        raise exception 'contract quote is unavailable or no longer confirmed'
          using errcode = '23514';
      end if;
    end if;

    if v_copy_quote_items then
      select coalesce(array_agg(locked_item.id order by locked_item.id), array[]::uuid[])
        into v_quote_item_ids
        from (
          select source_item.id
            from public.quote_items as source_item
           where source_item.quote_id = v_requested_quote_id
           order by source_item.id
           for share
        ) as locked_item;
    end if;

    if v_contract_no_explicit then
      v_contract_no := v_requested_contract_no;
    else
      v_number_prefix := 'CT-' || to_char(current_date, 'YYYYMMDD') || '-';
      perform pg_advisory_xact_lock(
        hashtextextended('contract-number:' || p_org_id::text || ':' || v_number_prefix, 0)
      );

      select coalesce(
        max(substring(existing_contract.contract_no from '([0-9]+)$')::integer),
        0
      ) + 1
        into v_number_sequence
        from public.contracts as existing_contract
       where existing_contract.org_id = p_org_id
         and existing_contract.contract_no ~ ('^' || v_number_prefix || '[0-9]+$');

      v_contract_no := v_number_prefix || lpad(v_number_sequence::text, 3, '0');
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
      creation_quote_item_ids,
      creation_payload_fingerprint,
      creation_contract_no_explicit
    ) values (
      v_contract_no,
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
      v_quote_item_ids,
      v_payload_fingerprint,
      v_contract_no_explicit
    )
    returning * into v_contract;
  end if;

  -- Existing source rows are locked before copying or repairing. If a frozen
  -- identity has disappeared, the completeness assertion below fails instead
  -- of publishing a partially repaired aggregate.
  perform 1
    from public.quote_items as source_item
   where source_item.id = any(v_quote_item_ids)
     and source_item.quote_id = v_contract.quote_id
   for share;

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

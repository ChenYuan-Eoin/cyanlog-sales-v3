begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.enforce_current_contract_page_map_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_storage_path text;
  current_source_text_hash text;
begin
  -- Hold a shared row lock through the page-map write. A concurrent source
  -- replacement must wait, and an already-committed replacement is observed
  -- here before an old verifier can overwrite the current map.
  select contracts.storage_path,
         encode(extensions.digest(convert_to(coalesce(contracts.parsed_text, ''), 'UTF8'), 'sha256'), 'hex')
    into current_storage_path, current_source_text_hash
    from public.contracts as contracts
   where contracts.id = new.contract_id
   for share;

  if not found then
    raise exception 'contract source no longer exists'
      using errcode = '40001';
  end if;
  if current_storage_path is null
     or new.storage_path is distinct from current_storage_path then
    raise exception 'contract page map source is not current'
      using errcode = '40001';
  end if;
  if new.source_text_hash is distinct from current_source_text_hash then
    raise exception 'contract page map text is not current'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_current_contract_page_map_source() from public, anon, authenticated;
grant execute on function public.enforce_current_contract_page_map_source() to service_role;

drop trigger if exists trg_contract_page_map_current_source
  on public.contract_source_page_maps;
create trigger trg_contract_page_map_current_source
before insert or update of contract_id, storage_path, source_hash, source_text_hash
on public.contract_source_page_maps
for each row execute function public.enforce_current_contract_page_map_source();

comment on function public.enforce_current_contract_page_map_source() is
  'Rejects stale page-map upserts and serializes them against contract source replacement.';

commit;

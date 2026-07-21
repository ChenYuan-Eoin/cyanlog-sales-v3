-- WP04 page-map source fencing must validate the committed source identity,
-- not the transient row image seen by an INSERT ... ON CONFLICT statement.
-- A deterministic identity mismatch is a check violation, not a serialization
-- failure: SQLSTATE 40001 causes PostgREST to retry forever.

create or replace function public.enforce_current_contract_page_map_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_storage_path text;
  current_version_id uuid;
  current_file_hash text;
  current_text_hash text;
  projected_text_hash text;
begin
  select contract.storage_path,
         contract.current_version_id,
         source_version.file_sha256,
         source_version.text_sha256,
         pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(coalesce(contract.parsed_text, ''), 'UTF8'),
             'sha256'
           ),
           'hex'
         )
    into current_storage_path,
         current_version_id,
         current_file_hash,
         current_text_hash,
         projected_text_hash
    from public.contracts as contract
    join public.contract_versions as source_version
      on source_version.id = contract.current_version_id
     and source_version.contract_id = contract.id
   where contract.id = new.contract_id
   for share of contract, source_version;

  if not found then
    raise exception 'contract current source version no longer exists'
      using errcode = '23514';
  end if;
  if new.contract_version_id is distinct from current_version_id
     or new.storage_path is distinct from current_storage_path
     or new.source_hash is distinct from current_file_hash
     or new.source_text_hash is distinct from current_text_hash
     or new.source_text_hash is distinct from projected_text_hash then
    raise exception 'contract page map source is not current'
      using errcode = '23514',
        detail = pg_catalog.format(
          'contract_version_match=%s storage_match=%s file_hash_match=%s text_hash_match=%s projected_text_match=%s',
          new.contract_version_id is not distinct from current_version_id,
          new.storage_path is not distinct from current_storage_path,
          new.source_hash is not distinct from current_file_hash,
          new.source_text_hash is not distinct from current_text_hash,
          new.source_text_hash is not distinct from projected_text_hash
        );
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_current_contract_page_map_source()
  from public, anon, authenticated;
grant execute on function public.enforce_current_contract_page_map_source()
  to service_role;

drop trigger if exists trg_contract_page_map_current_source
  on public.contract_source_page_maps;
create constraint trigger trg_contract_page_map_current_source
after insert or update
on public.contract_source_page_maps
deferrable initially deferred
for each row execute function public.enforce_current_contract_page_map_source();

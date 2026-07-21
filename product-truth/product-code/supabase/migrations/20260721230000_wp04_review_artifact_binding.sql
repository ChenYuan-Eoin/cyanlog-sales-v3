begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Review artifacts are not contract-global.  They belong to one immutable
-- ReviewRun and therefore to the exact source version that ReviewRun audited.
-- Existing rows without a deterministic owner stay quarantined and are never
-- silently rebound to the latest review.
alter table public.contract_annotations
  add column if not exists review_id uuid,
  add column if not exists contract_version_id uuid,
  add column if not exists binding_state text not null default 'legacy_unbound';

alter table public.ask_items
  add column if not exists review_id uuid,
  add column if not exists contract_version_id uuid,
  add column if not exists binding_state text not null default 'legacy_unbound';

alter table public.report_versions
  add column if not exists review_id uuid,
  add column if not exists contract_version_id uuid,
  add column if not exists binding_state text not null default 'legacy_unbound';

do $do$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.contract_annotations'::regclass
       and conname = 'contract_annotations_review_id_fkey'
  ) then
    alter table public.contract_annotations
      add constraint contract_annotations_review_id_fkey
      foreign key (review_id) references public.contract_reviews(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.contract_annotations'::regclass
       and conname = 'contract_annotations_contract_version_id_fkey'
  ) then
    alter table public.contract_annotations
      add constraint contract_annotations_contract_version_id_fkey
      foreign key (contract_version_id) references public.contract_versions(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ask_items'::regclass
       and conname = 'ask_items_review_id_fkey'
  ) then
    alter table public.ask_items
      add constraint ask_items_review_id_fkey
      foreign key (review_id) references public.contract_reviews(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ask_items'::regclass
       and conname = 'ask_items_contract_version_id_fkey'
  ) then
    alter table public.ask_items
      add constraint ask_items_contract_version_id_fkey
      foreign key (contract_version_id) references public.contract_versions(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.report_versions'::regclass
       and conname = 'report_versions_review_id_fkey'
  ) then
    alter table public.report_versions
      add constraint report_versions_review_id_fkey
      foreign key (review_id) references public.contract_reviews(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.report_versions'::regclass
       and conname = 'report_versions_contract_version_id_fkey'
  ) then
    alter table public.report_versions
      add constraint report_versions_contract_version_id_fkey
      foreign key (contract_version_id) references public.contract_versions(id) on delete cascade;
  end if;
end
$do$;

-- Recover annotations through the risk marker written into every generated
-- comment, or through a clause already owned by a ReviewRun.  Ambiguous rows
-- remain legacy_unbound and are excluded by review-scoped queries.
with resolved_annotations as (
  select annotation.id,
         coalesce(clause.review_id, risk.review_id) as review_id
    from public.contract_annotations as annotation
    left join public.contract_clauses as clause
      on clause.id = annotation.clause_id
     and clause.contract_id = annotation.contract_id
    left join public.contract_risk_cards as risk
      on risk.contract_id = annotation.contract_id
     and risk.id::text = substring(
       annotation.comment from 'RiskFinding:[[:space:]]*([0-9a-fA-F-]{36})'
     )
   where coalesce(clause.review_id, risk.review_id) is not null
), valid_annotations as (
  select resolved.id, review.id as review_id, review.contract_version_id
    from resolved_annotations as resolved
    join public.contract_reviews as review on review.id = resolved.review_id
    join public.contract_versions as version
      on version.id = review.contract_version_id
     and version.contract_id = review.contract_id
   where review.contract_version_id is not null
)
update public.contract_annotations as annotation
   set review_id = valid.review_id,
       contract_version_id = valid.contract_version_id,
       binding_state = 'bound'
  from valid_annotations as valid
 where annotation.id = valid.id;

-- A contract with exactly one version-bound review has only one possible
-- owner.  This is the only safe fallback for legacy ASK rows.
with singleton_reviews as (
  select review.contract_id,
         (array_agg(review.id order by review.created_at))[1] as review_id,
         (array_agg(review.contract_version_id order by review.created_at))[1] as contract_version_id
    from public.contract_reviews as review
   where review.contract_id is not null
     and review.contract_version_id is not null
   group by review.contract_id
  having count(*) = 1
)
update public.ask_items as ask
   set review_id = singleton.review_id,
       contract_version_id = singleton.contract_version_id,
       binding_state = 'bound'
  from singleton_reviews as singleton
 where ask.contract_id = singleton.contract_id
   and ask.review_id is null
   and ask.contract_version_id is null;

-- A report triggered by an already-bound ASK inherits that exact identity.
update public.report_versions as report
   set review_id = ask.review_id,
       contract_version_id = ask.contract_version_id,
       binding_state = 'bound'
  from public.ask_items as ask
 where ask.id = report.trigger_ask_id
   and ask.binding_state = 'bound'
   and report.review_id is null
   and report.contract_version_id is null;

with singleton_reviews as (
  select review.contract_id,
         (array_agg(review.id order by review.created_at))[1] as review_id,
         (array_agg(review.contract_version_id order by review.created_at))[1] as contract_version_id
    from public.contract_reviews as review
   where review.contract_id is not null
     and review.contract_version_id is not null
   group by review.contract_id
  having count(*) = 1
)
update public.report_versions as report
   set review_id = singleton.review_id,
       contract_version_id = singleton.contract_version_id,
       binding_state = 'bound'
  from singleton_reviews as singleton
 where report.contract_id = singleton.contract_id
   and report.review_id is null
   and report.contract_version_id is null;

alter table public.contract_annotations alter column binding_state set default 'bound';
alter table public.ask_items alter column binding_state set default 'bound';
alter table public.report_versions alter column binding_state set default 'bound';

alter table public.contract_annotations
  drop constraint if exists contract_annotations_review_binding_check;
alter table public.contract_annotations
  add constraint contract_annotations_review_binding_check
  check (
    (binding_state = 'bound' and review_id is not null and contract_version_id is not null)
    or
    (binding_state = 'legacy_unbound' and review_id is null and contract_version_id is null)
  );

alter table public.ask_items
  drop constraint if exists ask_items_review_binding_check;
alter table public.ask_items
  add constraint ask_items_review_binding_check
  check (
    (binding_state = 'bound' and review_id is not null and contract_version_id is not null)
    or
    (binding_state = 'legacy_unbound' and review_id is null and contract_version_id is null)
  );

alter table public.report_versions
  drop constraint if exists report_versions_review_binding_check;
alter table public.report_versions
  add constraint report_versions_review_binding_check
  check (
    (binding_state = 'bound' and review_id is not null and contract_version_id is not null)
    or
    (binding_state = 'legacy_unbound' and review_id is null and contract_version_id is null)
  );

create or replace function public.enforce_review_artifact_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  owner_contract_id uuid;
  owner_version_id uuid;
begin
  if new.binding_state = 'legacy_unbound' then
    if new.review_id is not null or new.contract_version_id is not null then
      raise exception 'legacy review artifact must remain unbound'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.binding_state is distinct from 'bound'
     or new.review_id is null
     or new.contract_version_id is null then
    raise exception 'review artifact identity is required'
      using errcode = '23514';
  end if;

  select review.contract_id, review.contract_version_id
    into owner_contract_id, owner_version_id
    from public.contract_reviews as review
   where review.id = new.review_id;

  if not found
     or owner_contract_id is distinct from new.contract_id
     or owner_version_id is distinct from new.contract_version_id then
    raise exception 'review artifact identity crosses contract or source version'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_review_artifact_binding()
  from public, anon, authenticated;
grant execute on function public.enforce_review_artifact_binding()
  to service_role;

drop trigger if exists trg_contract_annotations_review_binding on public.contract_annotations;
create trigger trg_contract_annotations_review_binding
before insert or update of contract_id, review_id, contract_version_id, binding_state
on public.contract_annotations
for each row execute function public.enforce_review_artifact_binding();

drop trigger if exists trg_ask_items_review_binding on public.ask_items;
create trigger trg_ask_items_review_binding
before insert or update of contract_id, review_id, contract_version_id, binding_state
on public.ask_items
for each row execute function public.enforce_review_artifact_binding();

drop trigger if exists trg_report_versions_review_binding on public.report_versions;
create trigger trg_report_versions_review_binding
before insert or update of contract_id, review_id, contract_version_id, binding_state
on public.report_versions
for each row execute function public.enforce_review_artifact_binding();

create index if not exists idx_contract_annotations_review
  on public.contract_annotations(review_id, created_at);
create index if not exists idx_contract_annotations_contract_version
  on public.contract_annotations(contract_version_id, created_at);
create index if not exists idx_ask_items_review
  on public.ask_items(review_id, created_at);
create index if not exists idx_report_versions_review
  on public.report_versions(review_id, version desc);

alter table public.ask_items
  drop constraint if exists ask_items_contract_id_ask_code_key;
drop index if exists public.idx_ask_items_contract_code;
create unique index if not exists idx_ask_items_review_code_bound
  on public.ask_items(review_id, ask_code)
  where binding_state = 'bound';
create unique index if not exists idx_ask_items_contract_code_legacy
  on public.ask_items(contract_id, ask_code)
  where binding_state = 'legacy_unbound';

alter table public.report_versions
  drop constraint if exists report_versions_contract_id_version_key;
drop index if exists public.idx_report_versions_contract_version;
drop index if exists public.idx_report_versions_unique_current;
create unique index if not exists idx_report_versions_review_version_bound
  on public.report_versions(review_id, version)
  where binding_state = 'bound';
create unique index if not exists idx_report_versions_review_current_bound
  on public.report_versions(review_id)
  where binding_state = 'bound' and is_current = true;
create unique index if not exists idx_report_versions_contract_version_legacy
  on public.report_versions(contract_id, version)
  where binding_state = 'legacy_unbound';
create unique index if not exists idx_report_versions_contract_current_legacy
  on public.report_versions(contract_id)
  where binding_state = 'legacy_unbound' and is_current = true;

create or replace function public.update_report_version_current()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.is_current is true then
    if new.binding_state = 'bound' then
      update public.report_versions
         set is_current = false
       where review_id = new.review_id
         and binding_state = 'bound'
         and id <> new.id
         and is_current = true;
    else
      update public.report_versions
         set is_current = false
       where contract_id = new.contract_id
         and binding_state = 'legacy_unbound'
         and id <> new.id
         and is_current = true;
    end if;
  end if;
  return new;
end
$function$;

revoke all on function public.update_report_version_current()
  from public, anon, authenticated;
grant execute on function public.update_report_version_current()
  to service_role;

drop trigger if exists trigger_update_report_version_current on public.report_versions;
drop trigger if exists update_report_version_current on public.report_versions;
create trigger trigger_update_report_version_current
  before insert or update of is_current, review_id, binding_state
  on public.report_versions
  for each row execute function public.update_report_version_current();

commit;

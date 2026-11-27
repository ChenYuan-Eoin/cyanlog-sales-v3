begin;

create function private.guard_manual_department_parent_on_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Archive and reparent use the same organization lock before locking rows.
  perform private.personnel_lock_org_v1(new.org_id);

  perform 1 from public.departments as parent
  where parent.org_id = new.org_id and parent.id = new.parent_id and parent.status = 'active'
  for share;
  if not found then
    raise exception 'manual department parent is unavailable'
      using errcode = '23514', detail = 'DEPARTMENT_PARENT_UNAVAILABLE';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_manual_department_parent_on_insert_v1()
  from public, anon, authenticated, service_role;

create trigger guard_manual_department_parent_on_insert
before insert on public.departments
for each row
when (new.source = 'manual' and new.parent_id is not null)
execute function private.guard_manual_department_parent_on_insert_v1();

commit;

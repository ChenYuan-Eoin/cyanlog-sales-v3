begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Additive migration: preserve existing settings, member grants, sessions and orders.
-- NULL department policy retains legacy individual grants until an admin saves a scope.
alter table public.shipping_wecom_settings add column department_snapshot jsonb not null default '[]'::jsonb check(jsonb_typeof(department_snapshot)='array');
alter table public.shipping_wecom_settings add column allowed_department_ids bigint[];
alter table public.shipping_employee_profiles add column department_ids bigint[] not null default '{}';
create table public.shipping_wecom_config_drafts (
 org_id uuid primary key references public.organizations(id),
 id uuid not null default gen_random_uuid(),
 config jsonb not null check(jsonb_typeof(config)='object'),
 departments jsonb not null check(jsonb_typeof(departments)='array'),
 members jsonb not null check(jsonb_typeof(members)='array'),
 base_updated_at timestamptz,
 prepared_by uuid not null references public.users(id),
 prepared_at timestamptz not null default now()
);
create table public.shipping_wecom_bots (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 corp_id text not null, bot_id text not null, name text not null,
 credentials_ciphertext text not null,
 status text not null default 'draft' check(status in ('draft','active','disabled')),
 verified_at timestamptz, last_message_at timestamptz,
 updated_by uuid not null references public.users(id), updated_at timestamptz not null default now()
);
create unique index shipping_wecom_one_active_bot on public.shipping_wecom_bots(org_id) where status='active';
create table public.shipping_wecom_bot_events (
 id uuid primary key default gen_random_uuid(), bot_id uuid not null references public.shipping_wecom_bots(id),
 message_id text not null, attempts integer not null default 0, lease_id uuid, prepared_ciphertext text, payload_hash text not null, payload_ciphertext text not null,
 state text not null default 'pending' check(state in ('pending','processing','done','failed')),
 response_content text not null default '', shipping_order_id uuid references public.shipping_orders(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(bot_id,message_id)
);
create index shipping_wecom_bot_events_pending on public.shipping_wecom_bot_events(state,updated_at) where state in ('pending','processing');
alter table public.shipping_wecom_config_drafts enable row level security;
alter table public.shipping_wecom_bots enable row level security;
alter table public.shipping_wecom_bot_events enable row level security;
revoke all on public.shipping_wecom_config_drafts,public.shipping_wecom_bots,public.shipping_wecom_bot_events from public,anon,authenticated;
grant select,insert,update,delete on public.shipping_wecom_config_drafts,public.shipping_wecom_bots,public.shipping_wecom_bot_events to service_role;

create function public.sync_shipping_wecom_directory_v2(p_org_id uuid,p_corp_id text,p_agent_id integer,p_config_updated_at timestamptz,p_company_name text,p_departments jsonb,p_members jsonb,p_selected_department_ids bigint[] default null)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg shipping_wecom_settings%rowtype; selected bigint[]; allowed bigint[]; n integer;
begin
 if jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)>100000 or jsonb_typeof(p_departments)<>'array' or jsonb_array_length(p_departments)=0 then raise exception 'Invalid directory snapshot'; end if;
 select * into cfg from shipping_wecom_settings where org_id=p_org_id and corp_id=p_corp_id and agent_id=p_agent_id and updated_at=p_config_updated_at for update;
 if not found then raise exception 'WeCom configuration changed'; end if;
 selected:=coalesce(p_selected_department_ids,cfg.allowed_department_ids);
 -- Removed departments revoke their descendants rather than preserving stale grants.
 if p_selected_department_ids is not null and exists(select 1 from unnest(selected) x where not exists(select 1 from jsonb_array_elements(p_departments) d where (d->>'id')::bigint=x)) then raise exception 'Selected department unavailable'; end if;
 with recursive tree as (
  select (d->>'id')::bigint id from jsonb_array_elements(p_departments) d where (d->>'id')::bigint=any(selected)
  union
  select (d->>'id')::bigint from jsonb_array_elements(p_departments) d join tree t on (d->>'parentId')::bigint=t.id
 ) select coalesce(array_agg(id),'{}'::bigint[]) into allowed from tree;
 insert into shipping_employee_profiles(org_id,email,email_verified_at,wecom_corp_id,wechat_userid,wecom_name,mobile,company_name,department_names,department_ids,team,is_active,wecom_allowed)
 select p_org_id,null,null,p_corp_id,x.userid,x.name,x.mobile,p_company_name,x.departments,x."departmentIds",left(array_to_string(x.departments,'、'),80),x.active,
 case when selected is null then true else x.active and x."departmentIds" && allowed end
 from jsonb_to_recordset(p_members) as x(userid text,name text,mobile text,departments text[],"departmentIds" bigint[],active boolean)
 on conflict(org_id,wecom_corp_id,wechat_userid) do update set wecom_name=excluded.wecom_name,mobile=excluded.mobile,company_name=excluded.company_name,department_names=excluded.department_names,department_ids=excluded.department_ids,team=excluded.team,is_active=excluded.is_active,
 wecom_allowed=case when selected is null then shipping_employee_profiles.wecom_allowed else excluded.wecom_allowed end,
 session_version=case when shipping_employee_profiles.is_active is distinct from excluded.is_active or (selected is not null and shipping_employee_profiles.wecom_allowed is distinct from excluded.wecom_allowed) then shipping_employee_profiles.session_version+1 else shipping_employee_profiles.session_version end,updated_at=now();
 get diagnostics n=row_count;
 update shipping_employee_profiles set is_active=false,session_version=session_version+1,updated_at=now()
 where org_id=p_org_id and wechat_userid is not null and is_active and (wecom_corp_id<>p_corp_id or not exists(select 1 from jsonb_array_elements(p_members) x where x->>'userid'=wechat_userid));
 update shipping_wecom_settings set company_name=p_company_name,department_snapshot=p_departments,allowed_department_ids=selected,directory_synced_at=now(),updated_at=now() where org_id=p_org_id;
 return n;
end;
$$;
revoke all on function public.sync_shipping_wecom_directory_v2(uuid,text,integer,timestamptz,text,jsonb,jsonb,bigint[]) from public,anon,authenticated;
grant execute on function public.sync_shipping_wecom_directory_v2(uuid,text,integer,timestamptz,text,jsonb,jsonb,bigint[]) to service_role;

-- Old application versions may continue to read and use existing grants after
-- rollback, but must not overwrite an explicitly saved department policy.
alter function public.sync_shipping_wecom_members(uuid,text,integer,timestamptz,text,jsonb) rename to sync_shipping_wecom_members_legacy;
create function public.sync_shipping_wecom_members(p_org_id uuid,p_corp_id text,p_agent_id integer,p_config_updated_at timestamptz,p_company_name text,p_members jsonb)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform 1 from shipping_wecom_settings where org_id=p_org_id for update;
 if exists(select 1 from shipping_wecom_settings where org_id=p_org_id and allowed_department_ids is not null) then raise exception 'Department policy requires current application version'; end if;
 return sync_shipping_wecom_members_legacy(p_org_id,p_corp_id,p_agent_id,p_config_updated_at,p_company_name,p_members);
end;
$$;
revoke all on function public.sync_shipping_wecom_members(uuid,text,integer,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.sync_shipping_wecom_members(uuid,text,integer,timestamptz,text,jsonb) to service_role;

create function public.activate_shipping_wecom_config(p_org_id uuid,p_draft_id uuid,p_user_id uuid,p_department_ids bigint[])
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare draft shipping_wecom_config_drafts%rowtype; cfg shipping_wecom_settings%rowtype; stamp timestamptz:=clock_timestamp();
begin
 -- Serialize first setup too, without requiring a settings row to exist.
 perform pg_advisory_xact_lock(hashtextextended('shipping-wecom:'||p_org_id::text,0));
 select * into draft from shipping_wecom_config_drafts where org_id=p_org_id and id=p_draft_id for update;
 if not found or draft.prepared_at < now()-interval '30 minutes' then raise exception 'Draft expired'; end if;
 select * into cfg from shipping_wecom_settings where org_id=p_org_id for update;
 if cfg.updated_at is distinct from draft.base_updated_at then raise exception 'Active configuration changed'; end if;
 if p_department_ids is null then raise exception 'Explicit department scope required'; end if;
 if cfg.corp_id is distinct from draft.config->>'corp_id' or cfg.agent_id is distinct from (draft.config->>'agent_id')::integer then
  update shipping_employee_profiles set session_version=session_version+1,updated_at=stamp where org_id=p_org_id and wechat_userid is not null;
 end if;
 if cfg.corp_id is distinct from draft.config->>'corp_id' then
  update shipping_wecom_bots set status='disabled',updated_at=stamp where org_id=p_org_id and status='active';
 end if;
 insert into shipping_wecom_settings(org_id,corp_id,agent_id,credentials_ciphertext,order_check_mode,fallback_phone,denied_message,redirect_domain,updated_by,updated_at)
 values(p_org_id,draft.config->>'corp_id',(draft.config->>'agent_id')::integer,draft.config->>'credentials_ciphertext',(draft.config->>'order_check_mode')::integer,draft.config->>'fallback_phone',draft.config->>'denied_message',draft.config->>'redirect_domain',p_user_id,stamp)
 on conflict(org_id) do update set corp_id=excluded.corp_id,agent_id=excluded.agent_id,credentials_ciphertext=excluded.credentials_ciphertext,order_check_mode=excluded.order_check_mode,fallback_phone=excluded.fallback_phone,denied_message=excluded.denied_message,redirect_domain=excluded.redirect_domain,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 perform sync_shipping_wecom_directory_v2(p_org_id,draft.config->>'corp_id',(draft.config->>'agent_id')::integer,stamp,draft.config->>'company_name',draft.departments,draft.members,p_department_ids);
 delete from shipping_wecom_config_drafts where org_id=p_org_id and id=p_draft_id;
 return true;
end;
$$;
revoke all on function public.activate_shipping_wecom_config(uuid,uuid,uuid,bigint[]) from public,anon,authenticated;
grant execute on function public.activate_shipping_wecom_config(uuid,uuid,uuid,bigint[]) to service_role;

create function public.activate_shipping_wecom_bot(p_org_id uuid,p_bot_id uuid,p_user_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg shipping_wecom_settings%rowtype; candidate shipping_wecom_bots%rowtype;
begin
 select * into cfg from shipping_wecom_settings where org_id=p_org_id for update;
 if not found then raise exception 'Enterprise not configured'; end if;
 select * into candidate from shipping_wecom_bots where org_id=p_org_id and id=p_bot_id for update;
 if not found or candidate.corp_id<>cfg.corp_id or candidate.verified_at is null or candidate.status not in ('draft','disabled') then raise exception 'Verified draft for current enterprise required'; end if;
 update shipping_wecom_bots set status='disabled',updated_at=now(),updated_by=p_user_id where org_id=p_org_id and status='active';
 update shipping_wecom_bots set status='active',updated_at=now(),updated_by=p_user_id where org_id=p_org_id and id=p_bot_id;
 return true;
end;
$$;
revoke all on function public.activate_shipping_wecom_bot(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.activate_shipping_wecom_bot(uuid,uuid,uuid) to service_role;

create function public.claim_shipping_wecom_bot_event(p_event_id uuid,p_bot_id uuid)
returns setof public.shipping_wecom_bot_events language sql security invoker set search_path=public,pg_temp as $$
 update shipping_wecom_bot_events set state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),updated_at=now()
 where id=p_event_id and bot_id=p_bot_id and attempts<3 and created_at>now()-interval '10 minutes'
 and (state='pending' or (state='processing' and updated_at<now()-interval '90 seconds')) returning *;
$$;
revoke all on function public.claim_shipping_wecom_bot_event(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_shipping_wecom_bot_event(uuid,uuid) to service_role;

create or replace function public.set_shipping_wecom_member(p_org_id uuid,p_member_id uuid,p_allowed boolean,p_use_preset boolean)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg shipping_wecom_settings%rowtype;
begin
 select * into cfg from shipping_wecom_settings where org_id=p_org_id for update;
 if not found or (p_use_preset and cfg.fallback_phone='') then raise exception 'WeCom configuration unavailable'; end if;
 if cfg.allowed_department_ids is not null and exists(select 1 from shipping_employee_profiles where org_id=p_org_id and id=p_member_id and wecom_allowed is distinct from p_allowed) then raise exception 'Member access is managed by department scope'; end if;
 update shipping_employee_profiles set wecom_allowed=p_allowed,use_preset_phone=p_use_preset,
 session_version=case when wecom_allowed is distinct from p_allowed then session_version+1 else session_version end,updated_at=now()
 where org_id=p_org_id and id=p_member_id and wecom_corp_id=cfg.corp_id;
 return found;
end;
$$;
revoke all on function public.set_shipping_wecom_member(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.set_shipping_wecom_member(uuid,uuid,boolean,boolean) to service_role;
commit;

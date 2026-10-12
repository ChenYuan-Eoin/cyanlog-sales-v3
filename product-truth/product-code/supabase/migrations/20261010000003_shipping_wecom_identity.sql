begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.shipping_wecom_settings (
 org_id uuid primary key references public.organizations(id),
 corp_id text not null,
 agent_id integer not null check(agent_id>0),
 credentials_ciphertext text not null,
 order_check_mode integer not null default 1 check(order_check_mode in (0,1)),
 fallback_phone text not null default '',
 denied_message text not null default '抱歉，您非本企业授权员工，无权使用自寄服务',
 redirect_domain text not null default '',
 company_name text not null default '',
 directory_synced_at timestamptz,
 updated_by uuid references public.users(id),
 updated_at timestamptz not null default now()
);
alter table public.shipping_wecom_settings enable row level security;
revoke all on public.shipping_wecom_settings from public,anon,authenticated;
grant select,insert,update,delete on public.shipping_wecom_settings to service_role;
alter table public.shipping_employee_profiles alter column email drop not null;
alter table public.shipping_employee_profiles alter column email_verified_at drop not null;
alter table public.shipping_employee_profiles add column wecom_corp_id text;
alter table public.shipping_employee_profiles add column wechat_userid text;
alter table public.shipping_employee_profiles add column wecom_name text;
alter table public.shipping_employee_profiles add column mobile text;
alter table public.shipping_employee_profiles add column company_name text;
alter table public.shipping_employee_profiles add column department_names text[] not null default '{}';
alter table public.shipping_employee_profiles add column wecom_allowed boolean not null default true;
alter table public.shipping_employee_profiles add column use_preset_phone boolean not null default false;
alter table public.shipping_employee_profiles add constraint shipping_employee_wecom_identity unique(org_id,wecom_corp_id,wechat_userid);
create function public.sync_shipping_wecom_members(p_org_id uuid,p_corp_id text,p_agent_id integer,p_config_updated_at timestamptz,p_company_name text,p_members jsonb)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare n integer;
begin
 if jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)>100000 then raise exception 'Invalid member snapshot'; end if;
 perform 1 from shipping_wecom_settings where org_id=p_org_id and corp_id=p_corp_id and agent_id=p_agent_id and updated_at=p_config_updated_at for update;
 if not found then raise exception 'WeCom configuration changed'; end if;
 insert into shipping_employee_profiles(org_id,email,email_verified_at,wecom_corp_id,wechat_userid,wecom_name,mobile,company_name,department_names,team,is_active)
 select p_org_id,null,null,p_corp_id,x.userid,x.name,x.mobile,p_company_name,x.departments,left(array_to_string(x.departments,'、'),80),x.active
 from jsonb_to_recordset(p_members) as x(userid text,name text,mobile text,departments text[],active boolean)
 on conflict(org_id,wecom_corp_id,wechat_userid) do update set wecom_name=excluded.wecom_name,mobile=excluded.mobile,company_name=excluded.company_name,department_names=excluded.department_names,team=excluded.team,is_active=excluded.is_active,session_version=case when shipping_employee_profiles.is_active is distinct from excluded.is_active then shipping_employee_profiles.session_version+1 else shipping_employee_profiles.session_version end,updated_at=now();
 get diagnostics n=row_count;
 update shipping_employee_profiles set is_active=false,session_version=session_version+1,updated_at=now()
 where org_id=p_org_id and wechat_userid is not null and is_active and (wecom_corp_id<>p_corp_id or not exists(select 1 from jsonb_array_elements(p_members) x where x->>'userid'=wechat_userid));
 update shipping_wecom_settings set company_name=p_company_name,directory_synced_at=now(),updated_at=now() where org_id=p_org_id and corp_id=p_corp_id;
 return n;
end;
$$;
revoke all on function public.sync_shipping_wecom_members(uuid,text,integer,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.sync_shipping_wecom_members(uuid,text,integer,timestamptz,text,jsonb) to service_role;
alter table public.shipping_employee_profiles add constraint shipping_employee_identity_present check(email is not null or (wecom_corp_id is not null and wechat_userid is not null));
alter table public.shipping_orders add column identity_snapshot jsonb not null default '{}' check(jsonb_typeof(identity_snapshot)='object');
create function public.set_shipping_wecom_member(p_org_id uuid,p_member_id uuid,p_allowed boolean,p_use_preset boolean)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg shipping_wecom_settings%rowtype;
begin
 select * into cfg from shipping_wecom_settings where org_id=p_org_id for update;
 if not found or (p_use_preset and cfg.fallback_phone='') then raise exception 'WeCom configuration unavailable'; end if;
 update shipping_employee_profiles set wecom_allowed=p_allowed,use_preset_phone=p_use_preset,
 session_version=case when wecom_allowed is distinct from p_allowed then session_version+1 else session_version end,updated_at=now()
 where org_id=p_org_id and id=p_member_id and wecom_corp_id=cfg.corp_id;
 return found;
end;
$$;
revoke all on function public.set_shipping_wecom_member(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.set_shipping_wecom_member(uuid,uuid,boolean,boolean) to service_role;
commit;

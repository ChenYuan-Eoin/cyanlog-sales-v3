// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(), 'supabase/migrations/20261126064000_close_organization_data_api_access.sql',
), 'utf8')
const organizationTables = ['organizations', 'departments', 'user_departments', 'user_roles', 'roles']
const actor = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'

it('closes raw organization table grants while preserving authorized server reads and own-profile access', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select '${actor}'::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.organizations (id uuid primary key, settings jsonb not null);
      create table public.departments (id uuid primary key);
      create table public.user_departments (id uuid primary key);
      create table public.roles (id uuid primary key, code text, owner_org_id uuid);
      create table public.user_roles (id uuid primary key, user_id uuid, role_id uuid);
      create table public.user_profiles (user_id uuid primary key);
      grant select on table public.user_profiles to authenticated;
      grant all on table ${organizationTables.join(', ')} to public, anon, authenticated, service_role;
      ${organizationTables.map(table => 'alter table public.' + table + ' enable row level security;').join('\n')}
      alter table public.user_profiles enable row level security;
      create policy "Anyone reads orgs" on public.organizations for select to authenticated using (true);
      create policy "Same org reads departments" on public.departments for select to authenticated using (true);
      create policy "Same org reads user_departments" on public.user_departments for select to authenticated using (true);
      create policy "Same org reads user_roles" on public.user_roles for select to authenticated using (true);
      create policy "Anyone reads global roles" on public.roles for select to authenticated using (owner_org_id is null);
      create policy "Only readable roles are exposed in bindings" on public.user_roles as restrictive
        for select to authenticated using (exists (select 1 from public.roles definition where definition.id = role_id));
      create policy "Users can manage own profile" on public.user_profiles for all to authenticated
        using (user_id = auth.uid()) with check (user_id = auth.uid());
      create policy "Admins can view all profiles" on public.user_profiles for select to authenticated
        using (exists (select 1 from public.user_roles binding join public.roles definition on definition.id = binding.role_id
          where binding.user_id = auth.uid() and definition.code in ('SUPER_ADMIN', 'ADMIN')));
      insert into public.organizations values ('${actor}', '{"role_permission_overrides":{}}');
      insert into public.departments values ('${actor}');
      insert into public.user_departments values ('${actor}');
      insert into public.roles values ('${actor}', 'ADMIN', null);
      insert into public.user_roles values ('${actor}', '${actor}', '${actor}');
      insert into public.user_profiles values ('${actor}'), ('${other}');
    `)
    await db.exec(migration)

    const remainingBrowserGrants = await db.query(`
      select definition.relname
      from pg_class definition join pg_namespace n on n.oid = definition.relnamespace
      cross join lateral aclexplode(definition.relacl) as acl
      where n.nspname = 'public' and definition.relname = any($1::text[])
        and (acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
    `, [organizationTables])
    expect(remainingBrowserGrants.rows).toEqual([])

    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role)
      for (const table of organizationTables) {
        await expect(db.query('select id from public.' + table)).rejects.toMatchObject({ code: '42501' })
      }
    }
    expect((await db.query('select user_id from public.user_profiles')).rows).toEqual([{ user_id: actor }])

    await db.exec('set role service_role')
    for (const table of organizationTables) {
      expect((await db.query('select id from public.' + table)).rows).toEqual([{ id: actor }])
    }
    expect((await db.query(`update public.organizations set settings = '{"role_permission_overrides":{},"test":true}'
      returning settings`)).rows).toEqual([{ settings: { role_permission_overrides: {}, test: true } }])
  } finally {
    await db.close()
  }
})

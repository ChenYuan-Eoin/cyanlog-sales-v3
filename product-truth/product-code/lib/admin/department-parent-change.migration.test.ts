// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const foreignOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actor = '11111111-1111-4111-8111-111111111111'
const otherActor = '22222222-2222-4222-8222-222222222222'
const ordinary = '33333333-3333-4333-8333-333333333333'
const oldParent = '44444444-4444-4444-8444-444444444444'
const newRoot = '55555555-5555-4555-8555-555555555555'
const newParent = '66666666-6666-4666-8666-666666666666'
const department = '77777777-7777-4777-8777-777777777777'
const child = '88888888-8888-4888-8888-888888888888'
const grandchild = '99999999-9999-4999-8999-999999999999'
const foreignParent = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const command = 'supabase/migrations/20261127160000_department_parent_change.sql'
const stale = { code: '40001', detail: 'DEPARTMENT_PARENT_CHANGED' }
const changes = { parent_id: newParent, name: '新的部门', code: 'MOVED', sort_order: 5, leader_id: ordinary }
let db: PGlite

function installFromMigration(file: string, name: string) {
  const sql = readFileSync('supabase/migrations/' + file, 'utf8')
  const definition = sql.match(new RegExp(`create (?:or replace )?function ${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))
  if (!definition) throw new Error('Missing migration function ' + name)
  return db.exec(definition[0])
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema private;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.organizations(id uuid primary key, status text, settings jsonb);
    create table public.users(id uuid primary key, org_id uuid, status text);
    create table public.departments(
      id uuid primary key, org_id uuid, parent_id uuid references public.departments(id),
      name text, code text, leader_id uuid, sort_order int default 0, depth int default 0, path text,
      member_count int default 0, updated_at timestamptz, status text default 'active', source text default 'manual', external_id text
    );
    grant select, update on public.departments to service_role;
    create table private.test_controller(org_id uuid, user_id uuid, role text);
    create function private.org_super_admin_active_member_v1(uuid, uuid) returns boolean language sql stable as
      $$ select exists(select 1 from public.users where id = $1 and org_id = $2 and status = 'active'); $$;
    create function private.has_exact_org_role_v1(uuid, uuid, text) returns boolean language sql stable as
      $$ select exists(select 1 from private.test_controller where org_id = $2 and user_id = $1 and role = $3); $$;
    create function private.system_super_admin_role_enabled_v1(uuid) returns boolean language sql stable as
      $$ select exists(select 1 from public.organizations where id = $1 and status = 'active'); $$;
    create table private.test_scope_reference(org_id uuid, role_revision int, department_id uuid, parent_id uuid, member_id uuid);
    create function private.directory_department_authority_impact_v1(uuid, jsonb, jsonb) returns jsonb language sql stable as $$
      with scoped as (
        select reference.*,
          exists(select 1 from jsonb_to_recordset($2) as tree(id uuid, parent_id uuid)
            where tree.id = reference.department_id and tree.parent_id = reference.parent_id) as before_grant,
          exists(select 1 from jsonb_to_recordset($3) as tree(id uuid, parent_id uuid)
            where tree.id = reference.department_id and tree.parent_id = reference.parent_id) as after_grant
        from private.test_scope_reference as reference where reference.org_id = $1
      )
      select jsonb_build_object('revision', to_jsonb(scoped),
        'summary', jsonb_build_object('automaticRoleAffectedMembers', (before_grant is distinct from after_grant)::int,
          'automaticRoleSourcesAdded', (not before_grant and after_grant)::int,
          'automaticRoleSourcesRemoved', (before_grant and not after_grant)::int))
      from scoped;
    $$;
  `)
  await installFromMigration('20261021000006_personnel_lifecycle_commands.sql', 'private.personnel_lock_org_v1')
  await installFromMigration('20261126045425_system_super_admin_authority.sql', 'private.personnel_is_org_control_admin_v1')
  await installFromMigration('20261127152500_directory_transfer_authority.sql', 'private.directory_transfer_tree_v1')
  await installFromMigration('20261103120000_organization_directory_cutover.sql', 'public.update_department_path')
  await db.exec(`
    create trigger trg_departments_path before insert or update on public.departments
    for each row execute function public.update_department_path();
    insert into public.organizations values ('${org}','active','{}'), ('${foreignOrg}','active','{}');
    insert into public.users values ('${actor}','${org}','active'), ('${otherActor}','${org}','active'), ('${ordinary}','${org}','active');
    insert into private.test_controller values ('${org}','${actor}','SUPER_ADMIN'), ('${org}','${otherActor}','SUPER_ADMIN'),
      ('${org}','${ordinary}','ADMIN');
    insert into public.departments(id, org_id, parent_id, name, code) values
      ('${oldParent}','${org}',null,'Former parent','OLD'), ('${newRoot}','${org}',null,'Root','ROOT'),
      ('${newParent}','${org}','${newRoot}','New parent','NEW'),
      ('${department}','${org}','${oldParent}','Moving','MOVING'), ('${child}','${org}','${department}','Child','CHILD'),
      ('${grandchild}','${org}','${child}','Grandchild','GRANDCHILD'),
      ('${foreignParent}','${foreignOrg}',null,'Foreign department','FOREIGN');
    insert into private.test_scope_reference values ('${org}',1,'${department}','${newParent}','${ordinary}');
  `)
  await db.exec(readFileSync(command, 'utf8'))
})

afterEach(async () => { await db.close() })

async function save(patch: Record<string, unknown> = changes, by = actor, previousParent: string | null = oldParent) {
  return (await db.query<{ result: unknown }>(
    'select public.admin_save_department_parent_change_v1($1,$2,$3,$4::jsonb,$5) as result',
    [org, by, department, JSON.stringify(patch), previousParent],
  )).rows[0].result
}

it('saves the selected parent in one transaction and audits the current impact', async () => {
  await db.exec('set role service_role')
  await expect(db.query('update public.departments set parent_id = $1 where id = $2', [newParent, department]))
    .rejects.toMatchObject({ code: '42501', detail: 'DEPARTMENT_PARENT_CHANGE_COMMAND_REQUIRED' })
  expect(await save()).toEqual({
    department: { id: department, name: changes.name, code: changes.code, depth: 2, parent_id: newParent, sort_order: 5,
      member_count: 0, leader_id: ordinary },
  })
  await expect(save()).rejects.toMatchObject(stale)
  await db.exec('reset role')
  const path = `/${newRoot}/${newParent}/${department}/`
  expect((await db.query('select id, path, depth from public.departments where id = any($1::uuid[]) order by depth',
    [[department, child, grandchild]])).rows).toEqual([
    { id: department, path, depth: 2 },
    { id: child, path: path + child + '/', depth: 3 },
    { id: grandchild, path: path + child + '/' + grandchild + '/', depth: 4 },
  ])
  expect((await db.query('select before_state, after_state, impact from private.department_parent_change_audit')).rows)
    .toEqual([expect.objectContaining({
      before_state: expect.objectContaining({ parent_id: oldParent }),
      after_state: expect.objectContaining({ parent_id: newParent, code: changes.code }),
      impact: expect.objectContaining({ automaticRoleSourcesAdded: 1 }),
    })])
})

it('rejects unauthorized actors, cycles, foreign or inactive parents, and stale edits', async () => {
  await expect(save(changes, ordinary)).rejects.toMatchObject({ code: '42501' })
  await expect(save({ parent_id: grandchild })).rejects.toMatchObject({ code: '23514', detail: 'DEPARTMENT_PARENT_CYCLE' })
  await expect(save({ parent_id: foreignParent })).rejects.toMatchObject({ code: '23514', detail: 'INVALID_DEPARTMENT_PARENT' })
  await expect(save({ ...changes, code: 'ROOT' })).rejects.toMatchObject({ code: '23505', detail: 'DEPARTMENT_CODE_EXISTS' })
  await expect(save({ ...changes, sort_order: 2147483648 })).rejects.toMatchObject({ code: '22023' })
  await expect(save(changes, otherActor, null)).rejects.toMatchObject(stale)
  await db.query("update public.departments set status = 'inactive' where id = $1", [newParent])
  await expect(save()).rejects.toMatchObject({ code: '23514', detail: 'INVALID_DEPARTMENT_PARENT' })

  expect(await save({ parent_id: null, leader_id: null })).toMatchObject({
    department: { id: department, parent_id: null, depth: 0, leader_id: null },
  })
  expect((await db.query('select count(*)::int as count from private.department_parent_change_audit')).rows).toEqual([{ count: 1 }])
  expect((await db.query(`
    select has_function_privilege('anon', 'public.admin_save_department_parent_change_v1(uuid,uuid,uuid,jsonb,uuid)', 'EXECUTE')
      as anonymous, has_function_privilege('authenticated',
        'public.admin_save_department_parent_change_v1(uuid,uuid,uuid,jsonb,uuid)', 'EXECUTE') as authenticated
  `)).rows).toEqual([{ anonymous: false, authenticated: false }])
})

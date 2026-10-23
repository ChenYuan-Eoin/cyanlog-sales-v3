import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261021000006_personnel_lifecycle_commands.sql'),
  'utf8',
)
const roleScopeMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261022000001_role_scope_lifecycle.sql'),
  'utf8',
)
const membershipRemovalMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261022000002_remove_tenant_membership.sql'),
  'utf8',
)

const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherOrgId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const adminOne = '11111111-1111-4111-8111-111111111111'
const adminTwo = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const rootRole = '44444444-4444-4444-8444-444444444444'
const salesRole = '55555555-5555-4555-8555-555555555555'
const departmentOne = '66666666-6666-4666-8666-666666666666'
const departmentTwo = '77777777-7777-4777-8777-777777777777'
const spaceId = '88888888-8888-4888-8888-888888888888'

describe('personnel lifecycle migration', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.organizations (id uuid primary key);
      create table public.users (
        id uuid primary key,
        org_id uuid not null references public.organizations(id),
        status text not null default 'active',
        login_enabled boolean not null default true,
        password_hash text,
        must_change_password boolean not null default false,
        primary_dept_id uuid,
        report_to_user_id uuid,
        updated_at timestamptz default now()
      );
      create table public.departments (
        id uuid primary key,
        org_id uuid not null references public.organizations(id),
        parent_id uuid
      );
      create table public.user_organizations (
        user_id uuid not null references public.users(id),
        org_id uuid not null references public.organizations(id),
        is_default boolean not null default true,
        status text not null default 'active',
        membership_id uuid,
        joined_at timestamptz default now(),
        left_at timestamptz,
        membership_version bigint not null default 1,
        created_by uuid references public.users(id),
        updated_by uuid references public.users(id),
        created_at timestamptz default now(),
        updated_at timestamptz default now(),
        primary key (user_id, org_id)
      );
      create table public.roles (id uuid primary key, code text not null);
      create table public.user_roles (
        user_id uuid not null references public.users(id),
        role_id uuid not null references public.roles(id),
        org_id uuid not null references public.organizations(id),
        scope_type text not null default 'org',
        scope_id uuid,
        granted_by uuid,
        granted_at timestamptz default now(),
        primary key (user_id, role_id, scope_type, scope_id)
      );
      create table public.auth_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null);
      create table public.user_departments (
        user_id uuid not null,
        department_id uuid not null,
        org_id uuid not null,
        is_primary boolean not null default false,
        primary key (user_id, department_id)
      );
      create table public.sales_spaces (
        id uuid primary key,
        org_id uuid not null,
        department_id uuid not null
      );
      create table public.sales_space_members (
        space_id uuid not null,
        user_id uuid not null,
        org_id uuid not null,
        space_role text not null default 'MEMBER',
        primary key (space_id, user_id)
      );
      create table public.user_permission_assignments (
        user_id uuid not null,
        org_id uuid not null,
        permission_point_id uuid
      );
      create table public.organization_sources (
        id uuid primary key,
        system_org_id uuid not null
      );

      insert into public.organizations (id) values ('${orgId}'), ('${otherOrgId}');
      insert into public.users (id, org_id, status, login_enabled, primary_dept_id)
      values
        ('${adminOne}', '${orgId}', 'active', true, '${departmentOne}'),
        ('${adminTwo}', '${orgId}', 'active', true, '${departmentOne}'),
        ('${memberId}', '${orgId}', 'active', true, '${departmentOne}');
      insert into public.departments (id, org_id, parent_id)
      values ('${departmentOne}', '${orgId}', null), ('${departmentTwo}', '${orgId}', null);
      insert into public.sales_spaces (id, org_id, department_id)
      values ('${spaceId}', '${orgId}', '${departmentTwo}');
      insert into public.roles (id, code)
      values ('${rootRole}', 'SUPER_ADMIN'), ('${salesRole}', 'SALES');
      insert into public.user_organizations (user_id, org_id, status)
      values
        ('${adminOne}', '${orgId}', 'active'),
        ('${adminTwo}', '${orgId}', 'active'),
        ('${memberId}', '${orgId}', 'active'),
        ('${memberId}', '${otherOrgId}', 'active');
      update public.user_organizations
      set is_default = false
      where user_id = '${memberId}' and org_id = '${otherOrgId}';
      insert into public.user_roles (user_id, role_id, org_id, scope_type, scope_id)
      values
        ('${adminOne}', '${rootRole}', '${orgId}', 'org', '${orgId}'),
        ('${adminTwo}', '${rootRole}', '${orgId}', 'org', '${orgId}'),
        ('${memberId}', '${salesRole}', '${orgId}', 'org', '${orgId}');
      insert into public.user_departments (user_id, department_id, org_id, is_primary)
      values ('${memberId}', '${departmentOne}', '${orgId}', true);
      insert into public.auth_tokens (user_id) values ('${memberId}');
    `)
    await db.exec(migration)
    await db.exec(roleScopeMigration)
    await db.exec(membershipRemovalMigration)
  })

  afterEach(async () => {
    await db.close()
  })

  it('transfer is atomic across user, membership, departments, spaces and audit', async () => {
    const result = await db.query<{ ok: boolean }>(`
      select public.admin_transfer_primary_department_v1(
        '${adminOne}', '${orgId}', '${memberId}', '${departmentTwo}',
        'transfer approved', 'request-transfer-1'
      ) as ok
    `)
    expect(result.rows[0].ok).toBe(true)

    const state = await db.query<{
      primary_dept_id: string
      membership_department_id: string
      department_id: string
      space_id: string
      event_count: number
    }>(`
      select
        user_row.primary_dept_id,
        membership.primary_department_id as membership_department_id,
        department.department_id,
        space.space_id,
        (select count(*)::int from public.personnel_lifecycle_events
          where target_user_id = '${memberId}' and command = 'assign_primary_department') as event_count
      from public.users as user_row
      join public.user_organizations as membership
        on membership.user_id = user_row.id and membership.org_id = user_row.org_id
      join public.user_departments as department
        on department.user_id = user_row.id and department.is_primary = true
      join public.sales_space_members as space
        on space.user_id = user_row.id and space.space_id = '${spaceId}'
      where user_row.id = '${memberId}'
    `)
    expect(state.rows[0]).toEqual({
      primary_dept_id: departmentTwo,
      membership_department_id: departmentTwo,
      department_id: departmentTwo,
      space_id: spaceId,
      event_count: 1,
    })
  })

  it('offboarding ends membership, revokes authority/session and preserves before/after audit', async () => {
    const result = await db.query<{ ok: boolean }>(`
      select public.admin_offboard_member_v1(
        '${adminOne}', '${orgId}', '${memberId}', 'resignation approved', 'request-offboard-1'
      ) as ok
    `)
    expect(result.rows[0].ok).toBe(true)

    const state = await db.query<{
      user_status: string
      login_enabled: boolean
      membership_status: string
      employment_status: string
      roles: number
      tokens: number
      event_before: Record<string, unknown>
    }>(`
      select
        user_row.status as user_status,
        user_row.login_enabled,
        membership.status as membership_status,
        membership.employment_status,
        (select count(*)::int from public.user_roles where user_id = '${memberId}') as roles,
        (select count(*)::int from public.auth_tokens where user_id = '${memberId}') as tokens,
        (select before_state from public.personnel_lifecycle_events
          where target_user_id = '${memberId}' and command = 'offboard_member'
          order by occurred_at desc limit 1) as event_before
      from public.users as user_row
      join public.user_organizations as membership
        on membership.user_id = user_row.id and membership.org_id = user_row.org_id
      where user_row.id = '${memberId}'
    `)
    expect(state.rows[0]).toMatchObject({
      user_status: 'inactive',
      login_enabled: false,
      membership_status: 'ended',
      employment_status: 'ended',
      roles: 0,
      tokens: 0,
      event_before: expect.objectContaining({
        role_ids: [salesRole],
        department_ids: [departmentOne],
      }),
    })
  })

  it('last organization control administrator cannot be stripped of root roles', async () => {
    await db.query(`
      delete from public.user_roles
      where user_id = '${adminTwo}' and org_id = '${orgId}'
    `)

    await expect(db.query(`
      select public.admin_replace_org_roles_v1(
        '${adminOne}', '${orgId}', '${adminOne}', array[]::uuid[], 'test last admin', null
      )
    `)).rejects.toThrow(/last active organization control administrator/)

    const count = await db.query<{ count: number }>(`
      select count(*)::int as count from public.user_roles
      where user_id = '${adminOne}' and role_id = '${rootRole}'
    `)
    expect(count.rows[0].count).toBe(1)
  })

  it('invitation acceptance activates the invited membership and assigns deferred roles atomically', async () => {
    await db.exec(`
      update public.users
      set status = 'inactive', login_enabled = false
      where id = '${memberId}';
      update public.user_organizations
      set status = 'invited'
      where user_id = '${memberId}' and org_id = '${orgId}';
      delete from public.user_roles where user_id = '${memberId}';
      insert into public.personnel_invitations (
        org_id, user_id, token_hash, role_ids, status, expires_at, created_by
      ) values (
        '${orgId}', '${memberId}', 'token-hash-1', array['${salesRole}']::uuid[],
        'pending', now() + interval '1 day', '${adminOne}'
      );
    `)

    const accepted = await db.query<{ result: Record<string, string> }>(`
      select public.accept_personnel_invitation_v1(
        'token-hash-1', 'new-password-hash', 'request-activate-1'
      ) as result
    `)
    expect(accepted.rows[0].result).toEqual({ org_id: orgId, user_id: memberId })

    const state = await db.query<{
      status: string
      login_enabled: boolean
      membership_status: string
      invitation_status: string
      role_id: string
      event_count: number
    }>(`
      select
        user_row.status,
        user_row.login_enabled,
        membership.status as membership_status,
        invitation.status as invitation_status,
        role.role_id,
        (select count(*)::int from public.personnel_lifecycle_events
          where target_user_id = '${memberId}' and command = 'activate_membership') as event_count
      from public.users as user_row
      join public.user_organizations as membership
        on membership.user_id = user_row.id and membership.org_id = user_row.org_id
      join public.personnel_invitations as invitation
        on invitation.user_id = user_row.id and invitation.token_hash = 'token-hash-1'
      join public.user_roles as role
        on role.user_id = user_row.id and role.org_id = user_row.org_id
      where user_row.id = '${memberId}'
    `)
    expect(state.rows[0]).toEqual({
      status: 'active',
      login_enabled: true,
      membership_status: 'active',
      invitation_status: 'accepted',
      role_id: salesRole,
      event_count: 1,
    })
  })

  it('assigns and revokes department and sales-space role scopes with tenant validation and audit', async () => {
    const assigned = await db.query<{ ok: boolean }>(`
      select public.admin_set_role_scope_assignment_v1(
        '${adminOne}', '${orgId}', '${memberId}', '${salesRole}',
        'department', '${departmentTwo}', 'assign', 'department operator', 'scope-assign-1'
      ) as ok
    `)
    expect(assigned.rows[0].ok).toBe(true)

    const departmentAssignment = await db.query<{ count: number }>(`
      select count(*)::int as count from public.user_roles
      where user_id = '${memberId}' and role_id = '${salesRole}'
        and org_id = '${orgId}' and scope_type = 'department' and scope_id = '${departmentTwo}'
    `)
    expect(departmentAssignment.rows[0].count).toBe(1)

    const revoked = await db.query<{ ok: boolean }>(`
      select public.admin_set_role_scope_assignment_v1(
        '${adminOne}', '${orgId}', '${memberId}', '${salesRole}',
        'department', '${departmentTwo}', 'revoke', 'department operator removed', 'scope-revoke-1'
      ) as ok
    `)
    expect(revoked.rows[0].ok).toBe(true)
    const audit = await db.query<{ count: number }>(`
      select count(*)::int as count from public.personnel_lifecycle_events
      where target_user_id = '${memberId}'
        and command in ('assign_scoped_role', 'revoke_scoped_role')
    `)
    expect(audit.rows[0].count).toBe(2)
  })

  it('rejects cross-tenant department scopes and last-admin role revocation', async () => {
    const otherDepartment = '99999999-9999-4999-8999-999999999999'
    await db.exec(`
      insert into public.departments (id, org_id) values ('${otherDepartment}', '${otherOrgId}');
    `)
    await expect(db.query(`
      select public.admin_set_role_scope_assignment_v1(
        '${adminOne}', '${orgId}', '${memberId}', '${salesRole}',
        'department', '${otherDepartment}', 'assign', 'cross tenant', null
      )
    `)).rejects.toThrow(/department scope does not match tenant/)

    await db.query(`
      delete from public.user_roles
      where user_id = '${adminTwo}' and role_id = '${rootRole}'
    `)
    await expect(db.query(`
      select public.admin_set_role_scope_assignment_v1(
        '${adminOne}', '${orgId}', '${adminOne}', '${rootRole}',
        'org', '${orgId}', 'revoke', 'remove last admin', null
      )
    `)).rejects.toThrow(/last active organization control administrator/)
  })

  it('removes one tenant membership while preserving the account and another tenant membership', async () => {
    await db.exec(`
      insert into public.personnel_invitations (
        org_id, user_id, token_hash, role_ids, status, expires_at, created_by
      ) values (
        '${orgId}', '${memberId}', 'pending-remove-token', array['${salesRole}']::uuid[],
        'pending', now() + interval '1 day', '${adminOne}'
      );
    `)

    const removed = await db.query<{ ok: boolean }>(`
      select public.admin_remove_tenant_membership_v1(
        '${adminOne}', '${orgId}', '${memberId}',
        'tenant collaboration ended', 'remove-membership-1'
      ) as ok
    `)
    expect(removed.rows[0].ok).toBe(true)

    const state = await db.query<{
      user_status: string
      login_enabled: boolean
      home_org_id: string
      removed_membership_status: string
      other_membership_status: string
      other_membership_default: boolean
      target_roles: number
      target_departments: number
      target_spaces: number
      tokens: number
      invitation_status: string
      event_count: number
    }>(`
      select
        user_row.status as user_status,
        user_row.login_enabled,
        user_row.org_id as home_org_id,
        removed_membership.status as removed_membership_status,
        other_membership.status as other_membership_status,
        other_membership.is_default as other_membership_default,
        (select count(*)::int from public.user_roles
          where user_id = '${memberId}' and org_id = '${orgId}') as target_roles,
        (select count(*)::int from public.user_departments
          where user_id = '${memberId}' and org_id = '${orgId}') as target_departments,
        (select count(*)::int from public.sales_space_members
          where user_id = '${memberId}' and org_id = '${orgId}') as target_spaces,
        (select count(*)::int from public.auth_tokens where user_id = '${memberId}') as tokens,
        (select status from public.personnel_invitations
          where user_id = '${memberId}' and token_hash = 'pending-remove-token') as invitation_status,
        (select count(*)::int from public.personnel_lifecycle_events
          where target_user_id = '${memberId}' and command = 'remove_tenant_membership') as event_count
      from public.users as user_row
      join public.user_organizations as removed_membership
        on removed_membership.user_id = user_row.id
       and removed_membership.org_id = '${orgId}'
      join public.user_organizations as other_membership
        on other_membership.user_id = user_row.id
       and other_membership.org_id = '${otherOrgId}'
      where user_row.id = '${memberId}'
    `)
    expect(state.rows[0]).toMatchObject({
      user_status: 'active',
      login_enabled: true,
      home_org_id: otherOrgId,
      removed_membership_status: 'ended',
      other_membership_status: 'active',
      other_membership_default: true,
      target_roles: 0,
      target_departments: 0,
      target_spaces: 0,
      tokens: 0,
      invitation_status: 'revoked',
      event_count: 1,
    })
  })

  it('revoking an invitation ends the invited membership without allowing active-member revocation through that entry point', async () => {
    await db.exec(`
      delete from public.user_organizations
      where user_id = '${memberId}' and org_id = '${otherOrgId}';
      update public.users
      set status = 'inactive', login_enabled = false
      where id = '${memberId}';
      update public.user_organizations
      set status = 'invited'
      where user_id = '${memberId}' and org_id = '${orgId}';
      insert into public.personnel_invitations (
        org_id, user_id, token_hash, role_ids, status, expires_at, created_by
      ) values (
        '${orgId}', '${memberId}', 'revoke-invite-token', array[]::uuid[],
        'pending', now() + interval '1 day', '${adminOne}'
      );
    `)

    const revoked = await db.query<{ ok: boolean }>(`
      select public.admin_revoke_personnel_invitation_v1(
        '${adminOne}', '${orgId}', '${memberId}',
        'invite withdrawn', 'revoke-invite-1'
      ) as ok
    `)
    expect(revoked.rows[0].ok).toBe(true)

    const state = await db.query<{
      user_status: string
      login_enabled: boolean
      membership_status: string
      invitation_status: string
      event_count: number
    }>(`
      select
        user_row.status as user_status,
        user_row.login_enabled,
        membership.status as membership_status,
        invitation.status as invitation_status,
        (select count(*)::int from public.personnel_lifecycle_events
          where target_user_id = '${memberId}' and command = 'revoke_invitation') as event_count
      from public.users as user_row
      join public.user_organizations as membership
        on membership.user_id = user_row.id and membership.org_id = '${orgId}'
      join public.personnel_invitations as invitation
        on invitation.user_id = user_row.id and invitation.token_hash = 'revoke-invite-token'
      where user_row.id = '${memberId}'
    `)
    expect(state.rows[0]).toEqual({
      user_status: 'inactive',
      login_enabled: false,
      membership_status: 'ended',
      invitation_status: 'revoked',
      event_count: 1,
    })
  })
})

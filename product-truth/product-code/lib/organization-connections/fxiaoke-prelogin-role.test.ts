import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { productionSchemaDatabase } from './schema-baseline/database'

it('preassigns an organization role without opening the account and preserves it at verified first login', async () => {
  const db = await productionSchemaDatabase()
  const readSql = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')
  try {
    // The captured schema predates the administrative directory reader.
    const directory = readSql('supabase/migrations/20261103120000_organization_directory_cutover.sql')
    const readerStart = directory.indexOf('create or replace function public.get_org_admin_directory_payload_v1')
    const readerEnd = directory.indexOf('to service_role;', readerStart) + 'to service_role;'.length
    await db.exec(directory.slice(readerStart, readerEnd))
    await db.exec(readSql('supabase/migrations/20261021000006_personnel_lifecycle_commands.sql'))
    await db.exec(`create table public.auth_tokens (
      id uuid primary key default gen_random_uuid(), token text not null,
      user_id uuid not null references public.users(id), expires_at timestamptz not null
    )`)
    await db.exec(readSql('supabase/migrations/20261111000000_fxiaoke_sso_without_invitation.sql'))
    await db.exec(readSql('supabase/migrations/20261112000001_fxiaoke_baseline_scoped_role_guard.sql'))
    await db.exec(readSql('supabase/migrations/20261118095000_fxiaoke_prelogin_role_assignment.sql'))
    await db.exec(readSql('lib/organization-connections/fxiaoke-prelogin-role.test.sql'))
  } finally {
    await db.close()
  }
}, 30_000)

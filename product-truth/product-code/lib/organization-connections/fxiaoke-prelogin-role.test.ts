import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { connectionMigration, directoryMigration, preCutoverBaseline, productionSchemaDatabase } from './schema-baseline/database'

it('preassigns an organization role without opening the account and preserves it at verified first login', async () => {
  const db = await productionSchemaDatabase(preCutoverBaseline)
  const readSql = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')
  try {
    await db.exec(connectionMigration)
    await db.exec(directoryMigration)
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

// REQ: WP10 environment isolation.
import { describe, expect, it } from 'vitest'
import { assertDatabaseEnvironment } from './database-environment'
const databaseUrl = 'https://wfawwhphfqqwfwrrkogy.supabase.co'
describe('database environment boundary', () => {
  it('blocks local production-mode servers as well as dev servers', () => {
    expect(() => assertDatabaseEnvironment({ databaseUrl })).toThrow('DATABASE_ENVIRONMENT_MISMATCH')
  })
  it('blocks a Vercel preview using production credentials', () => {
    expect(() => assertDatabaseEnvironment({ databaseUrl, vercel: '1', vercelEnv: 'preview' })).toThrow('DATABASE_ENVIRONMENT_MISMATCH')
  })
  it('blocks a localhost browser', () => {
    expect(() => assertDatabaseEnvironment({ databaseUrl, browserHostname: 'localhost' })).toThrow('DATABASE_ENVIRONMENT_MISMATCH')
  })
  it('allows the actual production deployment and canonical production browser', () => {
    expect(() => assertDatabaseEnvironment({ databaseUrl, vercel: '1', vercelEnv: 'production' })).not.toThrow()
    expect(() => assertDatabaseEnvironment({ databaseUrl, browserHostname: 'sales.cyanlog.icu' })).not.toThrow()
  })
  it('allows the isolated project and local database', () => {
    expect(() => assertDatabaseEnvironment({ databaseUrl: 'https://vsfropnfsmnonkotywsx.supabase.co' })).not.toThrow()
    expect(() => assertDatabaseEnvironment({ databaseUrl: 'http://127.0.0.1:54321' })).not.toThrow()
  })
})

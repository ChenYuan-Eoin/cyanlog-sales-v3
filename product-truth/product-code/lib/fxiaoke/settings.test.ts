// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], projections: [] as string[] }))
const upstream = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('./client', () => ({ previewDirectory: upstream.preview }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => {
  if (table !== 'organization_fxiaoke_connections') throw new Error('Unexpected table write')
  let operation = 'read'; let payload: Record<string, unknown> = {}; let columns = '*'
  const filters: Array<[string, unknown]> = []
  let leaseCutoff: string | null = null
  const query = {
    select(value: string) { columns = value; db.projections.push(value); return query },
    eq(key: string, value: unknown) { filters.push([key, value]); return query },
    or(value: string) { leaseCutoff = value.split('preview_started_at.lt.')[1]; return query },
    update(value: Record<string, unknown>) { operation = 'update'; payload = value; return query },
    insert(value: Record<string, unknown>) { operation = 'insert'; payload = value; return query },
    async maybeSingle() {
      let row = db.rows.find(item => filters.every(([key, value]) => item[key] === value))
      if (row && leaseCutoff && row.preview_started_at && String(row.preview_started_at) >= leaseCutoff) row = undefined
      if (operation === 'insert') {
        if (db.rows.some(item => item.system_org_id === payload.system_org_id)) return { data: null, error: { code: '23505' } }
        row = { ...payload }; db.rows.push(row)
      } else if (operation === 'update' && row) Object.assign(row, payload)
      return { data: row ? Object.fromEntries(columns.split(',').map(key => [key, row![key]])) : null, error: null }
    },
  }; return query
} } }))
import { loadConnection, previewSavedConnection, saveConnection } from './settings'
import { decryptCredentials } from './crypto'
const input = { appId: 'FSAID_test', expectedEa: 'example', apiUserId: '123', appSecret: 'test-secret', permanentCode: 'test-code', revision: null }
beforeEach(() => { db.rows.length = 0; db.projections.length = 0; upstream.preview.mockReset(); vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', 'ab'.repeat(32)) })
afterEach(() => vi.unstubAllEnvs())
it('encrypts on save, reads public metadata back, and never returns secrets', async () => {
  const result = await saveConnection('org-a', 'admin', input)
  expect(result).toMatchObject({ configured: true, lastCheckStatus: 'not_checked' })
  expect(JSON.stringify(result)).not.toContain('test-secret')
  expect(JSON.stringify(db.rows)).not.toContain('test-secret')
  expect(JSON.parse(decryptCredentials('org-a', String(db.rows[0].credentials_ciphertext)))).toMatchObject({ appSecret: input.appSecret })
  db.projections.length = 0
  expect(await loadConnection('org-b')).toBeNull()
  expect(db.projections.some(value => value.includes('ciphertext'))).toBe(false)
})
it('preserves blank-edit secrets only within the same app and enterprise', async () => {
  const saved = await saveConnection('org-a', 'admin', input)
  const next = await saveConnection('org-a', 'admin', { appId: input.appId, expectedEa: input.expectedEa, apiUserId: '456', revision: saved!.revision })
  expect(next!.revision).not.toBe(saved!.revision)
  expect(db.rows).toHaveLength(1)
  expect(JSON.parse(decryptCredentials('org-a', String(db.rows[0].credentials_ciphertext))).appSecret).toBe(input.appSecret)
  await expect(saveConnection('org-a', 'admin', { appId: 'another-app', expectedEa: input.expectedEa, apiUserId: '456', revision: next!.revision })).rejects.toMatchObject({ code: 'CREDENTIALS_REQUIRED' })
})
it('rejects stale updates and duplicate first saves instead of overwriting configuration', async () => {
  await saveConnection('org-a', 'admin', input)
  await expect(saveConnection('org-a', 'admin', input)).rejects.toMatchObject({ code: 'CONFIG_CHANGED' })
  expect(db.rows).toHaveLength(1)
})
it('leases previews and refuses concurrent provider calls', async () => {
  const saved = await saveConnection('org-a', 'admin', input)
  upstream.preview.mockResolvedValue({ checkedAt: '2026-10-27T00:00:00Z', applied: false })
  await previewSavedConnection('org-a', saved!.revision)
  expect((await loadConnection('org-a'))?.lastCheckStatus).toBe('preview_ready')
  await expect(previewSavedConnection('org-a', saved!.revision)).rejects.toMatchObject({ code: 'PREVIEW_BUSY' })
  expect(upstream.preview).toHaveBeenCalledTimes(1)
})
it('does not record success for credentials changed during preview', async () => {
  const saved = await saveConnection('org-a', 'admin', input)
  upstream.preview.mockImplementation(async () => {
    db.rows[0].revision = 'another-revision'
    return { checkedAt: '2026-10-27T00:00:00Z', applied: false }
  })
  await expect(previewSavedConnection('org-a', saved!.revision)).rejects.toMatchObject({ code: 'CONFIG_CHANGED' })
  expect(db.rows[0].last_check_status).toBe('not_checked')
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  tableCalls: [] as string[],
}))

const providerMocks = vi.hoisted(() => {
  const makeAdapter = (provider: 'feishu' | 'fxiaoke') => ({
    provider,
    label: provider === 'feishu' ? '飞书' : '纷享销客',
    previewAvailable: true,
    syncAvailable: provider === 'feishu',
    fields: [
      { key: 'appId', label: 'AppID', type: 'text' as const, placeholder: '', help: '', secret: false },
      { key: 'appSecret', label: 'AppSecret', type: 'password' as const, placeholder: '', help: '', secret: true },
    ],
    parseInput: vi.fn((value: unknown) => value as Record<string, unknown>),
    prepare: vi.fn((input: Record<string, unknown>, previous: Record<string, unknown> | null) => {
      const appId = String(input.appId || '')
      const appSecret = String(input.appSecret || previous?.appSecret || '')
      return {
        credentials: { appId, appSecret, externalTenantId: `${provider}:${appId}` },
        metadata: { appId },
        externalTenantId: `${provider}:${appId}`,
      }
    }),
    validateStored: vi.fn((value: Record<string, unknown>) => value),
    verify: vi.fn(async () => ({
      checkedAt: '2026-11-03T05:00:00.000Z',
      externalTenantId: `${provider}:tenant`,
      metadata: { tenantName: '示例企业' },
      departments: [{ id: 'dept-1', name: '研发部', parentId: null, status: 'active' }],
      employees: [{ id: 'user-1', name: '张三', departmentIds: ['dept-1'], status: 'active', loginDisabled: false }],
      warnings: [],
    })),
  })
  return { feishu: makeAdapter('feishu'), fxiaoke: makeAdapter('fxiaoke') }
})

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      db.tableCalls.push(table)
      if (table !== 'organization_sources') throw new Error(`Unexpected table ${table}`)

      let operation: 'select' | 'insert' | 'update' = 'select'
      let payload: Row = {}
      let selectAfterWrite = false
      let orderBy: { field: string; ascending: boolean } | null = null
      let rowLimit = Number.POSITIVE_INFINITY
      const filters: Array<{ field: string; operator: 'eq' | 'neq' | 'not-null'; value?: unknown }> = []
      let leaseFilter: { cutoff: string } | null = null

      const matches = (row: Row) => {
        const regular = filters.every(filter => {
          if (filter.operator === 'eq') return row[filter.field] === filter.value
          if (filter.operator === 'neq') return row[filter.field] !== filter.value
          return row[filter.field] !== null && row[filter.field] !== undefined
        })
        if (!regular) return false
        if (!leaseFilter) return true
        const started = row.verification_started_at
        return started == null || String(started) < leaseFilter.cutoff
      }

      const execute = () => {
        if (operation === 'insert') {
          const duplicate = Boolean(payload.draft_credentials_ciphertext || payload.effective_credentials_ciphertext)
            && db.rows.some(row => (
              row.system_org_id === payload.system_org_id
              && row.provider === payload.provider
              && Boolean(row.draft_credentials_ciphertext || row.effective_credentials_ciphertext)
            ))
          if (duplicate) return { data: null, error: { code: '23505' } }
          const inserted = { ...payload }
          db.rows.push(inserted)
          return { data: selectAfterWrite ? inserted : null, error: null }
        }

        const matching = db.rows.filter(matches)
        if (operation === 'update') {
          for (const row of matching) Object.assign(row, payload)
          return {
            data: matching.length === 1 ? { ...matching[0] } : matching.map(row => ({ ...row })),
            error: null,
          }
        }

        const selected = matching.map(row => ({ ...row }))
        if (orderBy) {
          selected.sort((left, right) => {
            const comparison = String(left[orderBy!.field] || '').localeCompare(String(right[orderBy!.field] || ''))
            return orderBy!.ascending ? comparison : -comparison
          })
        }
        return { data: selected.slice(0, rowLimit), error: null }
      }

      const query = {
        select() {
          if (operation !== 'select') selectAfterWrite = true
          return query
        },
        insert(value: Row) { operation = 'insert'; payload = value; return query },
        update(value: Row) { operation = 'update'; payload = value; return query },
        eq(field: string, value: unknown) { filters.push({ field, operator: 'eq', value }); return query },
        neq(field: string, value: unknown) { filters.push({ field, operator: 'neq', value }); return query },
        not(field: string) { filters.push({ field, operator: 'not-null' }); return query },
        or(value: string) {
          const marker = 'verification_started_at.lt.'
          const cutoff = value.includes(marker) ? value.slice(value.indexOf(marker) + marker.length) : ''
          leaseFilter = cutoff ? { cutoff } : null
          return query
        },
        order(field: string, options?: { ascending?: boolean }) {
          orderBy = { field, ascending: options?.ascending !== false }
          return query
        },
        limit(value: number) { rowLimit = value; return query },
        async maybeSingle() {
          const result = execute()
          const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : []
          return { data: rows[0] || null, error: result.error }
        },
        async single() {
          const result = execute()
          const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : []
          return { data: rows[0] || null, error: result.error }
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(execute()).then(resolve, reject)
        },
      }
      return query
    },
  },
}))

vi.mock('./adapters', () => ({
  adapters: providerMocks,
  getConnectionAdapter: (provider: string) => {
    if (provider !== 'feishu' && provider !== 'fxiaoke') throw new Error('unsupported provider')
    return providerMocks[provider]
  },
}))

import {
  loadOrganizationConnection,
  loadVerifiedConnection,
  migrateLegacyFeishuConnection,
  previewOrganizationConnection,
  promoteOrganizationConnection,
  saveOrganizationConnection,
} from './service'

const orgId = '00000000-0000-4000-8000-000000000001'

beforeEach(() => {
  db.rows.length = 0
  db.tableCalls.length = 0
  vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', 'ab'.repeat(32))
  providerMocks.feishu.verify.mockClear()
  providerMocks.fxiaoke.verify.mockClear()
  providerMocks.feishu.prepare.mockClear()
  providerMocks.fxiaoke.prepare.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('shared organization connection lifecycle', () => {
  it('uses one save/preview/promote lifecycle for Feishu and Fxiaoke without auto-activation', async () => {
    for (const provider of ['feishu', 'fxiaoke'] as const) {
      const saved = await saveOrganizationConnection({
        orgId,
        actorId: '00000000-0000-4000-8000-000000000099',
        provider,
        value: { appId: `${provider}-app`, appSecret: `${provider}-secret`, revision: null },
      })
      expect(saved).toMatchObject({ provider, state: 'configured', draftCheckStatus: 'not_checked', effectiveVerified: false })
      expect(db.rows.find(row => row.provider === provider)).toMatchObject({
        status: 'draft',
        effective_revision: null,
      })
      expect(JSON.stringify(db.rows.find(row => row.provider === provider))).not.toContain(`${provider}-secret`)

      const preview = await previewOrganizationConnection({
        orgId,
        actorId: '00000000-0000-4000-8000-000000000099',
        provider,
        revision: saved.revision,
      })
      expect(preview.preview).toMatchObject({ provider, applied: false })
      expect(preview.connection).toMatchObject({ state: 'verified', draftCheckStatus: 'preview_ready', effectiveVerified: false })
      await expect(loadVerifiedConnection({ orgId, provider })).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' })

      const promoted = await promoteOrganizationConnection({
        orgId,
        actorId: '00000000-0000-4000-8000-000000000099',
        provider,
        configurationRevision: saved.revision,
      })
      expect(promoted.effectiveVerified).toBe(true)
      await expect(loadVerifiedConnection({ orgId, provider })).resolves.toMatchObject({
        provider,
        credentials: { appId: `${provider}-app`, appSecret: `${provider}-secret` },
      })
    }

    expect(providerMocks.feishu.prepare).toHaveBeenCalledOnce()
    expect(providerMocks.fxiaoke.prepare).toHaveBeenCalledOnce()
    expect(providerMocks.feishu.verify).toHaveBeenCalledOnce()
    expect(providerMocks.fxiaoke.verify).toHaveBeenCalledOnce()
  })

  it('keeps the previous effective credentials when a new draft fails verification', async () => {
    const first = await saveOrganizationConnection({
      orgId,
      actorId: '00000000-0000-4000-8000-000000000099',
      provider: 'feishu',
      value: { appId: 'stable-app', appSecret: 'example-stable-secret', revision: null },
    })
    await previewOrganizationConnection({ orgId, actorId: 'actor-1', provider: 'feishu', revision: first.revision })
    const promoted = await promoteOrganizationConnection({
      orgId,
      actorId: 'actor-1',
      provider: 'feishu',
      configurationRevision: first.revision,
    })

    const draft = await saveOrganizationConnection({
      orgId,
      actorId: 'actor-1',
      provider: 'feishu',
      value: { appId: 'stable-app', appSecret: 'example-replacement-secret', revision: promoted.revision },
    })
    providerMocks.feishu.verify.mockRejectedValueOnce(new Error('directory permission denied'))
    await expect(previewOrganizationConnection({
      orgId,
      actorId: 'actor-1',
      provider: 'feishu',
      revision: draft.revision,
    })).rejects.toMatchObject({ code: 'PREVIEW_FAILED' })

    const afterFailure = await loadOrganizationConnection(orgId, 'feishu')
    expect(afterFailure).toMatchObject({
      state: 'verified',
      draftCheckStatus: 'failed',
      effectiveVerified: true,
    })
    await expect(loadVerifiedConnection({ orgId, provider: 'feishu' })).resolves.toMatchObject({
      revision: first.revision,
      credentials: { appSecret: 'example-stable-secret' },
    })
  })

  it('does not read legacy Feishu environment values until an explicit migration is requested', async () => {
    vi.stubEnv('FEISHU_APP_ID', 'legacy-app')
    vi.stubEnv('FEISHU_APP_SECRET', 'legacy-secret')

    expect(await loadOrganizationConnection(orgId, 'feishu')).toBeNull()
    expect(db.rows).toHaveLength(0)

    const imported = await migrateLegacyFeishuConnection(orgId, 'actor-1')
    expect(imported).toMatchObject({ provider: 'feishu', state: 'configured', configured: true })
    expect(db.rows[0]).toMatchObject({ provider: 'feishu', status: 'draft', effective_revision: null })
    await expect(migrateLegacyFeishuConnection(orgId, 'actor-1')).rejects.toMatchObject({
      code: 'LEGACY_CONFIGURATION_ALREADY_IMPORTED',
      status: 409,
    })
    expect(db.rows).toHaveLength(1)
    expect(providerMocks.feishu.verify).not.toHaveBeenCalled()
  })

  it('prevents repeated provider reads while a successful preview lease is fresh', async () => {
    const saved = await saveOrganizationConnection({
      orgId,
      actorId: 'actor-1',
      provider: 'feishu',
      value: { appId: 'app', appSecret: 'secret', revision: null },
    })
    await previewOrganizationConnection({ orgId, actorId: 'actor-1', provider: 'feishu', revision: saved.revision })
    await expect(previewOrganizationConnection({
      orgId,
      actorId: 'actor-1',
      provider: 'feishu',
      revision: saved.revision,
    })).rejects.toMatchObject({ code: 'PREVIEW_BUSY' })
    expect(providerMocks.feishu.verify).toHaveBeenCalledOnce()
  })
})

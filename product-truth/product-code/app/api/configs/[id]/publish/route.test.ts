/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

const accessMocks = vi.hoisted(() => ({
  userHasOrgConfigAccess: vi.fn(),
  userHasFreshOrgConfigAccess: vi.fn(),
}))

const orgMocks = vi.hoisted(() => ({
  getFreshDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => accessMocks)
vi.mock('@/lib/scoped-access', () => orgMocks)

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const CANARY_SECRET = 'sk-canary-never-return-this-value'

function makeSelectSingle(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

function makeArchiveQuery() {
  return {
    error: null,
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
  }
}

function makePublishUpdate(data: unknown, error: unknown = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
}

function platformProvider(
  id: string,
  key: string,
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
  apiKey: string,
) {
  return {
    id,
    org_id: 'org-1',
    type: 'AI_CONFIG',
    key,
    name: key,
    status,
    value: {
      schema_version: 'ai-platform.v1',
      kind: 'provider_connection',
      asset_id: 'provider.cloud',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: apiKey,
      connection_timeout_ms: 45000,
      enabled: true,
    },
  }
}

describe('POST /api/configs/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getFreshDefaultOrgId.mockResolvedValue('org-1')
  })

  it('发布 UI_THEME 时按类型归档同组织其他已发布主题，保证唯一 active BrandProfile', async () => {
    const archiveQuery = makeArchiveQuery()
    const publishQuery = makePublishUpdate({ id: 'theme-2', status: 'PUBLISHED' })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: 'theme-2' }))
      .mockReturnValueOnce(makeSelectSingle({
        id: 'theme-2',
        org_id: 'org-1',
        type: 'UI_THEME',
        key: 'UI_THEME_ALT',
        status: 'DRAFT',
      }))
      .mockReturnValueOnce(archiveQuery)
      .mockReturnValueOnce(publishQuery)

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'theme-2' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('PUBLISHED')
    expect(archiveQuery.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(archiveQuery.eq).toHaveBeenCalledWith('type', 'UI_THEME')
    expect(archiveQuery.eq).toHaveBeenCalledWith('status', 'PUBLISHED')
    expect(archiveQuery.eq).not.toHaveBeenCalledWith('key', 'UI_THEME_ALT')
    expect(archiveQuery.neq).toHaveBeenCalledWith('id', 'theme-2')
    expect(publishQuery.eq).toHaveBeenCalledWith('status', 'DRAFT')
  })

  it('工具消费策略不能通过通用配置接口发布', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: 'policy-1' }))
      .mockReturnValueOnce(makeSelectSingle({
        id: 'policy-1',
        org_id: 'org-1',
        type: 'AI_CONFIG',
        key: 'POLICY_CONTRACT_REVIEW',
        status: 'DRAFT',
        value: { kind: 'tool_policy', tool: 'contract_review' },
      }))

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'policy-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('保持只读')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('已归档的 AI 平台资产不能被直接重新发布', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: 'provider-archived' }))
      .mockReturnValueOnce(makeSelectSingle({
        id: 'provider-archived',
        org_id: 'org-1',
        type: 'AI_CONFIG',
        key: 'AI_PROVIDER_ARCHIVED',
        status: 'ARCHIVED',
        value: {
          schema_version: 'ai-platform.v1',
          kind: 'provider_connection',
          asset_id: 'provider.archived',
          provider_type: 'openai_compatible',
          runtime_location: 'cloud',
          base_url: 'https://provider.example/v1',
          connection_timeout_ms: 45000,
          enabled: true,
        },
      }))

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'provider-archived' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('已归档配置不可重新发布')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('没有 config:publish 时返回 403 且不读取或发布配置', async () => {
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(false)

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(403)
    expect(accessMocks.userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'publish')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('旧 Provider 只读兼容，不能绕过六对象发布图继续发布', async () => {
    const provider = {
      id: 'provider-1',
      org_id: 'org-1',
      type: 'AI_CONFIG',
      key: 'AI_PROVIDER_PRIMARY',
      status: 'DRAFT',
      value: {
        kind: 'provider',
        level: 1,
        name: 'Primary provider',
        profile: 'primary',
        provider_kind: 'openai_compatible',
        base_url: 'https://provider.example/v1',
        api_key: CANARY_SECRET,
        model: 'provider-model',
        timeout_ms: 45000,
        enabled: true,
      },
    }
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: 'provider-1' }))
      .mockReturnValueOnce(makeSelectSingle(provider))

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toContain('旧 Provider')
    expect(JSON.stringify(body)).not.toContain(CANARY_SECRET)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('模型目录条目只有在引用已发布 Provider 连接时才能发布', async () => {
    const model = {
      id: 'model-1',
      org_id: 'org-1',
      type: 'AI_CONFIG',
      key: 'AI_MODEL_PRIMARY',
      status: 'DRAFT',
      name: 'Primary model',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'model_catalog_entry',
        asset_id: 'model.primary',
        provider_connection_id: 'provider.cloud',
        model_id: 'vendor/primary',
        capabilities: ['text_generation'],
        enabled: true,
      },
    }
    const publishedRowsQuery = {
      data: [],
      error: null,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: model.id }))
      .mockReturnValueOnce(makeSelectSingle(model))
      .mockReturnValueOnce(publishedRowsQuery)

    const blocked = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: model.id }),
    })
    const blockedBody = await blocked.json()

    expect(blocked.status).toBe(400)
    expect(blockedBody.error.details.reasons[0]).toContain('provider.cloud')

    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getFreshDefaultOrgId.mockResolvedValue('org-1')
    const withProviderQuery = {
      data: [{
        id: 'provider-1',
        key: 'AI_PROVIDER_CLOUD',
        name: 'Cloud provider',
        status: 'PUBLISHED',
        value: {
          schema_version: 'ai-platform.v1',
          kind: 'provider_connection',
          asset_id: 'provider.cloud',
          enabled: true,
          provider_type: 'openai_compatible',
          runtime_location: 'cloud',
          auth_mode: 'none',
          base_url: 'https://provider.example/v1',
          connection_timeout_ms: 45000,
        },
      }],
      error: null,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: model.id }))
      .mockReturnValueOnce(makeSelectSingle(model))
      .mockReturnValueOnce(withProviderQuery)
      .mockReturnValueOnce(makePublishUpdate({ ...model, status: 'PUBLISHED' }))

    const published = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: model.id }),
    })
    expect(published.status).toBe(200)
  })

  it('发布 Provider 修订时归档旧行并从旧 configs.value 擦除密钥', async () => {
    const oldSecret = 'sk-old-provider-secret'
    const oldProvider = platformProvider(
      'provider-old',
      'AI_PROVIDER_CLOUD_R1',
      'PUBLISHED',
      oldSecret,
    )
    const candidate = platformProvider(
      'provider-new',
      'AI_PROVIDER_CLOUD_R2',
      'DRAFT',
      CANARY_SECRET,
    )
    const publishedRowsQuery = {
      data: [oldProvider],
      error: null,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }
    const archiveQuery = makeArchiveQuery()
    const publishQuery = makePublishUpdate({ ...candidate, status: 'PUBLISHED' })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: candidate.id }))
      .mockReturnValueOnce(makeSelectSingle(candidate))
      .mockReturnValueOnce(publishedRowsQuery)
      .mockReturnValueOnce(archiveQuery)
      .mockReturnValueOnce(publishQuery)

    const response = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: candidate.id }),
    })

    expect(response.status).toBe(200)
    expect(archiveQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ARCHIVED',
      value: expect.not.objectContaining({ api_key: expect.anything() }),
    }))
    expect(JSON.stringify(archiveQuery.update.mock.calls)).not.toContain(oldSecret)
  })

  it('候选发布发生真实数据库错误时恢复旧 Provider 状态及原密钥', async () => {
    const oldSecret = 'sk-restore-only-on-db-failure'
    const oldProvider = platformProvider(
      'provider-old',
      'AI_PROVIDER_CLOUD_R1',
      'PUBLISHED',
      oldSecret,
    )
    const candidate = platformProvider(
      'provider-new',
      'AI_PROVIDER_CLOUD_R2',
      'DRAFT',
      CANARY_SECRET,
    )
    const publishedRowsQuery = {
      data: [oldProvider],
      error: null,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }
    const archiveQuery = makeArchiveQuery()
    const failedPublishQuery = makePublishUpdate(null, { code: 'XX000', message: 'db failed' })
    const restoreQuery = makeArchiveQuery()
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: candidate.id }))
      .mockReturnValueOnce(makeSelectSingle(candidate))
      .mockReturnValueOnce(publishedRowsQuery)
      .mockReturnValueOnce(archiveQuery)
      .mockReturnValueOnce(failedPublishQuery)
      .mockReturnValueOnce(restoreQuery)

    const response = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: candidate.id }),
    })

    expect(response.status).toBe(500)
    expect(restoreQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PUBLISHED',
      value: expect.objectContaining({ api_key: oldSecret }),
    }))
  })

  it('候选发布 CAS 冲突时不复活已归档 Provider 或其密钥', async () => {
    const oldSecret = 'sk-never-restore-after-cas-conflict'
    const oldProvider = platformProvider(
      'provider-old',
      'AI_PROVIDER_CLOUD_R1',
      'PUBLISHED',
      oldSecret,
    )
    const candidate = platformProvider(
      'provider-new',
      'AI_PROVIDER_CLOUD_R2',
      'DRAFT',
      CANARY_SECRET,
    )
    const publishedRowsQuery = {
      data: [oldProvider],
      error: null,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }
    const archiveQuery = makeArchiveQuery()
    const casConflictQuery = makePublishUpdate(null, { code: 'PGRST116', message: '0 rows' })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: candidate.id }))
      .mockReturnValueOnce(makeSelectSingle(candidate))
      .mockReturnValueOnce(publishedRowsQuery)
      .mockReturnValueOnce(archiveQuery)
      .mockReturnValueOnce(casConflictQuery)

    const response = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: candidate.id }),
    })
    const responseText = await response.text()

    expect(response.status).toBe(400)
    expect(responseText).toContain('状态已变化')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(5)
    expect(responseText).not.toContain(oldSecret)
  })
})

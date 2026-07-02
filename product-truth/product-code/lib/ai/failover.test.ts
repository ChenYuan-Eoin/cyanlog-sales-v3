import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateTextWithFailover, reviewWithFailover } from './failover'
import type { PublishedAIProviderConfig } from '@/lib/configs/runtime'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  createOpenAI: vi.fn(),
  listPublishedAIProviders: vi.fn(),
  probeLmStudioCliModel: vi.fn(),
  generateWithLmStudioCli: vi.fn(),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}))

vi.mock('ai', () => ({
  generateText: mocks.generateText,
}))

vi.mock('@/lib/configs/runtime', () => ({
  listPublishedAIProviders: mocks.listPublishedAIProviders,
}))

vi.mock('@/lib/rules/engine', () => ({
  executeRules: vi.fn(),
}))

vi.mock('@/lib/ai/lm-studio-cli', () => ({
  probeLmStudioCliModel: mocks.probeLmStudioCliModel,
  generateWithLmStudioCli: mocks.generateWithLmStudioCli,
}))

function localProvider(overrides: Partial<PublishedAIProviderConfig> = {}): PublishedAIProviderConfig {
  return {
    config_id: 'local-config',
    key: 'AI_LEVEL_1',
    display_name: 'Level 1 本地模型',
    level: 1,
    name: 'Level 1 本地模型',
    profile: 'AI_LEVEL_1',
    provider_kind: 'openai_compatible',
    base_url: 'http://127.0.0.1:1234/v1',
    api_key: 'lmstudio-token',
    model: 'gpt-oss-20b',
    timeout_ms: 30_000,
    enabled: true,
    routing: { max_pages: 15, strategy: 'full' },
    ...overrides,
  }
}

function fetchResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
  } as Response
}

describe('reviewWithFailover local provider transport order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse(200)))
    mocks.createOpenAI.mockReturnValue({
      chat: (model: string) => ({ model }),
    })
    mocks.listPublishedAIProviders.mockResolvedValue([localProvider()])
    mocks.probeLmStudioCliModel.mockResolvedValue('ready')
    mocks.generateWithLmStudioCli.mockResolvedValue('{"risks":[],"summary":"cli"}')
  })

  it('uses OpenAI-compatible HTTP before LM Studio CLI when the configured provider is healthy', async () => {
    mocks.generateText.mockResolvedValue({ text: '{"risks":[],"summary":"http"}' })

    const result = await reviewWithFailover('第一条 合同金额。', { orgId: 'org-1', preferredProvider: 'AI_LEVEL_1' })

    expect(result.transport).toBe('openai_compatible_http')
    expect(mocks.generateText).toHaveBeenCalledTimes(1)
    expect(mocks.generateWithLmStudioCli).not.toHaveBeenCalled()
    expect(result.attemptErrors).toEqual([])
  })

  it('does not pass placeholder or missing local tokens into the OpenAI-compatible client', async () => {
    mocks.generateText.mockResolvedValue({ text: '{"risks":[],"summary":"http"}' })

    for (const apiKey of [undefined, 'not-needed']) {
      vi.clearAllMocks()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse(200)))
      mocks.createOpenAI.mockReturnValue({
        chat: (model: string) => ({ model }),
      })
      mocks.listPublishedAIProviders.mockResolvedValue([localProvider({ api_key: apiKey })])

      const result = await reviewWithFailover('第一条 合同金额。', { orgId: 'org-1', preferredProvider: 'AI_LEVEL_1' })

      expect(result.transport).toBe('lm_studio_cli')
      expect(result.attemptErrors).toContain('AI_LEVEL_1: local_http_failed: LM Studio HTTP Token 未配置；已尝试本机 CLI 通道')
      expect(mocks.createOpenAI).not.toHaveBeenCalled()
    }
  })

  it('falls back to LM Studio CLI only after local HTTP fails and records the HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse(401)))
    mocks.generateText.mockRejectedValue(new Error('invalid_api_key'))

    const result = await reviewWithFailover('第一条 合同金额。', { orgId: 'org-1', preferredProvider: 'AI_LEVEL_1' })

    expect(result.transport).toBe('lm_studio_cli')
    expect(mocks.generateText).toHaveBeenCalledTimes(1)
    expect(mocks.generateWithLmStudioCli).toHaveBeenCalledTimes(1)
    expect(result.attemptErrors).toContain('AI_LEVEL_1: local_http_failed: invalid_api_key')
  })

  it('records text-generation transport when local provider uses OpenAI-compatible HTTP', async () => {
    mocks.generateText.mockResolvedValue({ text: 'HTTP generated contract content' })

    const result = await generateTextWithFailover('起草合同', {
      orgId: 'org-1',
      preferredProvider: 'AI_LEVEL_1',
    })

    expect(result.transport).toBe('openai_compatible_http')
    expect(result.attemptErrors).toEqual([])
  })

  it('omits temperature for reasoning cloud models that do not support it', async () => {
    mocks.listPublishedAIProviders.mockResolvedValue([{
      ...localProvider({
        key: 'AI_LEVEL_2',
        profile: 'sales_cloud_backup',
        display_name: '云端长文本审核模型',
        name: '云端长文本审核模型',
        base_url: 'https://cloud.yiyongai.cn/v1',
        model: 'gpt-5.5',
        level: 2,
        routing: { max_pages: 120, strategy: 'chunked' },
      }),
    }])
    mocks.generateText.mockResolvedValue({ text: '{"risks":[],"summary":"cloud"}' })

    await reviewWithFailover('第一条 合同金额。', { orgId: 'org-1', preferredProvider: 'sales_cloud_backup' })

    expect(mocks.generateText).toHaveBeenCalledTimes(1)
    expect(mocks.generateText.mock.calls[0][0]).not.toHaveProperty('temperature')
  })

  it('submits long cloud contract review beyond the old leading 8000 character slice', async () => {
    mocks.listPublishedAIProviders.mockResolvedValue([{
      ...localProvider({
        key: 'AI_LEVEL_2',
        profile: 'sales_cloud_backup',
        display_name: '云端长文本审核模型',
        name: '云端长文本审核模型',
        base_url: 'https://cloud.yiyongai.cn/v1',
        api_key: 'sk-cloud',
        model: 'gpt-5.5',
        level: 2,
        routing: { max_pages: 120, strategy: 'chunked' },
      }),
    }])
    mocks.generateText.mockResolvedValue({ text: '{"risks":[],"summary":"cloud"}' })

    const tailClause = '尾部条款：争议解决由境外仲裁机构处理，需进入法务复核。'
    const longContract = `${'付款和验收条款。'.repeat(1200)}\n${tailClause}`
    const result = await reviewWithFailover(longContract, {
      orgId: 'org-1',
      preferredProvider: 'sales_cloud_backup',
    })
    const userMessage = mocks.generateText.mock.calls[0][0].messages[0].content

    expect(userMessage).toContain(tailClause)
    expect(result.inputStats).toMatchObject({
      character_coverage_ratio: 1,
      coverage_limited: false,
      selection_strategy: 'full_text',
    })
  })

  it('normalizes OpenAI-compatible root base URLs to /v1 before model calls', async () => {
    mocks.listPublishedAIProviders.mockResolvedValue([{
      ...localProvider({
        key: 'AI_LEVEL_2',
        profile: 'sales_cloud_backup',
        display_name: '云端长文本审核模型',
        name: '云端长文本审核模型',
        base_url: 'https://cloud.yiyongai.cn',
        api_key: 'sk-cloud',
        model: 'gpt-5.5',
        level: 2,
        routing: { max_pages: 120, strategy: 'chunked' },
      }),
    }])
    mocks.generateText.mockResolvedValue({ text: 'Cloud generated tender analysis' })

    await generateTextWithFailover('标书长文本', {
      orgId: 'org-1',
      preferredProvider: 'sales_cloud_backup',
    })

    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      baseURL: 'https://cloud.yiyongai.cn/v1',
      apiKey: 'sk-cloud',
    })
  })

  it('records text-generation CLI transport and local HTTP failure when LM Studio token is missing', async () => {
    mocks.listPublishedAIProviders.mockResolvedValue([localProvider({ api_key: undefined })])
    mocks.generateWithLmStudioCli.mockResolvedValue('CLI generated contract content')

    const result = await generateTextWithFailover('起草合同', {
      orgId: 'org-1',
      preferredProvider: 'AI_LEVEL_1',
    })

    expect(result.transport).toBe('lm_studio_cli')
    expect(result.attemptErrors).toContain('AI_LEVEL_1: local_http_failed: LM Studio HTTP Token 未配置；已尝试本机 CLI 通道')
    expect(mocks.createOpenAI).not.toHaveBeenCalled()
  })
})

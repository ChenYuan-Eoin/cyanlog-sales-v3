/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeAIUsePoint: vi.fn(),
  getAccessibleContract: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))
vi.mock('@/lib/scoped-access', () => ({
  getAccessibleContract: mocks.getAccessibleContract,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))
vi.mock('@/lib/ai/runtime-executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/runtime-executor')>()
  return { ...actual, executeAIUsePoint: mocks.executeAIUsePoint }
})

import { AIExecutionError } from '@/lib/ai/runtime-executor'
import { POST } from './route'

function request(body: unknown): any {
  return { json: async () => body, headers: new Headers(), method: 'POST' }
}

function params() {
  return { params: Promise.resolve({ id: 'contract-1' }) }
}

function installChatInsert(error: unknown = null) {
  const select = vi.fn(async () => ({
    data: error ? null : [
      { id: 'message-user', role: 'user', content: '付款风险是什么？' },
      { id: 'message-assistant', role: 'assistant', content: '根据第十条，付款周期过长。' },
    ],
    error,
  }))
  const insert = vi.fn(() => ({ select }))
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'contract_ai_chats') throw new Error(`unexpected table ${table}`)
    return { insert }
  })
  return { insert, select }
}

describe('POST /api/contracts/[id]/ai-chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.VERCEL
    delete process.env.VERCEL_URL
    delete process.env.VERCEL_REGION
    mocks.getAccessibleContract.mockResolvedValue({
      contract: { id: 'contract-1', filename: 'contract.docx', parsed_text: '第十条 付款周期为 120 日。' },
    })
    mocks.executeAIUsePoint.mockResolvedValue({
      value: '根据第十条，付款周期为 120 日，建议改为验收后 30 日。',
      provider: 'provider-cloud',
      model: 'model-cloud',
      degraded: false,
      planSnapshotHash: 'hash-1',
      invocationIds: ['invocation-1'],
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, evidence: 'provider' },
    })
  })

  it('rejects invalid input before contract, model or database access', async () => {
    const res = await POST(request({ content: '' }), params())

    expect(res.status).toBe(400)
    expect(mocks.getAccessibleContract).not.toHaveBeenCalled()
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an inaccessible contract before model execution', async () => {
    mocks.getAccessibleContract.mockResolvedValueOnce({ contract: null })
    const res = await POST(request({ content: '付款风险是什么？' }), params())

    expect(res.status).toBe(404)
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('executes only contract.review.chat and atomically stores the real reply with evidence', async () => {
    const db = installChatInsert()
    const res = await POST(request({
      content: '付款风险是什么？',
      context: { selected_risk_id: 'R001' },
    }), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.executeAIUsePoint).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      usePointId: 'contract.review.chat',
      executionEnvironment: 'local',
      contractId: 'contract-1',
      validateOutput: expect.any(Function),
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('第十条') }),
      ]),
    }))
    expect(db.insert).toHaveBeenCalledWith([
      expect.objectContaining({ role: 'user', content: '付款风险是什么？' }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('验收后 30 日'),
        context: expect.objectContaining({
          ai_runtime: expect.objectContaining({
            provider: 'provider-cloud',
            plan_snapshot_hash: 'hash-1',
            invocation_ids: ['invocation-1'],
          }),
        }),
      }),
    ])
    expect(body.data.runtime).toMatchObject({ model: 'model-cloud', invocation_ids: ['invocation-1'] })
  })

  it('returns an explicit published failure action and never saves a fabricated reply', async () => {
    mocks.executeAIUsePoint.mockRejectedValueOnce(new AIExecutionError(
      'ALL_CANDIDATES_FAILED', 'all failed', 'manual_review', [], 'snapshot-1',
    ))
    const res = await POST(request({ content: '付款风险是什么？' }), params())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error.code).toBe('S003')
    expect(body.error.details.code).toBe('AI_MANUAL_REVIEW_REQUIRED')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns DB_ERROR when the paired message insert fails', async () => {
    installChatInsert({ message: 'write failed' })
    const res = await POST(request({ content: '付款风险是什么？' }), params())

    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('S001')
  })

  it('has no legacy ModelPolicy, failover, CLI, environment credential or rule-engine bypass', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/contracts/[id]/ai-chat/route.ts'), 'utf8')

    expect(source).toContain("usePointId: 'contract.review.chat'")
    expect(source).not.toContain('@/lib/ai/failover')
    expect(source).not.toMatch(/ModelPolicy|reviewWithFailover|generateTextWithFailover/)
    expect(source).not.toMatch(/AI_GATEWAY|LOCAL_MODEL|OPENAI_API_KEY|lm-studio-cli|rule-engine/)
  })
})

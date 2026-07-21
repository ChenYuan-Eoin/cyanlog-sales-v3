/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(() => true),
  listAccessibleUserIds: vi.fn(async () => ({ assignments: [], userIds: ['user-1'] })),
  listFreshAccessibleUserIds: vi.fn(async () => ({ assignments: [], userIds: ['user-1'] })),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { canAccessContractAction, listAccessibleUserIds } from '@/lib/scoped-access'
import { GET } from './route'

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '22222222-2222-4222-8222-222222222222'

function installGetSupabaseMock() {
  const comparison = {
    id: 'comparison-1',
    contract_id: CONTRACT_ID,
    baseline_type: 'previous_version',
    baseline_doc_id: CONTRACT_ID,
    compare_doc_id: VERSION_ID,
    status: 'completed',
    comparison_diffs: [],
  }

  const comparisonQuery: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({
      data: [comparison],
      error: null,
    }).then(resolve),
  }

  const contractQueue = [
    {
      id: CONTRACT_ID,
      filename: 'baseline.docx',
      status: 'COMPLETED',
      contract_no: 'CT-001',
      quote_id: null,
      party_b_name: null,
      parsed_text: '第一条 基准文本',
      storage_path: 'contracts/baseline-current.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      created_by: 'user-1',
      org_id: 'org-1',
    },
    null,
  ]
  const contractQuery: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: contractQueue.shift() ?? null,
      error: null,
    })),
  }

  const versionQuery: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn(async () => ({
      data: [{
        id: VERSION_ID,
        contract_id: CONTRACT_ID,
        version_number: 2,
        source: 'customer_return',
        storage_path: 'contracts/customer-return-v2.docx',
        file_size: 1024,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        parent_version_id: null,
        change_summary: null,
        review_id: null,
        created_at: '2026-07-15T09:00:00.000Z',
      }],
      error: null,
    })),
  }

  ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
    if (table === 'contract_comparisons') return comparisonQuery
    if (table === 'contracts') return contractQuery
    if (table === 'contract_versions') return versionQuery
    throw new Error(`unexpected table ${table}`)
  })
}

describe('GET /api/contracts/[id]/compare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(canAccessContractAction).mockReturnValue(true)
  })

  it('没有 VIEW 权限时在读取 comparison 前拒绝请求', async () => {
    vi.mocked(listAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
    })
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const response = await GET({
      url: `https://sales.example.test/api/contracts/${CONTRACT_ID}/compare`,
    } as any, {
      params: Promise.resolve({ id: CONTRACT_ID }),
    })

    expect(response.status).toBe(403)
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'view')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('returns an explicit review gate when legacy comparisons lack immutable source snapshots', async () => {
    installGetSupabaseMock()

    const response = await GET({
      url: `https://sales.example.test/api/contracts/${CONTRACT_ID}/compare?comparison_id=comparison-1`,
    } as any, {
      params: Promise.resolve({ id: CONTRACT_ID }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.document_pair.compare).toMatchObject({
      id: VERSION_ID,
      storage_path: 'contracts/customer-return-v2.docx',
    })
    expect(body.data.source_verification).toEqual({
      status: 'unverified',
      can_start_review: false,
      reasons: [
        'baseline_snapshot_missing',
        'compare_snapshot_missing',
      ],
    })
  })
})

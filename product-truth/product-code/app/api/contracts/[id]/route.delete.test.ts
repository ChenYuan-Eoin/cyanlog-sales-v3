// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))
vi.mock('@/lib/error-log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/observability', () => ({
  getRequestId: vi.fn().mockReturnValue('request-1'),
  logRouteDone: vi.fn(),
  logRouteFailure: vi.fn(),
  logRouteStart: vi.fn(),
}))
vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
  listAccessibleUserIds: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE } from './route'

const contractId = '11111111-1111-4111-8111-111111111111'
const storagePath = `${contractId}/source.docx`
const context = { params: Promise.resolve({ id: contractId }) }

function contractReadQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: contractId, storage_path: storagePath, created_by: 'user-1' },
      error: null,
    }),
  }
}

function comparisonSourceQuery(result: { data: { id: string } | null; error: Error | null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function contractDeleteQuery() {
  const query: any = {
    error: null,
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  }
  return query
}

function arrange(referenceResult: { data: { id: string } | null; error: Error | null }) {
  const contractRead = contractReadQuery()
  const referenceRead = comparisonSourceQuery(referenceResult)
  const contractDelete = contractDeleteQuery()
  const storageRemove = vi.fn().mockResolvedValue({ data: null, error: null })
  const storageBucket = { remove: storageRemove }
  let contractQueryCount = 0

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === 'contract_comparison_sources') return referenceRead as never
    if (table === 'contracts') {
      contractQueryCount += 1
      return (contractQueryCount === 1 ? contractRead : contractDelete) as never
    }
    throw new Error(`unexpected table: ${table}`)
  })
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue(storageBucket as never)

  return { contractDelete, referenceRead, storageRemove }
}

function request() {
  return new NextRequest(`http://localhost/api/contracts/${contractId}`, { method: 'DELETE' })
}

describe('DELETE /api/contracts/[id] G6 source-reference guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it('returns 409 and never deletes Storage or the contract when a frozen source references it', async () => {
    const { contractDelete, referenceRead, storageRemove } = arrange({
      data: { id: 'comparison-source-1' },
      error: null,
    })

    const response = await DELETE(request(), context)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: '合同已被历史比对冻结引用，不能删除',
      code: 'CONTRACT_COMPARISON_SOURCE_REFERENCED',
    })
    expect(referenceRead.eq).toHaveBeenCalledWith('contract_id', contractId)
    expect(storageRemove).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(contractDelete.delete).not.toHaveBeenCalled()
  })

  it('fails closed and never deletes bytes when the reference query fails', async () => {
    const { contractDelete, storageRemove } = arrange({
      data: null,
      error: new Error('reference lookup unavailable'),
    })

    const response = await DELETE(request(), context)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: '合同历史比对引用检查失败',
      code: 'DB_ERROR',
    })
    expect(storageRemove).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(contractDelete.delete).not.toHaveBeenCalled()
  })

  it('checks references before deleting Storage when the contract is unreferenced', async () => {
    const { contractDelete, referenceRead, storageRemove } = arrange({ data: null, error: null })

    const response = await DELETE(request(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, message: '合同已删除' })
    expect(referenceRead.maybeSingle).toHaveBeenCalledOnce()
    expect(storageRemove).toHaveBeenCalledWith([storagePath])
    expect(contractDelete.delete).toHaveBeenCalledOnce()
    expect(referenceRead.maybeSingle.mock.invocationCallOrder[0])
      .toBeLessThan(contractDelete.delete.mock.invocationCallOrder[0])
    expect(contractDelete.delete.mock.invocationCallOrder[0])
      .toBeLessThan(storageRemove.mock.invocationCallOrder[0])
  })

  it('returns an explicit partial-completion state when Storage resolves with an error', async () => {
    const { contractDelete, storageRemove } = arrange({ data: null, error: null })
    storageRemove.mockResolvedValueOnce({ data: null, error: new Error('storage unavailable') })

    const response = await DELETE(request(), context)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      success: true,
      deleted: true,
      storage_cleanup: 'pending',
      code: 'STORAGE_CLEANUP_PENDING',
      message: '合同记录已删除，源文件清理待重试',
    })
    expect(contractDelete.delete).toHaveBeenCalledOnce()
    expect(storageRemove).toHaveBeenCalledWith([storagePath])
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 202,
      context: expect.objectContaining({
        databaseDeleted: true,
        storageCleanup: 'pending',
      }),
    }))
  })

  it('returns the same truthful partial state when Storage removal throws', async () => {
    const { contractDelete, storageRemove } = arrange({ data: null, error: null })
    storageRemove.mockRejectedValueOnce(new Error('network interrupted'))

    const response = await DELETE(request(), context)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      success: true,
      deleted: true,
      storage_cleanup: 'pending',
      code: 'STORAGE_CLEANUP_PENDING',
    })
    expect(contractDelete.delete).toHaveBeenCalledOnce()
    expect(logError).toHaveBeenCalledOnce()
  })
})

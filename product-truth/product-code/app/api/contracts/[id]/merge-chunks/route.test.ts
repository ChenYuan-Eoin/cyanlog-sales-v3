/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
  listAccessibleUserIds: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  },
}))

vi.mock('@/lib/error-log', () => ({
  logError: vi.fn(),
}))

vi.mock('@/lib/contracts/text-extraction', () => ({
  extractContractText: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { extractContractText } from '@/lib/contracts/text-extraction'
import { POST } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: Record<string, unknown>): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/contracts/[id]/merge-chunks validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效 JSON 返回格式错误且不进入组织、数据库和存储链路', async () => {
    const res = await POST(makeMalformedRequest(), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V002')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(listAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('缺少必要参数时不进入组织、数据库和存储链路', async () => {
    const res = await POST(makeJsonRequest({}), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V003')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(listAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('合并成功后写入合同版本记录并返回版本信息', async () => {
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(listAccessibleUserIds as any).mockResolvedValue({ userIds: ['user-1'] })
    ;(extractContractText as any).mockReturnValue('contract parsed text')

    const contractSelectQuery: any = {
      select: vi.fn(() => contractSelectQuery),
      eq: vi.fn(() => contractSelectQuery),
      in: vi.fn(() => contractSelectQuery),
      single: vi.fn().mockResolvedValue({
        data: { id: 'contract-1', created_by: 'user-1', org_id: 'org-1', status: 'DRAFT' },
        error: null,
      }),
    }

    const contractUpdateQuery: any = {
      update: vi.fn(() => contractUpdateQuery),
      eq: vi.fn(() => contractUpdateQuery),
    }

    const versionSelectQuery: any = {
      select: vi.fn(() => versionSelectQuery),
      eq: vi.fn(() => versionSelectQuery),
      order: vi.fn(() => versionSelectQuery),
      limit: vi.fn(() => versionSelectQuery),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'version-1', version_number: 2 },
        error: null,
      }),
    }

    const versionInsertQuery: any = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    }

    const contractsFromQueue = [contractSelectQuery, contractUpdateQuery]
    const versionsFromQueue = [versionSelectQuery, versionInsertQuery]
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'contracts') return contractsFromQueue.shift()
      if (table === 'contract_versions') return versionsFromQueue.shift()
      throw new Error(`unexpected table ${table}`)
    })

    const tempStorage = {
      download: vi.fn().mockResolvedValue({
        data: new Blob(['contract body']),
        error: null,
      }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    }
    const finalStorage = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://storage/contract.pdf' } })),
    }
    ;(supabaseAdmin.storage.from as any).mockImplementation((bucket: string) => {
      if (bucket === 'contract-chunks') return tempStorage
      if (bucket === 'contracts') return finalStorage
      throw new Error(`unexpected bucket ${bucket}`)
    })

    const res = await POST(makeJsonRequest({
      fileName: 'contract.pdf',
      fileType: 'application/pdf',
      totalSize: 13,
      chunkCount: 1,
    }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('PENDING')
    expect(body.data.versionNumber).toBe(3)
    expect(body.data.versionSource).toBe('manual_revision')
    expect(contractUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'contract.pdf',
      parsed_text: 'contract parsed text',
      status: 'PENDING',
    }))
    expect(versionInsertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      contract_id: 'contract-1',
      version_number: 3,
      source: 'manual_revision',
      parent_version_id: 'version-1',
      storage_path: expect.stringContaining('contract-1/'),
      uploaded_by: 'user-1',
    }))
  })
})

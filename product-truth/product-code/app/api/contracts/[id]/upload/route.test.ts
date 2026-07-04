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

function makeMalformedFormRequest(): any {
  return {
    formData: async () => {
      throw new TypeError('invalid multipart')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data' }),
  }
}

function makeFormRequest(values: Record<string, FormDataEntryValue | null>): any {
  return {
    formData: async () => ({
      get: (name: string) => values[name] ?? null,
    }),
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data' }),
  }
}

function makeFile(name: string, type = 'application/pdf'): File {
  return new File(['contract text'], name, { type })
}

describe('POST /api/contracts/[id]/upload validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效表单数据返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeMalformedFormRequest(), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(listAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('未提供文件返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeFormRequest({}), {
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

  it('不支持的文件类型返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeFormRequest({ file: makeFile('contract.txt', 'text/plain') }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(listAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('上传成功后必须写入 PENDING 状态和合同版本', async () => {
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
    const versionSelectQuery: any = {
      select: vi.fn(() => versionSelectQuery),
      eq: vi.fn(() => versionSelectQuery),
      order: vi.fn(() => versionSelectQuery),
      limit: vi.fn(() => versionSelectQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const contractUpdateQuery: any = {
      update: vi.fn(() => contractUpdateQuery),
      eq: vi.fn(() => contractUpdateQuery),
      error: null,
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
    const storage = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://storage/contract.docx' } })),
      remove: vi.fn().mockResolvedValue({ error: null }),
    }
    ;(supabaseAdmin.storage.from as any).mockReturnValue(storage)

    const res = await POST(makeFormRequest({
      file: makeFile('contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('PENDING')
    expect(contractUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'contract.docx',
      parsed_text: 'contract parsed text',
      status: 'PENDING',
    }))
    expect(versionInsertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      contract_id: 'contract-1',
      version_number: 1,
      source: 'original',
      uploaded_by: 'user-1',
    }))
  })

  it('客户回传版只写入版本流，不覆盖合同主源文件', async () => {
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(listAccessibleUserIds as any).mockResolvedValue({ userIds: ['user-1'] })
    ;(extractContractText as any).mockReturnValue('customer return parsed text')

    const contractSelectQuery: any = {
      select: vi.fn(() => contractSelectQuery),
      eq: vi.fn(() => contractSelectQuery),
      in: vi.fn(() => contractSelectQuery),
      single: vi.fn().mockResolvedValue({
        data: { id: 'contract-1', created_by: 'user-1', org_id: 'org-1', status: 'COMPLETED' },
        error: null,
      }),
    }
    const versionSelectQuery: any = {
      select: vi.fn(() => versionSelectQuery),
      eq: vi.fn(() => versionSelectQuery),
      order: vi.fn(() => versionSelectQuery),
      limit: vi.fn(() => versionSelectQuery),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'version-1', version_number: 1 },
        error: null,
      }),
    }
    const versionInsertQuery: any = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    }
    const contractsFromQueue = [contractSelectQuery]
    const versionsFromQueue = [versionSelectQuery, versionInsertQuery]
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'contracts') return contractsFromQueue.shift()
      if (table === 'contract_versions') return versionsFromQueue.shift()
      throw new Error(`unexpected table ${table}`)
    })
    const storage = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://storage/customer-return.docx' } })),
      remove: vi.fn().mockResolvedValue({ error: null }),
    }
    ;(supabaseAdmin.storage.from as any).mockReturnValue(storage)

    const res = await POST(makeFormRequest({
      file: makeFile('customer-return.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      purpose: 'customer-return',
    }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('COMPLETED')
    expect(body.data.contractUpdated).toBe(false)
    expect(body.data.versionSource).toBe('manual_revision')
    expect((supabaseAdmin.from as any).mock.calls.filter(([table]: string[]) => table === 'contracts')).toHaveLength(1)
    expect(versionInsertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      contract_id: 'contract-1',
      version_number: 2,
      source: 'manual_revision',
      parent_version_id: 'version-1',
      change_summary: '客户回传版：customer-return.docx',
      uploaded_by: 'user-1',
    }))
  })

  it('合同记录更新失败时不得返回上传成功', async () => {
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
    const versionSelectQuery: any = {
      select: vi.fn(() => versionSelectQuery),
      eq: vi.fn(() => versionSelectQuery),
      order: vi.fn(() => versionSelectQuery),
      limit: vi.fn(() => versionSelectQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const contractUpdateQuery: any = {
      update: vi.fn(() => contractUpdateQuery),
      eq: vi.fn(() => contractUpdateQuery),
      error: { message: 'update failed' },
    }
    const contractsFromQueue = [contractSelectQuery, contractUpdateQuery]
    const versionsFromQueue = [versionSelectQuery]
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'contracts') return contractsFromQueue.shift()
      if (table === 'contract_versions') return versionsFromQueue.shift()
      throw new Error(`unexpected table ${table}`)
    })
    const storage = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://storage/contract.docx' } })),
      remove: vi.fn().mockResolvedValue({ error: null }),
    }
    ;(supabaseAdmin.storage.from as any).mockReturnValue(storage)

    const res = await POST(makeFormRequest({
      file: makeFile('contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.message).toBe('合同文件记录更新失败')
    expect(storage.remove).toHaveBeenCalledWith([expect.stringContaining('contract-1/')])
  })
})

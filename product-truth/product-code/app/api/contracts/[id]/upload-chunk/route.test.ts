/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(),
  listFreshAccessibleUserIds: vi.fn(),
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

import { requireAuth } from '@/lib/auth'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { uploadCancellationPath } from '@/lib/documents/chunk-upload-protocol'
import { DELETE, POST } from './route'

const CONTRACT_ID = 'd36fe9ff-b22d-4df1-83ae-843b65a1f54c'
const EXPECTED_SHA256 = 'a'.repeat(64)
const STABLE_UPLOAD_ID = 'abc33b2f-3102-8912-9190-cba3023637d4'
const context = { params: Promise.resolve({ id: CONTRACT_ID }) }

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

function makeValidChunkValues(overrides: Record<string, FormDataEntryValue | null> = {}) {
  return {
    chunk: new File(['chunk'], 'chunk.part'),
    index: '0',
    start: '0',
    end: '5',
    totalSize: '5',
    fileName: 'contract.pdf',
    fileType: 'application/pdf',
    uploadId: STABLE_UPLOAD_ID,
    expectedSha256: EXPECTED_SHA256,
    ...overrides,
  }
}

function arrangeContract(data: unknown = { id: CONTRACT_ID, status: 'DRAFT' }) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(query)
  const storage = {
    upload: vi.fn().mockResolvedValue({ error: null }),
  }
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue(storage as never)
  return { query, storage }
}

describe('POST /api/contracts/[id]/upload-chunk validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    vi.mocked(listFreshAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
    })
    vi.mocked(canAccessContractAction).mockReturnValue(true)
  })

  it('无效表单数据返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeMalformedFormRequest(), context)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(listFreshAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('无效分块参数返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeFormRequest(makeValidChunkValues({ index: 'bad' })), context)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(listFreshAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('不支持的文件类型返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeFormRequest(makeValidChunkValues({ fileName: 'contract.txt' })), context)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(listFreshAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('拒绝与合同及最终 SHA 不匹配的任意合法 UUID', async () => {
    const res = await POST(makeFormRequest(makeValidChunkValues({
      uploadId: '019f6d1a-3b21-7cc0-8f4e-123456789abc',
    })), context)

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('合同及文件摘要不一致')
    expect(listFreshAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('允许 legacy DOC 分块进入私有临时存储以保留原件', async () => {
    const { query, storage } = arrangeContract()
    const res = await POST(makeFormRequest(makeValidChunkValues({
      fileName: 'legacy.doc',
      fileType: 'application/msword',
    })), context)

    expect(res.status).toBe(200)
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(storage.upload).toHaveBeenCalledWith(
      `${CONTRACT_ID}/${STABLE_UPLOAD_ID}/0.part`,
      expect.any(Blob),
      expect.objectContaining({ contentType: 'application/msword' }),
    )
  })

  it('组织边界不匹配时不读取或写入任何 Storage 对象', async () => {
    const { query } = arrangeContract(null)
    const res = await POST(makeFormRequest(makeValidChunkValues()), context)

    expect(res.status).toBe(404)
    expect(query.eq).toHaveBeenCalledWith('id', CONTRACT_ID)
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(query.in).toHaveBeenCalledWith('created_by', ['user-1'])
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('没有创建或上传能力时不查询合同也不写临时分块', async () => {
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const res = await POST(makeFormRequest(makeValidChunkValues()), context)

    expect(res.status).toBe(403)
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'create_or_upload')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/contracts/[id]/upload-chunk cancellation fence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    vi.mocked(listFreshAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
    })
    vi.mocked(canAccessContractAction).mockReturnValue(true)
  })

  it('removes an uncommitted cancellation marker when the contract CAS loses', async () => {
    const contractQuery: any = {
      select: vi.fn(() => contractQuery),
      eq: vi.fn(() => contractQuery),
      in: vi.fn(() => contractQuery),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: CONTRACT_ID,
          updated_at: '2026-07-21T10:00:00.000Z',
          storage_path: null,
        },
        error: null,
      }),
    }
    const updateQuery: any = {
      update: vi.fn(() => updateQuery),
      eq: vi.fn(() => updateQuery),
      select: vi.fn(() => updateQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(updateQuery)

    const storage = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    }
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue(storage as never)

    const response = await DELETE({
      json: async () => ({
        uploadId: STABLE_UPLOAD_ID,
        expectedSha256: EXPECTED_SHA256,
        chunkCount: 1,
      }),
    } as any, context)

    expect(response.status).toBe(409)
    expect(storage.remove).toHaveBeenCalledWith([
      uploadCancellationPath(CONTRACT_ID, STABLE_UPLOAD_ID),
    ])
  })
})

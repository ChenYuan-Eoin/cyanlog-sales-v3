import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_request, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/documents/source-render-server', () => ({
  ensureContractPageMap: vi.fn().mockResolvedValue({
    source_hash: 'a'.repeat(64),
    source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    page_count: 2,
    locator: 'rendered',
    pages: [],
  }),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET, POST } from './route'
import { supabaseAdmin } from '@/lib/supabase'

function query(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function listQuery(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('POST source annotation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists a normalized PDF point with immutable source identity', async () => {
    const saved = {
      id: 'annotation-1',
      comment: '请人工核对盖章位置。',
      status: 'open',
      source_anchor: { kind: 'point', page: 1, point: { x: 0.25, y: 0.75 } },
      source_storage_path: 'contract-1/source.pdf',
      source_hash: 'a'.repeat(64),
      source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: saved, error: null }) }),
    })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'source.pdf', mime_type: 'application/pdf', storage_path: 'contract-1/source.pdf', parsed_text: '' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'source.pdf', mime_type: 'application/pdf', storage_path: 'contract-1/source.pdf', parsed_text: '' }, error: null }) as never)
      .mockReturnValueOnce({ insert } as never)

    const request = new NextRequest('http://localhost/api/contracts/contract-1/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '11111111-1111-4111-8111-111111111111',
        comment: saved.comment,
        anchor: saved.source_anchor,
        source_identity: {
          storage_path: 'contract-1/source.pdf',
          source_hash: 'a'.repeat(64),
          source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data.source_hash).toBe('a'.repeat(64))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      contract_id: 'contract-1',
      source_anchor: saved.source_anchor,
      source_storage_path: 'contract-1/source.pdf',
    }))
  })

  it('rejects point annotations for Word sources', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(query({
      data: { id: 'contract-1', filename: 'source.docx', storage_path: 'contract-1/source.docx', parsed_text: '' },
      error: null,
    }) as never)
    const request = new NextRequest('http://localhost/api/contracts/contract-1/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '22222222-2222-4222-8222-222222222222',
        comment: '批注',
        anchor: { kind: 'point', page: 1, point: { x: 0.5, y: 0.5 } },
        source_identity: { storage_path: 'contract-1/source.docx', source_hash: 'a'.repeat(64), source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'contract-1' }) })
    expect(response.status).toBe(422)
  })

  it('persists a normalized PDF region', async () => {
    const anchor = { kind: 'region', page: 2, region: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 } }
    const saved = {
      id: 'annotation-2', comment: '请核对框选区域。', status: 'open', source_anchor: anchor,
      source_storage_path: 'contract-1/source.pdf', source_hash: 'a'.repeat(64),
      source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: saved, error: null }) }),
    })
    const contract = { id: 'contract-1', filename: 'source.pdf', mime_type: 'application/pdf', storage_path: 'contract-1/source.pdf', parsed_text: '' }
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: contract, error: null }) as never)
      .mockReturnValueOnce(query({ data: contract, error: null }) as never)
      .mockReturnValueOnce({ insert } as never)

    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '33333333-3333-4333-8333-333333333333',
        comment: saved.comment,
        anchor,
        source_identity: { storage_path: 'contract-1/source.pdf', source_hash: 'a'.repeat(64), source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ source_anchor: anchor }))
  })

  it('stops when the contract source changes while saving', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'source.pdf', mime_type: 'application/pdf', storage_path: 'contract-1/v1.pdf', parsed_text: '' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'source.pdf', mime_type: 'application/pdf', storage_path: 'contract-1/v2.pdf', parsed_text: '' }, error: null }) as never)

    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '44444444-4444-4444-8444-444444444444',
        comment: '批注',
        anchor: { kind: 'point', page: 1, point: { x: 0.5, y: 0.5 } },
        source_identity: { storage_path: 'contract-1/v1.pdf', source_hash: 'a'.repeat(64), source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.message).toContain('源文件已变化')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('returns the existing annotation when a repeated request id follows response loss', async () => {
    const contract = { id: 'contract-1', filename: 'source.pdf', mime_type: 'application/pdf', storage_path: 'contract-1/source.pdf', parsed_text: '' }
    const existing = {
      id: 'annotation-existing', comment: '只保存一次', status: 'open',
      source_anchor: { kind: 'point', page: 1, point: { x: 0.3, y: 0.4 } },
      source_storage_path: contract.storage_path, source_hash: 'a'.repeat(64),
      source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } }) }),
    })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: contract, error: null }) as never)
      .mockReturnValueOnce(query({ data: contract, error: null }) as never)
      .mockReturnValueOnce({ insert } as never)
      .mockReturnValueOnce(query({ data: existing, error: null }) as never)

    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '55555555-5555-4555-8555-555555555555',
        comment: existing.comment,
        anchor: existing.source_anchor,
        source_identity: {
          storage_path: contract.storage_path,
          source_hash: 'a'.repeat(64),
          source_text_hash: existing.source_text_hash,
        },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.id).toBe(existing.id)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('requires source identity before reading the contract', async () => {
    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '66666666-6666-4666-8666-666666666666',
        comment: '缺少身份',
        anchor: { kind: 'point', page: 1, point: { x: 0.5, y: 0.5 } },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })

    expect(response.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('loads only annotations bound to the verified current source hash', async () => {
    const contract = { id: 'contract-1', filename: 'source.pdf', mime_type: 'application/pdf', storage_path: 'contract-1/source.pdf', parsed_text: '' }
    const annotations = [{ id: 'annotation-1', comment: '已保存', source_hash: 'a'.repeat(64) }]
    const annotationQuery = listQuery({ data: annotations, error: null })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: contract, error: null }) as never)
      .mockReturnValueOnce(annotationQuery as never)

    const identityQuery = new URLSearchParams({
      storage_path: 'contract-1/source.pdf',
      source_hash: 'a'.repeat(64),
      source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    })
    const response = await GET(new NextRequest(`http://localhost/api/contracts/contract-1/annotations?${identityQuery.toString()}`), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(annotations)
    expect(annotationQuery.eq).toHaveBeenCalledWith('source_hash', 'a'.repeat(64))
  })
})

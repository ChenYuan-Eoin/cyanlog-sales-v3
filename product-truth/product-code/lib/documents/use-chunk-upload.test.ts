import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChunkUpload } from '@/lib/hooks/useChunkUpload'
import { stableSourceUploadId } from './chunk-upload-protocol'

const CONTRACT_ID = 'd36fe9ff-b22d-4df1-83ae-843b65a1f54c'

function smallFile() {
  return new File([new Uint8Array(32)], 'contract.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

describe('useChunkUpload failure control', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not retry deterministic 401 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      success: false,
      error: { code: 'A001', message: '未登录或登录已过期' },
    }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({
      concurrency: 1,
      maxRetries: 3,
      onError,
    }))

    await act(async () => {
      await result.current.startUpload(smallFile(), CONTRACT_ID, 'token')
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('未登录或登录已过期')
    expect(result.current.state.status).toBe('error')
  })

  it('binds every request and completion to one upload session and file SHA', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!String(_url).includes('merge-chunks')) return new Response(null, { status: 200 })
      const mergeBody = JSON.parse(String(init?.body))
      return Response.json({
        data: {
          fileUrl: 'https://example.test/file',
          storagePath: 'contract/file',
          sourceHash: mergeBody.expectedSha256,
          sourceTextHash: 'b'.repeat(64),
          preparationStatus: 'READY',
          preparationReason: null,
          reviewReady: true,
          renderMode: 'browser-ooxml',
          pageMapLocator: 'provisional',
          contractStatus: 'PENDING',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onComplete = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ concurrency: 1, onComplete }))

    await act(async () => {
      await result.current.startUpload(smallFile(), CONTRACT_ID, 'token')
    })

    const chunkRequest = fetchMock.mock.calls[0][1] as RequestInit
    const chunkBody = chunkRequest.body as FormData
    const uploadId = String(chunkBody.get('uploadId'))
    const expectedSha256 = String(chunkBody.get('expectedSha256'))
    const mergeRequest = fetchMock.mock.calls[1][1] as RequestInit
    const mergeBody = JSON.parse(String(mergeRequest.body))

    expect(uploadId).toBe(await stableSourceUploadId(CONTRACT_ID, expectedSha256))
    expect(expectedSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(mergeBody).toMatchObject({ uploadId, expectedSha256 })
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      contractId: CONTRACT_ID,
      fileName: 'contract.docx',
      uploadId,
      sha256: expectedSha256,
    }))
  })

  it('fails closed when merge omits an explicit preparation state', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!String(_url).includes('merge-chunks')) return new Response(null, { status: 200 })
      const mergeBody = JSON.parse(String(init?.body))
      return Response.json({
        data: {
          fileUrl: 'https://example.test/file',
          storagePath: 'contract/file',
          sourceHash: mergeBody.expectedSha256,
          sourceTextHash: null,
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onComplete = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ concurrency: 1, onComplete, onError }))

    await act(async () => {
      await result.current.startUpload(smallFile(), CONTRACT_ID, 'token')
    })

    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('文件已合并，但返回的源文件身份不完整或不一致')
    expect(result.current.state.status).toBe('error')
  })

  it('ignores a second start while the first run is still active', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(Response.json({ success: true }))
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ concurrency: 1, onError }))
    const file = smallFile()

    let firstRun: Promise<void> | undefined
    let duplicateRun: Promise<void> | undefined
    act(() => {
      firstRun = result.current.startUpload(file, CONTRACT_ID, 'token')
      duplicateRun = result.current.startUpload(file, CONTRACT_ID, 'token')
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await duplicateRun

    let cancellationAccepted = false
    await act(async () => {
      cancellationAccepted = await result.current.cancelUpload()
    })
    await act(async () => {
      await firstRun
    })

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    const deleteCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
    expect(postCalls).toHaveLength(1)
    expect(deleteCalls).toHaveLength(1)
    const chunkBody = (postCalls[0][1] as RequestInit).body as FormData
    const cleanupBody = JSON.parse(String((deleteCalls[0][1] as RequestInit).body))
    expect(cleanupBody).toEqual({
      uploadId: chunkBody.get('uploadId'),
      expectedSha256: chunkBody.get('expectedSha256'),
      chunkCount: 1,
    })
    expect(cancellationAccepted).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps bounded retries for transient 503 responses', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(
      { error: '服务暂时不可用' },
      { status: 503 }
    ))
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({
      concurrency: 1,
      maxRetries: 3,
      onError,
    }))

    await act(async () => {
      await result.current.startUpload(smallFile(), CONTRACT_ID, 'token')
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledWith('服务暂时不可用')
  })

  it('preserves paused state when the in-flight request aborts', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }
      if (fetchMock.mock.calls.length === 2) {
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      const mergeBody = JSON.parse(String(init?.body))
      return Promise.resolve(Response.json({
        data: {
          fileUrl: 'https://example.test/file',
          storagePath: 'contract/file',
          sourceHash: mergeBody.expectedSha256,
          sourceTextHash: 'b'.repeat(64),
          preparationStatus: 'READY',
          preparationReason: null,
          reviewReady: true,
          renderMode: 'browser-ooxml',
          pageMapLocator: 'provisional',
          contractStatus: 'PENDING',
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ concurrency: 1, onError }))
    const file = smallFile()

    let uploadPromise: Promise<void> | undefined
    act(() => {
      uploadPromise = result.current.startUpload(file, CONTRACT_ID, 'token')
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    act(() => result.current.pauseUpload())
    await act(async () => {
      await uploadPromise
    })

    expect(result.current.state.status).toBe('paused')
    expect(onError).not.toHaveBeenCalled()

    const firstBody = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData
    const firstUploadId = firstBody.get('uploadId')
    await act(async () => {
      await result.current.startUpload(file, CONTRACT_ID, 'token')
    })
    const resumedBody = (fetchMock.mock.calls[1][1] as RequestInit).body as FormData

    expect(resumedBody.get('uploadId')).toBe(firstUploadId)
    expect(result.current.state.status).toBe('completed')
  })

  it('rejects empty files without creating network work', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ onError }))
    const empty = new File([], 'empty.pdf', { type: 'application/pdf' })

    await act(async () => {
      await result.current.startUpload(empty, CONTRACT_ID, 'token')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('文件大小无效或超过 50MB 限制')
  })

  it('reports a saved PDF awaiting OCR as a successful upload result', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!String(_url).includes('merge-chunks')) return new Response(null, { status: 200 })
      const mergeBody = JSON.parse(String(init?.body))
      return Response.json({
        data: {
          fileUrl: 'https://example.test/scan',
          storagePath: 'contract/scan.pdf',
          sourceHash: mergeBody.expectedSha256,
          sourceTextHash: null,
          preparationStatus: 'AWAITING_OCR',
          preparationReason: 'PDF_TEXT_UNAVAILABLE',
          reviewReady: false,
          renderMode: 'native-pdf',
          pageMapLocator: null,
          contractStatus: 'DRAFT',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onComplete = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ concurrency: 1, onComplete, onError }))

    await act(async () => {
      await result.current.startUpload(
        new File([Buffer.from('%PDF-1.7\n%%EOF')], 'scan.pdf', { type: 'application/pdf' }),
        CONTRACT_ID,
        'token',
      )
    })

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      contractId: CONTRACT_ID,
      preparationStatus: 'AWAITING_OCR',
      reviewReady: false,
      sourceTextHash: null,
    }))
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.state.status).toBe('completed')
  })

  it('reports legacy DOC as saved but awaiting conversion, never review-ready', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!String(_url).includes('merge-chunks')) return new Response(null, { status: 200 })
      const mergeBody = JSON.parse(String(init?.body))
      return Response.json({
        data: {
          fileUrl: 'https://example.test/legacy',
          storagePath: 'contract/legacy.doc',
          sourceHash: mergeBody.expectedSha256,
          sourceTextHash: null,
          preparationStatus: 'AWAITING_CONVERSION',
          preparationReason: 'LEGACY_DOC_REQUIRES_CONVERSION',
          reviewReady: false,
          renderMode: 'identity-only',
          pageMapLocator: null,
          contractStatus: 'DRAFT',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onComplete = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ concurrency: 1, onComplete, onError }))

    await act(async () => {
      await result.current.startUpload(
        new File([
          new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        ], 'legacy.doc', { type: 'application/msword' }),
        CONTRACT_ID,
        'token',
      )
    })

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      contractId: CONTRACT_ID,
      preparationStatus: 'AWAITING_CONVERSION',
      reviewReady: false,
      sourceTextHash: null,
    }))
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.state.status).toBe('completed')
  })
})

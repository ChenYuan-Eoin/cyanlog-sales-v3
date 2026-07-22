import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChunkUpload } from '@/lib/hooks/useChunkUpload'

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
      await result.current.startUpload(smallFile(), 'contract-1', 'token')
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('未登录或登录已过期')
    expect(result.current.state.status).toBe('error')
  })

  it('binds every request and completion to one upload session and file SHA', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        data: { fileUrl: 'https://example.test/file', storagePath: 'contract/file' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const onComplete = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ concurrency: 1, onComplete }))

    await act(async () => {
      await result.current.startUpload(smallFile(), 'contract-1', 'token')
    })

    const chunkRequest = fetchMock.mock.calls[0][1] as RequestInit
    const chunkBody = chunkRequest.body as FormData
    const uploadId = String(chunkBody.get('uploadId'))
    const expectedSha256 = String(chunkBody.get('expectedSha256'))
    const mergeRequest = fetchMock.mock.calls[1][1] as RequestInit
    const mergeBody = JSON.parse(String(mergeRequest.body))

    expect(uploadId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(expectedSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(mergeBody).toMatchObject({ uploadId, expectedSha256 })
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      contractId: 'contract-1',
      fileName: 'contract.docx',
      uploadId,
      sha256: expectedSha256,
    }))
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
      firstRun = result.current.startUpload(file, 'contract-1', 'token')
      duplicateRun = result.current.startUpload(file, 'contract-1', 'token')
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
      await result.current.startUpload(smallFile(), 'contract-1', 'token')
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
      return Promise.resolve(Response.json({
        data: { fileUrl: 'https://example.test/file', storagePath: 'contract/file' },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const { result } = renderHook(() => useChunkUpload({ concurrency: 1, onError }))
    const file = smallFile()

    let uploadPromise: Promise<void> | undefined
    act(() => {
      uploadPromise = result.current.startUpload(file, 'contract-1', 'token')
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
      await result.current.startUpload(file, 'contract-1', 'token')
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
      await result.current.startUpload(empty, 'contract-1', 'token')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('文件大小无效或超过 50MB 限制')
  })
})

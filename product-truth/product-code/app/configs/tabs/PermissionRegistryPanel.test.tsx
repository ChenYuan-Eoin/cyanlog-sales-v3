import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { PermissionRegistryPanel } from './PermissionRegistryPanel'

const definitions = [{
  id: 'permission-1',
  key: 'report:read',
  label: '报表读取',
  description: '读取报表。',
  category: 'console',
  kind: 'atomic',
  status: 'draft',
  version: 1,
  enforcementConsumer: null,
}]

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

describe('PermissionRegistryPanel', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'token-1')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('stays hidden for a tenant administrator without platform registry authority', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: { code: 'A002' } }, 403)))
    const { container } = render(<PermissionRegistryPanel />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows lifecycle state and advances a reviewed definition through explicit actions', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        data: { definitions },
      }))
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        data: { definition: { ...definitions[0], status: 'reviewed' } },
      }))
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        data: { definitions: [{ ...definitions[0], status: 'reviewed' }] },
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<PermissionRegistryPanel />)
    expect(await screen.findByText('平台权限定义')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '管理目录' }))
    expect(screen.getByText('report:read')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/permissions/permission-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ action: 'review' }),
    })))
    expect(await screen.findByText('待发布')).toBeInTheDocument()
  })
})

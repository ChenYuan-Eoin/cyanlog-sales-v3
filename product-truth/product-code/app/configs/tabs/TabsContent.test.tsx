/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import TabsContent from './TabsContent'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const baseProps = {
  products: [],
  onNewProduct: vi.fn(),
  onEditProduct: vi.fn(),
  onDeleteProduct: vi.fn(),
  rules: [],
  onSaveRule: vi.fn(),
  onDeleteRule: vi.fn(async () => true),
  configs: [],
  aiRuntimeOverview: null,
  aiRuntimeError: '',
  onNewConfig: vi.fn(),
  onEditConfig: vi.fn(),
  onReviseConfig: vi.fn(),
  onPublishConfig: vi.fn(),
  publishingConfigIds: new Set<string>(),
  configPublishFeedback: {},
  onFetchVersions: vi.fn(),
  onDeleteConfig: vi.fn(),
  orgSummary: null,
  feishuSyncing: false,
  feishuFeedback: null,
  onFeishuSync: vi.fn(),
  onRefreshOrg: vi.fn(),
  roles: [],
  permissionCatalog: [],
  savingRoleId: null,
  permissionsEditable: false,
  permissionsEditBlockReason: null,
  onSaveRole: vi.fn(),
} as any

describe('TabsContent request scope', () => {
  it('loads current user identity only when organization or role editing needs it', async () => {
    const fetchMock = vi.fn(async () => Response.json({ user: { id: 'user-1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(
      <TabsContent {...baseProps} activeTab="price-list" loading />,
    )

    expect(fetchMock).not.toHaveBeenCalled()

    view.rerender(
      <TabsContent {...baseProps} activeTab="role-access" loading />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ cache: 'no-store' }),
    ))
  })
})

import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ConfigCenterTab from './ConfigCenterTab'

const rows = [
  { id: 'draft', param_key: 'TEST_DRAFT', status: 'DRAFT', version: 2 },
  { id: 'live', param_key: 'TEST_LIVE', status: 'PUBLISHED', version: 3 },
]

function readAs(canWrite: boolean, canPublish: boolean) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/versions')
    ? Response.json({
      success: true,
      data: [{ id: 'v1', version: 1, status: 'PUBLISHED', created_at: '2026-11-01T00:00:00Z' }],
    })
    : Response.json({ success: true, data: rows, meta: { access: { canWrite, canPublish } } }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each([
  { label: 'viewer', canWrite: false, canPublish: false, editDraft: false, editLive: false, publish: false },
  { label: 'writer', canWrite: true, canPublish: false, editDraft: true, editLive: false, publish: false },
  { label: 'publisher', canWrite: false, canPublish: true, editDraft: false, editLive: false, publish: true },
  { label: 'writer and publisher', canWrite: true, canPublish: true, editDraft: true, editLive: true, publish: true },
])('matches configuration actions and version history for a $label', async (scenario) => {
  readAs(scenario.canWrite, scenario.canPublish)
  render(<ConfigCenterTab domain="business-params" title="业务参数" />)

  const draft = within((await screen.findByText('TEST_DRAFT')).closest('tr')!)
  const live = within(screen.getByText('TEST_LIVE').closest('tr')!)
  expect(Boolean(screen.queryByRole('button', { name: '新建' }))).toBe(scenario.canWrite)
  expect(Boolean(draft.queryByRole('button', { name: '编辑' }))).toBe(scenario.editDraft)
  expect(Boolean(live.queryByRole('button', { name: '编辑' }))).toBe(scenario.editLive)
  expect(Boolean(draft.queryByRole('button', { name: '删除' }))).toBe(scenario.canWrite)
  expect(Boolean(draft.queryByRole('button', { name: '发布' }))).toBe(scenario.publish)
  expect(live.queryByRole('button', { name: '发布' })).not.toBeInTheDocument()

  fireEvent.click(draft.getByRole('button', { name: '版本' }))
  const dialog = await screen.findByRole('dialog', { name: '版本历史' })
  expect(Boolean(within(dialog).queryByRole('button', { name: '回滚到该版本' }))).toBe(scenario.canWrite)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '版本历史' })).not.toBeInTheDocument()

  fireEvent.click(live.getByRole('button', { name: '版本' }))
  const liveDialog = await screen.findByRole('dialog', { name: '版本历史' })
  expect(Boolean(within(liveDialog).queryByRole('button', { name: '回滚到该版本' })))
    .toBe(scenario.canWrite && scenario.canPublish)
})

it('hides version history for a domain that does not support it', async () => {
  readAs(true, true)
  render(<ConfigCenterTab domain="approval-chains" title="审批链" />)

  await screen.findByRole('button', { name: '新建' })
  expect(screen.queryByRole('button', { name: '版本' })).not.toBeInTheDocument()
})

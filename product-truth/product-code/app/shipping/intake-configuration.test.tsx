import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import IntakeConfiguration from './intake-configuration'

const root = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const child = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const departments = [
  { id: root, name: '总部', path: '总部', parentId: null },
  { id: child, name: '销售部', path: '总部 / 销售部', parentId: root },
  { id: other, name: '研发部', path: '研发部', parentId: null },
]
const rules = { companyName: { enabled: true, required: true, minLength: 4 }, team: { enabled: true, required: false, minLength: 1 }, teamOptions: ['销售部'], allowedDepartmentIds: null }
const fetcher = vi.fn()
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('previews parent and child coverage before saving a scoped employee proposal policy', async () => {
  vi.stubGlobal('React', React)
  fetcher.mockReset().mockImplementation(async (_url: string, init?: RequestInit) => Response.json({ rules: init?.method === 'POST' ? { ...rules, allowedDepartmentIds: [root] } : rules, departments }))
  vi.stubGlobal('fetch', fetcher)
  render(<IntakeConfiguration mode="departments" />)
  await screen.findByRole('radio', { name: '全部有效部门' })
  expect(screen.queryByRole('group', { name: '允许提报的部门' })).toBeNull()
  expect(screen.queryByLabelText('搜索组织部门')).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: '指定部门' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '总部' }))
  expect(screen.getByText(/含下级共 2 个有效部门/)).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '保存寄件部门授权' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  const body = JSON.parse(fetcher.mock.calls[1][1].body)
  expect(body.allowedDepartmentIds).toEqual([root])
  expect(body).toEqual({allowedDepartmentIds:[root]})
})

it('excludes an inherited child while preserving other branches after a failed save', async () => {
  vi.stubGlobal('React', React)
  fetcher.mockReset().mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? Response.json({ error: '保存失败，请重试。' }, { status: 503 })
    : Response.json({ rules: { ...rules, allowedDepartmentIds: [root, other] }, departments }))
  vi.stubGlobal('fetch', fetcher)
  render(<IntakeConfiguration mode="departments" />)
  await screen.findByRole('checkbox', { name: '总部' })
  fireEvent.click(screen.getByRole('button', { name: '展开总部' }))
  expect(screen.getByRole('checkbox', { name: '销售部' })).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('checkbox', { name: '销售部' }))
  expect(screen.getByRole('checkbox', { name: '销售部' })).toHaveProperty('checked', false)
  expect(screen.getByRole('checkbox', { name: '研发部' })).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('button', { name: '保存寄件部门授权' }))
  await screen.findByText('保存失败，请重试。')
  const body = JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1].body)
  expect(body.allowedDepartmentIds).toEqual([other])
  expect(screen.getByRole('checkbox', { name: '研发部' })).toHaveProperty('checked', true)
})

it('keeps ancestors in search results, shows mixed parent state and clears only the draft', async () => {
  vi.stubGlobal('React', React)
  fetcher.mockReset().mockImplementation(async () => Response.json({ rules: { ...rules, allowedDepartmentIds: [child] }, departments }))
  vi.stubGlobal('fetch', fetcher)
  render(<IntakeConfiguration mode="departments" />)
  await screen.findByRole('checkbox', { name: '总部' })
  expect(screen.getByRole('checkbox', { name: '总部' })).toHaveProperty('indeterminate', true)
  fireEvent.change(screen.getByLabelText('搜索组织部门'), { target: { value: '销售' } })
  expect(screen.getByRole('checkbox', { name: '总部' })).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: '销售部' })).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: '研发部' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  expect(screen.getByText(/已选 0 个部门/)).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('preserves the specific draft across mode switches and saves all as a dynamic rule', async () => {
  vi.stubGlobal('React', React)
  fetcher.mockReset().mockImplementation(async (_url: string, init?: RequestInit) => Response.json({
    rules: { ...rules, allowedDepartmentIds: init?.body ? JSON.parse(String(init.body)).allowedDepartmentIds : [child] }, departments,
  }))
  vi.stubGlobal('fetch', fetcher)
  render(<IntakeConfiguration mode="departments" />)
  await screen.findByRole('checkbox', { name: '总部' })
  fireEvent.click(screen.getByRole('radio', { name: '全部有效部门' }))
  expect(screen.queryByRole('group', { name: '允许提报的部门' })).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: '指定部门' }))
  fireEvent.click(screen.getByRole('button', { name: '展开总部' }))
  expect(screen.getByRole('checkbox', { name: '销售部' })).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('radio', { name: '全部有效部门' }))
  fireEvent.click(screen.getByRole('button', { name: '保存寄件部门授权' }))
  await screen.findByText('寄件部门授权已保存，新提报立即生效。')
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
  expect(writes).toHaveLength(1)
  expect(JSON.parse(String(writes[0][1].body))).toEqual({ allowedDepartmentIds: null })
})

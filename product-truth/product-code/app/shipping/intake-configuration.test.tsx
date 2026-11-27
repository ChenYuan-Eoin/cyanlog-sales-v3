import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import IntakeConfiguration, { ShippingDepartmentAuthorization } from './intake-configuration'

const root = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const child = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const orgId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const departments = [
  { id: root, name: '总部', parentId: null },
  { id: child, name: '销售部', parentId: root },
  { id: other, name: '研发部', parentId: null },
]
const companyName = { enabled: true, required: true, minLength: 4 }
const fetcher = vi.fn()

beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function openDepartmentAuthorization() {
  render(<ShippingDepartmentAuthorization orgId={orgId} />)
  fireEvent.click(await screen.findByText('提报部门范围'))
}

it('submits customer field rules without any department authorization data', async () => {
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => Response.json({
    rules: init?.body ? JSON.parse(String(init.body)) : { companyName, allowedDepartmentIds: [root] },
  }))
  render(<IntakeConfiguration />)
  fireEvent.change(await screen.findByLabelText('公司名称最少字数'), { target: { value: '8' } })
  fireEvent.click(screen.getByRole('button', { name: '保存寄件提报规则' }))
  await screen.findByText('寄件提报规则已保存。')
  expect(fetcher.mock.calls[1][0]).toBe('/api/shipping/intake-settings')
  expect(fetcher.mock.calls[1][1].method).toBe('POST')
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ companyName: { ...companyName, minLength: 8 } })
})

it('previews parent and child coverage before saving a scoped employee proposal policy', async () => {
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => Response.json({
    departments,
    allowedDepartmentIds: init?.method === 'PATCH' ? [root] : null,
  }))
  await openDepartmentAuthorization()
  expect(screen.getByText('尚未指定提报部门。当前部门限制未启用。')).toBeTruthy()
  expect(screen.queryByRole('group', { name: '允许提报的部门' })).toBeNull()
  expect(screen.queryByRole('button', { name: '保存提报部门范围' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '改为指定部门' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '总部' }))
  expect(screen.getByText(/含下级共 2 个有效部门/)).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '保存提报部门范围' }))
  await screen.findByText('提报部门范围已保存，对新提报立即生效。')
  expect(fetcher.mock.calls[1][0]).toBe(`/api/admin/departments/shipping-intake?orgId=${orgId}`)
  expect(fetcher.mock.calls[1][1].method).toBe('PATCH')
  expect(fetcher.mock.calls[1][1].headers['Content-Type']).toBe('application/json')
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ allowedDepartmentIds: [root] })
})

it('excludes an inherited child while preserving other branches after a failed save', async () => {
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
    ? Response.json({ error: '保存失败，请重试。' }, { status: 503 })
    : Response.json({ allowedDepartmentIds: [root, other], departments }))
  await openDepartmentAuthorization()
  fireEvent.click(screen.getByRole('button', { name: '展开总部' }))
  expect(screen.getByRole('checkbox', { name: '销售部' })).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('checkbox', { name: '销售部' }))
  expect(screen.getByRole('checkbox', { name: '销售部' })).toHaveProperty('checked', false)
  expect(screen.getByRole('checkbox', { name: '研发部' })).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('button', { name: '保存提报部门范围' }))
  await screen.findByText('保存失败，请重试。')
  const body = JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')![1].body)
  expect(body.allowedDepartmentIds).toEqual([other])
  expect(screen.getByRole('checkbox', { name: '研发部' })).toHaveProperty('checked', true)
})

it('keeps ancestors in search results, shows mixed parent state and clears only the draft', async () => {
  fetcher.mockImplementation(async () => Response.json({ allowedDepartmentIds: [child], departments }))
  await openDepartmentAuthorization()
  expect(screen.getByRole('checkbox', { name: '总部' })).toHaveProperty('indeterminate', true)
  fireEvent.change(screen.getByLabelText('搜索组织部门'), { target: { value: '总部 / 销售' } })
  expect(screen.getByRole('checkbox', { name: '总部' })).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: '销售部' })).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: '研发部' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  expect(screen.getByText(/已选 0 个部门/)).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('saves an empty explicit list when an administrator removes all department authorization', async () => {
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => Response.json({
    departments,
    allowedDepartmentIds: init?.method === 'PATCH' ? [] : [child],
  }))
  await openDepartmentAuthorization()
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  expect(screen.getByText('保存空名单后，员工将不能新提报。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存提报部门范围' }))
  await screen.findByText('提报部门范围已保存，对新提报立即生效。')
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')
  expect(writes).toHaveLength(1)
  expect(JSON.parse(String(writes[0][1].body))).toEqual({ allowedDepartmentIds: [] })
})

it('removes the editor when an administrator has lost permission to save a draft', async () => {
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
    ? Response.json({ error: 'Forbidden' }, { status: 403 })
    : Response.json({ allowedDepartmentIds: [child], departments }))
  await openDepartmentAuthorization()
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  fireEvent.click(screen.getByRole('button', { name: '保存提报部门范围' }))
  await screen.findByText('当前账号无法更新提报部门范围。')
  expect(screen.queryByRole('button', { name: '保存提报部门范围' })).toBeNull()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
})

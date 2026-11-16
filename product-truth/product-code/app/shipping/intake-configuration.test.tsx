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
  expect(screen.getByText(/选择“指定部门”可逐项配置/)).toBeTruthy()
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

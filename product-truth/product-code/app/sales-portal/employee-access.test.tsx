import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EmployeeAccess from './employee-access'
const fetcher = vi.fn()
const employee = { id: 'employee-a', email: 'person@ones.cn', team: '销售部', updatedAt: '2026-10-09T00:00:00.000Z', sender: { name: '测试姓名', phone: '13800138000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路88号' } }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
function mount() { return render(<EmployeeAccess>{({ employee: profile, controls, canSubmit }) => <>{controls}{canSubmit && <div>工单表单：{profile?.sender?.name}</div>}</>}</EmployeeAccess>) }
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('employee portal access', () => {
  it('loads the saved profile without re-entering personal details', async () => {
    fetcher.mockResolvedValue(response({ employee })); mount()
    expect(await screen.findByText('工单表单：测试姓名')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '寄件人姓名' })).toBeNull()
  })
  it('does not mistake a server failure for a signed-out session', async () => {
    fetcher.mockResolvedValue(response({ error: '暂不可用' }, 503)); mount()
    expect(await screen.findByRole('button', { name: '重新读取资料' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '获取验证码' })).toBeNull()
  })
  it('verifies email then requires initial saved sender information', async () => {
    fetcher.mockResolvedValueOnce(response({ employee: null })).mockResolvedValueOnce(response({ challengeId: 'challenge-id', delivery: 'accepted' })).mockResolvedValueOnce(response({ employee: { ...employee, sender: null, team: '' } }))
    mount(); fireEvent.change(await screen.findByLabelText('公司邮箱'), { target: { value: 'person@ones.cn' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    fireEvent.change(await screen.findByLabelText('邮箱验证码'), { target: { value: '012345' } })
    fireEvent.click(screen.getByRole('button', { name: '验证邮箱' }))
    expect(await screen.findByRole('button', { name: '保存寄件资料' })).toBeTruthy()
    expect(screen.queryByText('工单表单：测试姓名')).toBeNull()
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ action: 'verify_code', email: 'person@ones.cn', challengeId: 'challenge-id', code: '012345' })
  })
  it('saves profile changes on the server and clears the old identity on logout', async () => {
    fetcher.mockResolvedValueOnce(response({ employee })).mockResolvedValueOnce(response({ employee: { ...employee, sender: { ...employee.sender, name: '新姓名' } } })).mockResolvedValueOnce(response({ employee: null }))
    mount(); fireEvent.click(await screen.findByRole('button', { name: '修改我的寄件资料' }))
    fireEvent.change(screen.getByLabelText('寄件人姓名'), { target: { value: '新姓名' } })
    fireEvent.click(screen.getByRole('button', { name: '保存寄件资料' }))
    expect(await screen.findByText('工单表单：新姓名')).toBeTruthy()
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ action: 'save_profile', profile: { expectedUpdatedAt: employee.updatedAt, sender: { name: '新姓名' } } })
    fireEvent.click(screen.getByRole('button', { name: '退出 / 换人' }))
    await waitFor(() => expect(screen.queryByText('工单表单：新姓名')).toBeNull())
    expect(await screen.findByLabelText('公司邮箱')).toBeTruthy()
  })
})

it('allows anonymous intake after optional profile lookup fails', async () => {
  fetcher.mockResolvedValue(response({ error: '资料读取失败' }, 503))
  mount()
  await screen.findByRole('button', { name: '重新读取资料' })
  for (const [label, value] of Object.entries({ '寄件人姓名': '测试姓名', '寄件人联系电话': '13800000000', '寄件省份': '广东省', '寄件城市': '深圳市', '寄件区县': '南山区', '详细寄件地址': '科苑路15号', '所属团队': '销售' })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  expect(screen.getByText('工单表单：')).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('parses sender information and allows optional team to remain empty', async () => {
  fetcher.mockResolvedValue(response({ employee: null }))
  render(<EmployeeAccess emailAvailable={false} rules={{ companyName: { enabled: true, required: true, minLength: 4 }, team: { enabled: false, required: false, minLength: 1 }, teamOptions: [] }}>{({ controls, canSubmit }) => <>{controls}<button disabled={!canSubmit}>提报就绪</button></>}</EmployeeAccess>)
  await screen.findByText('邮箱验证尚未启用，不影响匿名提报。')
  fireEvent.change(screen.getByLabelText('寄方地址文本'), { target: { value: '张三 13800000000 广东省深圳市南山区科苑路15号' } })
  fireEvent.click(screen.getByRole('button', { name: '解析寄方信息' }))
  expect(screen.getByLabelText('寄件人姓名')).toHaveProperty('value', '张三')
  expect(screen.getByLabelText('寄件城市')).toHaveProperty('value', '深圳市')
  expect(screen.queryByLabelText('所属团队')).toBeNull()
  expect(screen.getByRole('button', { name: '提报就绪' })).toHaveProperty('disabled', false)
})

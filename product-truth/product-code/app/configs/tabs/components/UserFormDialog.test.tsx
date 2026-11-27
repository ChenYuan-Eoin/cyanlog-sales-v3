import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { UserFormDialog } from './UserFormDialog'

afterEach(cleanup)

it('keeps department changes out of profile edits even with department access', async () => {
  const submit = vi.fn<(values: object) => Promise<void>>().mockResolvedValue(undefined)
  render(<UserFormDialog open onOpenChange={vi.fn()} onSubmit={submit} canSelectDepartment
    departments={[{ id: 'dept', name: '受限部门', parent_name: null }]}
    editingUser={{
      id: 'person', email: 'person@example.test', phone: '13900000000', display_name: '在职成员',
      title: '', primary_dept_id: 'dept', primary_dept_name: '受限部门', role_names: '', status: 'active',
    }} />)

  expect(screen.queryByText('主部门')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '新姓名' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  const submitted = JSON.parse(JSON.stringify(submit.mock.calls[0]?.[0]))
  expect(submitted).toMatchObject({ display_name: '新姓名' })
  expect(submitted).not.toHaveProperty('primary_dept_id')
})

it('still offers department selection when creating a member', () => {
  render(<UserFormDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()}
    departments={[{ id: 'dept', name: '销售部', parent_name: null }]} />)
  expect(screen.getByLabelText('主部门')).toBeInTheDocument()
})

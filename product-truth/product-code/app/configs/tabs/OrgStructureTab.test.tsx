import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { OrgSummaryPayload } from '../types'

vi.mock('./components/DepartmentFormDialog', () => ({ DepartmentFormDialog: () => null }))
vi.mock('./components/UserFormDialog', () => ({ UserFormDialog: () => null }))
vi.mock('./components/RoleAssignmentDialog', () => ({ RoleAssignmentDialog: () => null }))
vi.mock('./components/IdentityBindingDialog', () => ({ IdentityBindingDialog: () => null }))
import OrgStructureTab from './OrgStructureTab'

afterEach(cleanup)

it('cascades department selection through primary and secondary memberships and keeps unlinked employees visible', () => {
  const payload: OrgSummaryPayload = {
    roles: [], spaces: [],
    departments: [
      { id: 'd1', name: '销售部', parent_name: null, parent_id: null, member_count: 1 },
      { id: 'd2', name: '咨询部', parent_name: null, parent_id: null, member_count: 1 },
      { id: 'd3', name: '财务部', parent_name: null, parent_id: null, member_count: 1 },
    ],
    users: [
      { id: 'person-1', display_name: '待关联员工甲', email: '', title: '', role_names: '', status: 'inactive', login_enabled: false, membership_status: 'invited',
        primary_dept_id: 'd2', primary_dept_name: '咨询部', department_ids: ['d1', 'd2'], secondary_dept_names: ['销售部'],
        directory_identity_id: 'i1', directory_pending_account: true, directory_status: 'active' },
      { id: 'u2', display_name: '财务员工乙', email: '', title: '', role_names: '', status: 'active', primary_dept_id: 'd3', primary_dept_name: '财务部', department_ids: [] },
    ],
  }
  render(<OrgStructureTab orgSummary={payload} currentUserId="actor" />)
  fireEvent.click(screen.getByRole('button', { name: /^销售部/ }))
  expect(screen.getByText('待关联员工甲')).toBeInTheDocument()
  expect(screen.queryByText('财务员工乙')).not.toBeInTheDocument()
  expect(screen.getByText('待关联账号')).toBeInTheDocument()
  const row = screen.getByText('待关联员工甲').closest('tr')!
  expect(within(row).getByText('咨询部')).toBeInTheDocument()
  expect(within(row).getByText('附属：销售部')).toBeInTheDocument()
  expect(within(row).getByRole('button')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^财务部/ }))
  expect(screen.queryByText('待关联员工甲')).not.toBeInTheDocument()
  expect(screen.getByText('财务员工乙')).toBeInTheDocument()
})

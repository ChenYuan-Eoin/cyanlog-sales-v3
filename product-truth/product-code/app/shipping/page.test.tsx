// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  user: vi.fn(),
  redirect: vi.fn(),
  access: vi.fn(),
  settings: vi.fn(),
  options: vi.fn(),
  profile: vi.fn(),
}))

vi.mock('@/lib/server-auth', () => ({ getServerAuthToken: mocks.token }))
vi.mock('@/lib/auth', () => ({ getAuthUserByToken: mocks.user }))
vi.mock('@/lib/shipping/entry-access', () => ({ resolveShippingEntry: mocks.access }))
vi.mock('@/lib/shipping/workspace-settings', () => ({ loadShippingWorkspaceSettings: mocks.settings }))
vi.mock('@/lib/shipping/intake-options', () => ({ loadIntakeOptionsForOrg: mocks.options }))
vi.mock('@/lib/shipping/department-access', () => ({ loadFxiaokeShippingProfile: mocks.profile }))
vi.mock('@/app/sales-portal/portal', () => ({ FxiaokeShippingProposal: function FxiaokeShippingProposal() { return null }, AuthenticatedReceiptRoute: function AuthenticatedReceiptRoute() { return null } }))
vi.mock('@/app/sales-portal/my-workorders', () => ({ default: function MyWorkorders() { return null } }))
vi.mock('./workbench', () => ({ default: function ShippingWorkbench() { return null } }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import ShippingPage from './page'
import SalesPortalPage from '@/app/sales-portal/page'

const user = { id: 'member' }
const rules = { teamOptions: [] }
const access = { orgId: 'active-org', canOperate: false, canViewOwn: false, canSubmitOwn: false, canManageConnections: false, ownerPermissions: [] }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.token.mockResolvedValue('token')
  mocks.user.mockResolvedValue(user)
  mocks.access.mockResolvedValue(access)
  mocks.options.mockResolvedValue({ rules, services: [], connectionStatus: 'ready' })
  mocks.profile.mockResolvedValue({ id: 'member', fxiaoke: true })
  mocks.settings.mockResolvedValue({ environment: 'sandbox', ready: false })
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`) })
})

describe('self-service shipping entry', () => {
  it('requires login before checking the shipping grants or loading data', async () => {
    mocks.token.mockResolvedValue(undefined)
    await expect(ShippingPage()).rejects.toThrow('redirect:/login')
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it.each([null, access])('denies a member without a live shipping entry grant', async (entry) => {
    mocks.access.mockResolvedValue(entry)
    await expect(ShippingPage()).rejects.toThrow('redirect:/?denied=shipping:operate')
    expect(mocks.settings).not.toHaveBeenCalled()
    expect(mocks.options).not.toHaveBeenCalled()
  })

  it('opens employee intake under the organization selected by the live resolver', async () => {
    mocks.access.mockResolvedValue({ ...access, canViewOwn: true, canSubmitOwn: true, ownerPermissions: ['shipping:owner_view', 'shipping:owner_submit'] })
    const page = await ShippingPage()
    const [navigation, proposal] = page.props.children
    expect(navigation).toBe(false)
    expect(proposal.type.name).toBe('FxiaokeShippingProposal')
    expect(proposal.props.profile).toEqual({ id: 'member', fxiaoke: true })
    expect(mocks.access).toHaveBeenCalledWith(user, 'token')
    expect(mocks.options).toHaveBeenCalledWith('active-org')
    expect(mocks.profile).toHaveBeenCalledWith(user, 'active-org', rules)
    expect(mocks.settings).not.toHaveBeenCalled()
  })

  it('opens only the authenticated receipt list for a read-only employee', async () => {
    mocks.access.mockResolvedValue({ ...access, canViewOwn: true })
    const page = await ShippingPage()
    const [navigation, content] = page.props.children
    const [heading, , receipts] = content.props.children.props.children
    expect(navigation).toBe(false)
    expect(heading.props.children).toBe('我的提报记录')
    expect(receipts.type.name).toBe('MyWorkorders')
    expect(receipts.props).toEqual({ scope: 'owner', readOnly: true })
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.profile).not.toHaveBeenCalled()
    expect(mocks.settings).not.toHaveBeenCalled()
  })

  it('offers the dedicated settings link when an employee can also manage connections', async () => {
    mocks.access.mockResolvedValue({ ...access, canViewOwn: true, canSubmitOwn: true, ownerPermissions: ['shipping:owner_view', 'shipping:owner_submit'], canManageConnections: true })
    const page = await ShippingPage()
    const [navigation, proposal] = page.props.children
    expect(navigation.props.children.props.href).toBe('/shipping/settings')
    expect(proposal.type.name).toBe('FxiaokeShippingProposal')
  })

  it('sends a manager-only member to settings without loading intake or order settings', async () => {
    mocks.access.mockResolvedValue({ ...access, canManageConnections: true })
    await expect(ShippingPage()).rejects.toThrow('redirect:/shipping/settings')
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.settings).not.toHaveBeenCalled()
  })

  it.each([false, true])('opens the operator workbench before employee intake with manager grant %s', async (canManageConnections) => {
    mocks.access.mockResolvedValue({ ...access, canOperate: true, canViewOwn: true, canSubmitOwn: true, canManageConnections })
    const page = await ShippingPage()
    expect(page.type.name).toBe('ShippingWorkbench')
    expect(page.props.settings).toEqual({ environment: 'sandbox', ready: false, canOperate: true, canViewOwn: true, canManageConnections })
    expect(mocks.settings).toHaveBeenCalledWith('active-org')
    expect(mocks.options).not.toHaveBeenCalled()
  })
})

it('offers operator and explicitly preferred owner entries for the same verified session', async () => {
  mocks.access.mockResolvedValue({
    ...access, canOperate: true, canViewOwn: true, canSubmitOwn: true,
    ownerPermissions: ['shipping:owner_view', 'shipping:owner_submit'],
  })
  const workspace = await ShippingPage()
  expect(workspace.type.name).toBe('ShippingWorkbench')
  expect(workspace.props.settings.canViewOwn).toBe(true)
  const employee = await SalesPortalPage()
  expect(employee.type.name).toBe('AuthenticatedReceiptRoute')
  expect(employee.props.children.props.children[1].type.name).toBe('FxiaokeShippingProposal')
  expect(mocks.access).toHaveBeenNthCalledWith(1, user, 'token')
  expect(mocks.access).toHaveBeenNthCalledWith(2, user, 'token')
})

// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_INTAKE_RULES } from '@/lib/shipping/intake-rules'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), settings: vi.fn(), load: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/auth', () => ({ AuthError: class extends Error {}, requireAuth: mocks.auth }))
vi.mock('@/lib/shipping/connection-authorization', () => ({ requireShippingConnectionManager: mocks.settings }))
vi.mock('@/lib/shipping/intake-settings', () => ({ loadIntakeSettings: mocks.load, saveIntakeSettings: mocks.save }))

const url = 'https://example.test/api/shipping/intake-settings'
const fields = { companyName: DEFAULT_INTAKE_RULES.companyName, team: DEFAULT_INTAKE_RULES.team, teamOptions: [] }
const saved = { ...fields, allowedDepartmentIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ id: 'shipping-manager' })
  mocks.settings.mockResolvedValue('active-org')
  mocks.load.mockResolvedValue(saved)
  mocks.save.mockResolvedValue(saved)
})

it('returns only business parameters using the settings read permission', async () => {
  const response = await GET(new NextRequest(url))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ rules: fields })
  expect(mocks.settings).toHaveBeenCalledExactlyOnceWith('shipping-manager', 'shipping:settings_view')
})

it('saves business parameters using the intake write permission', async () => {
  const input = { companyName: DEFAULT_INTAKE_RULES.companyName }
  const response = await POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(input) }))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ rules: fields })
  expect(mocks.settings).toHaveBeenCalledExactlyOnceWith('shipping-manager', 'shipping:intake_write')
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('active-org', 'shipping-manager', input)
})

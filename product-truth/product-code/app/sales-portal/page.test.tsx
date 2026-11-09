import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ settings: vi.fn(), profile: vi.fn(), options: vi.fn() }))
vi.mock('@/lib/shipping/wecom-settings', () => ({ readWecomSettings: m.settings }))
vi.mock('@/lib/shipping/wecom-session', () => ({ getWecomSession: m.profile }))
vi.mock('@/lib/shipping/intake-options', () => ({ loadPublicIntakeOptions: m.options }))
vi.mock('./portal', () => ({ default: () => null }))
import Page from './page'
beforeEach(() => { vi.stubGlobal('React', React); vi.resetAllMocks(); m.options.mockResolvedValue({ requireVerification: false, services: [] }) })
afterEach(() => vi.unstubAllGlobals())
it('renders the anonymous form without a WeCom session or directory lookup', async () => {
  const result = await Page()
  expect(result.props.initialEmployee).toBeNull()
  expect(result.props.initialOptions.requireVerification).toBe(false)
  expect(m.profile).not.toHaveBeenCalled()
  expect(m.settings).not.toHaveBeenCalled()
})
it('does not let a WeCom outage block anonymous access', async () => {
  m.settings.mockRejectedValue(new Error('WeCom unavailable'))
  m.profile.mockRejectedValue(new Error('stale identity'))
  expect((await Page()).props.initialEmployee).toBeNull()
})
it('does not invent usable settings when the shipping configuration fails', async () => {
  m.options.mockRejectedValue(new Error('database failed'))
  expect((await Page()).props.initialOptions).toBeUndefined()
})

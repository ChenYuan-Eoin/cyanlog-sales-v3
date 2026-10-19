import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import WecomBotConfiguration from './wecom-bot-configuration'

const fetcher = vi.fn()
const bot = { id: 'bot-1', corp_id: 'corp-1', bot_id: 'robot-7', name: '寄件助手', status: 'draft', verified_at: null, last_message_at: null }
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher); fetcher.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('prepares URL callback parameters without enabling an unverified robot', async () => {
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST'
    ? { bots: [bot], bot, setupKeys: { token: 'example-token', encodingAESKey: 'example-aes-key' } }
    : { bots: [] }))
  render(<WecomBotConfiguration corpId="corp-1" ready />)
  fireEvent.change(screen.getByLabelText('Bot ID'), { target: { value: 'robot-7' } })
  fireEvent.click(screen.getByRole('button', { name: '生成回调配置' }))
  const setup = await screen.findByRole('region', { name: '机器人接入参数' })
  expect(within(setup).getByLabelText('回调URL')).toHaveProperty('value', `${window.location.origin}/api/shipping/public/wecom/bot/bot-1`)
  expect(within(setup).getByLabelText('Token')).toHaveProperty('type', 'password')
  expect(within(setup).getByLabelText('EncodingAESKey')).toHaveProperty('type', 'password')
  expect(screen.getByRole('button', { name: '启用此机器人（替换当前通道）' })).toHaveProperty('disabled', true)
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body).action)).toEqual(['prepare'])
})

it('enables the explicit activation action only after callback verification is returned', async () => {
  fetcher.mockResolvedValue(Response.json({ bots: [{ ...bot, verified_at: '2026-10-19T04:00:00Z' }] }))
  render(<WecomBotConfiguration corpId="corp-1" ready />)
  const activate = await screen.findByRole('button', { name: '启用此机器人（替换当前通道）' })
  expect(activate).toHaveProperty('disabled', false)
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ redeem: vi.fn() }))
vi.mock('@/lib/shipping/wecom-bot-settings', () => ({ redeemLongConnectionEnrollment: mocks.redeem }))
import { POST } from './route'

const id = '11111111-1111-4111-8111-111111111111'
const params = { params: Promise.resolve({ id }) }
const request = (body: string) => new NextRequest(`https://sales.example.test/api/shipping/public/wecom/bot/${id}/long-connection/enroll`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.redeem.mockResolvedValue({ botId: id, remoteBotId: 'bot-1', secret: 'example-secret' })
})

it('redeems a short-lived enrollment token without accepting extra fields', async () => {
  const response = await POST(request(JSON.stringify({ token: 'example-token' })), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ botId: id, remoteBotId: 'bot-1' })
  expect(mocks.redeem).toHaveBeenCalledWith(id, 'example-token')
})

it('rejects malformed enrollment bodies', async () => {
  const response = await POST(request(JSON.stringify({ token: 'example-token', extra: true })), params)
  expect(response.status).toBe(400)
  expect(mocks.redeem).not.toHaveBeenCalled()
})

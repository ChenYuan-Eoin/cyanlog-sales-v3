// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  readBot: vi.fn(),
  secret: vi.fn(),
  online: vi.fn(),
  message: vi.fn(),
  enqueue: vi.fn(),
  process: vi.fn(),
  readEvent: vi.fn(),
}))

vi.mock('@/lib/shipping/wecom-bot-settings', () => ({
  readWecomBotForLongConnection: mocks.readBot,
  wecomLongConnectionSecret: mocks.secret,
  markWecomLongConnectionOnline: mocks.online,
  markWecomLongConnectionMessage: mocks.message,
}))
vi.mock('@/lib/shipping/wecom-bot-events', () => ({
  enqueueWecomBotEvent: mocks.enqueue,
  processWecomBotEvent: mocks.process,
  readWecomBotEvent: mocks.readEvent,
  botStreamReply: (event: { id: string; state: string; response_content: string }) => ({
    msgtype: 'stream',
    stream: { id: event.id, finish: event.state !== 'pending', content: event.response_content },
  }),
}))

import { POST } from './route'
import { signWecomBotRuntimeRequest } from '@/lib/shipping/wecom-bot-runtime'

const id = '11111111-1111-4111-8111-111111111111'
const bot = {
  id,
  org_id: 'org-a',
  corp_id: 'corp-a',
  bot_id: 'bot-1',
  status: 'draft',
  verified_at: null,
  credentials_ciphertext: 'long-connection:v1:cipher',
}
const params = { params: Promise.resolve({ id }) }
const secret = 'example-secret'

function request(payload: unknown) {
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  return new NextRequest(`https://sales.example.test/api/shipping/public/wecom/bot/${id}/long-connection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wecom-Runtime-Timestamp': timestamp,
      'X-Wecom-Runtime-Signature': signWecomBotRuntimeRequest(secret, timestamp, body),
    },
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readBot.mockResolvedValueOnce(bot).mockResolvedValue({ ...bot, status: 'active', verified_at: '2026-10-23T10:00:00.000Z' })
  mocks.secret.mockReturnValue(secret)
  mocks.online.mockResolvedValue(undefined)
  mocks.message.mockResolvedValue(undefined)
})

it('rejects an invalid signature before loading business state', async () => {
  const response = await POST(new NextRequest('https://sales.example.test/api', {
    method: 'POST',
    headers: { 'X-Wecom-Runtime-Timestamp': '1', 'X-Wecom-Runtime-Signature': 'invalid' },
    body: '{}',
  }), params)
  expect(response.status).toBe(401)
  expect(mocks.online).not.toHaveBeenCalled()
})

it('activates a saved long connection only after a signed authenticated heartbeat', async () => {
  const response = await POST(request({
    action: 'heartbeat',
    runtime: { version: 'v1', phase: 'connected', authenticated: true, business_ready: true },
  }), params)
  expect(response.status).toBe(200)
  expect(mocks.online).toHaveBeenCalledWith(bot)
})

it('runs a signed text message through the existing idempotent event processor', async () => {
  const event = { id: '22222222-2222-4222-8222-222222222222', state: 'pending', response_content: '' }
  mocks.enqueue.mockResolvedValue(event)
  mocks.process.mockResolvedValue(undefined)
  mocks.readEvent.mockResolvedValue({ ...event, state: 'done', response_content: '工单已提报：SO-20261023-ABCDEF12' })
  const response = await POST(request({
    action: 'message',
    frame: {
      msgid: 'message-1',
      aibotid: 'bot-1',
      from: { userid: 'employee-1' },
      chattype: 'single',
      msgtype: 'text',
      text: { content: '寄件' },
    },
  }), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ stream: { finish: true, content: expect.stringContaining('SO-20261023') } })
  expect(mocks.online).toHaveBeenCalledWith(bot)
  expect(mocks.message).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
  expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }), expect.objectContaining({ msgid: 'message-1' }))
  expect(mocks.process).toHaveBeenCalledWith(id, event.id)
  expect(mocks.readEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }), event.id, { userid: 'employee-1', chatid: undefined, chattype: 'single' })
})

it('redirects group messages without persisting or processing private shipping data',async()=>{
 const response=await POST(request({action:'message',frame:{msgid:'g1',aibotid:'bot-1',from:{userid:'employee-1'},chattype:'group',chatid:'group',msgtype:'text',text:{content:'查询我的工单'}}}),params)
 expect(await response.json()).toMatchObject({stream:{finish:true,content:expect.stringContaining('单聊')}})
 expect(mocks.enqueue).not.toHaveBeenCalled()
 expect(mocks.process).not.toHaveBeenCalled()
})
it('does not label a diagnostic-only heartbeat as business online',async()=>{
 await POST(request({action:'heartbeat',runtime:{version:'v1',phase:'connected',authenticated:true,business_ready:false}}),params)
 expect(mocks.online).not.toHaveBeenCalled()
})

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  amend: vi.fn(),
}))
vi.mock('@/lib/shipping/collaboration', () => ({ amendShipmentOrder: mocks.amend }))
vi.mock('@/lib/shipping/http', async () => {
  const { NextResponse } = await import('next/server')
  return {
    shippingJson: async (request: Request) => request.json(),
    shippingHandler: async (request: Request, action: (user: { id: string }, orgId: string) => Promise<unknown>) => {
      try {
        return NextResponse.json(await action({ id: 'operator-1' }, 'org-1'))
      } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 })
      }
    },
  }
})

import { POST } from './route'

const input = {
  sender: { name: '寄件人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '寄件路1号' },
  recipient: { name: '收件人', phone: '13900000000', province: '浙江省', city: '杭州市', county: '西湖区', address: '收件路1号' },
  cargo: '合同',
  weight: 1,
  remark: '修改包装',
  source: 'manual',
}

function request(body: unknown): any {
  return new Request('https://example.test/api/shipping/ledger/order-1/amend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/shipping/ledger/[id]/amend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.amend.mockResolvedValue({ id: 'order-1', revision: 2, status: 'awaiting_confirmation' })
  })

  it('validates revision and reason before invoking the amendment command', async () => {
    const response = await POST(request({ expected_revision: 0, input, reason: '' }), {
      params: Promise.resolve({ id: 'order-1' }),
    } as any)
    expect(response.status).toBe(400)
    expect(mocks.amend).not.toHaveBeenCalled()
  })

  it('passes the tenant, actor, expected revision and new payload to the atomic command', async () => {
    const response = await POST(request({
      expected_revision: 1,
      input,
      reason: '客户修改货物与包装',
    }), {
      params: Promise.resolve({ id: 'order-1' }),
    } as any)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'order-1', revision: 2 })
    expect(mocks.amend).toHaveBeenCalledWith({
      orgId: 'org-1',
      userId: 'operator-1',
      orderId: 'order-1',
      expectedRevision: 1,
      input: expect.objectContaining({
        ...input,
        payment: 'sender_monthly',
        servicePreference: 'standard',
      }),
      reason: '客户修改货物与包装',
    })
  })
})

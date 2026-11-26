import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getScopedShipmentLedgerRecord } from '@/lib/shipping/collaboration'
import { ShippingError } from '@/lib/shipping/config'
import { shippingLedgerRead } from '@/lib/shipping/http'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingLedgerRead(req, async ({ orgId, departmentIds, query }) => {
    if (Object.keys(query).length) throw new ShippingError(400, '请核对台账筛选条件。')
    const id = z.guid().transform(value => value.toLowerCase()).parse((await params).id)
    const record = await getScopedShipmentLedgerRecord(orgId, id, departmentIds)
    if (!record) throw new ShippingError(404, '未找到这条收寄台账记录。')
    return { record }
  })
}

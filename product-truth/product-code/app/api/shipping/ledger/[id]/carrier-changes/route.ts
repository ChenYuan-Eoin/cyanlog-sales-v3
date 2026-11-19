import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { shippingHandler } from '@/lib/shipping/http'
import { getLedgerCarrierChange } from '@/lib/shipping/owner-carrier-change'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async (_user, orgId) => getLedgerCarrierChange(orgId, z.string().uuid().parse((await params).id)))
}

import type { NextRequest } from 'next/server'
import { shippingLedgerReturn } from '@/lib/shipping/http'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingLedgerReturn(req, (await params).id)
}

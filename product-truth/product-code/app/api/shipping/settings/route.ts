import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { shippingConfig } from '@/lib/shipping/config'
export const runtime = 'nodejs'
export async function GET(req: NextRequest) { return shippingHandler(req, async () => shippingConfig().publicSettings) }

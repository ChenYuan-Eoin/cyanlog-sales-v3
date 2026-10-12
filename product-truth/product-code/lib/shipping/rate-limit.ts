import { createHmac } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'

export async function enforceAnonymousShippingRate(req: NextRequest, env: Record<string, string | undefined> = process.env) {
  const secret = env.SHIPPING_RECEIPT_SECRET
  if (!secret || secret.length < 32) throw new ShippingError(503, '匿名寄件安全配置尚未完成。')
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown').split(',')[0].trim()
  const bucket = createHmac('sha256', secret).update(`shipping-intake-ip-v2:${ip}`).digest('hex')
  const limit = Math.max(1, Math.min(100, Number(env.SHIPPING_ANONYMOUS_LIMIT || 20)))
  const { data, error } = await supabaseAdmin.rpc('claim_shipping_intake_rate', { p_bucket_hash: bucket, p_now: new Date().toISOString(), p_window_seconds: 600, p_limit: limit })
  if (error) throw new ShippingError(503, '匿名寄件限速服务暂不可用。')
  if (data !== true) throw new ShippingError(429, '提交过于频繁，请稍后再试。')
}

/** Limit verification attempts per authenticated operator, across all queried waybills. */
export async function enforceExternalTrackingRate(orgId: string, userId: string, env: Record<string, string | undefined> = process.env) {
  const secret = env.SHIPPING_RECEIPT_SECRET
  if (!secret || secret.length < 32) throw new ShippingError(503, '查件安全配置尚未完成。')
  const bucket = createHmac('sha256', secret).update(`shipping-external-track-v1:${orgId}:${userId}`).digest('hex')
  const { data, error } = await supabaseAdmin.rpc('claim_shipping_intake_rate', { p_bucket_hash: bucket, p_now: new Date().toISOString(), p_window_seconds: 600, p_limit: 20 })
  if (error) throw new ShippingError(503, '查件校验服务暂不可用，请稍后重试。')
  if (data !== true) throw new ShippingError(429, '外部运单查询过于频繁，请稍后再试。')
}

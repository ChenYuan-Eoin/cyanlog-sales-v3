import type { AplHttpRequest, FxiaokeAplEndpoint } from './contracts'

export const APL_CRM_CLIENT_HEADER = 'x-shipping-crm-client-id'
export const APL_CRM_TIMESTAMP_HEADER = 'x-shipping-crm-timestamp'
export const APL_CRM_SIGNATURE_HEADER = 'x-shipping-crm-signature'

export function crmAplSignaturePayload(timestamp: string, pathname: string, rawBody: string) {
  return `${timestamp}\nPOST\n${pathname}\n${rawBody}`
}

export async function buildAplHttpRequest(args: {
  endpoint: FxiaokeAplEndpoint
  secret: string
  pathname: '/api/shipping/crm/preflight' | '/api/shipping/crm/orders'
  rawBody: string
  retryCount: number
  timestamp: string
  hmacSha256Hex(secret: string, data: string): Promise<string> | string
}): Promise<AplHttpRequest> {
  if (!/^\d{10}$/.test(args.timestamp)) throw new Error('APL timestamp must be Unix seconds')
  const signature = (await args.hmacSha256Hex(
    args.secret,
    crmAplSignaturePayload(args.timestamp, args.pathname, args.rawBody),
  )).trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error('APL HMAC must be lowercase 32-byte hex')
  const base = new URL(args.endpoint.baseUrl)
  const url = new URL(args.pathname, base.origin)
  return {
    method: 'POST',
    url: url.toString(),
    pathname: args.pathname,
    headers: {
      'Content-Type': 'application/json',
      [APL_CRM_CLIENT_HEADER]: args.endpoint.clientId,
      [APL_CRM_TIMESTAMP_HEADER]: args.timestamp,
      [APL_CRM_SIGNATURE_HEADER]: `sha256=${signature}`,
    },
    rawBody: args.rawBody,
    timeoutMs: args.endpoint.timeoutMs,
    retryCount: args.retryCount,
  }
}

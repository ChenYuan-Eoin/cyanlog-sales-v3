import { ShippingError } from './config'
// The redirect domain comes from authenticated agent/get, never from an OAuth
// query parameter. Its DNS/hosting must point to this platform before use.
export function wecomApplicationCallbackUrl(domain: string) {
  if (domain.length > 253 || !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(domain) || /\.(?:local|localhost|internal)$/i.test(domain)) throw new ShippingError(409, '请在企微应用中设置指向本系统的有效网页授权域名。')
  return `https://${domain.toLowerCase()}/api/shipping/public/wecom/callback`
}

import { getServerAuthToken } from '@/lib/server-auth'
import { getAuthUserByToken } from '@/lib/auth'
import { allowedShippingUser, shippingConfig } from '@/lib/shipping/config'
import { lastShippingInput } from '@/lib/shipping/contacts'
import { emptyContact } from '@/lib/shipping/types'
import ShippingWorkspace from './workspace'
export const dynamic = 'force-dynamic'
export default async function ShippingPage() {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  const config = shippingConfig()
  if (!user || !allowedShippingUser(user)) {
    return <ShippingWorkspace userId="guest" settings={{ ...config.publicSettings, guest: true, sender: emptyContact(), monthlyTail: '', ready: false, canSubmit: false, reason: '访客可填写寄件信息；确认寄件和查看私人记录需要授权。' }} />
  }
  let lastShipment, defaultsWarning
  try { lastShipment = await lastShippingInput(user.id, config.connectionKey) } catch { defaultsWarning = '暂未能读取上次寄件信息，可手工填写。' }
  return <ShippingWorkspace settings={{ ...config.publicSettings, lastShipment, defaultsWarning }} userId={user.id} />
}

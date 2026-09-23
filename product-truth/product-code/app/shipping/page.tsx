import { redirect } from 'next/navigation'
import { getServerAuthToken } from '@/lib/server-auth'
import { getAuthUserByToken } from '@/lib/auth'
import { allowedShippingUser, shippingConfig } from '@/lib/shipping/config'
import { requireShippingConnectionManager } from '@/lib/shipping/connection-authorization'
import ShippingWorkbench from './workbench'
export const dynamic = 'force-dynamic'
export default async function ShippingPage() {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  const config = shippingConfig()
  if (!user) redirect('/login')
  const canOperate = allowedShippingUser(user)
  let canManageConnections = false
  try { await requireShippingConnectionManager(user.id); canManageConnections = true } catch { /* ordinary operators may use the workbench without connection controls */ }
  if (!canOperate && !canManageConnections) redirect('/?denied=shipping:operate')
  return <ShippingWorkbench settings={{ ...config.publicSettings, canOperate, canManageConnections }} />
}

import { redirect } from 'next/navigation'
import { getServerAuthToken } from '@/lib/server-auth'
import { getAuthUserByToken } from '@/lib/auth'
import { allowedShippingUser } from '@/lib/shipping/config'
import { requireShippingConnectionManager } from '@/lib/shipping/connection-authorization'
import { getUserShippingSettings } from '@/lib/shipping/runtime-config'
import ShippingWorkbench from './workbench'
export const dynamic = 'force-dynamic'
export default async function ShippingPage() {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  if (!user) redirect('/login')
  const canOperate = allowedShippingUser(user)
  let canManageConnections = false
  try { await requireShippingConnectionManager(user.id); canManageConnections = true } catch { /* ordinary operators may use the workbench without connection controls */ }
  if (!canOperate && !canManageConnections) redirect('/?denied=shipping:operate')
  const { settings } = await getUserShippingSettings(user.id)
  return <ShippingWorkbench settings={{ ...settings, canOperate, canManageConnections }} />
}

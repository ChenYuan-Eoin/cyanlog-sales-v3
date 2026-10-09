import { redirect } from 'next/navigation'
import { getServerAuthToken } from '@/lib/server-auth'
import { getAuthUserByToken } from '@/lib/auth'
import { ShippingError } from '@/lib/shipping/config'
import { requireShippingConnectionManager } from '@/lib/shipping/connection-authorization'
import { requireShippingOperator } from '@/lib/shipping/operator-access'
import { loadShippingWorkspaceSettings } from '@/lib/shipping/workspace-settings'
import ShippingWorkbench from './workbench'
export const dynamic = 'force-dynamic'
export default async function ShippingPage() {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  if (!user) redirect('/login')
  let authorizedOrgId: string | null = null
  try { authorizedOrgId = await requireShippingOperator(user.id) }
  catch (error) { if (!(error instanceof ShippingError && error.status === 403)) throw error }
  let canManageConnections = false
  try { await requireShippingConnectionManager(user.id); canManageConnections = true } catch { /* ordinary operators may use the workbench without connection controls */ }
  if (!authorizedOrgId) {
    if (canManageConnections) redirect('/configs?tab=shipping')
    redirect('/?denied=shipping:operate')
  }
  const settings = await loadShippingWorkspaceSettings(authorizedOrgId)
  return <ShippingWorkbench settings={{ ...settings, canOperate: true, canManageConnections }} />
}

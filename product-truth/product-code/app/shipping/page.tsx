import { redirect } from 'next/navigation'
import { getServerAuthToken } from '@/lib/server-auth'
import { getAuthUserByToken } from '@/lib/auth'
import { ShippingError } from '@/lib/shipping/config'
import { requireShippingConnectionManager } from '@/lib/shipping/connection-authorization'
import { requireShippingOperator } from '@/lib/shipping/operator-access'
import { loadShippingWorkspaceSettings } from '@/lib/shipping/workspace-settings'
import { loadIntakeOptionsForOrg } from '@/lib/shipping/intake-options'
import { loadDefaultShippingSender } from '@/lib/shipping/sender-profile'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { FxiaokeShippingProposal } from '@/app/sales-portal/portal'
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
    const { data: session, error } = await supabaseAdmin.from('auth_tokens')
      .select('user_id,auth_method').eq('token', token).maybeSingle()
    if (error || session?.user_id !== user.id || session.auth_method !== 'fxiaoke') {
      if (canManageConnections) redirect('/configs?tab=shipping')
      redirect('/?denied=shipping:operate')
    }
    const orgId = await getDefaultOrgId(user.id)
    if (!orgId) redirect('/?denied=shipping:operate')
    const [options, sender] = await Promise.all([loadIntakeOptionsForOrg(orgId), loadDefaultShippingSender(orgId)])
    return <div className="h-full overflow-y-auto"><FxiaokeShippingProposal sender={sender} name={user.display_name || ''} phone={user.phone || ''} rules={options.rules} services={options.services}/></div>
  }
  const settings = await loadShippingWorkspaceSettings(authorizedOrgId)
  return <ShippingWorkbench settings={{ ...settings, canOperate: true, canManageConnections }} />
}

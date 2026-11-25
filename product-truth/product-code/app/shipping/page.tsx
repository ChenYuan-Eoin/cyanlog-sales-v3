import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthToken } from '@/lib/server-auth'
import { getAuthUserByToken } from '@/lib/auth'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'
import { loadShippingWorkspaceSettings } from '@/lib/shipping/workspace-settings'
import { loadIntakeOptionsForOrg } from '@/lib/shipping/intake-options'
import { loadFxiaokeShippingProfile } from '@/lib/shipping/department-access'
import { FxiaokeShippingProposal } from '@/app/sales-portal/portal'
import ShippingWorkbench from './workbench'

export const dynamic = 'force-dynamic'

export default async function ShippingPage() {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  if (!user) redirect('/login')

  const access = await resolveShippingEntry(user, token ?? null)
  if (access?.canOperate) {
    const settings = await loadShippingWorkspaceSettings(access.orgId)
    return <ShippingWorkbench settings={{ ...settings, canOperate: true, canManageConnections: access.canManageConnections }} />
  }

  if (access?.canSubmitOwn) {
    const options = await loadIntakeOptionsForOrg(access.orgId)
    const profile = await loadFxiaokeShippingProfile(user, access.orgId, options.rules)
    return (
      <div className="h-full overflow-y-auto">
        {access.canManageConnections && (
          <nav className="mx-auto flex max-w-5xl justify-end px-5 pt-4" aria-label="寄件">
            <Link className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-slate-50" href="/shipping/settings">寄件设置</Link>
          </nav>
        )}
        <FxiaokeShippingProposal profile={profile} rules={options.rules} services={options.services} connectionStatus={options.connectionStatus} />
      </div>
    )
  }

  if (access?.canManageConnections) redirect('/shipping/settings')
  redirect('/?denied=shipping:operate')
}

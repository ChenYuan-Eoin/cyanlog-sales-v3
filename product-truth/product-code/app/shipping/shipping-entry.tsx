import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getServerAuthToken } from '@/lib/server-auth'
import { getAuthUserByToken } from '@/lib/auth'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'
import { loadShippingWorkspaceSettings } from '@/lib/shipping/workspace-settings'
import { loadIntakeOptionsForOrg } from '@/lib/shipping/intake-options'
import { loadFxiaokeShippingProfile } from '@/lib/shipping/department-access'
import { FxiaokeShippingProposal } from '@/app/sales-portal/portal'
import MyWorkorders from '@/app/sales-portal/my-workorders'
import salesPortalStyles from '@/app/sales-portal/sales-portal.module.css'
import DepartmentLedger from './department-ledger'
import ShippingWorkbench from './workbench'

export async function renderShippingEntry(preferOwner = false) {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  if (!user) redirect('/login')

  const access = preferOwner
    ? await resolveShippingEntry(user, token ?? null)
    : await resolveShippingEntry(user, token ?? null, undefined, true)
  if (access?.canOperate && (!preferOwner || !access.canViewOwn)) {
    const settings = await loadShippingWorkspaceSettings(access.orgId)
    return <ShippingWorkbench ledgerDepartments={access.organizationLedgerDepartments}
      settings={{ ...settings, canOperate: true, canViewOwn: access.canViewOwn, canManageConnections: access.canManageConnections, permissions: access.permissions }} />
  }

  if (!preferOwner && access?.departmentLedger?.length) {
    return <DepartmentLedger key={access.orgId} departments={access.departmentLedger}
      canViewOwn={access.canViewOwn} canManageConnections={access.canManageConnections} />
  }

  if (access?.canViewOwn) {
    let content: ReactNode
    if (access.ownerPermissions.some(key => key !== 'shipping:owner_view')) {
      const options = await loadIntakeOptionsForOrg(access.orgId)
      const profile = await loadFxiaokeShippingProfile(user, access.orgId, options.rules)
      content = <FxiaokeShippingProposal profile={profile} rules={options.rules} services={options.services} connectionStatus={options.connectionStatus} ownerPermissions={access.ownerPermissions} />
    } else {
      content = (
        <div className={salesPortalStyles.page}>
          <section className="mx-auto max-w-5xl px-5 py-6" aria-labelledby="owner-shipping-records">
            <h1 id="owner-shipping-records" className="text-xl font-semibold">我的提报记录</h1>
            <p className="mb-4 mt-1 text-sm text-slate-600">当前账号仅可查看本人记录，物流状态来自系统已保存的数据。</p>
            <MyWorkorders scope="owner" readOnly />
          </section>
        </div>
      )
    }
    return (
      <div className="h-full overflow-y-auto">
        {access.canManageConnections && (
          <nav className="mx-auto flex max-w-5xl justify-end px-5 pt-4" aria-label="寄件">
            <Link className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-slate-50" href="/shipping/settings">寄件设置</Link>
          </nav>
        )}
        {content}
      </div>
    )
  }

  if (access?.canManageConnections) redirect('/shipping/settings')
  if (preferOwner && access?.canReadLegacyReceipt) {
    return <main className="p-6"><p>当前账号没有本人寄件权限。</p></main>
  }
  redirect('/?denied=shipping:operate')
}

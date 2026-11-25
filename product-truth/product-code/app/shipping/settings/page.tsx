import { redirect } from 'next/navigation'
import { getAuthUserByToken } from '@/lib/auth'
import { getServerAuthToken } from '@/lib/server-auth'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'
import ShippingConfigDrawer from '../config-drawer'

export const dynamic = 'force-dynamic'

export default async function ShippingSettingsPage() {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  if (!user) redirect('/login')

  const access = await resolveShippingEntry(user, token ?? null)
  if (!access?.canManageConnections) redirect('/?denied=shipping:manage_connections')

  return <ShippingConfigDrawer embedded standaloneReturn={access.canOperate || access.canSubmitOwn ? '/shipping' : '/'} />
}

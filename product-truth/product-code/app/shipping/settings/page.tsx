import { redirect } from 'next/navigation'
import { getAuthUserByToken } from '@/lib/auth'
import { getServerAuthToken } from '@/lib/server-auth'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'

export const dynamic = 'force-dynamic'

export default async function ShippingSettingsPage() {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  if (!user) redirect('/login')

  const access = await resolveShippingEntry(user, token ?? null)
  if (!access?.canManageConnections) redirect('/?denied=shipping:manage_connections')

  redirect('/configs?tab=shipping')
}

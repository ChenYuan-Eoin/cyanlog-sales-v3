import { redirect } from 'next/navigation'
import { getServerAuthToken } from '@/lib/server-auth'
import { getAuthUserByToken } from '@/lib/auth'
import { allowedShippingUser, shippingConfig } from '@/lib/shipping/config'
import ShippingWorkbench from './workbench'
export const dynamic = 'force-dynamic'
export default async function ShippingPage() {
  const token = await getServerAuthToken()
  const user = token ? await getAuthUserByToken(token) : null
  const config = shippingConfig()
  if (!user) redirect('/login')
  if (!allowedShippingUser(user)) redirect('/?denied=shipping:operate')
  return <ShippingWorkbench settings={config.publicSettings} />
}

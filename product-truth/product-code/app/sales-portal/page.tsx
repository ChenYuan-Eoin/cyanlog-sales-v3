import { shippingConfig } from '@/lib/shipping/config'
import SalesPortal from './portal'

export const dynamic = 'force-dynamic'

export default function SalesPortalPage() {
  const settings = shippingConfig().publicSettings
  return <SalesPortal services={settings.services} />
}

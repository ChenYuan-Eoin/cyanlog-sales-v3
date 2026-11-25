import { renderShippingEntry } from '@/app/shipping/shipping-entry'
import { AuthenticatedReceiptRoute } from './portal'

export const dynamic = 'force-dynamic'

export default async function SalesPortalPage() {
  return <AuthenticatedReceiptRoute>{await renderShippingEntry(true)}</AuthenticatedReceiptRoute>
}

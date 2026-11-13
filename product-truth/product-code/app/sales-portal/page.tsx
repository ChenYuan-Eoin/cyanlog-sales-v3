import ShippingPage from '@/app/shipping/page'
import { AuthenticatedReceiptRoute } from './portal'

export const dynamic = 'force-dynamic'

export default async function SalesPortalPage() {
  return <AuthenticatedReceiptRoute>{await ShippingPage()}</AuthenticatedReceiptRoute>
}

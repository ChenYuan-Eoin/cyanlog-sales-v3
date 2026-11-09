import { loadPublicIntakeOptions } from '@/lib/shipping/intake-options'
import SalesPortal from './portal'
import styles from './sales-portal.module.css'

export const dynamic = 'force-dynamic'

export default async function SalesPortalPage() {
  try {
    const options = await loadPublicIntakeOptions()
    return <SalesPortal initialEmployee={null} initialOptions={{ services: options.services, rules: options.rules, companySender: options.companySender, requireVerification: options.requireVerification, emailAvailable: false }}/>
  } catch {
    return <main className={styles.page}><section className={styles.card}><h1>寄件设置暂不可用</h1><p>请稍后重试，或联系管理员检查寄件设置。</p></section></main>
  }
}

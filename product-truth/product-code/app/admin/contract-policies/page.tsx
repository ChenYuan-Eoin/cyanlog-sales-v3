import { redirect } from 'next/navigation'

/**
 * There is one rule control plane. The former admin landing interpreted the
 * canonical rows as legacy A/B/C thresholds and therefore showed a second,
 * contradictory product model. Keep old bookmarks working without rendering
 * that obsolete UI.
 */
export default function ContractPoliciesPage() {
  redirect('/configs?tab=rules')
}

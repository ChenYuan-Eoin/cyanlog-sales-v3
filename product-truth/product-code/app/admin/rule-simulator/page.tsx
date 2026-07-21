import { redirect } from 'next/navigation'

/**
 * The former simulator reduced results to legacy Level A/B/C labels and could
 * be mistaken for release evidence. Rule authors now test each saved canonical
 * rule snapshot from the RuleSet workspace, where assertions are persisted and
 * counted by the publish gate.
 */
export default function RuleSimulatorPage() {
  redirect('/configs?tab=rules')
}

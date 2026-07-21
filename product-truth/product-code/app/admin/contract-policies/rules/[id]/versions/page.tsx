import { redirect } from 'next/navigation'

/**
 * Version history is part of the RuleSet workspace. The former page exposed a
 * raw JSON snapshot and linked to a second editor, so old bookmarks now resolve
 * to the selected rule in the canonical control plane.
 */
export default async function RuleVersionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/configs?tab=rules&ruleId=${encodeURIComponent(id)}`)
}

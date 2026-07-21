import { redirect } from 'next/navigation'

interface LegacyUploadPageProps {
  searchParams: Promise<{
    intent?: string | string[]
    contractId?: string | string[]
  }>
}

/**
 * The old route combined batch review, source upload and comparison upload in
 * one screen. Keep the URL as a compatibility redirect, but send people to a
 * single business task instead of maintaining a second upload workflow.
 */
export default async function LegacyContractUploadPage({
  searchParams,
}: LegacyUploadPageProps) {
  const params = await searchParams
  const intent = Array.isArray(params.intent) ? params.intent[0] : params.intent
  const contractId = Array.isArray(params.contractId)
    ? params.contractId[0]
    : params.contractId

  if (intent === 'compare') {
    const query = new URLSearchParams({ task: 'compare' })
    if (contractId) query.set('contractId', contractId)
    redirect(`/contracts?${query.toString()}`)
  }

  redirect('/contracts/new')
}

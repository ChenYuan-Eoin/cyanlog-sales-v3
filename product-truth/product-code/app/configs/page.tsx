import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { hasConfigsTabAccess, readConfigsTabAccess } from '@/lib/configs/tab-access'
import ConfigsClient from './ConfigsClient'

type ConfigsPageProps = {
  searchParams?: Promise<{
    tab?: string | string[]
    ruleId?: string | string[]
    mode?: string | string[]
  }>
}

export default async function ConfigsPage({ searchParams }: ConfigsPageProps) {
  const [resolvedSearchParams, requestHeaders] = await Promise.all([searchParams, headers()])
  const tabAccess = readConfigsTabAccess(requestHeaders)
  if (!hasConfigsTabAccess(tabAccess)) redirect('/')

  return (
    <ConfigsClient
      tabAccess={tabAccess}
      routeState={{
        tab: resolvedSearchParams?.tab,
        ruleId: resolvedSearchParams?.ruleId,
        mode: resolvedSearchParams?.mode,
      }}
    />
  )
}

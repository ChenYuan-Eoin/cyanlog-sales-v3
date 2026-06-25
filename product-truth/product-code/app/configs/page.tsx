// configs/page.tsx - Server Component Shell
// 静态渲染骨架，TTFB < 200ms；数据在客户端按需加载

import ConfigsClient from './ConfigsClient'

type ConfigsPageProps = {
  searchParams?: Promise<{
    tab?: string | string[]
    ruleId?: string | string[]
    mode?: string | string[]
  }>
}

export default async function ConfigsPage({ searchParams }: ConfigsPageProps) {
  const resolvedSearchParams = await searchParams

  return (
    <ConfigsClient
      routeState={{
        tab: resolvedSearchParams?.tab,
        ruleId: resolvedSearchParams?.ruleId,
        mode: resolvedSearchParams?.mode,
      }}
    />
  )
}

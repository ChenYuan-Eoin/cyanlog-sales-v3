// configs/page.tsx - Server Component Shell
// 静态渲染骨架，TTFB < 200ms；数据在客户端按需加载

import ConfigsClient from './ConfigsClient'

type ConfigsPageProps = {
  searchParams?: {
    tab?: string | string[]
    ruleId?: string | string[]
    mode?: string | string[]
  }
}

export default function ConfigsPage({ searchParams }: ConfigsPageProps) {
  return (
    <ConfigsClient
      routeState={{
        tab: searchParams?.tab,
        ruleId: searchParams?.ruleId,
        mode: searchParams?.mode,
      }}
    />
  )
}

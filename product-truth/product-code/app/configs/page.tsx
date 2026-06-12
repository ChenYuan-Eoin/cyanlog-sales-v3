// configs/page.tsx - Server Component Shell
// 服务端预取数据，流式传输到客户端

import { Suspense } from 'react'
import { getServerAuthToken } from '@/lib/server-auth'
import { getOrgIdForToken } from '@/lib/configs/runtime'
import { fetchAllConfigsData } from './data'
import ConfigsClient from './ConfigsClient'
import { Card, CardContent } from '@/components/ui/card'

// 骨架屏
function ConfigsSkeleton() {
  return (
    <div className="container mx-auto py-8 px-4 space-y-4">
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-96 bg-slate-200 rounded animate-pulse" />
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mb-2" />
              <div className="h-4 w-32 bg-slate-200 rounded animate-pulse mb-2" />
              <div className="h-8 w-20 bg-slate-200 rounded animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// Server Component - 立即渲染，数据流式到达
export default async function ConfigsPage() {
  const token = getServerAuthToken()
  const orgId = await getOrgIdForToken(token)

  // 立即开始加载数据（不阻塞首屏 HTML）
  const dataPromise = fetchAllConfigsData(orgId || '')

  return (
    <Suspense fallback={<ConfigsSkeleton />}>
      <ConfigsContent orgId={orgId || ''} dataPromise={dataPromise} />
    </Suspense>
  )
}

// 数据到达后渲染
async function ConfigsContent({ orgId, dataPromise }: { orgId: string; dataPromise: ReturnType<typeof fetchAllConfigsData> }) {
  const data = await dataPromise
  return <ConfigsClient initialData={data} orgId={orgId} />
}

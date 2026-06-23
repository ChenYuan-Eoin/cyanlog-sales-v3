import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabaseAdmin } from '@/lib/supabase'
import { getOrgIdForUser, getUserIdForToken } from '@/lib/configs/runtime'
import { resolveRouteParams } from '@/lib/route-params'
import { listAccessibleSalesSpaces, normalizeSalesSpaceName } from '@/lib/scoped-access'
import { getServerAuthToken } from '@/lib/server-auth'

interface PageProps {
  params: Promise<{ id: string }> | { id: string }
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  LEAD: { label: '线索', variant: 'secondary' },
  QUALIFIED: { label: '已验证', variant: 'outline' },
  QUOTING: { label: '报价中', variant: 'default' },
  CONTRACTING: { label: '合同中', variant: 'default' },
  WON: { label: '已签约', variant: 'outline' },
  LOST: { label: '已失败', variant: 'destructive' },
}

const priorityMap: Record<string, { label: string; className: string }> = {
  CRITICAL: { label: '紧急', className: 'bg-red-100 text-red-700' },
  HIGH: { label: '高优', className: 'bg-amber-100 text-amber-700' },
  NORMAL: { label: '常规', className: 'bg-slate-100 text-slate-700' },
  LOW: { label: '低优', className: 'bg-slate-100 text-slate-600' },
}

export const dynamic = 'force-dynamic'

export default async function OpportunityDetailPage({ params }: PageProps) {
  const { id } = await resolveRouteParams(params)
  const token = getServerAuthToken()

  if (!token) {
    redirect('/login')
  }

  const userId = await getUserIdForToken(token)
  if (!userId) {
    redirect('/login')
  }

  const orgId = await getOrgIdForUser(userId)
  if (!orgId) {
    notFound()
  }

  const { spaces } = await listAccessibleSalesSpaces(userId, orgId)
  const spaceIds = spaces.map((space) => space.id)
  if (spaceIds.length === 0) {
    notFound()
  }

  const { data: opportunity, error } = await supabaseAdmin
    .from('opportunities')
    .select(`
      id,
      name,
      amount,
      status,
      stage,
      probability,
      expected_close_date,
      customer:customers(id, name, short_name, contact_name, contact_phone, industry, region),
      space:sales_spaces(id, name)
    `)
    .eq('id', id)
    .eq('org_id', orgId)
    .in('space_id', spaceIds)
    .maybeSingle()

  if (error || !opportunity) {
    notFound()
  }

  const { data: milestones, error: milestoneError } = await supabaseAdmin
    .from('milestones')
    .select('id, name, type, status, priority, due_date')
    .eq('opportunity_id', id)
    .order('due_date', { ascending: true })

  if (milestoneError) {
    console.error('Load opportunity milestones error:', milestoneError)
  }

  const customer = Array.isArray(opportunity.customer) ? opportunity.customer[0] : opportunity.customer
  const space = Array.isArray(opportunity.space) ? opportunity.space[0] : opportunity.space
  const statusMeta = statusMap[opportunity.status] || { label: opportunity.status, variant: 'secondary' as const }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500 mb-2">
            <Link href="/" className="hover:underline">工作台</Link>
            <span className="mx-2">/</span>
            <span>机会详情</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">{opportunity.name}</h1>
            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
          </div>
          <p className="text-sm text-slate-500 mt-2">
            {normalizeSalesSpaceName(space?.name) || '未分配空间'} · {opportunity.stage || '待补充阶段'}
          </p>
        </div>

        <div className="flex gap-2">
          <Link href="/quotes">
            <Button variant="outline">打开报价中心</Button>
          </Link>
          <Link href="/contracts">
            <Button variant="outline">打开合同中心</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">机会概览</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Field label="预计金额" value={`¥${Number(opportunity.amount || 0).toLocaleString('zh-CN')}`} />
            <Field label="赢单概率" value={`${opportunity.probability || 0}%`} />
            <Field label="预计关闭" value={opportunity.expected_close_date || '未设定'} />
            <Field label="当前阶段" value={opportunity.stage || '未设定'} />
            <Field label="客户简称" value={customer?.short_name || customer?.name || '未关联'} />
            <Field label="所属区域" value={customer?.region || '未设定'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">客户信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="客户名称" value={customer?.name || '未关联'} />
            <Field label="联系人" value={customer?.contact_name || '未登记'} />
            <Field label="联系电话" value={customer?.contact_phone || '未登记'} />
            <Field label="行业" value={customer?.industry || '未登记'} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">关键节点</CardTitle>
        </CardHeader>
        <CardContent>
          {!milestones || milestones.length === 0 ? (
            <p className="text-sm text-slate-500">当前机会还没有节点计划。</p>
          ) : (
            <div className="space-y-3">
              {milestones.map((milestone) => {
                const priority = priorityMap[milestone.priority] || priorityMap.NORMAL
                return (
                  <div key={milestone.id} className="flex flex-col gap-2 rounded-lg border px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-medium text-slate-900">{milestone.name}</div>
                      <div className="text-sm text-slate-500">
                        {milestone.type} · {milestone.status}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs ${priority.className}`}>
                        {priority.label}
                      </span>
                      <span className="text-sm text-slate-600">
                        {milestone.due_date ? new Date(milestone.due_date).toLocaleString('zh-CN') : '未设定时间'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{value}</div>
    </div>
  )
}

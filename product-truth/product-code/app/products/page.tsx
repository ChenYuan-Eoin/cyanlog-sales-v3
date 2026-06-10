// F001 价盘管理 - 产品目录
// 路径：/products

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getOrgIdForToken } from '@/lib/configs/runtime'
import { isSchemaDriftError } from '@/lib/db-compat'
import { getServerAuthToken } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const token = getServerAuthToken()
  const orgId = await getOrgIdForToken(token)

  interface ProductRecord {
    id: string
    code: string
    name: string
    status: 'active' | 'inactive' | 'discontinued'
    specification?: string
    unit?: string
    base_price?: number
    tier_pricing_enabled?: boolean
    product_price_tiers?: Array<{ qty_from: number; qty_to: number | null; unit_price: number }>
    product_categories?: { name: string }
  }

  let migrationRequired = false
  let products: ProductRecord[] = []

  if (orgId) {
    const result = await supabaseAdmin
      .from('products')
      .select('*, product_categories(name), product_price_tiers(*)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (result.error && isSchemaDriftError(result.error)) {
      migrationRequired = true
      const legacyResult = await supabaseAdmin
        .from('products')
        .select('*, product_categories(name)')
        .order('created_at', { ascending: false })
        .limit(100)

      products = ((legacyResult.data || []) as ProductRecord[]).map((product) => ({
        ...product,
        tier_pricing_enabled: false,
        product_price_tiers: [],
      }))
    } else {
      products = (result.data || []) as ProductRecord[]
    }
  }

  // 统计
  const activeCount = products.filter((p) => p.status === 'active').length
  const inactiveCount = products.filter((p) => p.status === 'inactive').length
  const discontinuedCount = products.filter((p) => p.status === 'discontinued').length

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* 页头 */}
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">产品目录</h1>
          <p className="text-sm text-slate-500">此页面已迁入配置中心的“价盘与阶梯价”，这里保留只读入口。</p>
        </div>
        <Link href="/configs?tab=price-list">
          <Button>前往配置中心</Button>
        </Link>
      </div>

      <Card className="mb-6 border-amber-200 bg-amber-50">
        <CardContent className="flex items-center justify-between gap-4 py-4 text-sm text-amber-900">
          <div>
            SKU、基础价、最低价和阶梯价已统一收口到配置中心维护，报价中心会只读消费已发布版本。
          </div>
          <Link href="/configs?tab=price-list">
            <Button variant="outline">打开价盘与阶梯价</Button>
          </Link>
        </CardContent>
      </Card>

      {migrationRequired && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-700">
            生产数据库尚未升级阶梯价结构。当前页面以兼容模式展示基础 SKU 信息，阶梯价维护与自动算价尚未在线生效。
          </CardContent>
        </Card>
      )}

      {/* 统计卡 */}
      {products.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="总产品数" value={products.length} color="slate" />
          <StatCard label="在售" value={activeCount} color="green" />
          <StatCard label="停售" value={inactiveCount} color="amber" />
          <StatCard label="停产" value={discontinuedCount} color="red" />
        </div>
      )}

      {/* 列表 */}
      {products.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="text-4xl mb-4">📦</div>
            <p className="text-slate-700 font-medium mb-2">还没有产品</p>
            <p className="text-sm text-slate-500 mb-4">
              添加第一份产品，为报价提供基础价和规格
            </p>
            <Link href="/configs?tab=price-list">
              <Button>前往配置中心维护</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">编码</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">名称</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">分类</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">规格</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">单位</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">基础价</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">阶梯价</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">状态</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-mono text-slate-900">{p.code}</td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">{p.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {p.product_categories?.name || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{p.specification || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{p.unit || '—'}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono text-slate-900">
                    ¥{p.base_price?.toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {p.tier_pricing_enabled && p.product_price_tiers && p.product_price_tiers.length > 0
                      ? p.product_price_tiers
                        .slice(0, 2)
                        .map((tier) => `${tier.qty_from}${tier.qty_to ? `-${tier.qty_to}` : '+'}: ¥${tier.unit_price.toLocaleString('zh-CN')}`)
                        .join(' / ')
                      : '基础价'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/products/${p.id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    slate: 'border-slate-200 bg-white text-slate-900',
    green: 'border-green-200 bg-green-50 text-green-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
  }
  return (
    <div className={`rounded-lg border p-4 ${colorMap[color]}`}>
      <div className="text-xs opacity-70 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active: { label: '在售', className: 'bg-green-100 text-green-700' },
    inactive: { label: '停售', className: 'bg-amber-100 text-amber-700' },
    discontinued: { label: '停产', className: 'bg-red-100 text-red-700' },
  }
  const config = map[status] || { label: status, className: 'bg-slate-100 text-slate-700' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${config.className}`}>{config.label}</span>
  )
}

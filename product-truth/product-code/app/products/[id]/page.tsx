// F001 价盘管理 - 产品详情
// 路径：/products/[id]

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getOrgIdForToken } from '@/lib/configs/runtime'
import { resolveRouteParams } from '@/lib/route-params'
import { isSchemaDriftError } from '@/lib/db-compat'
import { getServerAuthToken } from '@/lib/server-auth'

interface PageProps {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await resolveRouteParams(params)
  const token = await getServerAuthToken()
  const orgId = await getOrgIdForToken(token)
  if (!orgId) {
    notFound()
  }

  const productResult = await supabaseAdmin
    .from('products')
    .select('*, product_categories(name), product_price_tiers(*)')
    .eq('id', id)
    .eq('org_id', orgId)
    .single()

  let product = productResult.data
  let productError = productResult.error

  if (productError && isSchemaDriftError(productError)) {
    const legacyResult = await supabaseAdmin
      .from('products')
      .select('*, product_categories(name)')
      .eq('id', id)
      .single()

    product = legacyResult.data ? {
        ...legacyResult.data,
        tier_pricing_enabled: false,
        product_price_tiers: [],
        _migration_required: true,
      } : null
    productError = legacyResult.error
  }

  if (productError || !product) {
    notFound()
  }

  const migrationRequired = Boolean((product as { _migration_required?: boolean })._migration_required)

  // 读取最近使用此产品的报价
  const { data: recentQuotes } = await supabaseAdmin
    .from('quote_items')
    .select('id, quote_id, quantity, unit_price, quotes!inner(quote_no, customer_name, status)')
    .eq('product_id', id)
    .order('created_at', { ascending: false })
    .limit(10)

  interface QuoteItem {
    id: string
    quote_id: string
    quantity: number
    unit_price: number
    quotes?: {
      quote_no: string
      customer_name: string
      status: string
    }
  }

  // 归一化 quotes 字段为单数（Supabase 可能返回数组或对象）
  interface RawQuoteItem {
    id: string
    quote_id: string
    quantity: number
    unit_price: number
    quotes: { quote_no: string; customer_name: string; status: string } | { quote_no: string; customer_name: string; status: string }[] | null
  }
  const quoteItems: QuoteItem[] = ((recentQuotes || []) as RawQuoteItem[]).map((q) => ({
    ...q,
    quotes: Array.isArray(q.quotes) ? q.quotes[0] : q.quotes ?? undefined,
  }))

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      {/* 页头 */}
      <div className="mb-6">
        <Link href="/products" className="text-sm text-slate-500 hover:text-slate-700">
          ← 返回产品目录
        </Link>
        <div className="flex items-baseline justify-between mt-2">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">{product.name}</h1>
            <p className="text-sm text-slate-500 mt-1 font-mono">{product.code}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/products">
              <Button variant="outline">返回列表</Button>
            </Link>
          </div>
        </div>
      </div>

      {migrationRequired && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-700">
            当前生产数据库尚未升级阶梯价结构，本页以兼容模式展示基础 SKU 信息。阶梯价维护与自动算价仍需先执行 migration。
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 基本信息 */}
        <div className="lg:col-span-2 space-y-6">
          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">基本信息</h2>
            <Card>
              <CardContent className="py-5">
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <Field label="产品名称" value={product.name} />
                  <Field label="产品编码" value={product.code} mono />
                  <Field label="产品分类" value={product.product_categories?.name} />
                  <Field label="规格" value={product.specification} />
                  <Field label="单位" value={product.unit} />
                  <Field label="状态" value={
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      product.status === 'active' ? 'bg-green-100 text-green-700' :
                      product.status === 'inactive' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {product.status === 'active' ? '在售' : product.status === 'inactive' ? '停售' : '停产'}
                    </span>
                  } />
                </dl>
              </CardContent>
            </Card>
          </section>

          {/* 价格信息 */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">价格信息</h2>
            <Card>
              <CardContent className="py-5">
                <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                  <Field
                    label="基础价"
                    value={`¥${product.base_price?.toLocaleString('zh-CN') || '0'}`}
                    mono
                  />
                  <Field
                    label="成本价"
                    value={product.cost_price ? `¥${product.cost_price.toLocaleString('zh-CN')}` : '—'}
                    mono
                  />
                  <Field
                    label="最低售价"
                    value={product.min_price ? `¥${product.min_price.toLocaleString('zh-CN')}` : '—'}
                    mono
                  />
                </dl>
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">阶梯价</h2>
            <Card>
              <CardContent className="py-5">
                {product.tier_pricing_enabled && product.product_price_tiers?.length > 0 ? (
                  <div className="space-y-2 text-sm">
                    {product.product_price_tiers.map((tier: { id: string; qty_from: number; qty_to: number | null; unit_price: number }) => (
                      <div key={tier.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="font-mono text-slate-600">
                          {tier.qty_to === null ? `${tier.qty_from}+` : `${tier.qty_from}-${tier.qty_to}`}
                        </span>
                        <span className="font-mono text-slate-900">¥{tier.unit_price.toLocaleString('zh-CN')}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">未启用阶梯价，当前使用基础价。</p>
                )}
              </CardContent>
            </Card>
          </section>

          {/* 最近使用记录 */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">最近使用记录</h2>
            <Card>
              <CardContent className="py-0">
                {quoteItems.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="border-b text-slate-500">
                      <tr>
                        <th className="text-left py-2 px-2">报价单号</th>
                        <th className="text-left py-2 px-2">客户</th>
                        <th className="text-right py-2 px-2">数量</th>
                        <th className="text-right py-2 px-2">单价</th>
                        <th className="text-center py-2 px-2">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {quoteItems.map((q) => (
                        <tr key={q.id}>
                          <td className="py-2 px-2 font-mono text-xs">
                            <Link href={`/quotes/${q.quote_id}`} className="text-blue-600 hover:underline">
                              {q.quotes?.quote_no}
                            </Link>
                          </td>
                          <td className="py-2 px-2">{q.quotes?.customer_name}</td>
                          <td className="py-2 px-2 text-right">{q.quantity}</td>
                          <td className="py-2 px-2 text-right font-mono">
                            ¥{q.unit_price?.toLocaleString('zh-CN')}
                          </td>
                          <td className="py-2 px-2 text-center text-xs text-slate-500">
                            {q.quotes?.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="py-6 text-center text-slate-500 text-sm">还没有报价使用此产品</p>
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        {/* 元信息 */}
        <div>
          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">元信息</h2>
            <Card>
              <CardContent className="py-5">
                <dl className="space-y-3 text-sm">
                  <Field
                    label="创建时间"
                    value={product.created_at ? new Date(product.created_at).toLocaleString('zh-CN') : '—'}
                  />
                  <Field
                    label="更新时间"
                    value={product.updated_at ? new Date(product.updated_at).toLocaleString('zh-CN') : '—'}
                  />
                  <Field label="ID" value={product.id} mono />
                </dl>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 mb-1">{label}</dt>
      <dd className={`text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  )
}

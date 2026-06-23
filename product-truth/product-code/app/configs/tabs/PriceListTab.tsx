'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ProductRecord } from '../types'

interface ProductPriceTier {
  id?: string
  qty_from: number
  qty_to: number | null
  unit_price: number
}

interface PriceListTabProps {
  products: ProductRecord[]
  onNew: () => void
  onEdit: (product: ProductRecord) => void
  onDelete: (id: string) => void
}

export default function PriceListTab({ products, onNew, onEdit, onDelete }: PriceListTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>价盘与阶梯价</CardTitle>
          <p className="text-sm text-slate-500 mt-1">
            配置中心拥有 SKU、基础价、最低价和阶梯价；报价中心只读消费。
          </p>
        </div>
        <Button onClick={onNew}>+ 新增 SKU</Button>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-slate-500">暂无 SKU</p>
            <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条价盘记录</p>
          </div>
        ) : (
          <div className="space-y-4">
            {products.map((product) => (
              <div key={product.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{product.name}</span>
                        <Badge variant="outline" className="font-mono">{product.code}</Badge>
                        <Badge className={
                          product.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : product.status === 'inactive'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-200 text-slate-700'
                        }>
                          {product.status === 'active' ? '在售' : product.status === 'inactive' ? '停售' : '停产'}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[product.specification, product.unit, product.product_categories?.name].filter(Boolean).join(' · ') || '未设置规格'}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                      <span>基础价 ¥{Number(product.base_price || 0).toLocaleString()}</span>
                      <span>最低价 ¥{Number(product.min_price || 0).toLocaleString()}</span>
                      <span>{product.tier_pricing_enabled ? '已启用阶梯价' : '仅基础价'}</span>
                    </div>

                    {product.product_price_tiers && product.product_price_tiers.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {product.product_price_tiers.map((tier: ProductPriceTier, index: number) => (
                          <div key={tier.id || index} className="rounded-md border px-2 py-1 text-xs text-slate-700">
                            {tier.qty_to === null ? `${tier.qty_from}+` : `${tier.qty_from}-${tier.qty_to}`} · ¥{tier.unit_price.toLocaleString()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => onEdit(product)}>编辑</Button>
                    <Button variant="outline" size="sm" className="text-red-600" onClick={() => onDelete(product.id)}>删除</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

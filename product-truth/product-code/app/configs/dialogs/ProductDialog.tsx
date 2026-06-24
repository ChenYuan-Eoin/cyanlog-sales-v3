'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ProductRecord, ProductPriceTier } from '../types'

interface ProductDialogProps {
  product: Partial<ProductRecord> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (product: Partial<ProductRecord>) => void
  onLoadTiers?: (productId: string) => Promise<ProductPriceTier[]>
}

export default function ProductDialog({
  product,
  open,
  onOpenChange,
  onSave,
  onLoadTiers,
}: ProductDialogProps) {
  const [editingProduct, setEditingProduct] = useState<Partial<ProductRecord>>({})
  const [tiersLoading, setTiersLoading] = useState(false)
  const onLoadTiersRef = useRef(onLoadTiers)

  // 保持 ref 同步
  useEffect(() => {
    onLoadTiersRef.current = onLoadTiers
  }, [onLoadTiers])

  // 使用 ref 避免依赖循环
  const loadTiers = useCallback(async (productId: string) => {
    if (!onLoadTiersRef.current) return
    setTiersLoading(true)
    try {
      const tiers = await onLoadTiersRef.current(productId)
      setEditingProduct((prev) => ({
        ...prev,
        product_price_tiers: tiers.sort(
          (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
        ),
      }))
    } catch {
      // 忽略加载失败
    } finally {
      setTiersLoading(false)
    }
  }, [])

  // 初始化表单数据
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (product) {
      setEditingProduct({
        ...product,
        product_price_tiers: product.product_price_tiers || [],
      })

      // 如果是编辑现有产品，按需加载阶梯价
      if (product.id && onLoadTiersRef.current && !product.product_price_tiers?.length) {
        loadTiers(product.id)
      }
    }
  }, [product?.id, open, loadTiers, product])

  const tiers = editingProduct.product_price_tiers || []

  const updateTier = (index: number, patch: Partial<ProductPriceTier>) => {
    const nextTiers = [...tiers]
    nextTiers[index] = { ...nextTiers[index], ...patch }
    setEditingProduct({ ...editingProduct, product_price_tiers: nextTiers })
  }

  const handleSave = () => {
    onSave(editingProduct)
  }

  if (!product) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingProduct.id ? '编辑 SKU' : '新建 SKU'}</DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">SKU 编码</label>
              <Input
                value={editingProduct.code || ''}
                onChange={(e) => setEditingProduct({ ...editingProduct, code: e.target.value })}
                placeholder="如: PROD-001"
              />
            </div>
            <div>
              <label className="text-sm font-medium">SKU 名称</label>
              <Input
                value={editingProduct.name || ''}
                onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                placeholder="如: 智能合同审核系统"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">规格</label>
              <Input
                value={editingProduct.specification || ''}
                onChange={(e) => setEditingProduct({ ...editingProduct, specification: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">单位</label>
              <Input
                value={editingProduct.unit || ''}
                onChange={(e) => setEditingProduct({ ...editingProduct, unit: e.target.value })}
                placeholder="套 / 个 / 月"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">基础价</label>
              <Input
                type="number"
                min={0}
                value={Number(editingProduct.base_price || 0)}
                onChange={(e) => setEditingProduct({ ...editingProduct, base_price: Number(e.target.value || 0) })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">成本价</label>
              <Input
                type="number"
                min={0}
                value={Number(editingProduct.cost_price || 0)}
                onChange={(e) => setEditingProduct({ ...editingProduct, cost_price: Number(e.target.value || 0) })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">最低保护价</label>
              <Input
                type="number"
                min={0}
                value={Number(editingProduct.min_price || 0)}
                onChange={(e) => setEditingProduct({ ...editingProduct, min_price: Number(e.target.value || 0) })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">状态</label>
              <select
                className="w-full mt-1 p-2 border rounded-md"
                value={editingProduct.status || 'active'}
                onChange={(e) => setEditingProduct({ ...editingProduct, status: e.target.value as ProductRecord['status'] })}
              >
                <option value="active">在售</option>
                <option value="inactive">停售</option>
                <option value="discontinued">停产</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(editingProduct.tier_pricing_enabled)}
                  onChange={(e) => setEditingProduct({ ...editingProduct, tier_pricing_enabled: e.target.checked })}
                />
                <span>启用阶梯价</span>
              </label>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">阶梯价</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setEditingProduct({
                    ...editingProduct,
                    tier_pricing_enabled: true,
                    product_price_tiers: [
                      ...tiers,
                      {
                        qty_from: 1,
                        qty_to: null,
                        unit_price: Number(editingProduct.base_price || 0),
                        sort_order: tiers.length,
                      },
                    ],
                  })
                }
              >
                + 添加阶梯
              </Button>
            </div>

            {tiersLoading ? (
              <div className="rounded-md border border-dashed px-3 py-4 text-sm text-slate-500">
                加载阶梯价...
              </div>
            ) : (
              <div className="space-y-2">
                {tiers.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-slate-500">
                    未配置阶梯价，将使用基础价。
                  </div>
                ) : (
                  tiers.map((tier, index) => (
                    <div
                      key={tier.id || index}
                      className="grid grid-cols-[1fr_1fr_1fr_72px] gap-2 rounded-md bg-slate-50 p-3"
                    >
                      <Input
                        type="number"
                        min={1}
                        value={tier.qty_from}
                        onChange={(e) => updateTier(index, { qty_from: Number(e.target.value || 1) })}
                      />
                      <Input
                        type="number"
                        min={2}
                        value={tier.qty_to ?? ''}
                        onChange={(e) => updateTier(index, { qty_to: e.target.value ? Number(e.target.value) : null })}
                        placeholder="留空=无上限"
                      />
                      <Input
                        type="number"
                        min={0}
                        value={tier.unit_price}
                        onChange={(e) => updateTier(index, { unit_price: Number(e.target.value || 0) })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditingProduct({
                            ...editingProduct,
                            product_price_tiers: tiers.filter((_, tierIndex) => tierIndex !== index),
                          })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

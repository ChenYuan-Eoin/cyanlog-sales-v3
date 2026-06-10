// F001 价盘管理 - 新增产品
// 路径：/products/new

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function NewProductPage() {
  // 读取产品分类下拉框
  const { data: categories } = await supabaseAdmin
    .from('product_categories')
    .select('id, name')
    .order('name')

  interface Category {
    id: string
    name: string
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      {/* 页头 */}
      <div className="mb-6">
        <Link href="/products" className="text-sm text-slate-500 hover:text-slate-700">
          ← 返回产品目录
        </Link>
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mt-2">新增产品</h1>
        <p className="text-sm text-slate-500 mt-1">添加产品到价盘，为报价提供基础价和规格</p>
      </div>

      <Card>
        <CardContent className="py-6">
          <form action="/api/products" method="POST" className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="产品编码 *" name="code" required placeholder="PROD-001" />
              <FormField label="产品名称 *" name="name" required placeholder="智能合同审核系统" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block text-slate-700">产品分类</label>
                <select
                  name="category_id"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                >
                  <option value="">未选择</option>
                  {(categories || []).map((c: Category) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <FormField label="单位" name="unit" placeholder="套 / 个 / 月" />
            </div>

            <FormField label="规格说明" name="specification" placeholder="如：标准版 / 企业版" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="基础价 (¥) *" name="base_price" type="number" required defaultValue="0" />
              <FormField label="成本价 (¥)" name="cost_price" type="number" />
              <FormField label="最低售价 (¥)" name="min_price" type="number" />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block text-slate-700">状态</label>
              <select
                name="status"
                defaultValue="active"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
              >
                <option value="active">在售</option>
                <option value="inactive">停售</option>
                <option value="discontinued">停产</option>
              </select>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button type="submit">创建产品</Button>
              <Link href="/products">
                <Button type="button" variant="outline">取消</Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function FormField({
  label,
  name,
  type = 'text',
  required = false,
  placeholder,
  defaultValue,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  placeholder?: string
  defaultValue?: string
}) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block text-slate-700">{label}</label>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
      />
    </div>
  )
}

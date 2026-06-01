'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

interface Product {
  id: string
  name: string
  code: string
  base_price: number
  status: string
  product_categories?: { name: string }
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProducts()
  }, [])

  async function fetchProducts() {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/products', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (res.ok) {
        const data = await res.json()
        setProducts(data || [])
      }
    } catch (error) {
      console.error('获取产品失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
    active: { label: '在售', variant: 'outline' },
    inactive: { label: '停售', variant: 'secondary' },
    discontinued: { label: '停产', variant: 'destructive' },
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">产品目录</h1>
        <Button>+ 新增产品</Button>
      </div>

      {loading ? (
        <div className="text-slate-500">加载中...</div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-4">暂无产品</p>
            <Button>+ 新增产品</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>产品列表</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full">
              <thead>
                <tr className="border-b text-sm text-slate-500">
                  <th className="text-left py-3 px-4">编码</th>
                  <th className="text-left py-3 px-4">名称</th>
                  <th className="text-left py-3 px-4">分类</th>
                  <th className="text-left py-3 px-4">基础价</th>
                  <th className="text-left py-3 px-4">状态</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-sm">{product.code}</td>
                    <td className="py-3 px-4">{product.name}</td>
                    <td className="py-3 px-4">{product.product_categories?.name || '-'}</td>
                    <td className="py-3 px-4">¥{product.base_price?.toLocaleString()}</td>
                    <td className="py-3 px-4">
                      <Badge variant={statusMap[product.status]?.variant || 'default'}>
                        {statusMap[product.status]?.label || product.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

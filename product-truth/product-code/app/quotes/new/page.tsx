'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function NewQuotePage() {
  const router = useRouter()
  const [customerName, setCustomerName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: JSON.stringify({
          customer_name: customerName,
          customer_contact: customerContact,
          valid_until: validUntil || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '创建失败')
        setLoading(false)
        return
      }

      router.push('/quotes')
      router.refresh()
    } catch {
      setError('网络错误，请稍后重试')
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">新建报价</h1>
      <Card>
        <CardHeader>
          <CardTitle>报价信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
            )}
            <div>
              <label className="text-sm font-medium mb-1 block">客户名称 *</label>
              <Input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">客户联系方式</label>
              <Input type="text" value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">有效期至</label>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div className="flex gap-4 pt-4">
              <Button type="submit" disabled={loading}>{loading ? '保存中...' : '创建报价'}</Button>
              <Button type="button" variant="outline" onClick={() => router.push('/quotes')}>取消</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

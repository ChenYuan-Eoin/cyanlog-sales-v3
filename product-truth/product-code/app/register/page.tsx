'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    if (password.length < 8) {
      setError('密码至少8位')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '注册失败')
        return
      }

      document.cookie = `token=${data.token}; path=/; max-age=86400`
      localStorage.setItem('token', data.token)
      router.push('/')
      router.refresh()
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">注册</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
            )}
            <div>
              <label className="text-sm font-medium mb-1 block">姓名</label>
              <Input type="text" placeholder="请输入姓名" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">邮箱</label>
              <Input type="email" placeholder="请输入邮箱" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">密码</label>
              <Input type="password" placeholder="至少8位" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">确认密码</label>
              <Input type="password" placeholder="再次输入密码" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '注册中...' : '注册'}
            </Button>
            <div className="text-center text-sm text-slate-500">
              已有账号？<Link href="/login" className="text-blue-600">去登录</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

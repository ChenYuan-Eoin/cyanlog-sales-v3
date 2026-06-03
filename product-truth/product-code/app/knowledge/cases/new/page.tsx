// F015 案例库创建页
// 路径：/knowledge/cases/new

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  INDUSTRIES,
  PRODUCTS,
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  OUTCOMES,
  type CaseDifficulty,
  type CaseOutcome,
} from '@/lib/case-library/types'

export default function NewCasePage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const form = new FormData(e.currentTarget)
    const tagsRaw = String(form.get('tags') || '')
    const tags = tagsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const payload = {
      title: String(form.get('title') || '').trim(),
      customer_name: String(form.get('customer_name') || '').trim(),
      industry: String(form.get('industry') || ''),
      product: String(form.get('product') || ''),
      amount: form.get('amount') ? Number(form.get('amount')) : null,
      duration_months: form.get('duration_months') ? Number(form.get('duration_months')) : null,
      difficulty: String(form.get('difficulty') || 'MEDIUM') as CaseDifficulty,
      outcome: String(form.get('outcome') || 'SUCCESS') as CaseOutcome,
      background: String(form.get('background') || '').trim() || undefined,
      challenge: String(form.get('challenge') || '').trim() || undefined,
      solution: String(form.get('solution') || '').trim() || undefined,
      success_factors: String(form.get('success_factors') || '').trim() || undefined,
      lessons_learned: String(form.get('lessons_learned') || '').trim() || undefined,
      tags,
      is_published: form.get('is_published') === 'on',
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null

    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || '创建失败')
        return
      }
      const data = await res.json()
      router.push(`/knowledge/cases/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">新建案例</h1>
      <p className="text-sm text-slate-500 mb-6">填写案例详细信息，便于团队复盘与复用</p>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>基础信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="案例名称" required>
              <Input name="title" required placeholder="如：某银行 AI 风控平台落地" />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="客户名称" required>
                <Input name="customer_name" required placeholder="如：某股份制银行" />
              </FormField>
              <FormField label="行业" required>
                <Select name="industry" options={INDUSTRIES} />
              </FormField>
              <FormField label="产品" required>
                <Select name="product" options={PRODUCTS} />
              </FormField>
              <FormField label="难度" required>
                <Select
                  name="difficulty"
                  options={DIFFICULTIES}
                  labelMap={DIFFICULTY_LABEL}
                  defaultValue="MEDIUM"
                />
              </FormField>
              <FormField label="结果" required>
                <Select name="outcome" options={OUTCOMES} defaultValue="SUCCESS" />
              </FormField>
              <FormField label="项目金额（元）">
                <Input name="amount" type="number" min="0" placeholder="选填" />
              </FormField>
              <FormField label="项目周期（月）">
                <Input name="duration_months" type="number" min="0" max="120" placeholder="选填" />
              </FormField>
              <FormField label="标签（逗号分隔）">
                <Input name="tags" placeholder="如：AI, 风控, 银行业" />
              </FormField>
            </div>
            <FormField label="是否发布">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_published" className="rounded" />
                <span className="text-slate-700">立即发布到知识库</span>
              </label>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>详情描述</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="背景">
              <Textarea name="background" rows={3} placeholder="项目背景、客户现状、决策动机" />
            </FormField>
            <FormField label="挑战">
              <Textarea name="challenge" rows={3} placeholder="项目实施中的核心挑战" />
            </FormField>
            <FormField label="解决方案">
              <Textarea name="solution" rows={3} placeholder="采用的技术方案、关键决策" />
            </FormField>
            <FormField label="关键成功因素 / 经验教训">
              <Textarea
                name="success_factors"
                rows={3}
                placeholder="成功的关键因素（成功案例）或失败教训（失败案例）"
              />
            </FormField>
            <FormField label="结果 / 反思">
              <Textarea name="lessons_learned" rows={3} placeholder="最终结果与团队反思" />
            </FormField>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '创建中...' : '创建案例'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

function Select({
  name,
  options,
  labelMap,
  defaultValue,
}: {
  name: string
  options: readonly string[]
  labelMap?: Record<string, string>
  defaultValue?: string
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {labelMap?.[opt] || opt}
        </option>
      ))}
    </select>
  )
}

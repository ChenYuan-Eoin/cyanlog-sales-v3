// REQ:F005 - 条款库管理页面
// PURPOSE: 列出/创建/编辑/删除条款

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PlusIcon, EditIcon, TrashIcon, LibraryIcon, SearchIcon } from 'lucide-react'
import { error as toastError, confirmAction } from '@/lib/toast'

type Stance = 'required' | 'recommended' | 'optional' | 'risky' | 'dangerous'
const STANCE_MAP: Record<Stance, { label: string; color: string }> = {
  required: { label: '必备', color: 'bg-red-100 text-red-800 border-red-200' },
  recommended: { label: '推荐', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  optional: { label: '可选', color: 'bg-slate-100 text-slate-800 border-slate-200' },
  risky: { label: '风险', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  dangerous: { label: '危险', color: 'bg-red-200 text-red-900 border-red-300' },
}

interface Clause {
  id: string
  name: string
  category: string
  stance: Stance
  contract_types: string[]
  template_text: string
  legal_basis: string | null
  description: string | null
  tags: string[]
  is_system: boolean
  org_id: string | null
  created_at: string
  updated_at: string
}

export default function ClauseLibraryPage() {
  const [clauses, setClauses] = useState<Clause[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stanceFilter, setStanceFilter] = useState<string>('all')
  const [editing, setEditing] = useState<Clause | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<{
    name: string
    category: string
    stance: Stance
    contract_types: string[]
    template_text: string
    legal_basis: string
    description: string
    tags: string
  }>({
    name: '',
    category: 'payment',
    stance: 'recommended',
    contract_types: [],
    template_text: '',
    legal_basis: '',
    description: '',
    tags: '',
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void fetchClauses()
  }, [])

  async function fetchClauses() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/clause-library')
      if (res.ok) {
        const data = await res.json()
        setClauses(data.data?.clauses || [])
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!form.name || !form.template_text) {
      toastError('请填写条款名称和标准文本')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/clause-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      })
      if (res.ok) {
        setShowCreate(false)
        setForm({ name: '', category: 'payment', stance: 'recommended', contract_types: [], template_text: '', legal_basis: '', description: '', tags: '' })
        await fetchClauses()
      } else {
        const data = await res.json()
        toastError(data.error || '创建失败')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpdate() {
    if (!editing) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/clause-library/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          stance: form.stance,
          contract_types: form.contract_types,
          template_text: form.template_text,
          legal_basis: form.legal_basis || null,
          description: form.description || null,
          tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      })
      if (res.ok) {
        setEditing(null)
        await fetchClauses()
      } else {
        const data = await res.json()
        toastError(data.error || '更新失败')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!await confirmAction(`确定要删除条款「${name}」吗？`, { confirmText: '删除', danger: true })) return
    const res = await fetch(`/api/admin/clause-library/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await fetchClauses()
    } else {
      const data = await res.json()
      toastError(data.error || '删除失败')
    }
  }

  function openEdit(clause: Clause) {
    setEditing(clause)
    setForm({
      name: clause.name,
      category: clause.category,
      stance: clause.stance,
      contract_types: clause.contract_types,
      template_text: clause.template_text,
      legal_basis: clause.legal_basis || '',
      description: clause.description || '',
      tags: (clause.tags || []).join(', '),
    })
  }

  // 过滤
  const filtered = clauses.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.template_text.toLowerCase().includes(search.toLowerCase())) return false
    if (stanceFilter !== 'all' && c.stance !== stanceFilter) return false
    return true
  })

  // 按立场分组
  const grouped = filtered.reduce((acc, c) => {
    if (!acc[c.stance]) acc[c.stance] = []
    acc[c.stance].push(c)
    return acc
  }, {} as Record<Stance, Clause[]>)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LibraryIcon className="h-6 w-6" />
            条款库管理
          </h1>
          <p className="text-sm text-slate-500 mt-1">维护企业/行业标准合同条款，AI 审核时自动匹配</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon className="h-4 w-4 mr-1" />
            新增条款
          </Button>
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新增条款</DialogTitle>
          </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm">名称 *</label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm">类别</label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['payment', 'delivery', 'quality', 'breach', 'dispute', 'liability', 'ip', '主体', '标的', '其他'].map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-sm">立场（必备/推荐/风险等）</label>
                <Select value={form.stance} onValueChange={(v) => setForm({ ...form, stance: v as Stance })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STANCE_MAP).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm">标准条款文本 *</label>
                <Textarea
                  value={form.template_text}
                  onChange={(e) => setForm({ ...form, template_text: e.target.value })}
                  rows={5}
                />
              </div>
              <div>
                <label className="text-sm">法律依据</label>
                <Input value={form.legal_basis} onChange={(e) => setForm({ ...form, legal_basis: e.target.value })} />
              </div>
              <div>
                <label className="text-sm">说明</label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                />
              </div>
              <div>
                <label className="text-sm">标签（逗号分隔）</label>
                <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={submitting}>{submitting ? '创建中...' : '创建'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {/* 过滤 */}
      <Card className="mb-4">
        <CardContent className="pt-6 flex gap-3 items-center">
          <div className="relative flex-1 max-w-md">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="搜索条款..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={stanceFilter} onValueChange={setStanceFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部立场</SelectItem>
              {Object.entries(STANCE_MAP).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* 条款列表（按立场分组） */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">加载中...</div>
      ) : (
        <div className="space-y-4">
          {(['dangerous', 'risky', 'required', 'recommended', 'optional'] as Stance[]).map(stance => {
            const list = grouped[stance] || []
            if (list.length === 0) return null
            return (
              <div key={stance}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-sm font-medium text-slate-700">{STANCE_MAP[stance].label}</h2>
                  <Badge variant="secondary">{list.length}</Badge>
                </div>
                <div className="space-y-2">
                  {list.map(c => (
                    <Card key={c.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h3 className="font-medium">{c.name}</h3>
                              <Badge variant="outline" className={`text-xs ${STANCE_MAP[c.stance]?.color || ''}`}>
                                {STANCE_MAP[c.stance]?.label}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{c.category}</Badge>
                              {c.is_system && <Badge variant="secondary" className="text-xs">系统</Badge>}
                              {c.contract_types?.map(t => (
                                <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                              ))}
                            </div>
                            <p className="text-sm text-slate-600 line-clamp-3 mb-2">
                              {c.template_text}
                            </p>
                            {c.legal_basis && (
                              <p className="text-xs text-slate-500">
                                <span className="font-medium">依据：</span>{c.legal_basis}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1 ml-2">
                            {!c.is_system && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEdit(c)}
                                >
                                  <EditIcon className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleDelete(c.id, c.name)}
                                >
                                  <TrashIcon className="h-4 w-4 text-red-500" />
                                </Button>
                              </>
                            )}
                            {c.is_system && (
                              <span className="text-xs text-slate-400 self-center">系统内置</span>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )
          })}
          {Object.keys(grouped).length === 0 && (
            <div className="text-center py-12 text-slate-400">暂无条款</div>
          )}
        </div>
      )}

      {/* 编辑 Dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑条款</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm">名称</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-sm">类别</label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['payment', 'delivery', 'quality', 'breach', 'dispute', 'liability', 'ip', '主体', '标的', '其他'].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm">立场</label>
              <Select value={form.stance} onValueChange={(v) => setForm({ ...form, stance: v as Stance })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STANCE_MAP).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm">标准条款文本</label>
              <Textarea value={form.template_text} onChange={(e) => setForm({ ...form, template_text: e.target.value })} rows={5} />
            </div>
            <div>
              <label className="text-sm">法律依据</label>
              <Input value={form.legal_basis} onChange={(e) => setForm({ ...form, legal_basis: e.target.value })} />
            </div>
            <div>
              <label className="text-sm">标签</label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={handleUpdate} disabled={submitting}>{submitting ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

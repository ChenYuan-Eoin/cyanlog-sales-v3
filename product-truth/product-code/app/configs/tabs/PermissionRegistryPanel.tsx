'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArchiveIcon,
  BanIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  TrashIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type RegistryStatus = 'draft' | 'reviewed' | 'published' | 'deprecated' | 'disabled' | 'deleted'
type RegistryKind = 'atomic' | 'bundle'

type RegistryDefinition = {
  id: string
  key: string
  label: string
  description: string
  category: string
  kind: RegistryKind
  status: RegistryStatus
  version: number
  enforcementConsumer: string | null
}

type Draft = {
  key: string
  label: string
  description: string
  category: string
  kind: RegistryKind
  enforcementConsumer: string
}

const EMPTY_DRAFT: Draft = {
  key: '',
  label: '',
  description: '',
  category: 'console',
  kind: 'atomic',
  enforcementConsumer: '',
}

const NEXT_ACTION: Partial<Record<RegistryStatus, {
  action: 'review' | 'publish' | 'deprecate' | 'disable'
  label: string
  icon: typeof CheckIcon
}>> = {
  draft: { action: 'review', label: '提交审核', icon: SendIcon },
  reviewed: { action: 'publish', label: '发布', icon: CheckIcon },
  published: { action: 'deprecate', label: '停用新授权', icon: ArchiveIcon },
  deprecated: { action: 'disable', label: '立即停用', icon: BanIcon },
}

function authHeaders(json = false): HeadersInit {
  const token = localStorage.getItem('token')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

function statusBadge(status: RegistryStatus) {
  if (status === 'published') return <Badge>已发布</Badge>
  if (status === 'draft') return <Badge variant="outline">草稿</Badge>
  if (status === 'reviewed') return <Badge variant="secondary">待发布</Badge>
  if (status === 'deprecated') return <Badge className="border-amber-200 bg-amber-50 text-amber-800">已弃用</Badge>
  if (status === 'disabled') return <Badge className="border-rose-200 bg-rose-50 text-rose-700">已停用</Badge>
  return <Badge variant="outline">已删除</Badge>
}

export function PermissionRegistryPanel() {
  const [definitions, setDefinitions] = useState<RegistryDefinition[]>([])
  const [available, setAvailable] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/permissions', {
      headers: authHeaders(),
      cache: 'no-store',
    })
    if (response.status === 403) {
      setAvailable(false)
      setDefinitions([])
      return
    }
    if (!response.ok) throw new Error('权限目录读取失败')
    const payload = await response.json() as { data?: { definitions?: RegistryDefinition[] } }
    setDefinitions(payload.data?.definitions ?? [])
    setAvailable(true)
  }, [])

  useEffect(() => {
    void refresh().catch((error) => {
      setAvailable(false)
      setMessage(error instanceof Error ? error.message : '权限目录读取失败')
    })
  }, [refresh])

  function openCreate() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setMessage(null)
    setDialogOpen(true)
  }

  function openEdit(definition: RegistryDefinition) {
    setEditingId(definition.id)
    setDraft({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      category: definition.category,
      kind: definition.kind,
      enforcementConsumer: definition.enforcementConsumer ?? '',
    })
    setMessage(null)
    setDialogOpen(true)
  }

  async function saveDraft() {
    if (!draft.key.trim() || !draft.label.trim() || !draft.description.trim()) {
      setMessage('请填写权限 key、名称和说明。')
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(
        editingId ? `/api/admin/permissions/${editingId}` : '/api/admin/permissions',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            ...draft,
            enforcementConsumer: draft.enforcementConsumer.trim() || null,
          }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error?.message || '权限定义保存失败')
      }
      setDialogOpen(false)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '权限定义保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function transition(definition: RegistryDefinition, action: 'review' | 'publish' | 'deprecate' | 'disable') {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/permissions/${definition.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ action }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || '权限生命周期更新失败')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '权限生命周期更新失败')
    } finally {
      setSaving(false)
    }
  }

  async function remove(definition: RegistryDefinition) {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/permissions/${definition.id}`, {
        method: 'DELETE',
        headers: authHeaders(true),
        body: JSON.stringify({ reason: 'retired from active permission catalog' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || '权限软删除失败')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '权限软删除失败')
    } finally {
      setSaving(false)
    }
  }

  async function restore(definition: RegistryDefinition) {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/permissions/${definition.id}/restore`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || '权限恢复失败')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '权限恢复失败')
    } finally {
      setSaving(false)
    }
  }

  if (available === null || available === false) return null

  return (
    <div className="mb-4 rounded-lg border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-900">平台权限定义</h3>
            <Badge variant="outline">{definitions.length} 项</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">维护权限定义、版本和发布状态。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? '收起目录' : '管理目录'}
          </Button>
          {open && (
            <Button size="sm" onClick={openCreate}>
              <PlusIcon className="h-4 w-4" />
              新建草稿
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t">
          {message && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-800">{message}</div>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>权限</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>执行消费者</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.map((definition) => {
                  const next = NEXT_ACTION[definition.status]
                  const editable = ['draft', 'reviewed', 'disabled'].includes(definition.status)
                  return (
                    <TableRow key={definition.id}>
                      <TableCell className="min-w-56">
                        <div className="font-medium text-slate-900">{definition.label}</div>
                        <code className="text-xs text-slate-500">{definition.key}</code>
                      </TableCell>
                      <TableCell>{definition.kind === 'atomic' ? '原子' : '组合'}</TableCell>
                      <TableCell>{statusBadge(definition.status)}</TableCell>
                      <TableCell>v{definition.version}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs text-slate-500">
                        {definition.enforcementConsumer || '未接入'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {editable && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(definition)}
                              title="编辑草稿"
                            >
                              <PencilIcon className="h-4 w-4" />
                              <span className="sr-only">编辑草稿</span>
                            </Button>
                          )}
                          {next && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={saving}
                              onClick={() => void transition(definition, next.action)}
                              title={next.label}
                            >
                              <next.icon className="h-4 w-4" />
                              <span>{next.label}</span>
                            </Button>
                          )}
                          {definition.status === 'disabled' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={saving}
                              onClick={() => void remove(definition)}
                              title="软删除"
                            >
                              <TrashIcon className="h-4 w-4" />
                              <span className="sr-only">软删除</span>
                            </Button>
                          )}
                          {definition.status === 'deleted' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={saving}
                              onClick={() => void restore(definition)}
                            >
                              <RotateCcwIcon className="h-4 w-4" />
                              恢复
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑权限草稿' : '新建权限草稿'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              权限 key
              <Input
                className="mt-1"
                value={draft.key}
                disabled={Boolean(editingId)}
                onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                placeholder="resource:action"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              名称
              <Input
                className="mt-1"
                value={draft.label}
                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              说明
              <textarea
                className="mt-1 min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                分类
                <select
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-3 text-sm"
                  value={draft.category}
                  onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                >
                  <option value="console">后台访问</option>
                  <option value="org">组织与人员</option>
                  <option value="quote">报价与客户</option>
                  <option value="contract">合同与模板</option>
                  <option value="payment">财务与回款</option>
                  <option value="shipping">顺丰业务域</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                类型
                <select
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-3 text-sm"
                  value={draft.kind}
                  onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as RegistryKind }))}
                >
                  <option value="atomic">原子权限</option>
                  <option value="bundle">组合能力</option>
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              执行消费者
              <Input
                className="mt-1"
                value={draft.enforcementConsumer}
                onChange={(event) => setDraft((current) => ({ ...current, enforcementConsumer: event.target.value }))}
                placeholder="lib/... 或 app/api/..."
              />
            </label>
            {message && <div className="text-sm text-rose-700">{message}</div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={() => void saveDraft()} disabled={saving}>
              {saving ? '保存中...' : '保存草稿'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

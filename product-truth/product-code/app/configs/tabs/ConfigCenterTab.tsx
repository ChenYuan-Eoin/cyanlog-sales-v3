'use client'

// REQ: F027-F036
// PURPOSE: 配置中心通用域 Tab（列表/新建/编辑/发布/版本/回滚/删除），字段由 domain-specs 驱动
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DOMAIN_FIELD_SPECS, type FieldSpec } from '../domain-specs'

interface Row {
  id: string
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  version?: number
  [key: string]: unknown
}

interface VersionRow {
  id: string
  version: number
  status: string
  created_at: string
}

export default function ConfigCenterTab({ domain, title, description }: { domain: string; title: string; description?: string }) {
  const fields = DOMAIN_FIELD_SPECS[domain] || []
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [versionsFor, setVersionsFor] = useState<Row | null>(null)

  const api = `/api/config-center/${domain}`

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(api)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error?.message || '加载失败')
        setRows([])
      } else {
        setRows(json.data || [])
      }
    } catch {
      setError('加载失败')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function openCreate() {
    const init: Record<string, string> = {}
    for (const f of fields) {
      if (f.type === 'boolean') init[f.key] = 'false'
      else if (f.type === 'multiselect') init[f.key] = ''
      else if (f.type === 'json') init[f.key] = '{}'
      else init[f.key] = ''
    }
    setEditing(null)
    setForm(init)
    setDialogOpen(true)
  }

  function openEdit(row: Row) {
    const init: Record<string, string> = {}
    for (const f of fields) {
      const v = row[f.key]
      if (f.type === 'json' || f.type === 'multiselect') {
        init[f.key] = v === undefined || v === null ? '' : JSON.stringify(v)
      } else if (f.type === 'boolean') {
        init[f.key] = String(Boolean(v))
      } else {
        init[f.key] = v === undefined || v === null ? '' : String(v)
      }
    }
    setEditing(row)
    setForm(init)
    setDialogOpen(true)
  }

  function parseValue(f: FieldSpec, raw: string): unknown {
    if (f.type === 'number') {
      return raw.trim() === '' ? null : Number(raw)
    }
    if (f.type === 'boolean') {
      return raw === 'true'
    }
    if (f.type === 'json' || f.type === 'multiselect') {
      const trimmed = raw.trim()
      if (trimmed === '') {
        return f.type === 'multiselect' ? [] : {}
      }
      if (f.type === 'multiselect') {
        if (raw.startsWith('[')) {
          try {
            return JSON.parse(trimmed)
          } catch {
            return raw.split(',').map((x) => x.trim()).filter(Boolean)
          }
        }
        return raw.split(',').map((x) => x.trim()).filter(Boolean)
      }
      return JSON.parse(trimmed)
    }
    return raw
  }

  async function save() {
    const payload: Record<string, unknown> = {}
    for (const f of fields) {
      try {
        payload[f.key] = parseValue(f, form[f.key] ?? '')
      } catch {
        setError(`字段「${f.label}」不是合法 JSON`)
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(editing ? `${api}/${editing.id}` : api, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error?.message || '保存失败')
        return
      }
      setDialogOpen(false)
      await refresh()
    } catch {
      setError('保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function action(id: string, op: 'publish' | 'delete') {
    setError('')
    if (op === 'delete') {
      const res = await fetch(`${api}/${id}`, { method: 'DELETE' })
      if (res.status !== 204) {
        const json = await res.json().catch(() => null)
        setError(json?.error?.message || '删除失败')
        return
      }
      await refresh()
      return
    }
    const res = await fetch(`${api}/${id}/publish`, { method: 'POST' })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) {
      setError(json?.error?.message || '发布失败')
      return
    }
    await refresh()
  }

  async function loadVersions(row: Row) {
    const res = await fetch(`${api}/${row.id}/versions`)
    const json = await res.json()
    setVersions(json.success ? (json.data as VersionRow[]) : [])
    setVersionsFor(row)
  }

  async function rollback(version: number) {
    if (!versionsFor) return
    setError('')
    const res = await fetch(`${api}/${versionsFor.id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    })
    const json = await res.json()
    if (!json.success) {
      setError(json.error?.message || '回滚失败')
      return
    }
    setVersions(null)
    setVersionsFor(null)
    await refresh()
  }

  const listKey = fields[0]?.key || 'id'
  const secondKey = fields[1]?.key

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <Button size="sm" onClick={openCreate}>新建</Button>
      </div>
      {error && <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {loading ? (
        <div className="text-sm text-muted-foreground">加载中…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">暂无配置，点击「新建」创建草稿。</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{fields[0]?.label}</TableHead>
              {secondKey && <TableHead>{fields[1]?.label}</TableHead>}
              <TableHead>状态</TableHead>
              <TableHead>版本</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{String(row[listKey] ?? '')}</TableCell>
                {secondKey && <TableCell>{String(row[secondKey] ?? '')}</TableCell>}
                <TableCell><Badge variant={row.status === 'PUBLISHED' ? 'default' : 'secondary'}>{row.status}</Badge></TableCell>
                <TableCell>{row.version ?? 1}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(row)}>编辑</Button>
                  {row.status === 'DRAFT' && (
                    <Button size="sm" variant="outline" onClick={() => action(row.id, 'publish')}>发布</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => loadVersions(row)}>版本</Button>
                  {row.status === 'DRAFT' && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => action(row.id, 'delete')}>删除</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `编辑 ${title}` : `新建 ${title}`}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            {fields.map((f) => (
              <div key={f.key} className="grid grid-cols-[140px_1fr] items-start gap-2">
                <label className="pt-2 text-sm text-muted-foreground">
                  {f.label}{f.required && <span className="text-destructive"> *</span>}
                </label>
                {f.type === 'textarea' ? (
                  <Textarea value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                ) : f.type === 'select' ? (
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  >
                    {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === 'boolean' ? (
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={form[f.key] ?? 'false'}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  >
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                ) : f.type === 'json' || f.type === 'multiselect' ? (
                  <Textarea
                    rows={2}
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                ) : (
                  <Input
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={versions !== null} onOpenChange={(open) => { if (!open) { setVersions(null); setVersionsFor(null) } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>版本历史</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {versions && versions.length === 0 && <div className="text-sm text-muted-foreground">暂无版本记录</div>}
            {versions?.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span>v{v.version} · {v.status} · {new Date(v.created_at).toLocaleString()}</span>
                <Button size="sm" variant="outline" onClick={() => rollback(v.version)}>回滚到该版本</Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

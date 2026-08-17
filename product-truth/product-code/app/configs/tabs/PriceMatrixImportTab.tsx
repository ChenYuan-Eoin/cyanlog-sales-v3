'use client'

// REQ: F038
// PURPOSE: 多维价盘导入（校验预览 → 落库 DRAFT）；阶段 0 硬门：234 行 0 失败
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'

interface ImportIssue {
  row: number
  field: string
  message: string
}

interface ImportResult {
  ok: boolean
  checked: number
  issue_count: number
  inserted?: number
  issues: ImportIssue[]
  message: string
}

const SAMPLE_JSON = `[
  {
    "product_id": "粘贴产品 ID",
    "version_code": "ENT_V6",
    "deployment": "PUBLIC_CLOUD",
    "auth_mode": "SUB_YEAR",
    "term_months": 12,
    "currency": "CNY",
    "qty_from": 1,
    "qty_to": 10,
    "unit_price": 1500,
    "list_price": 15000
  }
]`

export default function PriceMatrixImportTab() {
  const [text, setText] = useState('')
  const [commit, setCommit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true)
    setError('')
    setResult(null)
    let rows: unknown
    try {
      rows = JSON.parse(text)
    } catch {
      setError('JSON 解析失败，请检查格式')
      setBusy(false)
      return
    }
    try {
      const res = await fetch('/api/config-center/price-matrix/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, commit }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error?.message || '导入失败')
      } else {
        setResult(json.data as ImportResult)
      }
    } catch {
      setError('请求失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">多维价盘导入</h2>
        <p className="text-sm text-muted-foreground">
          粘贴价盘行 JSON（product_id 从「产品目录/价盘」获取），先校验再落库。校验规则：累计=上档累计+区间单账号价×档差、档位连续、10,000+ 无价档必须最后。
        </p>
      </div>
      <Textarea
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={SAMPLE_JSON}
        className="font-mono text-xs"
      />
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={commit} onCheckedChange={(v) => setCommit(v === true)} />
          校验通过后落库（DRAFT）
        </label>
        <Button onClick={run} disabled={busy}>{busy ? '处理中…' : commit ? '校验并落库' : '校验预览'}</Button>
        <Button variant="outline" onClick={() => setText('')}>清空</Button>
      </div>
      {error && <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {result && (
        <div className="rounded border px-3 py-2 text-sm">
          <div className={result.ok ? 'text-emerald-600' : 'text-destructive'}>{result.message}</div>
          <div className="text-muted-foreground">累计关系校验 {result.checked} 组 · 问题 {result.issue_count} 条{result.inserted !== undefined ? ` · 落库 ${result.inserted} 行` : ''}</div>
          {result.issues.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
              {result.issues.slice(0, 100).map((issue, i) => (
                <li key={i}>第 {issue.row} 行 · {issue.field}：{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

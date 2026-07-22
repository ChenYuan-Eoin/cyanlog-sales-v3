'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  FolderTree,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  X,
  XCircle,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { getRuleAssetHealth } from '@/lib/rules/rule-assets'
import type {
  ContractRuleAsset,
  ContractRuleAssetSummary,
  ContractRuleLatestEvaluation,
  ContractRuleOperator,
  ContractRuleSetAsset,
  ContractRuleTestResult,
} from '@/types/contract-rule-assets'

interface RuleTabProps {
  onSummaryChange?: (summary: ContractRuleAssetSummary) => void
}

interface RuleAssetsPayload {
  sets: ContractRuleSetAsset[]
  rules: ContractRuleAsset[]
  summary: ContractRuleAssetSummary
  bundle: {
    id: string
    version: number
    compiled_hash: string | null
  } | null
}

type SetForm = {
  name: string
  code: string
  description: string
  applicable_scenario: string
}

type RuleForm = {
  name: string
  code: string
  rule_set_id: string
}

type DeleteTarget = {
  id: string
  kind: 'set' | 'rule'
  name: string
}

type TestState = ContractRuleTestResult & { testedAt: string }

const EMPTY_SUMMARY: ContractRuleAssetSummary = { sets: 0, rules: 0, published: 0 }

const OPERATOR_OPTIONS: Array<{ value: ContractRuleOperator; label: string }> = [
  { value: '>=', label: '大于等于' },
  { value: '<=', label: '小于等于' },
  { value: '=', label: '等于' },
  { value: '>', label: '大于' },
  { value: '<', label: '小于' },
  { value: 'contains', label: '包含' },
  { value: 'in', label: '属于' },
]

const LIFECYCLE_LABEL: Record<string, string> = {
  archived: '已归档',
  draft: '草稿',
  needs_translation: '待转译',
  published: '已发布',
  ready_to_publish: '待发布',
}

function authHeaders(json = false): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('token')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({})) as {
    data?: T
    error?: { message?: string }
  }
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || '请求失败')
  }
  return payload.data
}

function splitList(value: string): string[] {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinList(value: string[] | null | undefined): string {
  return (value || []).join('，')
}

function cloneRule(rule: ContractRuleAsset): ContractRuleAsset {
  return {
    ...rule,
    applicable_scenarios: [...rule.applicable_scenarios],
    approval_roles: [...rule.approval_roles],
    field_hints: [...rule.field_hints],
    message_template: { ...rule.message_template },
    translation_notes: [...rule.translation_notes],
    translation_diff: [...rule.translation_diff],
  }
}

function ruleExecutionSummary(rule: ContractRuleAsset): string {
  const anchors = rule.field_hints.length > 0 ? rule.field_hints.join(' / ') : '未配置定位词'
  const engine = rule.engine_type === 'structured'
    ? `先定位“${anchors}”，再读取字段 ${rule.target_field || '未配置'} 做确定性判断。`
    : rule.engine_type === 'semantic'
      ? `先定位“${anchors}”，再由模型按已确认的语义指令判断。`
      : `先定位“${anchors}”，由字段 ${rule.target_field || '未配置'} 与模型语义共同判断。`
  return `${engine} 命中后只输出证据、红绿灯档位和对应处理动作；解释文案不参与判定。`
}

function lifecycleBadge(status: string) {
  if (status === 'published') return <Badge className="bg-emerald-100 text-emerald-700">已发布</Badge>
  if (status === 'archived') return <Badge variant="secondary">已归档</Badge>
  return <Badge className="bg-amber-100 text-amber-700">{LIFECYCLE_LABEL[status] || status}</Badge>
}

function testIcon(test: TestState | undefined, persisted: ContractRuleLatestEvaluation | undefined) {
  if (!test && !persisted) return null
  if (!test && persisted) {
    if (persisted.status === 'passed') {
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="当前版本评测通过" />
    }
    return <XCircle className="h-4 w-4 text-red-500" aria-label="当前版本评测未通过" />
  }
  if (!test) return null
  if (test.status === 'needs_model') {
    return <CircleAlert className="h-4 w-4 text-amber-500" aria-label="需要模型评测" />
  }
  if (test.status === 'matched') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="已执行并命中" />
  }
  return <XCircle className="h-4 w-4 text-slate-400" aria-label="已执行但未命中" />
}

export default function RuleTab({ onSummaryChange }: RuleTabProps) {
  const [sets, setSets] = useState<ContractRuleSetAsset[]>([])
  const [summary, setSummary] = useState<ContractRuleAssetSummary>(EMPTY_SUMMARY)
  const [bundleVersion, setBundleVersion] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [searchText, setSearchText] = useState('')
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [ruleDraft, setRuleDraft] = useState<ContractRuleAsset | null>(null)
  const [saving, setSaving] = useState(false)
  const [setDialog, setSetDialog] = useState<{ mode: 'create' | 'edit'; open: boolean }>({ mode: 'create', open: false })
  const [setForm, setSetForm] = useState<SetForm>({ name: '', code: '', description: '', applicable_scenario: '' })
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [ruleForm, setRuleForm] = useState<RuleForm>({ name: '', code: '', rule_set_id: '' })
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [testInput, setTestInput] = useState('')
  const [expectedTriggered, setExpectedTriggered] = useState(true)
  const [tests, setTests] = useState<Record<string, TestState>>({})

  const loadAssets = useCallback(async (preferred?: { setId?: string; ruleId?: string }) => {
    setLoading(true)
    setError('')
    try {
      const payload = await requestJson<RuleAssetsPayload>('/api/contract-policies/rule-sets', {
        headers: authHeaders(),
      })
      setSets(payload.sets)
      setSummary(payload.summary)
      setBundleVersion(payload.bundle?.version ?? null)
      onSummaryChange?.(payload.summary)
      setSelectedSetId((current) => {
        const candidate = preferred?.setId || current
        return payload.sets.some((item) => item.id === candidate) ? candidate! : payload.sets[0]?.id || null
      })
      if (preferred?.ruleId) setSelectedRuleId(preferred.ruleId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则资产加载失败')
    } finally {
      setLoading(false)
    }
  }, [onSummaryChange])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  const selectedSet = useMemo(
    () => sets.find((item) => item.id === selectedSetId) || null,
    [sets, selectedSetId]
  )
  const selectedRule = useMemo(
    () => selectedSet?.rules.find((item) => item.id === selectedRuleId) || selectedSet?.rules[0] || null,
    [selectedRuleId, selectedSet]
  )

  useEffect(() => {
    if (!selectedSet) {
      setSelectedRuleId(null)
      return
    }
    if (!selectedSet.rules.some((item) => item.id === selectedRuleId)) {
      setSelectedRuleId(selectedSet.rules[0]?.id || null)
    }
  }, [selectedRuleId, selectedSet])

  useEffect(() => {
    setRuleDraft(selectedRule ? cloneRule(selectedRule) : null)
    setTestInput('')
    setExpectedTriggered(true)
  }, [selectedRule])

  const visibleSets = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return sets
    return sets
      .map((ruleSet) => {
        const setMatches = [ruleSet.name, ruleSet.code, ruleSet.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword))
        const rules = setMatches
          ? ruleSet.rules
          : ruleSet.rules.filter((rule) => [rule.code, rule.name, rule.description, ...rule.field_hints]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(keyword)))
        return setMatches || rules.length > 0 ? { ...ruleSet, rules } : null
      })
      .filter((item): item is ContractRuleSetAsset => Boolean(item))
  }, [searchText, sets])

  const selectedHealth = useMemo(
    () => ruleDraft ? getRuleAssetHealth(ruleDraft) : null,
    [ruleDraft]
  )
  const setBlockers = useMemo(
    () => selectedSet?.rules.flatMap((rule) => getRuleAssetHealth(rule).blockers.map((message) => `${rule.code}：${message}`)) || [],
    [selectedSet]
  )
  const setEvaluationBlockers = useMemo(
    () => selectedSet?.rules
      .filter((rule) => rule.is_active && rule.latest_evaluation?.status !== 'passed')
      .map((rule) => `${rule.code}：当前版本尚无通过评测`) || [],
    [selectedSet]
  )
  const setPublishable = Boolean(
    selectedSet
    && selectedSet.rules.length > 0
    && setBlockers.length === 0
    && setEvaluationBlockers.length === 0
  )

  function updateDraft(patch: Partial<ContractRuleAsset>, resetTranslation = true) {
    setRuleDraft((current) => current ? {
      ...current,
      ...patch,
      ...(resetTranslation ? { translation_status: 'needs_ai_translation', lifecycle_status: 'draft' } : {}),
    } : current)
  }

  function updateTemplate(key: string, value: string) {
    if (!ruleDraft) return
    updateDraft({
      message_template: {
        ...ruleDraft.message_template,
        [key]: value,
      },
    })
  }

  async function saveRule() {
    if (!ruleDraft) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await requestJson<ContractRuleAsset>(`/api/contract-policies/rules/${ruleDraft.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify(ruleDraft),
      })
      setNotice(`${ruleDraft.code} 已保存为草稿；发布前仍需满足右上角门禁。`)
      await loadAssets({ setId: ruleDraft.rule_set_id || undefined, ruleId: ruleDraft.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveSet() {
    if (!setForm.name.trim() || !setForm.code.trim()) return
    setSaving(true)
    setError('')
    try {
      const isEdit = setDialog.mode === 'edit' && selectedSet
      const data = await requestJson<ContractRuleSetAsset>(
        isEdit ? `/api/contract-policies/rule-sets/${selectedSet.id}` : '/api/contract-policies/rule-sets',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            name: setForm.name,
            code: setForm.code,
            description: setForm.description || null,
            applicable_scenario: setForm.applicable_scenario || null,
          }),
        }
      )
      setSetDialog((current) => ({ ...current, open: false }))
      setNotice(isEdit ? '规则集信息已更新，正式审核仍消费最近发布版本。' : '规则集已创建，请继续新增规则。')
      await loadAssets({ setId: data.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则集保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function createRule() {
    if (!ruleForm.name.trim() || !ruleForm.code.trim() || !ruleForm.rule_set_id) return
    setSaving(true)
    setError('')
    try {
      const data = await requestJson<ContractRuleAsset>('/api/contract-policies/rules', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          rule_set_id: ruleForm.rule_set_id,
          code: ruleForm.code,
          name: ruleForm.name,
          description: null,
          category: 'text',
          applicable_scenarios: [],
          scope: 'org',
          level_a_operator: 'contains',
          level_a_threshold: null,
          level_a_unit: 'text',
          level_a_action: '通过',
          level_b_operator: 'contains',
          level_b_threshold: null,
          level_b_unit: 'text',
          level_b_action: '进入谈判',
          level_c_operator: 'contains',
          level_c_threshold: null,
          level_c_unit: 'text',
          level_c_action: '阻断并人工复核',
          approval_roles: [],
          priority: 0,
          is_active: true,
          engine_type: 'semantic',
          target_field: null,
          clause_category: null,
          field_hints: [],
          semantic_prompt: null,
          message_template: {},
          business_domain: null,
          risk_level: 'yellow',
          translation_status: 'needs_ai_translation',
        }),
      })
      setRuleDialogOpen(false)
      setNotice('规则已创建为草稿，请完成结构定义并人工确认。')
      await loadAssets({ setId: data.rule_set_id || undefined, ruleId: data.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则创建失败')
    } finally {
      setSaving(false)
    }
  }

  async function archiveTarget() {
    if (!deleteTarget) return
    setSaving(true)
    setError('')
    try {
      const base = deleteTarget.kind === 'set'
        ? '/api/contract-policies/rule-sets'
        : '/api/contract-policies/rules'
      await requestJson(`${base}/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      const setId = deleteTarget.kind === 'rule' ? selectedSetId || undefined : undefined
      setDeleteTarget(null)
      setNotice('已归档；历史快照与已发布审核证据不会被删除。')
      await loadAssets({ setId })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '归档失败')
    } finally {
      setSaving(false)
    }
  }

  async function publishSet() {
    if (!selectedSet || !setPublishable) return
    setSaving(true)
    setError('')
    try {
      const data = await requestJson<{ skill_bundle_version: number }>(`/api/contract-policies/rule-sets/${selectedSet.id}/publish`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          release_note: `${selectedSet.name} 配置中心发布`,
          test_results: {
            gate: 'structural_and_translation_confirmed',
            browser_session_tests: Object.fromEntries(
              selectedSet.rules.map((rule) => [rule.id, tests[rule.id]?.status || 'not_run'])
            ),
          },
        }),
      })
      setPublishOpen(false)
      setNotice(`规则集已原子发布，当前 SkillBundle 为 v${data.skill_bundle_version}。`)
      await loadAssets({ setId: selectedSet.id, ruleId: selectedRuleId || undefined })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则集发布失败')
    } finally {
      setSaving(false)
    }
  }

  async function runTest() {
    if (!ruleDraft) return
    setSaving(true)
    setError('')
    try {
      const numericInput = Number(testInput)
      const data = await requestJson<ContractRuleTestResult>(`/api/contract-policies/rules/${ruleDraft.id}/test`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          fields: ruleDraft.target_field && Number.isFinite(numericInput)
            ? { [ruleDraft.target_field]: numericInput }
            : {},
          text: testInput,
          expected_triggered: expectedTriggered,
        }),
      })
      setTests((current) => ({
        ...current,
        [ruleDraft.id]: { ...data, testedAt: new Date().toISOString() },
      }))
      await loadAssets({ setId: ruleDraft.rule_set_id || undefined, ruleId: ruleDraft.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则测试失败')
    } finally {
      setSaving(false)
    }
  }

  function openCreateSet() {
    setSetForm({ name: '', code: '', description: '', applicable_scenario: '' })
    setSetDialog({ mode: 'create', open: true })
  }

  function openEditSet(ruleSet: ContractRuleSetAsset) {
    setSelectedSetId(ruleSet.id)
    setSetForm({
      name: ruleSet.name,
      code: ruleSet.code,
      description: ruleSet.description || '',
      applicable_scenario: ruleSet.applicable_scenario || '',
    })
    setSetDialog({ mode: 'edit', open: true })
  }

  function openCreateRule(ruleSetId?: string) {
    const targetSetId = ruleSetId || selectedSetId || sets[0]?.id || ''
    setRuleForm({ name: '', code: '', rule_set_id: targetSetId })
    setRuleDialogOpen(true)
  }

  if (loading && sets.length === 0) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-slate-200 bg-white">
        <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">正在读取正式规则资产...</span>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {(error || notice) && (
          <div className={`rounded-md border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {error || notice}
          </div>
        )}

        <div className="grid min-h-[760px] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 xl:border-b-0 xl:border-r">
            <div className="border-b border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">规则集与规则</h3>
                  <p className="mt-1 text-xs text-slate-500">{summary.sets} 个规则集 · {summary.rules} 条规则</p>
                </div>
                <Button size="sm" onClick={openCreateSet}>
                  <Plus className="mr-1 h-4 w-4" />
                  规则集
                </Button>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜索规则集、规则、定位词..."
                  className="pl-9 pr-9"
                />
                {searchText && (
                  <button
                    type="button"
                    onClick={() => setSearchText('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="清空搜索"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[690px] overflow-y-auto p-2">
              {visibleSets.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-slate-500">没有匹配的规则资产</div>
              ) : visibleSets.map((ruleSet) => {
                const active = ruleSet.id === selectedSetId
                return (
                  <div key={ruleSet.id} className="mb-2 overflow-hidden rounded-md border border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSetId(ruleSet.id)
                        setSelectedRuleId(ruleSet.rules[0]?.id || null)
                      }}
                      className={`group flex w-full items-start gap-3 px-3 py-3 text-left ${active ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'}`}
                    >
                      <FolderTree className={`mt-0.5 h-5 w-5 shrink-0 ${active ? 'text-slate-200' : 'text-slate-500'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{ruleSet.name}</span>
                          <span className={`text-xs ${active ? 'text-slate-300' : 'text-slate-400'}`}>{ruleSet.rules.length}</span>
                        </span>
                        <span className={`mt-0.5 block truncate text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                          {ruleSet.code} · v{ruleSet.version} · {LIFECYCLE_LABEL[ruleSet.lifecycle_status] || ruleSet.lifecycle_status}
                        </span>
                      </span>
                      <span className={`flex shrink-0 gap-1 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <span
                          role="button"
                          tabIndex={0}
                          title="编辑规则集"
                          onClick={(event) => { event.stopPropagation(); openEditSet(ruleSet) }}
                          className={`rounded p-1 ${active ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          title="归档规则集"
                          onClick={(event) => { event.stopPropagation(); setDeleteTarget({ id: ruleSet.id, kind: 'set', name: ruleSet.name }) }}
                          className={`rounded p-1 ${active ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}
                        >
                          <Archive className="h-4 w-4" />
                        </span>
                      </span>
                    </button>

                    {(active || searchText) && (
                      <div className="bg-white p-1.5">
                        {ruleSet.rules.map((rule) => (
                          <button
                            key={rule.id}
                            type="button"
                            onClick={() => { setSelectedSetId(ruleSet.id); setSelectedRuleId(rule.id) }}
                            className={`group flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm ${rule.id === selectedRuleId ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50'}`}
                          >
                            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="w-12 shrink-0 font-mono text-xs text-slate-400">{rule.code}</span>
                            <span className="min-w-0 flex-1 truncate">{rule.name}</span>
                            {testIcon(tests[rule.id], rule.latest_evaluation)}
                            {rule.lifecycle_status === 'published' && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="已发布" />}
                            <ChevronRight className="h-4 w-4 text-slate-300" />
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => openCreateRule(ruleSet.id)}
                          className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 px-2 py-2 text-xs text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          在此规则集新增规则
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </aside>

          <main className="min-w-0">
            {!selectedSet ? (
              <div className="flex min-h-[620px] flex-col items-center justify-center px-6 text-center">
                <FolderTree className="h-11 w-11 text-slate-300" />
                <h3 className="mt-4 font-semibold text-slate-900">先创建一个规则集</h3>
                <p className="mt-2 max-w-md text-sm text-slate-500">规则集是生产规则的发布边界；规则是可维护、可测试的执行单元。</p>
                <Button className="mt-5" onClick={openCreateSet}><Plus className="mr-1 h-4 w-4" />新建规则集</Button>
              </div>
            ) : !ruleDraft ? (
              <div className="flex min-h-[620px] flex-col items-center justify-center px-6 text-center">
                <FileText className="h-11 w-11 text-slate-300" />
                <h3 className="mt-4 font-semibold text-slate-900">{selectedSet.name} 暂无规则</h3>
                <p className="mt-2 text-sm text-slate-500">新增第一条规则后，才能测试和发布这个规则集。</p>
                <Button className="mt-5" onClick={() => openCreateRule(selectedSet.id)}><Plus className="mr-1 h-4 w-4" />新建规则</Button>
              </div>
            ) : (
              <div>
                <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-slate-400">{ruleDraft.code}</span>
                      <h3 className="truncate text-lg font-semibold text-slate-950">{ruleDraft.name}</h3>
                      {lifecycleBadge(ruleDraft.lifecycle_status)}
                      {ruleDraft.translation_status === 'ready'
                        ? <Badge className="bg-blue-100 text-blue-700">结构已确认</Badge>
                        : <Badge variant="outline">待确认</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedSet.name} · 规则 v{ruleDraft.version} · 当前正式包 {bundleVersion ? `v${bundleVersion}` : '未发布'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteTarget({ id: ruleDraft.id, kind: 'rule', name: ruleDraft.name })}
                    >
                      <Archive className="mr-1 h-4 w-4" />归档
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPublishOpen(true)} disabled={!setPublishable}>
                      发布规则集
                    </Button>
                    <Button size="sm" onClick={saveRule} disabled={saving}>
                      {saving ? '保存中...' : '保存草稿'}
                    </Button>
                  </div>
                </header>

                <div className="px-6 py-5">
                  <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${selectedHealth?.publishable ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <div className="font-medium">
                      {selectedHealth?.publishable ? '当前规则已达到结构发布门禁' : `当前规则还有 ${selectedHealth?.blockers.length || 0} 个发布阻断项`}
                    </div>
                    {!selectedHealth?.publishable && <div className="mt-1 text-xs">{selectedHealth?.blockers.join('；')}</div>}
                  </div>

                  <Tabs defaultValue="definition">
                    <TabsList variant="line" className="mb-4 h-10 w-full justify-start border-b border-slate-200">
                      <TabsTrigger value="definition" className="flex-none px-4">规则定义</TabsTrigger>
                      <TabsTrigger value="output" className="flex-none px-4">响应与谈判</TabsTrigger>
                      <TabsTrigger value="test" className="flex-none px-4">测试</TabsTrigger>
                    </TabsList>

                    <TabsContent value="definition" className="space-y-5">
                      <section className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>规则名称</span>
                            <Input value={ruleDraft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
                          </label>
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>规则集</span>
                            <Select value={ruleDraft.rule_set_id || ''} onValueChange={(value) => updateDraft({ rule_set_id: value })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>{sets.map((ruleSet) => <SelectItem key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </label>
                        </div>
                        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                          <span>业务解释</span>
                          <Textarea value={ruleDraft.description || ''} onChange={(event) => updateDraft({ description: event.target.value })} className="min-h-20" />
                        </label>
                        <div className="grid gap-4 md:grid-cols-3">
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>执行方式</span>
                            <Select value={ruleDraft.engine_type} onValueChange={(value) => updateDraft({ engine_type: value as ContractRuleAsset['engine_type'] })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="structured">字段规则</SelectItem>
                                <SelectItem value="semantic">语义模型</SelectItem>
                                <SelectItem value="hybrid">字段 + 语义</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>数据类型</span>
                            <Select value={ruleDraft.category} onValueChange={(value) => updateDraft({ category: value as ContractRuleAsset['category'] })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ratio">比例</SelectItem>
                                <SelectItem value="amount">金额</SelectItem>
                                <SelectItem value="duration">时限</SelectItem>
                                <SelectItem value="enum">枚举</SelectItem>
                                <SelectItem value="text">文本语义</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>缺省关注色</span>
                            <Select value={ruleDraft.risk_level} onValueChange={(value) => updateDraft({ risk_level: value as ContractRuleAsset['risk_level'] })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="red">红线</SelectItem>
                                <SelectItem value="yellow">需谈判</SelectItem>
                                <SelectItem value="green">通过</SelectItem>
                              </SelectContent>
                            </Select>
                            <span className="block text-xs font-normal text-slate-500">仅用于证据不足或未分档时，不覆盖下方 A/B/C 判定。</span>
                          </label>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>适用场景</span>
                            <Input value={joinList(ruleDraft.applicable_scenarios)} onChange={(event) => updateDraft({ applicable_scenarios: splitList(event.target.value) })} placeholder="客户合同，续约，采购" />
                          </label>
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>条款分类</span>
                            <Input value={ruleDraft.clause_category || ''} onChange={(event) => updateDraft({ clause_category: event.target.value })} placeholder="payment / ip / sla" />
                          </label>
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>定位词（只负责找条款）</span>
                            <Input value={joinList(ruleDraft.field_hints)} onChange={(event) => updateDraft({ field_hints: splitList(event.target.value) })} placeholder="首付款，账期，尾款" />
                          </label>
                          <label className="space-y-1.5 text-sm font-medium text-slate-700">
                            <span>判定字段（负责计算）</span>
                            <Input value={ruleDraft.target_field || ''} onChange={(event) => updateDraft({ target_field: event.target.value })} placeholder="advance_ratio" />
                          </label>
                        </div>
                        {ruleDraft.engine_type !== 'structured' && (
                          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                            <span>模型判定指令</span>
                            <Textarea
                              value={ruleDraft.semantic_prompt || ''}
                              onChange={(event) => updateDraft({ semantic_prompt: event.target.value })}
                              className="min-h-24"
                              placeholder="说明模型需要判断的事实、边界和返回字段；不要在这里写客户侧文案。"
                            />
                          </label>
                        )}
                      </section>

                      <section className="overflow-hidden rounded-md border border-slate-200">
                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                          <h4 className="font-medium text-slate-900">红绿灯判定</h4>
                          <p className="mt-1 text-xs text-slate-500">档位由引擎命中阈值产生；解释文案不参与判定。</p>
                        </div>
                        {(['a', 'b', 'c'] as const).map((level) => {
                          const meta = level === 'a'
                            ? { label: 'A · 绿色通过', color: 'border-l-emerald-500', bg: 'bg-emerald-50/40' }
                            : level === 'b'
                              ? { label: 'B · 黄色谈判', color: 'border-l-amber-500', bg: 'bg-amber-50/40' }
                              : { label: 'C · 红线阻断', color: 'border-l-red-500', bg: 'bg-red-50/40' }
                          const operatorKey = `level_${level}_operator` as const
                          const thresholdKey = `level_${level}_threshold` as const
                          const unitKey = `level_${level}_unit` as const
                          const actionKey = `level_${level}_action` as const
                          return (
                            <div key={level} className={`grid gap-3 border-b border-l-4 border-slate-200 p-4 last:border-b-0 md:grid-cols-[150px_150px_140px_minmax(220px,1fr)] ${meta.color} ${meta.bg}`}>
                              <div className="self-center text-sm font-medium text-slate-900">{meta.label}</div>
                              <Select value={ruleDraft[operatorKey]} onValueChange={(value) => updateDraft({ [operatorKey]: value as ContractRuleOperator })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{OPERATOR_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                              </Select>
                              <div className="flex gap-2">
                                <Input
                                  type="number"
                                  value={ruleDraft[thresholdKey] ?? ''}
                                  onChange={(event) => updateDraft({ [thresholdKey]: event.target.value === '' ? null : Number(event.target.value) })}
                                  placeholder="阈值"
                                />
                                <Input value={ruleDraft[unitKey] || ''} onChange={(event) => updateDraft({ [unitKey]: event.target.value })} placeholder="单位" className="w-20" />
                              </div>
                              <Input value={ruleDraft[actionKey] || ''} onChange={(event) => updateDraft({ [actionKey]: event.target.value })} placeholder="命中后的处理动作" />
                            </div>
                          )
                        })}
                      </section>

                      <section className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
                        <div className="text-sm font-medium text-blue-900">机器执行摘要（只读）</div>
                        <p className="mt-1 text-sm leading-6 text-blue-800">{ruleExecutionSummary(ruleDraft)}</p>
                      </section>

                      <label className="flex items-start gap-3 rounded-md border border-slate-200 p-4">
                        <input
                          type="checkbox"
                          checked={ruleDraft.translation_status === 'ready'}
                          onChange={(event) => updateDraft({ translation_status: event.target.checked ? 'ready' : 'needs_ai_translation' }, false)}
                          className="mt-1 h-4 w-4"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-900">我已核对执行摘要与业务规则一致</span>
                          <span className="mt-1 block text-xs text-slate-500">确认后才允许发布；任意规则字段再次修改会自动回到待确认。</span>
                        </span>
                      </label>
                    </TabsContent>

                    <TabsContent value="output" className="space-y-4">
                      <p className="text-sm text-slate-600">这里定义销售谈判和客户侧交付内容，不参与规则命中。客户侧批注不得暴露规则编号、模型或内部推理。</p>
                      <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                        <span>证据要求</span>
                        <Textarea value={String(ruleDraft.message_template.evidence_requirement || '')} onChange={(event) => updateTemplate('evidence_requirement', event.target.value)} className="min-h-20" placeholder="必须 exact match 的原文范围与人工定位条件" />
                      </label>
                      <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                        <span>销售谈判口径</span>
                        <Textarea value={String(ruleDraft.message_template.negotiation_guidance || '')} onChange={(event) => updateTemplate('negotiation_guidance', event.target.value)} className="min-h-24" placeholder="销售如何解释、可接受底线和客户坚持不改时的动作" />
                      </label>
                      <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                        <span>客户侧批注模板</span>
                        <Textarea value={String(ruleDraft.message_template.comment_template || '')} onChange={(event) => updateTemplate('comment_template', event.target.value)} className="min-h-24" placeholder="仅写客户能理解的修改建议，不暴露内部规则或推理" />
                      </label>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                          <span>例外 / 白名单</span>
                          <Textarea value={String(ruleDraft.message_template.exception || '')} onChange={(event) => updateTemplate('exception', event.target.value)} className="min-h-20 border-emerald-300 bg-emerald-50" />
                        </label>
                        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                          <span>规则来源</span>
                          <Textarea value={String(ruleDraft.message_template.source_reference || '')} onChange={(event) => updateTemplate('source_reference', event.target.value)} className="min-h-20" placeholder="制度、模板、历史规则或导入来源" />
                        </label>
                      </div>
                    </TabsContent>

                    <TabsContent value="test" className="space-y-4">
                      <div className="rounded-md border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-slate-900">测试当前规则</h4>
                            <p className="mt-1 text-sm text-slate-500">
                              {selectedHealth?.testMode === 'deterministic'
                                ? `输入 ${ruleDraft.target_field || '判定字段'} 的数值，直接验证 A/B/C 阈值。`
                                : '该规则需要真实模型评测；本页不会用关键词冒充语义命中。'}
                            </p>
                          </div>
                          <Badge variant="outline">{selectedHealth?.testMode === 'deterministic' ? '确定性测试' : '模型评测'}</Badge>
                        </div>
                        {selectedHealth?.testMode === 'deterministic' ? (
                          <Input className="mt-4" type="number" value={testInput} onChange={(event) => setTestInput(event.target.value)} placeholder="输入测试数值" />
                        ) : (
                          <Textarea className="mt-4 min-h-28" value={testInput} onChange={(event) => setTestInput(event.target.value)} placeholder="输入模拟合同条款；系统会调用已发布模型策略并记录 Provider、降级状态和 Token。" />
                        )}
                        <div className="mt-3 flex w-fit rounded-md border border-slate-200 bg-slate-50 p-1">
                          <button
                            type="button"
                            onClick={() => setExpectedTriggered(true)}
                            className={`rounded px-3 py-1.5 text-sm ${expectedTriggered ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500'}`}
                          >
                            预期命中
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpectedTriggered(false)}
                            className={`rounded px-3 py-1.5 text-sm ${!expectedTriggered ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500'}`}
                          >
                            预期不命中
                          </button>
                        </div>
                        <Button className="mt-3" onClick={runTest} disabled={saving || !testInput.trim()}>
                          <Play className="mr-1 h-4 w-4" />运行测试
                        </Button>
                      </div>
                      {tests[ruleDraft.id] && (
                        <div className={`rounded-md border p-4 text-sm ${tests[ruleDraft.id].status === 'matched' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : tests[ruleDraft.id].status === 'needs_model' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                          <div className="font-medium">
                            {tests[ruleDraft.id].status === 'matched' ? '已命中' : tests[ruleDraft.id].status === 'needs_model' ? '需要真实模型' : '未命中'}
                          </div>
                          <div className="mt-1">{tests[ruleDraft.id].reason}</div>
                          {tests[ruleDraft.id].evidence && (
                            <div className="mt-3 grid gap-2 border-t border-current/15 pt-3 text-xs sm:grid-cols-3">
                              <span>发布评测：{tests[ruleDraft.id].evidence?.evaluation_status === 'passed' ? '通过' : tests[ruleDraft.id].evidence?.evaluation_status === 'failed' ? '不符合预期' : '调用失败'}</span>
                              <span>执行源：{tests[ruleDraft.id].evidence?.provider || '规则引擎'}</span>
                              <span>Token：{tests[ruleDraft.id].evidence?.usage?.totalTokens ?? 0}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <Dialog open={setDialog.open} onOpenChange={(open) => setSetDialog((current) => ({ ...current, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{setDialog.mode === 'create' ? '新建规则集' : '编辑规则集'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <label className="block space-y-1.5 text-sm font-medium"><span>名称</span><Input value={setForm.name} onChange={(event) => setSetForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>编码</span><Input value={setForm.code} onChange={(event) => setSetForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/\s+/g, '_') }))} disabled={setDialog.mode === 'edit'} /></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>适用场景</span><Input value={setForm.applicable_scenario} onChange={(event) => setSetForm((current) => ({ ...current, applicable_scenario: event.target.value }))} placeholder="客户合同 / 采购合同 / 续约" /></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>说明</span><Textarea value={setForm.description} onChange={(event) => setSetForm((current) => ({ ...current, description: event.target.value }))} /></label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSetDialog((current) => ({ ...current, open: false }))}>取消</Button><Button onClick={saveSet} disabled={saving || !setForm.name.trim() || !setForm.code.trim()}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>新建规则</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <label className="block space-y-1.5 text-sm font-medium"><span>所属规则集</span><Select value={ruleForm.rule_set_id} onValueChange={(value) => setRuleForm((current) => ({ ...current, rule_set_id: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sets.map((ruleSet) => <SelectItem key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</SelectItem>)}</SelectContent></Select></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>规则编码</span><Input value={ruleForm.code} onChange={(event) => setRuleForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/\s+/g, '_') }))} placeholder="R016" /></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>规则名称</span><Input value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <p className="text-xs text-slate-500">创建后直接进入结构化详情；触发、红绿灯、谈判口径和批注模板不会被藏在 JSON 里。</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRuleDialogOpen(false)}>取消</Button><Button onClick={createRule} disabled={saving || !ruleForm.name.trim() || !ruleForm.code.trim() || !ruleForm.rule_set_id}>创建</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>归档{deleteTarget?.kind === 'set' ? '规则集' : '规则'}</DialogTitle></DialogHeader>
          <p className="text-sm leading-6 text-slate-600">
            将归档“{deleteTarget?.name}”。历史快照和已经产生的审核证据会保留；规则集归档会同时归档其中的活动规则。
          </p>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="destructive" onClick={archiveTarget} disabled={saving}>确认归档</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>发布规则集</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm text-slate-600">
            <p>发布“{selectedSet?.name}”会为该规则集生成不可变快照，并重新编译当前 `CONTRACT_REVIEW_DEFAULT` SkillBundle。</p>
            {[...setBlockers, ...setEvaluationBlockers].length > 0 ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">{[...setBlockers, ...setEvaluationBlockers].join('；')}</div>
            ) : (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">结构、转译确认、处理动作和真实评测门禁已通过。评测证据会写入发布快照。</div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button><Button onClick={publishSet} disabled={saving || !setPublishable}>确认发布</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArchiveIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  Layers3Icon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  Trash2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ruleContractConfigurationStatus } from '@/lib/rules/rule-contract'
import type { ContractPolicyRule, ContractProblemCategory, ContractRuleSet } from '@/types/rules'
import RuleDesigner from '../components/RuleDesigner'
import RuleTestSandbox from '../components/RuleTestSandbox'

interface RuleTabProps {
  rules: ContractPolicyRule[]
  focusRuleId?: string | null
  ruleMode?: string | null
  onSave: (rule: Partial<ContractPolicyRule>, id?: string) => void | ContractPolicyRule | Promise<void | ContractPolicyRule>
  onDelete: (id: string) => void
  onRefresh?: () => void | Promise<void>
}

type Feedback = { tone: 'success' | 'error'; message: string }
type DetailMode = 'details' | 'test'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function getApiMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const record = payload as { message?: string; error?: { message?: string } | string }
  if (typeof record.error === 'string') return record.error
  return record.error?.message || record.message || fallback
}

function categoryForRule(rule: ContractPolicyRule, categories: ContractProblemCategory[]) {
  if (rule.problem_category) return rule.problem_category
  return categories.find((category) => category.id === rule.problem_category_id)
    || categories.find((category) => category.code === rule.clause_category)
    || null
}

function ruleStatus(rule: ContractPolicyRule, activePublishedVersion?: number) {
  if (!rule.is_active && activePublishedVersion) {
    return { label: `线上 v${activePublishedVersion} · 待随规则集停用`, className: 'bg-amber-50 text-amber-800' }
  }
  if (!rule.is_active) return { label: '待停用', className: 'bg-slate-100 text-slate-600' }
  if (activePublishedVersion && activePublishedVersion === rule.version) {
    return { label: `线上 v${activePublishedVersion}`, className: 'bg-emerald-100 text-emerald-700' }
  }
  if (activePublishedVersion) {
    return { label: `线上 v${activePublishedVersion} · 草稿 v${rule.version} 待发布`, className: 'bg-blue-50 text-blue-700' }
  }
  return { label: `草稿 v${rule.version || 1} · 尚未上线`, className: 'bg-blue-50 text-blue-700' }
}

export default function RuleTab({ rules, focusRuleId, ruleMode, onSave, onDelete, onRefresh }: RuleTabProps) {
  const [categories, setCategories] = useState<ContractProblemCategory[]>([])
  const [ruleSets, setRuleSets] = useState<ContractRuleSet[]>([])
  const [loadingHierarchy, setLoadingHierarchy] = useState(true)
  const [selectedRuleSetId, setSelectedRuleSetId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedRule, setSelectedRule] = useState<ContractPolicyRule | null>(null)
  const [creatingRule, setCreatingRule] = useState(false)
  const [detailMode, setDetailMode] = useState<DetailMode>('details')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [ruleSetDialogOpen, setRuleSetDialogOpen] = useState(false)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [creatingRuleSet, setCreatingRuleSet] = useState(false)
  const [publishingRuleSet, setPublishingRuleSet] = useState(false)
  const [detailDirty, setDetailDirty] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState({ name: '', code: '', description: '', sort_order: 100 })
  const [ruleSetDraft, setRuleSetDraft] = useState({ name: '', code: '', description: '' })
  const handledFocusRef = useRef('')
  const detailWorkspaceRef = useRef<HTMLDivElement>(null)

  function revealDetailWorkspace() {
    window.requestAnimationFrame(() => {
      detailWorkspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function confirmLeaveDirtyRule() {
    if (!detailDirty) return true
    return window.confirm('当前规则有未保存修改。离开会丢失这些修改，是否继续？')
  }

  function openTestWorkspace() {
    if (detailDirty) {
      setFeedback({ tone: 'error', message: '当前规则还有未保存修改。请先保存，再用已保存版本进行测试。' })
      revealDetailWorkspace()
      return
    }
    setDetailMode('test')
    revealDetailWorkspace()
  }

  const loadHierarchy = useCallback(async () => {
    setLoadingHierarchy(true)
    try {
      const headers = authHeaders()
      const [categoriesResponse, ruleSetsResponse] = await Promise.all([
        fetch('/api/contract-policies/rule-categories', { headers }),
        fetch('/api/contract-policies/rule-sets', { headers }),
      ])
      const [categoriesPayload, ruleSetsPayload] = await Promise.all([
        categoriesResponse.json().catch(() => ({})),
        ruleSetsResponse.json().catch(() => ({})),
      ])
      if (!categoriesResponse.ok) {
        throw new Error(getApiMessage(categoriesPayload, '问题分类加载失败'))
      }
      if (!ruleSetsResponse.ok) {
        throw new Error(getApiMessage(ruleSetsPayload, '规则集加载失败'))
      }
      const nextCategories = Array.isArray(categoriesPayload?.data) ? categoriesPayload.data : []
      const nextRuleSets = Array.isArray(ruleSetsPayload?.data) ? ruleSetsPayload.data : []
      setCategories(nextCategories)
      setRuleSets(nextRuleSets)
      setSelectedCategoryId((current) => (
        nextCategories.some((category: ContractProblemCategory) => category.id === current)
          ? current
          : nextCategories[0]?.id || ''
      ))
      const defaultRuleSetId = nextRuleSets.find((ruleSet: ContractRuleSet) => ruleSet.is_default && (ruleSet.rule_count || 0) > 0)?.id
        || nextRuleSets.find((ruleSet: ContractRuleSet) => (ruleSet.rule_count || 0) > 0)?.id
        || nextRuleSets.find((ruleSet: ContractRuleSet) => ruleSet.is_default)?.id
        || nextRuleSets[0]?.id
        || ''
      setSelectedRuleSetId((current) => (
        nextRuleSets.some((ruleSet: ContractRuleSet) => ruleSet.id === current)
          ? current
          : defaultRuleSetId
      ))
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : '规则结构加载失败' })
    } finally {
      setLoadingHierarchy(false)
    }
  }, [])

  useEffect(() => {
    void loadHierarchy()
  }, [loadHierarchy])

  const rulesInSet = useMemo(() => (
    selectedRuleSetId
      ? rules.filter((rule) => rule.rule_set_id === selectedRuleSetId)
      : []
  ), [rules, selectedRuleSetId])

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const rule of rulesInSet) {
      const category = categoryForRule(rule, categories)
      if (category) counts.set(category.id, (counts.get(category.id) || 0) + 1)
    }
    return counts
  }, [categories, rulesInSet])

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) || null,
    [categories, selectedCategoryId]
  )

  const visibleRules = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return rulesInSet
      .filter((rule) => categoryForRule(rule, categories)?.id === selectedCategoryId)
      .filter((rule) => !normalizedQuery || [rule.code, rule.name, rule.description || '']
        .some((value) => value.toLowerCase().includes(normalizedQuery)))
      .sort((left, right) => (right.priority || 0) - (left.priority || 0))
  }, [categories, query, rulesInSet, selectedCategoryId])

  const selectedRuleSet = useMemo(
    () => ruleSets.find((ruleSet) => ruleSet.id === selectedRuleSetId) || null,
    [ruleSets, selectedRuleSetId]
  )

  const detailRuleSet = useMemo(() => {
    const ruleSetId = selectedRule?.rule_set_id || selectedRuleSetId
    return ruleSets.find((ruleSet) => ruleSet.id === ruleSetId) || null
  }, [ruleSets, selectedRule, selectedRuleSetId])

  const activePublishedVersionForRule = useCallback((rule: ContractPolicyRule) => (
    ruleSets.find((ruleSet) => ruleSet.id === rule.rule_set_id)?.active_rule_versions?.[rule.id]
  ), [ruleSets])

  useEffect(() => {
    // `mode=new` is a one-shot navigation intent. It must not become a new
    // command merely because saving the draft changes `rules.length`.
    const focusKey = ruleMode === 'new'
      ? 'new'
      : `${ruleMode || ''}:${focusRuleId || ''}:${rules.length}:${categories.length}`
    if (handledFocusRef.current === focusKey || categories.length === 0) return
    if (ruleMode === 'new') {
      handledFocusRef.current = focusKey
      setSelectedRule(null)
      setCreatingRule(true)
      setDetailMode('details')
      return
    }
    if (focusRuleId) {
      const focused = rules.find((rule) => rule.id === focusRuleId)
      if (!focused) return
      handledFocusRef.current = focusKey
      const category = categoryForRule(focused, categories)
      if (category) setSelectedCategoryId(category.id)
      setSelectedRuleSetId(focused.rule_set_id || '')
      setSelectedRule(focused)
      setCreatingRule(false)
      setDetailMode('details')
    }
  }, [categories, focusRuleId, ruleMode, rules])

  useEffect(() => {
    if (creatingRule || selectedRule) return
    if (visibleRules.length > 0) setSelectedRule(visibleRules[0])
  }, [creatingRule, selectedRule, visibleRules])

  useEffect(() => {
    if (!selectedRule) return
    const refreshedRule = rules.find((rule) => rule.id === selectedRule.id)
    if (refreshedRule && refreshedRule !== selectedRule) setSelectedRule(refreshedRule)
  }, [rules, selectedRule])

  useEffect(() => {
    if (!selectedRule) return
    if (visibleRules.some((rule) => rule.id === selectedRule.id)) return
    setSelectedRule(visibleRules[0] || null)
    setDetailMode('details')
  }, [selectedRule, visibleRules])

  function handleSelectCategory(category: ContractProblemCategory) {
    const switchingCategory = category.id !== selectedCategoryId
    if (switchingCategory && !confirmLeaveDirtyRule()) return
    if (switchingCategory) setDetailDirty(false)
    setSelectedCategoryId(category.id)
    const firstRule = rulesInSet
      .filter((rule) => categoryForRule(rule, categories)?.id === category.id)
      .sort((left, right) => (right.priority || 0) - (left.priority || 0))[0]
    setSelectedRule(firstRule || null)
    setCreatingRule(false)
    setDetailMode('details')
    setFeedback(null)
  }

  function handleNewRule() {
    if (!selectedCategory) {
      setFeedback({ tone: 'error', message: '请先创建并选择一个问题分类。' })
      return
    }
    if (!selectedRuleSetId) {
      setFeedback({ tone: 'error', message: '请先选择一个具体规则集，规则必须归入明确的版本与发布边界。' })
      return
    }
    if (!confirmLeaveDirtyRule()) return
    setDetailDirty(false)
    setSelectedRule(null)
    setCreatingRule(true)
    setDetailMode('details')
    revealDetailWorkspace()
  }

  async function handleSaveRule(rule: Partial<ContractPolicyRule>) {
    if (!selectedCategory) return
    setSaving(true)
    setFeedback(null)
    try {
      const savedRule = await onSave({
        ...rule,
        problem_category_id: selectedCategory.id,
        problem_category: selectedCategory,
        rule_set_id: selectedRule?.rule_set_id || selectedRuleSetId || rule.rule_set_id || null,
      }, selectedRule?.id)
      setFeedback({ tone: 'success', message: '规则草稿已保存。正式生效仍需随所属规则集完成测试和发布。' })
      // ConfigsClient.onSave already refreshes the rule rows. A second parent
      // refresh would unmount this workspace and lose the user's position.
      await loadHierarchy()
      if (savedRule?.id) {
        setSelectedRuleSetId(savedRule.rule_set_id || selectedRuleSetId)
        setSelectedCategoryId(savedRule.problem_category_id || selectedCategory.id)
        setSelectedRule(savedRule)
      }
      setCreatingRule(false)
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '规则保存失败，请检查页面提示后重试。',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateCategory() {
    const name = categoryDraft.name.trim()
    const code = categoryDraft.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    if (!name || !code) {
      setFeedback({ tone: 'error', message: '请填写问题分类名称和编码。' })
      return
    }
    setCreatingCategory(true)
    try {
      const response = await fetch('/api/contract-policies/rule-categories', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code,
          description: categoryDraft.description.trim() || null,
          sort_order: categoryDraft.sort_order,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiMessage(payload, '问题分类创建失败'))
      const created = payload?.data as ContractProblemCategory | undefined
      const switchToCreated = Boolean(created?.id) && confirmLeaveDirtyRule()
      setCategoryDialogOpen(false)
      setCategoryDraft({ name: '', code: '', description: '', sort_order: 100 })
      await loadHierarchy()
      if (created?.id && switchToCreated) {
        setDetailDirty(false)
        setSelectedCategoryId(created.id)
        setSelectedRule(null)
        setCreatingRule(false)
      }
      setFeedback({
        tone: 'success',
        message: switchToCreated
          ? '问题分类已创建，现在可以在该分类下添加具体规则。'
          : '问题分类已创建；当前未保存的规则仍保留在编辑区。',
      })
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : '问题分类创建失败' })
    } finally {
      setCreatingCategory(false)
    }
  }

  async function handleCreateRuleSet() {
    const name = ruleSetDraft.name.trim()
    const code = ruleSetDraft.code.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_')
    if (!name || !code) {
      setFeedback({ tone: 'error', message: '请填写规则集名称和编码。' })
      return
    }
    setCreatingRuleSet(true)
    try {
      const response = await fetch('/api/contract-policies/rule-sets', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code,
          description: ruleSetDraft.description.trim() || null,
          applicable_scenario: 'contract_review',
          priority: 100,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiMessage(payload, '规则集创建失败'))
      const created = payload?.data as ContractRuleSet | undefined
      const switchToCreated = Boolean(created?.id) && confirmLeaveDirtyRule()
      setRuleSetDialogOpen(false)
      setRuleSetDraft({ name: '', code: '', description: '' })
      await loadHierarchy()
      if (created?.id && switchToCreated) {
        setDetailDirty(false)
        setSelectedRuleSetId(created.id)
        setSelectedRule(null)
        setCreatingRule(false)
      }
      setFeedback({
        tone: 'success',
        message: switchToCreated
          ? '规则集草稿已创建。它将统一管理所含规则的版本和发布边界。'
          : '规则集草稿已创建；当前未保存的规则仍保留在编辑区。',
      })
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : '规则集创建失败' })
    } finally {
      setCreatingRuleSet(false)
    }
  }

  async function handlePublishRuleSet() {
    if (!selectedRuleSet) return
    if (detailDirty) {
      setFeedback({ tone: 'error', message: '当前规则还有未保存修改。请先保存或放弃修改，再发布规则集。' })
      revealDetailWorkspace()
      return
    }
    setPublishingRuleSet(true)
    setFeedback(null)
    try {
      const response = await fetch(`/api/contract-policies/rule-sets/${selectedRuleSet.id}/publish`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ release_note: '配置中心规则集统一发布' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiMessage(payload, '规则集发布失败'))
      await onRefresh?.()
      await loadHierarchy()
      setFeedback({ tone: 'success', message: `规则集“${selectedRuleSet.name}”已发布，所含规则版本已冻结为同一发布快照。` })
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : '规则集发布失败' })
    } finally {
      setPublishingRuleSet(false)
    }
  }

  const ruleSetSummary = selectedRuleSet
    ? `v${selectedRuleSet.version} · ${selectedRuleSet.lifecycle_status === 'published' ? '已发布' : selectedRuleSet.lifecycle_status === 'ready_to_publish' ? '待发布' : '草稿'} · ${selectedRuleSet.rule_count || 0} 条规则 · 验收 ${selectedRuleSet.passed_test_case_count || 0}/${selectedRuleSet.required_test_case_count || 0}`
    : '尚未创建规则集'

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 min-[1800px]:flex-row min-[1800px]:items-center min-[1800px]:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Layers3Icon className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-slate-950">合同审核规则</h2>
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  规则集是一套可统一发布的审核规则；在规则集内按问题分类维护具体规则、属性、判定和处理。
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-64">
                  <label htmlFor="rule-set-filter" className="mb-1 block text-xs font-medium text-slate-500">当前规则集</label>
                  <select
                    id="rule-set-filter"
                    value={selectedRuleSetId}
                    onChange={(event) => {
                      const nextRuleSetId = event.target.value
                      if (nextRuleSetId !== selectedRuleSetId && !confirmLeaveDirtyRule()) return
                      setDetailDirty(false)
                      const firstRule = rules
                        .filter((rule) => rule.rule_set_id === nextRuleSetId)
                        .sort((left, right) => (right.priority || 0) - (left.priority || 0))[0]
                      const firstCategory = firstRule ? categoryForRule(firstRule, categories) : categories[0]
                      setSelectedRuleSetId(nextRuleSetId)
                      setSelectedCategoryId(firstCategory?.id || '')
                      setSelectedRule(firstRule || null)
                      setCreatingRule(false)
                      setDetailMode('details')
                    }}
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  >
                    {ruleSets.length === 0 ? <option value="">暂无规则集</option> : null}
                    {ruleSets.map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-400">{ruleSetSummary}</div>
                  {selectedRuleSet?.publish_blockers?.length ? (
                    <div className="mt-1 max-w-sm text-[11px] text-amber-700">{selectedRuleSet.publish_blockers[0]}</div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  onClick={() => void handlePublishRuleSet()}
                  disabled={!selectedRuleSet?.can_publish || publishingRuleSet}
                  title={selectedRuleSet?.publish_blockers?.join('；') || undefined}
                >
                  {publishingRuleSet ? '发布中...' : '发布规则集'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setRuleSetDialogOpen(true)}>
                  <ArchiveIcon className="mr-1 h-4 w-4" />新建规则集
                </Button>
                <Button type="button" onClick={handleNewRule} disabled={!selectedCategory || !selectedRuleSetId}>
                  <PlusIcon className="mr-1 h-4 w-4" />新建规则
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {feedback ? (
          <div role="status" className={`rounded-lg border px-4 py-3 text-sm leading-6 ${
            feedback.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}>
            {feedback.message}
          </div>
        ) : null}

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(200px,0.8fr)_minmax(280px,1.2fr)]">
          <Card className="self-start overflow-hidden">
            <CardHeader className="border-b border-slate-100 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">问题分类</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">先按业务问题组织规则</p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="新建问题分类" onClick={() => setCategoryDialogOpen(true)}>
                  <PlusIcon className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="max-h-[420px] space-y-1 overflow-x-hidden overflow-y-auto p-2">
              {loadingHierarchy ? (
                <div className="px-3 py-8 text-center text-sm text-slate-400">加载中...</div>
              ) : categories.length === 0 ? (
                <button type="button" onClick={() => setCategoryDialogOpen(true)} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500 hover:border-blue-300 hover:text-blue-700">
                  尚无问题分类<br /><span className="mt-1 inline-block text-xs">点击创建第一个分类</span>
                </button>
              ) : categories.map((category) => {
                const active = category.id === selectedCategoryId
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => handleSelectCategory(category)}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <FolderIcon className={`h-4 w-4 shrink-0 ${active ? 'text-blue-300' : 'text-slate-400'}`} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {categoryCounts.get(category.id) || 0}
                    </span>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          <Card className="self-start overflow-hidden">
            <CardHeader className="border-b border-slate-100 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate text-sm">{selectedCategory?.name || '具体规则'}</CardTitle>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{selectedCategory?.description || '选择分类后查看具体规则'}</p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="在当前分类新建规则" disabled={!selectedCategory || !selectedRuleSetId} onClick={handleNewRule}>
                  <PlusIcon className="h-4 w-4" />
                </Button>
              </div>
              <div className="relative mt-2">
                <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  aria-label="搜索当前分类的规则"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索规则"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent className="max-h-[420px] space-y-2 overflow-x-hidden overflow-y-auto p-2">
              {!selectedCategory ? (
                <EmptyList message="请选择问题分类" />
              ) : visibleRules.length === 0 ? (
                <button type="button" onClick={handleNewRule} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500 hover:border-blue-300 hover:text-blue-700">
                  当前分类还没有规则<br /><span className="mt-1 inline-block text-xs">{selectedRuleSetId ? '点击添加具体规则' : '先创建一个规则集'}</span>
                </button>
              ) : visibleRules.map((rule) => {
                const active = selectedRule?.id === rule.id
                const status = ruleStatus(rule, activePublishedVersionForRule(rule))
                const configurationStatus = ruleContractConfigurationStatus(rule)
                return (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => {
                      const switchingRule = selectedRule?.id !== rule.id
                      if (switchingRule && !confirmLeaveDirtyRule()) return
                      if (switchingRule) setDetailDirty(false)
                      setSelectedRule(rule)
                      setCreatingRule(false)
                      setDetailMode('details')
                      revealDetailWorkspace()
                    }}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      active ? 'border-blue-300 bg-blue-50' : 'border-slate-100 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <FileTextIcon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900">{rule.name}</div>
                        <div className="mt-1 truncate text-[11px] text-slate-400">{rule.code} · v{rule.version || 1}</div>
                      </div>
                      <ChevronRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                        configurationStatus === 'canonical_complete'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {configurationStatus === 'canonical_complete'
                          ? '规则详情已确认'
                          : configurationStatus === 'legacy_compatible'
                            ? '旧规则待业务确认'
                            : '待补属性或判定'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          <Card ref={detailWorkspaceRef} className="min-w-0 scroll-mt-6 self-start overflow-hidden lg:col-span-2">
            {detailMode === 'test' && selectedRule ? (
              <>
                <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-slate-100 p-4">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">测试：{selectedRule.name}</CardTitle>
                    <p className="mt-1 text-xs text-slate-500">使用真实合同段落验证当前已保存规则</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setDetailMode('details')}>返回规则详情</Button>
                </CardHeader>
                <CardContent className="p-4">
                  <RuleTestSandbox rule={selectedRule} onTestSaved={async () => {
                    // A test run changes release readiness, not the rule draft.
                    // Refresh the hierarchy in place so the test workspace and
                    // selected business context remain visible.
                    await loadHierarchy()
                  }} />
                </CardContent>
              </>
            ) : selectedRule || creatingRule ? (
              <>
                <CardHeader className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-500">规则详情</div>
                    <CardTitle className="mt-1 truncate text-base">{selectedRule?.name || `在“${selectedCategory?.name}”中新建规则`}</CardTitle>
                  </div>
                  {selectedRule ? (
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={openTestWorkspace}>
                        <Settings2Icon className="mr-1 h-4 w-4" />测试
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="text-rose-600" onClick={() => {
                        if (!confirmLeaveDirtyRule()) return
                        setDetailDirty(false)
                        onDelete(selectedRule.id)
                        setSelectedRule(null)
                      }}>
                        <Trash2Icon className="mr-1 h-4 w-4" />停用
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="p-4">
                  <RuleDesigner
                    initialRule={selectedRule || undefined}
                    context={{
                      ruleSetId: selectedRule?.rule_set_id || selectedRuleSetId || null,
                      ruleSetLabel: detailRuleSet?.name || '未指定发布规则集',
                      problemCategory: selectedCategory,
                      activePublishedVersion: selectedRule ? activePublishedVersionForRule(selectedRule) : undefined,
                    }}
                    saving={saving}
                    onSave={handleSaveRule}
                    onTest={selectedRule ? openTestWorkspace : undefined}
                    onDirtyChange={setDetailDirty}
                  />
                </CardContent>
              </>
            ) : (
              <CardContent className="grid min-h-[420px] place-items-center p-8 text-center">
                <div className="max-w-sm">
                  <Layers3Icon className="mx-auto h-10 w-10 text-slate-300" />
                  <div className="mt-3 text-sm font-semibold text-slate-900">从问题分类开始</div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">选择左侧问题分类，再维护该分类下的具体规则、属性和判定。</p>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>新建问题分类</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <DialogField label="分类名称" htmlFor="category-name">
              <Input id="category-name" value={categoryDraft.name} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} placeholder="如：付款与结算" />
            </DialogField>
            <DialogField label="分类编码" htmlFor="category-code">
              <Input id="category-code" value={categoryDraft.code} onChange={(event) => setCategoryDraft((current) => ({ ...current, code: event.target.value }))} placeholder="如：payment_settlement" />
            </DialogField>
            <DialogField label="分类说明" htmlFor="category-description">
              <Textarea id="category-description" value={categoryDraft.description} onChange={(event) => setCategoryDraft((current) => ({ ...current, description: event.target.value }))} placeholder="说明这类问题覆盖的业务范围。" rows={3} />
            </DialogField>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
              问题分类用于组织规则，例如付款、验收、违约；金额、比例、时限属于具体规则中的属性，不是分类。
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCategoryDialogOpen(false)}>取消</Button>
            <Button type="button" disabled={creatingCategory} onClick={() => void handleCreateCategory()}>{creatingCategory ? '创建中...' : '创建分类'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ruleSetDialogOpen} onOpenChange={setRuleSetDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>新建规则集</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <DialogField label="规则集名称" htmlFor="rule-set-name">
              <Input id="rule-set-name" value={ruleSetDraft.name} onChange={(event) => setRuleSetDraft((current) => ({ ...current, name: event.target.value }))} placeholder="如：标准销售合同" />
            </DialogField>
            <DialogField label="规则集编码" htmlFor="rule-set-code">
              <Input id="rule-set-code" value={ruleSetDraft.code} onChange={(event) => setRuleSetDraft((current) => ({ ...current, code: event.target.value }))} placeholder="如：STANDARD_SALES" />
            </DialogField>
            <DialogField label="规则集说明" htmlFor="rule-set-description">
              <Textarea id="rule-set-description" value={ruleSetDraft.description} onChange={(event) => setRuleSetDraft((current) => ({ ...current, description: event.target.value }))} placeholder="说明这组规则解决什么问题、由谁维护。" rows={3} />
            </DialogField>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
              应用模块：合同审核（当前产品固定）。其它业务模块以后选择自己的规则资产，不在这里填模糊场景词。
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              规则集控制版本和统一发布；问题分类组织问题，具体属性、判定和处理在规则详情中维护。
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRuleSetDialogOpen(false)}>取消</Button>
            <Button type="button" disabled={creatingRuleSet} onClick={() => void handleCreateRuleSet()}>{creatingRuleSet ? '创建中...' : '创建规则集'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EmptyList({ message }: { message: string }) {
  return <div className="px-3 py-8 text-center text-sm text-slate-400">{message}</div>
}

function DialogField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  )
}

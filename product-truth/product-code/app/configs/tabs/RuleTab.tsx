'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  FileTextIcon,
  FolderIcon,
  FolderTreeIcon,
  GitBranchIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from 'lucide-react'
import type { ContractPolicyRule, ContractRuleSet } from '@/types/rules'
import {
  asRecord,
  buildRuleSetSections,
  buildRuleSetViews,
  fallbackRuleSetKey,
  isFormallyPublishedRule,
  ruleBlockingReasons,
  ruleSetKeyForAsset,
  ruleSetPrimaryCategory,
  type JsonRecord,
  type RuleSetSection,
  type RuleSetView,
} from '@/lib/contracts/rule-asset-model'
import RuleDesigner from '../components/RuleDesigner'
import RuleTestSandbox from '../components/RuleTestSandbox'

interface RuleTabProps {
  rules: ContractPolicyRule[]
  focusRuleId?: string | null
  ruleMode?: string | null
  onSave: (rule: Partial<ContractPolicyRule>, id?: string) => void | Promise<void>
  onDelete: (id: string) => void
  onRefresh?: () => void | Promise<void>
}

const lifecycleMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  needs_translation: { label: '待转译', variant: 'destructive' },
  ready_to_publish: { label: '待发布', variant: 'outline' },
  published: { label: '已发布', variant: 'default' },
  archived: { label: '已归档', variant: 'secondary' },
}

const translationMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  not_started: { label: '未转译', variant: 'secondary' },
  needs_ai_translation: { label: '需转译', variant: 'destructive' },
  ready: { label: '转译就绪', variant: 'default' },
  failed: { label: '转译失败', variant: 'destructive' },
}

type TranslationDiffItem = {
  field: string
  before: unknown
  after: unknown
  changed: boolean
}

type TranslationDraftState = {
  ruleId: string
  translation: JsonRecord
  diff: TranslationDiffItem[]
  translationStatus: string
  lifecycleStatus: string
  modelInvocationId: string | null
}

const EMPTY_RULES: ContractPolicyRule[] = []

function RuleSetReleasePipeline({ activeRuleSet }: { activeRuleSet?: RuleSetView }) {
  const hasRuleSetDocument = Boolean(activeRuleSet?.asset?.latest_document)
  const hasRules = Boolean(activeRuleSet?.total)
  const translationReady = Boolean(activeRuleSet?.ready && activeRuleSet.ready === activeRuleSet.total)
  const formallyPublished = Boolean(activeRuleSet?.published && activeRuleSet.published === activeRuleSet.total)
  const engineReady = hasRules && translationReady && formallyPublished && !activeRuleSet?.blocked
  const steps = [
    {
      label: '规则集文档',
      value: hasRuleSetDocument ? `v${activeRuleSet?.asset?.latest_document?.version || '-'}` : '可选文档源',
      done: hasRuleSetDocument || activeRuleSet?.source !== 'ruleset',
    },
    {
      label: '结构化规则',
      value: `${activeRuleSet?.total || 0} 条`,
      done: hasRules,
    },
      {
        label: '转译确认',
        value: `${activeRuleSet?.ready || 0} 转译就绪`,
        done: translationReady,
      },
      {
        label: '正式可用',
        value: `${activeRuleSet?.published || 0} 通过门禁`,
        done: formallyPublished,
      },
    {
      label: '正式审核',
      value: engineReady ? '可用' : '仍有门禁',
      done: engineReady,
    },
  ]

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-indigo-700">发布流水线</div>
          <div className="mt-1 text-sm font-semibold text-slate-950">维护规则集 → 转译确认 → 发布版本 → 正式审核可用</div>
        </div>
        <Badge variant={engineReady ? 'default' : 'outline'}>{engineReady ? '闭环' : '待处理'}</Badge>
      </div>
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div key={step.label} className="flex items-center gap-2 rounded-md bg-white px-2 py-2 text-xs">
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
              step.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}>
              {step.done ? '✓' : index + 1}
            </span>
            <span className="min-w-0 flex-1 font-medium text-slate-800">{step.label}</span>
            <span className="max-w-24 truncate text-slate-500">{step.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RuleAssetProductMap({ activeRuleSet }: { activeRuleSet?: RuleSetView }) {
  const steps = [
    {
      label: '规则集目录',
      value: activeRuleSet?.label || '未选择',
      done: Boolean(activeRuleSet),
    },
    {
      label: '规则声明',
      value: activeRuleSet?.asset?.latest_document ? `文档 v${activeRuleSet.asset.latest_document.version}` : '可维护 Markdown / 自然语言',
      done: Boolean(activeRuleSet?.asset?.latest_document) || activeRuleSet?.source !== 'ruleset',
    },
    {
      label: '结构化 RuleUnit',
      value: `${activeRuleSet?.ready || 0}/${activeRuleSet?.total || 0} 转译就绪`,
      done: Boolean(activeRuleSet?.total && activeRuleSet.ready === activeRuleSet.total),
    },
    {
      label: '发布版本',
      value: `${activeRuleSet?.published || 0}/${activeRuleSet?.total || 0} 正式可用`,
      done: Boolean(activeRuleSet?.total && activeRuleSet.published === activeRuleSet.total),
    },
    {
      label: '审核引擎',
      value: activeRuleSet?.blocked ? '仍有门禁' : activeRuleSet?.total ? '可进入编译检查' : '待补规则',
      done: Boolean(activeRuleSet?.total && !activeRuleSet.blocked),
    },
  ]

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-500">规则资产产品化路径</div>
          <div className="mt-1 text-sm font-semibold text-slate-950">不是黑盒解析，必须能看到每一步生成了什么</div>
        </div>
        <Badge variant={activeRuleSet?.blocked ? 'destructive' : 'outline'}>
          {activeRuleSet?.blocked ? '未闭环' : '路径清晰'}
        </Badge>
      </div>
      <div className="mt-3 space-y-2">
        {steps.map((step, index) => (
          <div key={step.label} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-2 text-xs">
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
              step.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}>
              {step.done ? '✓' : index + 1}
            </span>
            <span className="w-20 shrink-0 font-medium text-slate-800">{step.label}</span>
            <span className="min-w-0 truncate text-slate-500">{step.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RuleSetDetailEmptyState({
  activeRuleSet,
  visibleRules,
  onNewRule,
}: {
  activeRuleSet?: RuleSetView
  visibleRules: ContractPolicyRule[]
  onNewRule: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">
            {activeRuleSet?.label || '规则库'}
          </CardTitle>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            左侧已经包含规则集与规则列表；选择具体规则后，右侧只展示该规则的触发器、判定器、证据和输出动作。
          </p>
        </div>
        <Button size="sm" onClick={onNewRule}>
          <PlusIcon className="h-4 w-4 mr-1" />
          新建规则
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <div className="max-w-md">
            <FolderTreeIcon className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-900">
              {visibleRules.length > 0 ? '请选择左侧某条规则' : '当前规则集暂无规则'}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              不再展示三到四屏的规则集闭环说明。规则集健康度留在树节点徽标里，规则维护回到单条规则对象。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function RuleTab({ rules, focusRuleId, ruleMode, onSave, onDelete, onRefresh }: RuleTabProps) {
  const [selectedRule, setSelectedRule] = useState<ContractPolicyRule | null>(null)
  const [activeTab, setActiveTab] = useState<'list' | 'design' | 'test'>('list')
  const [activeRuleSetKey, setActiveRuleSetKey] = useState<string>('all')
  const [ruleSetAssets, setRuleSetAssets] = useState<ContractRuleSet[]>([])
  const [ruleSetAssetsLoading, setRuleSetAssetsLoading] = useState(false)
  const [treeQuery, setTreeQuery] = useState('')
  const [createRuleSetOpen, setCreateRuleSetOpen] = useState(false)
  const [creatingRuleSet, setCreatingRuleSet] = useState(false)
  const [newRuleSetDraft, setNewRuleSetDraft] = useState({
    name: '',
    code: '',
    description: '',
  })
  const [savingRuleSetDocument, setSavingRuleSetDocument] = useState(false)
  const [ruleSetDocumentDraft, setRuleSetDocumentDraft] = useState({ title: '', content: '' })
  const [saving, setSaving] = useState(false)
  const [translatingRuleId, setTranslatingRuleId] = useState<string | null>(null)
  const [translationDraft, setTranslationDraft] = useState<TranslationDraftState | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const handledFocusRef = useRef<string | null>(null)

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => (right.priority || 0) - (left.priority || 0)),
    [rules]
  )
  const loadRuleSetAssets = useCallback(async () => {
    setRuleSetAssetsLoading(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/contract-policies/rule-sets', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setFeedback({
          tone: 'error',
          message: data?.error?.message || '规则集资产加载失败',
        })
        return
      }
      setRuleSetAssets(Array.isArray(data?.data) ? data.data : [])
    } catch {
      setFeedback({ tone: 'error', message: '规则集资产请求失败' })
    } finally {
      setRuleSetAssetsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRuleSetAssets()
  }, [loadRuleSetAssets])

  const ruleSets = useMemo<RuleSetView[]>(() => {
    return buildRuleSetViews(sortedRules, ruleSetAssets)
  }, [ruleSetAssets, sortedRules])

  const activeRuleSet = useMemo(
    () => ruleSets.find((set) => set.key === activeRuleSetKey) || ruleSets[0],
    [activeRuleSetKey, ruleSets]
  )

  const ruleSetSections = useMemo<RuleSetSection[]>(() => buildRuleSetSections(ruleSets), [ruleSets])
  const visibleRuleSetSections = useMemo<RuleSetSection[]>(() => {
    const query = treeQuery.trim().toLowerCase()
    if (!query) return ruleSetSections

    return ruleSetSections
      .map((section) => ({
        ...section,
        sets: section.sets
          .map((ruleSet) => {
            const ruleSetMatched = [
              ruleSet.label,
              ruleSet.code,
              ruleSet.asset?.description || '',
            ].some((value) => value.toLowerCase().includes(query))
            const matchedRules = ruleSet.rules.filter((rule) => [
              rule.code,
              rule.name,
              rule.description || '',
              rule.clause_category || '',
            ].some((value) => value.toLowerCase().includes(query)))
            return ruleSetMatched
              ? ruleSet
              : matchedRules.length > 0
                ? { ...ruleSet, rules: matchedRules }
                : null
          })
          .filter(Boolean) as RuleSetView[],
      }))
      .filter((section) => section.sets.length > 0)
  }, [ruleSetSections, treeQuery])

  const visibleRules = activeRuleSet?.rules || EMPTY_RULES
  const activeRuleSetBlockedRules = useMemo(() => (
    visibleRules
      .map((rule) => ({ rule, reasons: ruleBlockingReasons(rule) }))
      .filter((item) => item.reasons.length > 0)
  ), [visibleRules])
  const designerRuleSetContext = useMemo(() => {
    if (!activeRuleSet || activeRuleSet.key === 'all') return undefined
    return {
      id: activeRuleSet.asset?.id || null,
      label: activeRuleSet.label,
      clauseCategory: ruleSetPrimaryCategory(activeRuleSet),
    }
  }, [activeRuleSet])
  const showRuleSetClosure = false

  useEffect(() => {
    const document = activeRuleSet?.asset?.latest_document
    setRuleSetDocumentDraft({
      title: document?.title || `${activeRuleSet?.label || '规则集'} 规则声明`,
      content: document?.content_markdown || '',
    })
  }, [activeRuleSet?.key, activeRuleSet?.label, activeRuleSet?.asset?.latest_document])

  useEffect(() => {
    if (selectedRule || activeTab !== 'list' || ruleMode === 'new' || focusRuleId) return
    const firstRule = activeRuleSet?.rules[0]
    if (!firstRule) return
    setSelectedRule(firstRule)
    setActiveTab('design')
  }, [activeRuleSet, activeTab, focusRuleId, ruleMode, selectedRule])

  useEffect(() => {
    const focusKey = `${ruleMode || ''}:${focusRuleId || ''}:${rules.length}`
    if (handledFocusRef.current === focusKey) return

    if (ruleMode === 'new') {
      handledFocusRef.current = focusKey
      setSelectedRule(null)
      setActiveTab('design')
      return
    }

    if (focusRuleId) {
      const matchedRule = rules.find((rule) => rule.id === focusRuleId)
      if (matchedRule) {
        handledFocusRef.current = focusKey
        setSelectedRule(matchedRule)
        setActiveRuleSetKey(matchedRule.rule_set_id
          ? ruleSetKeyForAsset(matchedRule.rule_set_id)
          : fallbackRuleSetKey(matchedRule.clause_category))
        setActiveTab('design')
      }
    }
  }, [focusRuleId, ruleMode, rules])

  useEffect(() => {
    if (!selectedRule) return
    if (activeRuleSetKey === 'all') return
    const belongsToActiveRuleSet = activeRuleSetKey.startsWith('ruleset:')
      ? selectedRule.rule_set_id === activeRuleSetKey.replace(/^ruleset:/, '')
      : fallbackRuleSetKey(selectedRule.clause_category) === activeRuleSetKey
    if (!belongsToActiveRuleSet) {
      setSelectedRule(null)
      setActiveTab('list')
    }
  }, [activeRuleSetKey, selectedRule])

  const handleNewRule = () => {
    setTranslationDraft(null)
    setSelectedRule(null)
    setActiveTab('design')
  }

  const handleSelectRuleSet = (ruleSet: RuleSetView) => {
    setActiveRuleSetKey(ruleSet.key)
    setSelectedRule(ruleSet.rules[0] || null)
    setTranslationDraft(null)
    setActiveTab(ruleSet.rules.length > 0 ? 'design' : 'list')
  }

  const handleSelectRule = (rule: ContractPolicyRule) => {
    if (translationDraft?.ruleId !== rule.id) {
      setTranslationDraft(null)
    }
    setSelectedRule(rule)
    setActiveRuleSetKey(rule.rule_set_id
      ? ruleSetKeyForAsset(rule.rule_set_id)
      : fallbackRuleSetKey(rule.clause_category))
    setActiveTab('design')
  }

  const handleCreateRuleSet = async () => {
    const name = newRuleSetDraft.name.trim()
    const code = newRuleSetDraft.code.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_')
    if (!name || !code) {
      setFeedback({ tone: 'error', message: '请填写规则集名称和编码。' })
      return
    }

    setCreatingRuleSet(true)
    setFeedback(null)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/contract-policies/rule-sets', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          code,
          description: newRuleSetDraft.description.trim() || undefined,
          applicable_scenario: 'standard_contract_review',
          priority: 100,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setFeedback({
          tone: 'error',
          message: data?.error?.message || data?.message || '创建规则集失败',
        })
        return
      }
      setCreateRuleSetOpen(false)
      setNewRuleSetDraft({ name: '', code: '', description: '' })
      setFeedback({ tone: 'success', message: '规则集已创建，请在该规则集下新建规则并完成转译、测试和发布。' })
      await loadRuleSetAssets()
      await onRefresh?.()
      const createdId = data?.data?.id || data?.id
      if (createdId) {
        setActiveRuleSetKey(ruleSetKeyForAsset(createdId))
      }
    } catch {
      setFeedback({ tone: 'error', message: '创建规则集请求失败' })
    } finally {
      setCreatingRuleSet(false)
    }
  }

  const handleSaveRule = async (rule: Partial<ContractPolicyRule>) => {
    setSaving(true)
    try {
      await onSave({
        ...rule,
        rule_set_id: selectedRule?.rule_set_id || activeRuleSet?.asset?.id || rule.rule_set_id || null,
      }, selectedRule?.id)
      setTranslationDraft(null)
      setActiveTab('list')
      setSelectedRule(null)
      await loadRuleSetAssets()
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRuleSetDocument = async () => {
    const ruleSetId = activeRuleSet?.asset?.id
    if (!ruleSetId) return
    setSavingRuleSetDocument(true)
    setFeedback(null)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/contract-policies/rule-sets/${ruleSetId}/documents`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: ruleSetDocumentDraft.title,
          source_type: 'markdown',
          content_markdown: ruleSetDocumentDraft.content,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setFeedback({
          tone: 'error',
          message: data?.error?.message || '保存规则集文档失败',
        })
        return
      }
      setFeedback({
        tone: 'success',
        message: '规则集文档已保存为新版本，需转译确认后才能进入正式审核。',
      })
      await loadRuleSetAssets()
      await onRefresh?.()
    } catch {
      setFeedback({ tone: 'error', message: '保存规则集文档请求失败' })
    } finally {
      setSavingRuleSetDocument(false)
    }
  }

  const handleTranslateRule = async (rule: ContractPolicyRule) => {
    setTranslatingRuleId(rule.id)
    setFeedback(null)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/contract-policies/rules/${rule.id}/translate`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apply: false }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setFeedback({
          tone: 'error',
          message: data?.error?.message || data?.message || 'AI 转译失败',
        })
        return
      }
      setSelectedRule(rule)
      setTranslationDraft({
        ruleId: rule.id,
        translation: asRecord(data?.data?.translation),
        diff: Array.isArray(data?.data?.diff) ? data.data.diff : [],
        translationStatus: String(data?.data?.translation_status || 'needs_ai_translation'),
        lifecycleStatus: String(data?.data?.lifecycle_status || 'needs_translation'),
        modelInvocationId: data?.data?.model_invocation_id || null,
      })
      setActiveTab('list')
      setFeedback({
        tone: 'success',
        message: '执行草稿已生成，请先核对字段差异，再人工确认应用。',
      })
      await onRefresh?.()
    } catch {
      setFeedback({ tone: 'error', message: 'AI 转译请求失败' })
    } finally {
      setTranslatingRuleId(null)
    }
  }

  return (
    <>
	    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
	      <Card className="min-w-0">
	        <CardHeader className="space-y-3">
            <div className="flex flex-row items-center justify-between gap-3">
	            <CardTitle className="text-base">
	              规则库树 ({Math.max(ruleSets.length - 1, 0)})
	              {ruleSetAssetsLoading ? <span className="ml-2 text-xs font-normal text-slate-400">加载中</span> : null}
	            </CardTitle>
            </div>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={treeQuery}
                onChange={(event) => setTreeQuery(event.target.value)}
                placeholder="搜索规则库、规则集、规则..."
                className="pl-9 pr-9"
              />
              {treeQuery ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => setTreeQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled
                title="规则库是应用级配置根节点；第一阶段固定为默认审核库，规则集就是规则列表容器。"
              >
                <FolderIcon className="h-4 w-4 mr-1" />
                新建审核库
              </Button>
              <Button size="sm" onClick={() => setCreateRuleSetOpen(true)}>
                <PlusIcon className="h-4 w-4 mr-1" />
                新建规则集
              </Button>
            </div>
        </CardHeader>
        <CardContent>
          {sortedRules.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-slate-500">暂无规则</p>
              <p className="mt-1 text-sm text-slate-400">创建后将进入规则转译与发布检查</p>
            </div>
          ) : (
	            <div className="max-h-[760px] space-y-4 overflow-y-auto pr-1">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <FolderIcon className="h-4 w-4 text-slate-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-950">默认审核库</div>
                      <div className="text-[11px] text-slate-500">应用当前合同审核规则资产根节点</div>
                    </div>
                    <Badge variant="outline">{rules.length}</Badge>
                  </div>
                </div>
	              {visibleRuleSetSections.map((section) => (
	                <section key={section.key} className="space-y-2">
	                  <div className="px-1">
	                    <p className="text-xs font-semibold text-slate-900">{section.label}</p>
	                    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{section.description}</p>
	                  </div>
	                  {section.sets.map((ruleSet) => (
                      <div key={ruleSet.key} className="space-y-1">
	                      <button
	                        type="button"
	                        onClick={() => handleSelectRuleSet(ruleSet)}
	                        className={`w-full rounded-lg border p-3 text-left transition ${
	                          activeRuleSetKey === ruleSet.key && !selectedRule
	                            ? 'border-slate-900 bg-slate-900 text-white'
	                            : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200'
	                        }`}
	                      >
	                        <div className="flex items-start gap-3">
	                          <span className={`mt-0.5 rounded-md p-1.5 ${
	                            activeRuleSetKey === ruleSet.key && !selectedRule ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'
	                          }`}>
	                            <FolderTreeIcon className="h-4 w-4" />
	                          </span>
	                          <div className="min-w-0 flex-1">
	                            <div className="flex items-center justify-between gap-2">
	                              <div className="truncate text-sm font-semibold">{ruleSet.label}</div>
	                              <Badge variant={activeRuleSetKey === ruleSet.key && !selectedRule ? 'secondary' : 'outline'} className="text-[10px]">
	                                {ruleSet.total}
	                              </Badge>
	                            </div>
	                            <div className={`mt-1 truncate font-mono text-[11px] ${
	                              activeRuleSetKey === ruleSet.key && !selectedRule ? 'text-slate-200' : 'text-slate-400'
	                            }`}>
	                              {ruleSet.code}
	                            </div>
                              <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                                <span className={`rounded px-1.5 py-1 ${
                                  activeRuleSetKey === ruleSet.key && !selectedRule ? 'bg-white/10 text-slate-100' : 'bg-slate-50 text-slate-500'
                                }`}>
                                  发布 {ruleSet.published}
                                </span>
                                <span className={`rounded px-1.5 py-1 ${
                                  activeRuleSetKey === ruleSet.key && !selectedRule ? 'bg-white/10 text-slate-100' : 'bg-slate-50 text-slate-500'
                                }`}>
                                  转译 {ruleSet.ready}
                                </span>
                                <span className={`rounded px-1.5 py-1 ${
                                  ruleSet.blocked > 0
                                    ? activeRuleSetKey === ruleSet.key && !selectedRule
                                      ? 'bg-rose-500/20 text-rose-100'
                                      : 'bg-rose-50 text-rose-700'
                                    : activeRuleSetKey === ruleSet.key && !selectedRule
                                      ? 'bg-emerald-500/20 text-emerald-100'
                                      : 'bg-emerald-50 text-emerald-700'
                                }`}>
                                  待处理 {ruleSet.total === 0 ? ruleSet.total : ruleSet.blocked}
                                </span>
                              </div>
	                          </div>
	                        </div>
	                      </button>
                        <div className="ml-5 space-y-1 border-l border-slate-100 pl-2">
                          {ruleSet.rules.slice(0, treeQuery ? 20 : 8).map((rule) => {
                            const active = selectedRule?.id === rule.id
                            const blocked = ruleBlockingReasons(rule).length > 0
                            return (
                              <button
                                key={rule.id}
                                type="button"
                                onClick={() => handleSelectRule(rule)}
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition ${
                                  active
                                    ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-100'
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                                }`}
                              >
                                <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-mono text-[11px] text-slate-400">{rule.code}</span>
                                  <span className="ml-1 font-medium">{rule.name}</span>
                                </span>
                                <span title={blocked ? '测试/发布未通过' : '测试/发布可用'}>{blocked ? '❌' : '✅'}</span>
                              </button>
                            )
                          })}
                          {ruleSet.rules.length > (treeQuery ? 20 : 8) ? (
                            <button
                              type="button"
                              onClick={() => handleSelectRuleSet(ruleSet)}
                              className="w-full rounded-md px-2 py-1 text-left text-[11px] text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                            >
                              还有 {ruleSet.rules.length - (treeQuery ? 20 : 8)} 条，点击规则集查看全部
                            </button>
                          ) : null}
                        </div>
                      </div>
	                  ))}
	                </section>
	              ))}
	            </div>
	          )}
	        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        {activeTab === 'test' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">测试用例：{selectedRule?.name || '全部规则'}</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setActiveTab('design')}>
                返回设计
              </Button>
            </CardHeader>
            <CardContent>
              <RuleTestSandbox ruleId={selectedRule?.id} />
            </CardContent>
          </Card>
        ) : selectedRule || activeTab === 'design' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="min-w-0 truncate text-base">
                {selectedRule
                  ? `编辑规则：${selectedRule.code} ${selectedRule.name}`
                  : designerRuleSetContext?.label
                    ? `新建规则：${designerRuleSetContext.label}`
                    : '新建合同审核规则'}
              </CardTitle>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {selectedRule ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={translatingRuleId === selectedRule.id}
                      onClick={() => void handleTranslateRule(selectedRule)}
                    >
                      <SparklesIcon className="h-4 w-4 mr-1" />
                      转译
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/admin/contract-policies/rules/${selectedRule.id}/versions`, '_self')}
                    >
                      <GitBranchIcon className="h-4 w-4 mr-1" />
                      版本
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => onDelete(selectedRule.id)}>
                      <TrashIcon className="h-4 w-4 mr-1" />
                      停用
                    </Button>
                  </>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => setActiveTab('test')}>
                  <PlayIcon className="h-4 w-4 mr-1" />
                  测试用例
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <RuleDesigner
                initialRule={selectedRule || undefined}
                defaultRuleSet={designerRuleSetContext}
                saving={saving}
                onSave={handleSaveRule}
                onTest={() => setActiveTab('test')}
              />
            </CardContent>
          </Card>
        ) : (
          <RuleSetDetailEmptyState
            activeRuleSet={activeRuleSet}
            visibleRules={visibleRules}
            onNewRule={handleNewRule}
          />
        )}
	      {showRuleSetClosure ? (
	      <Card className="min-w-0">
        <CardHeader>
		          <CardTitle className="text-base">规则集闭环</CardTitle>
          <p className="mt-1 text-xs leading-5 text-slate-500">
	            这一栏只回答三件事：这个规则集能否用于正式审核、为什么被阻断、下一步由谁处理。
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-2">
	            <button
	              type="button"
	              onClick={() => setActiveTab('list')}
	              className="rounded-lg border border-slate-900 bg-slate-900 px-2 py-2 text-xs font-medium text-white"
	            >
				              规则清单
	            </button>
	            <button
	              type="button"
	              onClick={() => setActiveTab('design')}
	              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-600"
	            >
				              维护规则
	            </button>
	            <button
	              type="button"
	              onClick={() => setActiveTab('test')}
	              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-600"
	            >
				              测试命中
	            </button>
          </div>

          {feedback ? (
            <div className={`rounded-lg border px-3 py-2 text-xs leading-5 ${
              feedback.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
            >
              {feedback.message}
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium text-slate-500">当前规则集</div>
                <div className="mt-1 font-semibold text-slate-900">{activeRuleSet?.label || '无'}</div>
                <div className="mt-1 text-[11px] text-slate-500">
	                  {activeRuleSet?.source === 'ruleset'
	                    ? `规则集 v${activeRuleSet.asset?.version || 1} · ${lifecycleMap[activeRuleSet.asset?.lifecycle_status || 'draft']?.label || '草稿'} · ${translationMap[activeRuleSet.asset?.translation_status || 'not_started']?.label || '未转译'}`
	                    : activeRuleSet?.source === 'all'
	                      ? '全部规则资产汇总'
	                      : '按旧分类临时聚合，建议迁移为规则集资产'}
                </div>
              </div>
	              <Badge variant={!activeRuleSet?.total || activeRuleSet?.blocked ? 'destructive' : 'default'}>
	                {!activeRuleSet?.total ? '待补规则' : activeRuleSet?.blocked ? '不能正式审核' : '正式可用'}
	              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-lg font-semibold text-slate-900">{activeRuleSet?.total || 0}</div>
                <div className="text-[11px] text-slate-500">规则</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-900">{activeRuleSet?.active || 0}</div>
                <div className="text-[11px] text-slate-500">启用</div>
              </div>
	              <div>
	                <div className="text-lg font-semibold text-slate-900">{activeRuleSet?.published || 0}</div>
	                <div className="text-[11px] text-slate-500">正式可用</div>
	              </div>
	              <div>
	                <div className="text-lg font-semibold text-slate-900">{activeRuleSet?.ready || 0}</div>
	                <div className="text-[11px] text-slate-500">转译就绪</div>
	              </div>
            </div>
            {!activeRuleSet?.total ? (
              <div className="mt-3 rounded border border-rose-200 bg-white px-2 py-1 text-xs text-rose-700">
		                当前规则集还没有规则，不能进入正式审核。
              </div>
            ) : activeRuleSet?.blocked ? (
              <div className="mt-3 rounded border border-rose-200 bg-white px-2 py-1 text-xs text-rose-700">
		                {activeRuleSet.blocked} 条规则仍缺转译、发布或执行字段，不能进入正式审核。
              </div>
            ) : (
              <div className="mt-3 rounded border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-700">
	                当前规则集规则均满足发布、转译和执行字段要求，可进入正式审核编译检查。
              </div>
	            )}
	          </div>

          <RuleAssetProductMap activeRuleSet={activeRuleSet} />

          {activeRuleSetBlockedRules.length > 0 ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-rose-700">发布门禁明细</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950">
                    {activeRuleSetBlockedRules.length} 条规则需要处理
                  </div>
                </div>
                <Badge variant="destructive">不能正式审核</Badge>
              </div>
              <div className="mt-3 space-y-2">
                {activeRuleSetBlockedRules.slice(0, 6).map(({ rule, reasons }) => (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => {
                      setSelectedRule(rule)
                      setActiveTab('design')
                    }}
                    className="w-full rounded-md border border-rose-100 bg-white px-3 py-2 text-left transition hover:border-rose-300"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-semibold text-slate-900">
                        {rule.code} · {rule.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-rose-600">修正规则</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-rose-700">
                      {reasons.join(' / ')}
                    </div>
                  </button>
                ))}
                {activeRuleSetBlockedRules.length > 6 ? (
                  <div className="rounded-md border border-dashed border-rose-200 bg-white px-3 py-2 text-[11px] text-rose-700">
                    还有 {activeRuleSetBlockedRules.length - 6} 条阻断规则。请先处理当前列表中的高优先级规则。
                  </div>
                ) : null}
              </div>
            </div>
          ) : activeRuleSet?.total ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-700">
	              当前规则集没有发布阻断项；下一步应进入规则集发布、审核引擎编译和评测验收。
            </div>
          ) : null}

          <RuleSetReleasePipeline activeRuleSet={activeRuleSet} />

          {activeRuleSet?.source === 'ruleset' ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
	                  <div className="text-xs font-medium text-slate-500">规则集声明文档</div>
                  <div className="mt-1 font-medium text-slate-900">
                    v{activeRuleSet.asset?.latest_document?.version || '-'} · {activeRuleSet.asset?.latest_document?.status || '未创建'}
                  </div>
                </div>
                <Badge variant={activeRuleSet.asset?.latest_document?.translation_status === 'ready' ? 'default' : 'outline'}>
                  {activeRuleSet.asset?.latest_document?.translation_status || 'not_started'}
                </Badge>
              </div>
              <div className="mt-3 space-y-2">
                <input
                  className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400"
                  value={ruleSetDocumentDraft.title}
                  onChange={(event) => setRuleSetDocumentDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="规则集文档标题"
                />
                <Textarea
                  className="min-h-[180px] text-xs leading-5"
                  value={ruleSetDocumentDraft.content}
                  onChange={(event) => setRuleSetDocumentDraft((current) => ({ ...current, content: event.target.value }))}
                  placeholder="在这里维护 Markdown/自然语言规则声明。保存后只作为规则资产来源，必须转译为字段级 RuleUnit 并人工确认后才能发布。"
                />
                <Button
                  className="w-full"
                  size="sm"
                  disabled={savingRuleSetDocument || !ruleSetDocumentDraft.title.trim()}
                  onClick={() => void handleSaveRuleSetDocument()}
                >
                  {savingRuleSetDocument ? '保存中...' : '保存规则集文档版本'}
                </Button>
              </div>
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-5 text-amber-700">
	                文档只是高效维护入口；进入正式审核前必须显示字段级转译差异、人工确认并发布版本。
              </div>
            </div>
          ) : activeRuleSet?.source === 'clause_category' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-700">
	              当前只是旧规则分类视图，尚未绑定规则集声明文档。迁移应用后这里会显示可维护的规则集文档资产。
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">规则资产</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-semibold text-slate-900">{rules.length}</div>
                <div className="text-[11px] text-slate-500">总数</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-900">{rules.filter((rule) => rule.is_active).length}</div>
                <div className="text-[11px] text-slate-500">启用</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-900">{rules.filter(isFormallyPublishedRule).length}</div>
                <div className="text-[11px] text-slate-500">发布</div>
              </div>
            </div>
          </div>

	          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
		            选择左侧规则后，直接进入结构化规则配置器；规则集闭环只在总览态显示。
	          </div>
	        </CardContent>
		      </Card>
	      ) : null}
    </div>
	  </div>

    <Dialog open={createRuleSetOpen} onOpenChange={setCreateRuleSetOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建规则集</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500" htmlFor="new-rule-set-name">
              规则集名称
            </label>
            <Input
              id="new-rule-set-name"
              value={newRuleSetDraft.name}
              onChange={(event) => setNewRuleSetDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="如：验收与交付规则集"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500" htmlFor="new-rule-set-code">
              规则集编码
            </label>
            <Input
              id="new-rule-set-code"
              value={newRuleSetDraft.code}
              onChange={(event) => setNewRuleSetDraft((current) => ({ ...current, code: event.target.value }))}
              placeholder="如：ACCEPTANCE"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500" htmlFor="new-rule-set-description">
              业务说明
            </label>
            <Textarea
              id="new-rule-set-description"
              value={newRuleSetDraft.description}
              onChange={(event) => setNewRuleSetDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="说明这个规则集覆盖哪些合同风险、由谁维护、发布后服务哪个审核场景。"
              rows={4}
            />
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
            规则集创建后只是资产目录；进入正式审核前仍需补齐规则、转译确认、测试通过和发布版本。
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setCreateRuleSetOpen(false)}>
            取消
          </Button>
          <Button type="button" disabled={creatingRuleSet} onClick={() => void handleCreateRuleSet()}>
            {creatingRuleSet ? '创建中...' : '创建规则集'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
	  )
}

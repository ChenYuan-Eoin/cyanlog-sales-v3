'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertCircleIcon, CheckCircle2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  allowedConditionOperators,
  reconcileConditionForProperty,
  reconcileRuleContractForEditing,
  ruleContractMatrixIssues,
} from '@/app/api/contract-policies/rules/rule-contract'
import {
  createDefaultRuleContract,
  normalizeDurationUnit,
  normalizeRuleContract,
  resolveRuleContract,
  ruleContractConfigurationStatus,
} from '@/lib/rules/rule-contract'
import type {
  ContractPolicyRule,
  ContractProblemCategory,
  ContractRuleCondition,
  ContractRuleConditionOperator,
  ContractRuleContract,
  ContractRuleDecision,
  ContractRuleOutcome,
  ContractRuleProperty,
  ContractRulePropertyType,
} from '@/types/rules'

type RuleDraft = Partial<ContractPolicyRule>
type EditorTab = 'definition' | 'properties' | 'decisions' | 'validation'

interface RuleDesignerProps {
  initialRule?: ContractPolicyRule
  context?: {
    ruleSetId?: string | null
    ruleSetLabel?: string
    problemCategory?: ContractProblemCategory | null
    activePublishedVersion?: number
  }
  saving?: boolean
  onSave: (rule: RuleDraft) => void | Promise<void>
  onTest?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

const propertyTypeOptions: Array<{ value: ContractRulePropertyType; label: string }> = [
  { value: 'money', label: '金额' },
  { value: 'percentage', label: '比例' },
  { value: 'duration', label: '时限' },
  { value: 'date', label: '日期' },
  { value: 'enum', label: '枚举' },
  { value: 'boolean', label: '是 / 否' },
  { value: 'number', label: '数字' },
  { value: 'text', label: '文本' },
]

const outcomeOptions: Array<{ value: ContractRuleOutcome; label: string; tone: string }> = [
  { value: 'pass', label: '通过', tone: 'text-emerald-700' },
  { value: 'negotiate', label: '需谈判', tone: 'text-amber-700' },
  { value: 'block', label: '阻断', tone: 'text-rose-700' },
  { value: 'manual_review', label: '人工复核', tone: 'text-blue-700' },
]

const operatorOptions: Array<{ value: ContractRuleConditionOperator; label: string }> = [
  { value: '>=', label: '不少于' },
  { value: '<=', label: '不超过' },
  { value: '>', label: '大于' },
  { value: '<', label: '小于' },
  { value: '=', label: '等于' },
  { value: 'contains', label: '包含' },
  { value: 'in', label: '属于其中' },
  { value: 'exists', label: '已填写' },
  { value: 'not_exists', label: '未填写' },
]

const tabOptions: Array<{ value: EditorTab; label: string }> = [
  { value: 'definition', label: '基本信息' },
  { value: 'properties', label: '属性' },
  { value: 'decisions', label: '判定与处理' },
  { value: 'validation', label: '测试' },
]

function fromCsv(value: string) {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function newStableKey(prefix: 'property' | 'decision', existing: string[]) {
  let index = existing.length + 1
  while (existing.includes(`${prefix}_${index}`)) index += 1
  return `${prefix}_${index}`
}

function createProperty(existing: ContractRuleProperty[]): ContractRuleProperty {
  return {
    key: newStableKey('property', existing.map((item) => item.key)),
    label: '',
    description: '',
    type: 'money',
    required: true,
    currency: 'CNY',
  }
}

function defaultCondition(property: ContractRuleProperty): ContractRuleCondition {
  return reconcileConditionForProperty({
    property_key: property.key,
    operator: '=',
    value: property.type === 'boolean'
      ? true
      : property.type === 'enum'
        ? property.options?.[0]?.value || ''
        : '',
  }, property)
}

function reconcileEnumOptions(
  existing: ContractRuleProperty['options'],
  labels: string[]
): NonNullable<ContractRuleProperty['options']> {
  const available = [...(existing || [])]
  const used = new Set<string>()
  let nextNumber = 1
  return labels.map((label, index) => {
    const sameLabel = available.find((option) => option.label === label && !used.has(option.value))
    const samePosition = available[index] && !used.has(available[index].value) ? available[index] : undefined
    const retained = sameLabel || samePosition
    if (retained) {
      used.add(retained.value)
      return { value: retained.value, label }
    }
    while (used.has(`option_${nextNumber}`) || available.some((option) => option.value === `option_${nextNumber}`)) {
      nextNumber += 1
    }
    const value = `option_${nextNumber}`
    used.add(value)
    nextNumber += 1
    return { value, label }
  })
}

function createDecision(properties: ContractRuleProperty[], existing: ContractRuleDecision[]): ContractRuleDecision {
  const firstProperty = properties[0]
  return {
    id: newStableKey('decision', existing.map((item) => item.id)),
    label: '',
    outcome: 'manual_review',
    priority: Math.max(100, ...existing.map((item) => item.priority + 10)),
    match: 'all',
    conditions: firstProperty
      ? [defaultCondition(firstProperty)]
      : [],
    action: '',
    message: '',
  }
}

function cloneContract(contract: ContractRuleContract): ContractRuleContract {
  return {
    ...contract,
    properties: contract.properties.map((property) => ({
      ...property,
      options: property.options?.map((option) => ({ ...option })),
    })),
    decisions: contract.decisions.map((decision) => ({
      ...decision,
      conditions: decision.conditions.map((condition) => ({ ...condition })),
    })),
  }
}

function editorFingerprint(draft: RuleDraft, contract: ContractRuleContract) {
  return JSON.stringify({ draft, contract })
}

function valueForInput(value: ContractRuleCondition['value']) {
  if (Array.isArray(value)) return value.join('，')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value === undefined ? '' : String(value)
}

function parseConditionValue(
  value: string,
  property: ContractRuleProperty | undefined,
  operator: ContractRuleConditionOperator
): ContractRuleCondition['value'] {
  if (operator === 'in') return fromCsv(value)
  if (property?.type === 'number' || property?.type === 'money' || property?.type === 'percentage' || property?.type === 'duration') {
    const numeric = Number(value)
    return value.trim() && Number.isFinite(numeric) ? numeric : value
  }
  if (property?.type === 'boolean') return value === 'true'
  return value
}

function validationMessages(draft: RuleDraft, contract: ContractRuleContract) {
  const messages: string[] = []
  if (!draft.code?.trim()) messages.push('填写规则编码')
  if (!draft.name?.trim()) messages.push('填写规则名称')
  if (!draft.rule_set_id) messages.push('选择规则集')
  if (!draft.problem_category_id) messages.push('选择问题分类')
  if (contract.properties.length === 0) messages.push('至少添加一个属性')
  if (contract.properties.some((property) => !property.label.trim())) messages.push('补齐属性名称')
  if (contract.properties.some((property) => property.type === 'money' && !property.currency)) messages.push('为金额属性选择币种')
  if (contract.properties.some((property) => property.type === 'enum' && !property.options?.length)) messages.push('为枚举属性添加选项')
  if (contract.decisions.length === 0) messages.push('至少添加一条判定')
  if (contract.decisions.some((decision) => !decision.label.trim())) messages.push('补齐判定名称')
  if (contract.decisions.some((decision) => decision.conditions.length === 0)) messages.push('每条判定至少需要一个条件')
  if (!contract.decisions.some((decision) => decision.outcome !== 'pass')) messages.push('至少添加一条风险判定')
  if (contract.decisions.some((decision) => (
    decision.outcome !== 'pass' && (!decision.action?.trim() || !decision.message?.trim())
  ))) messages.push('为风险判定补齐处理动作和用户说明')
  messages.push(...ruleContractMatrixIssues(contract).map((issue) => issue.message))
  if (!normalizeRuleContract(contract)) messages.push('检查属性与判定之间的引用关系')
  return Array.from(new Set(messages))
}

export default function RuleDesigner({ initialRule, context, saving = false, onSave, onTest, onDirtyChange }: RuleDesignerProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>('definition')
  const [draft, setDraft] = useState<RuleDraft>({})
  const [contract, setContract] = useState<ContractRuleContract>(() => createDefaultRuleContract())
  const [feedback, setFeedback] = useState<string | null>(null)
  const [baselineFingerprint, setBaselineFingerprint] = useState('')
  const editorIdentity = initialRule
    ? `rule:${initialRule.id}:${initialRule.version}`
    : `new:${context?.ruleSetId || ''}:${context?.problemCategory?.id || ''}`

  useEffect(() => {
    let nextDraft: RuleDraft
    let nextContract: ContractRuleContract
    if (initialRule) {
      nextDraft = { ...initialRule }
      nextContract = reconcileRuleContractForEditing(resolveRuleContract(initialRule))
    } else {
      nextDraft = {
        code: '',
        name: '',
        description: '',
        business_domain: 'contract_review',
        rule_set_id: context?.ruleSetId || null,
        problem_category_id: context?.problemCategory?.id || null,
        problem_category: context?.problemCategory || null,
        applicable_scenarios: ['contract_review'],
        scope: 'org',
        priority: 100,
        is_active: true,
      }
      nextContract = createDefaultRuleContract()
    }
    setDraft(nextDraft)
    setContract(nextContract)
    setBaselineFingerprint(editorFingerprint(nextDraft, nextContract))
    setFeedback(null)
    setActiveTab('definition')
    // Parent fetches may replace object identities without changing the rule
    // being edited. Reset only when the actual draft identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorIdentity])

  const validation = useMemo(() => validationMessages(draft, contract), [contract, draft])
  const initialConfigurationStatus = initialRule ? ruleContractConfigurationStatus(initialRule) : 'canonical_complete'
  const isDirty = baselineFingerprint !== '' && editorFingerprint(draft, contract) !== baselineFingerprint

  useEffect(() => {
    onDirtyChange?.(isDirty)
    if (!isDirty) return
    const preventAccidentalClose = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventAccidentalClose)
    return () => window.removeEventListener('beforeunload', preventAccidentalClose)
  }, [isDirty, onDirtyChange])

  function updateDraft<K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateProperty(index: number, patch: Partial<ContractRuleProperty>) {
    setContract((current) => {
      const currentProperty = current.properties[index]
      if (!currentProperty) return current
      const nextProperty = { ...currentProperty, ...patch }
      return {
        ...current,
        properties: current.properties.map((property, propertyIndex) => (
          propertyIndex === index ? nextProperty : property
        )),
        decisions: current.decisions.map((decision) => ({
          ...decision,
          conditions: decision.conditions.map((condition) => (
            condition.property_key === nextProperty.key
              ? reconcileConditionForProperty(condition, nextProperty)
              : condition
          )),
        })),
      }
    })
  }

  function removeProperty(index: number) {
    setContract((current) => {
      const removedKey = current.properties[index]?.key
      return {
        ...current,
        properties: current.properties.filter((_, propertyIndex) => propertyIndex !== index),
        decisions: current.decisions.map((decision) => ({
          ...decision,
          conditions: decision.conditions.filter((condition) => condition.property_key !== removedKey),
        })),
      }
    })
  }

  function updateDecision(index: number, patch: Partial<ContractRuleDecision>) {
    setContract((current) => ({
      ...current,
      decisions: current.decisions.map((decision, decisionIndex) => (
        decisionIndex === index ? { ...decision, ...patch } : decision
      )),
    }))
  }

  function updateCondition(decisionIndex: number, conditionIndex: number, patch: Partial<ContractRuleCondition>) {
    setContract((current) => ({
      ...current,
      decisions: current.decisions.map((decision, currentDecisionIndex) => (
        currentDecisionIndex === decisionIndex
          ? {
              ...decision,
              conditions: decision.conditions.map((condition, currentConditionIndex) => (
                currentConditionIndex === conditionIndex ? { ...condition, ...patch } : condition
              )),
            }
          : decision
      )),
    }))
  }

  function addCondition(decisionIndex: number) {
    const property = contract.properties[0]
    if (!property) {
      setFeedback('请先在“属性”中添加业务属性。')
      setActiveTab('properties')
      return
    }
    const decision = contract.decisions[decisionIndex]
    updateDecision(decisionIndex, {
      conditions: [...decision.conditions, defaultCondition(property)],
    })
  }

  function removeCondition(decisionIndex: number, conditionIndex: number) {
    const decision = contract.decisions[decisionIndex]
    updateDecision(decisionIndex, {
      conditions: decision.conditions.filter((_, currentIndex) => currentIndex !== conditionIndex),
    })
  }

  function submit() {
    const missing = validationMessages(draft, contract)
    if (missing.length > 0) {
      setFeedback(`保存前还需：${missing.join('、')}。`)
      return
    }
    setFeedback(null)
    void onSave({
      code: draft.code,
      name: draft.name,
      description: draft.description || '',
      business_domain: draft.business_domain || 'contract_review',
      rule_set_id: draft.rule_set_id || context?.ruleSetId || null,
      problem_category_id: draft.problem_category_id || context?.problemCategory?.id || null,
      problem_category: draft.problem_category || context?.problemCategory || null,
      applicable_scenarios: ['contract_review'],
      scope: draft.scope || 'org',
      approval_roles: draft.approval_roles || [],
      priority: Number(draft.priority ?? 100),
      is_active: draft.is_active ?? true,
      rule_contract: cloneContract(contract),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">当前位置</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">
            {context?.ruleSetLabel || '未指定规则集'} / {draft.problem_category?.name || context?.problemCategory?.name || '未选择问题分类'} / {draft.name || '新规则'}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 font-medium ${
            draft.is_active === false && context?.activePublishedVersion
              ? 'bg-amber-100 text-amber-800'
              : draft.is_active === false
                ? 'bg-slate-200 text-slate-600'
                : context?.activePublishedVersion === draft.version
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-blue-50 text-blue-700'
          }`}>
            {draft.is_active === false && context?.activePublishedVersion
              ? `线上 v${context?.activePublishedVersion} · 待停用`
              : draft.is_active === false
                ? '待停用'
                : context?.activePublishedVersion === draft.version
                  ? `线上 v${context?.activePublishedVersion}`
                  : context?.activePublishedVersion
                    ? `线上 v${context?.activePublishedVersion} · 草稿 v${draft.version} 待发布`
                    : `草稿 v${draft.version || 1} · 尚未上线`}
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
            {contract.properties.length} 个属性 · {contract.decisions.length} 条判定
          </span>
        </div>
      </div>

      {feedback ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
          <AlertCircleIcon className="mt-1 h-4 w-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      ) : null}

      {initialConfigurationStatus === 'legacy_compatible' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900">
          这是一条旧规则。系统仍可按旧协议兼容运行，但这里展示的是迁移草稿；请逐项确认属性、判定和处理后保存，再完成测试矩阵并随规则集发布。
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)}>
        <div className="overflow-x-auto border-b border-slate-200">
          <TabsList variant="line" className="h-11 min-w-max gap-5 px-1">
            {tabOptions.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="h-10 px-1">
                {tab.label}
                {tab.value === 'properties' ? ` ${contract.properties.length}` : ''}
                {tab.value === 'decisions' ? ` ${contract.decisions.length}` : ''}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="definition" className="pt-4">
          <section className="grid gap-4 lg:grid-cols-2">
            <Field label="规则编码" htmlFor="rule-code">
              <Input
                id="rule-code"
                value={draft.code || ''}
                onChange={(event) => updateDraft('code', event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '_'))}
                placeholder="如：PAYMENT_MIN_AMOUNT"
                disabled={Boolean(initialRule)}
              />
            </Field>
            <Field label="规则名称" htmlFor="rule-name">
              <Input
                id="rule-name"
                value={draft.name || ''}
                onChange={(event) => updateDraft('name', event.target.value)}
                placeholder="如：合同金额不得低于 5 万元"
              />
            </Field>
            <div className="lg:col-span-2">
              <Field label="业务说明" htmlFor="rule-description">
                <Textarea
                  id="rule-description"
                  value={draft.description || ''}
                  onChange={(event) => updateDraft('description', event.target.value)}
                  placeholder="说明要管理的问题、适用边界和业务原因。"
                  rows={4}
                />
              </Field>
            </div>
            <Field label="应用模块" htmlFor="rule-business-module" hint="由业务模块选择规则资产，不在单条规则里自由填写">
              <div id="rule-business-module" className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                合同审核（当前产品固定）
              </div>
            </Field>
            <Field label="优先级" htmlFor="rule-priority" hint="数字越大越先判断">
              <Input
                id="rule-priority"
                type="number"
                min={0}
                value={draft.priority ?? 100}
                onChange={(event) => updateDraft('priority', Number(event.target.value))}
              />
            </Field>
            <Field label="规则状态" htmlFor="rule-status">
              <select
                id="rule-status"
                value={draft.is_active === false ? 'disabled' : 'enabled'}
                onChange={(event) => updateDraft('is_active', event.target.value === 'enabled')}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="enabled">启用</option>
                <option value="disabled">停用</option>
              </select>
            </Field>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-sm leading-6 text-blue-800">
              当前问题分类：<span className="font-semibold">{draft.problem_category?.name || context?.problemCategory?.name || '未选择'}</span>。分类用于组织问题，不用于定义属性类型。
            </div>
          </section>
        </TabsContent>

        <TabsContent value="properties" className="pt-4">
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">这条规则包含哪些业务属性</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">属性直接属于当前规则，是金额、比例、时限等判定条件的明确依据。</p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => setContract((current) => ({
                  ...current,
                  properties: [...current.properties, createProperty(current.properties)],
                }))}
              >
                <PlusIcon className="mr-1 h-4 w-4" />添加属性
              </Button>
            </div>

            {contract.properties.length === 0 ? (
              <EmptyBlock title="尚未添加属性" description="先添加这条规则真正需要判断的业务信息，例如合同金额、付款期限。" />
            ) : (
              <div className="space-y-3">
                {contract.properties.map((property, index) => (
                  <div key={property.key} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">属性 {index + 1}</div>
                      <Button type="button" variant="ghost" size="sm" className="text-rose-600" onClick={() => removeProperty(index)}>
                        <Trash2Icon className="mr-1 h-4 w-4" />删除
                      </Button>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Field label="属性名称" htmlFor={`property-label-${index}`}>
                        <Input
                          id={`property-label-${index}`}
                          value={property.label}
                          onChange={(event) => updateProperty(index, { label: event.target.value })}
                          placeholder="如：合同金额"
                        />
                      </Field>
                      <Field label="属性类型" htmlFor={`property-type-${index}`}>
                        <select
                          id={`property-type-${index}`}
                          value={property.type}
                          onChange={(event) => {
                            const type = event.target.value as ContractRulePropertyType
                            updateProperty(index, {
                              type,
                              currency: type === 'money' ? property.currency || 'CNY' : undefined,
                              unit: type === 'duration'
                                ? normalizeDurationUnit(property.unit) || 'day'
                                : type === 'percentage'
                                  ? 'percent'
                                  : type === 'number'
                                    ? property.unit
                                    : undefined,
                              options: type === 'enum' ? property.options || [] : undefined,
                            })
                          }}
                          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                        >
                          {propertyTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </Field>
                      <div className="lg:col-span-2">
                        <Field label="业务说明" htmlFor={`property-description-${index}`}>
                          <Textarea
                            id={`property-description-${index}`}
                            value={property.description || ''}
                            onChange={(event) => updateProperty(index, { description: event.target.value })}
                            placeholder="说明这个属性在合同中的业务含义。"
                            rows={2}
                          />
                        </Field>
                      </div>
                      {property.type === 'money' ? (
                        <Field label="币种" htmlFor={`property-currency-${index}`}>
                          <select
                            id={`property-currency-${index}`}
                            value={property.currency || 'CNY'}
                            onChange={(event) => updateProperty(index, { currency: event.target.value })}
                            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                          >
                            <option value="CNY">人民币 CNY</option>
                            <option value="USD">美元 USD</option>
                            <option value="EUR">欧元 EUR</option>
                          </select>
                        </Field>
                      ) : null}
                      {property.type === 'duration' ? (
                        <Field label="单位" htmlFor={`property-unit-${index}`}>
                          <select
                            id={`property-unit-${index}`}
                            value={normalizeDurationUnit(property.unit) || ''}
                            onChange={(event) => updateProperty(index, { unit: event.target.value })}
                            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                          >
                            <option value="" disabled>请选择单位</option>
                            <option value="day">天</option>
                            <option value="month">月</option>
                            <option value="year">年</option>
                          </select>
                        </Field>
                      ) : property.type === 'percentage' ? (
                        <Field label="单位" htmlFor={`property-unit-${index}`}>
                          <Input id={`property-unit-${index}`} value="%" disabled />
                        </Field>
                      ) : property.type === 'number' ? (
                        <Field label="单位" htmlFor={`property-unit-${index}`}>
                          <Input
                            id={`property-unit-${index}`}
                            value={property.unit || ''}
                            onChange={(event) => updateProperty(index, { unit: event.target.value.trim() || undefined })}
                            placeholder="如：份、次"
                          />
                        </Field>
                      ) : null}
                      {property.type === 'enum' ? (
                        <div className="lg:col-span-2">
                          <Field label="可选值" htmlFor={`property-options-${index}`} hint="多个选项用逗号分隔">
                            <Input
                              id={`property-options-${index}`}
                              value={property.options?.map((option) => option.label).join('，') || ''}
                              onChange={(event) => updateProperty(index, {
                                options: reconcileEnumOptions(property.options, fromCsv(event.target.value)),
                              })}
                              placeholder="如：预付款，分期付款，验收后付款"
                            />
                          </Field>
                        </div>
                      ) : null}
                      <label className="flex min-h-10 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={property.required}
                          onChange={(event) => updateProperty(index, { required: event.target.checked })}
                          className="h-4 w-4"
                        />
                        合同中必须有明确值
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="decisions" className="pt-4">
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">属性满足什么条件时，系统应如何处理</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">多条件必须明确选择“全部满足”或“任一满足”；优先级高的判定先执行。</p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (contract.properties.length === 0) {
                    setFeedback('请先在“属性”中添加业务属性。')
                    setActiveTab('properties')
                    return
                  }
                  setContract((current) => ({
                    ...current,
                    decisions: [...current.decisions, createDecision(current.properties, current.decisions)],
                  }))
                }}
              >
                <PlusIcon className="mr-1 h-4 w-4" />添加判定
              </Button>
            </div>

            {contract.decisions.length === 0 ? (
              <EmptyBlock title="尚未添加判定" description="先定义属性，再添加通过、谈判、阻断或人工复核条件。" />
            ) : (
              <div className="space-y-4">
                {contract.decisions.map((decision, decisionIndex) => (
                  <div key={decision.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{decisionIndex + 1}</span>
                        <Input
                          aria-label={`判定 ${decisionIndex + 1} 名称`}
                          value={decision.label}
                          onChange={(event) => updateDecision(decisionIndex, { label: event.target.value })}
                          placeholder="如：低于公司最低签约金额"
                          className="min-w-0 sm:w-80"
                        />
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="text-rose-600" onClick={() => setContract((current) => ({
                        ...current,
                        decisions: current.decisions.filter((_, currentIndex) => currentIndex !== decisionIndex),
                      }))}>
                        <Trash2Icon className="mr-1 h-4 w-4" />删除
                      </Button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                      <Field label="满足方式" htmlFor={`decision-match-${decisionIndex}`}>
                        <select
                          id={`decision-match-${decisionIndex}`}
                          value={decision.match}
                          onChange={(event) => updateDecision(decisionIndex, { match: event.target.value as 'all' | 'any' })}
                          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                        >
                          <option value="all">全部条件都满足</option>
                          <option value="any">任一条件满足</option>
                        </select>
                      </Field>
                      <Field label="判定结果" htmlFor={`decision-outcome-${decisionIndex}`}>
                        <select
                          id={`decision-outcome-${decisionIndex}`}
                          value={decision.outcome}
                          onChange={(event) => updateDecision(decisionIndex, { outcome: event.target.value as ContractRuleOutcome })}
                          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                        >
                          {outcomeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </Field>
                      <Field label="优先级" htmlFor={`decision-priority-${decisionIndex}`} hint="数字越大越先判断">
                        <Input
                          id={`decision-priority-${decisionIndex}`}
                          type="number"
                          min={0}
                          value={decision.priority}
                          onChange={(event) => updateDecision(decisionIndex, { priority: Number(event.target.value) })}
                        />
                      </Field>
                    </div>

                    <div className="mt-4 space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                      {decision.conditions.map((condition, conditionIndex) => {
                        const property = contract.properties.find((item) => item.key === condition.property_key)
                        const noValue = condition.operator === 'exists' || condition.operator === 'not_exists'
                        const availableOperators = property
                          ? allowedConditionOperators(property.type)
                          : operatorOptions.map((option) => option.value)
                        return (
                          <div key={`${decision.id}-${conditionIndex}`} className="grid gap-2 lg:grid-cols-[1fr_150px_1fr_40px] lg:items-end">
                            <Field label={conditionIndex === 0 ? '属性' : `属性 ${conditionIndex + 1}`} htmlFor={`condition-property-${decisionIndex}-${conditionIndex}`}>
                              <select
                                id={`condition-property-${decisionIndex}-${conditionIndex}`}
                                value={condition.property_key}
                                onChange={(event) => {
                                  const nextProperty = contract.properties.find((item) => item.key === event.target.value)
                                  if (nextProperty) updateCondition(decisionIndex, conditionIndex, defaultCondition(nextProperty))
                                }}
                                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                              >
                                {contract.properties.map((item) => <option key={item.key} value={item.key}>{item.label || `属性 ${item.key}`}</option>)}
                              </select>
                            </Field>
                            <Field label="比较方式" htmlFor={`condition-operator-${decisionIndex}-${conditionIndex}`}>
                              <select
                                id={`condition-operator-${decisionIndex}-${conditionIndex}`}
                                value={condition.operator}
                                onChange={(event) => {
                                  if (!property) return
                                  updateCondition(
                                    decisionIndex,
                                    conditionIndex,
                                    reconcileConditionForProperty({
                                      ...condition,
                                      operator: event.target.value as ContractRuleConditionOperator,
                                    }, property)
                                  )
                                }}
                                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                              >
                                {operatorOptions
                                  .filter((option) => availableOperators.includes(option.value))
                                  .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </Field>
                            <Field label="比较值" htmlFor={`condition-value-${decisionIndex}-${conditionIndex}`}>
                              {property?.type === 'boolean' ? (
                                <select
                                  id={`condition-value-${decisionIndex}-${conditionIndex}`}
                                  disabled={noValue}
                                  value={valueForInput(condition.value)}
                                  onChange={(event) => updateCondition(decisionIndex, conditionIndex, { value: event.target.value === 'true' })}
                                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-100"
                                >
                                  <option value="true">是</option>
                                  <option value="false">否</option>
                                </select>
                              ) : property?.type === 'enum' ? (
                                condition.operator === 'in' ? (
                                  <select
                                    id={`condition-value-${decisionIndex}-${conditionIndex}`}
                                    multiple
                                    disabled={noValue}
                                    value={Array.isArray(condition.value) ? condition.value.map(String) : []}
                                    onChange={(event) => updateCondition(decisionIndex, conditionIndex, {
                                      value: Array.from(event.target.selectedOptions, (option) => option.value),
                                    })}
                                    className="min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                                  >
                                    {(property.options || []).map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <select
                                    id={`condition-value-${decisionIndex}-${conditionIndex}`}
                                    disabled={noValue}
                                    value={noValue ? '' : valueForInput(condition.value)}
                                    onChange={(event) => updateCondition(decisionIndex, conditionIndex, { value: event.target.value })}
                                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-100"
                                  >
                                    <option value="">请选择</option>
                                    {(property.options || []).map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                )
                              ) : (
                                <Input
                                  id={`condition-value-${decisionIndex}-${conditionIndex}`}
                                  type={property?.type === 'date'
                                    ? 'date'
                                    : property && ['money', 'percentage', 'duration', 'number'].includes(property.type)
                                      ? 'number'
                                      : 'text'}
                                  step={property && ['money', 'percentage', 'duration', 'number'].includes(property.type) ? 'any' : undefined}
                                  disabled={noValue}
                                  value={noValue ? '' : valueForInput(condition.value)}
                                  onChange={(event) => updateCondition(decisionIndex, conditionIndex, {
                                    value: parseConditionValue(event.target.value, property, condition.operator),
                                  })}
                                  placeholder={noValue ? '无需填写' : property?.unit || property?.currency || '填写比较值'}
                                />
                              )}
                            </Field>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`删除条件 ${conditionIndex + 1}`}
                              className="text-rose-600"
                              onClick={() => removeCondition(decisionIndex, conditionIndex)}
                            >
                              <Trash2Icon className="h-4 w-4" />
                            </Button>
                          </div>
                        )
                      })}
                      <Button type="button" variant="outline" size="sm" onClick={() => addCondition(decisionIndex)}>
                        <PlusIcon className="mr-1 h-4 w-4" />添加条件
                      </Button>
                    </div>

                    <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
                      <Field
                        label={decision.outcome === 'pass' ? '通过后的处理（可选）' : '风险处理动作'}
                        htmlFor={`decision-action-${decisionIndex}`}
                      >
                        <Textarea
                          id={`decision-action-${decisionIndex}`}
                          value={decision.action || ''}
                          onChange={(event) => updateDecision(decisionIndex, { action: event.target.value })}
                          placeholder="如：由销售负责人补充例外审批，或调整合同条款。"
                          rows={3}
                        />
                      </Field>
                      <Field
                        label={decision.outcome === 'pass' ? '通过说明（可选）' : '给业务人员的风险说明'}
                        htmlFor={`decision-message-${decisionIndex}`}
                      >
                        <Textarea
                          id={`decision-message-${decisionIndex}`}
                          value={decision.message || ''}
                          onChange={(event) => updateDecision(decisionIndex, { message: event.target.value })}
                          placeholder="如：合同金额低于公司标准，请补充审批依据或调整金额。"
                          rows={3}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Field label="缺少明确值时" htmlFor="missing-evidence-outcome">
                <select
                  id="missing-evidence-outcome"
                  value={contract.missing_evidence_outcome}
                  onChange={(event) => setContract((current) => ({
                    ...current,
                    missing_evidence_outcome: event.target.value as ContractRuleContract['missing_evidence_outcome'],
                  }))}
                  className="h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm"
                >
                  <option value="manual_review">转人工复核</option>
                  <option value="block">直接阻断</option>
                </select>
              </Field>
              <p className="mt-2 text-xs leading-5 text-amber-800">未读取到必填值、单位冲突或同一内容出现多个无法判断的值时，不能默认通过。</p>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="validation" className="pt-4">
          <section className="space-y-4">
            <div className={`rounded-lg border p-4 ${
              validation.length === 0
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
            }`}>
              <div className="flex items-start gap-3">
                {validation.length === 0
                  ? <CheckCircle2Icon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  : <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {validation.length === 0 ? '规则结构完整，可以保存并测试' : '规则还不能进入测试'}
                  </div>
                  {validation.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-amber-800">
                      {validation.map((message) => <li key={message}>• {message}</li>)}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm leading-6 text-emerald-800">保存后请用真实合同段落验证正常、越界、缺失和冲突四类结果；正式生效由所属规则集统一发布。</p>
                  )}
                </div>
              </div>
            </div>
            {onTest ? (
              <Button type="button" variant="outline" disabled={validation.length > 0 || isDirty} onClick={onTest}>
                测试真实合同段落
              </Button>
            ) : null}
          </section>
        </TabsContent>
      </Tabs>

      <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white/95 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          {isDirty ? '当前有未保存修改；切换规则前请先保存或确认放弃。' : '保存的是当前规则草稿；正式审核只读取规则集发布版本。'}
        </p>
        <div className="flex items-center justify-end gap-2">
          {onTest ? <Button type="button" variant="outline" disabled={validation.length > 0 || isDirty} onClick={onTest}>测试</Button> : null}
          <Button type="button" disabled={saving || validation.length > 0} onClick={submit}>
            {saving ? '保存中...' : '保存草稿'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">{label}</Label>
        {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

function EmptyBlock({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
    </div>
  )
}

'use client'

import { cloneElement, isValidElement, useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type {
  ContractPolicyRule,
  ContractRuleCategory,
  ContractRuleEngineType,
  ContractRuleMessageTemplate,
  ContractRuleOperator,
  ContractRuleRiskLevel,
} from '@/types/rules'

type RuleDraft = Partial<ContractPolicyRule>

interface RuleDesignerProps {
  initialRule?: ContractPolicyRule
  defaultRuleSet?: {
    id?: string | null
    label?: string
    clauseCategory?: string
  }
  saving?: boolean
  onSave: (rule: RuleDraft) => void | Promise<void>
  onTest?: () => void
}

const categoryOptions: Array<{ value: ContractRuleCategory; label: string }> = [
  { value: 'duration', label: '时限判定' },
  { value: 'amount', label: '金额判定' },
  { value: 'ratio', label: '比例判定' },
  { value: 'enum', label: '主体/枚举判定' },
  { value: 'text', label: '语义判定' },
]

const engineOptions: Array<{ value: ContractRuleEngineType; label: string }> = [
  { value: 'structured', label: '字段规则' },
  { value: 'semantic', label: '语义识别' },
  { value: 'hybrid', label: '字段 + 语义' },
]

const operatorOptions: ContractRuleOperator[] = ['<=', '>=', '>', '<', '=', 'contains', 'in']
const operatorLabels: Record<ContractRuleOperator, string> = {
  '<=': '不超过',
  '>=': '不少于',
  '>': '超过',
  '<': '少于',
  '=': '等于',
  contains: '包含',
  in: '属于',
}

const riskLevelOptions: Array<{ value: ContractRuleRiskLevel; label: string }> = [
  { value: 'green', label: '无法判定时通过' },
  { value: 'yellow', label: '无法判定时需谈判' },
  { value: 'red', label: '无法判定时红线' },
]

const actionOptions = [
  { value: 'auto_approve', label: '验收通过' },
  { value: 'suggest_counterparty', label: '进入销售谈判' },
  { value: 'manual_review', label: '人工复核' },
  { value: 'block', label: '红线阻断' },
]

function formatOperatorLabel(value: ContractRuleOperator | undefined) {
  return value ? operatorLabels[value] || value : ''
}

function createDefaultRule(defaultRuleSet?: RuleDesignerProps['defaultRuleSet']): RuleDraft {
  return {
    code: '',
    name: '',
    description: '',
    business_domain: 'contract_review',
    risk_level: 'yellow',
    category: 'duration',
    engine_type: 'structured',
    target_field: 'payment_days',
    rule_set_id: defaultRuleSet?.id || null,
    clause_category: defaultRuleSet?.clauseCategory || '',
    field_hints: [],
    semantic_prompt: '',
    message_template: {
      title: '',
      description: '',
      suggestion: '',
      comment: '',
      negotiation_action: '',
      negotiation_required: false,
      owner_role: 'sales',
      bottom_line: '',
    },
    applicable_scenarios: [],
    scope: 'org',
    level_a_operator: '<=',
    level_a_threshold: 30,
    level_a_unit: 'day',
    level_a_action: 'auto_approve',
    level_b_operator: '>',
    level_b_threshold: 90,
    level_b_unit: 'day',
    level_b_action: 'suggest_counterparty',
    level_b_counterparty: '',
    level_c_operator: '>',
    level_c_threshold: 180,
    level_c_unit: 'day',
    level_c_action: 'block',
    level_c_message: '',
    approval_roles: [],
    priority: 100,
    is_active: true,
  }
}

function toCsv(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.join(', ') : ''
}

function fromCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function asMessageTemplate(value: ContractPolicyRule['message_template'] | undefined): ContractRuleMessageTemplate {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export default function RuleDesigner({ initialRule, defaultRuleSet, saving = false, onSave, onTest }: RuleDesignerProps) {
  const defaultRuleSetId = defaultRuleSet?.id || null
  const defaultRuleSetLabel = defaultRuleSet?.label || ''
  const defaultRuleSetClauseCategory = defaultRuleSet?.clauseCategory || ''
  const [draft, setDraft] = useState<RuleDraft>(() => initialRule || createDefaultRule({
    id: defaultRuleSetId,
    label: defaultRuleSetLabel,
    clauseCategory: defaultRuleSetClauseCategory,
  }))
  const [fieldHints, setFieldHints] = useState(() => toCsv(initialRule?.field_hints))
  const [scenarios, setScenarios] = useState(() => toCsv(initialRule?.applicable_scenarios))
  const messageTemplate = useMemo(() => asMessageTemplate(draft.message_template), [draft.message_template])
  const messageLevels = useMemo(() => (
    messageTemplate.levels && typeof messageTemplate.levels === 'object' && !Array.isArray(messageTemplate.levels)
      ? messageTemplate.levels
      : {}
  ), [messageTemplate.levels])

  useEffect(() => {
    const nextDraft = initialRule || createDefaultRule({
      id: defaultRuleSetId,
      label: defaultRuleSetLabel,
      clauseCategory: defaultRuleSetClauseCategory,
    })
    setDraft(nextDraft)
    setFieldHints(toCsv(nextDraft.field_hints))
    setScenarios(toCsv(nextDraft.applicable_scenarios))
  }, [defaultRuleSetClauseCategory, defaultRuleSetId, defaultRuleSetLabel, initialRule])

  const normalizedDraft = useMemo<RuleDraft>(() => ({
    ...draft,
    field_hints: fromCsv(fieldHints),
    applicable_scenarios: fromCsv(scenarios),
    message_template: messageTemplate,
    level_a_threshold: Number(draft.level_a_threshold ?? 0),
    level_b_threshold: Number(draft.level_b_threshold ?? 0),
    level_c_threshold: Number(draft.level_c_threshold ?? 0),
    priority: Number(draft.priority ?? 100),
  }), [draft, fieldHints, scenarios, messageTemplate])
  const showSemanticPrompt = (draft.engine_type || 'structured') !== 'structured'
    || draft.category === 'text'
    || Boolean((draft.semantic_prompt || '').trim())

  function update<K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateMessageTemplate<K extends keyof ContractRuleMessageTemplate>(
    key: K,
    value: ContractRuleMessageTemplate[K]
  ) {
    update('message_template', { ...messageTemplate, [key]: value })
  }

  function updateMessageTemplateLevel(key: string, value: string) {
    updateMessageTemplate('levels', { ...messageLevels, [key]: value })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void onSave(normalizedDraft)
      }}
    >
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        {!initialRule && defaultRuleSet?.label ? (
          <div className="mb-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
            当前会在“{defaultRuleSet.label}”下创建规则，保存后进入转译确认和发布门禁。
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-[120px_minmax(0,1fr)_120px]">
          <Field label="置灰 ID / 编码">
            <Input
              value={draft.code || ''}
              onChange={(event) => update('code', event.target.value)}
              placeholder="R1001"
              required
              disabled={Boolean(initialRule)}
              className={`font-mono ${initialRule ? 'bg-slate-100 text-slate-500' : 'bg-white'}`}
            />
          </Field>
          <Field label="规则名称">
            <Input
              value={draft.name || ''}
              onChange={(event) => update('name', event.target.value)}
              placeholder="预付款超标审查"
              required
              className="bg-white"
            />
          </Field>
          <Field label="状态">
            <select
              value={draft.is_active === false ? 'disabled' : 'enabled'}
              onChange={(event) => update('is_active', event.target.value === 'enabled')}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="enabled">启用</option>
              <option value="disabled">停用</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-950">1. 触发器与定位器</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            适用范围只决定规则在哪些业务里启用；关键词只负责定位原文；判定类型、字段、阈值决定红绿灯结果。
          </p>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800 lg:col-span-2">
            执行顺序：适用范围过滤 → 关键词/语义定位证据 → 字段或语义判定 → 红绿灯分档 → 输出客户批注和销售动作。
          </div>
          <Field label="定位关键词（找原文）">
            <Input
              value={fieldHints}
              onChange={(event) => setFieldHints(event.target.value)}
              placeholder="首付款, 账期, 验收后付款"
            />
          </Field>
          <Field label="适用范围（启用边界）">
            <Input
              value={scenarios}
              onChange={(event) => setScenarios(event.target.value)}
              placeholder="标准销售合同, 框架协议；不直接参与命中"
            />
          </Field>
          <Field label="判定类型">
            <Select
              value={draft.category || 'duration'}
              onChange={(value) => update('category', value as ContractRuleCategory)}
              options={categoryOptions}
            />
          </Field>
          <Field label="执行引擎">
            <Select
              value={draft.engine_type || 'structured'}
              onChange={(value) => update('engine_type', value as ContractRuleEngineType)}
              options={engineOptions}
            />
          </Field>
          <Field label="判定字段">
            <Input
              value={draft.target_field || ''}
              onChange={(event) => update('target_field', event.target.value)}
              placeholder="payment_schedule / payment_days"
            />
          </Field>
          <Field label="无法判定兜底等级">
            <Select
              value={draft.risk_level || 'yellow'}
              onChange={(value) => update('risk_level', value as ContractRuleRiskLevel)}
              options={riskLevelOptions}
            />
          </Field>
          {showSemanticPrompt ? (
          <div className="lg:col-span-2">
            <Field label="语义触发条件">
              <Textarea
                value={draft.semantic_prompt || ''}
                onChange={(event) => update('semantic_prompt', event.target.value)}
                placeholder="只描述机器需要理解的语义边界。例如：客户单方终止后要求全额退款且不计息。"
                rows={3}
                className="border-rose-200 bg-rose-50/70 text-slate-900 focus-visible:ring-rose-300"
              />
            </Field>
          </div>
          ) : null}
          <div className="lg:col-span-2">
            <Field label="例外条件 / 白名单">
              <Textarea
                value={messageLevels.exception || ''}
                onChange={(event) => updateMessageTemplateLevel('exception', event.target.value)}
                placeholder="例如：已上传特批签报，或项目所在地为海外。"
                rows={2}
                className="border-emerald-200 bg-emerald-50/70 text-slate-900 focus-visible:ring-emerald-300"
              />
            </Field>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 lg:col-span-2">
            <div className="text-xs font-medium text-slate-500">可读执行说明（不是发布结果）</div>
            <p className="mt-2 text-sm leading-6 text-slate-800">
              在{scenarios || '全部适用范围'}内，先用“{fromCsv(fieldHints).join(' / ') || draft.target_field || '未配置定位线索'}”定位证据，
              再由{engineOptions.find((item) => item.value === draft.engine_type)?.label || '规则引擎'}按“{categoryOptions.find((item) => item.value === draft.category)?.label || '未配置判定类型'}”判断：
              {draft.semantic_prompt || `${formatOperatorLabel(draft.level_b_operator)} ${draft.level_b_threshold ?? 0}${draft.level_b_unit || ''}`}。
              {messageLevels.exception ? ` 满足例外“${messageLevels.exception}”时不进入红线。` : ' 尚未配置例外。'}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-950">2. 判定器与红绿灯结果</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            红绿灯来自判定器输出，不来自上面的解释文案；每一档都必须有阈值和处理动作。
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          <LevelEditor
            label="绿色通过"
            operator={draft.level_a_operator || '<='}
            threshold={draft.level_a_threshold ?? 30}
            unit={draft.level_a_unit || ''}
            action={draft.level_a_action || 'auto_approve'}
            onOperatorChange={(value) => update('level_a_operator', value)}
            onThresholdChange={(value) => update('level_a_threshold', value)}
            onUnitChange={(value) => update('level_a_unit', value)}
            onActionChange={(value) => update('level_a_action', value)}
          />
          <LevelEditor
            label="黄色谈判"
            operator={draft.level_b_operator || '>'}
            threshold={draft.level_b_threshold ?? 90}
            unit={draft.level_b_unit || ''}
            action={draft.level_b_action || 'suggest_counterparty'}
            onOperatorChange={(value) => update('level_b_operator', value)}
            onThresholdChange={(value) => update('level_b_threshold', value)}
            onUnitChange={(value) => update('level_b_unit', value)}
            onActionChange={(value) => update('level_b_action', value)}
          />
          <LevelEditor
            label="红线阻断"
            operator={draft.level_c_operator || '>'}
            threshold={draft.level_c_threshold ?? 180}
            unit={draft.level_c_unit || ''}
            action={draft.level_c_action || 'block'}
            onOperatorChange={(value) => update('level_c_operator', value)}
            onThresholdChange={(value) => update('level_c_threshold', value)}
            onUnitChange={(value) => update('level_c_unit', value)}
            onActionChange={(value) => update('level_c_action', value)}
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-950">3. 输出动作与客户侧批注</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            客户侧只看到可执行修改建议；销售侧看到谈判口径；内部审核说明不写进客户批注。
          </p>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <Field label="客户侧批注标题">
            <Input
              value={messageTemplate.title || ''}
              onChange={(event) => updateMessageTemplate('title', event.target.value)}
              placeholder="预付款比例超标"
            />
          </Field>
          <Field label="客户侧修改建议">
            <Textarea
              value={messageTemplate.suggestion || ''}
              onChange={(event) => updateMessageTemplate('suggestion', event.target.value)}
              placeholder="写成客户能直接接受或修改的条款建议，不写规则编号、证据 ID 或内部判断过程。"
              rows={3}
            />
          </Field>
          <Field label="内部审核备注（不写入客户批注）">
            <Textarea
              value={messageTemplate.comment || ''}
              onChange={(event) => updateMessageTemplate('comment', event.target.value)}
              placeholder="请将该条款调整为双方可确认的付款节奏。"
              rows={3}
            />
          </Field>
          <Field label="销售谈判口径">
            <Textarea
              value={messageTemplate.negotiation_action || ''}
              onChange={(event) => updateMessageTemplate('negotiation_action', event.target.value)}
              placeholder="销售需要确认的客户反馈、可接受底线和下一步动作。"
              rows={3}
            />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {onTest ? (
          <Button type="button" variant="outline" onClick={onTest}>
            测试当前规则命中
          </Button>
        ) : null}
        <Button type="submit" disabled={saving}>
          {saving ? '保存中...' : '保存规则'}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const generatedId = useId()
  const childId = isValidElement(children)
    ? (children.props as { id?: string }).id
    : undefined
  const fieldId = childId || generatedId
  const labeledChildren = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-label'?: string }>, {
        id: fieldId,
        'aria-label': (children.props as { 'aria-label'?: string })['aria-label'] || label,
      })
    : children

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId} className="text-xs font-medium text-slate-500">{label}</Label>
      {labeledChildren}
    </div>
  )
}

function Select<T extends string>({
  id,
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: T
  onChange: (value: string) => void
  options: Array<{ value: T; label: string }>
  'aria-label'?: string
}) {
  return (
    <select
      id={id}
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function LevelEditor({
  label,
  operator,
  threshold,
  unit,
  action,
  onOperatorChange,
  onThresholdChange,
  onUnitChange,
  onActionChange,
}: {
  label: string
  operator: ContractRuleOperator
  threshold: number
  unit: string
  action: string
  onOperatorChange: (value: ContractRuleOperator) => void
  onThresholdChange: (value: number) => void
  onUnitChange: (value: string) => void
  onActionChange: (value: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[90px_120px_1fr_120px_160px] md:items-end">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <Field label="操作符">
        <select
          value={operator}
          onChange={(event) => onOperatorChange(event.target.value as ContractRuleOperator)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {operatorOptions.map((option) => (
            <option key={option} value={option}>{operatorLabels[option]}</option>
          ))}
        </select>
      </Field>
      <Field label="阈值">
        <Input
          type="number"
          value={threshold}
          onChange={(event) => onThresholdChange(Number(event.target.value))}
        />
      </Field>
      <Field label="单位">
        <Input
          value={unit}
          onChange={(event) => onUnitChange(event.target.value)}
          placeholder="天 / % / 元"
        />
      </Field>
      <Field label="处理动作">
        <select
          value={action}
          onChange={(event) => onActionChange(event.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {actionOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </Field>
    </div>
  )
}

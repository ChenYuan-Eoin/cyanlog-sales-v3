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
  { value: 'duration', label: '时限类' },
  { value: 'amount', label: '金额类' },
  { value: 'ratio', label: '比例类' },
  { value: 'enum', label: '枚举类' },
  { value: 'text', label: '条款语义' },
]

const engineOptions: Array<{ value: ContractRuleEngineType; label: string }> = [
  { value: 'structured', label: '结构化字段校验' },
  { value: 'semantic', label: 'AI 语义审查' },
  { value: 'hybrid', label: '字段 + 语义混合' },
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
  { value: 'green', label: '绿色' },
  { value: 'yellow', label: '黄色' },
  { value: 'red', label: '红线' },
]

const clauseCategoryOptions = [
  { value: '', label: '选择规则集目录' },
  { value: 'business_integrity', label: '审查逻辑 / 主体与金额一致性' },
  { value: 'acceptance', label: '审查逻辑 / 验收与交付' },
  { value: 'sla', label: '审查逻辑 / SLA 与服务承诺' },
  { value: 'dispute', label: '审查逻辑 / 争议解决' },
  { value: 'payment', label: '违约与责任 / 付款与结算' },
  { value: 'breach', label: '违约与责任 / 违约责任' },
  { value: 'liability', label: '违约与责任 / 责任边界' },
  { value: 'termination', label: '违约与责任 / 终止与退款' },
  { value: 'tax', label: '违约与责任 / 税务与发票' },
  { value: 'ip', label: '知识产权与数据 / 知识产权' },
  { value: 'data_security', label: '知识产权与数据 / 数据安全' },
  { value: 'confidentiality', label: '知识产权与数据 / 保密义务' },
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

function formatActionLabel(value: string | null | undefined) {
  return actionOptions.find((option) => option.value === value)?.label || value || '未配置'
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
  const isSemantic = draft.engine_type === 'semantic' || draft.category === 'text'
  const messageTemplate = useMemo(() => asMessageTemplate(draft.message_template), [draft.message_template])

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

  const ruleUnitPreview = useMemo(() => {
    const hints = fromCsv(fieldHints)
    const scenariosList = fromCsv(scenarios)
    const trigger = hints.length > 0
      ? hints.join(' / ')
      : draft.target_field || '未配置命中提示'
    const structuredRisk = `通过：${formatOperatorLabel(draft.level_a_operator)} ${draft.level_a_threshold ?? 0}${draft.level_a_unit || ''}；需谈判：${formatOperatorLabel(draft.level_b_operator)} ${draft.level_b_threshold ?? 0}${draft.level_b_unit || ''}；红线：${formatOperatorLabel(draft.level_c_operator)} ${draft.level_c_threshold ?? 0}${draft.level_c_unit || ''}`

    return [
      {
        label: '规则集',
        value: clauseCategoryOptions.find((item) => item.value === draft.clause_category)?.label || draft.clause_category || '未归类',
      },
      { label: '触发条件', value: trigger },
      { label: '风险条件', value: draft.semantic_prompt || structuredRisk },
      { label: '例外/通过条件', value: formatActionLabel(draft.level_a_action) },
      { label: '证据要求', value: 'evidence_text 必须 exact match，导出前必须有 source range' },
      {
        label: '谈判动作',
        value: messageTemplate.negotiation_required
          ? (messageTemplate.negotiation_action || '必须形成销售谈判任务')
          : '非强制谈判',
      },
      { label: '批注模板', value: messageTemplate.comment || messageTemplate.suggestion || '未配置客户可见批注模板' },
      { label: '适用场景', value: scenariosList.length ? scenariosList.join(' / ') : '全组织默认适用' },
    ]
  }, [draft, fieldHints, messageTemplate, scenarios])

  function update<K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateMessageTemplate<K extends keyof ContractRuleMessageTemplate>(
    key: K,
    value: ContractRuleMessageTemplate[K]
  ) {
    update('message_template', { ...messageTemplate, [key]: value })
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        void onSave(normalizedDraft)
      }}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {!initialRule && defaultRuleSet?.label ? (
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800 md:col-span-2">
            当前会在“{defaultRuleSet.label}”下创建规则，保存后进入转译确认和发布门禁。
          </div>
        ) : null}
        <Field label="规则编码（可由系统生成）">
          <Input
            value={draft.code || ''}
            onChange={(event) => update('code', event.target.value)}
            placeholder="PAYMENT_DAYS_STANDARD"
            required
          />
        </Field>
        <Field label="规则名称">
          <Input
            value={draft.name || ''}
            onChange={(event) => update('name', event.target.value)}
            placeholder="付款账期标准"
            required
          />
        </Field>
        <Field label="规则集目录">
          <Select
            value={draft.clause_category || ''}
            onChange={(value) => update('clause_category', value)}
            options={clauseCategoryOptions}
          />
        </Field>
        <Field label="风险等级">
          <Select
            value={draft.risk_level || 'yellow'}
            onChange={(value) => update('risk_level', value as ContractRuleRiskLevel)}
            options={riskLevelOptions}
          />
        </Field>
        <Field label="命中类型">
          <Select
            value={draft.category || 'duration'}
            onChange={(value) => update('category', value as ContractRuleCategory)}
            options={categoryOptions}
          />
        </Field>
        <Field label="执行方式">
          <Select
            value={draft.engine_type || 'structured'}
            onChange={(value) => update('engine_type', value as ContractRuleEngineType)}
            options={engineOptions}
          />
        </Field>
      </div>

      <Field label="规则描述">
        <Textarea
          value={draft.description || ''}
          onChange={(event) => update('description', event.target.value)}
          placeholder="说明规则适用的合同场景、风险判断依据和审批处理方式。"
          rows={3}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="原文定位线索 / 关键词">
          <Input
            value={fieldHints}
            onChange={(event) => setFieldHints(event.target.value)}
            placeholder="首期 / 账期 / 尾款 / 验收后付款"
          />
        </Field>
        <Field label="适用合同/场景">
          <Input
            value={scenarios}
            onChange={(event) => setScenarios(event.target.value)}
            placeholder="标准销售合同, 框架协议"
          />
        </Field>
      </div>

      <details className="rounded-lg border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-800">
          系统字段（高级）
          <span className="ml-2 text-xs font-normal text-slate-500">只在需要调整 RuleUnit 映射、执行顺序或底层字段时打开</span>
        </summary>
        <div className="grid grid-cols-1 gap-4 border-t border-slate-200 p-4 md:grid-cols-3">
          <Field label="业务域">
            <Input
              value={draft.business_domain || ''}
              onChange={(event) => update('business_domain', event.target.value)}
              placeholder="contract_review"
              required
            />
          </Field>
          <Field label="系统定位字段">
            <Input
              value={draft.target_field || ''}
              onChange={(event) => update('target_field', event.target.value)}
              placeholder="payment_days"
            />
          </Field>
          <Field label="执行顺序">
            <Input
              type="number"
              value={draft.priority ?? 100}
              onChange={(event) => update('priority', Number(event.target.value))}
            />
          </Field>
        </div>
      </details>

      {isSemantic ? (
        <Field label="审查语义">
          <Textarea
            value={draft.semantic_prompt || ''}
            onChange={(event) => update('semantic_prompt', event.target.value)}
            placeholder="描述需要从合同条款中识别的风险语义。"
            rows={4}
          />
        </Field>
      ) : null}

      <div className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-medium text-slate-900">批注与谈判模板</h3>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="风险标题模板">
              <Input
                value={messageTemplate.title || ''}
                onChange={(event) => updateMessageTemplate('title', event.target.value)}
                placeholder="如：付款节奏风险"
              />
            </Field>
            <Field label="责任角色">
              <Input
                value={messageTemplate.owner_role || ''}
                onChange={(event) => updateMessageTemplate('owner_role', event.target.value)}
                placeholder="sales / legal / finance"
              />
            </Field>
          </div>
          <Field label="风险说明模板">
            <Textarea
              value={messageTemplate.description || ''}
              onChange={(event) => updateMessageTemplate('description', event.target.value)}
              placeholder="描述命中该规则时应如何解释风险。"
              rows={3}
            />
          </Field>
          <Field label="批注文案模板">
            <Textarea
              value={messageTemplate.comment || ''}
              onChange={(event) => updateMessageTemplate('comment', event.target.value)}
              placeholder="写给客户可见的 Word 批注意见。"
              rows={3}
            />
          </Field>
          <Field label="销售谈判动作">
            <Textarea
              value={messageTemplate.negotiation_action || ''}
              onChange={(event) => updateMessageTemplate('negotiation_action', event.target.value)}
              placeholder="销售需要向客户争取、确认或让步的动作。"
              rows={3}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="修改建议">
              <Textarea
                value={messageTemplate.suggestion || ''}
                onChange={(event) => updateMessageTemplate('suggestion', event.target.value)}
                placeholder="内部建议或推荐替代条款。"
                rows={3}
              />
            </Field>
            <Field label="谈判底线">
              <Textarea
                value={messageTemplate.bottom_line || ''}
                onChange={(event) => updateMessageTemplate('bottom_line', event.target.value)}
                placeholder="不可突破的商业或法务底线。"
                rows={3}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(messageTemplate.negotiation_required)}
              onChange={(event) => updateMessageTemplate('negotiation_required', event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            必须进入销售谈判任务
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-indigo-200 bg-indigo-50/60">
        <div className="border-b border-indigo-100 px-4 py-3">
          <h3 className="text-sm font-medium text-slate-900">RuleUnit 执行单元预览</h3>
          <p className="mt-1 text-xs text-slate-600">
            保存后进入转译、人工确认、发布和引擎编译；这里用于确认规则不是黑盒文档。
          </p>
        </div>
        <div className="grid gap-2 p-4 md:grid-cols-2">
          {ruleUnitPreview.map((item) => (
            <div key={item.label} className="rounded-md border border-white/70 bg-white px-3 py-2">
              <div className="text-[11px] font-medium text-indigo-700">{item.label}</div>
              <div className="mt-1 min-h-5 break-words text-sm leading-5 text-slate-800">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-medium text-slate-900">风险等级阈值</h3>
        </div>
        <div className="divide-y divide-slate-100">
          <LevelEditor
            label="通过档"
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
            label="谈判档"
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
            label="红线档"
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
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="B 级会签建议">
          <Input
            value={draft.level_b_counterparty || ''}
            onChange={(event) => update('level_b_counterparty', event.target.value)}
            placeholder="法务、财务或销售负责人"
          />
        </Field>
        <Field label="C 级阻断提示">
          <Input
            value={draft.level_c_message || ''}
            onChange={(event) => update('level_c_message', event.target.value)}
            placeholder="超过红线阈值，需重新谈判条款"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={draft.is_active ?? true}
          onChange={(event) => update('is_active', event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        启用规则
      </label>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {onTest ? (
          <Button type="button" variant="outline" onClick={onTest}>
            测试规则
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

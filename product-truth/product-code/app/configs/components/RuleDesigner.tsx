'use client'

import { cloneElement, isValidElement, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type {
  ContractPolicyRule,
  ContractRuleCategory,
  ContractRuleEngineType,
  ContractRuleOperator,
} from '@/types/rules'

type RuleDraft = Partial<ContractPolicyRule>

interface RuleDesignerProps {
  initialRule?: ContractPolicyRule
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
  { value: 'structured', label: '结构化' },
  { value: 'semantic', label: '语义' },
  { value: 'hybrid', label: '混合' },
]

const operatorOptions: ContractRuleOperator[] = ['<=', '>=', '>', '<', '=', 'contains', 'in']

const actionOptions = [
  { value: 'auto_approve', label: '自动通过' },
  { value: 'suggest_counterparty', label: '建议会签' },
  { value: 'manual_review', label: '人工复核' },
  { value: 'block', label: '阻断' },
]

function createDefaultRule(): RuleDraft {
  return {
    code: '',
    name: '',
    description: '',
    category: 'duration',
    engine_type: 'structured',
    target_field: 'payment_days',
    clause_category: '',
    field_hints: [],
    semantic_prompt: '',
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

export default function RuleDesigner({ initialRule, saving = false, onSave, onTest }: RuleDesignerProps) {
  const [draft, setDraft] = useState<RuleDraft>(() => initialRule || createDefaultRule())
  const [fieldHints, setFieldHints] = useState(() => toCsv(initialRule?.field_hints))
  const [scenarios, setScenarios] = useState(() => toCsv(initialRule?.applicable_scenarios))
  const isSemantic = draft.engine_type === 'semantic' || draft.category === 'text'

  useEffect(() => {
    const nextDraft = initialRule || createDefaultRule()
    setDraft(nextDraft)
    setFieldHints(toCsv(nextDraft.field_hints))
    setScenarios(toCsv(nextDraft.applicable_scenarios))
  }, [initialRule])

  const normalizedDraft = useMemo<RuleDraft>(() => ({
    ...draft,
    field_hints: fromCsv(fieldHints),
    applicable_scenarios: fromCsv(scenarios),
    level_a_threshold: Number(draft.level_a_threshold ?? 0),
    level_b_threshold: Number(draft.level_b_threshold ?? 0),
    level_c_threshold: Number(draft.level_c_threshold ?? 0),
    priority: Number(draft.priority ?? 100),
  }), [draft, fieldHints, scenarios])

  function update<K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
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
        <Field label="规则编码">
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
        <Field label="规则分类">
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
        <Field label="目标字段">
          <Input
            value={draft.target_field || ''}
            onChange={(event) => update('target_field', event.target.value)}
            placeholder="payment_days"
          />
        </Field>
        <Field label="优先级">
          <Input
            type="number"
            value={draft.priority ?? 100}
            onChange={(event) => update('priority', Number(event.target.value))}
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
        <Field label="字段提示">
          <Input
            value={fieldHints}
            onChange={(event) => setFieldHints(event.target.value)}
            placeholder="payment_days, account_period"
          />
        </Field>
        <Field label="适用场景">
          <Input
            value={scenarios}
            onChange={(event) => setScenarios(event.target.value)}
            placeholder="标准销售合同, 框架协议"
          />
        </Field>
      </div>

      {isSemantic ? (
        <Field label="语义提示词">
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
          <h3 className="text-sm font-medium text-slate-900">风险等级阈值</h3>
        </div>
        <div className="divide-y divide-slate-100">
          <LevelEditor
            label="Level A"
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
            label="Level B"
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
            label="Level C"
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
  const labeledChildren = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-label'?: string }>, {
        'aria-label': (children.props as { 'aria-label'?: string })['aria-label'] || label,
      })
    : children

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-slate-500">{label}</Label>
      {labeledChildren}
    </div>
  )
}

function Select<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: T
  onChange: (value: string) => void
  options: Array<{ value: T; label: string }>
  'aria-label'?: string
}) {
  return (
    <select
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
            <option key={option} value={option}>{option}</option>
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
          placeholder="day"
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

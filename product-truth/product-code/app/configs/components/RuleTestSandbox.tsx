'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon, PlayIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { resolveRuleContract, type RulePropertyReading } from '@/lib/rules/rule-contract'
import type {
  ContractPolicyRule,
  ContractRuleCondition,
  ContractRuleDecision,
  ContractRuleOutcome,
  ContractRuleProperty,
  ContractRuleTestCaseKind,
} from '@/types/rules'

interface RuleTestResult {
  ruleId: string
  ruleCode: string
  ruleVersion: number
  ruleName: string
  status: 'decided' | 'missing_evidence' | 'no_decision'
  outcome: ContractRuleOutcome
  riskLevel: 'red' | 'yellow' | 'green'
  decision: {
    id: string
    label: string
    match: 'all' | 'any'
    outcome: ContractRuleOutcome
    action?: string | null
    message?: string | null
  } | null
  readings: RulePropertyReading[]
  evidence: string[]
  missingPropertyKeys: string[]
  ambiguousPropertyKeys: string[]
  unitConflictPropertyKeys: string[]
  assertion: {
    caseKind: ContractRuleTestCaseKind
    expectedStatus: 'decided' | 'missing_evidence' | 'no_decision'
    expectedOutcome: ContractRuleOutcome
    expectedDecisionId: string | null
    passed: boolean
  }
  testRunId?: string
  testedAt?: string
}

interface RuleTestResponse {
  test?: RuleTestResult
  error?: string
}

interface RuleTestSandboxProps {
  rule: ContractPolicyRule
  onTestSaved?: () => void | Promise<void>
}

const outcomeLabels: Record<ContractRuleOutcome, string> = {
  pass: '通过',
  negotiate: '需谈判',
  block: '阻断',
  manual_review: '人工复核',
}

const outcomeClasses: Record<ContractRuleOutcome, string> = {
  pass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  negotiate: 'border-amber-200 bg-amber-50 text-amber-800',
  block: 'border-rose-200 bg-rose-50 text-rose-800',
  manual_review: 'border-blue-200 bg-blue-50 text-blue-800',
}

function formattedPropertyValue(property: ContractRuleProperty, value?: ContractRuleCondition['value']) {
  const scalar = Array.isArray(value) ? value[0] : value
  switch (property.type) {
    case 'money': return `${property.label || '合同金额'}为${typeof scalar === 'number' ? scalar : 50000}${property.currency === 'USD' ? '美元' : property.currency === 'EUR' ? '欧元' : '元'}`
    case 'percentage': return `${property.label || '比例'}为${typeof scalar === 'number' ? scalar : 30}%`
    case 'duration': return `${property.label || '期限'}为${typeof scalar === 'number' ? scalar : 30}${property.unit === 'month' ? '个月' : property.unit === 'year' ? '年' : '天'}`
    case 'date': return `${property.label || '日期'}为${typeof scalar === 'string' ? scalar : '2026年8月1日'}`
    case 'enum': {
      const option = property.options?.find((candidate) => candidate.value === scalar)
      return `${property.label || '选项'}为${option?.label || property.options?.[0]?.label || '标准方式'}`
    }
    case 'boolean': return `${property.label || '是否满足'}：${scalar === false ? '否' : '是'}`
    case 'number': return `${property.label || '数量'}为${typeof scalar === 'number' ? scalar : 10}${property.unit || ''}`
    case 'text': return `${property.label || '约定内容'}为${typeof scalar === 'string' ? scalar : '双方书面确认'}`
  }
}

function valueThatMatches(condition: ContractRuleCondition) {
  if (typeof condition.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(condition.value)) {
    const date = new Date(`${condition.value}T00:00:00.000Z`)
    if (condition.operator === '>') date.setUTCDate(date.getUTCDate() + 1)
    if (condition.operator === '<') date.setUTCDate(date.getUTCDate() - 1)
    return date.toISOString().slice(0, 10)
  }
  if (typeof condition.value !== 'number') return condition.value
  if (condition.operator === '>') return condition.value + 1
  if (condition.operator === '<') return condition.value - 1
  return condition.value
}

function exampleForDecision(decision: ContractRuleDecision, properties: ContractRuleProperty[]) {
  const omittedKeys = new Set(
    decision.conditions.filter((condition) => condition.operator === 'not_exists').map((condition) => condition.property_key)
  )
  const conditionKeys = new Set(decision.conditions.map((condition) => condition.property_key))
  const clauses = decision.conditions.flatMap((condition) => {
    const property = properties.find((candidate) => candidate.key === condition.property_key)
    if (!property || condition.operator === 'not_exists') return []
    if (condition.operator === 'exists') return [formattedPropertyValue(property)]
    return [formattedPropertyValue(property, valueThatMatches(condition))]
  })
  // A decision example must still provide the other required properties.  If
  // they are omitted, runtime correctly stops at missing_evidence before it can
  // evaluate the target decision, making a valid multi-property rule impossible
  // to release from this UI.
  const requiredContext = properties
    .filter((property) => property.required && !conditionKeys.has(property.key) && !omittedKeys.has(property.key))
    .map((property) => formattedPropertyValue(property))
  const source = [...clauses, ...requiredContext]
  return `${source.join('；') || '合同其余条款均按双方书面约定执行'}。`
}

type AcceptanceExample = {
  label: string
  text: string
  caseKind: ContractRuleTestCaseKind
  expectedDecisionId?: string
}

function buildExamples(properties: ContractRuleProperty[], decisions: ContractRuleDecision[]): AcceptanceExample[] {
  // 发布门禁要求每条判定分别有一次精确通过记录，因此这里不能只
  // 暴露第一条风险和第一条通过判定。
  const examples: AcceptanceExample[] = decisions.map((decision) => ({
    label: `${decision.outcome === 'pass' ? '通过' : '风险'}：${decision.label}`,
    text: exampleForDecision(decision, properties),
    caseKind: decision.outcome === 'pass' ? 'pass' : 'risk',
    expectedDecisionId: decision.id,
  }))
  examples.push({
    label: '缺少证据',
    text: '合同仅说明双方后续协商，未写明本规则所需的具体信息。',
    caseKind: 'missing_evidence',
  })
  const conflictProperty = properties.find((property) => (
    property.type !== 'text'
    && (property.type !== 'enum' || (property.options?.length || 0) > 1)
  ))
  if (conflictProperty) examples.push({
    label: '同文多值冲突',
    text: conflictProperty.type === 'money'
      ? `${conflictProperty.label}为50000元；${conflictProperty.label}同时写为60000元。`
      : conflictProperty.type === 'percentage'
        ? `${conflictProperty.label}为20%；${conflictProperty.label}同时写为30%。`
        : conflictProperty.type === 'duration'
          ? `${conflictProperty.label}为30天；${conflictProperty.label}同时写为60天。`
          : conflictProperty.type === 'date'
            ? `${conflictProperty.label}为2026年8月1日；${conflictProperty.label}同时写为2026年9月1日。`
            : conflictProperty.type === 'enum' && (conflictProperty.options?.length || 0) > 1
              ? `${conflictProperty.label}为${conflictProperty.options?.[0]?.label}；${conflictProperty.label}同时写为${conflictProperty.options?.[1]?.label}。`
              : conflictProperty.type === 'boolean'
                ? `${conflictProperty.label}明确允许，同时又约定不允许。`
                : `${conflictProperty.label}为10；${conflictProperty.label}同时写为20。`,
    caseKind: 'value_conflict',
  })
  // Current deterministic runtime defines a hard unit conflict only for
  // currency mismatch. Duration units are intentionally converted, not failed.
  const unitProperty = properties.find((property) => property.type === 'money' && property.currency)
  if (unitProperty) examples.push({
    label: '单位冲突',
    text: `${unitProperty.label}为50000${unitProperty.currency === 'USD' ? '元人民币' : '美元'}，与规则币种${unitProperty.currency}不一致。`,
    caseKind: 'unit_conflict',
  })
  return examples
}

export default function RuleTestSandbox({ rule, onTestSaved }: RuleTestSandboxProps) {
  const contract = useMemo(() => resolveRuleContract(rule), [rule])
  const examples = useMemo(() => buildExamples(contract.properties, contract.decisions), [contract.decisions, contract.properties])
  const [text, setText] = useState(examples[0]?.text || '')
  const [caseKind, setCaseKind] = useState<ContractRuleTestCaseKind>(examples[0]?.caseKind || 'risk')
  const [expectedDecisionId, setExpectedDecisionId] = useState<string | undefined>(examples[0]?.expectedDecisionId)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RuleTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const first = examples[0]
    if (!first) return
    setText(first.text)
    setCaseKind(first.caseKind)
    setExpectedDecisionId(first.expectedDecisionId)
    setResult(null)
    setError(null)
  }, [examples, rule.id, rule.version])

  async function runTest() {
    if (text.trim().length < 10) {
      setError('请至少输入 10 个字的真实合同段落。')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/rules/test', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          rule_id: rule.id,
          case_kind: caseKind,
          expected_decision_id: expectedDecisionId,
        }),
      })
      const payload = await response.json().catch(() => ({})) as RuleTestResponse
      if (!response.ok || !payload.test) {
        throw new Error(payload.error || '规则测试失败')
      }
      setResult(payload.test)
      await onTestSaved?.()
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '规则测试失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">当前测试规则</div>
            <div className="mt-1 text-sm text-slate-600">{rule.code} · {rule.name} · v{rule.version || 1}</div>
          </div>
          <Badge variant="outline">{contract.properties.length} 个属性 · {contract.decisions.length} 条判定</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {contract.properties.map((property) => (
            <span key={property.key} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
              {property.label} · {property.required ? '必填' : '可选'}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="rule-test-source" className="text-sm font-medium text-slate-800">测试合同原文</label>
        <Textarea
          id="rule-test-source"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="粘贴一段真实合同原文，系统会按当前规则读取属性并执行判定。"
          rows={7}
        />
        <div className="flex flex-wrap gap-2">
          {examples.map((example) => (
            <Button key={`${example.caseKind}:${example.expectedDecisionId || example.label}`} type="button" variant="outline" size="sm" onClick={() => {
              setText(example.text)
              setCaseKind(example.caseKind)
              setExpectedDecisionId(example.expectedDecisionId)
              setResult(null)
              setError(null)
            }}>
              {example.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          当前验收目标：{caseKind === 'risk' ? '命中指定风险判定' : caseKind === 'pass' ? '命中指定通过判定' : caseKind === 'unit_conflict' ? '发现币种冲突并转人工' : caseKind === 'value_conflict' ? '发现同文多值冲突并转人工' : '缺少证据时转人工'}。
          每条判定都要分别验收；示例只是可编辑起点，只有实际结果与当前目标完全一致才计入发布门禁。若总被另一条高优先级判定覆盖，应修正规则条件，而不是伪造通过记录。
        </p>
      </div>

      <Button type="button" onClick={() => void runTest()} disabled={loading || text.trim().length < 10}>
        {loading ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <PlayIcon className="mr-2 h-4 w-4" />}
        {loading ? '测试中...' : '运行测试'}
      </Button>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <div className={`rounded-lg border p-4 ${result.assertion.passed ? outcomeClasses[result.outcome] : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {result.outcome === 'pass'
                  ? <CheckCircle2Icon className="h-5 w-5" />
                  : <AlertCircleIcon className="h-5 w-5" />}
                {result.assertion.passed ? '验收通过' : '验收未通过'} · 实际结果：{outcomeLabels[result.outcome]}
              </div>
              <span className="text-xs">{result.decision?.label || '未形成明确判定'}</span>
            </div>
            {result.decision?.message ? <p className="mt-3 text-sm leading-6">{result.decision.message}</p> : null}
            {result.decision?.action ? <p className="mt-2 text-sm leading-6"><span className="font-medium">处理：</span>{result.decision.action}</p> : null}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">属性读取结果</div>
              <p className="mt-1 text-xs text-slate-500">逐项核对合同原文、读取值和单位；缺失或冲突不会默认通过。</p>
            </div>
            <div className="divide-y divide-slate-100">
              {contract.properties.map((property) => {
                const reading = result.readings.find((item) => item.property_key === property.key)
                const statusLabel = reading?.status === 'read'
                  ? '已读取'
                  : reading?.status === 'ambiguous'
                    ? '存在多个值'
                    : reading?.status === 'unit_conflict'
                      ? '单位冲突'
                      : '缺少明确值'
                return (
                  <div key={property.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[150px_1fr_auto] sm:items-center">
                    <div className="text-sm font-medium text-slate-800">{property.label}</div>
                    <div className="min-w-0 text-sm text-slate-600">
                      {reading?.status === 'read'
                        ? `${String(reading.value ?? '')}${reading.unit || property.unit || property.currency || ''}`
                        : reading?.evidence || '原文没有可确认的信息'}
                    </div>
                    <span className={`w-fit rounded-full px-2 py-1 text-xs ${
                      reading?.status === 'read' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {statusLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {result.evidence.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">原文依据</div>
              <div className="mt-2 space-y-2">
                {result.evidence.map((evidence, index) => (
                  <blockquote key={`${evidence}-${index}`} className="border-l-2 border-blue-300 pl-3 text-sm leading-6 text-slate-600">{evidence}</blockquote>
                ))}
              </div>
            </div>
          ) : null}

          {result.testRunId ? (
            <p className={`text-xs ${result.assertion.passed ? 'text-emerald-700' : 'text-rose-700'}`}>
              {result.assertion.passed
                ? '本次断言已保存，可计入当前规则版本的发布矩阵。'
                : '本次结果已留痕，但不会计入发布通过；请修正规则或测试原文后重试。'}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

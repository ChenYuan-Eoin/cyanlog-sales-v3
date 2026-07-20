'use client'

import { useMemo, useState } from 'react'
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon, PlayIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { resolveRuleContract, type RulePropertyReading } from '@/lib/rules/rule-contract'
import type { ContractPolicyRule, ContractRuleOutcome, ContractRuleProperty } from '@/types/rules'

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
}

interface RuleTestResponse {
  test?: RuleTestResult
  error?: string
}

interface RuleTestSandboxProps {
  rule: ContractPolicyRule
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

function exampleForProperty(property: ContractRuleProperty) {
  switch (property.type) {
    case 'money': return `${property.label || '合同金额'}为50000元`
    case 'percentage': return `${property.label || '比例'}为30%`
    case 'duration': return `${property.label || '期限'}为30天`
    case 'date': return `${property.label || '日期'}为2026年8月1日`
    case 'enum': return `${property.label || '选项'}为${property.options?.[0]?.label || '标准方式'}`
    case 'boolean': return `${property.label || '是否满足'}为是`
    case 'number': return `${property.label || '数量'}为10`
    case 'text': return `${property.label || '约定内容'}为双方书面确认`
  }
}

function buildExamples(properties: ContractRuleProperty[]) {
  const normal = properties.length > 0
    ? `${properties.map(exampleForProperty).join('；')}。`
    : '本合同约定付款期限为30天，双方按约履行。'
  const first = properties[0]
  const conflict = first
    ? first.type === 'money'
      ? `${first.label}一处约定为50000元，另一处约定为60000元。`
      : first.type === 'percentage'
        ? `${first.label}一处约定为20%，另一处约定为30%。`
        : first.type === 'duration'
          ? `${first.label}一处约定为30天，另一处约定为60天。`
          : `${first.label}在合同不同位置存在不一致约定。`
    : '合同不同位置存在不一致约定，需要人工确认。'
  return [
    { label: '完整示例', text: normal },
    { label: '缺少明确值', text: '合同仅说明双方后续协商，未写明本规则所需的具体信息。' },
    { label: '冲突示例', text: conflict },
  ]
}

export default function RuleTestSandbox({ rule }: RuleTestSandboxProps) {
  const contract = useMemo(() => resolveRuleContract(rule), [rule])
  const examples = useMemo(() => buildExamples(contract.properties), [contract.properties])
  const [text, setText] = useState(examples[0]?.text || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RuleTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        body: JSON.stringify({ text, rule_id: rule.id }),
      })
      const payload = await response.json().catch(() => ({})) as RuleTestResponse
      if (!response.ok || !payload.test) {
        throw new Error(payload.error || '规则测试失败')
      }
      setResult(payload.test)
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
            <Button key={example.label} type="button" variant="outline" size="sm" onClick={() => {
              setText(example.text)
              setResult(null)
              setError(null)
            }}>
              {example.label}
            </Button>
          ))}
        </div>
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
          <div className={`rounded-lg border p-4 ${outcomeClasses[result.outcome]}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {result.outcome === 'pass'
                  ? <CheckCircle2Icon className="h-5 w-5" />
                  : <AlertCircleIcon className="h-5 w-5" />}
                判定结果：{outcomeLabels[result.outcome]}
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
                const statusLabel = reading?.status === 'read' ? '已读取' : reading?.status === 'ambiguous' ? '存在冲突' : '缺少明确值'
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
        </div>
      ) : null}
    </div>
  )
}

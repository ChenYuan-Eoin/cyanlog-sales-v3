'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2Icon, CheckCircleIcon, XCircleIcon } from 'lucide-react'

interface TestCase {
  id: string
  name: string
  field: string
  value: number
  unit: string
}

interface TestResult {
  ruleId: string
  ruleName: string
  matched: boolean
  level: 'A' | 'B' | 'C' | null
  action: string
  message: string
  counterparty?: string
}

interface RuleTestSandboxProps {
  ruleId?: string
}

export default function RuleTestSandbox({ ruleId }: RuleTestSandboxProps) {
  const [testValue, setTestValue] = useState('')
  const [testUnit, setTestUnit] = useState('day')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<TestResult[]>([])

  const runTest = async () => {
    if (!testValue) return
    setLoading(true)

    try {
      const response = await fetch('/api/rules/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `付款账期${testValue}${testUnit === 'day' ? '天' : testUnit}`,
          field: 'payment_days',
          value: parseFloat(testValue),
          unit: testUnit,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        // 转换API结果为TestResult格式
        const testResults: TestResult[] = data.risks?.map((risk: { title: string; level: string; description: string; suggestion: string }) => ({
          ruleId: 'test',
          ruleName: risk.title,
          matched: true,
          level: risk.level === 'red' ? 'C' : risk.level === 'yellow' ? 'B' : 'A',
          action: risk.level === 'red' ? 'block' : risk.level === 'yellow' ? 'suggest_counterparty' : 'auto_approve',
          message: risk.description,
          counterparty: risk.suggestion,
        })) || []
        setResults(testResults)
      }
    } catch (error) {
      console.error('Test failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const levelColors = {
    A: 'bg-green-100 text-green-800 border-green-200',
    B: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    C: 'bg-red-100 text-red-800 border-red-200',
  }

  const levelLabels = {
    A: '🟢 通过',
    B: '🟡 偏离',
    C: '🔴 红线',
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          规则测试沙盒
          <Badge variant="outline">实时验证</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 测试输入 */}
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              type="number"
              value={testValue}
              onChange={(e) => setTestValue(e.target.value)}
              placeholder="输入测试值，如：60"
            />
          </div>
          <select
            value={testUnit}
            onChange={(e) => setTestUnit(e.target.value)}
            className="border rounded-md px-3 py-2"
          >
            <option value="day">天</option>
            <option value="month">月</option>
            <option value="percent">%</option>
            <option value="amount">元</option>
          </select>
          <Button onClick={runTest} disabled={loading || !testValue}>
            {loading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : '运行测试'}
          </Button>
        </div>

        {/* 测试结果 */}
        {results.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-slate-700">测试结果</h4>
            {results.map((result, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border ${result.level ? levelColors[result.level] : 'bg-slate-50 border-slate-200'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{result.ruleName}</span>
                  <Badge variant="outline">
                    {result.level ? levelLabels[result.level] : '未命中'}
                  </Badge>
                </div>
                <p className="text-sm mt-1">{result.message}</p>
                {result.counterparty && (
                  <p className="text-sm mt-1 text-slate-600">
                    💡 建议: {result.counterparty}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 测试用例模板 */}
        <div className="pt-4 border-t">
          <h4 className="text-sm font-medium text-slate-700 mb-2">快速测试用例</h4>
          <div className="flex flex-wrap gap-2">
            {['30', '60', '90', '120', '180', '200'].map((val) => (
              <button
                key={val}
                onClick={() => {
                  setTestValue(val)
                  setTestUnit('day')
                }}
                className="px-3 py-1 text-sm border rounded-full hover:bg-slate-50 transition"
              >
                {val}天
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

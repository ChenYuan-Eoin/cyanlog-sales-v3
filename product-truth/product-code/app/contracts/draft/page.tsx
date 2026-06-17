// REQ:F005 - 合同起草页面
// PURPOSE: AI 智能起草 / 模板起草 / 上传合同起草

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SparklesIcon, FileTextIcon, UploadIcon, LoaderIcon, CheckIcon } from 'lucide-react'
import Link from 'next/link'

type DraftMode = 'ai_generate' | 'template' | 'upload'
type ContractType = '销售合同' | '服务合同' | '采购合同' | '技术开发合同' | '租赁合同' | '其他'

interface GeneratedDraft {
  content: string
  word_count: number
  mode: DraftMode
  contract_type: string
  party_a: string
  party_b: string
}

const CONTRACT_TYPES: ContractType[] = ['销售合同', '服务合同', '采购合同', '技术开发合同', '租赁合同', '其他']

export default function ContractDraftPage() {
  const [mode, setMode] = useState<DraftMode>('ai_generate')
  const [purpose, setPurpose] = useState('')
  const [partyA, setPartyA] = useState('')
  const [partyB, setPartyB] = useState('')
  const [contractType, setContractType] = useState<ContractType>('销售合同')
  const [keyTerms, setKeyTerms] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedDraft | null>(null)
  const [error, setError] = useState('')
  const [contracts, setContracts] = useState<Array<{ id: string; filename: string }>>([])
  const [templateContractId, setTemplateContractId] = useState('')

  // 加载已上传的合同列表（用于&quot;上传合同起草&quot;和&quot;模板起草&quot;）
  useEffect(() => {
    void (async () => {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/contracts', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          const list = data.data?.contracts || data.contracts || []
          setContracts(list)
        }
      } catch { /* ignore */ }
    })()
  }, [])

  async function handleGenerate() {
    if (!purpose.trim()) {
      setError('请填写合同签署目的')
      return
    }
    if (!partyA.trim() || !partyB.trim()) {
      setError('请填写甲乙双方信息')
      return
    }
    if ((mode === 'template' || mode === 'upload') && !templateContractId) {
      setError('请选择源合同')
      return
    }

    setGenerating(true)
    setError('')
    setGenerated(null)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/contracts/draft', {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode,
          purpose,
          party_a: partyA,
          party_b: partyB,
          contract_type: contractType,
          key_terms: keyTerms || undefined,
          source_contract_id: (mode === 'template' || mode === 'upload') ? templateContractId : undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '起草失败')
        return
      }

      setGenerated(data.data)
    } catch {
      setError('网络错误，起草失败')
    } finally {
      setGenerating(false)
    }
  }

  function handleCopy() {
    if (generated) {
      void navigator.clipboard.writeText(generated.content)
    }
  }

  function handleDownload() {
    if (!generated) return
    const blob = new Blob([generated.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${contractType}-${Date.now()}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* 顶部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-slate-500 mb-1">
            <Link href="/contracts" className="hover:underline">合同审核</Link>
            <span className="mx-2">/</span>
            <span>合同起草</span>
          </div>
          <h1 className="text-2xl font-bold">合同起草</h1>
        </div>
        <Link href="/contracts">
          <Button variant="outline">返回列表</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧：起草表单 */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">请选择合同起草方式</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={mode} onValueChange={(v) => setMode(v as DraftMode)}>
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="ai_generate" className="text-xs">
                    <SparklesIcon className="h-4 w-4 mr-1" />
                    AI 智能起草
                  </TabsTrigger>
                  <TabsTrigger value="template" className="text-xs">
                    <FileTextIcon className="h-4 w-4 mr-1" />
                    模板起草
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="text-xs">
                    <UploadIcon className="h-4 w-4 mr-1" />
                    上传合同起草
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="ai_generate" className="mt-4">
                  <p className="text-sm text-slate-600">
                    AI 将根据您提供的关键信息自动生成完整合同。条款内容基于企业条款库 + AI 生成。
                  </p>
                </TabsContent>
                <TabsContent value="template" className="mt-4">
                  <p className="text-sm text-slate-600">
                    选择已有合同作为模板，AI 将替换甲乙双方信息和签署目的。
                  </p>
                </TabsContent>
                <TabsContent value="upload" className="mt-4">
                  <p className="text-sm text-slate-600">
                    直接使用已上传合同的解析文本作为起草内容。
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">合同信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 选择源合同（模板/上传模式） */}
              {(mode === 'template' || mode === 'upload') && (
                <div>
                  <label className="text-sm font-medium">选择源合同</label>
                  <Select value={templateContractId} onValueChange={setTemplateContractId}>
                    <SelectTrigger>
                      <SelectValue placeholder="请选择" />
                    </SelectTrigger>
                    <SelectContent>
                      {contracts.length === 0 ? (
                        <SelectItem value="__empty" disabled>
                          暂无可用合同，请先上传
                        </SelectItem>
                      ) : contracts.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.filename}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* 合同类型 */}
              <div>
                <label className="text-sm font-medium">合同类型</label>
                <Select value={contractType} onValueChange={(v) => setContractType(v as ContractType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 甲乙双方 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">甲方（委托方）</label>
                  <Input
                    placeholder="例如：XX 科技有限公司"
                    value={partyA}
                    onChange={(e) => setPartyA(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">乙方（受托方）</label>
                  <Input
                    placeholder="例如：YY 商贸公司"
                    value={partyB}
                    onChange={(e) => setPartyB(e.target.value)}
                  />
                </div>
              </div>

              {/* 合同签署目的 */}
              <div>
                <label className="text-sm font-medium">
                  合同签署目的 <span className="text-red-500">*</span>
                </label>
                <Textarea
                  placeholder="例如：甲方向乙方采购 JONES Project 项目管理系统-ONES Team 版本 195 个账号，按年付费..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  rows={4}
                />
              </div>

              {/* 关键条款（AI 模式可填） */}
              {mode === 'ai_generate' && (
                <div>
                  <label className="text-sm font-medium">关键条款要求（可选）</label>
                  <Textarea
                    placeholder="例如：付款方式为月付，违约金不超过合同总额 30%，知识产权归甲方..."
                    value={keyTerms}
                    onChange={(e) => setKeyTerms(e.target.value)}
                    rows={3}
                  />
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  {error}
                </div>
              )}

              <Button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full"
              >
                {generating ? (
                  <>
                    <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                    正在起草中...
                  </>
                ) : (
                  <>
                    <SparklesIcon className="h-4 w-4 mr-2" />
                    开始起草
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：起草结果 */}
        <div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">合同内容</CardTitle>
                {generated && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                      复制
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDownload}>
                      下载
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {generated ? (
                <div>
                  <div className="flex items-center gap-2 mb-3 text-sm text-slate-500">
                    <CheckIcon className="h-4 w-4 text-green-500" />
                    <span>已生成 {generated.word_count} 字</span>
                    <span>·</span>
                    <span>{generated.contract_type}</span>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm bg-slate-50 p-4 rounded-lg max-h-[600px] overflow-y-auto border">
                    {generated.content}
                  </pre>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <SparklesIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">填写左侧合同信息后点击&quot;开始起草&quot;</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

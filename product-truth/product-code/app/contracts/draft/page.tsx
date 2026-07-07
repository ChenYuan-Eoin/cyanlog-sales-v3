'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeftIcon,
  PenToolIcon,
  SparklesIcon,
  InfoIcon,
  SaveIcon,
  LoaderIcon,
  FileTextIcon,
} from 'lucide-react'
import type { ContractTemplateParam } from '../types'
import { success, error } from '@/lib/toast'

interface DraftData {
  title: string
  party_a_name: string
  party_b_name: string
  party_b_contact: string
  contract_amount: string
  business_params: Record<string, string | number | boolean>
  clause_toggles: Record<string, boolean>
}

export default function ContractDraftPage() {
  const [params, setParams] = useState<ContractTemplateParam[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  const [draft, setDraft] = useState<DraftData>({
    title: '',
    party_a_name: '',
    party_b_name: '',
    party_b_contact: '',
    contract_amount: '',
    business_params: {},
    clause_toggles: {},
  })

  // 模板选择
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string; category: string }>>([])

  // 报价单选择（CRM 联动 TC-07）
  const [selectedQuote, setSelectedQuote] = useState<string>('')
  const [quotes, setQuotes] = useState<Array<{ id: string; quote_no: string; customer_name: string; total_amount: number; status: string }>>([])

  const [aiAddition, setAiAddition] = useState('')
  const [generatedContent, setGeneratedContent] = useState('')

  // 加载模板参数
  useEffect(() => {
    async function loadParams() {
      try {
        const token = localStorage.getItem('token')

        // 加载模板列表
        const tplRes = await fetch('/api/contracts/templates', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (tplRes.ok) {
          const tplData = await tplRes.json()
          setTemplates(tplData.data || [])
        }

        // 加载报价单列表（CRM 联动 TC-07）
        const quotesRes = await fetch('/api/quotes?status=APPROVED&pageSize=50', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (quotesRes.ok) {
          const quotesData = await quotesRes.json()
          setQuotes(quotesData.data?.data || [])
        }

        const res = await fetch('/api/contracts/template-params', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          const fetchedParams = (data.data || []) as ContractTemplateParam[]
          setParams(fetchedParams)
          // 初始化默认值
          const defaults: Record<string, string | number | boolean> = {}
          const toggles: Record<string, boolean> = {}
          for (const p of fetchedParams) {
            if (p.param_type === 'toggle') {
              toggles[p.param_key] = (p.default_value as { value?: boolean })?.value ?? false
            } else if (p.default_value) {
              defaults[p.param_key] = (p.default_value as { value?: string | number }).value ?? ''
            }
          }
          setDraft((prev) => ({
            ...prev,
            business_params: defaults,
            clause_toggles: toggles,
          }))
        }
      } catch (err) {
        // 静默处理参数加载错误，不影响主要功能
        console.warn('加载模板参数失败', err)
      } finally {
        setLoading(false)
      }
    }
    void loadParams()
  }, [])

  const updateParam = useCallback((key: string, value: string | number | boolean) => {
    setDraft((prev) => ({
      ...prev,
      business_params: { ...prev.business_params, [key]: value },
    }))
  }, [])

  const updateToggle = useCallback((key: string, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      clause_toggles: { ...prev.clause_toggles, [key]: value },
    }))
  }, [])

  // 选择报价单后自动填充客户信息（CRM 联动 TC-07）
  const handleSelectQuote = useCallback((quoteId: string) => {
    setSelectedQuote(quoteId)
    const quote = quotes.find((q) => q.id === quoteId)
    if (quote) {
      setDraft((prev) => ({
        ...prev,
        party_b_name: quote.customer_name,
        contract_amount: quote.total_amount.toString(),
      }))
    }
  }, [quotes])

  const handleSaveDraft = useCallback(async () => {
    if (!draft.title.trim()) {
      error('请输入合同标题')
      return
    }
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/contracts/drafts', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: draft.title,
          party_a_name: draft.party_a_name,
          party_b_name: draft.party_b_name,
          party_b_contact: draft.party_b_contact,
          contract_amount: draft.contract_amount ? Number(draft.contract_amount) : undefined,
          business_params: draft.business_params,
          clause_toggles: draft.clause_toggles,
          quote_id: selectedQuote || undefined,
        }),
      })
      if (res.ok) {
        success('草稿已保存')
      } else {
        const err = await res.json().catch(() => ({}))
        error(err.error || '保存失败')
      }
    } catch {
      error('保存失败')
    } finally {
      setSaving(false)
    }
  }, [draft, selectedQuote])

  const handleGenerate = useCallback(async () => {
    if (!draft.title.trim()) {
      error('请输入合同标题')
      return
    }
    setGenerating(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/contracts/draft', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'ai_generate',
          purpose: draft.title,
          party_a: draft.party_a_name || '甲方',
          party_b: draft.party_b_name || '乙方',
          contract_type: '系统服务协议',
          key_terms: Object.entries(draft.business_params)
            .map(([k, v]) => `${k}: ${v}`)
            .join('；'),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setGeneratedContent(data.data?.content || '')
      } else {
        const err = await res.json().catch(() => ({}))
        error(err.error || '生成失败')
      }
    } catch {
      error('生成失败')
    } finally {
      setGenerating(false)
    }
  }, [draft])

  const groupedParams = useMemo(() => {
    const enums = params.filter((p) => p.param_type === 'enum')
    const toggles = params.filter((p) => p.param_type === 'toggle')
    return { enums, toggles }
  }, [params])

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500">加载参数配置...</div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="flex h-screen">
        {/* 左侧：参数配置面板 */}
        <aside className="w-[360px] bg-white border-r border-slate-200 flex flex-col overflow-hidden 2xl:w-[390px]">
          <div className="h-14 border-b border-slate-200 flex items-center px-5 gap-3 flex-shrink-0">
            <Link href="/contracts">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeftIcon className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="font-bold text-slate-900 flex-1">合同起草</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              disabled={saving}
            >
              <SaveIcon className="h-3.5 w-3.5 mr-1" />
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* 模板选择 */}
            <section className="rounded-lg border border-blue-100 bg-blue-50 p-3">
              <h3 className="text-sm font-bold text-blue-950">起草目标</h3>
              <p className="mt-1 text-xs leading-5 text-blue-800">
                输入业务需求后，系统提取交易要素、匹配模板和条款限制，生成可修改草案；草案必须能进入合同审核，而不是停留在一次性文本。
              </p>
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <FileTextIcon className="h-4 w-4 text-indigo-500" />
                选择合同模板
              </h3>
              <div className="space-y-2">
                {templates.length === 0 ? (
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                    <p className="text-xs text-slate-500 mb-2">暂无可用模板</p>
                    <p className="text-[10px] text-slate-400">请联系管理员在配置中心添加模板</p>
                  </div>
                ) : (
                  templates.map((tpl) => (
                    <Card
                      key={tpl.id}
                      className={`cursor-pointer transition-all hover:shadow-md ${
                        selectedTemplate === tpl.id ? 'border-indigo-300 ring-1 ring-indigo-200 bg-indigo-50/30' : ''
                      }`}
                      onClick={() => setSelectedTemplate(tpl.id)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${selectedTemplate === tpl.id ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                            <div>
                              <p className="text-sm font-medium text-slate-900">{tpl.name}</p>
                              <p className="text-[10px] text-slate-500">{tpl.description}</p>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {tpl.category}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
                {!selectedTemplate && templates.length > 0 && (
                  <p className="text-xs text-amber-600 mt-2">请先选择一个模板以继续</p>
                )}
              </div>
            </section>

            {/* 报价单选择（CRM 联动 TC-07） */}
            <section>
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px]">¥</span>
                关联报价单（可选）
              </h3>
              <div className="space-y-2">
                {quotes.length === 0 ? (
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-xs text-slate-500">暂无已审批的报价单</p>
                  </div>
                ) : (
                  <>
                    <select
                      className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={selectedQuote}
                      onChange={(e) => handleSelectQuote(e.target.value)}
                    >
                      <option value="">选择报价单（自动带入客户/金额）</option>
                      {quotes.map((quote) => (
                        <option key={quote.id} value={quote.id}>
                          {quote.quote_no} · {quote.customer_name} · ¥{quote.total_amount?.toLocaleString()}
                        </option>
                      ))}
                    </select>
                    {selectedQuote && (
                      <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-xs">
                        <p className="text-emerald-800">
                          <span className="font-medium">已关联报价单：</span>
                          {quotes.find((q) => q.id === selectedQuote)?.quote_no}
                        </p>
                        <p className="text-emerald-700 mt-1">
                          客户和金额已自动填充
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* 基础信息 */}
            <section>
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <PenToolIcon className="h-4 w-4 text-indigo-500" />
                基础信息
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">合同标题</label>
                  <Input
                    placeholder="如：ONES 系统服务续费合同"
                    value={draft.title}
                    onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">甲方</label>
                    <Input
                      placeholder="我方公司名称"
                      value={draft.party_a_name}
                      onChange={(e) => setDraft((p) => ({ ...p, party_a_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">乙方</label>
                    <Input
                      placeholder="客户公司名称"
                      value={draft.party_b_name}
                      onChange={(e) => setDraft((p) => ({ ...p, party_b_name: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">联系人</label>
                    <Input
                      placeholder="乙方联系人"
                      value={draft.party_b_contact}
                      onChange={(e) => setDraft((p) => ({ ...p, party_b_contact: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">合同金额</label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={draft.contract_amount}
                      onChange={(e) => setDraft((p) => ({ ...p, contract_amount: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* 业务参数 */}
            {groupedParams.enums.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-900 mb-3">业务参数</h3>
                <div className="space-y-3">
                  {groupedParams.enums.map((param) => (
                    <div key={param.id}>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">{param.param_label}</label>
                      <select
                        className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-md text-sm"
                        value={String(draft.business_params[param.param_key] || '')}
                        onChange={(e) => updateParam(param.param_key, e.target.value)}
                      >
                        <option value="">请选择</option>
                        {(param.param_options || []).map((opt: { value: string; label: string }) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 条款开关 */}
            {groupedParams.toggles.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-900 mb-3">条款开关</h3>
                <div className="space-y-3">
                  {groupedParams.toggles.map((param) => (
                    <div key={param.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <span className="text-xs font-bold text-slate-700 block">{param.param_label}</span>
                        <span className="text-[10px] text-slate-400">启用后自动追加相关条款</span>
                      </div>
                      <Checkbox
                        checked={!!draft.clause_toggles[param.param_key]}
                        onCheckedChange={(value) => updateToggle(param.param_key, value === true)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* AI 增补 */}
            <section>
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <SparklesIcon className="h-4 w-4 text-indigo-500" />
                AI 增补诉求
              </h3>
              <div className="relative">
                <Textarea
                  placeholder="例如：要求乙方在交付后提供不少于3天的现场培训..."
                  value={aiAddition}
                  onChange={(e) => setAiAddition(e.target.value)}
                  className="min-h-[120px] resize-none"
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-1 text-[10px] text-indigo-400">
                  <SparklesIcon className="h-3 w-3" />
                  AI 智能转换
                </div>
              </div>
            </section>
          </div>

          {/* 底部操作 */}
          <div className="p-4 border-t border-slate-200 space-y-2 flex-shrink-0">
            <Button className="w-full" onClick={handleGenerate} disabled={generating}>
              {generating ? (
                <>
                  <LoaderIcon className="h-4 w-4 mr-1.5 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <SparklesIcon className="h-4 w-4 mr-1.5" />
                  AI 生成合同
                </>
              )}
            </Button>
          </div>
        </aside>

        {/* 右侧：实时预览 */}
        <main className="flex-1 bg-slate-100 overflow-auto p-6 xl:p-8">
          <div className="max-w-[800px] mx-auto bg-white min-h-[1100px] p-16 shadow-sm rounded-lg relative">
            <div className="absolute top-6 right-8 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {generatedContent ? 'Generated' : 'Live Preview'}
              </span>
            </div>

            {generatedContent ? (
              <div className="space-y-6 text-sm leading-relaxed text-slate-700">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{generatedContent}</pre>
              </div>
            ) : (
              <DraftPreview draft={draft} />
            )}
          </div>
        </main>
        <aside className="hidden w-80 flex-col border-l border-slate-200 bg-white xl:flex">
          <DraftWorkflowPanel
            selectedTemplate={selectedTemplate}
            selectedQuote={selectedQuote}
            hasRequirement={Boolean(aiAddition.trim() || draft.title.trim())}
            hasGeneratedContent={Boolean(generatedContent)}
          />
        </aside>
      </div>
    </div>
  )
}

function DraftWorkflowPanel({
  selectedTemplate,
  selectedQuote,
  hasRequirement,
  hasGeneratedContent,
}: {
  selectedTemplate: string
  selectedQuote: string
  hasRequirement: boolean
  hasGeneratedContent: boolean
}) {
  const steps = [
    {
      label: '需求理解',
      value: hasRequirement ? '已有业务诉求' : '等待标题或补充诉求',
      done: hasRequirement,
    },
    {
      label: '模板约束',
      value: selectedTemplate ? '已选择模板' : '请选择合同模板',
      done: Boolean(selectedTemplate),
    },
    {
      label: 'CRM 补全',
      value: selectedQuote ? '报价已带入' : '可选报价单补全客户和金额',
      done: Boolean(selectedQuote),
    },
    {
      label: '生成草案',
      value: hasGeneratedContent ? '草案已生成' : '等待生成',
      done: hasGeneratedContent,
    },
    {
      label: '进入审核',
      value: hasGeneratedContent ? '下一步应创建 ContractVersion 并预审' : '生成后进入审核链路',
      done: false,
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 p-4">
        <div className="text-xs font-medium text-slate-500">起草闭环</div>
        <h2 className="mt-1 text-base font-semibold text-slate-950">需求 → 模板 → 草案 → 预审</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          合同起草是合同中心第三条独立能力，产物应进入版本流和审核工作台。
        </p>
      </div>
      <div className="space-y-3 overflow-y-auto p-4">
        {steps.map((step, index) => (
          <div key={step.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                step.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {step.done ? '✓' : index + 1}
              </span>
              <span className="font-medium text-slate-900">{step.label}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{step.value}</p>
          </div>
        ))}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          当前仍是起草 MVP：已表达闭环路径，但“生成后自动建版本并预审”需要后续接入合同版本流。
        </div>
      </div>
    </div>
  )
}

// 参数配置预览（骨架）
function DraftPreview({ draft }: { draft: DraftData }) {
  return (
    <div className="space-y-10 text-sm leading-relaxed text-slate-700">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-slate-900">{draft.title || '合同标题'}</h2>
        <p className="text-[10px] text-slate-300 mt-2 font-mono">PREVIEW MODE</p>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase mb-2">甲方 (采购方)</p>
          <p className="bg-indigo-50/50 px-2 py-1 rounded text-indigo-700">{draft.party_a_name || '甲方名称'}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase mb-2">乙方 (供应商)</p>
          <p className="bg-indigo-50/50 px-2 py-1 rounded text-indigo-700">{draft.party_b_name || '乙方名称'}</p>
        </div>
      </div>

      <div className="border-l-4 border-indigo-200 pl-4 py-2">
        <h4 className="font-bold text-slate-900 mb-2">第二条 费用与结算</h4>
        <p>
          本合同总金额为人民币{' '}
          <span className="bg-amber-50 px-1 rounded text-amber-700 font-bold">
            {draft.contract_amount ? `¥${Number(draft.contract_amount).toLocaleString()}` : '金额待填写'}
          </span>
        </p>
        <div className="mt-2 p-2 bg-indigo-50/50 rounded border border-indigo-50 flex items-center text-[10px] text-indigo-400 italic gap-2">
          <InfoIcon className="h-3 w-3 shrink-0" />
          已根据左侧参数配置自动生成
        </div>
      </div>

      {Object.entries(draft.clause_toggles).some(([, v]) => v) && (
        <div>
          <h4 className="font-bold text-slate-900 mb-3">第三条 知识产权保护</h4>
          <p className="text-slate-600">乙方承诺其所提供的软件产品不侵犯任何第三方的知识产权...</p>
          <p className="mt-2 text-indigo-600 italic text-xs">由于开启了&quot;加强保护模式&quot;，此处已自动追加相关条款。</p>
        </div>
      )}

      <div className="border-t pt-8 mt-8">
        <div className="grid grid-cols-2 gap-16">
          <div>
            <p className="font-medium">甲方（盖章）：{draft.party_a_name || '____'}</p>
            <p className="text-slate-400 mt-4">法定代表人/授权代表：________________</p>
            <p className="text-slate-400 mt-2">日期：____年__月__日</p>
          </div>
          <div>
            <p className="font-medium">乙方（盖章）：{draft.party_b_name || '____'}</p>
            <p className="text-slate-400 mt-4">法定代表人/授权代表：________________</p>
            <p className="text-slate-400 mt-2">日期：____年__月__日</p>
          </div>
        </div>
      </div>
    </div>
  )
}

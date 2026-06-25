'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  ArrowLeftIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  LoaderIcon,
  SendIcon,
  MessageSquareIcon,
  LightbulbIcon,
  UserIcon,
  BotIcon,
  ShieldCheckIcon,
  XCircleIcon,
  RotateCcwIcon,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { error as toastError, handleError, confirmAction } from '@/lib/toast'

const ClauseReviewWorkshop = dynamic(() => import('./components/ClauseReviewWorkshop'), { ssr: false })

interface RiskCardData {
  id: string
  level: 'red' | 'yellow' | 'green' | 'white'
  title: string
  description?: string
  suggestion?: string
  clause_ref?: string
  auto_fixable: boolean
  status: 'open' | 'fixed' | 'accepted' | 'ignored'
}

interface ContractReviewData {
  id: string
  filename: string
  parsed_text?: string
  status: string
  riskCards: RiskCardData[]
  stats: {
    total: number
    red: number
    yellow: number
    green: number
    open: number
  }
  latestReview: {
    results?: {
      summary?: string
    }
  } | null
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export default function ContractReviewPage() {
  const params = useParams()
  const contractId = params.id as string

  const [contract, setContract] = useState<ContractReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // AI 聊天
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 左侧导航标签
  const [activeTab, setActiveTab] = useState<'risks' | 'clauses'>('risks')

  const fetchReviewData = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/review`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        if (res.status === 401) setErrorMsg('未登录或登录已过期')
        else setErrorMsg('获取审核结果失败')
        return
      }

      const data = await res.json()
      setContract(data.data)
    } catch {
      setErrorMsg('网络错误')
    } finally {
      setLoading(false)
    }
  }, [contractId])

  useEffect(() => {
    void fetchReviewData()
  }, [fetchReviewData])

  // 加载聊天历史
  useEffect(() => {
    async function loadChats() {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/contracts/${contractId}/ai-chat`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          setChatMessages(data.data || [])
        }
      } catch (err) {
        console.warn('加载聊天记录失败', err)
      }
    }
    void loadChats()
  }, [contractId])

  // 一键修复
  const handleFix = useCallback(async (cardId: string) => {
    setFixingId(cardId)
    try {
      const token = localStorage.getItem('token')
      await fetch(`/api/contracts/${contractId}/risk-cards/${cardId}/fix`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      await fetchReviewData()
    } catch {
      toastError('修复失败')
    } finally {
      setFixingId(null)
    }
  }, [contractId, fetchReviewData])

  // 发送聊天消息
  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim()) return
    setChatLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/ai-chat`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: chatInput }),
      })
      if (res.ok) {
        const data = await res.json()
        setChatMessages((prev) => [...prev, data.data.userMessage, data.data.assistantMessage])
        setChatInput('')
      }
    } catch (err) {
      handleError(err, '发送消息失败')
    } finally {
      setChatLoading(false)
    }
  }, [contractId, chatInput])

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // ─── 审核结论操作 ───
  const handleApprove = useCallback(async () => {
    if (!await confirmAction('确认审核通过？通过后合同将进入已归档状态。', { confirmText: '审核通过' })) return
    setSubmitting(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/review`, {
        method: 'PATCH',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conclusion: 'APPROVED', concluded_at: new Date().toISOString() }),
      })
      if (res.ok) await fetchReviewData()
      else toastError('操作失败')
    } catch {
      toastError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }, [contractId, fetchReviewData])

  const handleReject = useCallback(async () => {
    const reason = prompt('请输入驳回原因（必填）：')
    if (!reason?.trim()) return
    setSubmitting(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/review`, {
        method: 'PATCH',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conclusion: 'REJECTED',
          conclusion_reason: reason,
          concluded_at: new Date().toISOString(),
        }),
      })
      if (res.ok) await fetchReviewData()
      else toastError('操作失败')
    } catch {
      toastError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }, [contractId, fetchReviewData])

  const handleEscalate = useCallback(async () => {
    const reason = prompt('请输入转交原因及目标角色（如：法务/财务）：')
    if (!reason?.trim()) return
    setSubmitting(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/review`, {
        method: 'PATCH',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conclusion: 'ESCALATED',
          conclusion_reason: reason,
          concluded_at: new Date().toISOString(),
        }),
      })
      if (res.ok) await fetchReviewData()
      else toastError('操作失败')
    } catch {
      toastError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }, [contractId, fetchReviewData])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">加载审核结果...</div>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-red-600">{errorMsg}</div>
      </div>
    )
  }

  if (!contract) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">合同不存在</div>
      </div>
    )
  }

  // 风险等级颜色映射
  const riskColors = {
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' },
    yellow: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500' },
    green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', dot: 'bg-green-500' },
    white: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500', dot: 'bg-slate-400' },
  }

  const riskLabels = {
    red: '红线',
    yellow: '偏离',
    green: '通过',
    white: '待补',
  }

  const selectedRisk = contract.riskCards.find((c) => c.id === selectedRiskId)

  // 解析合同文本为段落
  const paragraphs = (contract.parsed_text || '').split('\n').filter((p: string) => p.trim())

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      {/* 顶部操作栏 */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0 z-20">
        <div className="flex items-center gap-4">
          <Link href="/contracts">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="font-bold text-slate-900 text-sm truncate max-w-md">
            审核：{contract.filename}
          </h1>
          <Badge variant="outline" className="text-[10px]">
            {contract.status === 'COMPLETED' ? '审核完成' : contract.status}
            {contract.status === 'APPROVED' && (
              <ShieldCheckIcon className="h-3 w-3 text-green-500 ml-1" />
            )}
            {contract.status === 'REJECTED' && (
              <XCircleIcon className="h-3 w-3 text-red-500 ml-1" />
            )}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {contract.stats.red} 红
            <span className="w-2 h-2 rounded-full bg-amber-500 ml-2" />
            {contract.stats.yellow} 黄
            <span className="w-2 h-2 rounded-full bg-green-500 ml-2" />
            {contract.stats.green} 绿
          </div>
          {(contract.status === 'COMPLETED' || contract.status === 'PENDING' || contract.status === 'ANALYZING') ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-amber-600 border-amber-200 hover:bg-amber-50"
                onClick={handleEscalate}
                disabled={submitting}
              >
                <RotateCcwIcon className="h-3.5 w-3.5 mr-1" />
                转交
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={handleReject}
                disabled={submitting}
              >
                <XCircleIcon className="h-3.5 w-3.5 mr-1" />
                驳回
              </Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={handleApprove}
                disabled={submitting}
              >
                <ShieldCheckIcon className="h-3.5 w-3.5 mr-1" />
                审核通过
              </Button>
            </>
          ) : contract.status === 'APPROVED' ? (
            <Badge className="bg-green-100 text-green-700 border-green-200">
              <ShieldCheckIcon className="h-3 w-3 mr-1" />
              已通过
            </Badge>
          ) : contract.status === 'REJECTED' ? (
            <Badge className="bg-red-100 text-red-700 border-red-200">
              <XCircleIcon className="h-3 w-3 mr-1" />
              已驳回
            </Badge>
          ) : (
            <Button variant="outline" size="sm">
              下载报告
            </Button>
          )}
        </div>
      </header>

      {/* 三段式内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 1. 左侧：智能摘要 & 导航 */}
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
          {/* AI 摘要 */}
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center mb-3">
              <LightbulbIcon className="w-3 h-3 mr-1.5" />
              AI 摘要提取
            </h3>
            <div className="space-y-3">
              {contract.latestReview?.results?.summary && (
                <div>
                  <p className="text-[11px] text-slate-400 mb-1">审核结论</p>
                  <p className="text-xs text-slate-700 line-clamp-3">{contract.latestReview.results.summary}</p>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-slate-600">{contract.stats.red} 项严重风险</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-slate-600">{contract.stats.yellow} 项需关注</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-slate-600">{contract.stats.green} 项通过</span>
              </div>
            </div>
          </div>

          {/* 导航选项卡 */}
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setActiveTab('risks')}
              className={activeTab === 'risks' ? 'flex-1 py-2 text-xs font-medium text-center text-slate-900 border-b-2 border-indigo-500 bg-slate-50' : 'flex-1 py-2 text-xs font-medium text-center text-slate-500 hover:text-slate-700 hover:bg-slate-50'}
            >
              风险点
            </button>
            <button
              onClick={() => setActiveTab('clauses')}
              className={activeTab === 'clauses' ? 'flex-1 py-2 text-xs font-medium text-center text-slate-900 border-b-2 border-indigo-500 bg-slate-50' : 'flex-1 py-2 text-xs font-medium text-center text-slate-500 hover:text-slate-700 hover:bg-slate-50'}
            >
              条款审核
            </button>
          </div>

          {/* 风险导航列表 */}
          <div className="p-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
              {activeTab === 'risks' ? '风险点' : '条款审核'} ({contract.stats.open} 待处理)
            </h3>
            <div className="space-y-1">
              {contract.riskCards.map((risk) => {
                const colors = riskColors[risk.level]
                const isSelected = selectedRiskId === risk.id
                return (
                  <button
                    key={risk.id}
                    onClick={() => setSelectedRiskId(isSelected ? null : risk.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition ${
                      isSelected ? 'bg-slate-100 ring-1 ring-slate-300' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                      <span className={`font-bold ${colors.text}`}>{riskLabels[risk.level]}</span>
                      {risk.status !== 'open' && (
                        <Badge variant="outline" className="text-[9px] h-4">
                          {risk.status === 'fixed' ? '已修复' : risk.status === 'accepted' ? '已采纳' : '已忽略'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-slate-700 line-clamp-2 font-medium">{risk.title}</p>
                    {risk.clause_ref && (
                      <p className="text-[10px] text-slate-400 mt-1">{risk.clause_ref}</p>
                    )}
                  </button>
                )
              })}
              {contract.riskCards.length === 0 && (
                <div className="text-center py-6 text-xs text-slate-400">
                  <CheckCircleIcon className="h-8 w-8 mx-auto text-green-200 mb-2" />
                  暂无风险项
                </div>
              )}
            </div>
          </div>

          {/* 条款审核工作台 */}
          {activeTab === 'clauses' && (
            <div className="flex-1 overflow-hidden">
              <ClauseReviewWorkshop contractId={contractId} />
            </div>
          )}
        </aside>

        {/* 2. 中间：合同正文预览 */}
        <section className="flex-1 bg-slate-100 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto bg-white shadow-sm min-h-[800px] p-12 relative">
            {/* 选中风险高亮提示 */}
            {selectedRisk && (
              <div className="sticky top-0 z-10 mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <AlertCircleIcon className="h-4 w-4 text-amber-600" />
                  <span className="text-amber-700">
                    当前聚焦：{selectedRisk.title}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedRiskId(null)}
                  className="text-slate-400 hover:text-slate-600 text-xs"
                >
                  清除
                </button>
              </div>
            )}

            {paragraphs.length === 0 ? (
              <div className="text-center text-slate-400 py-20">
                <FileTextIcon className="h-12 w-12 mx-auto text-slate-200 mb-4" />
                <p>暂无解析后的合同文本</p>
              </div>
            ) : (
              <div className="space-y-4 text-sm leading-relaxed text-slate-700">
                {paragraphs.map((para: string, i: number) => {
                  // 检查当前段落是否被选中风险关联
                  const isHighlighted = selectedRisk && selectedRisk.clause_ref && para.includes(selectedRisk.clause_ref.replace('第', '').replace('条', ''))
                  return (
                    <p
                      key={i}
                      className={`${
                        isHighlighted ? 'bg-amber-50/50 border-l-2 border-amber-400 pl-3 py-1' : ''
                      }`}
                    >
                      {para}
                    </p>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* 3. 右侧：风险卡片面板 */}
        <aside className="w-[360px] bg-white border-l border-slate-200 flex flex-col overflow-hidden">
          {/* 风险卡片详情 */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedRisk ? (
              <div className="space-y-4">
                {/* 风险等级 */}
                <div className={`p-4 rounded-lg border ${riskColors[selectedRisk.level].bg} ${riskColors[selectedRisk.level].border}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-3 h-3 rounded-full ${riskColors[selectedRisk.level].dot}`} />
                    <span className={`font-bold ${riskColors[selectedRisk.level].text}`}>
                      {riskLabels[selectedRisk.level]} — {selectedRisk.title}
                    </span>
                  </div>
                  {selectedRisk.clause_ref && (
                    <p className="text-xs text-slate-500">{selectedRisk.clause_ref}</p>
                  )}
                </div>

                {/* 描述 */}
                {selectedRisk.description && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">风险描述</h4>
                    <p className="text-sm text-slate-600">{selectedRisk.description}</p>
                  </div>
                )}

                {/* 建议 */}
                {selectedRisk.suggestion && (
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                      <LightbulbIcon className="h-3 w-3" />
                      修复建议
                    </h4>
                    <p className="text-sm text-slate-700">{selectedRisk.suggestion}</p>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-2 pt-2">
                  {selectedRisk.auto_fixable && selectedRisk.status === 'open' && (
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleFix(selectedRisk.id)}
                      disabled={fixingId === selectedRisk.id}
                    >
                      {fixingId === selectedRisk.id ? (
                        <>
                          <LoaderIcon className="h-3.5 w-3.5 mr-1 animate-spin" />
                          修复中...
                        </>
                      ) : (
                        '一键修复'
                      )}
                    </Button>
                  )}
                  {selectedRisk.status === 'open' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={async () => {
                        // 标记为已采纳（忽略）
                        await fetchReviewData()
                      }}
                    >
                      忽略此项
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                <AlertCircleIcon className="h-12 w-12 text-slate-200 mb-4" />
                <p className="text-sm">从左侧选择风险项</p>
                <p className="text-xs text-slate-300 mt-1">查看详情和修复建议</p>
              </div>
            )}
          </div>

          {/* AI 合同助理 */}
          <div className="border-t border-slate-200 flex-shrink-0">
            <button
              onClick={() => setChatOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <MessageSquareIcon className="h-4 w-4 text-indigo-500" />
                AI 合同助理
              </div>
              <ChevronRightIcon className={`h-4 w-4 text-slate-400 transition-transform ${chatOpen ? 'rotate-90' : ''}`} />
            </button>

            {chatOpen && (
              <div className="h-[300px] flex flex-col">
                {/* 聊天内容 */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {chatMessages.length === 0 && (
                    <div className="text-center text-xs text-slate-400 py-4">
                      <BotIcon className="h-8 w-8 mx-auto text-slate-200 mb-2" />
                      有什么关于这份合同的问题？<br />我可以帮您解读风险项、条款含义等。
                    </div>
                  )}
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                        msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'
                      }`}>
                        {msg.role === 'user' ? <UserIcon className="h-3 w-3" /> : <BotIcon className="h-3 w-3" />}
                      </div>
                      <div className={`max-w-[80%] text-xs leading-relaxed px-3 py-2 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* 输入区 */}
                <div className="p-3 border-t border-slate-100">
                  <div className="flex gap-2">
                    <Input
                      placeholder="询问合同条款..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                      className="text-xs h-9"
                    />
                    <Button
                      size="sm"
                      className="h-9 w-9 p-0"
                      onClick={handleSendChat}
                      disabled={chatLoading || !chatInput.trim()}
                    >
                      {chatLoading ? (
                        <LoaderIcon className="h-4 w-4 animate-spin" />
                      ) : (
                        <SendIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

// 占位图标
function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}

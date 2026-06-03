'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Rule } from '@/types/rules'

const riskLevelMap: Record<string, { label: string; className: string }> = {
  red: { label: '红灯', className: 'bg-red-100 text-red-800 border-red-200' },
  yellow: { label: '黄灯', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  green: { label: '绿灯', className: 'bg-green-100 text-green-800 border-green-200' },
}

const ruleTypeMap: Record<string, string> = {
  structured: '结构化规则',
  semantic: '语义规则',
}

interface Config {
  id: string
  key: string
  name: string
  value: Record<string, unknown>
  type: 'CONTRACT_RULE' | 'TAX_RULE' | 'APPROVAL_RULE' | 'AI_CONFIG'
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  version: number
  description?: string
  created_at: string
  updated_at: string
}

const CONFIG_TYPE_META: Record<string, { label: string; color: string }> = {
  CONTRACT_RULE: { label: '合同审核规则', color: 'bg-blue-100 text-blue-800' },
  TAX_RULE: { label: '税率规则', color: 'bg-emerald-100 text-emerald-800' },
  APPROVAL_RULE: { label: '审批权限', color: 'bg-purple-100 text-purple-800' },
  AI_CONFIG: { label: 'AI 配置', color: 'bg-amber-100 text-amber-800' },
}

const CONFIG_STATUS_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'bg-slate-100 text-slate-600' },
  PUBLISHED: { label: '已发布', className: 'bg-emerald-100 text-emerald-700' },
  ARCHIVED: { label: '已归档', className: 'bg-gray-100 text-gray-500' },
}

export default function ConfigsPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [configs, setConfigs] = useState<Config[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('rules')

  // Rule dialog
  const [isRuleEditOpen, setIsRuleEditOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Partial<Rule> | null>(null)

  // Config dialog
  const [isConfigEditOpen, setIsConfigEditOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<Partial<Config> | null>(null)
  const [configType, setConfigType] = useState<Config['type']>('TAX_RULE')

  // Version dialog
  const [isVersionOpen, setIsVersionOpen] = useState(false)
  const [versions, setVersions] = useState<Array<{ version: number; status: string; created_at: string }>>([])

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {}

      const [rulesRes, configsRes] = await Promise.all([
        fetch('/api/rules', { headers }),
        fetch('/api/configs', { headers }),
      ])

      if (rulesRes.ok) {
        const rulesData = await rulesRes.json()
        setRules(rulesData)
      }

      if (configsRes.ok) {
        const configsData = await configsRes.json()
        setConfigs(configsData)
      }
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  const getConfigsByType = (type: Config['type']) => configs.filter((c) => c.type === type)

  // Rule handlers
  async function handleSaveRule() {
    if (!editingRule?.name || !editingRule?.rule_type || !editingRule?.risk_level) {
      return
    }

    try {
      const token = localStorage.getItem('token')
      const isUpdate = 'id' in editingRule && editingRule.id
      const url = isUpdate ? `/api/rules/${editingRule.id}` : '/api/rules'
      const method = isUpdate ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify(editingRule),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '保存失败')
        return
      }

      setIsRuleEditOpen(false)
      setEditingRule(null)
      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm('确定要删除这条规则吗？')) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/rules/${id}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        setError('删除失败')
        return
      }

      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  function openNewRule() {
    setEditingRule({
      name: '',
      description: '',
      rule_type: 'structured',
      risk_level: 'yellow',
      enabled: true,
      config: {},
    })
    setIsRuleEditOpen(true)
  }

  function openEditRule(rule: Rule) {
    setEditingRule({ ...rule })
    setIsRuleEditOpen(true)
  }

  // Config handlers
  async function handleSaveConfig() {
    if (!editingConfig?.key || !editingConfig?.name) {
      setError('请填写完整信息')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const isUpdate = 'id' in editingConfig && editingConfig.id
      const url = isUpdate ? `/api/configs/${editingConfig.id}` : '/api/configs'
      const method = isUpdate ? 'PUT' : 'POST'

      const payload = isUpdate
        ? {
            name: editingConfig.name,
            value: editingConfig.value || {},
            description: editingConfig.description,
          }
        : {
            key: editingConfig.key,
            name: editingConfig.name,
            type: configType,
            value: editingConfig.value || getDefaultValue(configType),
            description: editingConfig.description,
          }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '保存失败')
        return
      }

      setIsConfigEditOpen(false)
      setEditingConfig(null)
      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handleDeleteConfig(id: string) {
    if (!confirm('确定要删除这个配置吗？')) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${id}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        setError('删除失败')
        return
      }

      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handlePublishConfig(id: string) {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${id}/publish`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '发布失败')
        return
      }

      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handleFetchVersions(id: string) {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${id}/versions`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        setError('获取版本历史失败')
        return
      }

      const data = await res.json()
      setVersions(data)
      setIsVersionOpen(true)
    } catch {
      setError('网络错误')
    }
  }

  async function handleRollback(configId: string, version: number) {
    if (!confirm(`确定要回滚到版本 ${version} 吗？回滚后配置将变为草稿状态。`)) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${configId}/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ version }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '回滚失败')
        return
      }

      setIsVersionOpen(false)
      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  function openNewConfig(type: Config['type']) {
    setConfigType(type)
    setEditingConfig({
      key: '',
      name: '',
      value: getDefaultValue(type),
      description: '',
    })
    setIsConfigEditOpen(true)
  }

  function openEditConfig(config: Config) {
    setConfigType(config.type)
    setEditingConfig({ ...config })
    setIsConfigEditOpen(true)
  }

  function getDefaultValue(type: Config['type']): Record<string, unknown> {
    switch (type) {
      case 'TAX_RULE':
        return { rate: 0.13, category: '货物销售', enabled: true }
      case 'APPROVAL_RULE':
        return { rule_type: 'discount', thresholds: [{ limit: 5, approver_role: 'auto', enabled: true }] }
      case 'AI_CONFIG':
        return { level: 1, name: '新模型', base_url: '', model: '', timeout_ms: 45000, enabled: true }
      case 'CONTRACT_RULE':
        return { pattern: '', field: '', operator: 'gt', value: 0 }
      default:
        return {}
    }
  }

  // Render functions
  function renderTaxRules() {
    const taxConfigs = getConfigsByType('TAX_RULE')

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>税率规则配置</CardTitle>
          <Button onClick={() => openNewConfig('TAX_RULE')}>+ 新增税率</Button>
        </CardHeader>
        <CardContent>
          {taxConfigs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500">暂无税率规则</p>
              <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条税率配置</p>
            </div>
          ) : (
            <div className="rounded-md border divide-y">
              {taxConfigs.map((config) => (
                <div key={config.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{config.name}</span>
                      <ConfigStatusBadge status={config.status} />
                      {config.value?.enabled === true && (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700">启用</Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {config.key} · {(config.value?.category as string) || '通用'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-mono font-semibold text-slate-700">
                      {((config.value?.rate as number) * 100).toFixed(0)}%
                    </span>
                    <Button variant="outline" size="sm" onClick={() => openEditConfig(config)}>编辑</Button>
                    {config.status !== 'PUBLISHED' && (
                      <Button variant="outline" size="sm" onClick={() => handlePublishConfig(config.id)}>发布</Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => handleFetchVersions(config.id)}>版本</Button>
                    <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDeleteConfig(config.id)}>删除</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  function renderApprovalRules() {
    const approvalConfigs = getConfigsByType('APPROVAL_RULE')

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>审批权限配置</CardTitle>
          <Button onClick={() => openNewConfig('APPROVAL_RULE')}>+ 新增规则</Button>
        </CardHeader>
        <CardContent>
          {approvalConfigs.map((config) => (
            <div key={config.id} className="mb-6 last:mb-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{config.name}</span>
                  <ConfigStatusBadge status={config.status} />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEditConfig(config)}>编辑</Button>
                  {config.status !== 'PUBLISHED' && (
                    <Button variant="outline" size="sm" onClick={() => handlePublishConfig(config.id)}>发布</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleFetchVersions(config.id)}>版本</Button>
                  <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDeleteConfig(config.id)}>删除</Button>
                </div>
              </div>

              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">序号</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">阈值条件</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">审批角色</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(config.value?.thresholds as Array<{ limit: number; approver_role: string; enabled: boolean }>)?.map((t, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-mono">{idx + 1}</td>
                        <td className="px-4 py-2">
                          {(config.value?.rule_type as string) === 'discount' ? `≤ ${t.limit}%` : `≤ ¥${t.limit.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-2">{t.approver_role}</td>
                        <td className="px-4 py-2">
                          {t.enabled ? (
                            <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>
                          ) : (
                            <Badge variant="secondary">禁用</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {config.description && <p className="text-xs text-slate-500 mt-2">{config.description}</p>}
            </div>
          ))}

          {approvalConfigs.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500">暂无审批权限配置</p>
              <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条审批配置</p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  function renderAIConfigs() {
    const aiConfigs = getConfigsByType('AI_CONFIG')

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>AI 模型配置（3级降级链）</CardTitle>
          <Button onClick={() => openNewConfig('AI_CONFIG')}>+ 新增模型</Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {aiConfigs.map((config) => (
              <div key={config.id} className="rounded-lg border p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <div className="text-sm font-semibold text-slate-900">
                    Level {(config.value?.level as number)} · {config.name}
                  </div>
                  <div className="flex gap-1">
                    <ConfigStatusBadge status={config.status} />
                    {config.value?.enabled === true && <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>}
                  </div>
                </div>

                <div className="text-xs text-slate-600 space-y-1.5 mb-4">
                  <div className="truncate">模型: {config.value?.model as string}</div>
                  <div className="truncate">地址: {(config.value?.base_url as string) || '（内置）'}</div>
                  <div>超时: {(config.value?.timeout_ms as number) / 1000}s</div>
                  {typeof config.value?.api_key === 'string' && config.value.api_key.length > 0 && <div className="font-mono text-slate-400">{config.value.api_key}</div>}
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEditConfig(config)}>编辑</Button>
                  {config.status !== 'PUBLISHED' && (
                    <Button variant="outline" size="sm" onClick={() => handlePublishConfig(config.id)}>发布</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleDeleteConfig(config.id)}>删除</Button>
                </div>
              </div>
            ))}
          </div>

          {aiConfigs.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500">暂无 AI 模型配置</p>
              <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条 AI 配置</p>
            </div>
          )}

          <div className="rounded-md border mt-4">
            <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium text-slate-700">路由策略（按文档页数）</div>
            <div className="divide-y">
              {[
                { pages: '≤ 15 页', level: 1, strategy: '整体送入本地' },
                { pages: '15 - 40 页', level: 1, strategy: '分段送入本地' },
                { pages: '> 40 页', level: 2, strategy: '强制云端' },
              ].map((row, idx) => (
                <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-mono text-slate-700">{row.pages}</span>
                  <span className="text-xs text-slate-500">{row.strategy}</span>
                  <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">Level {row.level}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  function renderTaxEditForm() {
    const value = editingConfig?.value as { rate?: number; category?: string; enabled?: boolean; region?: string } || {}

    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">配置键 (Key)</label>
          <Input
            value={editingConfig?.key || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, key: e.target.value })}
            placeholder="如: TAX_STANDARD"
            disabled={!!editingConfig?.id}
          />
          <p className="text-xs text-slate-500 mt-1">大写字母+下划线，如 TAX_SERVICE</p>
        </div>
        <div>
          <label className="text-sm font-medium">显示名称</label>
          <Input
            value={editingConfig?.name || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, name: e.target.value })}
            placeholder="如: 标准增值税"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">税率 (%)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={(value.rate || 0) * 100}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, rate: parseFloat(e.target.value) / 100 }
              })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">适用类别</label>
            <Input
              value={value.category || ''}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, category: e.target.value }
              })}
              placeholder="如: 货物销售"
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">地区</label>
          <Input
            value={value.region || ''}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, region: e.target.value }
            })}
            placeholder="如: 中国大陆"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.enabled || false}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, enabled: e.target.checked }
            })}
          />
          <span className="text-sm">启用此税率</span>
        </div>
      </div>
    )
  }

  function renderApprovalEditForm() {
    const value = editingConfig?.value as { rule_type?: 'discount' | 'contract'; thresholds?: Array<{ limit: number; approver_role: string; enabled: boolean }> } || {}
    const thresholds = value.thresholds || []

    const updateThreshold = (idx: number, field: string, val: unknown) => {
      const newThresholds = [...thresholds]
      newThresholds[idx] = { ...newThresholds[idx], [field]: val }
      setEditingConfig({ ...editingConfig!, value: { ...value, thresholds: newThresholds } })
    }

    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">配置键 (Key)</label>
          <Input
            value={editingConfig?.key || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, key: e.target.value })}
            placeholder="如: APPROVAL_DISCOUNT"
            disabled={!!editingConfig?.id}
          />
        </div>
        <div>
          <label className="text-sm font-medium">显示名称</label>
          <Input
            value={editingConfig?.name || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm font-medium">规则类型</label>
          <select
            className="w-full mt-1 p-2 border rounded-md"
            value={value.rule_type || 'discount'}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, rule_type: e.target.value as 'discount' | 'contract' }
            })}
          >
            <option value="discount">折扣审批</option>
            <option value="contract">合同审批</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">审批阈值</label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingConfig({
                ...editingConfig!,
                value: { ...value, thresholds: [...thresholds, { limit: 10, approver_role: 'auto', enabled: true }] }
              })}
            >+ 添加阈值</Button>
          </div>
          <div className="space-y-2">
            {thresholds.map((t, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                <Input
                  type="number"
                  className="w-20"
                  value={t.limit}
                  onChange={(e) => updateThreshold(idx, 'limit', parseFloat(e.target.value))}
                  placeholder={value.rule_type === 'discount' ? '折扣%' : '金额'}
                />
                <Input
                  className="flex-1"
                  value={t.approver_role}
                  onChange={(e) => updateThreshold(idx, 'approver_role', e.target.value)}
                  placeholder="审批角色，如 sales_manager"
                />
                <input
                  type="checkbox"
                  checked={t.enabled}
                  onChange={(e) => updateThreshold(idx, 'enabled', e.target.checked)}
                  title="启用"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newThresholds = thresholds.filter((_, i) => i !== idx)
                    setEditingConfig({ ...editingConfig!, value: { ...value, thresholds: newThresholds } })
                  }}
                >×</Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderAIEditForm() {
    const value = editingConfig?.value as {
      level?: number; name?: string; base_url?: string; api_key?: string;
      model?: string; timeout_ms?: number; enabled?: boolean;
      routing?: { max_pages?: number; strategy?: string }
    } || {}

    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">配置键 (Key)</label>
          <Input
            value={editingConfig?.key || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, key: e.target.value })}
            placeholder="如: AI_LEVEL_1"
            disabled={!!editingConfig?.id}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">降级等级</label>
            <Input
              type="number"
              min={1}
              max={3}
              value={value.level || 1}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, level: parseInt(e.target.value) }
              })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">显示名称</label>
            <Input
              value={editingConfig?.name || ''}
              onChange={(e) => setEditingConfig({ ...editingConfig!, name: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">模型标识</label>
          <Input
            value={value.model || ''}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, model: e.target.value }
            })}
            placeholder="如: claude-sonnet, local-model"
          />
        </div>
        <div>
          <label className="text-sm font-medium">API 地址</label>
          <Input
            value={value.base_url || ''}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, base_url: e.target.value }
            })}
            placeholder="如: http://localhost:1234/v1"
          />
        </div>
        <div>
          <label className="text-sm font-medium">API Key (可选)</label>
          <Input
            type="password"
            value={value.api_key || ''}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, api_key: e.target.value }
            })}
            placeholder="留空保持现有值"
          />
          <p className="text-xs text-slate-500 mt-1">安全存储，API 返回时脱敏显示</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">超时 (毫秒)</label>
            <Input
              type="number"
              step={1000}
              value={value.timeout_ms || 45000}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, timeout_ms: parseInt(e.target.value) }
              })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">最大页数</label>
            <Input
              type="number"
              value={value.routing?.max_pages || 15}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, routing: { ...value.routing, max_pages: parseInt(e.target.value) } }
              })}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.enabled || false}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, enabled: e.target.checked }
            })}
          />
          <span className="text-sm">启用此模型配置</span>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="p-8">加载中...</div>
  }

  return (
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">配置中心</h1>
          <p className="text-sm text-slate-500 mt-1">合同规则、税率、审批权限、AI 降级链统一管理</p>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg mb-4">
          {error}
          <button className="ml-2 underline" onClick={() => setError('')}>清除</button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="rules">合同审核规则</TabsTrigger>
          <TabsTrigger value="tax">税率规则</TabsTrigger>
          <TabsTrigger value="approval">审批权限</TabsTrigger>
          <TabsTrigger value="ai">AI 模型配置</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>合同审核规则</CardTitle>
              <Button onClick={openNewRule}>+ 新建规则</Button>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-slate-500">暂无规则</p>
                  <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条规则</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {rules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{rule.name}</span>
                          <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                            {rule.enabled ? '启用' : '停用'}
                          </Badge>
                          <Badge className={riskLevelMap[rule.risk_level]?.className || ''}>
                            {riskLevelMap[rule.risk_level]?.label || rule.risk_level}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-500">{rule.description || '无描述'}</p>
                        <div className="text-xs text-slate-400 mt-1">{ruleTypeMap[rule.rule_type] || rule.rule_type}</div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditRule(rule)}>编辑</Button>
                        <Button variant="outline" size="sm" onClick={() => handleDeleteRule(rule.id)}>删除</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          {renderTaxRules()}
        </TabsContent>

        <TabsContent value="approval" className="mt-4">
          {renderApprovalRules()}
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          {renderAIConfigs()}
        </TabsContent>
      </Tabs>

      {/* Rule Edit Dialog */}
      {editingRule && (
        <Dialog open={isRuleEditOpen} onOpenChange={setIsRuleEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingRule.id ? '编辑规则' : '新建规则'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">规则名称</label>
                <Input
                  value={editingRule.name || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  placeholder="如：付款账期检查"
                />
              </div>
              <div>
                <label className="text-sm font-medium">规则描述</label>
                <Textarea
                  value={editingRule.description || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                  placeholder="描述这条规则的作用"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">规则类型</label>
                  <select
                    className="w-full mt-1 p-2 border rounded-md"
                    value={editingRule.rule_type}
                    onChange={(e) => setEditingRule({ ...editingRule, rule_type: e.target.value as 'structured' | 'semantic' })}
                  >
                    <option value="structured">结构化规则</option>
                    <option value="semantic">语义规则</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">风险等级</label>
                  <select
                    className="w-full mt-1 p-2 border rounded-md"
                    value={editingRule.risk_level}
                    onChange={(e) => setEditingRule({ ...editingRule, risk_level: e.target.value as 'red' | 'yellow' | 'green' })}
                  >
                    <option value="red">红灯</option>
                    <option value="yellow">黄灯</option>
                    <option value="green">绿灯</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editingRule.enabled || false}
                    onChange={(e) => setEditingRule({ ...editingRule, enabled: e.target.checked })}
                  />
                  <span className="text-sm">启用规则</span>
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRuleEditOpen(false)}>取消</Button>
              <Button onClick={handleSaveRule}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Config Edit Dialog */}
      {editingConfig && (
        <Dialog open={isConfigEditOpen} onOpenChange={setIsConfigEditOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingConfig.id ? '编辑配置' : `新建${CONFIG_TYPE_META[configType]?.label || '配置'}`}
              </DialogTitle>
            </DialogHeader>

            <div className="py-4">
              {configType === 'TAX_RULE' && renderTaxEditForm()}
              {configType === 'APPROVAL_RULE' && renderApprovalEditForm()}
              {configType === 'AI_CONFIG' && renderAIEditForm()}

              <div className="mt-4">
                <label className="text-sm font-medium">描述</label>
                <Textarea
                  value={editingConfig.description || ''}
                  onChange={(e) => setEditingConfig({ ...editingConfig, description: e.target.value })}
                  placeholder="配置描述（可选）"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsConfigEditOpen(false)}>取消</Button>
              <Button onClick={handleSaveConfig}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Version Dialog */}
      <Dialog open={isVersionOpen} onOpenChange={setIsVersionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>版本历史</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {versions.length === 0 ? (
              <p className="text-center text-slate-500">暂无版本历史</p>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.version} className="flex items-center justify-between p-3 bg-slate-50 rounded">
                    <div>
                      <div className="font-medium">版本 {v.version}</div>
                      <div className="text-xs text-slate-500">{new Date(v.created_at).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ConfigStatusBadge status={v.status as Config['status']} />
                      <Button variant="outline" size="sm" onClick={() => handleRollback(editingConfig?.id || '', v.version)}>回滚</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsVersionOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ConfigStatusBadge({ status }: { status: Config['status'] }) {
  const meta = CONFIG_STATUS_META[status]
  return <Badge className={meta?.className}>{meta?.label}</Badge>
}

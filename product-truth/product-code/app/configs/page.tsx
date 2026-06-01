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

export default function ConfigsPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Partial<Rule> | null>(null)

  useEffect(() => {
    fetchRules()
  }, [])

  async function fetchRules() {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/rules', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        setError('获取规则失败')
        return
      }

      const data = await res.json()
      setRules(data)
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

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

      setIsEditOpen(false)
      setEditingRule(null)
      await fetchRules()
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

      await fetchRules()
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
    setIsEditOpen(true)
  }

  function openEditRule(rule: Rule) {
    setEditingRule({ ...rule })
    setIsEditOpen(true)
  }

  if (loading) {
    return <div className="p-8">加载中...</div>
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">配置中心</h1>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">合同审核规则</TabsTrigger>
          <TabsTrigger value="tax">税率规则</TabsTrigger>
          <TabsTrigger value="approval">审批权限</TabsTrigger>
          <TabsTrigger value="ai">AI配置</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>合同审核规则</CardTitle>
              <Button onClick={openNewRule}>+ 新建规则</Button>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg mb-4">
                  {error}
                </div>
              )}

              {rules.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-slate-500">暂无规则</p>
                  <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条规则</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between p-4 bg-slate-50 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{rule.name}</span>
                          <Badge
                            variant={rule.enabled ? 'default' : 'secondary'}
                          >
                            {rule.enabled ? '启用' : '停用'}
                          </Badge>
                          <Badge
                            className={
                              riskLevelMap[rule.risk_level]?.className || ''
                            }
                          >
                            {riskLevelMap[rule.risk_level]?.label ||
                              rule.risk_level}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-500">
                          {rule.description || '无描述'}
                        </p>
                        <div className="text-xs text-slate-400 mt-1">
                          {ruleTypeMap[rule.rule_type] || rule.rule_type}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditRule(rule)}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteRule(rule.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>税率规则</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-500">税率规则配置（占位）</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approval" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>审批权限配置</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-500">审批权限配置（占位）</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>AI模型配置</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-500">AI模型配置（占位）</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      {editingRule && (
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingRule.id ? '编辑规则' : '新建规则'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">规则名称</label>
                <Input
                  value={editingRule.name || ''}
                  onChange={(e) =>
                    setEditingRule({ ...editingRule, name: e.target.value })
                  }
                  placeholder="如：付款账期检查"
                />
              </div>
              <div>
                <label className="text-sm font-medium">规则描述</label>
                <Textarea
                  value={editingRule.description || ''}
                  onChange={(e) =>
                    setEditingRule({
                      ...editingRule,
                      description: e.target.value,
                    })
                  }
                  placeholder="描述这条规则的作用"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">规则类型</label>
                  <select
                    className="w-full mt-1 p-2 border rounded-md"
                    value={editingRule.rule_type}
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        rule_type: e.target.value as 'structured' | 'semantic',
                      })
                    }
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
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        risk_level: e.target.value as 'red' | 'yellow' | 'green',
                      })
                    }
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
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        enabled: e.target.checked,
                      })
                    }
                  />
                  <span className="text-sm">启用规则</span>
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditOpen(false)}>
                取消
              </Button>
              <Button onClick={handleSaveRule}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

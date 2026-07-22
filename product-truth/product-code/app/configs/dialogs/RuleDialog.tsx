'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Rule } from '@/types/rules'

interface RuleDialogProps {
  rule: Partial<Rule> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (rule: Partial<Rule>) => void
}

export default function RuleDialog({ rule, open, onOpenChange, onSave }: RuleDialogProps) {
  const [editingRule, setEditingRule] = useState<Partial<Rule>>({})
  const config = editingRule.config ?? {}

  useEffect(() => {
    if (rule) {
      setEditingRule({ ...rule })
    }
  }, [rule?.id, open, rule])

  const updateConfig = <K extends keyof Rule['config']>(key: K, value: Rule['config'][K]) => {
    setEditingRule((current) => ({
      ...current,
      config: {
        ...(current.config ?? {}),
        [key]: value,
      },
    }))
  }

  const handleSave = () => {
    onSave({
      ...editingRule,
      config,
    })
  }

  if (!rule) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingRule.id ? '编辑规则' : '新建规则'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-950">1. 规则身份</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">规则集</label>
                <Input
                  value={config.rule_set || ''}
                  onChange={(e) => updateConfig('rule_set', e.target.value)}
                  placeholder="如：验收与交付规则集"
                />
              </div>
              <div>
                <label className="text-sm font-medium">规则编码</label>
                <Input
                  value={config.code || ''}
                  onChange={(e) => updateConfig('code', e.target.value)}
                  placeholder="如：R004"
                />
              </div>
              <div>
                <label className="text-sm font-medium">规则名称</label>
                <Input
                  value={editingRule.name || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  placeholder="如：默认验收期"
                />
              </div>
              <div>
                <label className="text-sm font-medium">状态</label>
                <label className="mt-2 flex h-10 items-center gap-2 rounded-md border px-3">
                  <input
                    type="checkbox"
                    checked={editingRule.enabled || false}
                    onChange={(e) => setEditingRule({ ...editingRule, enabled: e.target.checked })}
                  />
                  <span className="text-sm">启用规则</span>
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-950">2. 触发与判断</h3>
            <p className="mt-1 text-sm text-slate-500">触发器负责找到候选条款，判定器负责判断红绿灯等级。</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">触发方式</label>
                <select
                  className="mt-1 w-full rounded-md border p-2"
                  value={config.trigger_type || 'keyword'}
                  onChange={(e) => updateConfig('trigger_type', e.target.value as Rule['config']['trigger_type'])}
                >
                  <option value="keyword">关键词定位</option>
                  <option value="semantic">语义定位</option>
                  <option value="field">字段判定</option>
                  <option value="ratio">比例类</option>
                  <option value="amount">金额类</option>
                  <option value="duration">时限类</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">执行引擎</label>
                <Input
                  value={config.engine || ''}
                  onChange={(e) => updateConfig('engine', e.target.value)}
                  placeholder="如：field+semantic / rule-engine / local-model"
                />
              </div>
              <div>
                <label className="text-sm font-medium">关键词定位</label>
                <Input
                  value={config.pattern || ''}
                  onChange={(e) => updateConfig('pattern', e.target.value)}
                  placeholder="如：验收、付款、退款、IP归属"
                />
              </div>
              <div>
                <label className="text-sm font-medium">判定字段</label>
                <Input
                  value={config.field || ''}
                  onChange={(e) => updateConfig('field', e.target.value)}
                  placeholder="如：payment_schedule"
                />
              </div>
              <div>
                <label className="text-sm font-medium">操作符</label>
                <select
                  className="mt-1 w-full rounded-md border p-2"
                  value={config.operator || 'contains'}
                  onChange={(e) => updateConfig('operator', e.target.value as Rule['config']['operator'])}
                >
                  <option value="contains">包含</option>
                  <option value="eq">等于</option>
                  <option value="gt">大于</option>
                  <option value="lt">小于</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">阈值 / 目标值</label>
                <Input
                  value={String(config.value ?? '')}
                  onChange={(e) => updateConfig('value', e.target.value)}
                  placeholder="如：30、15%、验收后付款"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="text-sm font-medium">语义判定补充</label>
              <Textarea
                value={config.prompt || ''}
                onChange={(e) => updateConfig('prompt', e.target.value)}
                placeholder="给 AI/语义引擎读取的判定补充，例如：如果客户要求无限期 SLA 或验收后 100% 付款，应进入红线。"
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-950">3. 红绿灯与输出</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">规则类型</label>
                <select
                  className="mt-1 w-full rounded-md border p-2"
                  value={editingRule.rule_type || 'structured'}
                  onChange={(e) => setEditingRule({ ...editingRule, rule_type: e.target.value as 'structured' | 'semantic' })}
                >
                  <option value="structured">字段 + 规则</option>
                  <option value="semantic">语义规则</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">默认风险等级</label>
                <select
                  className="mt-1 w-full rounded-md border p-2"
                  value={editingRule.risk_level || 'yellow'}
                  onChange={(e) => setEditingRule({ ...editingRule, risk_level: e.target.value as 'red' | 'yellow' | 'green' })}
                >
                  <option value="red">红线：必须修改或特批</option>
                  <option value="yellow">黄色：需要谈判或补充说明</option>
                  <option value="green">绿色：验收通过</option>
                </select>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">例外条件 / 白名单</label>
                <Textarea
                  value={config.exception || ''}
                  onChange={(e) => updateConfig('exception', e.target.value)}
                  placeholder="如：已上传特批签报，或项目所在地为海外。"
                  className="border-emerald-200 bg-emerald-50/60"
                />
              </div>
              <div>
                <label className="text-sm font-medium">证据要求</label>
                <Textarea
                  value={config.evidence || ''}
                  onChange={(e) => updateConfig('evidence', e.target.value)}
                  placeholder="如：必须定位合同原文、页码、条款号；无法定位则进入人工定位。"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="text-sm font-medium">输出动作 / 批注模板</label>
              <Textarea
                value={config.output_template || ''}
                onChange={(e) => updateConfig('output_template', e.target.value)}
                placeholder="如：将风险项改成可执行条款；不能直接修改时输出客户侧风险批注和谈判口径。"
              />
            </div>
            <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">
              <span className="font-medium text-slate-900">实时解释：</span>
              当合同命中「{config.pattern || config.field || editingRule.name || '当前规则'}」时，由
              「{config.engine || (editingRule.rule_type === 'semantic' ? '语义规则' : '字段 + 规则')}」判定为
              「{editingRule.risk_level === 'red' ? '红线' : editingRule.risk_level === 'green' ? '绿色通过' : '黄色谈判'}」，
              输出证据、处理动作和客户侧批注建议。
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-950">4. 人类解释</h3>
            <label className="text-sm font-medium">业务解释</label>
            <Textarea
              value={editingRule.description || ''}
              onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
              placeholder="这段只用于人理解规则背景，不作为机器判定入口。"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

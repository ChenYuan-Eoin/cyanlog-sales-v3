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

  useEffect(() => {
    if (rule) {
      setEditingRule({ ...rule })
    }
  }, [rule?.id, open])

  const handleSave = () => {
    onSave(editingRule)
  }

  if (!rule) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                value={editingRule.rule_type || 'structured'}
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
                value={editingRule.risk_level || 'yellow'}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

# Feature Packet: F006-红绿灯规则配置

**Created**: 2026-06-01  
**REQ ID**: F006  
**Status**: completed  
**Parent**: F005 (合同审核)

---

## 1. 单元定义

**目标**: 让法务/管理员能配置合同审核的红绿灯规则，规则引擎在 AI 审核时执行

**边界**:
- 规则配置界面（增删改查）
- 规则引擎在 analyze 流程中执行
- 结构化规则（正则/条件）和语义规则都支持

**本轮已完成**:
- ✅ 规则配置界面和存储
- ✅ 规则引擎执行逻辑（AI审核流程中调用）
- ✅ 结构化规则检查（正则/条件匹配）
- ✅ 语义规则检查（关键词匹配）
- ✅ 数据库存储和迁移

**不做什么**:
- 不做 Word 批注生成
- 不做合同编辑
- 不做批量操作

---

## 2. 双锚点

### 业务锚点
- 规则类型：
  - **结构化规则**: 基于正则/关键字的确定性规则（如：账期 > 90 天 = 红灯）
  - **语义规则**: 自然语言描述（如：违约金条款明显不公）
- 规则字段：名称、描述、规则类型、风险等级（red/yellow/green）、启用状态
- 数据存储：`rules` 表

### 视觉锚点
- 参考：`03-design-truth/examples/screen-approval.jsx`
- 布局：列表页 + 编辑弹窗
- 状态展示：Badge 显示风险等级
- 复用：`app/configs/page.tsx` 中的 Tabs 和 Card 布局

---

## 3. 状态机

| 状态 | 说明 |
|------|------|
| enabled | 规则启用中 |
| disabled | 规则已停用 |

---

## 4. 涉及文件

**修改**:
- `app/configs/page.tsx` - 合同审核规则 Tab 改为动态展示

**新建**:
- `app/api/rules/route.ts` - 规则列表 API
- `app/api/rules/[id]/route.ts` - 规则详情/更新 API
- `lib/types/rules.ts` - 规则类型定义（如不存在）

---

## 5. 新增约束

### 规则格式
```typescript
interface Rule {
  id: string
  name: string
  description: string
  rule_type: 'structured' | 'semantic'
  risk_level: 'red' | 'yellow' | 'green'
  enabled: boolean
  config: {
    // 结构化规则：正则/条件
    pattern?: string
    field?: string
    operator?: 'gt' | 'lt' | 'eq' | 'contains'
    value?: string | number
    // 语义规则：自然语言描述
    prompt?: string
  }
  created_at: string
  updated_at: string
}
```

---

## 6. 新增文件

- `types/rules.ts` - 规则类型定义
- `app/api/rules/route.ts` - 规则列表/创建 API
- `app/api/rules/[id]/route.ts` - 规则详情/更新/删除 API
- `lib/rules/engine.ts` - 规则引擎实现（结构化/语义规则执行）
- `supabase/migrations/002_add_rules_table.sql` - rules 表迁移

## 7. 修改文件

- `app/configs/page.tsx` - 规则配置 UI（列表+弹窗）
- `app/api/contracts/[id]/analyze/route.ts` - 集成规则引擎调用

## 8. 验证记录

- [x] `pnpm lint` 通过
- [x] 规则增删改查功能正常
- [x] 风险等级显示正确（红黄绿 Badge）
- [x] 规则引擎在 analyze 流程中执行
- [ ] 数据库迁移已创建（需手动执行）

## 9. 遗留问题

- [ ] 规则版本管理
- [ ] 更复杂的语义规则（接入真 AI）

# 合同审核规则框架设计方案

## 现状问题

| 层面 | 现状 | 缺失 |
|------|------|------|
| 数据层 | `rules` 表有3条基础规则 | 无 Level A/B/C 阈值配置 |
| API层 | `/api/rules` CRUD 可用 | 无规则测试/验证接口 |
| 引擎层 | `lib/rules/engine.ts` 完整 | 未被UI调用 |
| UI层 | 简单列表+基础编辑 | **无设计器、无测试、无验证** |

## 目标

构建完整的规则工作流：

```
规则设计 → 规则测试 → 规则发布 → 规则执行 → 结果反馈
   ↑_____________________________________________↓
```

## 核心功能模块

### 1. 规则设计器 (RuleDesigner)

支持可视化配置 Level A/B/C 三级阈值：

```typescript
interface RuleDesignForm {
  // 基础信息
  code: string          // RULE-01
  name: string          // 付款账期检查
  category: 'ratio' | 'amount' | 'duration' | 'enum' | 'text'
  
  // Level A (🟢 通过)
  level_a_operator: '>=' | '<=' | '=' 
  level_a_threshold: number    // 30
  level_a_unit: 'day'          // 天
  level_a_action: 'auto_approve'
  
  // Level B (🟡 偏离)
  level_b_operator: '>'
  level_b_threshold: 90        // 90天
  level_b_unit: 'day'
  level_b_action: 'suggest_counterparty'
  level_b_counterparty: '建议增加预付款比例'
  
  // Level C (🔴 红线)
  level_c_operator: '>'
  level_c_threshold: 180       // 180天
  level_c_unit: 'day'
  level_c_action: 'block'
  level_c_message: '付款账期超过180天，需财务总监审批'
}
```

### 2. 规则测试沙盒 (RuleTestSandbox)

实时验证规则效果：

```typescript
interface TestCase {
  id: string
  name: string                    // "账期60天"
  input: {
    field: string                 // "payment_days"
    value: number                 // 60
  }
  expected: {
    level: 'A' | 'B' | 'C' | null
    action: string
  }
}

// 测试结果
interface TestResult {
  ruleId: string
  testCaseId: string
  passed: boolean                 // 是否符合预期
  actual: {
    level: 'A' | 'B' | 'C'
    action: string
    message: string
    counterparty?: string
  }
  executionTime: number
}
```

### 3. 规则模拟执行 (RuleSimulator)

输入真实合同文本，查看所有规则命中情况：

```typescript
interface SimulationResult {
  contractText: string
  extractedFields: Record<string, number>  // 自动提取的字段值
  ruleResults: Array<{
    ruleId: string
    ruleName: string
    matched: boolean
    level: 'A' | 'B' | 'C' | null
    message: string
  }>
  summary: {
    totalRules: number
    matchedRules: number
    redCount: number
    yellowCount: number
    greenCount: number
  }
}
```

## 页面结构

### 配置中心 / 合同审核规则 (重构)

```
┌─────────────────────────────────────────────────────────┐
│  合同审核规则                                [+ 新建规则] │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌─────────────────────────────────┐  │
│  │ 规则列表      │  │ 规则详情/设计器                  │  │
│  │              │  │                                 │  │
│  │ • 付款账期    │  │  基础信息                        │  │
│  │ • 违约金     │◄─┤  ├── 名称: 付款账期检查          │  │
│  │ • 质保期     │  │  ├── 编码: RULE-01              │  │
│  │              │  │  └── 分类: duration              │  │
│  │              │  │                                 │  │
│  │              │  │  Level A/B/C 配置 ▼              │  │
│  │              │  │  ┌────────┬────────┬────────┐  │  │
│  │              │  │  │ 🟢 通过 │ 🟡 偏离 │ 🔴 红线 │  │  │
│  │              │  │  │ <=30天 │ 31-90  │ >180天 │  │  │
│  │              │  │  │ 自动通过│ 建议对价│ 阻断   │  │  │
│  │              │  │  └────────┴────────┴────────┘  │  │
│  │              │  │                                 │  │
│  │              │  │  [测试规则] [保存] [发布]       │  │
│  └──────────────┘  └─────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  测试沙盒                                                │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ 测试用例         │  │ 测试结果                      │  │
│  │ • 账期30天 ✅   │  │  输入: 30天                   │  │
│  │ • 账期60天 ✅   │  │  匹配: Level A (🟢 通过)      │  │
│  │ • 账期120天 ✅  │  │  动作: 自动通过               │  │
│  │ • 账期200天 ✅  │  │                              │  │
│  └─────────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 关键交互流程

### 1. 新建规则流程

1. 点击「+ 新建规则」→ 弹出设计器
2. 填写基础信息（名称、编码、分类）
3. 配置 Level A/B/C 阈值
4. 添加测试用例（可选但推荐）
5. 点击「测试规则」→ 运行所有测试用例
6. 测试通过后点击「保存」→ 保存为草稿
7. 点击「发布」→ 规则生效

### 2. 编辑规则流程

1. 左侧选择规则 → 右侧显示设计器
2. 修改阈值配置
3. 点击「测试规则」验证修改
4. 保存/发布新版本的规则

### 3. 规则测试流程

1. 在测试沙盒输入合同文本或字段值
2. 系统自动提取相关字段
3. 显示每条规则的匹配结果
4. 绿色=通过，黄色=偏离，红色=阻断

## 实施计划

### 阶段1：规则设计器（核心）

- [ ] 创建 `RuleDesigner` 组件（可视化 Level A/B/C 配置）
- [ ] 重构 `RuleTab` + `RuleDialog` → 左右分栏布局
- [ ] API: `/api/rules/[id]/publish` 发布规则

### 阶段2：规则测试沙盒

- [ ] 创建 `RuleTestSandbox` 组件
- [ ] API: `/api/rules/[id]/test` 单规则测试
- [ ] 测试用例管理（增删改查）

### 阶段3：规则模拟执行

- [ ] 创建 `RuleSimulator` 组件（输入合同文本）
- [ ] API: `/api/rules/simulate` 全规则模拟
- [ ] 字段提取可视化

## 下一步

您希望我先实施哪个阶段？
推荐顺序：**阶段1（设计器）→ 阶段2（测试）→ 阶段3（模拟）**
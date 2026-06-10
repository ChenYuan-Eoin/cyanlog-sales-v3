# Feature Packet: F006-合同规则执行内核

**Created**: 2026-06-01  
**REQ ID**: F006  
**Status**: in_progress  
**Parent**: 合同审核  
**Consumes**: `F009`, `F012`

---

## 1. 单元定义

**目标**：在合同审核执行链里加载已发布规则和 AI 运行时配置，完成结构化扫描、语义扫描和风险结果聚合。

**这包拥有的内容**：
- 规则执行内核
- 结构化规则匹配
- 语义规则调用编排
- 风险结果标准化

**这包不拥有的内容**：
- 规则编写 / 发布 / 回滚
- AI Provider 配置维护
- 合同导出

这些分别属于 `F009`、`F012`、`F007`。

---

## 2. 关键边界

以前这里最容易混淆的点是：“规则执行”和“规则配置”被写在了同一包里。

现在明确：
- `F009` = 配置生产面
- `F006` = 运行时消费面

执行链只能读取当前已发布规则，不能在分析过程中改规则。

---

## 3. 执行输入与输出

### 3.1 输入
- 合同文本 / 结构化解析结果
- `F009` 发布的结构化规则和语义规则
- `F012` 发布的 AI Provider / 路由策略

### 3.2 输出
- 风险项列表
- 命中依据
- 风险等级
- 后续 ASK / 报告所需结构化结果

---

## 4. 运行时约束

- 结构化规则优先可解释
- 语义规则作为增强，不覆盖审计链
- AI 不可用时可走规则兜底
- 执行结果必须可追溯到规则版本

---

## 5. 核心数据结构

```typescript
interface RuleExecutionResult {
  ruleId: string
  ruleVersion?: string
  ruleType: 'structured' | 'semantic'
  riskLevel: 'red' | 'yellow' | 'green'
  title: string
  description: string
  evidence?: string[]
}
```

关键点不是字段本身，而是执行结果里必须能追到“哪条规则、哪个版本”。

---

## 6. 涉及文件

- `product-truth/product-code/lib/rules/engine.ts`
- `product-truth/product-code/app/api/contracts/[id]/analyze/route.ts`
- `product-truth/product-code/app/api/rules/route.ts`
- `product-truth/product-code/app/api/rules/[id]/route.ts`
- `product-truth/product-code/supabase/migrations/002_add_rules_table.sql`

---

## 7. 当前实现判断

执行内核基础能力已经具备，但闭环还没结束。

仍需由 `F009` 补齐：
- 规则版本
- 生效控制
- 回滚
- 测试记录

因此 `F006` 当前应维持 `in_progress`，直到执行结果能稳定追到已发布规则版本。

---

## 8. 验收标准

- [x] 可执行结构化规则
- [x] 可执行语义规则
- [x] 输出标准化风险结果
- [ ] 执行结果可追到发布规则版本

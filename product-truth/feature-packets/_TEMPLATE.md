# Feature Packet 模板

<!--
用途：单功能全生命周期单据
规则：
  - 每个 REQ 对应一个 Feature Packet
  - 跨多个 REQ 的共享领域架构，单独建 shared architecture packet，不代替具体 REQ packet
  - 状态变更必须同时更新 REQ_REGISTRY.yml
  - 只允许回写 4 处：REQ_REGISTRY.yml / 当前 Packet / 03-design-truth / 04-implementation-truth
-->

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | Fxxx |
| **Name** | (功能名称) |
| **Module** | (所属模块) |
| **Branch** | `feature/Fxxx-name` |
| **Owner** | (人类负责人) |
| **Created** | YYYY-MM-DD |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述
(由 AI 填写，复述对需求的理解)

### 2.2 待确认问题
- [ ] (问题 1)
- [ ] (问题 2)

### 2.3 本轮边界
- **做**：(...)
- **不做**：(...)

---

## 3. 技术方案

### 3.1 接口设计
(接口定义、输入输出、错误码)

### 3.2 数据模型
(数据结构和关系)

### 3.3 状态机
(如有复杂状态流转，画出状态机)

### 3.4 风险与降级
| 风险 | 应对 |
|------|------|
| (风险 1) | (应对 1) |

---

## 4. 视觉锚点

### 4.1 参考页面
- (参考 design-truth 中的具体文件)

### 4.2 组件
- (需要使用的组件清单)

### 4.3 禁止偏离
- (明确禁止使用/偏离的技术或组件)

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | (范围) | (条件) |
| 接口测试 | (范围) | (条件) |
| E2E | (范围) | (条件) |
| 人工验收 | (范围) | (条件) |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:Fxxx 标记)
```

### 6.2 关键决策
- **决策**: (...)
- **理由**: (...)

### 6.3 非目标
- (...)

---

## 7. 评审记录

| 评审类型 | 评审人 | 状态 | 日期 | 备注 |
|---------|--------|------|------|------|
| PM 需求评审 | | | | |
| Dev 技术评审 | | | | |
| QA 测试评审 | | | | |

---

## 8. 发布记录

| 字段 | 值 |
|------|-----|
| **环境** | |
| **发布时间** | |
| **发布结果** | |
| **回滚点** | |

---

## 9. 回写记录

| 目标 | 状态 | 更新点 |
|------|------|--------|
| `REQ_REGISTRY.yml` Fxxx | 待更新 | |
| `03-design-truth/` | 待更新 | |
| `04-implementation-truth/` | 待创建 | |

---

## 附录：状态机

```
drafting → pm_review → tech_review → test_review → coding → code_review → qa_acceptance → ready_to_release → released
                                                                                          ↓
                                                                                        rejected
```

| 状态 | 含义 | 谁推进 |
|------|------|--------|
| `drafting` | AI 需求反讲中 | AI |
| `pm_review` | 等产品确认 | PM |
| `tech_review` | 等研发评审 | Dev |
| `test_review` | 等测试方案评审 | QA |
| `coding` | AI 编码中 | AI |
| `code_review` | 代码审查中 | Dev |
| `qa_acceptance` | 测试/产品验收中 | QA/PM |
| `ready_to_release` | 可发布 | DevOps |
| `released` | 已上线 | - |
| `rejected` | 被打回 | 任意 |

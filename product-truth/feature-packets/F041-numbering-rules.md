# Feature Packet: F041-单号规则

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F041 |
| **Name** | 单号规则 |
| **Module** | 配置中心 |
| **Branch** | `feature/F041-numbering` |
| **Owner** | (人类负责人) |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述
- 报价单号/合同号等编号规则配置化（前缀/日期/流水），唯一可回溯，后台可维护。

### 2.2 待确认问题
- [ ] 单号规则是否按 doc_type 分别配置（quote/contract/…）？默认仅 quote。

### 2.3 本轮边界
- **做**：`document_number_rules` 配置对象（doc_type/prefix/date_format/seq_start/padding/suffix/separator/sample/enabled）+ 生成 RPC（复用现有 `generate_quote_number` 原子取号模式）；报价创建使用已发布单号规则。
- **不做**：品牌（V3 现有界面主题已覆盖，本域不涉及、不新增、不修改）。

---

## 3. 技术方案

### 3.1 接口设计
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/config-center/numbering-rules` | 列表/创建（DRAFT） |
| GET/PUT/DELETE | `/api/config-center/numbering-rules/[id]` | 详情/更新/删除（仅 DRAFT） |
| POST | `/api/config-center/numbering-rules/[id]/publish` | 发布 |
| GET/POST | `/api/config-center/numbering-rules/[id]/versions` / `rollback` | 版本/回滚 |
| RPC | `generate_doc_number(rule_id)` | 原子取号（复用 `generate_quote_number` 的 sequence + 冲突重试） |

### 3.2 数据模型
- 主表：`document_number_rules`（migration 20260814000001）——`org_id, doc_type, prefix, date_format, seq_start, padding, suffix, separator, next_seq, sample, enabled, status, version`，`UNIQUE(org_id, doc_type)`。
- 消费：`quotes.quote_no` 由生成 RPC 按已发布规则产出（默认种子：`QT-YYYYMMDD-0001`）。

### 3.3 状态机
DRAFT ──publish──▶ PUBLISHED ──archived──▶ ARCHIVED

### 3.4 风险与降级
| 风险 | 应对 |
|------|------|
| 取号并发冲突 | 复用现有 sequence + 唯一约束 + 重试；失败 UUID 兜底 |
| 未迁移库 | 路由返回 409 MIGRATION_REQUIRED，报价走原 `generate_quote_number` |

---

## 4. 视觉锚点
- 参考页面：现有配置中心 Tab 样式。
- 组件：现有 Dialog/Table/Button。

### 4.3 禁止偏离
- 禁止在报价/导出页修改单号规则。

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | 编号模板渲染 + 唯一性 | 模板渲染结果唯一、格式正确（含 0 补齐） |
| 接口测试 | numbering-rules CRUD/发布/版本/回滚 | 全链路通过；未发布规则不被消费 |
| 人工验收 | 报价创建 | 单号按后台规则生成，可回溯 |

---

## 6. 实现记录
（开发后回填）

## 7. 评审记录
（待填）

## 8. 发布记录
（待填）

## 9. 回写记录

| 目标 | 状态 | 更新点 |
|------|------|--------|
| `REQ_REGISTRY.yml` F041 | 待更新 | 单号规则 |
| `03-design-truth/` | 待更新 | — |
| `04-implementation-truth/` | 待创建 | — |

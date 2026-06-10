# 合同审核 + 配置中心完整设计补强

**Created**: 2026-06-10  
**REQ ID**: F005-Complete / F006-Complete  
**Status**: design_in_progress  
**Purpose**: 补强合同审核用户地图 + 配置中心规则设计  
**Upstream**: 合同审核.md + 配置中心.md + F005-contract-ASK-upgrade.md  
**Downstream**: 实施Phase

---

## 目录

1. 合同审核用户地图
2. 配置中心规则分类设计
3. 规则版本管理设计
4. 规则测试沙箱设计
5. 规则命中率统计设计
6. 条款审核产品化设计（律师视角）
7. 标准合同对照系统
8. 条款库与条款模板管理

---

## 1. 合同审核用户地图

### 1.1 用户角色矩阵

| 角色 | 核心职责 | 进入路径 | 操作权限 | 痛点 |
|------|---------|---------|---------|------|
| **销售** | 上传合同、跟进审核、录入业务回应 | /contracts/new → 上传 → 详情页 | 上传、查看进度、录入回应、导出批注 | 不知道审核进度、不知道该回应什么 |
| **法务** | 审核风险、关闭ASK、标记标准合同、维护规则 | /contracts → 详情页 → ASK标签页 | 查看完整报告、关闭/重开ASK、标记标准合同、导出、规则配置 | 规则太多难管理、不知道哪些规则命中率高 |
| **财务** | 录入财务类回应(付款条款、账期) | 从通知/ASK列表进入 | 录入财务回应、查看财务相关ASK | 不知道自己需要回应哪些ASK |
| **管理员** | 配置规则、查看统计数据、管理权限 | /configs → 规则管理 | 全部权限 + 规则增删改 + 系统配置 | 不知道规则效果、不知道该优化哪些 |

### 1.2 用户旅程图

#### 旅程A：销售上传合同 → 获得审核结果

```
[销售] 上传合同 (/contracts/new)
    │
    ▼
系统校验格式 → 创建Contract(status=PENDING) → 上传人记为trigger_user_id
    │
    ▼
[销售] 看到详情页：
    ├─ 进度条：PENDING(灰) → ANALYZING(蓝/动画) → COMPLETED(绿)
    ├─ 状态文案："合同正在审核中，预计30秒完成"
    ├─ 操作按钮：[刷新状态]（禁用导出）
    │
    ▼ [系统后台]
OCR解析 → 规则引擎扫描 → AI语义分析 → 生成ASK清单
    │
    ▼
[销售] 刷新后看到：
    ├─ 状态：COMPLETED
    ├─ ASK清单(N项)：
    │   ├─ ASK-001 付款节奏偏离 [黄] [待回应] [销售+财务]
    │   ├─ ASK-002 违约金比例偏高 [黄] [待回应] [法务]
    │   └─ ...
    ├─ 操作：[录入回应] [导出批注(有pending时禁用)]
    │
    ▼
[销售] 录入回应 (只看自己角色的ASK)
    │
    ▼
系统：状态转RESPONDED → 触发报告v2生成 → 通知法务
    │
    ▼
[销售] 看到：
    ├─ ASK-001 [已回应] ✅
    ├─ 剩余ASK-002 [待回应]（财务/法务）
    ├─ 当前报告：v2（可查看但不可导出）
    │
    ▼ [等待他人回应]
全部回应/关闭后
    │
    ▼
[销售] 导出批注Word → 发给客户/存档
```

#### 旅程B：法务审核风险 → 处理ASK

```
[法务] 进入合同详情页 (/contracts/:id)
    │
    ▼
看到审核结果：
    ├─ 风险摘要：🔴 2项 / 🟡 3项 / 🟢 5项
    ├─ ASK清单：
    │   ├─ ASK-001 [已回应] 李四(财务) 2026-06-10 15:30
    │   ├─ ASK-002 [待回应] 王五(法务)
    │   ├─ ASK-003 [已关闭] 法务判定不需要
    │   └─ ...
    ├─ 报告版本：v2 → v3 → v4
    │
    ▼
[法务] 处理未回应ASK：
    ├─ 自己回应 → 录入 → 报告升版
    ├─ 关闭伪风险 → 填写closed_reason → 报告升版(ASK不在报告中)
    │
    ▼
[法务] 检查回应质量：
    ├─ 点击已回应ASK → 看到回应内容
    ├─ 认为回应不足 → 重开 → 状态回PENDING → 通知原回应人
    │
    ▼
[法务] 标记标准合同（如果0风险或全部回应合理）：
    ├─ 点击"标记为标准合同"
    ├─ 报告抬头新增"标准合同说明"
    │
    ▼
[法务] 导出最终批注Word → 用印存档
```

#### 旅程C：财务录入财务类回应

```
[财务] 收到飞书通知："合同CT-2026-001有1项财务类ASK待回应"
    │
    ▼
点击通知 → 进入合同详情页 → ASK标签页
    │
    ▼
看到：ASK-001 [付款节奏偏离] [财务] [待回应]
    │
    ▼
[财务] 录入回应：
    ├─ 回应文本："财务接受30/60/10付款节奏，要求首付款不低于30%"
    ├─ 附件：财务审批邮件截图(可选)
    │
    ▼
提交 → 状态转RESPONDED → 报告升版 → 通知法务
```

#### 旅程D：管理员维护规则

```
[管理员] 进入配置中心 (/configs)
    │
    ▼
看到规则管理：
    ├─ 规则分类：结构化规则(12条) / 语义规则(5条)
    ├─ 规则统计：命中率、触发趋势、低命中率告警
    ├─ 版本历史：v1.0 → v1.1 → v1.2
    │
    ▼
[管理员] 新增规则：
    ├─ 选择类型：结构化/语义
    ├─ 配置条件：field/operator/value 或 自然语言描述
    ├─ 配置消息：title/description/suggestion
    ├─ 设置范围：全系统/组织级/合同类型
    ├─ 保存草稿 → 测试验证 → 发布生效
    │
    ▼
[管理员] 测试规则：
    ├─ 输入测试文本："合同第3条：付款方式为银行转账，账期为120天"
    ├─ 系统执行规则 → 返回触发结果
    ├─ 测试通过 → 发布
    │
    ▼
[管理员] 查看规则统计：
    ├─ RULE-001 命中率 78%（触发率高，规则有效）
    ├─ RULE-005 命中率 12%（触发率低，考虑优化或删除）
    ├─ 本月新增2条规则，删除1条
```

### 1.3 状态感知设计

| 状态 | 用户感知 | 进度条 | 操作按钮 | 通知 |
|------|---------|--------|---------|------|
| **PENDING** | "合同已上传，等待审核" | 灰色圆点 | [开始审核] | 无 |
| **PARSING** | "正在解析合同文本..." | 蓝色动画(0-20%) | 刷新(禁用) | 无 |
| **ANALYZING** | "正在AI审核分析..." | 蓝色动画(20-80%) | 刷新(禁用) | 无 |
| **ASK_GENERATED** | "审核完成，生成N项待确认问题" | 蓝色(80%) | [查看ASK清单] | 通知上传人+相关角色 |
| **ASK_PENDING** | "有N项待回应问题" | 黄色圆点(N项标记) | [录入回应](导出禁用) | 按角色分发通知 |
| **ASK_ALL_RESPONDED** | "全部问题已回应，可导出报告" | 绿色圆点 | [导出批注] | 通知上传人 |
| **COMPLETED** | "审核完成，报告已归档" | 绿色✅ | [查看历史报告] | 无 |
| **FAILED** | "审核失败，请重试" | 红色❌ | [重新审核] | 通知上传人 |

### 1.4 通知矩阵

| 事件 | 通知对象 | 通知渠道 | 通知内容 |
|------|---------|---------|---------|
| 合同上传成功 | 上传人 | 飞书 | "合同CT-XXX已上传，正在审核" |
| ASK生成完成 | 上传人 + 所有required_roles | 飞书 | "合同CT-XXX有N项待回应问题，其中X项与你相关" |
| ASK被回应 | 上传人 + 法务 | 飞书 | "ASK-XXX已由李四(财务)回应" |
| ASK被关闭 | 上传人 + 法务 | 飞书 | "ASK-XXX已被法务关闭(原因：XXX)" |
| 全部ASK回应完成 | 上传人 | 飞书 | "合同CT-XXX全部问题已回应，可导出批注报告" |
| 报告版本更新 | 上传人 + 法务 | 无(静默) | 在详情页可查看版本列表 |
| ASK被重开 | 原回应人 | 飞书 | "ASK-XXX已被法务重开，请重新回应" |
| 合同标记为标准 | 法务 | 飞书 | "合同CT-XXX已被标记为标准合同" |

### 1.5 页面结构设计

#### 合同详情页布局 (/contracts/:id)

```
┌─────────────────────────────────────────────────────────────┐
│ 合同详情                                           [导出] [标记] │
├─────────────────────────────────────────────────────────────┤
│ 基本信息                                                    │
│ 合同编号: CT-2026-001    客户: XX科技    金额: ¥50万         │
│ 上传人: 张三(销售) @ 2026-06-10    状态: COMPLETED            │
│ 当前报告: v4                    │
├─────────────────────────────────────────────────────────────┤
│ [基本信息] [审核结果] [ASK清单] [报告版本]                    │
├─────────────────────────────────────────────────────────────┤
│ 审核结果标签页：                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 风险摘要：🔴 高风险 2项 / 🟡 中风险 3项 / 🟢 低风险 5项    │ │
│ │                                                          │ │
│ │ 📊 规则命中统计：                                         │ │
│ │   - RULE-001 付款账期检查 ✅ 触发                        │ │
│ │   - RULE-002 违约金比例检查 ✅ 触发                       │ │
│ │   - RULE-003 甲方资质检查 ❌ 未触发                       │ │
│ │                                                          │ │
│ │ AI语义分析摘要：                                          │ │
│ │   "合同整体风险可控，建议关注付款节奏偏离问题..."           │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ ASK清单标签页：                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 状态汇总：全部 5项 / 已回应 3项 / 待回应 1项 / 已关闭 1项  │ │
│ │                                                          │ │
│ │ ASK-001 付款节奏偏离                  🟡 黄线 [已回应]    │ │
│ │   位置：合同第3条                                         │ │
│ │   回应：李四(财务) @ 2026-06-10 15:30                     │ │
│ │   "财务接受30/60/10付款节奏..."                           │ │
│ │                                                          │ │
│ │ ASK-002 违约金比例偏高                🟡 黄线 [待回应]    │ │
│ │   位置：合同第7条                                         │ │
│ │   需要角色：法务                                          │ │
│ │   [录入回应]                                              │ │
│ │                                                          │ │
│ │ ASK-003 甲方资质存疑                  🟢 绿线 [已关闭]    │ │
│ │   关闭：王五(法务) @ 2026-06-10 16:00                     │ │
│ │   原因："甲方为知名上市公司，资质无需额外确认"              │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ 报告版本标签页：                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ v4 (当前) · 2026-06-10 16:30 · ASK-002回应触发           │ │
│ │ v3        · 2026-06-10 16:00 · ASK-003关闭触发           │ │
│ │ v2        · 2026-06-10 15:30 · ASK-001回应触发           │ │
│ │ v1        · 2026-06-10 14:00 · 初始生成                   │ │
│ │                                                          │ │
│ │ [查看v4] [查看v3历史] [版本对比]                           │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 配置中心规则分类设计

### 2.1 规则分类总览

```
规则分类体系：
├── 结构化规则 (Structured Rules)
│   ├── 特点：100%精确判断，毫秒级执行
│   ├── 适用：明确条款、数值比较、文本匹配
│   └── 示例：账期>90天、违约金>5%、缺少签字页
│
└── 语义规则 (Semantic Rules)
    ├── 特点：AI语义理解，灵活匹配
    ├── 适用：模糊描述、意图识别、上下文理解
    └── 示例："合同整体风险偏高"、"条款表述不清晰"、"责任条款偏向甲方"
```

### 2.2 结构化规则设计

#### 数据模型

```sql
CREATE TABLE contract_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  
  -- 分类
  rule_type TEXT NOT NULL DEFAULT 'structured', -- 'structured' | 'semantic'
  category TEXT NOT NULL, -- 'financial' | 'legal' | 'compliance' | 'technical'
  
  -- 规则内容
  rule_code TEXT NOT NULL, -- 'RULE-001'
  name TEXT NOT NULL,
  description TEXT,
  
  -- 结构化规则条件
  condition JSONB, -- {field, operator, value, context}
  
  -- 语义规则条件（仅语义规则使用）
  semantic_condition TEXT, -- 自然语言描述
  
  -- 输出
  level TEXT NOT NULL CHECK (level IN ('red', 'yellow', 'green')),
  message JSONB NOT NULL, -- {title, description, suggestion}
  
  -- 生效范围
  scope TEXT NOT NULL DEFAULT 'system', -- 'system' | 'org' | 'contract_type'
  contract_types TEXT[] DEFAULT '{}',
  
  -- 优先级与组合
  priority INTEGER NOT NULL DEFAULT 100,
  group_id UUID, -- 规则组（组合逻辑）
  group_operator TEXT, -- 'AND' | 'OR'
  
  -- 状态
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'archived'
  version INTEGER NOT NULL DEFAULT 1,
  
  -- 统计（实时更新）
  trigger_count INTEGER NOT NULL DEFAULT 0,
  total_evaluations INTEGER NOT NULL DEFAULT 0,
  hit_rate NUMERIC(5,2) DEFAULT 0,
  
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  
  UNIQUE(org_id, rule_code)
);
```

#### 结构化条件类型

| 条件类型 | field | operator | value | 示例 |
|---------|-------|----------|-------|------|
| **数值比较** | payment_term_days | >, <, >=, <=, = | 90 | 账期>90天 |
| **百分比比较** | penalty_rate | >, < | 0.05 | 违约金>5% |
| **文本包含** | contract_text | contains | "违约责任" | 包含违约条款 |
| **文本不包含** | contract_text | not_contains | "保密条款" | 缺少保密条款 |
| **正则匹配** | contract_text | regex | "签字.*日期" | 缺少签字日期 |
| **存在性检查** | attachment_list | exists | "营业执照" | 缺少营业执照 |
| **日期比较** | expiry_date | before, after | TODAY+90 | 证书即将过期 |
| **长度检查** | contract_text | length_gt, length_lt | 5000 | 合同过长/过短 |

#### 结构化规则示例

```yaml
rules:
  # 数值类规则
  - rule_code: RULE-001
    name: 付款账期检查
    rule_type: structured
    category: financial
    condition:
      field: payment_term_days
      operator: ">"
      value: 90
    level: yellow
    message:
      title: "账期超过90天"
      description: "当前账期为{extracted_value}天，超过标准90天"
      suggestion: "建议缩短至60天内或增加预付款比例"
    priority: 100
    
  # 文本类规则
  - rule_code: RULE-002
    name: 保密条款缺失检查
    rule_type: structured
    category: legal
    condition:
      field: contract_text
      operator: not_contains
      value: "保密条款"
    level: yellow
    message:
      title: "缺少保密条款"
      description: "合同未包含保密条款，可能导致商业秘密泄露风险"
      suggestion: "建议添加标准保密条款模板"
    priority: 80
    
  # 正则类规则
  - rule_code: RULE-003
    name: 签字日期检查
    rule_type: structured
    category: compliance
    condition:
      field: contract_text
      operator: regex
      value: "签字.*\\d{4}[-/]\\d{2}[-/]\\d{2}"
      context: "末尾部分"
    level: red
    message:
      title: "缺少签字日期"
      description: "合同末尾未找到签字日期，可能导致合同效力存疑"
      suggestion: "请确认签字页是否完整，添加签字日期"
    priority: 200
```

### 2.3 语义规则设计

#### 语义规则特点

- **输入**：合同全文 + 规则的自然语言描述
- **执行**：AI模型判断是否符合语义条件
- **输出**：触发与否 + AI生成的风险描述

#### 语义规则示例

```yaml
semantic_rules:
  - rule_code: SEM-001
    name: 合同整体风险判断
    rule_type: semantic
    category: legal
    semantic_condition: |
      请判断合同是否存在以下情况：
      1. 责任条款是否明显偏向甲方（如：乙方承担全部责任）
      2. 是否存在模糊表述可能导致争议（如："合理时间内"未定义）
      3. 是否缺少关键法律要素（如：管辖法院、争议解决方式）
      
      如存在上述情况，请指出具体位置和风险描述。
    level: yellow
    message_template:
      title: "合同整体风险偏高"
      description: "{ai_generated_description}"
      suggestion: "{ai_generated_suggestion}"
    priority: 50
    
  - rule_code: SEM-002
    name: 付款条款合理性判断
    rule_type: semantic
    category: financial
    semantic_condition: |
      请判断付款条款是否合理：
      1. 付款节奏是否与交付节点匹配
      2. 是否存在付款比例失衡（如：尾款比例过高）
      3. 是否缺少付款触发条件
      
      如不合理，请说明原因和建议。
    level: green
    message_template:
      title: "付款条款建议优化"
      description: "{ai_generated_description}"
      suggestion: "{ai_generated_suggestion}"
    priority: 30
```

### 2.4 组合逻辑设计

#### 规则组概念

多条规则组合判断，支持 AND/OR 逻辑。

```yaml
rule_groups:
  - group_id: GROUP-001
    name: "高风险合同判定"
    operator: OR
    rules:
      - RULE-001  # 账期>90天
      - RULE-003  # 缺少签字日期
      - SEM-001   # 合同整体风险偏高
    action:
      level: red
      message:
        title: "合同存在高风险"
        description: "合同命中高风险规则组，建议法务重点审核"
        
  - group_id: GROUP-002
    name: "标准合同快速判定"
    operator: AND
    rules:
      - RULE-STD-001  # 使用标准模板
      - RULE-STD-002  # 无条款偏离
    action:
      level: green
      message:
        title: "标准合同"
        description: "合同命中标准合同规则组，可快速审核"
```

#### 组合执行流程

```
规则组执行：
1. 加载所有规则组配置
2. 对每个规则组：
   a. 按operator(AND/OR)执行组内规则
   b. AND：全部触发 → 组触发
   c. OR：任一触发 → 组触发
3. 组触发时：
   a. 合并组内规则的风险描述
   b. 按组配置的level输出
4. 组不触发时：
   a. 各规则独立输出结果
```

### 2.5 规则优先级与冲突解决

| 场景 | 解决策略 |
|------|---------|
| 同一位置触发多条规则 | 按优先级排序，高优先级规则决定最终level |
| 规则与规则组都触发 | 规则组优先（组代表更高层的业务判断） |
| 同level多条规则 | 合并描述，按优先级排序展示 |
| 不同level规则冲突 | 取最高level（red > yellow > green） |

---

## 3. 规则版本管理设计

### 3.1 版本链模型

```sql
CREATE TABLE contract_rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES contract_rules(id) ON DELETE CASCADE,
  
  version INTEGER NOT NULL,
  content JSONB NOT NULL, -- 规则完整快照
  
  -- 变更信息
  change_type TEXT NOT NULL, -- 'create' | 'update' | 'rollback' | 'archive'
  change_summary TEXT,
  rollback_from_version INTEGER, -- 回滚来源版本
  
  -- 生效信息
  status TEXT NOT NULL, -- 'draft' | 'published' | 'archived'
  published_at TIMESTAMPTZ,
  published_by UUID,
  
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(rule_id, version)
);

CREATE INDEX idx_rule_versions_rule ON contract_rule_versions(rule_id, version DESC);
CREATE INDEX idx_rule_versions_published ON contract_rule_versions(published_at DESC) WHERE status = 'published';
```

### 3.2 版本链示例

```
RULE-001 版本链：
v1.0 (2026-05-01) · 创建 · "付款账期检查，阈值90天"
  │
  ▼
v1.1 (2026-05-15) · 更新 · "阈值调整为60天"
  │
  ▼
v1.2 (2026-05-20) · 更新 · "新增message.suggestion"
  │
  ▼
v1.3 (2026-06-01) · 回滚 · "回滚到v1.1，阈值恢复60天"
  │
  ▼
v1.4 (当前) · 发布 · "新增组合规则组GROUP-001"
```

### 3.3 版本操作API

| 操作 | API | 说明 |
|------|-----|------|
| 查看版本历史 | GET /api/rules/:id/versions | 返回版本列表 |
| 查看特定版本 | GET /api/rules/:id/versions/:version | 返回版本详情 |
| 版本对比 | GET /api/rules/:id/compare?from=v1.1&to=v1.4 | 返回差异对比 |
| 回滚到版本 | POST /api/rules/:id/rollback | 创建新版本(内容=目标版本) |
| 发布当前版本 | POST /api/rules/:id/publish | 标记为published |

### 3.4 版本对比设计

```typescript
interface RuleVersionDiff {
  ruleId: string;
  fromVersion: number;
  toVersion: number;
  
  changes: Array<{
    field: string;           // 'condition.value' | 'level' | 'message.title'
    fromValue: any;
    toValue: any;
    changeType: 'added' | 'removed' | 'modified';
  }>;
  
  summary: string;           // "阈值从90改为60，level从yellow改为red"
  impactAssessment: string;  // "预计触发率将从30%提升至50%"
}
```

### 3.5 回滚机制

```
回滚流程：
1. 用户选择目标版本(v1.1)
2. 系统创建新版本(v1.5)：
   - content = v1.1的content快照
   - change_type = 'rollback'
   - rollback_from_version = 1.1
3. 系统更新主表contract_rules：
   - content = v1.5的content
   - version = 1.5
   - status = 'published'
4. 系统记录审计日志
5. 系统通知规则变更（飞书通知法务）
```

---

## 4. 规则测试沙箱设计

### 4.1 测试用例管理

```sql
CREATE TABLE contract_rule_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES contract_rules(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- 测试输入
  test_input TEXT NOT NULL, -- 测试文本
  input_type TEXT NOT NULL DEFAULT 'text', -- 'text' | 'contract_file' | 'ocr_result'
  
  -- 预期输出
  expected_result JSONB NOT NULL, -- {triggered: true/false, extractedValue, level}
  
  -- 实际输出（执行后填充）
  actual_result JSONB,
  passed BOOLEAN,
  
  -- 元数据
  category TEXT, -- 'positive' | 'negative' | 'edge_case'
  tags TEXT[] DEFAULT '{}',
  
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at TIMESTAMPTZ
);
```

### 4.2 测试用例示例

```yaml
test_cases:
  # 正向测试（应该触发）
  - name: "账期120天应触发"
    rule_id: RULE-001
    test_input: "合同第3条：付款方式为银行转账，账期为120天，分三期支付。"
    expected_result:
      triggered: true
      extracted_value: 120
      level: yellow
    category: positive
    
  # 反向测试（不应触发）
  - name: "账期60天不应触发"
    rule_id: RULE-001
    test_input: "合同第3条：付款方式为银行转账，账期为60天。"
    expected_result:
      triggered: false
    category: negative
    
  # 边界测试
  - name: "账期恰好90天边界"
    rule_id: RULE-001
    test_input: "合同第3条：付款方式为银行转账，账期为90天。"
    expected_result:
      triggered: false  # >90 才触发，=90不触发
      note: "边界值测试，operator为>，=90不触发"
    category: edge_case
    
  # 语义规则测试
  - name: "责任偏向甲方应触发"
    rule_id: SEM-001
    test_input: |
      合同第8条：乙方应承担因履行本合同而产生的全部责任和损失，
      包括但不限于甲方因乙方违约而遭受的直接损失、间接损失、
      律师费、诉讼费等全部费用。
    expected_result:
      triggered: true
      level: yellow
      description_contains: "责任条款偏向甲方"
    category: positive
```

### 4.3 测试执行流程

```
单规则测试流程：
1. 用户输入测试文本
2. 系统加载规则配置
3. 系统执行规则引擎：
   - 结构化规则：直接匹配
   - 语义规则：调用AI判断
4. 系统返回结果：
   - triggered: true/false
   - extractedValue: 提取值
   - executionTime: 执行耗时
   - matchDetails: 匹配详情
5. 用户对比预期 vs 实际

批量测试流程：
1. 用户选择多条测试用例
2. 系统逐条执行
3. 系统生成测试报告：
   - 通过率：X/Y
   - 失败用例列表
   - 执行耗时统计
```

### 4.4 测试报告设计

```typescript
interface RuleTestReport {
  ruleId: string;
  ruleName: string;
  testDate: string;
  
  summary: {
    totalCases: number;
    passed: number;
    failed: number;
    passRate: number;
  };
  
  results: Array<{
    caseId: string;
    caseName: string;
    passed: boolean;
    expected: any;
    actual: any;
    diff?: string;         // 差异说明
    executionTime: number;
  }>;
  
  performance: {
    avgExecutionTime: number;
    maxExecutionTime: number;
    semanticRuleCalls: number;
  };
  
  recommendations: Array<{
    type: 'fix_rule' | 'update_case' | 'add_case';
    message: string;
  }>;
}
```

### 4.5 回归测试机制

```
规则变更后的回归测试：
1. 规则发布前，自动运行所有关联测试用例
2. 如果有失败用例：
   - 阻止发布
   - 提示差异
   - 建议：更新规则 or 更新用例
3. 如果全部通过：
   - 允许发布
   - 记录测试报告
```

---

## 5. 规则命中率统计设计

### 5.1 统计数据模型

```sql
-- 规则执行日志（每次合同审核记录）
CREATE TABLE contract_rule_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES contract_rules(id),
  
  triggered BOOLEAN NOT NULL,
  extracted_value TEXT,
  execution_time INTEGER, -- 毫秒
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rule_exec_rule ON contract_rule_execution_logs(rule_id, created_at DESC);
CREATE INDEX idx_rule_exec_triggered ON contract_rule_execution_logs(triggered);

-- 规则统计汇总（每日更新）
CREATE TABLE contract_rule_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES contract_rules(id),
  
  stat_date DATE NOT NULL,
  
  -- 触发统计
  total_evaluations INTEGER NOT NULL DEFAULT 0,
  triggered_count INTEGER NOT NULL DEFAULT 0,
  hit_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  
  -- 执行性能
  avg_execution_time INTEGER,
  max_execution_time INTEGER,
  
  -- 风险分布
  red_count INTEGER DEFAULT 0,
  yellow_count INTEGER DEFAULT 0,
  green_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(rule_id, stat_date)
);
```

### 5.2 统计指标定义

| 指标 | 定义 | 计算方式 | 意义 |
|------|------|---------|------|
| **触发率(Hit Rate)** | 规则触发次数 / 总评估次数 | triggered_count / total_evaluations | 规则有效性 |
| **触发趋势** | 触发率随时间变化 | 每日hit_rate差值 | 规则效果变化 |
| **平均执行时间** | 规则执行耗时 | avg(execution_time) | 性能监控 |
| **风险分布** | 触发后level分布 | red/yellow/green占比 | 规则严重程度 |
| **低触发率告警** | 触发率低于阈值 | hit_rate < 10% | 规则可能无效 |
| **高触发率告警** | 触发率高于阈值 | hit_rate > 80% | 规则可能过宽 |

### 5.3 统计展示页面

```
规则统计页面 (/configs/rules/stats)：

┌─────────────────────────────────────────────────────────────┐
│ 规则命中率统计                              [日期范围选择]    │
├─────────────────────────────────────────────────────────────┤
│ 总览：                                                      │
│   结构化规则 12条 · 平均触发率 45% · 平均执行 50ms           │
│   语义规则 5条 · 平均触发率 30% · 平均执行 2000ms            │
├─────────────────────────────────────────────────────────────┤
│ 规则列表（按触发率排序）：                                    │
│                                                             │
│ RULE-001 付款账期检查        ████████████░░░░ 78%  ✅有效    │
│   触发：156次 / 评估：200次 / 平均：45ms                     │
│   趋势：↑ 较上月+5%                                          │
│                                                             │
│ RULE-002 违约金比例检查      ████████░░░░░░░░ 52%  ✅有效    │
│   触发：104次 / 评估：200次 / 平均：30ms                     │
│   趋势：↓ 较上月-3%                                          │
│                                                             │
│ RULE-005 甲方资质检查        █░░░░░░░░░░░░░░░ 8%   ⚠️低触发  │
│   触发：16次 / 评估：200次 / 平均：20ms                      │
│   原因：大部分合同甲方为已知客户                              │
│   建议：考虑删除或优化条件                                    │
│                                                             │
│ RULE-010 知识产权条款        ██████████████████ 92%  ⚠️过宽  │
│   触发：184次 / 评估：200次 / 平均：25ms                     │
│   原因：几乎所有合同都触发                                    │
│   建议：细化条件，减少误触发                                  │
├─────────────────────────────────────────────────────────────┤
│ 触发趋势图（近30天）：                                        │
│                                                             │
│   RULE-001 ████████████████████████████████████████ 78%     │
│   RULE-002 ████████████████████████░░░░░░░░░░░░░░░░ 52%     │
│   RULE-005 █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 8%      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 低命中率告警机制

```yaml
alert_rules:
  - alert_type: low_hit_rate
    threshold: 10%
    condition: hit_rate < threshold AND total_evaluations > 50
    action:
      - 创建告警记录
      - 飞书通知管理员
      - 标记规则为"待审核"
    message: "规则{rule_code}触发率仅{hit_rate}%，建议检查是否需要优化或删除"
    
  - alert_type: high_hit_rate
    threshold: 80%
    condition: hit_rate > threshold
    action:
      - 创建告警记录
      - 飞书通知管理员
    message: "规则{rule_code}触发率{hit_rate}%，可能条件过宽，建议细化"
    
  - alert_type: performance_degrade
    threshold: 5000ms
    condition: avg_execution_time > threshold
    action:
      - 创建告警记录
      - 飞书通知技术
    message: "规则{rule_code}平均执行{avg_execution_time}ms，性能异常"
```

### 5.5 统计API

| API | 说明 |
|-----|------|
| GET /api/rules/stats | 规则统计总览 |
| GET /api/rules/:id/stats | 单规则统计详情 |
| GET /api/rules/:id/stats/trend | 触发趋势数据（按日期） |
| GET /api/rules/stats/alerts | 告警列表 |
| POST /api/rules/stats/recalculate | 重新计算统计（管理员） |

---

## 6. 条款审核产品化设计（律师视角）

### 6.1 律师审核合同的专业流程

律师审核合同的核心工作不是「一键出报告」，而是：

```
律师合同审核流程（标准专业流程）：

1. 合同结构完整性检查
   ├─ 是否包含必要条款（当事人、标的、价款、期限、违约责任、争议解决）
   ├─ 条款顺序是否合理（按照合同逻辑排列）
   └─ 是否有缺失章节（如缺少附件清单、签字页）

2. 逐条款审核（核心）
   ├─ 每个条款逐一阅读、标记风险等级
   ├─ 对照公司标准条款库，判断偏离程度
   ├─ 标注需要修改的具体内容
   └─ 记录审核意见（修改建议、风险说明）

3. 关键条款重点审核
   ├─ 付款条款：付款比例、账期、付款触发条件
   ├─ 违约条款：违约情形、违约责任、违约金比例
   ├─ 保密条款：保密范围、保密期限、泄密责任
   ├─ 知识产权条款：权属归属、使用范围、侵权责任
   ├─ 终止条款：终止条件、终止后果、通知期限
   └─ 争议解决条款：管辖法院、仲裁条款、适用法律

4. 与标准合同对照
   ├─ 对比公司标准合同模板
   ├─ 标记偏离条款（偏离方向、偏离程度）
   ├─ 判断偏离是否可接受
   └─ 对偏离条款提出修改建议

5. 生成审核意见书
   ├─ 按条款顺序整理审核意见
   ├─ 区分必须修改/建议修改/可接受
   ├─ 提供修改后的条款文本
   └─ 附审核结论（建议签署/需修改后签署/不建议签署）
```

### 6.2 条款审核产品化设计

#### 条款解析与结构化

```
条款解析流程：

OCR提取全文 → 条款自动分段 → 条款编号识别 → 条款标题提取

示例输出：
┌─────────────────────────────────────────────────────────────┐
│ 条款结构解析结果                                             │
├─────────────────────────────────────────────────────────────┤
│ 第1条 合同当事人                                            │
│   ├─ 甲方：XX科技有限公司                                    │
│   ├─ 乙方：YY信息技术有限公司                                │
│                                                             │
│ 第2条 合同标的                                              │
│   ├─ 内容：智能合同审核系统软件许可                          │
│   ├─ 版本：企业版 V3.0                                      │
│                                                             │
│ 第3条 合同价款及支付方式                                     │
│   ├─ 总价款：人民币50万元                                    │
│   ├─ 支付方式：分期支付                                      │
│   ├─ 第1期：合同签订后7日内支付30%（15万元）                 │
│   ├─ 第2期：系统部署完成后7日内支付60%（30万元）             │
│   ├─ 第3期：验收合格后7日内支付10%（5万元）                  │
│                                                             │
│ 第4条 交付与验收                                            │
│   ...                                                       │
│                                                             │
│ 第7条 违约责任                                              │
│   ├─ 乙方违约：支付合同总价款10%的违约金                    │
│   ├─ 甲方违约：支付合同总价款5%的违约金                     │
│                                                             │
│ 第8条 争议解决                                              │
│   ├─ 协商解决                                               │
│   ├─ 协商不成：提交甲方所在地人民法院诉讼解决                │
└─────────────────────────────────────────────────────────────┘
```

#### 条款审核工作台

```
条款审核工作台 UI设计：

┌─────────────────────────────────────────────────────────────┐
│ 条款审核工作台 - 合同CT-2026-001                            │
├─────────────────────────────────────────────────────────────┤
│ [条款列表] [审核意见] [标准对照] [条款库]                     │
├──────────────────┬──────────────────────────────────────────┤
│ 条款列表          │ 条款详情 + 审核操作                       │
│                  │                                          │
│ ✓ 第1条 合同当事人│ 当前条款：第3条 合同价款及支付方式         │
│ ✓ 第2条 合同标的  │                                          │
│ ● 第3条 价款支付  │ ┌────────────────────────────────────┐ │
│   ⚠️ 风险标记    │ │ 原文：                               │ │
│ ○ 第4条 交付验收  │ │ 合同总价款为人民币50万元，           │ │
│ ○ 第5条 保密条款  │ │ 支付方式为分期支付：                 │ │
│ ○ 第6条 知识产权  │ │ 第一期：合同签订后7日内支付30%       │ │
│ ⚠️ 第7条 违约责任 │ │ 第二期：系统部署完成后支付60%        │ │
│ ○ 第8条 争议解决  │ │ 第三期：验收合格后支付10%            │ │
│                  │ └────────────────────────────────────┘ │
│                  │                                          │
│ 统计：           │ 审核状态：🟡 需关注                      │
│ ✅ 已审核 3条    │                                          │
│ ⚠️ 有风险 2条    │ [审核意见]                               │
│ ○ 待审核 4条     │ ┌────────────────────────────────────┐ │
│                  │ │ 风险等级：🟡 中风险                   │ │
│                  │ │                                      │ │
│                  │ │ 问题：                                │ │
│                  │ │ 1. 第三期尾款比例偏低(10%)，建议15%   │ │
│                  │ │ 2. 未规定验收不合格时的退款机制       │ │
│                  │ │                                      │ │
│                  │ │ 修改建议：                            │ │
│                  │ │ 建议将尾款比例调整为15%，并增加       │ │
│                  │ │ "验收不合格时，乙方应在10日内         │ │
│                  │ │ 退还已收取款项"条款                   │ │
│                  │ │                                      │ │
│                  │ │ 审核人：王五(法务)                     │ │
│                  │ │ 审核时间：2026-06-10 15:30            │ │
│                  │ └────────────────────────────────────┘ │
│                  │                                          │
│                  │ [提交审核意见] [标记为无风险] [跳过]      │
└──────────────────┴──────────────────────────────────────────┘
```

#### 条款审核数据模型

```sql
-- 条款解析结果表
CREATE TABLE contract_clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  
  clause_number TEXT NOT NULL,         -- '第3条'
  clause_title TEXT NOT NULL,          -- '合同价款及支付方式'
  clause_content TEXT NOT NULL,        -- 条款全文
  
  -- 结构化提取（AI自动）
  extracted_fields JSONB DEFAULT '{}', -- {total_amount: 500000, payment_stages: [...]}
  
  -- 审核状态
  review_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'reviewing' | 'approved' | 'risk_flagged' | 'skipped'
  risk_level TEXT,                     -- 'red' | 'yellow' | 'green' | null
  
  -- 审核意见
  review_opinion TEXT,
  modification_suggestion TEXT,
  modified_clause_text TEXT,           -- 修改后的条款文本
  
  -- 审核人
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  
  -- 标准对照（关联条款库）
  standard_clause_id UUID REFERENCES clause_library(id),
  deviation_type TEXT,                 -- 'none' | 'minor' | 'major' | 'missing'
  deviation_description TEXT,
  
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clauses_contract ON contract_clauses(contract_id, sort_order);
CREATE INDEX idx_clauses_status ON contract_clauses(review_status);
CREATE INDEX idx_clauses_risk ON contract_clauses(risk_level);
```

#### 条款审核工作流

```
条款审核工作流：

1. 条款解析阶段（系统自动）
   ├─ OCR提取全文
   ├─ AI条款分段（识别条款边界）
   ├─ 条款编号提取（第X条）
   ├─ 条款标题提取
   └─ 结构化字段提取（金额、日期、比例等）

2. 条款分配阶段（法务操作）
   ├─ 法务查看条款列表
   ├─ 可批量分配审核人
   ├─ 可设置优先审核条款（如付款条款）

3. 条款审核阶段（法务逐条审核）
   ├─ 阅读条款原文
   ├─ 对照标准条款库
   ├─ 标记风险等级
   ├─ 填写审核意见
   ├─ 提供修改建议
   └─ 可跳过非关键条款

4. 条款审核完成阶段
   ├─ 所有条款审核完成
   ├─ 生成条款审核汇总报告
   ├─ 区分：必须修改 / 建议修改 / 可接受
   └─ 整体审核结论：建议签署 / 需修改后签署 / 不建议签署
```

### 6.3 条款审核API设计

| API | 说明 |
|-----|------|
| GET /api/contracts/:id/clauses | 获取条款列表 |
| GET /api/contracts/:id/clauses/:clauseId | 获取条款详情 |
| POST /api/contracts/:id/clauses/review | 提交条款审核意见 |
| POST /api/contracts/:id/clauses/:clauseId/skip | 跳过条款审核 |
| GET /api/contracts/:id/clauses/summary | 获取条款审核汇总 |
| POST /api/contracts/:id/clauses/complete | 完成条款审核，生成汇总报告 |

---

## 7. 标准合同对照系统

### 7.1 标准合同模板管理

```
标准合同模板管理：

┌─────────────────────────────────────────────────────────────┐
│ 标准合同模板库                                   [+ 新增模板] │
├─────────────────────────────────────────────────────────────┤
│ 搜索：[模板名称] [合同类型] [适用场景]                        │
├─────────────────────────────────────────────────────────────┤
│ 模板列表：                                                   │
│                                                             │
│ STD-001 软件销售合同标准模板              软件销售    v2.1    │
│   ├─ 适用场景：标准软件许可销售                              │
│   ├─ 必要条款：12条                                          │
│   ├─ 最后更新：2026-05-15                                    │
│   ├─ 使用次数：156次                                         │
│                                                             │
│ STD-002 技术服务合同标准模板              技术服务    v1.3    │
│   ├─ 适用场景：技术咨询、实施服务                            │
│   ├─ 必要条款：15条                                          │
│   ├─ 最后更新：2026-04-20                                    │
│                                                             │
│ STD-003 保密协议标准模板                  NDA        v1.0    │
│   ├─ 适用场景：合作前保密约定                                │
│   ├─ 必要条款：8条                                           │
│                                                             │
│ STD-004 软件维护合同标准模板              维护服务    v1.2    │
│   ├─ 适用场景：软件售后维护                                  │
│   ├─ 必要条款：10条                                          │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 标准合同模板数据模型

```sql
-- 标准合同模板表
CREATE TABLE standard_contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  
  template_code TEXT NOT NULL,         -- 'STD-001'
  name TEXT NOT NULL,                  -- '软件销售合同标准模板'
  contract_type TEXT NOT NULL,         -- 'software_sales' | 'tech_service' | 'nda' | 'maintenance'
  applicable_scenario TEXT,            -- 适用场景描述
  
  -- 模板内容
  template_content TEXT NOT NULL,      -- 模板全文
  template_file_url TEXT,              -- Word模板文件URL
  
  -- 必要条款清单
  required_clauses JSONB NOT NULL,     -- [{clause_number, clause_title, is_required}]
  
  -- 版本
  version TEXT NOT NULL DEFAULT 'v1.0',
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'archived'
  
  -- 使用统计
  usage_count INTEGER NOT NULL DEFAULT 0,
  
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  
  UNIQUE(org_id, template_code)
);

-- 标准条款库表
CREATE TABLE clause_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  
  clause_code TEXT NOT NULL,           -- 'CL-001'
  clause_title TEXT NOT NULL,          -- '付款条款标准版'
  clause_category TEXT NOT NULL,       -- 'payment' | 'liability' | 'confidentiality' | 'ip' | 'termination' | 'dispute'
  
  -- 标准条款文本
  standard_text TEXT NOT NULL,         -- 标准条款全文
  standard_text_short TEXT,            -- 简短版本
  
  -- 可配置参数
  configurable_params JSONB DEFAULT '{}', -- [{param_name, param_type, default_value, range}]
  -- 例如：付款比例、账期、违约金比例
  
  -- 条款说明
  description TEXT,
  risk_note TEXT,                      -- 使用注意事项
  
  -- 关联规则
  related_rules TEXT[] DEFAULT '{}',   -- 关联审核规则ID
  
  -- 版本
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published',
  
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(org_id, clause_code)
);

CREATE INDEX idx_clause_library_category ON clause_library(clause_category);
```

### 7.3 合同与标准模板对照

```
合同对照标准模板流程：

1. 选择对照模板
   ├─ 系统自动推荐（根据合同类型）
   ├─ 法务手动选择模板
   └─ 可对照多个模板（组合对照）

2. 条款对照执行
   ├─ 对每个条款：
   │   ├─ 查找对应的标准条款
   │   ├─ 提取偏离点
   │   ├─ 计算偏离程度
   │   └─ 标记偏离方向（偏向甲方/偏向乙方）
   │
   └─ 对照结果：
   │   ├─ 完全匹配条款
   │   ├─ 轻微偏离条款
   │   ├─ 重大偏离条款
   │   ├─ 缺失条款
   │   └─ 多余条款（合同有但模板没有）

3. 对照报告生成
   ├─ 对照汇总表
   ├─ 偏离条款详情
   ├─ 偏离风险评估
   └─ 偏离修改建议
```

### 7.4 标准对照UI设计

```
标准合同对照视图：

┌─────────────────────────────────────────────────────────────┐
│ 标准合同对照 - CT-2026-001 vs STD-001(软件销售合同标准模板) │
├─────────────────────────────────────────────────────────────┤
│ 对照模板：[STD-001 ▼]                      [重新对照]       │
├──────────────────┬──────────────────┬─────────────────────┤
│ 合同条款          │ 标准条款          │ 对照结果            │
├──────────────────┼──────────────────┼─────────────────────┤
│ 第3条 价款支付    │ CL-003 标准付款   │ ⚠️ 重大偏离         │
│                  │                  │                     │
│ 合同：            │ 标准：            │ 偏离点：            │
│ 尾款10%          │ 尾款15%          │ 尾款比例偏低        │
│ 验收后支付        │ 验收+质保期后    │ 缺少质保期约束      │
│                  │                  │                     │
│                  │                  │ 偏离方向：偏向甲方   │
│                  │                  │ 风险：可能影响回款   │
│                  │                  │                     │
│                  │                  │ 建议：恢复尾款15%    │
├──────────────────┼──────────────────┼─────────────────────┤
│ 第7条 违约责任    │ CL-007 标准违约   │ ⚠️ 轻微偏离         │
│                  │                  │                     │
│ 合同：            │ 标准：            │ 偏离点：            │
│ 乙方违约金10%    │ 双方违约金5%     │ 违约金不对称        │
│ 甲方违约金5%     │                  │                     │
│                  │                  │ 偏离方向：偏向甲方   │
│                  │                  │ 风险：可接受        │
├──────────────────┼──────────────────┼─────────────────────┤
│ 第5条 保密条款    │ CL-005 标准保密   │ ✅ 完全匹配         │
│                  │                  │                     │
│ 合同：            │ 标准：            │ 无偏离              │
│ (与标准条款一致) │                  │                     │
├──────────────────┼──────────────────┼─────────────────────┤
│ -                │ CL-006 知识产权   │ ❌ 缺失条款         │
│                  │                  │                     │
│ 合同无此条款      │ 标准：            │ 风险：高            │
│                  │ 知识产权归属乙方 │ 建议：必须添加      │
├──────────────────┴──────────────────┴─────────────────────┤
│ 对照汇总：                                                  │
│   完全匹配：3条                                             │
│   轻微偏离：2条（可接受）                                    │
│   重大偏离：1条（需修改）                                    │
│   缺失条款：1条（必须添加）                                  │
│                                                             │
│ 整体结论：⚠️ 需修改后签署                                    │
│                                                             │
│ [导出对照报告] [生成修改建议Word]                           │
└─────────────────────────────────────────────────────────────┘
```

### 7.5 对照API设计

| API | 说明 |
|-----|------|
| GET /api/standard-templates | 标准模板列表 |
| POST /api/contracts/:id/compare | 执行合同对照 |
| GET /api/contracts/:id/compare-result | 获取对照结果 |
| POST /api/contracts/:id/compare/export | 导出对照报告 |

---

## 8. 条款库与条款模板管理

### 8.1 条款库设计

条款库是法务维护的标准条款集合，用于：

1. 合同审核时对照
2. 新合同起草时引用
3. 偏离条款修改时推荐替换

```
条款库管理页面：

┌─────────────────────────────────────────────────────────────┐
│ 条款库管理                                     [+ 新增条款] │
├─────────────────────────────────────────────────────────────┤
│ 分类筛选：[全部] [付款] [违约] [保密] [知识产权] [终止] ... │
├─────────────────────────────────────────────────────────────┤
│ 条款列表：                                                   │
│                                                             │
│ CL-001 付款条款标准版                          付款    v2.0  │
│   ├─ 标准文本：                                              │
│   │   "合同总价款为人民币___万元，支付方式为分期支付...     │
│   ├─ 可配置参数：                                            │
│   │   - 总价款（数值，默认空）                               │
│   │   - 首付款比例（百分比，默认30%，范围20%-50%）          │
│   │   - 中期款比例（百分比，默认55%，范围40%-70%）          │
│   │   - 尾款比例（百分比，默认15%，范围10%-20%）            │
│   │   - 账期天数（数值，默认7天，范围3-30天）               │
│   ├─ 关联规则：RULE-001(账期检查)、RULE-002(比例检查)       │
│   ├─ 使用次数：89次                                          │
│                                                             │
│ CL-002 付款条款宽松版                          付款    v1.0  │
│   ├─ 适用场景：客户议价能力较强时                            │
│   ├─ 标准文本：                                              │
│   │   "合同总价款为人民币___万元，支付方式由双方协商...     │
│   ├─ 可配置参数：（较少约束）                                │
│   ├─ 关联规则：RULE-001(账期检查)                            │
│                                                             │
│ CL-007 违约责任标准版                          违约    v1.5  │
│   ├─ 标准文本：                                              │
│   │   "任何一方违反本合同约定的，应向守约方支付合同总价款... │
│   ├─ 可配置参数：                                            │
│   │   - 违约金比例（百分比，默认5%，范围3%-10%）            │
│   ├─ 风险注意：违约金比例过高可能被法院调低                  │
│   ├─ 关联规则：RULE-003(违约金检查)                         │
│                                                             │
│ CL-005 保密条款标准版                          保密    v1.0  │
│   ...                                                       │
│                                                             │
│ CL-006 知识产权条款标准版                      知识产权  v1.2 │
│   ├─ 标准文本：                                              │
│   │   "本合同项下产生的所有知识产权归乙方所有...            │
│   ├─ 可配置参数：                                            │
│   │   - 权属归属（选项：乙方/甲方/共有）                    │
│   ├─ 风险注意：与客户已有知识产权的冲突处理                  │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 条款分类体系

| 分类 | 包含条款类型 | 审核重点 |
|------|------------|---------|
| **付款条款** | 价款、支付方式、账期、付款触发条件 | 账期、比例、触发条件 |
| **违约条款** | 违约情形、违约责任、违约金比例、免责条款 | 违约金比例、违约情形完整性 |
| **保密条款** | 保密范围、保密期限、泄密责任、保密例外 | 保密范围是否过宽/过窄 |
| **知识产权条款** | 权属归属、使用范围、侵权责任、IP许可 | 权属明确性、使用范围限制 |
| **终止条款** | 终止条件、终止程序、终止后果、通知期限 | 终止条件合理性、通知期限 |
| **争议解决条款** | 管辖法院、仲裁条款、适用法律、送达地址 | 管辖是否偏向对方、送达地址 |
| **质保条款** | 质保范围、质保期限、质保责任、质保例外 | 质保期限、质保范围 |
| **交付条款** | 交付内容、交付标准、交付时间、验收标准 | 交付标准明确性、验收条件 |

### 8.3 条款使用场景

```
条款库的三种使用场景：

场景1：合同审核对照
┌─────────────────────────────────────────────────────────────┐
│ 条款审核 → 对照条款库 → 标记偏离 → 推荐标准条款替换        │
│                                                             │
│ 第3条(偏离) → 查找CL-001 → 推荐恢复为标准付款条款           │
│ 第7条(偏离) → 查找CL-007 → 推荐恢复为标准违约条款           │
└─────────────────────────────────────────────────────────────┘

场景2：新合同起草辅助
┌─────────────────────────────────────────────────────────────┐
│ 新合同起草 → 选择合同类型 → 自动组装标准条款 → 参数填写     │
│                                                             │
│ 选择"软件销售合同" → 自动加载：                             │
│   CL-001(付款) + CL-005(保密) + CL-006(IP) + CL-007(违约)   │
│ → 填写参数：总价款50万、首付30%、账期7天...                  │
│ → 生成合同草稿                                               │
└─────────────────────────────────────────────────────────────┘

场景3：偏离条款修改建议
┌─────────────────────────────────────────────────────────────┐
│ 审核发现偏离 → 生成修改建议 → 附上标准条款文本              │
│                                                             │
│ 第3条偏离 → 修改建议：                                       │
│   "建议将第3条修改为："                                      │
│   [标准条款文本，参数已填]                                   │
│   "原条款偏离点：尾款比例偏低，缺少质保期约束"              │
└─────────────────────────────────────────────────────────────┘
```

### 8.4 条款版本与变更管理

```
条款版本管理：

CL-001 付款条款标准版 版本链：
v1.0 (2026-01-15) · 创建 · "分期付款，尾款10%"
  │
  ▼
v1.5 (2026-03-20) · 更新 · "尾款调整为15%，增加质保期约束"
  │    变更原因：历史项目中尾款10%导致回款风险
  │    影响评估：已审核合同156份，需通知法务
  │
  ▼
v2.0 (2026-05-15) · 更新 · "增加付款触发条件条款"
  │    变更原因：缺少付款触发条件导致争议
  │
  ▼
v2.0 (当前) · 发布

条款变更通知机制：
- 条款版本更新 → 飞书通知所有法务
- 条款删除 → 飞书通知 + 需确认替换条款
- 条款参数变更 → 自动更新关联规则
```

### 8.5 条款与规则的联动

```
条款-规则联动机制：

条款库 ←→ 规则引擎：

1. 条款关联规则
   ├─ CL-001(付款条款) → 关联 RULE-001(账期检查)、RULE-002(比例检查)
   ├─ CL-007(违约条款) → 关联 RULE-003(违约金检查)
   └─ 条款变更 → 自动更新规则的条件值

2. 规则执行时条款推荐
   ├─ 规则触发 → 查找关联标准条款
   ├─ 在审核意见中附上"推荐标准条款文本"
   └─ 法务可一键采用标准条款替换

3. 条款偏离自动检测
   ├─ 合同条款与条款库对照
   ├─ 自动检测偏离点
   ├─ 触发关联规则
   └─ 生成偏离风险提示
```

---

## 9. 文件清单（完整）

### 新建文件

```
product-truth/feature-packets/F005-F006-complete-design.md  # 本文档

# 数据库
supabase/migrations/20260610000001_enhance_contract_rules.sql
supabase/migrations/20260610000002_add_rule_versions.sql
supabase/migrations/20260610000003_add_rule_test_cases.sql
supabase/migrations/20260610000004_add_rule_execution_logs.sql
supabase/migrations/20260610000005_add_rule_stats.sql
supabase/migrations/20260610000006_add_contract_clauses.sql
supabase/migrations/20260610000007_add_standard_templates.sql
supabase/migrations/20260610000008_add_clause_library.sql

# 后端 - 规则引擎
lib/rules/engine.ts                    # 规则引擎核心
lib/rules/structured-executor.ts       # 结构化规则执行器
lib/rules/semantic-executor.ts         # 语义规则执行器
lib/rules/group-executor.ts            # 规则组执行器
lib/rules/conflict-resolver.ts         # 冲突解决器
lib/rules/test-runner.ts               # 测试沙箱执行器
lib/rules/stats-aggregator.ts          # 统计聚合器

# 后端 - 条款审核
lib/clause/parser.ts                   # 条款解析器
lib/clause/extractor.ts                # 条款字段提取器
lib/clause/comparator.ts               # 条款对照器
lib/clause/recommender.ts              # 条款推荐器

# API - 规则管理
app/api/rules/route.ts
app/api/rules/[id]/route.ts
app/api/rules/[id]/versions/route.ts
app/api/rules/[id]/test/route.ts
app/api/rules/[id]/stats/route.ts
app/api/rules/stats/route.ts

# API - 条款审核
app/api/contracts/[id]/clauses/route.ts
app/api/contracts/[id]/clauses/[clauseId]/route.ts
app/api/contracts/[id]/clauses/review/route.ts
app/api/contracts/[id]/clauses/summary/route.ts
app/api/contracts/[id]/compare/route.ts

# API - 标准模板与条款库
app/api/standard-templates/route.ts
app/api/standard-templates/[id]/route.ts
app/api/clause-library/route.ts
app/api/clause-library/[id]/route.ts

# UI - 规则管理
app/configs/rules/page.tsx
app/configs/rules/[id]/page.tsx
app/configs/rules/[id]/test/page.tsx
app/configs/rules/stats/page.tsx

# UI - 条款审核
app/contracts/[id]/clauses/page.tsx    # 条款审核工作台
app/contracts/[id]/compare/page.tsx    # 标准对照页面

# UI - 条款库管理
app/configs/clause-library/page.tsx
app/configs/clause-library/[id]/page.tsx
app/configs/standard-templates/page.tsx
```

---

## 10. Phase规划（完整）

| Phase | 内容 | 周期 |
|-------|------|------|
| **Phase 1** | 合同审核用户地图落地 + UI页面增强 | 1周 |
| **Phase 2** | 规则分类设计落地 + 规则引擎重构 | 2周 |
| **Phase 3** | 规则版本管理 + 回滚机制 | 1周 |
| **Phase 4** | 规则测试沙箱 + 回归测试 | 1周 |
| **Phase 5** | 规则命中率统计 + 告警机制 | 1周 |
| **Phase 6** | 条款解析 + 条款审核工作台 | 2周 |
| **Phase 7** | 标准合同对照系统 | 1周 |
| **Phase 8** | 条款库管理 + 条款模板 | 1周 |

---

## 11. 验收标准（完整）

| TC | 场景 | 预期 |
|----|------|------|
| TC-D01 | 销售上传合同 | 看到进度条+状态文案+ASK清单 |
| TC-D02 | 法务查看合同详情 | 看到风险摘要+ASK状态+报告版本 |
| TC-D03 | 财务录入回应 | 只看到财务相关ASK，录入后触发升版 |
| TC-D04 | 管理员新增规则 | 选择类型+配置条件+测试+发布 |
| TC-D05 | 规则测试沙箱 | 输入测试文本→返回触发结果→对比预期 |
| TC-D06 | 规则版本回滚 | 选择历史版本→回滚→生成新版本 |
| TC-D07 | 规则命中率统计 | 查看触发率+趋势+告警 |
| TC-D08 | 低命中率告警 | 触发率<10%→飞书通知+标记待审核 |
| **TC-C01** | 条款解析 | OCR→条款分段→编号提取→标题提取 |
| **TC-C02** | 条款审核 | 法务逐条审核→标记风险→填写意见 |
| **TC-C03** | 条款审核汇总 | 所有条款审核完成→生成汇总报告 |
| **TC-C04** | 标准合同对照 | 选择模板→条款对照→偏离标记→修改建议 |
| **TC-C05** | 条款库使用 | 审核偏离→推荐标准条款→一键替换 |
| **TC-C06** | 条款起草辅助 | 选择合同类型→组装条款→填写参数→生成草稿 |
| **TC-C07** | 条款版本变更 | 条款版本更新→通知法务→关联规则同步 |
| **TC-C08** | 缺失条款检测 | 对照发现缺失→高风险标记→必须添加提示 |

---

**下一步**：确认设计后，按Phase 1开始实施。

```
product-truth/feature-packets/F005-F006-complete-design.md  # 本文档

# 后端
lib/rules/engine.ts                    # 规则引擎核心
lib/rules/structured-executor.ts       # 结构化规则执行器
lib/rules/semantic-executor.ts         # 语义规则执行器（调用AI）
lib/rules/group-executor.ts            # 规则组执行器
lib/rules/conflict-resolver.ts         # 冲突解决器
lib/rules/test-runner.ts               # 测试沙箱执行器
lib/rules/stats-aggregator.ts          # 统计聚合器

# 数据库
supabase/migrations/20260610000001_enhance_contract_rules.sql
supabase/migrations/20260610000002_add_rule_versions.sql
supabase/migrations/20260610000003_add_rule_test_cases.sql
supabase/migrations/20260610000004_add_rule_execution_logs.sql
supabase/migrations/20260610000005_add_rule_stats.sql

# API
app/api/rules/route.ts                 # 规则CRUD
app/api/rules/[id]/route.ts
app/api/rules/[id]/versions/route.ts   # 版本管理
app/api/rules/[id]/test/route.ts       # 规则测试
app/api/rules/[id]/stats/route.ts      # 规则统计
app/api/rules/stats/route.ts           # 统计总览
app/api/rules/stats/alerts/route.ts   # 告警列表

# UI
app/configs/rules/page.tsx             # 规则管理页
app/configs/rules/[id]/page.tsx        # 规则详情页
app/configs/rules/[id]/test/page.tsx   # 规则测试页
app/configs/rules/stats/page.tsx       # 统计展示页
app/contracts/[id]/page.tsx            # 合同详情页（增强ASK标签页）
```

### 修改文件

```
product-truth/01-business-truth/合同审核.md    # 同步用户地图
product-truth/01-business-truth/配置中心.md    # 同步规则设计
product-truth/REQ_REGISTRY.yml                 # 更新F005/F006状态
```

---

## 7. Phase规划

| Phase | 内容 | 周期 |
|-------|------|------|
| **Phase 1** | 合同审核用户地图落地 + UI页面增强 | 1周 |
| **Phase 2** | 规则分类设计落地 + 规则引擎重构 | 2周 |
| **Phase 3** | 规则版本管理 + 回滚机制 | 1周 |
| **Phase 4** | 规则测试沙箱 + 回归测试 | 1周 |
| **Phase 5** | 规则命中率统计 + 告警机制 | 1周 |

---

## 8. 验收标准

| TC | 场景 | 预期 |
|----|------|------|
| TC-D01 | 销售上传合同 | 看到进度条+状态文案+ASK清单 |
| TC-D02 | 法务查看合同详情 | 看到风险摘要+ASK状态+报告版本 |
| TC-D03 | 财务录入回应 | 只看到财务相关ASK，录入后触发升版 |
| TC-D04 | 管理员新增规则 | 选择类型(结构化/语义)+配置条件+测试+发布 |
| TC-D05 | 规则测试沙箱 | 输入测试文本→返回触发结果→对比预期 |
| TC-D06 | 规则版本回滚 | 选择历史版本→回滚→生成新版本 |
| TC-D07 | 规则命中率统计 | 查看触发率+趋势+告警 |
| TC-D08 | 低命中率告警 | 触发率<10%→飞书通知+标记待审核 |

---

**下一步**：确认设计后，按Phase 1开始实施。
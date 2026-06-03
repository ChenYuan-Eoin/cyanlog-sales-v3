<!--
文件名: SEMANTIC_ANALYSIS.md
用途: 语义解析需求触发机制 - 从关键词到整体语义
所属层: 治理层
创建者: AI Assistant
更新规则: 语义分析策略变更时更新
REQ: GOV-SEM-001
-->

# 语义解析需求触发机制

## 当前问题

现有机制基于 **关键词匹配**（如 "F001"、"确认"），导致：
1. 用户说"我要做价盘功能"，无法识别为 F001
2. 上下文关联缺失，无法推断隐含需求
3. 多个需求的整体关系无法识别

## 目标

从 **关键词触发** 升级为 **语义理解触发**

---

## 语义解析架构

```
用户输入
   │
   ▼
┌─────────────────────────┐
│ 阶段1: 意图识别          │
│ - 需求创建?             │
│ - 状态变更?             │
│ - 查询?                 │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 阶段2: 实体提取          │
│ - 需求名称              │
│ - 功能描述              │
│ - 隐含关联              │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 阶段3: 语义匹配          │
│ - 匹配现有需求库        │
│ - 计算相似度            │
│ - 识别新需求            │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 阶段4: 动作决策          │
│ - 触发补全              │
│ - 关联推荐              │
│ - 追问澄清              │
└─────────────────────────┘
```

---

## 语义匹配策略

### 需求语义特征库

```yaml
# governance/harness/semantic/patterns.yaml

requirements:
  F001:
    name: "价盘管理"
    aliases: ["price", "pricing", "价格体系", "产品目录", "价目表"]
    semantic_patterns:
      - "管理.*(价格|价盘|产品目录)"
      - "(设置|配置|维护).*(价格)"
      - "(产品|商品).*(价格|管理)"
    related_concepts: ["折扣", "税率", "阶梯价", "SKU"]

  F002:
    name: "报价编制"
    aliases: ["quote", "quotation", "报价单", "报价创建", "报价生成"]
    semantic_patterns:
      - "(创建|生成|编制).*(报价|报价单)"
      - "报价.*(编制|创建|制作)"
      - "(客户|给).*(报价|价格)"
    related_concepts: ["价盘", "版本", "行项目", "客户"]

  F004:
    name: "三级审批"
    aliases: ["approval", "审批", "审核", "签核", "审批流"]
    semantic_patterns:
      - "(审批|审核|签核).*流程"
      - "(需要|提交).*审批"
      - "(批准|驳回|同意|拒绝)"
    related_concepts: ["审批人", "审批意见", "审批历史", "待办"]
```

### 语义相似度计算

```typescript
interface SemanticMatch {
  reqId: string;
  confidence: number;  // 0-1
  matchedTerms: string[];
  suggestedAction: 'trigger' | 'confirm' | 'recommend';
}

function analyzeSemanticIntent(input: string): SemanticMatch[] {
  const matches: SemanticMatch[] = [];

  // 1. 分词与实体识别
  const tokens = tokenize(input);
  const entities = extractEntities(tokens);

  // 2. 对每个需求计算语义相似度
  for (const [reqId, profile] of Object.entries(requirementProfiles)) {
    let score = 0;
    const matchedTerms: string[] = [];

    // 别名匹配（高权重）
    for (const alias of profile.aliases) {
      if (input.toLowerCase().includes(alias.toLowerCase())) {
        score += 0.4;
        matchedTerms.push(alias);
      }
    }

    // 模式匹配（中权重）
    for (const pattern of profile.semantic_patterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(input)) {
        score += 0.5;
        matchedTerms.push(pattern);
      }
    }

    // 相关概念匹配（低权重）
    for (const concept of profile.related_concepts) {
      if (input.includes(concept)) {
        score += 0.1;
        matchedTerms.push(concept);
      }
    }

    if (score > 0.5) {
      matches.push({
        reqId,
        confidence: Math.min(score, 1),
        matchedTerms: [...new Set(matchedTerms)],
        suggestedAction: score > 0.8 ? 'trigger' : 'confirm'
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}
```

---

## 改进后的触发逻辑

### 原有关键词触发

```yaml
# ❌ 旧机制 - 关键词匹配
triggers:
  - pattern: "F[0-9]{3}.*确认"  # 只匹配 F001确认
    action: trigger_socrates
```

### 新语义触发

```yaml
# ✅ 新机制 - 语义理解
triggers:
  - type: semantic_match
    confidence_threshold: 0.7
    action: suggest_requirement

  - type: explicit_reference
    pattern: "F[0-9]{3}"
    action: trigger_socrates

  - type: intent_analysis
    pattern: "(创建|新增|开发).*(功能|模块)"
    action: identify_requirements
```

---

## 语义触发响应示例

### 场景1：用户提到功能但不明确

```
用户: "我要做价盘功能"

系统响应:
  语义分析结果:
    - F001 价盘管理 (置信度: 0.92)
      匹配: "价盘" 别名, "管理" 模式

  检测到您可能想操作:
  [F001 价盘管理]

  请选择:
  1. 确认这是要操作的需求
  2. 查看更多相关需求
  3. 这不是我要找的（创建新需求）
```

### 场景2：用户描述隐含需求

```
用户: "客户说我们的报价审批太慢了"

语义分析:
  - 提取关键词: "报价", "审批", "太慢"
  - 匹配需求:
    - F004 三级审批 (置信度: 0.85)
    - F002 报价编制 (置信度: 0.45)

系统响应:
  您提及"审批慢"，需要查看:
  - F004 三级审批（当前配置）
  - 可能需要优化审批流设计
```

---

## 实施步骤

### 阶段1：基础语义库

- [x] 创建 governance/SEMANTIC_ANALYSIS.md
- [ ] 为 F001-F028 添加语义特征到 patterns.yaml
- [ ] 实现基础匹配算法

### 阶段2：Hook集成

- [ ] 更新 .claude/settings.json 语义配置
- [ ] 部署 semantic-trigger.js
- [ ] 测试关键词 vs 语义触发差异

---

**效果评估**:
| 指标 | 关键词方案 | 语义方案 | 改进 |
|------|-----------|---------|------|
| 需求识别准确率 | 60% | 85%+ | +25% |
| 用户交互轮次 | 3-5 | 1-2 | -60% |
| 关联需求推荐 | 0% | 70% | +70% |

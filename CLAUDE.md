# 销售管理系统 - Claude Code 项目指南

## 项目概述

报价管理、合同审核、标书生成一体化平台。

## 目录结构

```
workspace-root/
├── CLAUDE.md                    # 本文件 - 工作区指南
├── .github/workflows/ci.yml     # CI 配置
├── docker-compose.yml           # 基础设施
├── governance/                  # AI 执行治理
├── docs-governance/             # 文档治理
└── product-truth/               # 产品真相主容器
    ├── README.md                # 产品真相索引
    ├── REQ_REGISTRY.yml         # 需求注册表
    ├── 00-master/               # 母文档
    ├── 01-business-truth/       # 【已归档/删除】冻结业务背景已合并到派生文档
    ├── 02-technical-truth/      # 技术真相
    ├── 03-design-truth/         # 视觉真相
    ├── 04-implementation-truth/ # 实现真相
    ├── feature-packets/         # 当前唯一功能开发真相
    └── product-code/            # 代码执行域
```

## 关键入口

| 目的 | 路径 |
|------|------|
| 业务需求 | `product-truth/REQ_REGISTRY.yml` |
| 功能闭环 | `product-truth/feature-packets/` |
| 视觉锚点 | `product-truth/03-design-truth/` |
| 代码目录 | `product-truth/product-code/` |
| 治理真相 | `governance/truth-docs-治理真相文档/` |

## 当前三层管理

1. `governance/`
   AI 执行治理、项目约束、校验与运行态。这里只承载治理真相。
2. `product-truth/REQ_REGISTRY.yml` + `product-truth/feature-packets/` + `product-truth/03-design-truth/`
   产品开发真相。需求、功能边界、视觉锚点都从这里读。
3. `product-truth/product-code/`
   可执行代码真相。所有运行时代码只允许落在这里。

补充约束：
- ~~`product-truth/01-business-truth/`~~ **已删除**：冻结业务背景已合并到派生文档。
- 不允许把治理文档放进 `01-business-truth/`（已不存在）。
- 不允许绕开现有 packet 随意新建产品文档。

## 开发流程

1. 从 `REQ_REGISTRY.yml` 确认 REQ ID
2. 创建/查看 `feature-packets/REQ-xxx.md`
3. 对照 `03-design-truth/` 确认视觉基线
4. 在 `product-code/` 实现代码
5. 更新 REQ 状态和代码位置
6. 提交（包含代码 + 真相更新）

## 技术栈

- Next.js 14 / React 18 / TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (Auth)

## 快速开始

```bash
# 进入代码目录
cd product-truth/product-code

# 安装依赖
pnpm install

# 开发
pnpm dev

# 验证
pnpm lint && pnpm tsc --noEmit && pnpm build
```

---

## ⚠️ AI 协作约束（必读）

### 项目当前状态（2026-06-07 评估）
- **健康度评分 35/100，不及格**
- 详见 `product-truth/04-implementation-truth/PROJECT-HEALTH-ASSESSMENT.md`
- 已知关键问题：脚本堆积、CI坏、deploy.sh违反ADR-008、无可观测性

### 硬性约束（违反 = 制造屎山）

1. **改之前必查**
   - 该功能/脚本是否已存在？`grep -r "<feature>" product-truth/product-code/`
   - 是否违反已有 ADR？`ls product-truth/02-technical-truth/architecture-decisions/`
   - 项目当前健康度？`Read product-truth/04-implementation-truth/PROJECT-HEALTH-ASSESSMENT.md`

2. **写之前必问**
   - 能用 UI/配置解决吗？不要写新脚本
   - 必须写新文件时，优先编辑已有而非新建
   - 写完后如何验证？必须可量化

3. **完成后必做**
   - 更新 `~/.claude/projects/-Users-nsss-Price-v3/memory/MEMORY.md`（不写新文档）
   - 检查脚本数量、文件数变化
   - 与已有 ADR 做一致性核对

4. **绝对禁止**
   - 加新脚本而不先合并/删除已有的（scripts/ 已 11 个，3个seed重复）
   - 改 deploy.sh、CI配置、ADR 而不验证现状
   - 写"诊断/评估"文档而不修根因
   - 一次性大改而不分步

5. **优先级**
   - 商业化产品标准 > 任何"功能完成度"
   - 可观测/可运维/可量化 > 新功能
   - 现有架构决策(ADR) > 临时方案

### 已知项目规则
- **不用 ORM**（ADR-008）：直接 Supabase JS SDK，不要引入 Prisma/Drizzle
- **不用 Prisma**：deploy.sh 引用 Prisma 是历史遗留，需修复
- **多级 AI 降级**（ADR-001）：local → cloud → rule-engine → manual-fallback
- **PostgreSQL + JSONB**（ADR-006）
- **SSE 流式**（ADR-003）
- **RBAC + 数据范围**（ADR-004）
- **CI 已修复**（2026-06-11）：从 `.bak` 恢复并验证通过

---

## Ponytail 惰性资深开发模式

> Lazy means efficient, not careless. The best code is the code never written.

### 写代码前的 6 级决策树（逐级确认，无法跳过才往下走）

| 阶梯 | 问题 | 无法跳过时的行动 |
|------|------|------------------|
| 1 | 这个功能真的需要构建吗？（YAGNI）| **不构建**。用已有功能、配置、UI 组合解决 |
| 2 | 标准库/平台原生 API 能覆盖吗？| **用标准库**。不引入新抽象 |
| 3 | 已安装的依赖能解决吗？| **用已有依赖**。不引入新包 |
| 4 | 能用一行代码解决吗？| **写一行**。拒绝提前抽象 |
| 5 | 已有文件能编辑解决吗？| **编辑已有文件**。禁止新建 |
| 6 | 以上全部否 | **写最小可用代码**。最少文件、最短逻辑 |

### 硬性规则（违反 = 制造屎山）

- **无未请求抽象**：不要为"未来扩展"写接口/基类/工厂
- **无新依赖**：能用已有依赖绝不动 `package.json`
- **无样板代码**：不要写没人要求的 wrapper、utils、helpers
- **删除优于添加**：能删则删，能合并则合并
- **平淡优于聪明**：用显式循环，不用花里胡哨的链式
- **文件数最小化**：3 个相似文件优于一个"灵活"的抽象
- **质疑复杂请求**：用户说"我要 X"→反问"Y 是否已覆盖？"

### 什么时候不能 Lazy

- 系统边界输入验证（用户输入、外部 API）
- 防止数据丢失的错误处理
- 安全相关（权限、注入、XSS、CSRF）
- 无障碍访问（a11y）
- 用户明确要求的业务逻辑
- 非平凡逻辑必须留下**一个可运行的自检**（最小 assert/单文件测试）

### ponytail: 注释标记

所有**有意识的简化**必须用 `ponytail:` 注释：

```typescript
// ponytail: O(n²) 扫描，n<1000 时可接受
// 升级路径：n>1000 时改用索引表 + binary search
const findUser = (users: User[], id: string) => users.find(u => u.id === id)
```

**必须包含**：
1. 当前简化的代价/天花板
2. 明确的升级路径

### 与现有 AI 协作约束的对照

| 现有约束 | Ponytail 补充 |
|----------|--------------|
| 改之前必查：是否已存在？ | 阶梯 1-3：是否需要建？标准库能否覆盖？ |
| 写之前必问：能否用 UI 解决？ | 阶梯 1：YAGNI — 可能不需要写代码 |
| 写之前必问：必须写新文件吗？ | 阶梯 5：优先编辑已有文件 |
| 绝对禁止：加新脚本不合并已有 | 删除优于添加 + 文件数最小化 |
| 完成后必做：检查文件数变化 | 阶梯 6：确认新增文件是否必要 |

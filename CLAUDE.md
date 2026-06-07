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
    ├── 01-business-truth/       # 业务真相
    ├── 02-technical-truth/      # 技术真相
    ├── 03-design-truth/         # 设计真相
    ├── 04-implementation-truth/ # 实现真相
    ├── feature-packets/         # 功能闭环包
    └── product-code/            # 代码执行域
```

## 关键入口

| 目的 | 路径 |
|------|------|
| 业务需求 | `product-truth/REQ_REGISTRY.yml` |
| 功能闭环 | `product-truth/feature-packets/` |
| 代码目录 | `product-truth/product-code/` |
| 治理配置 | `governance/runtime-config/` |

## 开发流程

1. 从 `REQ_REGISTRY.yml` 确认 REQ ID
2. 创建/查看 `feature-packets/REQ-xxx.md`
3. 在 `product-code/` 实现代码
4. 更新 REQ 状态和代码位置
5. 提交（包含代码 + 真相更新）

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
- **CI 是 .bak，已坏**：从 `.github/workflows/ci.yml.bak` 恢复前必须验证


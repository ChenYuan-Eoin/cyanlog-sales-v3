# Price V3 - Claude Code 项目指南

## 项目概述

销售管理系统（Price-V3）——报价管理、合同审核、标书生成一体化平台。

## 目录结构

```
Price-v3/
├── cyanlog-sales-v3/          # Next.js 14 应用代码
├── product-truth-产品真相层/     # 产品需求与业务真相
├── harness-manager-治理管理/     # AI 运行治理与校验
├── md-doc-manager-文档管理/      # 文档维护工具
├── PROJECT-主文档.md -> ...    # 主文档（符号链接）
└── CLAUDE.md                   # 本文件
```

## 关键入口

| 目的 | 路径 |
|------|------|
| 业务需求 | `product-truth-产品真相层/README.md` |
| 需求注册表 | `product-truth-产品真相层/REQ_REGISTRY.yml` |
| 代码目录 | `cyanlog-sales-v3/` |
| AI 配置 | `harness-manager-治理管理/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json` |

## 治理状态 (P1 完成)

- ✅ **Hook 管理**：managed hook 已启用（通过 `.git/hooks/pre-commit`）
- ✅ **需求控制链**：统一使用 `REQ_REGISTRY.yml`，代码校验器已更新解析 YAML
- ✅ **文档索引**：README 已标记 active/reserved 状态

## 开发规范

1. **代码标记**：文件头必须包含 `// REQ:Fxxx`
2. **需求状态**：开发前确认 REQ_REGISTRY.yml 中状态为 `confirmed`
3. **Git Hook**：pre-commit 会自动校验 REQ ID 和状态

## 技术栈

- Next.js 14 / React 18 / TypeScript
- Tailwind CSS + shadcn/ui
- Prisma ORM (当前 paused)
- Supabase (Auth)

## 注意事项

- 不使用自动生成的 CHANGELOG.md（已禁用）
- 不直接编辑 `FREEZE-SPEC.md`（冻结规格）
- 需求变更优先更新 `REQ_REGISTRY.yml`

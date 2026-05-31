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

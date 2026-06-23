# Harness 治理指南

## 当前治理真相范围

本目录归集项目中的 AI 运行配置、技能配置、历史治理文档、hook、validator 与 guard 代码。

## 长期维护范围

> 约定：本项目长期维护的 Markdown 真相文档仅有 1 份治理文档，即当前文件。

本目录中其他内容虽然不是“长期维护文档”，但仍属于需要持续维护的运行资产，包括：
- `.claude` 兼容入口对应的运行配置
- skills / agents 配置
- hooks / validators / guards / scripts
- 与治理运行直接相关的环境变量、路径和入口约定

## 非文档但必须维护的资产

以下内容不属于“维护文档数量”的统计范围，但必须持续保持可用：

1. Git 相关基础设施
   - `.git/`
   - `.github/`
   - Pull Request 模板、工作流、提交约束

2. 运行配置与环境变量
   - `.claude/settings.json`
   - skills / agents 配置
   - 根目录 `.env.example`（工作区参考模板）
   - `cyanlog-sales-v3/.env.example`（业务应用 SoT 模板）
   - `runtime-config-AI运行配置/config-配置文件/env-registry-环境变量注册表.json`
   - `runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json`
   - 需要人工维护的环境变量约定与部署侧真实 secret

3. 运行脚本与校验器
   - `scripts/`
   - hooks / validators / guards
   - 文档目录生成与校验脚本

原则：
- 这些资产要维护，但不当作“持续撰写型文档”维护。
- 它们的变化应以运行正确、入口不失效、兼容路径可追溯为准。

## 环境变量治理入口

环境变量相关内容以“模板 + 注册表 + 说明文档”三件套管理：

1. 模板文件
   - `cyanlog-sales-v3/.env.example`
   - 用途：业务应用当前生效的环境变量 SoT 模板

2. 工作区参考模板
   - 根目录 `.env.example`
   - 用途：让根目录文档 / 脚本 / 基础设施说明与当前默认本地端口保持同步

3. 注册表
   - `runtime-config-AI运行配置/config-配置文件/env-registry-环境变量注册表.json`
   - 用途：机器可读地描述必填性、敏感级别、归属层、存储位置

4. 说明文档
   - `truth-docs-治理真相文档/CONFIGURATION.md`
   - 用途：说明治理原则、使用方式、预提交检查和部署注意事项

5. 项目治理注册表
   - `runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json`
   - 用途：统一声明被管理文档、兼容入口、hook 命令与默认目标文档

约束：
- 真实 secret 不进入 git。
- 新增业务运行变量时，必须同时更新 `cyanlog-sales-v3/.env.example` 和注册表；若根目录 `.env.example` 也对外说明该项，则同步更新根目录参考模板。
- 若变量只存在于个人 shell、Vercel 或供应商控制台，也必须在注册表中声明其来源。

## 数据结构治理入口

后端数据层目前还没有在活动业务仓内形成真正生效的 schema/migration 资产，因此需要单独维护一份治理入口：

1. `truth-docs-治理真相文档/DB_SCHEMA_GOVERNANCE.md`
2. 未来实际落在 `cyanlog-sales-v3` 内的 schema 与 migration 目录
3. `truth-docs-治理真相文档/CONTROL_CHAIN_GOVERNANCE.md`

约束：
- 主文档里的 Prisma/SQL 示例在对应可执行文件落地前，只能视为设计材料，不视为运行真相。
- 任何正式表结构变更都必须同时满足“治理规范更新 + 可执行迁移提交”两个条件。
- 如果后端最终不用 Prisma，也必须在该治理文档中显式改写真相入口，不允许工具口径悬空。

## 改名与迁移同步

如果主文档、治理文档、TOC 脚本、`.claude` 设置入口发生改名或换位置，不再逐处手工修路径，而是按以下顺序处理：

1. 修改 `project-governance-项目治理注册表.json`
2. 如文档本身被纳管，同时更新 `guide-文档维护指南.md` 里的 `yaml` 清单
3. 执行：

```bash
python3 ./scripts/sync_governance.py
```

该命令会同步根目录兼容入口，包括：
- `PRD_MAINTENANCE_GUIDE.md`
- `scripts/generate_toc.sh`
- `scripts/generate_toc.py`
- `.claude/settings.json`

## 治理边界

1. 本目录负责 AI 开发行为治理，不负责承载产品真相。
2. `.claude` 中的运行配置与技能配置应以本目录中的归集版本为准。
3. 历史治理真相文档保留为参考来源，不直接视为产品真相。

## 当前归集内容

### 1. 运行配置
- `settings-claude运行配置.json`
- `agents-Agent配置/`
- `legacy-skills/` (已弃用，skills 现内联于 settings.json)

备注（SoT 约定）：
1. **Skills 配置现已内联于 `settings-claude运行配置.json`** 的 `skills` 字段，不再使用 `legacy-skills/` 目录。
2. `legacy-skills/` 目录保留仅作历史参考，实际运行以 settings.json 内联配置为准。
3. 如需新增 skill，直接修改 `settings-claude运行配置.json`，无需创建单独文件。

## Claude 插件（Marketplace Plugins）治理

本项目的 Claude Code 插件能力来自 Claude Marketplace（项目级 scope）。

关键约束：
1. 插件“安装状态”默认落在用户机器的 `~/.claude/plugins/installed_plugins.json`，**不在仓库内**。
2. 为了让治理可迁移，本仓库必须同时维护一份“期望启用插件清单”（写入治理文件），并提供可复现的安装方式。
3. **高侵入插件默认禁用**：凡是会注册 `SessionStart` / 大量 Hook、或注入整套方法论流程的插件（例如 superpowers / hookify / security-guidance），默认不启用，除非明确评估并通过。

当前项目级已启用插件（由 `settings-claude运行配置.json` 的 `enabledPlugins` 约束）包括：
- `frontend-design@claude-plugins-official`
- `context7@claude-plugins-official`
- `code-review@claude-plugins-official`
- `code-simplifier@claude-plugins-official`
- `feature-dev@claude-plugins-official`
- `pr-review-toolkit@claude-plugins-official`
- `claude-md-management@claude-plugins-official`
- `session-report@claude-plugins-official`
- `claude-code-setup@claude-plugins-official`
- `typescript-lsp@claude-plugins-official`
- `pyright-lsp@claude-plugins-official`
- `playwright@claude-plugins-official`
- `serena@claude-plugins-official`
- `github@claude-plugins-official`（需要 `GITHUB_PERSONAL_ACCESS_TOKEN`）
- `commit-commands@claude-plugins-official`（需要本机 `gh` 已登录）
- `playground@claude-plugins-official`

### 2. 运行代码
- `hooks-钩子/`
- `scripts-脚本/`
- `validators-校验器/`
- `guards-守卫/`

### 3. 治理真相文档
- `truth-docs-治理真相文档/`
- `truth-docs-治理真相文档/DB_SCHEMA_GOVERNANCE.md`
- `truth-docs-治理真相文档/CONTROL_CHAIN_GOVERNANCE.md`

## 维护规则

1. 新的 AI 运行配置进入根目录前，应先在本目录归档。
2. 历史 hooks/validators/guards 的迁移应以“可追溯”为前提，不得覆盖产品真相层。
3. 若根目录兼容入口仍存在，则归集文件变更后必须保证兼容路径不失效。

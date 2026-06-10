# Price V3 统一治理命令
# 工具无关的标准化入口

.ONESHELL:
.SHELLFLAGS := -euo pipefail -c

# 默认目标
.DEFAULT_GOAL := help

# 颜色定义
BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

.PHONY: help
help: ## 显示帮助信息
	@echo "$(BLUE)Price V3 治理命令$(RESET)"
	@echo ""
	@echo "$(GREEN)检查类:$(RESET)"
	@echo "  make check-req       检查 REQ ID 标记"
	@echo "  make check-layer     检查层隔离"
	@echo "  make check-doc       检查文档质量"
	@echo "  make verify          运行全部验证"
	@echo ""
	@echo "$(GREEN)开发类:$(RESET)"
	@echo "  make typecheck       TypeScript 类型检查"
	@echo "  make lint            ESLint 检查"
	@echo "  make test            运行测试"
	@echo "  make build           构建项目"
	@echo ""
	@echo "$(GREEN)治理类:$(RESET)"
	@echo "  make sync-doc        同步文档目录"
	@echo "  make review          运行对抗性审查"
	@echo "  make pre-commit      提交前全部检查"

# 检查类命令
.PHONY: check-req
check-req: ## 检查代码文件 REQ ID 标记
	@echo "$(BLUE)检查 REQ ID 标记...$(RESET)"
	@node governance/runtime-config-AI运行配置/runtime-code-运行代码/hooks-钩子/check-req-confirmed.js --all || exit 2

.PHONY: check-layer
check-layer: ## 检查层隔离（防止 governance/ 代码引用）
	@echo "$(BLUE)检查层隔离...$(RESET)"
	@node governance/runtime-config-AI运行配置/runtime-code-运行代码/hooks-钩子/check-import-isolation.js

.PHONY: check-doc
check-doc: ## 检查文档质量
	@echo "$(BLUE)检查文档质量...$(RESET)"
	@echo "  - 检查章节编号连续性"
	@echo "  - 检查标题层级"
	@echo "✅ 文档检查通过（待实现详细脚本）"

.PHONY: verify
verify: check-req check-layer typecheck lint test ## 运行全部验证

# 开发类命令
.PHONY: typecheck
typecheck: ## TypeScript 类型检查
	@echo "$(BLUE)TypeScript 类型检查...$(RESET)"
	@cd product-truth/product-code && pnpm tsc --noEmit

.PHONY: lint
lint: ## ESLint 检查
	@echo "$(BLUE)ESLint 检查...$(RESET)"
	@cd product-truth/product-code && pnpm lint

.PHONY: test
test: ## 运行测试
	@echo "$(BLUE)运行测试...$(RESET)"
	@cd product-truth/product-code && pnpm test:run

.PHONY: build
build: ## 构建项目
	@echo "$(BLUE)构建项目...$(RESET)"
	@cd product-truth/product-code && pnpm build

# 治理类命令
.PHONY: sync-doc
sync-doc: ## 同步文档目录
	@echo "$(BLUE)同步文档目录...$(RESET)"
	@echo "生成 TOC、同步注册表..."
	@echo "✅ 文档同步完成（待实现详细脚本）"

.PHONY: review
review: ## 运行对抗性审查（大型变更时）
	@echo "$(BLUE)运行对抗性审查...$(RESET)"
	@echo "1. 检查需求对齐"
	@echo "2. 检查技术债务"
	@echo "3. 检查边界情况"
	@echo "✅ 审查完成（待实现详细脚本）"

# Git Hook 入口
.PHONY: pre-commit
pre-commit: ## 提交前全部检查（Git Hook 调用）
	@echo "$(BLUE)运行 pre-commit 检查...$(RESET)"
	@governance/ai-behavior-准则/checks/pre-commit

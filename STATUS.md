# 项目状态看板

> 本文件由 `scripts/update-status.ts` 自动生成，请勿手动编辑。
> 最后更新: 2026-06-11 11:30 UTC

---

## 总览

| 指标 | 数值 | 状态 |
|------|------|------|
| 健康度 | **35/100** | 🔴 不及格 |
| 当前重心 | F001-价盘与阶梯价 | 🟡 进行中 |
| 阻塞需求 | F005, F006, F013-V3 | 🔴 3个 |
| 总需求 | 28 | - |
| 已完成 | 7 | 25% |

---

## 当前迭代（本周）

### 主目标: F001 价盘与阶梯价

| 属性 | 值 |
|------|-----|
| 状态 | 🟡 in_progress |
| 优先级 | P0 |
| 负责模块 | 配置中心 |
| Feature Packet | [F001-price-list.md](./product-truth/feature-packets/F001-price-list.md) |

**代码位置:**
- `app/configs/page.tsx`
- `app/api/products/route.ts`
- `app/api/product-price-tiers/route.ts`
- `supabase/migrations/20260608000001_org_pricing_and_quote_items.sql`

**阻塞项:**
- 无

---

## 需求状态分布

```
draft        ███████░░░░░░░░░░░░░  7  (25%)
confirmed    ██████████░░░░░░░░░░ 10  (36%)
in_progress  ████░░░░░░░░░░░░░░░░  4  (14%)
completed    ███████░░░░░░░░░░░░░  7  (25%)
design_confirmed (⚠️) ████░░░░░░░░░░░░░░░░  4  (14%)
```

---

## 阻塞清单（Blockers）

### 🔴 Critical

| ID | 描述 | 影响 | 预计解决 |
|----|------|------|----------|
| CI-BROKEN | `.github/workflows/ci.yml.bak` 未恢复 | 无法自动构建验证 | 本周 |
| PRISMA-DRIFT | ADR-008 禁止 ORM，但依赖仍在 | 工具链认知分裂 | 本周 |
| RUNROOT-NOT-UNIQUE | 仓库根遗留代码干扰 | IDE/搜索混乱 | 本周 |

### 🟡 Warning

| ID | 描述 | 影响 |
|----|------|------|
| CONFIG-DRIFT | 配置中心用大页签而非三层架构 | 违反 F000 设计 |
| REQ-STATUS-DRIFT | 出现未登记状态值 | 状态机混乱 |

---

## 按模块进度

| 模块 | P0需求 | 完成 | 进行中 | 阻塞 |
|------|--------|------|--------|------|
| 配置中心 | F001, F006, F009-F012 | 0/6 | 1/6 | 5/6 |
| 报价中心 | F002, F004 | 2/2 | 0/2 | 0/2 |
| 合同审核 | F005, F007, F008 | 2/3 | 0/3 | 1/3 |
| Account | F003 | 1/1 | 0/1 | 0/1 |
| 标书中心 | F013-V3, F014 | 0/2 | 0/2 | 1/2 |

---

## 最近变更

| 时间 | 类型 | 描述 |
|------|------|------|
| 2026-06-11 | 文档 | 创建 manifest.yaml 和 STATUS.md |
| 2026-06-10 | 设计 | F013-V3 标书中心设计确认 |
| 2026-06-09 | 架构 | F000 配置中心共享架构冻结 |
| 2026-06-08 | 清理 | scripts/ 11→6，删除 deploy.sh |
| 2026-06-07 | 清理 | seed 脚本合并，健康度评估 35/100 |

---

## 自动化状态

| 检查项 | 状态 |
|--------|------|
| Pre-commit Hook | 🟡 运行中（治理规则需更新） |
| CI/CD | 🔴 损坏（.bak 文件） |
| 类型检查 | 🟢 通过（0 errors） |
| 单元测试 | 🟢 通过（291/291） |
| Lint | 🟢 通过（3 warnings） |

---

## 如何更新此文件

```bash
# 自动更新（推荐）
pnpm status:update

# 或手动运行脚本
cd product-truth/product-code
npx tsx scripts/update-status.ts
```

更新逻辑：
1. 读取 `manifest.yaml` 获取当前重心
2. 读取 `REQ_REGISTRY.yml` 统计需求状态
3. 检查 `package.json` scripts 获取测试状态
4. 检查 `.github/workflows/` 获取 CI 状态
5. 生成此文件

---

*本文件是项目自解释系统的一部分。详见 [manifest.yaml](./manifest.yaml)*

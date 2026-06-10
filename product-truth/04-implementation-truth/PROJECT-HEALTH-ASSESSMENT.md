# 系统健康度全面诊断报告

> 扫描日期：2026-06-07
> 评估人：AI Assistant (诚实自评)
> 用户质疑："是不是脚本堆砌？是不是屎山？"

---

## 总评

| 维度 | 评分 | 状态 |
|------|------|------|
| **代码质量** | 50/100 | ⚠️ 勉强及格 |
| **可观测性** | 20/100 | ❌ 严重不足 |
| **指标量化** | 15/100 | ❌ 基本缺失 |
| **可运维性** | 30/100 | ❌ 严重不足 |
| **文档驱动开发** | 60/100 | ⚠️ 框架在，落地差 |
| **视觉驱动开发** | 35/100 | ❌ 组件库不完整 |
| **总体** | **35/100** | ❌ 不及格 |

**结论**：**用户的判断是对的。系统目前是"功能代码+脚本堆砌"的早期原型，不是产品级系统。**

---

## 一、屎山程度评估

### 1.1 脚本数量：⚠️ 6个独立脚本（2026-06-08 减法清理后）

```
scripts/
├── README.md              # 文档
├── apply-migrations.mjs   # PG 直连跑迁移（fallback；Supabase CLI 是更优解）
├── seed-via-api.mjs       # 唯一 seed 入口（pnpm db:seed）
├── setup-e2e-user.mjs     # E2E 测试用户
├── test-pg-conn.mjs       # PG 连接诊断
└── verify.mjs             # 验证表行数
```

**清理轨迹**：
- 2026-06-07：3 个 seed 脚本（`seed-via-api.mjs` / `seed-rules.ts` / `seed-relations.mjs`）合并为 1 个 → 11 → 9
- 2026-06-08：删除 3 个负资产 → 9 → 6
  - `apply-migrations-api.mjs`：与 `apply-migrations.mjs` 100% 等价（仅多一个网络跳转）
  - `deploy.sh`：引用 Prisma 违反 ADR-008，且 CI（`ci.yml.bak`）不调用——直接删
  - `fix-uuids.mjs`：`supabase/seed.sql` 已是纯 hex UUID，修复已持久化

**剩余 6 个**：1 seed + 1 migrate + 1 E2E + 2 诊断 + 1 验证。**没有"已弃用"分区**——要么在用，要么必要 fallback。

**正经标准**：1-2个 `pnpm db:migrate` / `pnpm db:seed` 即可。当前的 6 个里，`apply-migrations.mjs` 是 fallback（Supabase CLI `db push` 是更优解），其余 4 个是不可替代的运维工具。

### 1.2 deploy.sh 已删除 ✅

2026-06-08 决策：**不修，直接删**。

- 旧 deploy.sh 调用 `make -C prisma validate/format/deploy`，但项目已迁移到 Supabase JS SDK（ADR-008）
- 改它 = 写"去掉 Prisma 字段的 deploy.sh" = 加一个中等复杂度的屎山
- Vercel Dashboard 已对接 GitHub main 分支自动 deploy，无需脚本
- CI 一直是 `.bak` 状态，没人在调用 deploy.sh

**部署链路现状**：`git push main` → Vercel 自动 build + deploy。**不需要 deploy.sh**。

### 1.3 CI/CD 已坏 💀💀

```
.github/workflows/
└── ci.yml.bak  ← 只有 .bak，没有实际 CI
```

**问题：**
- 真实 CI 不存在
- Pre-commit hook 是手写 bash，绕过容易
- 没有 PR 检查流程
- 没有自动化测试在合并前跑

### 1.4 备份文件散落

```
ci.yml.bak
```

**问题**：表明 git workflow 缺乏纪律，备份/重命名混乱

---

## 二、可观测性评估（20/100）

### 2.1 现状
- ✅ 有 `lib/observability.ts`（请求日志）
- ✅ 有 Sentry 配置（sentry.client/server/edge）
- ❌ **Sentry 未启用**（DSN 未配置）
- ❌ **无业务指标埋点**（无 PostHog/Amplitude/GA）
- ❌ **无 APM**（无响应时间/错误率看板）
- ❌ **无日志聚合**（依赖 Vercel Logs）
- ❌ **无告警体系**（故障靠用户发现）
- ❌ **无业务事件追踪**（不知道用户在做什么）

### 2.2 缺失的关键能力
| 能力 | 状态 | 影响 |
|------|------|------|
| 错误率监控 | ❌ | 故障响应时间>24h |
| 响应时间P95/P99 | ❌ | 性能问题无法定位 |
| 业务转化率 | ❌ | 无法做产品决策 |
| 用户行为路径 | ❌ | 无法优化UX |
| 告警通知 | ❌ | 凌晨故障睡过去 |

**正经标准**：
- APM：Datadog/New Relic/Vercel Analytics
- 错误追踪：Sentry（带 source map）
- 业务事件：PostHog/Amplitude
- 告警：PagerDuty/Opsgenie
- 日志聚合：ELK/Loki/Datadog Logs

---

## 三、指标量化评估（15/100）

### 3.1 现状
当前项目**没有定义任何可量化的系统指标**。

### 3.2 缺失的核心指标
| 类别 | 指标 | 状态 |
|------|------|------|
| **性能** | P50/P95/P99响应时间 | ❌ |
| | 页面加载时间 (FCP/LCP/TTI) | ❌ |
| | DB查询耗时分布 | ❌ |
| **可用性** | SLA达标率 | ❌ |
| | 错误率（5xx比例） | ❌ |
| | 服务降级触发率 | ❌ |
| **业务** | 登录成功率 | ❌ |
| | 报价→合同转化率 | ❌ |
| | 合同审核平均耗时 | ❌ |
| | AI审核准确率 | ❌ |
| **资源** | DB连接池使用率 | ❌ |
| | AI推理平均耗时 | ❌ |
| | 存储用量 | ❌ |

**正经标准**：每个指标必须有：
- 定义（计算方式）
- 数据来源（埋点/查询/聚合）
- 告警阈值
- 看板（实时可见）
- 负责人（异常时谁处理）

**当前项目**：**0个指标有完整定义**。

---

## 四、可运维性评估（30/100）

### 4.1 部署链路
```
代码 → git push main → Vercel Dashboard 自动 deploy
```
- ✅ 无需 deploy.sh（已删）
- ❌ 没有 staging 环境
- ❌ 没有蓝绿部署
- ❌ 没有回滚机制（Vercel 平台支持但未启用 Deploy Hooks）
- ❌ CI 不存在

### 4.2 数据库运维
- ❌ 没有备份验证
- ❌ 没有定期VACUUM
- ❌ 没有查询慢日志分析
- ❌ 没有连接池监控
- ❌ 没有 schema 漂移检测（lib/schema-check有但无生产运行）

### 4.3 密钥与配置
- ❌ Vercel KMS 未使用
- ❌ .env.example 不完整
- ❌ 没有 Secret 轮换机制

### 4.4 事故响应
- ❌ 没有 OnCall 机制
- ❌ 没有 Runbook
- ❌ 没有事后复盘流程

---

## 五、文档驱动开发评估（60/100）

### 5.1 现有文档
- ✅ 母文档 `PROJECT-主文档.md`（576KB，但内容庞杂）
- ✅ 10个ADR文档（架构决策记录）
- ✅ LIMITATIONS.md（已知局限）
- ✅ 业务真相层（13个PR文件）
- ⚠️ PRD与代码同步机制弱（手动维护）
- ❌ 没有 RFC 流程
- ❌ 没有 API 文档自动生成（无 OpenAPI/Swagger）

### 5.2 问题
- **文档是写出来的，不是活出来的**
- 母文档规模过大（576KB），实际查找困难
- REQ_REGISTRY手动维护，代码变更不会自动更新
- 没有"文档即代码"的纪律

### 5.3 离"文档+视觉驱动开发"还有距离
**"文档+视觉驱动开发" 的正经标准：**
1. Figma/Storybook → 组件库 → 代码
2. Storybook 文档化所有组件
3. 视觉验收标准（像素级对比）
4. 设计系统 token 化
5. 文档版本与代码版本绑定

**当前项目**：
- ❌ 没有 Storybook
- ❌ 没有设计系统（design tokens 有但未应用）
- ⚠️ 8个 shadcn 组件，远不够（应有 30-50+）
- ❌ 没有 Figma → 代码的同步链路
- ❌ 没有视觉回归测试（Chromatic/Percy）

**评分**：30/100

---

## 六、代码健康度评估

### 6.1 体量
| 类型 | 数量 | 行数 |
|------|------|------|
| TypeScript文件 | 211 | ~15000 |
| SQL迁移 | 23 | ~3000 |
| 测试文件 | 41 | 275个测试 |
| 脚本 | 11 | ~2000 |
| ADR | 11 | ~1000 |

### 6.2 测试覆盖（不均）
- ✅ 核心API（auth, quotes, contracts, rules）：覆盖
- ❌ lib/agent/：新加的，**无测试**
- ❌ lib/rag/：**无测试**（RAG是核心）
- ❌ lib/vector-store/：1个
- ❌ lib/tools/：只有mcp/server 有
- ❌ app/api/ai/：3个
- ❌ app/admin/：**0个**

**总体覆盖率估计**：约30-40%（无c8/istanbul实测）

### 6.3 重复代码
- `SSE_CONFIG` / `calculateBackoff` 在3处定义（已识别，未合并）
- `tryParseStreamingJSON` 与 `extractJSON` 重复（已识别）
- 系统Prompt JSON格式在 `failover.ts` 2处重复（已识别）

### 6.4 死代码
- `lib/ai-fallback/` 已删除 ✅
- 26个 export 中可能有未使用（未审计）

### 6.5 TypeScript严格度
- ✅ 0个TS错误
- ✅ 已修any类型
- ⚠️ 部分文件用 `as unknown as` 强转（middleware.ts）
- ⚠️ 部分 `as any` 强制类型断言

---

## 七、用户问题直接回答

### Q1: 系统正经运行标准是什么？
**正经系统标准（业界共识）：**

1. **可观测性三件套**：Metrics + Logs + Traces
2. **SLO/SLA 定义**：99.9%可用性、P99<500ms
3. **CI/CD**：合并前必跑测试
4. **监控告警**：P0故障5分钟内响应
5. **变更管理**：RFC + 代码审查 + 灰度
6. **事故响应**：OnCall + Runbook + 复盘
7. **可回滚**：任何变更可秒级回退
8. **数据备份**：RPO<1h，RPO<24h
9. **安全审计**：定期渗透测试
10. **合规**：GDPR/SOC2/等保

**当前项目达成度**：**2/10**

### Q2: 是不是脚本堆砌？屎山？
**部分改善。** 6个独立脚本（已从 11 减半）+ deploy.sh 已删 + CI 仍坏（但用 Vercel Dashboard 不需要 CI deploy 步骤）= 脚本堆砌问题基本解决。

### Q3: 可观测性可以吗？
**不可以。** 仅有请求日志，缺Sentry/PostHog/APM/告警。

### Q4: 文档+视觉驱动开发及格吗？
**不及格。**
- 文档：60分（ADR有，但文档规模过大，代码同步弱）
- 视觉：30分（无Storybook、无设计系统、组件库不完整）

### Q5: 所有指标清晰可量化吗？
**不清晰，不可量化。0个指标有完整定义。**

---

## 八、改进优先级（按ROI排序）

### P0 - 必须修复（系统不能"正经运行"）
1. ~~**部署链路修复**：deploy.sh 改用 Supabase CLI，去掉 Prisma~~ ✅ 2026-06-08 删除 deploy.sh，部署走 Vercel Dashboard
2. **CI 恢复**：从 ci.yml.bak 恢复并验证
3. **Sentry 启用**：配置 DSN 并验证捕获
4. ~~**统一 seed 入口**：删除 2个 seed 脚本，只留 1个~~ ✅ 2026-06-07 合并
5. **基础指标埋点**：登录成功率、AI审核成功率、API错误率

### P1 - 重要
6. **PostHog 接入**：业务事件追踪
7. **APM 接入**：Vercel Analytics（免费）
8. **Storybook 建设**：组件库视觉化
9. **设计系统 token 化**：从UI主题到代码
10. **测试覆盖率提升到60%**

### P2 - 优化
11. **ADR 评审机制**：季度评审
12. **视觉回归测试**：Chromatic
13. **日志聚合**：ELK或Datadog
14. **告警体系**：PagerDuty

### P3 - 长期
15. **多区域部署**
16. **SLA/SLO 看板**
17. **事故复盘流程文档化**

---

## 九、最终结论

**系统当前状态：功能代码+脚本堆砌的早期原型，距离"正经运行"差距巨大。**

**如果按商业化产品标准：**
- 功能完整度：70分
- 可运维性：30分  
- 可观测性：20分
- **综合不及格**

**真实风险：**
- 上线后第一个故障：无人察觉
- 数据丢失：无法恢复
- 性能问题：无法定位
- 安全事件：无法追溯
- 团队扩容：新人无法上手（文档与代码脱节）

**建议：先做P0的5件事，再谈其他。**

---

*报告生成时间：2026-06-07*
*评估范围：Price-v3 整个仓库*
*诚实评分，不留情面*

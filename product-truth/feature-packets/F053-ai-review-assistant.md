# F053 AI 审核助手

- 状态: in_progress
- 优先级: P1
- 来源: 用户要求（Salesforce AI 报价插件参照）+ 调研（AI 审核助手/对话建单/折扣建议）

## 机制
- 业务用点 `quote.review.assistant`（V3 AI runtime，executeAIUsePoint）
- 输入：F047 自动核验结果（checks/blocked/warnings）+ 报价头
- 输出：JSON { summary, risks[], suggestions[] }——只总结核验结果已出现事实，**不得编造**
- 失败回退：未配置 use point / 调用失败 / 输出不合法 → 返回 null + 原因提示，界面显示"AI 审核助手暂不可用"
- 审核视图：ReviewPanel 新增"AI 审核意见"折叠区

## 待配置（配置中心六对象 AI_CONFIG 清单）
V3 AI runtime 采用六对象资产模型（business_use_point → application_binding → ai_application → route_policy → model_catalog_entry → provider_connection）。当前生产**尚未发布六对象资产**（contract 用点同样未启用），激活 quote.review.assistant 需在配置中心发布以下 AI_CONFIG（schema_version=ai-platform.v1）：

| 资产 | asset_id（示例） | 关键字段 |
|---|---|---|
| provider_connection | PC_CLOUD_1 | provider_type=openai_compatible, runtime_location=cloud, auth_mode=bearer, base_url=https://cloud.yiyongai.cn/v1, api_key=沿用现有云端凭据（勿入库） |
| model_catalog_entry | MCE_GPT55 | provider_connection_id=PC_CLOUD_1, model_id=gpt-5.5, capabilities=[text_generation, structured_output] |
| ai_application | APP_QUOTE_REVIEW | capabilities=[text_generation, structured_output] |
| business_use_point | quote.review.assistant | module_id=quote, required_capabilities=[text_generation, structured_output] |
| application_binding | BIND_QUOTE_REVIEW | business_use_point_id=quote.review.assistant, ai_application_id=APP_QUOTE_REVIEW |
| route_policy | ROUTE_QUOTE_REVIEW | ai_application_id=APP_QUOTE_REVIEW, model_catalog_entry_ids=[MCE_GPT55], strategy=ordered_fallback, timeout_ms=120000, failure_action=manual_review |

发布后 `GET /api/quotes/:id/review?ai=1` 自动返回 AI 审核意见；未发布时保持现有失败回退（不伪造）。

## 激活状态（2026-08-18 实测）
- ✅ 六对象 AI_CONFIG 已发布（quote.review.assistant 全链路：provider_connection/model_catalog_entry/ai_application/business_use_point/application_binding/route_policy）
- ✅ 平台表补齐：ai_runtime_plan_snapshots + model_invocations execution 系列（WP02 迁移族）
- ✅ 链路真实执行到模型调用（plan 编译→快照→候选尝试→执行证据落库）
- ❌ 云端推理被拒：cloud.yiyongai.cn 账户额度 $0（insufficient_user_quota）——**付费决策，需业务侧充值或换通道**；充值后无需改代码自动生效
- 失败回退保持：未激活时如实提示，不伪造

## 后续 AI 能力
- 对话建单（自然语言 → 结构化报价行）
- 智能折扣建议（需历史成交数据）

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

## 待配置
- 在配置中心发布 AI_CONFIG（use point=quote.review.assistant，模型/路由按现有 AI 平台流程）
- 后续 AI 能力：对话建单、智能折扣建议（需历史成交数据）

# F051 每角色折扣上限

- 状态: in_progress
- 优先级: P0
- 来源: 用户要求（折扣治理）+ CPQ 市面形态（角色折扣上限/审批升级）

## 机制
- 配置域 `discount-policy`（discount_policies：role_code × max_discount × hard_cap）
  - **无种子**：角色数值由配置中心按业务口径维护，不伪造
- 审核核验 DISCOUNT_POLICY 按当前用户角色读上限：
  - 折扣超过角色 max_discount → WARN（需审批）
  - 折扣超过角色 hard_cap → BLOCK（硬阻断）
  - 未配置角色策略 → 回退全局 DISCOUNT_MAX（F050）
- 配置中心可维护；RLS 已开

# 纷享审批寄件 APL 租户模板

`fxiaoke-approval-intake.groovy` 是 F054/WP97 的租户侧薄调用函数，`fxiaoke-approval-intake.example.json` 是对应的可审查配置模板。两者都不包含既有工单迁移或组织目录同步逻辑。

## 上线前必须取得的生产事实

1. 用只读对象目录找到审批根对象、申请人员工对象和寄件明细对象。
2. 用对象描述确认客户引用、修订、收件人、手机、省市区、详细地址、物品、重量、服务和付款字段的真实 API 名称、类型与主从关系。
3. 用一条真实审批实例确认所选流程对象、运行中实例、审批任务、任务状态和申请人；任务必须属于该实例。
4. `StageId` 是本系统用于区分审批节点的稳定租户配置值。它不冒充纷享字段；一旦下发给 ICU 并被工单引用，不得复用或改写。
5. 将同一客户端 ID 和随机密钥分别配置到 Vercel 的 `SHIPPING_CRM_CLIENTS_JSON` 与 APL 函数代码。密钥至少 32 个字符，只保存在服务端和审批函数中，不进入 Git、截图、聊天或浏览器控制台。

## 安装顺序

1. 填写并通过审查 `fxiaoke-approval-intake.example.json` 中的全部占位项。
2. 在审批流程里仅选择已确认的业务节点安装 APL。正常运行从 `context.data._id` 取得业务记录 ID，再通过官方接口回读流程实例、任务和寄件子行；`workflowInstanceId`、`shipmentDetailId`、`taskId` 和 `recordId` 只可作为受控调试约束，不是必经输入。
3. 不要读取 `context.details`。函数通过 `Fx.bpm.findInstances`、`Fx.bpm.findTaskList`、`Fx.bpm.findTask`、`Fx.object.findById` 和 `Fx.object.find` 重新读取正式来源；审批记录必须唯一关联一条寄件子行，任务必须唯一匹配已审核任务名称或 ID。
4. 先以预检模式运行。只有 ICU 返回 `ready=true`、`missing=[]` 且事件身份完全一致，才允许调用受理入口。
5. 受理成功必须返回同一 `eventKey`、`status=awaiting_confirmation`、`waybill=null` 和 `nextAction=operator_confirmation`。任何不确定结果都使用同一事件重放核对，不创建第二个业务事件。
6. 真实顺丰调用由 ICU 操作员在逐票核对收件人、地址、服务、付款方式和费用后触发。APL 不直接调用顺丰，也不修改审批历史。

## 调用与签名

- 纷享 BPM 接口返回 `{isError,data,message}` 包络；`findInstances` 的列表位于 `data.QueryResult.dateList`，`findTaskList` 的任务列表直接位于 `data`，`findTask` 的详情位于 `data`。
- 预检和受理使用同一份规范化 JSON 请求内容。规范头为 `x-shipping-crm-canonicalization: crm-json-v1`；签名原文依次为规范值、Unix 秒时间戳、大写方法、路径和规范化请求体。服务端从当时的实际请求体重新计算，路径不同则签名不可跨入口重放。
- endpoint 与审批函数之间只共享随机客户端密钥；密钥不得进入 Git、截图、聊天、浏览器控制台或运行日志。

## 失败边界

- 配置占位值未替换、企业不符、实例不唯一、任务不属于实例、申请人/根记录/明细关系不一致时，在 HTTP 调用前失败。
- `context.userId=-10000` 只表示函数执行身份，不能作为申请人；真实申请人取审批实例申请人并通过组织人员对象回读。
- 预检缺项时函数返回 `preflight_blocked` 和逐字段 `missing`，不调用受理入口。
- 创建回执不完整时不猜成功；用同一事件重放，由 ICU 幂等返回原工单。
- APL 不读取或写入登录态、组织目录、角色或企微配置。

## 当前验收边界

WP97 的完成线不是 `code_green`、部署 READY、预检 200、受理 202 或 Preview。必须在生产纷享指定审批节点完成一次真实、可追溯的 APL 调用，生产 ICU 只生成一张 `awaiting_confirmation` 工单且 `waybill=null`；同一事件再次触发仍返回同一工单，申请人与客户身份、流程实例、业务记录、寄件子行、任务、阶段和修订均可回读。官方接口的入参与返回形状已经由公开文档确认；当前租户的真实对象字段、任务名称与状态、审批节点可执行性及 `Fx.http` 实网透传仍须由上述生产业务证据证明。

## ICU 供 APL 调用的能力

本次仓库交付对象是 ICU 服务端能力、稳定的调用约定和调用示例。纷享中的 APL 可以按该约定调用；后台创建函数和绑定流程节点不作为 ICU 能力准备的前置条件。

| ICU 能力 | 调用 | 成功结果 | 写入影响 |
| --- | --- | --- | --- |
| 检查资料和可用寄件配置 | `POST /api/shipping/crm/preflight` | `ready`、逐字段 `missing`、`eventKey`、已核验来源 | 只读；不创建工单 |
| 幂等受理／精确重放 | `POST /api/shipping/crm/orders` | `created`、`orderId`、`orderNo`、`status`、`waybill`、`nextAction` | 首次创建待确认工单；同一事件和内容返回原单；内容改变返回 409 |

请求来源身份、业务字段与签名按上文约定传入。接口验收检查鉴权、有效输入、缺项、精确重放、内容冲突及实际持久化结果；生产可调用性须在正式接口核实。模板存在或本地测试通过均不能代替生产调用证据。

现有 Groovy 文件仅作为调用参考，配置位于文件开头的 `CONFIG`，对应字段说明见 JSON 示例。默认 `mode: preflight`，只预检；明确设为 `create` 后才会在预检通过时调用受理。返回 `preflight_ready`、`preflight_blocked`、`created` 或 `replayed`，纷享流程如何处理结果由节点配置负责。密钥只配置在服务端，不进入仓库。

当前完整示例适用于审批根记录唯一关联一条寄件明细；多明细、自由文本或其他上下文不应静默取首项。该示例尚未经过当前租户的纷享平台验证，不声明可直接发布。

接口验收复用 ICU 现有测试。完整 WP97 的真实流程业务验收按上文独立记录，不能由 ICU 初态发布代替。

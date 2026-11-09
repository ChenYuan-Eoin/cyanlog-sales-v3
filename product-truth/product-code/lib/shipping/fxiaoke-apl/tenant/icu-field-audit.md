# ICU 组织、字段与流程能力盘点

核对日期：2026-11-09。范围：WP97 接入前的第 1、2 项。
用户已确认接入位于“合同对象下”；具体表单暂不询问，不继续操作纷享。
生产 APL 创建、填写、保存、测试执行与节点绑定均暂缓。

## 结论

目录数据已经进入 ICU，但不能宣称“组织身份、销售归属、流程与回写全部打通”。
ICU 只读预检、独立销售字段和逻辑寄件防重复已随 PR #4 发布，正式提交为
`346e0829aa9fdc52986ed8f9d75c3016c2881a02`。生产迁移已应用，客户端已绑定 tenantId `645753`；
正式域名六项只读接口检查通过。未创建真实工单，也未运行纷享 APL。

继续核查发现：该版本仍接受目录中不存在的申请人/销售 ID。新增最小修复在预检与新受理前
核对当前组织的有效纷享目录、稳定员工 ID 和目录在职状态；此修复尚未发布。
它不查询或修改 ICU 登录账号、角色与账号绑定，也不改变原工单精确重放。

## 1. 组织、销售、流程与回写现状

| 项目 | 已取得的证据 | 判定与尚缺内容 |
| --- | --- | --- |
| 纷享组织来源 | Production `organization_sources` 为 active / verified，企业账号 ones001；最近成功同步 2026-11-05 08:34:19 UTC | 来源与目录有入库证据；不是今天重新同步 |
| 部门结构 | 73 个纷享部门：51 active、22 inactive；405 条人员主部门引用均可解析 | 已入库；其他来源/手工部门另计，不能混算纷享全公司范围 |
| 人员稳定映射 | 405 条 external identities 均 matched 且 canonical_user_id 非空 | 可追溯身份记录已经建立 |
| 完整公司范围 | 最新已应用目录快照 complete=true，但 scopeVerified=false、scopeEvidence=null | 分页完整不能证明全公司权限；126 位员工的禁止登录状态仍未知 |
| 可用销售账号 | 这 405 条映射指向的 users 均 inactive / login_enabled=false；成员关系均 invited | 不能据此宣称已关联到可登录的现有销售账号。82 条在职、323 条 suspended，不得批量激活 |
| 身份信任 | 来源 authority_scope.identity=evidence；SSO 解析器要求 authoritative 与有效账号/成员关系 | 身份授权未贯通；不把登录启用当作 APL 机器调用的前提，也不在本轮擅自启用身份权威或角色 |
| 销售归属 | 原受理函数将 applicant.employeeId 直接写入 sales_ref；纷享存在独立归属销售字段 | 已随 PR #4 发布并迁移。销售归属是业务身份快照，不自动授予 ICU 登录或查看权限 |
| 本人查询归属 | CRM 原入库 created_by=null，未关联 employee_profile_id；旧本人列表还有 anonymous_web 来源过滤 | CRM 工单进入销售“本人列表”的链路未贯通，不能由名字或手机号推断 |
| 流程识别 | ICU 可保存企业、对象、记录、寄件明细、实例、任务、节点标识与修订 | 当前合同真实实例/节点尚未验收。此前一次只读审批查询返回空对象，不能据此认定无流程 |
| 实际 CRM 工单 | Production shipping_crm_intake_events=0；shipping_orders 中 owner_web=52、anonymous_web=5、crm=0 | 尚无真实 CRM→ICU 工单证据 |
| 结果回写 | 当前 app/lib 未发现寄件结果回写纷享的实现；WP98 仍为后续阶段 | 未通。API 回执/重放返回单号不等于已写回合同字段 |

只读数据库证据位于当前 worktree 私有 `codex-runtime/wp97-field-audit/`。
不把原有人员状态改为可登录，不迁移/合并账号，不调整部门或权限。

## 2. 真实字段与 ICU 对照

以下元数据是在用户要求停止纷享操作之前取得。对象名称与 API 名称分别记录；
“合同对象下”并不足以擅自选定标准 ContractObj 或自定义合同申请为最终入口。

| 业务含义 | 已核实的纷享字段/约束 | ICU 接收或提供 | 状态 |
| --- | --- | --- | --- |
| 员工稳定 ID | PersonnelObj.user_id；实际样本 user_id=1093，而 _id 为不同的人员记录 ID | applicant.employeeId；本轮新增 sales.employeeId | 字段语义已明确；现有 Groovy 示例误用 _id，尚未修正/验证，禁止直接安装 |
| 人员姓名与电话 | full_name、phone；main_department 为数组 | applicant.name、phone、departmentId、departmentName | 旧示例 name/mobile/department_id/department_name 不符合已读元数据；需后续按真实平台来源适配 |
| 部门 | DepartmentObj.dept_id、name；PersonnelObj.main_department 关联部门 | 人员部门 ID 与名称 | 元数据可读；DepartmentObj 数据列表查询被拒绝，不能宣称该对象可直接查询；已有人员关联回读含部门 ID/名称 |
| 归属销售 | SalesOrderObj.field_C2DC2__c；部门 field_03oSX__c；owner/created_by 是不同角色 | 独立可选 sales 对象，含稳定 ID、姓名和可选部门 | 已补 ICU 字段。合同如何取得该销售暂未指定，不把销售订单字段直接套到合同 |
| 客户 | ContractObj.account_id；合同申请 object_l86q0__c 的 field_p3uo0__c 是客户名称，field_oAw2a__c 是签约主体 | customer.accountId、name | 语义已分清；不能把终端客户、签约主体、收件单位混为一项，具体来源待后续映射 |
| 原业务记录/版本 | _id、version、last_modified_time | event.objectApiName、recordId、revisionId | ICU 可保存；不使用未核实的 modified_time 示例字段 |
| 流程实例/任务/节点 | 官方有流程查询与任务查询；实际触发点待后续核对 | event.workflowInstanceId、taskId、stageId | stageId 当前是接入配置的稳定标识，不冒充纷享原生字段；流程上下文未实测 |
| 企业 | 连接器上下文可区分 ea 与 tenantId，不能互换 | event.enterpriseId 与服务端客户端绑定 | 要在接入时固定同一含义；正式客户端已绑定 tenantId=645753；EA=ones001 仅用于组织连接，不能互换 |
| 本票收件人、电话、地址 | AccountAddrObj 有 contact_id/contact_way/province/city/district/address；ContactObj 有 name/mobile1 等 | shipment.recipient.name/phone/province/city/county/address | district→county 需要显式转换；档案存在不等于本票选中地址，具体合同表单暂缓 |
| 地址选择 | SalesOrderObj.ship_to_add_control 仅控制可选范围；精确查询 ship_to_add 未命中 | 不据此生成收件地址 | 已排除错误映射，不用客户默认地址替代本票填写 |
| 寄件人 | ICU 已有一条默认寄件人，姓名、电话、结构化地址非空 | 预检 normalized.sender | 正式预检已验证资料完整；真实可寄达性不由只读预检证明 |
| 承运商与服务 | ICU 生产顺丰连接记录为 connected；授权服务标快 id=2、特快 id=1 | serviceId 或 servicePreference；预检返回服务 ID/名称/偏好 | 由 ICU 已授权服务解析，不在 APL 重写服务目录；未在本轮调用顺丰 |
| 物品、重量、付款、备注 | 合同具体业务字段暂未指定 | cargo、weight、payment、remark；可选 specialRequirements/pickupWindow/sourceText | ICU 已有字段；未声明合同上已具备这些字段 |
| ICU 回执 | 由 ICU 生成 | accepted、created、eventKey、orderId、orderNo、status、waybill、nextAction | 已有接口。首次受理只允许 awaiting_confirmation / waybill=null；生产未调用成功 |
| 原合同回写目标 | 具体目标字段与版本保护尚未核实 | 需要原对象/记录/明细及写回状态、错误与重试依据 | 目前无回写执行器；本轮只盘点，未写合同数据 |

### 本轮 ICU 补齐的调用约定

`applicant` 保留真实流程申请人。新的可选 `sales` 形状为：

```json
{
  "sales": {
    "employeeId": "纷享稳定员工ID",
    "name": "归属销售姓名",
    "departmentId": "可选稳定部门ID",
    "departmentName": "可选部门名称"
  }
}
```

缺少 sales 时返回 sales=null，工单保持 sales_ref=null / assignment_status=unassigned；
不再用申请人自动代填。明确提供 sales 时独立保存快照；这些字段不构成登录或权限授权。

同一事件和相同内容仍返回原工单。不同事件如果指向相同
`组织 + 企业 + 对象 + 原记录 + 寄件明细`，返回
`409 / CRM_SHIPMENT_ALREADY_INTAKEN` 及 `existingOrderId`；
重审或改版本不产生第二票。同一合同中的不同寄件明细仍可分别受理。
新一票寄件必须有新的业务明细身份，不能靠更换 taskId/revisionId 绕过去。

新增迁移 `20261109000002_shipping_crm_identity_and_dedup.sql` 保留旧迁移与历史工单，
只新增销售快照字段、逻辑寄件唯一索引并更新受理函数。
如历史数据已有重复逻辑明细，迁移会失败供核查，不自动合并或删除。
发布时先迁移、后更新应用；新的 sales 参数可缺省，旧调用仍兼容。
此迁移已应用到生产并回读核对，CRM 事件/工单仍为 0，全部历史工单仍为 57。

## 3. 官方业务流程文档带来的确定结论

用户提供的[业务流程触发](https://developer.fxiaoke.com/apl_v2/func-introduce/apl-func-scene/business-process/)
及[流程配置步骤](https://developer.fxiaoke.com/apl_v2/func-introduce/apl-func-scene/business-process/flow/2.step.html)
明确：函数在纷享的流程配置中被选择，触发时机包括节点条件、后动作、处理人解析等。
节点后动作异常可能影响后续节点生成，所以 HTTP 超时、缺项、冲突必须在节点使用方式中有明确处理。

这支持“ICU 提供能力；APL 在纷享复用；流程节点选择 APL”的方向。
它不证明所有流程类型共用同一种上下文/API。官方[流程代码示例](https://developer.fxiaoke.com/apl_v2/func-introduce/apl-func-scene/business-process/flow/3.groovy.html)
使用 Fx.approval，而现有仓库参考使用 Fx.bpm；真实流程类型与平台 API 需后续核实，不能混套。
官方示例含驳回动作，仅供理解接口，本轮未执行任何审批动作。

## TODO 与进入后台的条件

- [x] 工作面检查：沿用 WP97 clean worktree 起点 6ca3bb62；根目录 dirty 快照不动。
- [x] 读取真实组织来源、部门、稳定映射、账号/成员状态、CRM 事件与工单数量。
- [x] 将“目录入库 / 活动销售账号 / 流程来源 / 回写”分别给出结论。
- [x] 盘点已获 CRM 元数据与 ICU 请求、响应、默认寄件人、授权服务。
- [x] 在开发环境复现申请人混作销售、重审后重复创建两项缺陷（原实现两项失败）。
- [x] 补齐 sales 独立字段与逻辑明细去重；接口/数据库目标测试 33 项通过。
- [x] 受影响 5 个测试文件 / 49 项通过；typecheck、目标 lint、build 通过，日志已写入 worktree 运行证据。这些是开发检查，不是生产验收。
- [x] 正式 ICU 客户端/企业绑定、生产迁移和六项只读签名预检通过；发布提交 346e0829。
- [ ] 员工 ID 目录核验修复：开发回归验证后发布；不能用原先接受虚构员工 ID 的 ready=true 证明组织身份已通。
- [x] 组织范围、账号和本人查询的缺口已核实：全公司范围未证明，ICU 账号关联和本人列表未贯通。它们不作为机器 APL 调用的登录前置；本轮不改账号或角色。
- [ ] 用户允许继续纷享操作后，再核实合同表单、实际流程、节点上下文与本票字段。
- [ ] 排除现有 APL 参考中的人员 ID/姓名/电话/部门映射错误，并在纷享真实编译与只读预检。
- [ ] 前两项准备好后，由用户观看创建 APL；当前明确暂缓。
- [ ] 真实节点唯一待确认工单验收；仍须通过发布门禁，不能以本地检查代替。
- [ ] 顺丰真实出号与合同回写属于后续独立验收；不得用 ICU 回执冒充回写成功。

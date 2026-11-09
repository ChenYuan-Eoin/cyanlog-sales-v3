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

## 可复用初态：创建 APL 后如何写代码

初态提供“寄件预检”和“受理为待确认工单”两个能力；沿用 ICU 的两个现有接口。纷享流程管理节点与流转，APL 只读取该节点上下文、映射字段、调用 ICU 并校验回执。更换流程只维护配置，同一份核心代码不按流程复制开发。

| ICU 能力 | 调用 | 成功结果 | 写入影响 |
| --- | --- | --- | --- |
| 检查资料和可用寄件配置 | `POST /api/shipping/crm/preflight` | `ready`、逐字段 `missing`、`eventKey`、已核验来源 | 只读；不创建工单 |
| 幂等受理／精确重放 | `POST /api/shipping/crm/orders` | `created`、`orderId`、`orderNo`、`status`、`waybill`、`nextAction` | 首次创建待确认工单；相同事件与内容返回原单；变更内容返回 409 |

来源身份由企业、流程实例、对象、记录、明细、任务、阶段和修订组成。同一事件重试必须保留这些值和原请求内容。字段映射发生变化后不能伪造新事件来绕开冲突。生产是否已有客户端配置、寄件资料、可用服务和迁移仍须分别核验。

### 1. 配置零件

复制 `fxiaoke-approval-intake.example.json` 为本地配置。填写真实企业、对象 API Name、任务名称、稳定 stageId、字段映射和客户端 ID；保持 `clientSecret` 为占位符。未知字段应先通过 ICU 管理员只读元数据接口核验。

- `mode: preflight`：默认模式，预检通过返回 `preflight_ready`，绝不调用受理接口。
- `mode: create`：明确启用受理；仍先预检，缺项时不创建。
- `environment: development`：只接受明确的 HTTPS Vercel Preview origin；不能指向正式域名。开发客户端密钥与生产分离。Preview 若有部署保护，由受信验证工具处理，不能把保护页当作 ICU 返回。
- `environment: production`：只接受 `https://sales.cyanlog.icu`。
- 每个节点配置一个阶段；不同流程使用不同配置，生成的核心代码哈希相同。初态适用范围为审批根记录关联唯一寄件明细，收件资料为结构化字段。多明细、自由文本和其他类型的流程上下文需要另行适配，不能静默取第一项。

### 2. 生成可粘贴的 APL 代码

在 `product-truth/product-code` 下运行（使用项目现有依赖，Node 24+）：

```sh
node --experimental-transform-types lib/shipping/fxiaoke-apl/tenant/build-apl.mjs /绝对路径/节点配置.json /绝对路径/节点代码.groovy
```

生成器核对配置，输出独立 Groovy 文件及 `coreSha256`；拒绝覆盖已有文件，拒绝接收真实密钥。两套流程配置的 `coreSha256` 应一致。把生成代码放入纷享中创建的流程 APL 函数，在纷享服务端替换密钥占位符，再在相应流程节点选择该函数。日后修改映射时重新生成配置区，核心逻辑保持一致。

### 3. 节点结果与后续配置

| APL 返回／异常 | 含义 | 流程配置建议 |
| --- | --- | --- |
| `preflight_ready` | 资料与 ICU 配置预检通过，尚未建单 | 联调确认后将配置切为 create |
| `preflight_blocked` 与 `missing` | ICU 检查发现缺项，尚未建单 | 引导补齐；不能解释为成功受理 |
| `created` | 首次受理，返回待确认工单 | 按业务需要继续；仍需 ICU 操作员确认寄件 |
| `replayed` | 原事件已受理，返回同一工单 | 不重复产生下游业务操作 |
| 带 `APL_*` 编码的异常 | 配置、来源、签名、网络或回执校验失败 | 进入节点异常处理；结果未知时先保持原事件查回 |

返回值如何存入流程变量、失败如何暂停或分支，取决于所选函数命名空间和节点配置，必须在纷享验证。不要假设返回一个 Map 就会自动阻止流程继续。订单已离开待确认状态时，ICU 可以回读实际状态；当前 APL 初态会拒绝将其当作新建待确认成功，进入人工核对，不重复派单。

### 4. dev 验收清单

- 两套不同对象／字段／节点的配置生成同一核心代码。
- 默认预检模式不调用创建；缺项返回可定位字段。
- create 模式首次只生成一张待确认工单，精确重放返回同一单。
- 修改原事件内容、跨企业、错签名、过期签名、歧义引用和未配置占位符均拒绝。
- ICU API、APL 回执及持久化事实一致；没有承运商调用。
- 本地适配器测试、Groovy 执行测试、Preview HTTP 和真实纷享节点分别记录；任何模拟不代表纷享编译器或真实审批通过。

初态发布只交付 ICU 接口和可配置 APL 代码。WP97 的完整业务完成线仍按上文“当前验收边界”执行，未取得真实节点证据前保持未验收。

本地 HTTP + Groovy + SQL 验收脚本位于 `dev/accept.mjs`。它使用临时 PGlite 数据、真实 Next 路由与 CRM SQL；纷享 API 和 PostgREST 传输层为测试适配器。需要 JRE 17、Groovy 3.0.25 的 `groovy` 与 `groovy-json` jar，将 `APL_JAVA_BIN` 指向 Java，`APL_GROOVY_CLASSPATH` 指向两个 jar，将 `ICU_DEV_EVIDENCE_DIR` 指向 worktree 的 codex-runtime 子目录后执行：

```sh
node --experimental-transform-types lib/shipping/fxiaoke-apl/tenant/dev/accept.mjs
```

脚本自动启动并停止本地 Next，写入逐项执行日志与 `acceptance.json`；不连接生产数据库。该测试证明生成代码在普通 Groovy 的执行结果以及 ICU HTTP/SQL 行为，不能证明纷享的沙箱限制、真实字段和流程节点配置。

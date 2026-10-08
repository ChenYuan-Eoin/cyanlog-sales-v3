# F054 自助收寄接入与运行配置

`/shipping`只承载批量寄件、台账、确认下单、取消和轨迹。寄件配置位于`/configs?tab=shipping`，从组织数据库读取顺丰连接、多月结账号、授权服务、默认寄件人和寄件人员权限。机器凭据、月结卡号及寄件资料不作为日常运行环境变量。销售/匿名提报保持承运商无关，只提交收件业务字段和通用时效偏好。

## 服务端环境变量

F054基础运行必需5项：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SHIPPING_CREDENTIALS_ENCRYPTION_KEY`、`SHIPPING_RECEIPT_SECRET`。前两项是公开项目配置，后三项仅限服务端；服务端密钥写入私有环境文件或部署平台，不能写入tracked文件或公开前缀。此处列出代码依赖，不代表当前部署已满足，也不要求重新生成现有密钥。

- `SHIPPING_CREDENTIALS_ENCRYPTION_KEY`：64位十六进制、32随机字节，用作AES-256-GCM应用层凭据加密主密钥，并派生月结卡号指纹密钥。可用 `openssl rand -hex 32` 生成；不能记录到日志。轮换前需先重加密已存凭据和账号号。
- `SHIPPING_RECEIPT_SECRET`：至少32字符；用于回执令牌HMAC和匿名限流，认证操作员创建寄件单也依赖它。
- `SHIPPING_CONTEXT_SECRET`：使用签名业务上下文链接时必需，至少32字符；不携带上下文令牌的普通提报和内部下单不依赖它。
- `CRON_SECRET`：启用定时寄件审核提醒时必需，复用现有平台定时任务配置；不是顺丰接口凭据，也不会自动下单。
- `SHIPPING_ALLOWED_USER_IDS`：一次性旧名单迁入及旧凭据所属组织证明，不再授予运行时寄件权限。只有旧凭据配置和人员权限两类导入均完成，并完成新版本稳定验收后，才可从Vercel删除。
- `SHIPPING_ANONYMOUS_LIMIT`：可选匿名提报限流值，默认20。
- `SHIPPING_BUSINESS_CONTEXTS_JSON`：可选业务代码关系映射，不含承运商配置。

正常下单、查询、轨迹和取消路径只从组织数据库读取配置。配置管理员可在配置中心对当前环境触发一次性“迁入旧配置”：服务端读取旧`SF_*`/`SHIPPING_SENDER_JSON`值后，加密写入缺失的数据库项，不向浏览器返回原值，也不覆盖已保存的配置。两类导入和新版本稳定验收完成后再清理旧变量；正常运行不依赖它们。

`scripts/check-env.mjs`只将3个Supabase变量设为强制项，寄件密钥缺失仅输出警告且不校验格式。因此它退出成功不能证明F054基础变量齐全，更不能证明Production寄件已通过；还须分别核对密钥格式、数据库配置、供应商能力与真实操作。

### 组织范围与旧名单切换

普通寄件请求的组织由服务端`shipping:operate`角色/直接权限确定；台账、确认、退回、查回、取消、旧寄件请求和协同轨迹均使用这一次授权得到的组织。`SHIPPING_ALLOWED_USER_IDS`不再授予运行时权限，也不再补充提醒接收人；配置管理员须先迁入旧名单或在配置中心保存寄件人员权限。

旧凭据和旧人员名单只能迁入可证明的原组织：名单中全部用户存在，主组织及成员关系只能指向同一个组织。无法证明、跨组织或多组织时拒绝迁入，不能以当前管理员的组织冒领部署级秘密。完成名单迁入后重复点击只读取当前数据库权限，不恢复已经撤销的人员，删除旧变量后也保持幂等。

新匿名提报在服务器同时读取公司默认寄件人和组织后绑定`org_id`；存在多个公开组织候选时明确拒绝，客户端不能指定组织。历史空组织数据不会被自动分配给当前操作员，其持有者仍可用原回执查看最小状态。2026-09-27只读聚合核对：Preview有1票已绑定组织的协同测试单；旧shipping_requests另有8条缺组织的沙盒请求，原行保留并拒绝自动认领。Production协同台账和旧请求表均为空；本次不做数据补写或schema迁移。提醒只包含接收人自己组织的订单摘要。

## 顺丰标准接口鉴权

Node.js服务端使用顺丰OAuth2机器凭据，不需要网页登录或人工扫码。沙盒令牌地址为`https://sfapi-sbox.sf-express.com/oauth2/accessToken`，生产令牌地址为`https://bspgw.sf-express.com/oauth2/accessToken`；沙盒标准接口地址为`https://sfapi-sbox.sf-express.com/std/service`，生产标准接口地址为`https://sfapi.sf-express.com/std/service`。服务端用表单字段`partnerID`、`secret`和`grantType=password`获取令牌，在进程内缓存并于过期前刷新；标准接口表单发送`partnerID`、`requestID`、`serviceCode`、`timestamp`、`accessToken`和`msgData`。OAuth2模式不得同时发送`msgDigest`。CheckWord与令牌仅存在服务端，绝不回传浏览器或写日志。依据：顺丰提供的Node.js OAuth2接入说明及[顺丰统一接入平台对接规范](https://qiao.sf-express.com/doc/download/%E4%B8%B0%E6%A1%A5%E5%B9%B3%E5%8F%B0%E6%96%B0API%E6%8E%A5%E5%8F%A3%E8%A7%84%E8%8C%83.pdf)。

另有下载页提供的`SF-CSIM-EXPRESS-SDK-NODE.JS-V1.0`示例使用 XML、`verifyCode`和旧`bsp-oisp/sfexpressService`地址，与本项目采用的`/std/service` JSON 协议不同；不要运行该示例的`npm start`，其默认报文是下单操作。`expressTypeId`必须来自顺丰已授权服务产品清单，不得猜测或使用未经确认的默认码。

沙盒“测试连接”只调用只读`EXP_RECE_SEARCH_ORDER_RESP`，不会创建运单。Production配置另提供只读Production连接检查，同样只获取OAuth2令牌并发起未知订单号的查询，不创建运单；它验证凭据和只读查询连通，不会把下单权限伪标为已验证。现有连接的授权服务矩阵可单独保存，不需要重新输入或轮换PartnerID/CheckWord；服务矩阵变更会重新要求操作员验证首票Production下单。首票前会在右栏显示完整寄收地址、服务及月结账号复核，并禁用批量下单；确认首票真实订单仍需操作员核对资料与费用。收到顺丰成功响应后，系统才把该连接的下单能力记为已验证。下单、轨迹、取消能力分别在相应接口成功后记录。

## Production环境变量清单（2026-09-24只读核对）

以下表格保留2026-09-24的变量元数据核对记录，不代表当前配置已满足。该次Vercel核对只读取变量名、类型、环境和分支范围，没有读取变量值、增删或轮换变量；运行依赖分类以本页“服务端环境变量”为准。

| 用途 | 变量 | 2026-09-24 Production记录 | 需要保留的原因 |
|---|---|---|---|
| Supabase项目地址 | `NEXT_PUBLIC_SUPABASE_URL` | Config，已存在 | 现有客户端和服务端数据库连接使用 |
| Supabase客户端访问 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Config，已存在 | 浏览器端受RLS保护的Supabase客户端使用 |
| Supabase服务端访问 | `SUPABASE_SERVICE_ROLE_KEY` | Secret，已存在 | 服务端API访问Supabase；绝不能传到浏览器 |
| 寄件凭据加密 | `SHIPPING_CREDENTIALS_ENCRYPTION_KEY` | Secret，已存在 | AES-256-GCM加密数据库中的PartnerID、CheckWord和月结卡号；32随机字节编码为64位十六进制 |
| 签名上下文（条件必需） | `SHIPPING_CONTEXT_SECRET` | Secret，已存在 | 携带签名业务上下文的链接使用，至少32字符 |
| 寄件回执与限流 | `SHIPPING_RECEIPT_SECRET` | Secret，已存在 | 内部和匿名寄件单创建、匿名回执与限流签名，至少32字符 |
| 一次性旧配置/名单迁入 | `SHIPPING_ALLOWED_USER_IDS` | Config，已存在 | 证明旧凭据所属组织并迁入人员权限；两类导入和新版本稳定验收完成后再删，不作为持续授权来源 |

可选项：`SHIPPING_ANONYMOUS_LIMIT`（默认20）、`SHIPPING_BUSINESS_CONTEXTS_JSON`（默认空对象）。该次Production核对未配置这两项；它们不是普通寄件和承运商API运行的必需项。

### 旧顺丰环境变量

当前Vercel Production仍有旧`SF_PARTNER_ID`、`SF_CHECK_WORD`、`SF_ENVIRONMENT`、`SF_MONTHLY_CARD`和`SF_SERVICES_JSON`；未读取变量值。新代码的一次性迁入按钮可把PartnerID/CheckWord、授权服务和月结卡号存入数据库，日常下单、查询、轨迹和取消均从数据库取配置。`SF_ENVIRONMENT`不会被新代码读取；但旧Production部署仍在运行，旧变量须等新版本部署、配置迁入并完成验收后再清理。当前没有Production `SHIPPING_SENDER_JSON`，公司默认寄件人须在配置中心手工录入。新版本稳定后删除不再需要的`SF_*`和`SHIPPING_ALLOWED_USER_IDS`，不需要为此新建或轮换密钥。`SF_SANDBOX_MONTHLY_CARD`和`SF_PRODUCTION_ORDER_ENABLED`目前仅能看到Preview条目。

### 2026-09-24环境核对记录（历史快照）

- Production的Supabase核心变量与上述三个服务端密钥均已存在；没有要求新增或更换密钥。
- Production `shipping_carrier_connections`、`shipping_billing_accounts`、`shipping_sender_profiles`当前均为0行；因此尚未配置生产连接、生产月结账号或公司默认寄件人。
- Production的订单、运单和轨迹表已存在并启用RLS，无需重复应用迁移。
- 隔离Preview已有1条沙盒连接、1个活动默认月结账号、1个默认寄件人和1个已授权服务。现有Chrome曾成功创建一票合成沙盒订单；取消接口返回A1004（顺丰应用未关联`EXP_RECE_UPDATE_ORDER`），轨迹查询返回的是沙盒模拟响应，均不能证明Production能力。
- 当日核验的Preview部署位于原分支`codex/wp11-main-integration`，SHA为`f4d2c82a67dd62c75ce86139400e5c5201a2f4a9`。现有Chrome刷新后确认`/shipping`为纯三栏业务页，寄件设置位于`/configs?tab=shipping`，没有设置遮罩覆盖工作台。此历史记录不代表最新候选部署。
- 顺丰控制台的“ONES-自助查寄”应用中，`EXP_RECE_CREATE_ORDER`待上线，`EXP_RECE_SEARCH_ORDER_RESP`与`EXP_RECE_SEARCH_ROUTES`已上线，`EXP_RECE_UPDATE_ORDER`尚未关联。控制台要求接口在沙盒7天内成功调用至少3次后才能申请上线；下单与取消因此仍是外部上线门禁。
- Production仍运行旧版本；数据库配置表为空，默认寄件人待录入。未修改Production环境变量、未写Production配置行、未提交真实运单。

## 真实寄件验收准备（用户执行）

1. 部署前核对本页基础项及已启用功能的条件必需项在Production的作用域与格式，继续复用现有有效密钥；不要将密钥值复制到仓库、聊天或日志。将来轮换加密主密钥前先重加密数据库中的所有凭据和月结卡号。
2. Production与隔离Supabase项目均已按序应用`20260922000001`、`20260923074619`、`20260923081415`，并验证配置表/订单表RLS、拒绝`anon`/`authenticated`直接访问、`service_role`权限和快照列/索引。Production配置表仍为空；这表示当前没有生产承运商连接、月结账号或寄件人资料。
3. 新版本部署到Production后，配置管理员在配置中心迁入已有的Production机器凭据、月结卡号和授权服务；手动录入公司默认寄件人，并把旧寄件人员名单迁入组织权限表。确认`EXP_RECE_CREATE_ORDER`已经顺丰上线、`EXP_RECE_UPDATE_ORDER`已关联后，再分别验证订单、查回、轨迹和未揽收取消能力；只读连接通过不自动开启Production下单。
4. 按顺丰要求确认生产月结账号已绑定当前开发者应用；普通ONES寄件人无需获得顺丰管理员身份。
5. 部署并通过用户现有Chrome验收后，用户指定一票真实寄件，核对金额和收件信息并亲自确认下单。揽收前由用户核验一键取消及ONES/顺丰状态一致。
6. 新版本稳定并完成配置迁移、访问权限迁移和真实验收后，单独删除Vercel中不再使用的`SF_*`和`SHIPPING_ALLOWED_USER_IDS`旧变量；不要在旧代码仍服务Production时先删变量。

截至2026-09-24 13:38 UTC核对：未读取Vercel环境变量值、未读取或导出Production联系人内容、未创建真实运单、未部署Production。Production现有Supabase项目变量与三个寄件运行密钥均存在；旧SF变量仍在，可由新版本配置中心迁入。Production寄件连接、月结账号、寄件人、订单和运单表计数均为0。Preview一票合成沙盒订单已成功创建；取消返回A1004，沙盒轨迹响应为模拟数据。当前顺丰生产下单API待上线、取消API未关联。无密钥轮换或环境变量新增要求。

## 前向迁移

F054迁移链已按顺序应用于隔离Preview与Production；两边迁移账本版本已与仓库文件名对齐：

- `20260922000001_shipping_collaboration_m0.sql`：基础`shipping_orders`、`shipping_waybills`、`shipping_tracking_events`、限流表与受限服务端限流函数。

- `20260923074619_shipping_carrier_configuration.sql`：组织级连接、加密月结账号、默认寄件人，RLS开启并撤销`anon`/`authenticated`直接访问。
- `20260923081415_shipping_order_configuration_snapshot.sql`：连接授权服务矩阵及寄件订单的非机密连接/账号/寄件人快照。

### Production数据库恢复与回滚边界

Production项目为Supabase Free计划，当前没有托管备份或PITR。**不得用`pg_dump --schema=public`作为“只备份结构”的命令**：该命令会包含表数据，可能导出联系人信息；本次没有创建数据备份，也没有导出联系人。不要运行旧的私有全库备份脚本。

本批迁移只新增表、列、索引、RLS和权限，没有删除或更新现有业务行；应用发布前新表保持为空。迁移异常时通过Supabase元数据检查已落地对象并前向修复，不假设自动回滚。应用发布后若代码回归，回退应用版本并保留新增schema与已写入行；禁止DROP/TRUNCATE。以上是本批增量迁移的代码回滚策略，**不等于完整数据备份或PITR**。

迁移前基线和迁移后验证记录在当前worktree的`codex-runtime/delivery-evidence.json`：包括迁移历史、目标表列/RLS状态、目标表行数和访问权限结果，不含业务行数据。迁移版本为`20260922000001`、`20260923074619`、`20260923081415`；Production与隔离Preview均已对齐到仓库版本。

### Supabase Data API 权限核对

应用通过`supabase-js`的PostgREST Data API访问这些`public`表。迁移对配置表显式授予`service_role`所需CRUD权限，同时启用RLS并撤销`PUBLIC`、`anon`、`authenticated`权限。Production验证确认客户端角色不能直接读取寄件订单或执行限流函数，而`service_role`具备所需权限；不要为了修复拒绝而向客户端角色开放机密配置表。[Supabase changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)；[Securing your API](https://supabase.com/docs/guides/api/securing-your-api)。

## 发布回滚方案（当前执行状态）

本批迁移采用新增表/列/索引的前向兼容方式；回滚以恢复旧应用版本为主，不自动删库或删除迁移对象。Production迁移已应用，但候选代码还没有进入main或Production：

1. **部署前留存基线**：Production旧READY deployment为`dpl_5AZWcqM5hnvQMKoqCA8mQybuWoBi`，其SHA为`dd28bf60583954822edca05fbd991126a6ddb56f`；迁移前后schema基线见worktree私有delivery evidence。当前没有完整数据备份或PITR。
2. **迁移失败或新版本未启动**：Production旧应用继续运行；检查迁移历史和已创建对象，保留错误与migration history，前向修复。不要手工删除部分落地的表、列或migration history。
3. **应用发布后发现代码回归**：将Vercel恢复到部署前记录的READY deployment/精确SHA；保留新增数据库对象、`SHIPPING_CREDENTIALS_ENCRYPTION_KEY`和`SHIPPING_RECEIPT_SECRET`，同时暂时保留旧版本仍需的`SF_*`变量。由于schema是加法迁移，旧版本不应依赖新列；回退后不得删除新配置或迁移对象。
4. **新版本已写入连接或订单快照**：禁止通过DROP表/列回滚。先停止新下单入口并保留加密密钥；若需恢复数据，按数据库负责人批准的备份/PITR流程执行，并明确其会丢弃恢复点之后的写入。否则保留schema，通过后续前向修复恢复服务。
5. **重新发布**：修复后用新的精确SHA重新执行代码门禁与隔离库迁移验证，再另行审阅Production变量差异和发布步骤。仅在新版本稳定并完成真实验收后，才单独清理旧`SF_*`变量。

本方案不代表Production已有完整数据备份或恢复演练。任何需要恢复Production业务行数据的变更，必须另行建立经授权的恢复方案；不得借本次迁移导出联系人数据。

## 接口核验

官方参考：
- https://qiao.sf-express.com/doc/download/丰桥平台新API接口规范.pdf
- https://qiao.sf-express.com/doc/download/SF-CSIM-EXPRESS-SDK-PHP指南-V2.1.1.pdf
- https://open.sf-express.com/

适配器使用标准API的创建订单、按订单号查询结果、轨迹查询。Node.js接口按OAuth2机器凭据接入；必须在当前已授权应用里验证服务码、业务字段、响应结构及下单/查询/轨迹/取消真实权限后才能发布。下单返回orderId必须与本地一致，轨迹必须与请求运单一致。无法识别的响应失败关闭。

## 验收

运行 `sh scripts/local.sh test:run lib/shipping app/api/shipping app/shipping`，随后typecheck/lint/build。真实工作台不允许把承运商失败改为模拟成功。普通页面无连接时明确显示未接通、禁用外部操作，但可整理地址。

### 文本优先与独立模拟体验（2026-09-27）

`/shipping`默认显示文本解析，文件导入排第二。文本最多200票、100,000字。分票识别明确的新收件人或新的完整收件资料；同一人的姓名、电话与地址可以跨行，空行只作为辅助分组，冒号用于识别明确字段。连续完整单行、同一段多位收件人、同名不同完整地址均须保持各自单据，不能把地址随意配给另一位收件人。

每票保留可展开核对的原文，客户/公司前缀不混入姓名或地址。一个手机号和座机并存时优先填入手机号；多个手机号仍需人工选择。原文仅用于前端核对，不进入下单请求。姓名、电话、地址分别显示缺失与格式错误，补全后即时重算；只有有效票可提交。解析预览与提交使用同一份准备后的收件数据，不猜测缺失省市区，也不复制别人的地址来补齐缺项。

电话是解析线索，不能单凭号码数量分票。前端与后端共用国内手机号、带区号座机及分机的格式规则；7/8位本地号码要求补区号，明确的`+86`国内号码规范化后再提交。国际号码长度按国家或地区变化，显式国家前缀须完整保留；本期国内寄件不会将其截成11位或误标成可直接下单，国际业务需要另行匹配目的地及已授权服务。

用户明确要求先查看完整流程，因此新增独立`/shipping/demo`入口。它沿用现有登录要求和同一三栏组件，始终显示模拟提示；示例客户、`DEMO-`单号和轨迹仅在当前页面内存中流转。可以演示解析、纠错、批量下单、销售提报确认、查询、取消和重置；不调用顺丰、不保存业务数据、不产生费用。它不证明沙盒或Production接口已经通过。

Excel解压库改为需要解析xlsx或下载模板时才加载。文本优先基准提交b25c5661的同口径构建清单中，寄件页面入口JavaScript由152,378降为119,595字节gzip（减少21.51%），入口不再包含JSZip；不把该体积变化等同于已测得的网页耗时。200条地址的解析和收件资料准备在本机基准合计约0.4ms，CPU解析不是主要瓶颈。详细基准和模拟隔离测试保存在当前worktree的`codex-runtime/shipping-performance-20260927`与`shipping-text-demo-20260927`。

生产或真实付费寄件需独立授权；下单、接口沙盒、代码通过、线上发布是不同结果。

## 历史WP11候选证据（非当前运行态证明）

- 独立工作树运行证据位于 `codex-runtime/shipping`，不放入tracked文件。
- 本地构建服务：`http://localhost:3011/shipping`，使用隔离数据库及专用测试账号。
- 托管隔离库已应用本批迁移；RLS开启、anon读权限关闭、authenticated写权限关闭，service_role可写。
- 应用已创建，下单/结果查询/轨迹三个接口已关联；系统下单、结果查回和轨迹查询已通过真实沙盒调用；无线上发布。

## 正式启用前的外部门禁

顺丰控制台显示：API需在沙盒7天内成功调用至少3次后才能申请上线；下单还需云打印上线或免面单申请通过。当前`EXP_RECE_CREATE_ORDER`处于待上线，`EXP_RECE_UPDATE_ORDER`尚未关联；查单和轨迹API已上线。正式月结号需在应用详情绑定。上述平台授权、网站Production发布、真实付费寄件是不同门禁；当前只完成一票沙盒下单，取消仍被A1004拒绝，轨迹响应为沙盒模拟数据。

官方接入规则：https://open.sf-express.com/developSupport/195960?activeIndex=149495

## 用户验收地点（2026-09-11校正）

用户明确所有验收在 `https://sales.cyanlog.icu` 的现有Chrome会话进行。localhost、隔离数据库、顺丰沙盒仅是开发证据，不向用户作为验收交付。

当前代码与部署状态以worktree独立的`codex-runtime/delivery-evidence.json`、Git远端及Vercel实际部署为准。文档中的历史SHA、连通性或DNS观察不能作为当前阻断或完成证据。Production发布须核实顺丰API上线、配置中心公司默认寄件人、Production完整路径及现有Chrome验收。

追加迁移 `20260911000003_shipping_contacts_defaults.sql` 提供私有地址簿和上次成功下单快照。匿名页面仅提供填写界面；匿名付费寄件策略尚待用户明确。

## 月结逐单审核的当前安全边界（IN-20260914-002）

用户明确：月结付款者需要看到并审核每一票，不允许开发者应用绑定月结号后直接记账。顺丰公开文档没有提供可证明逐单审批的通用标志；Production下单能力必须在企业审批策略和顺丰接口权限分别得到证据后由WP17收口。已删除旧环境开关，不能靠环境变量放开生产提交。

顺丰官方提供有效期默认300秒的月结码及供收派员输入的动态码，但标准下单接口没有接收该动态码的字段。后续只允许两种接法：顺丰书面确认`payMethod=3`能触发原有付款者逐单审核；或在ONES建立独立付款者审批，审批通过的冻结快照才能调用顺丰。未验证前只开放地址簿、智能填写和查询。

## 轨迹与取消状态一致性（2026-09-27）

生产轨迹优先使用顺丰明确的状态名称和已证实的操作码；“已收取／已揽收”表示运输中，不能当作签收。无效时间不落库，顺丰无时区时间按北京时间解释。保存事件后只单调推进当前组织的单据状态，旧响应不覆盖较新的轨迹，已签收或已取消不退回待揽收。轨迹响应同时返回已保存的单据状态，前端直接更新台账和取消入口，无需额外刷新台账请求。

顺丰官方说明沙盒路由响应为MOCK。因此沙盒轨迹会明确标注，只用于接口联调展示，不写入物流事件或推进单据状态，也不能证明实际揽收/签收。独立模拟页继续只操作浏览器内存；两者均不能替代Production真实寄件验收。

取消开始时仍必须处于待揽收；若顺丰已明确接受取消、同时另一查询刚推进运输状态，服务端会按组织核对并保存取消结果。已签收冲突保留实际状态供核对，顺丰拒绝或超时均不标成已取消。

## 当前工作台的发布验证合同

`shipping_workspace`使用`f054-v2`合同，按F054功能、有效工作包、明确Production授权和精确部署SHA确定作用范围，不把历史WP11编号作为准入条件。内部`/shipping`要求系统登录，匿名提报位于`/sales-portal`；数据库连接失败导致的登录跳转不能直接认定为会话过期。

发布核验读取现有协同表和三个配置表的权限、组织归属及订单配置快照，不要求导入旧个人联系人、重新提供顺丰凭据或调用旧MD5鉴权。操作员在现有Chrome执行真实操作；受控验证器将这些明确标注的操作员观察与Production数据库证据交叉核对，不把界面观察伪称为独立供应商抓包。匿名访问探测和管理SQL保持只读；已批准的应用轨迹刷新可能写入轨迹与能力验证时间，不能称为完全无写入。

当前SHA的Preview复验可解除集成前阻断；最终Production关闭仍要求同一SHA的正式站点复验、受控数据库检查和现有Chrome证明。沙盒MOCK轨迹必须证明未写入事件或推进订单状态，不能代替真实Production轨迹；取消必须单独验证`EXP_RECE_UPDATE_ORDER`成功。

选择免打印方案时，以顺丰控制台的免面单审核结果为准。若审核要求销售或网点负责人工号及收派员上门打印安排，须补齐真实资料；不能把代码测试通过当作供应商审批通过，也不能自行切换到云打印方案。

## 批量下单结果与查回

HTTP成功只表示接口返回了结果。工作台必须同时收到`waybill_created`和有效运单号才计为出票成功；`order_unknown`、`ordering`、缺票或非法运单号保持“待确认”。普通网络错误、服务端500、含义不明确的409和无法解析的响应也不能认定为未下单。

待确认行保留原幂等键及服务端单据编号，锁定编辑、重新解析和导入；“查回结果”使用既有单据的`reconcile`接口，只查询原承运商订单。查回仍未知或查询失败时继续保留原单，不自动重发。authenticated owner接口返回`orderId`供此路径使用，匿名提报回执契约不随之扩大。

明确的前置校验拒绝允许修正。供应商明确拒绝后，只有操作员再次提交该失败行才建立新的尝试；未知结果不能采用这一处理。模拟页使用相同的状态、单据编号和运单响应结构，避免只在模拟响应中忽略待确认状态。

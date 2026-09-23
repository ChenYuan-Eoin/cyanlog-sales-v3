# F054 自助收寄接入与运行配置

`/shipping`仅从组织数据库读取顺丰连接、多月结账号、授权服务和默认寄件人。顺丰机器凭据、月结卡号、服务产品及寄件人资料均不通过环境变量或浏览器传输。销售/匿名提报只提交收件业务字段和通用时效偏好，承运商选择仅发生在ONES履约流程。

## 服务端环境变量

写入本地私有环境文件或部署平台服务端环境配置；不要写入tracked文件或公开前缀。

- `SHIPPING_CREDENTIALS_ENCRYPTION_KEY`：64位十六进制、32随机字节，用作AES-256-GCM应用层凭据加密主密钥，并派生月结卡号指纹密钥。可用 `openssl rand -hex 32` 生成；不能记录到日志。轮换前需先重加密已存凭据和账号号。
- `SHIPPING_ALLOWED_USER_IDS`：当前寄件操作访问引导名单，逗号分隔ONES用户UUID；不包含承运商配置。
- `SHIPPING_CONTEXT_SECRET`：匿名业务上下文链接签名密钥，至少32字符。
- `SHIPPING_RECEIPT_SECRET`：匿名回执令牌HMAC密钥，至少32字符。
- `SHIPPING_ANONYMOUS_LIMIT`：可选匿名提报限流值，默认20。
- `SHIPPING_BUSINESS_CONTEXTS_JSON`：可选业务代码关系映射，不含承运商配置。

以下旧配置已退出运行时代码：`SF_ENVIRONMENT`、`SF_PARTNER_ID`、`SF_CHECK_WORD`、`SF_MONTHLY_CARD`、`SF_SANDBOX_MONTHLY_CARD`、`SF_SERVICES_JSON`、`SHIPPING_SENDER_JSON`、`SF_PRODUCTION_ORDER_ENABLED`。均在`/shipping`配置抽屉或服务端订单策略中管理。

## Vercel Production变量核对（2026-09-23；只核对名称，未读取值）

只读取变量名称和环境范围，没有读取变量值。

| 类别 | 变量 | 当前Production状态 |
|---|---|---|
| Supabase应用运行时 | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` | 已配置 |
| 寄件访问引导 | `SHIPPING_ALLOWED_USER_IDS` | 已配置 |
| 新寄件配置加密 | `SHIPPING_CREDENTIALS_ENCRYPTION_KEY` | 已配置为Vercel Sensitive变量；本机随机生成，未读取值 |
| 匿名回执 | `SHIPPING_RECEIPT_SECRET` | 已配置为Vercel Sensitive变量；本机随机生成，未读取值 |
| 签名寄件上下文 | `SHIPPING_CONTEXT_SECRET` | 已配置为Vercel Sensitive变量；本机随机生成，未读取值 |
| 匿名限流 | `SHIPPING_ANONYMOUS_LIMIT` | 可选；代码默认20 |

Vercel Production仍保留旧版本变量`SF_ENVIRONMENT`、`SF_PARTNER_ID`、`SF_CHECK_WORD`、`SF_MONTHLY_CARD`、`SF_SERVICES_JSON`；`SF_SANDBOX_MONTHLY_CARD`、`SF_PRODUCTION_ORDER_ENABLED`、`SHIPPING_SENDER_JSON`缺失。当前候选代码不再读取上述固定承运商配置。Production仍运行旧发布版本，**新代码正式部署且验收前不要删除仍存在的旧变量**；稳定后再单独清理。

`SHIPPING_CREDENTIALS_ENCRYPTION_KEY`、`SHIPPING_RECEIPT_SECRET`、`SHIPPING_CONTEXT_SECRET`已添加到Vercel Production，设置操作只返回变量名，未读回值。添加环境变量不会改变当前已经部署的旧版本，需等新版本部署后才生效。

Vercel当前Production deployment只读核对为`READY`：`dpl_5AZWcqM5hnvQMKoqCA8mQybuWoBi`，来源SHA `dd28bf60583954822edca05fbd991126a6ddb56f`，别名含`sales.cyanlog.icu`。候选尚未push、合入`production`分支或部署；发布审阅应以`delivery-check`绑定的当前精确SHA为准，不能沿用早期候选SHA。

## 真实寄件验收准备（用户执行）

1. 三个服务端密钥已配置为Vercel Sensitive变量；仅Vercel保存密钥值，不要将其复制到仓库、聊天或日志。将来轮换加密主密钥前先重加密数据库中的所有凭据和月结卡号。
2. 已在隔离Supabase项目按序应用`20260922000001`、`20260923074619`、`20260923081415`，并验证配置表/订单表RLS、拒绝`anon`/`authenticated`直接访问、`service_role`权限和快照列/索引。隔离库仅含测试数据。Production仍未应用这些迁移。
3. 配置管理员在ONES寄件抽屉录入顺丰机器凭据、各环境月结号、真实已授权服务产品和公司默认寄件人。沙盒只读测试通过后，分别核验订单、查回、轨迹和未揽收取消能力；连接通过不自动开启Production下单。
4. 月结账号主体按顺丰要求完成一次性应用授权/账号绑定；普通ONES寄件人无需获得顺丰管理员身份。
5. 部署并通过用户现有Chrome验收后，用户指定一票真实寄件，核对金额和收件信息并亲自确认下单。揽收前由用户核验一键取消及ONES/顺丰状态一致。
6. 新版本稳定后，单独删除Vercel中不再使用的旧`SF_*`配置；不要在旧代码仍服务Production时先删变量。

截至本次核对，AI未读取Vercel环境变量值、未读取或导出Production联系人内容、未对Production数据库执行DDL、未调用顺丰、未创建真实运单、未部署Production。Production现有表计数只读元数据为`shipping_contacts=631`、`shipping_outbound_imports=10`、`shipping_requests=0`；Production缺少`shipping_orders`等基础协同表。

## 前向迁移

按顺序应用截至Production迁移历史之后缺失的F054迁移：

- `20260922000001_shipping_collaboration_m0.sql`：基础`shipping_orders`、`shipping_waybills`、`shipping_tracking_events`、限流表与受限服务端限流函数。

- `20260923074619_shipping_carrier_configuration.sql`：组织级连接、加密月结账号、默认寄件人，RLS开启并撤销`anon`/`authenticated`直接访问。
- `20260923081415_shipping_order_configuration_snapshot.sql`：连接授权服务矩阵及寄件订单的非机密连接/账号/寄件人快照。

### Production数据库恢复点门禁

2026-09-23 Supabase只读备份查询返回`backups=[]`、`pitr_enabled=false`；控制台显示当前为Free套餐且不包含托管备份。数据库约32.6 MB。不得升级Pro或启用持续付费PITR作为默认方案。Supabase官方建议Free项目定期导出逻辑备份；本机有原生`pg_dump`，而Supabase CLI容器化`db dump`需要Docker。

Production DDL前先用Session Pooler通过`pg_dump --schema=public --format=custom --no-owner --no-acl`导出公共应用schema和数据，使用本地AES-256-GCM脚本加密后存入该worktree私有`codex-runtime/shipping-production-backup`。数据库密码与备份口令只在本机隐藏终端提示输入，不进入工具日志或聊天；口令由操作者保存到密码管理器。脚本验证GCM认证标签、`pg_restore --list`归档可读性、快照大小与SHA-256。当前脚本已准备，但尚无可验证快照；完成快照前不得在Production应用迁移。

三条迁移均为加法迁移。失败时停止后续步骤、保留SQL错误与migration history，不手工DROP半成品对象；先在隔离库复现并准备前向修复。不要导出Production联系人到Agent工作区中的明文文件。Production迁移和发布依据IN-20260923-014授权，但必须满足恢复点门禁。

### Supabase Data API 权限核对

应用通过`supabase-js`的PostgREST Data API访问这些`public`表。迁移对三张配置表显式授予`service_role`所需CRUD权限，同时启用RLS并撤销`PUBLIC`、`anon`、`authenticated`权限；不要为了修复PostgREST拒绝而向客户端角色开放这些机密配置表。Supabase已宣布：新项目自2026-05-30起默认不再自动暴露新表，现有项目于2026-10-30开始执行；新表必须在迁移中显式GRANT。发布前需在隔离数据库确认应用服务端访问成功，并验证`anon`/`authenticated`仍被拒绝。[Supabase changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)；[Securing your API](https://supabase.com/docs/guides/api/securing-your-api)。

## 发布回滚方案（Production授权前审阅）

本批迁移采用新增表/列/索引的前向兼容方式；回滚以恢复旧应用版本为主，不自动删库或删除迁移对象。Production执行前仍需由用户审阅并批准：

1. **部署前留存基线**：记录当前READY deployment、Production分支SHA、Production变量名称与环境范围；由数据库负责人确认可恢复的备份/时间点恢复能力，并记录恢复点。未确认可恢复点，不开始Production迁移。
2. **迁移失败或新版本未启动**：停止后续迁移/部署，保留数据库错误和迁移状态；不要手工删除半成品表、列或migration history。先在隔离库复现并准备修复迁移，再经审阅决定是否继续。
3. **应用发布后发现代码回归**：将Vercel恢复到部署前记录的READY deployment/精确SHA；保留新增数据库对象、`SHIPPING_CREDENTIALS_ENCRYPTION_KEY`和`SHIPPING_RECEIPT_SECRET`，同时暂时保留旧版本仍需的`SF_*`变量。由于schema是加法迁移，旧版本不应依赖新列；回退后不得删除新配置或迁移对象。
4. **新版本已写入连接或订单快照**：禁止通过DROP表/列回滚。先停止新下单入口并保留加密密钥；若需恢复数据，按数据库负责人批准的备份/PITR流程执行，并明确其会丢弃恢复点之后的写入。否则保留schema，通过后续前向修复恢复服务。
5. **重新发布**：修复后用新的精确SHA重新执行代码门禁与隔离库迁移验证，再另行审阅Production变量差异和发布步骤。仅在新版本稳定并完成真实验收后，才单独清理旧`SF_*`变量。

本方案不代表当前Production备份已建立或完成恢复演练；当前没有可确认的Production恢复点。Production迁移必须等到加密逻辑快照通过归档验证后再执行。

## 接口核验

官方参考：
- https://qiao.sf-express.com/doc/download/丰桥平台新API接口规范.pdf
- https://qiao.sf-express.com/doc/download/SF-CSIM-EXPRESS-SDK-PHP指南-V2.1.1.pdf
- https://open.sf-express.com/

适配器使用标准API的创建订单、按订单号查询结果、轨迹查询。参考PDF为历史协议；必须在当前已授权应用里验证服务码、业务字段、签名、响应结构及真实权限后才能发布。下单返回orderId必须与本地一致，轨迹必须与请求运单一致。无法识别的响应失败关闭。

## 验收

运行 `sh scripts/local.sh test:run lib/shipping app/api/shipping app/shipping`，随后typecheck/lint/build。浏览器使用隔离库本地服务。假响应仅在测试夹具使用，不在产品内设置mock成功模式。普通页面无连接时明确显示未接通、禁用外部操作，但可整理地址。

生产或真实付费寄件需独立授权；下单、接口沙盒、代码通过、线上发布是不同结果。

## 历史WP11候选证据（非当前运行态证明）

- 独立工作树运行证据位于 `codex-runtime/shipping`，不放入tracked文件。
- 本地构建服务：`http://localhost:3011/shipping`，使用隔离数据库及专用测试账号。
- 托管隔离库已应用本批迁移；RLS开启、anon读权限关闭、authenticated写权限关闭，service_role可写。
- 应用已创建，下单/结果查询/轨迹三个接口已关联；系统下单、结果查回和轨迹查询已通过真实沙盒调用；无线上发布。

## 正式启用前的外部门禁

顺丰当前控制台要求：API在7天内测试成功3次以上，才进入待上线；下单还需要云打印上线或免面单申请通过。个人版暂不开发打印，建议申请免面单。正式月结号需在应用详情单独绑定。以上操作与网站Production发布、真实付费寄件分别确认，当前只完成沙盒。

官方接入规则：https://open.sf-express.com/developSupport/195960?activeIndex=149495

## 用户验收地点（2026-09-11校正）

用户明确所有验收在 `https://sales.cyanlog.icu` 的现有Chrome会话进行。localhost、隔离数据库、顺丰沙盒仅是开发证据，不向用户作为验收交付。

本轮已准备以Production精确SHA为基线的最小26文件补丁，不混入报价域其他91文件差异；补丁可应用性已验证，尚未完成该最小候选的独立构建或发布。生产缺少shipping_requests，既有匿名表/RPC风险仍存在；具体生产SQL先经批准再执行。完整方案及哈希见当前worktree私有 `codex-runtime/shipping-release`。

追加迁移 `20260911000003_shipping_contacts_defaults.sql` 提供私有地址簿和上次成功下单快照。匿名页面仅提供填写界面；匿名付费寄件策略尚待用户明确。

## 月结逐单审核的当前安全边界（IN-20260914-002）

用户明确：月结付款者需要看到并审核每一票，不允许开发者应用绑定月结号后直接记账。顺丰公开文档没有提供可证明逐单审批的通用标志；Production下单能力必须在企业审批策略和顺丰接口权限分别得到证据后由WP17收口。已删除旧环境开关，不能靠环境变量放开生产提交。

顺丰官方提供有效期默认300秒的月结码及供收派员输入的动态码，但标准下单接口没有接收该动态码的字段。后续只允许两种接法：顺丰书面确认`payMethod=3`能触发原有付款者逐单审核；或在ONES建立独立付款者审批，审批通过的冻结快照才能调用顺丰。未验证前只开放地址簿、智能填写和查询。

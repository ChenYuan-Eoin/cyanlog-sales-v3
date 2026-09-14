# F054 个人一屏查寄接入

路径 `/shipping`，仅服务端访问名单内用户可用。页面访问和每个API均验证现有登录状态。所有发单经统一策略校验，再持久化幂等请求，再调用顺丰；业务订单来源当前明确拒绝。

## 私有环境配置

写入当前 worktree 的 `git rev-parse --git-path codex-runtime` 下的 `local-development.env`（本地），发布环境则写入对应服务端环境变量。不得放入 tracked 文件。

- `SHIPPING_ALLOWED_USER_IDS`：逗号分隔的系统用户 UUID。空值不开放；无管理员隐式绕过。
- `SF_ENVIRONMENT`：`sandbox` / `production`，默认沙盒。
- `SF_PARTNER_ID`、`SF_CHECK_WORD`：对应环境的开放平台顾客编码及校验码；个人网页登录不替代API授权。
- `SF_MONTHLY_CARD`：生产月结号；用户提供的值仅存私有配置，上线前需绑定到该应用。
- `SF_SANDBOX_MONTHLY_CARD`：沙盒测试月结号。2026-09-11应用详情页明确统一使用 `7551234567`，禁止在沙盒套用真实月结号。
- `SF_SERVICES_JSON`：账号已授权服务列表，如 `[{"id":2,"name":"顺丰标快"}]`，必须与当前账号文档和沙盒核实，不依靠示例推断权限。
- `SHIPPING_SENDER_JSON`：可选寄件默认值，键为name/phone/province/city/county/address；空值由本人填写。
- 生产月结下单不能通过环境变量直接开启。当前版本硬性关闭生产提交；只有实现并验证“付款者逐单审核”后，才能在代码与测试中新增生产放行条件。

## 数据库

仅在经批准的隔离库应用 `supabase/migrations/20260911000001_shipping_requests.sql`。寄件请求保存经过校验的表单快照，以恢复上次成功下单信息；shipping_contacts保存本人常用地址。两者禁止匿名和普通数据库角色直连，最近寄件接口不返回完整快照。客户端数据库角色无权限，由服务端API读写。

发布时此迁移与既有生产安全门禁单独判断；不得因为本地页面通过直接执行生产SQL。回滚优先关闭功能访问/发单，保留寄件记录供对账，不删除已发送请求。

## 接口核验

官方参考：
- https://qiao.sf-express.com/doc/download/丰桥平台新API接口规范.pdf
- https://qiao.sf-express.com/doc/download/SF-CSIM-EXPRESS-SDK-PHP指南-V2.1.1.pdf
- https://open.sf-express.com/

适配器使用标准API的创建订单、按订单号查询结果、轨迹查询。参考PDF为历史协议；必须在当前已授权应用里验证服务码、业务字段、签名、响应结构及真实权限后才能发布。下单返回orderId必须与本地一致，轨迹必须与请求运单一致。无法识别的响应失败关闭。

## 验收

运行 `sh scripts/local.sh test:run lib/shipping app/api/shipping app/shipping`，随后typecheck/lint/build。浏览器使用隔离库本地服务。假响应仅在测试夹具使用，不在产品内设置mock成功模式。普通页面无连接时明确显示未接通、禁用外部操作，但可整理地址。

生产或真实付费寄件需独立授权；下单、接口沙盒、代码通过、线上发布是不同结果。

## 当前本机验证

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

## 月结逐单审核（2026-09-14）

用户明确：月结付款者需要看到并审核每一票，不允许开发者应用绑定月结号后直接记账。当前下单报文使用寄方付月结，顺丰公开文档没有提供逐单审批标识；因此生产提交在代码层硬关闭，即使设置旧的`SF_PRODUCTION_ORDER_ENABLED=true`也不会生效。

顺丰官方提供有效期默认300秒的月结码及供收派员输入的动态码，但标准下单接口没有接收该动态码的字段。后续只允许两种接法：顺丰书面确认`payMethod=3`能触发原有付款者逐单审核；或在ONES建立独立付款者审批，审批通过的冻结快照才能调用顺丰。未验证前只开放地址簿、智能填写和查询。

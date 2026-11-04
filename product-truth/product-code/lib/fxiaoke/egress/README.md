# 纷享专用出口程序（WP91 / WP94）

正式站 → 加密短期请求 → 现有主机主动领取 → 纷享官方 API → 加密结果 → 正式站。

当前使用已有云电脑；Mac mini 仅作备用，不切换企微接收进程。运行不依赖远程桌面、浏览器窗口或持续监看屏幕。它不监听公网端口，也不是通用代理。只允许应用鉴权、固定正式回调地址的 OAuth 授权码交换，以及 DepartmentObj、PersonnelObj 的固定字段只读查询；不能寄件、修改 CRM、任意抓取 URL 或跨组织领取。

## 发布边界

WP91 固定出口已按 `IN-20261028-007` 使用既有主机启用；历史连接与目录预览不代表 WP94 员工登录已验收。WP94 本次候选补齐 callback 的企业 transport，并在共享协议中只放行 `authorization_code` 的固定请求结构：精确官方 token URL、UUID v4 trace、JSON headers、五个必需字段及 `https://sales.cyanlog.icu/api/auth/fxiaoke/callback`。保留原 `app_secret` 规则。

网站和主机都使用 `protocol.mjs`，发布时必须核对两端版本兼容。WP92 切换期间，新主机协议同时接受旧站点的 `main_department` + offset 请求和新站点的 `data_own_department` / `vice_departments` + `_id` 游标请求；新目录请求仍要求精确总数、固定前置条件与稳定排序。先切换 worker，再部署网站，可让任一方向回滚期间继续读取通讯录。本次不需要新迁移、令牌或白名单变更；复用原受保护运行环境文件。发布授权仍按当前 WP92 的精确候选与范围判断，旧连接验收不得代替真实目录范围与切源验收。

新增两张服务端专用表：运行心跳一行/企业、短期加密请求表。普通账号和匿名角色无表与 RPC 权限。主机不持有数据库 service-role 密钥或全站加密主密钥。请求最长有效 20 秒，领取采用原子锁和随机租约；完成后立即消费删除，超时/取消清理，主机领取时清理已过期行。异常终止遗留的密文可能保留到下次清理，但过期后不可领取或写回。

Realtime 只广播空唤醒信号，不含任务 ID、企业 ID、任何凭据或通讯录数据。实际领取/回写必须通过指定企业的专用随机凭据。空闲时每分钟一次心跳/清理，约 1,440 次请求/天；另有一个 Realtime 连接和实际业务请求。复用现有资源不等于用量为零，启用前须核对现有额度。

## 系统侧配置（运维项，不放在业务表单）

| 环境项 | 内容 |
|---|---|
| `FXIAOKE_EGRESS_ORG_ID` | 本次允许领取的系统企业 UUID |
| `FXIAOKE_EGRESS_TOKEN_SHA256` | 主机随机令牌的 SHA-256；服务端仅保存摘要 |
| `FXIAOKE_EGRESS_ALLOWED_IP` | 已核实并写入纷享白名单的单个 IPv4 |

未配置时保持现有直连行为；完整配置只作用于指定企业。部分缺失或格式错误时拒绝使用，不能静默回落绕过故障。专用令牌是 32–64 字节随机值的十六进制编码，应通过受保护配置渠道生成/分发，不能放在命令参数、代码、聊天或日志。

## 主机配置

在受保护的 `runtime.env`（目录 0700，文件 0600）中保存：

```dotenv
FXIAOKE_EGRESS_TOKEN=<本机专用随机令牌>
SUPABASE_PUBLISHABLE_KEY=<现有 cyanlog-sales-v3 的 publishable key>
```

运行仅需 Node.js 22+。将本目录的 `worker.mjs`、`protocol.mjs`、`package.json` 和 `package-lock.json` 放进独立版本目录，执行 `npm ci --ignore-scripts --omit=dev`。通过 `FXIAOKE_RUNTIME_ENV` 指向上述私有文件，再运行 `node worker.mjs`。不复制网站环境变量或使用数据库管理员密钥。

采用独立的 systemd 服务启动，保持现有 `price-v3-wecom.service` 原样。服务的 `WorkingDirectory` 和 `ExecStart` 必须指向已验证版本及实际 Node 路径，`Restart=on-failure`，开机启动；标准输出进 journal。安装、启用和设置白名单属于发布动作，不由此文档自动授权。

更新时使用独立版本目录，保留旧目录和 unit 备份；先验证新包 hash、语法和共享协议，再切换现有 `price-v3-fxiaoke.service`，不并行运行第二个领取者。失败时恢复原 unit 的版本路径并重启原 worker，核对固定出口心跳和企微服务。此版本回滚不等于停用整个固定出口。

## 检查与失败处理

1. 主机通过 HTTPS 查询自己的出口，每 45 秒以上刷新；查询失败时不领取请求。服务端将报告的地址与配置比对，不自动修改白名单。
2. IP 不匹配时标记 `ip_changed`；网站明确要求核对并更新白名单。心跳超过 90 秒失效，网站拒绝排入包含凭据的请求。
3. 白名单内的地址不代表纷享授权成功。必须以真实 `errorCode=0`、服务端自动获取企业账号、保存回读和目录预览证明接通。
4. `worker_error / WORKER_AUTH_REJECTED` 表示专用凭据无效，停止处理；修复配置后再启动。`CONNECTION_FAILED` 只记录分类，不输出异常原文、凭据或人员信息。
5. 停用转发时移除系统侧三项配置并停止这个专用进程；现有企微进程与组织数据不受此程序操作。已保存纷享连接继续保留，回退直连不代表白名单问题已解决。

生产验收仍必须在用户现有 Chrome、`sales.cyanlog.icu` 真实操作；本地测试或主机在线都不能代替。

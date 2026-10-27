# 企微单聊寄件接收服务

销售只发收件人、电话、地址。服务端校验可信员工身份，使用管理员保存的默认寄件人及顺丰标快，保存待确认工单后才回复 SO 工单号。操作员确认资料和费用后，现有寄件台才向顺丰正式下单。销售可单聊发送“查询我的工单”获取 SF 号；主动出号推送尚未验收。

## 配置位置与责任

| 配置 | 在哪里配置 | 作用 |
|---|---|---|
| API 模式 / 使用长连接 | 企微正确企业的机器人详情 | 机器人消息交给接收服务 |
| 企微 Bot ID / Secret | 系统配置中心的长连接机器人 | 加密保存；不是自建应用 AgentID/Secret，也不是消息 MCP apikey |
| 企业应用 CorpID / AgentID / Secret、提报范围 | 系统企业应用配置和企微管理员后台 | 同步及校验员工；HTTP API 可能需要应用可信 IP；不能以机器人连接成功替代成员授权 |
| 默认寄件人 | 系统寄件配置 | 姓名、电话、省市区、完整地址；销售归属单独记录 |
| 顺丰生产连接、月结与标快 | 系统顺丰配置 | 操作员确认后的正式下单；连接查询通过不代表实际下单通过 |
| 接收服务 | 已有云电脑或本机 | Node.js 22+；持续运行单实例；休眠、关机或退出会中断 |

无需为长连接填写 URL 回调、Token、EncodingAESKey。消息 MCP 地址是外部工具读写消息的入口，不作为本服务接入参数。员工网页 OAuth 是另一条路径，不作为单聊入口。

## 首次接入

先部署匹配版本的业务接口，再在配置中心对正确的机器人生成十分钟有效的接入令牌。将以下两项写入接收服务的私有环境，不把实际值放在命令行、日志、源码或聊天：

- `WECOM_BOT_CONNECTION_ID`：**系统连接记录 ID**（UUID），来自令牌区域；用于系统 API 路由。
- `WECOM_ENROLLMENT_TOKEN`：短期接入令牌。
- `WECOM_RUNTIME_URL`：`https://sales.cyanlog.icu`。

在本目录执行 `npm ci --ignore-scripts` 后执行 `npm run enroll`。程序把服务端返回的**企微 Bot ID**写入 `WECOM_BOT_ID`，与系统连接 ID 分开存储；同时写入 Secret 和运行地址到权限 `0600` 的 `runtime.env`。该文件已忽略，不得加入 Git。

`npm start` 自动读取本目录 runtime.env；systemd 也可通过 EnvironmentFile 注入。Bot Secret 不回传管理员列表；运行时不需要 Supabase 或顺丰密钥。

## 运行与诊断

- `npm run probe`：只认证后断开，不会持续在线或接单。
- `npm start`：持续连接，处理消息并发送业务心跳。
- `npm test`：离线认证状态、签名桥接、接入配置及密钥泄漏回归。

依次验证：企微认证成功 → 系统签名心跳成功 → 收到单聊 → 入站事件 → 保存工单 → 回复 SO 号。`authenticated=true` 仅表示连接认证；必须同时有业务处理器，且系统成功收到心跳。后台超过 150 秒未收到业务心跳显示过期，不把历史认证当持续在线。

- `853000` / `credentials_rejected`：检查**企微** Bot ID 与 Secret 是否属于同一个 API 机器人，不能拿系统 UUID 认证企微。
- 桥接 `404`：检查正式站是否部署接口、系统连接 ID 是否正确、机器人是否停用。
- 桥接 `401`：检查两端 Secret 和系统时间；不得循环重试错误凭据。
- 成员核验失败：管理员同步目录、核对允许提报范围和应用可信 IP；禁止放宽身份验证。
- 群聊：只提示改用单聊，不保存或展示个人寄件信息。
- 相同未完成的寄件资料重发：复用原工单；前一同资料订单取消或签收后允许创建下一票。

默认文件/合同、预估 1kg、寄方月结、不保价；重量费用及特殊寄件要求在操作员确认阶段核对。任何失败都不能回复“已提交”或“已下单”。面单打印失败只能重试原单打印，不能再次下单。

## 常驻运行

使用已有主机，不新增付费资源。Linux 示例（路径按实际安装目录调整）：

```ini
[Unit]
Description=Price V3 WeCom private shipping
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=agentuser
WorkingDirectory=/home/agentuser/wecom-run
EnvironmentFile=/home/agentuser/wecom-run/runtime.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

认证拒绝和配置停用应停止处理，修复配置后由管理员重启，不能无限挤占连接。发布后须实际验证开机启动、掉线恢复、停用、单聊受理、重复提报和他人单拒绝；示例配置和测试通过不代表生产验收。

## 当前交付边界

本目录是待验证候选。只有 sales.cyanlog.icu 的精确部署版本、云端实际运行证据、真实单聊与后台一致的 SO 号、操作员确认后真实 SF 号、本人查询及隐私隔离共同通过，才完成全链路。

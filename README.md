# ONES Sales / Price V3

实际应用目录：`product-truth/product-code`。使用 Node 24 与项目锁定的 pnpm 9.15.9。

## 本地运行

```sh
sh product-truth/product-code/scripts/local.sh dev --hostname 127.0.0.1 --port 3000
```

本地入口只读取当前 worktree 的 `codex-runtime/local-development.env`，或显式指定的 `PRICE_V3_LOCAL_ENV_FILE`，并拒绝生产数据库。凭据从安全配置渠道提供，不提交 `.env` 文件。缺失配置时会明确停止。

## 当前工作范围

唯一 Active 为 **WP10：报价域完整形态与换机可迁移基座**。权威队列是 `governance/runtime-state/active-task.json`；新输入进入 `demand-inbox.jsonl`。不要根据历史文档把队列切回 F001 或 WP09。

- 产品需求与验收标准：`product-truth/REQ_REGISTRY.yml` 与 `product-truth/feature-packets/`。
- 执行范围与权限边界：`AGENTS.md`。
- 最新运行/发布证据：`git rev-parse --git-path codex-runtime` 指向的 worktree 独立目录。
- 阶段分开记账：代码、隔离候选、main、Production 不互相替代。

第三方开发插件的配置存在不代表项目门禁已经生效；原生文件/命令操作需通过对应客户端适配器，PTY/MCP 等其他通道须独立评估。

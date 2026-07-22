# Price-v3 分支与脏工作树收敛审计（2026-07-22）

## 结论

本轮主干只能接收 `Price-v3-release-20260720` 中通过同一提交验收的候选。其余脏工作树不是待合并队列，而是受保护快照、旧架构实验、重复历史或运行工件；机械合并会重新制造多基线。

“全部合并”的可审计口径是：所有**当前、有效、无重复且通过验收**的改动进入 `main`；未满足这些条件的历史脏资产原地保留，进入后续选择性恢复目录，不删除、不覆盖，也不冒充已交付。

## Git 祖先关系

- 审计锚点：`origin/main=ed0f627f920be259a69cc5b8eea534cb5a30dc92`。
- 当前候选原始锚点：`7e5457d4a0210ca1daf7b4405c338fc3d65d8aa3`。
- `origin/main...candidate = 0/257`，因此候选验收后可快进合入，不需要制造新的竞争 merge 基线。
- `spacex-hardening=47f6a544` 相对候选唯一的是一个历史 merge commit；其 tree 等于第二父 `e67fff0c`，没有额外产品 delta 需要回收。这里不能笼统写成“tree 未变化”，因为它相对第一父仍有大量差异。
- Wave 1-4、Production 锚点、性能分支及全部 clean detached worktree 均为候选祖先或重复历史。

`origin/main...candidate = 0/257` 只证明 main 可快进，不证明所有其他 ref 已包含在候选中。因此还必须检查 `candidate..ref`，并按产品边界裁定独特提交：

| Ref（相同 tip 合并列出） | 独特提交 | 代表 tip | 裁定 |
|---|---:|---|---|
| `codex/audit-remediation-61-issues`、`develop-deploy-temp` 及远端同名 | 5 | `49564456` | 不合入。旧 favicon 方案夹带旧 AI、规则和运行状态 bundle；候选已有 `60a2a4a0` 的透明方形画布后继方案，整段回收会回退当前边界。 |
| `codex/contract-product-line-closure`、`fix/favicon-square-hint` 及远端同名 | 1 | `0d06694b` | 不合入。三个品牌文件均已被 `60a2a4a0` 后继实现改写；旧文案仍主张浏览器居中裁剪，与当前方案相反。根保护树挂在该 ref，不能移动或清理。 |
| `codex/recovery-r1-ai-rules` | 1 | `d122211d` | 不合入，登记选择性恢复。旧 Provider/规则发布混合架构已被 WP01/WP03 对象边界取代。 |
| `codex/recovery-r2-contract-draft` | 1 | `c0c278ac` | 暂不合入。WP07 未激活，起草迁移、Preview 与文件验收没有在当前母本闭环。 |
| `codex/recovery-r3-contract-review` | 1 | `0ea7af4d` | 暂不合入。属于 G5/WP05 停靠线，没有当前同 SHA 文件、浏览器与 ReviewRun 闭环。 |
| `codex/recovery-r4-cspp-basic` | 1 | `dddc12d9` | 明确不合入。CSPP/WOPI 产品方向已经放弃。 |
| `codex/recovery-r5-brand-org` | 1 | `d0694b05` | 暂不合入。属于待拆分 WP08；当前候选仅选择性吸收了后继品牌修复。 |
| `codex/recovery-r6-integrations` | 1 | `b760dabf` | 暂不合入。外部集成线处于 parked 状态，且包含未验收迁移。 |
| `codex/recovery-r7-candidate` | 49 | `c0439c38` | 禁止整分支合入。该 ref 把 r1-r6、WOPI 与后续修补重新混成 259 文件、约 29k 行的竞争母本。 |
| `origin/spacex-hardening` | 1 | `47f6a544` | 不需合入。唯一 merge 的 tree 等于第二父，不产生额外产品代码。 |

候选已包含、独特提交为 0 的 ref 包括：`main` / `origin/main`、`origin/production`、`codex/cspp-basic-wopi-host`、两个 04a38441/Production 锚点、Wave 1-4、性能分支、`origin/feat/f005-ask-phase1` 以及全部 clean detached worktree HEAD；无需再次制造 merge commit。

## 工作树盘点快照

下表包含开始分类时的快照，以及准备提交前的重算结果。最终证据仍以提交后的 Git note 机器快照为准。

| 范围 | 审计数量 | 裁定 |
|---|---:|---|
| 全部 worktree（`2026-07-22T04:25:32Z`） | 24；11 dirty，13 clean | 保留现状，不批量清理 |
| 跨工作树 dirty 总量（`2026-07-22T04:25:32Z`） | 212 tracked，1,995 untracked（含重复） | 逐来源裁定，不能按数量机械合并 |
| release 候选（本轮开始） | 3 tracked | 2 个 hook 运行副产物已排除；1 个真实 ReviewRun 验收修正纳入本轮验证 |
| release 候选（准备提交） | 20 tracked，2 untracked | 全部列入本提交的逐文件审查；提交后必须为 clean |
| 根保护树 `/Users/nsss/Price-v3` | 116 tracked，1,937 untracked | 禁止 stash/reset/clean/整树合并 |
| P4 AI 旧实验 | 18 tracked，3 untracked | 与当前平台模型架构竞争，不合入 |
| 旧 recovery worktree | 47 tracked，29 untracked | 含迁移与生成物，缺少独立闭环，不合入 |
| CSPP/WOPI 实验 | 3 tracked，20 untracked | 产品方向已放弃，不合入 |

## 根保护树事实

- 本轮开始对比时，根树只有 23 个 tracked 与 6 个 untracked 文件和候选字节一致，86 个 tracked 文件与候选形成竞争实现；候选继续编辑后这些数字会变化，只用于证明“绝大部分不能批量回收”，不作为封存时精确数量。
- 另有 131 个非工件、仅存在于 dirty 快照的源码/测试/迁移，主要包括 45 个 migration、21 个 contract lib、20 个 API、16 个 export、14 个 document 文件。
- 这些文件属于 G5/G6/P0 历史研发资产，但当前没有逐批代码事实、迁移安全、Preview 与文件验收闭环，因此只登记为选择性恢复资产。
- 当前根树状态已经超过旧保护记录的 76 tracked / 40 untracked，说明快照标记后根树仍被写入；本轮不得更新旧标记来掩盖漂移。

## 明确排除项

- 旧 `RuleDialog` 无调用方、`Select` 新参数无人消费、4 个 AI failover caller 使用当前 API 已不支持的字段，不是可直接回收功能。
- P4 dirty 中的原子发布迁移未经过当前 Preview 数据安全门禁。
- 旧 recovery 中混有渲染输出、临时证据和竞争迁移。
- CSPP/WOPI 已不符合当前“保留原文 + 浏览器预览 + 格式化批注导出”的产品方向。
- `.DS_Store`、临时日志、tracked Harness/feedback 运行输出和重复构建产物永远不作为产品源码合并。

## 本轮收敛门禁

1. release worktree 提交后必须 clean，并通过目标测试、typecheck、lint、全量测试与 build。
2. 同一 SHA 的 Preview 必须 READY，并完成桌面、iPad 和白色遮罩缺陷真动作重放。
3. Vercel Production Branch 固定为 `production`，本轮前后 Production deployment commit 必须相同。
4. `origin/main` 只能快进到已验收候选；随后 GitHub default branch 切换为 `main`。
5. 交付证据写入 worktree runtime，并固化到 `refs/notes/price-v3-delivery`；证据更新不得改变候选 SHA。

所以“全部合并”的精确定义是：本轮唯一 Active 候选中，经同一 SHA 代码、Preview、浏览器和运行证据验收的当前成果快进到 `main`；其余独特历史成果保留在 ref 或受保护快照中，按后续 WP 逐批选择性恢复，不删除、不整分支合并，也不冒充已经交付。

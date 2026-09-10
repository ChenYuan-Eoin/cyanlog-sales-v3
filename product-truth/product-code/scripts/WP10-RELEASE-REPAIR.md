# WP10 发布阻断修复与验收交接

当前结果：隔离分支 `codex/wp10-release-repair` 的代码和本地数据库验证通过；尚未提交、部署或进行生产写入。原目录的既有 dirty 和本地服务未被覆盖。

## 已修复

- 订单、盖章、标书派生的创建人来自服务端认证用户，不信任请求体中的创建人。
- 新增仅 service_role 可调用的 `persist_quote_derivation_v1`，下游记录与派生留痕在同一事务内提交；失败时不会留下无留痕的单据。
- 事务内检查创建人组织归属、报价/版本绑定与金额漂移；保持既有分位舍入容差。
- 新迁移关闭已实测的 10 张合同服务表的匿名/普通角色访问，限制两项高权限 RPC；4 张新派生表默认拒绝匿名/普通角色直连。

## 验证

- 1925 项测试通过、5 项跳过；TypeScript、ESLint、生产构建通过。
- 本地 PGlite/PostgreSQL 引擎复现原始 23502 创建人为空错误。
- 三类派生成功写入创建人与留痕；错误创建人被拒绝；留痕失败回滚目标单据；金额并发漂移被拒绝。
- anon/authenticated 访问受控表和 RPC 均被拒绝；service_role 保留所需权限。
- 六个迁移组成单一事务包，后段失败能回滚前段结构和权限变更；重复执行后原测试单据和留痕仍保留。
- 原三张 RLS 已开启的表在生产目录查询中存在组织/所有者条件，不能把零行请求200误解成读到了业务数据。本次变更针对10张已证实未开启RLS的表及两项匿名高权限RPC。

本地引擎采用合成前置表，不替代托管 Supabase 的完整 schema、Auth、Storage、应用流程验收。

## 迁移包与运行记录

在仓库根目录执行 `node product-truth/product-code/scripts/prepare-wp10-release.mjs` 仅生成 SQL 与校验清单，不执行数据库操作。输出在当前 worktree 的 `codex-runtime/repair/production-candidate.sql`、`migration-manifest.json`。该包不自动改写 Supabase migration history，生产执行前必须核对并规划同事务登记六项版本，禁止 `db push` 全量重放。

生产只读核查确认：相关源表存在，service_role 拥有函数所需读取/行锁权限；生产迁移历史没有20260820以后的条目。托管隔离库仍需重新核实。

## 需要用户配合

原隔离项目 `price-v3-p0-g5-preview-20260717`（`vsfropnfsmnonkotywsx`）当前 INACTIVE。

1. 在 Supabase 打开该项目，选择 **Restore project / 恢复项目**。
2. 等状态变为 Active 后告知。只操作该隔离项目，不操作生产 `cyanlog-sales-v3`。
3. 若要求升级、付款或恢复按钮不可用，停止并反馈页面提示；不默认增加持续付费设施。

官方暂停/恢复说明：https://supabase.com/docs/guides/platform/free-project-pausing

## 后续顺序和生产批准边界

1. 隔离项目恢复后先比对 schema/migration/权限，再应用最小候选迁移；仅使用专用测试对象。
2. 完成报价创建、配置算价、核验审批、冻结、复制继承/重算、派生、导出与跨组织拒绝路径。先核实/修复其他阻断，再形成干净提交与精确 SHA 的 Preview 证据。
3. 保存生产结构、ACL、函数定义、版本历史和必要备份；核对存量产品线可以使用ONES默认值。提交最终SQL、SHA、影响和回滚方案供生产独立批准。
4. DDL包设置5秒锁超时、30秒语句超时。提交前失败自动整体回滚；提交后先回滚应用部署至先前精确SHA，保留新增结构与数据，不默认回开匿名高权限或删除新数据。权限恢复只能基于审批后的ACL快照逐项进行。
5. 批准后才执行生产数据库变更、按交付门禁发布同一提交，并在用户已有Chrome的sales.cyanlog.icu完成真实业务复验；最终确认main包含发布提交。

目前没有用本地验证替代 `clean_preview_green` 或 `production_released`，也没有将整个 WP10 标记为完成。

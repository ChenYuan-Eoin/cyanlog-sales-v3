# REQ-F003: Account (认证与权限)

---
## REQ 元数据
- **ID**: F003
- **名称**: Account (认证与权限)
- **模块**: Account
- **优先级**: P0
- **状态**: in_progress（WP92 组织目录整体同步与架构回读；代码与真实阶段验收分离）
- **来源**: Account.md (已归档)

---
## 2026-11-05 当前WP92组织目录整体合同（IN-20261105-004）

- IN-20261105-005纠正落地模型：复用飞书已采用的departments、users、user_organizations、user_departments及external_identities；来源读取不同，系统内人员及关系统一。禁止通过外部身份快照拼接合成人员行冒充本系统组织架构；users中的人员记录与login_enabled独立，未关联员工可以创建登录禁用、无角色的真实人员记录。
- 部门树、目录员工、主属/附属归属共同构成组织架构；一个入口、同一快照、一份差异、同一事务、完整回读。部门和员工不再作为两个独立交付批次。
- 复用已有整体目录计划、应用及回滚链，不另造部门同步服务。内部可以先处理父部门、子部门、人员及关系；任一步失败均回滚，不能留下半套组织架构。
- 来源ID、企业键和系统组织保持稳定，当次Provider响应验证企业；不因EA/corpId不同字符串误拒，也不未经验证认作同一企业。
- 纷享主属部门从PersonnelObj.main_department读取，vice_departments提供附属关系；不使用数据归属部门或数组顺序推定主属。
- 目录员工必须有稳定外部ID及主属/附属关系；未关联本系统账号是正常目录状态，应显示在所属部门。目录同步不自动开账号、静默绑定或授予角色。
- 不可变计划绑定组织、来源、连接版本、完整目录和本地基线；明确确认后应用，重复确认幂等，结构冲突、请求/分页失败、跨企业、过期或并发变化拒绝。
- 不以独立名册、导出对账或人为勾选范围为前置；不将历史scopeVerified改成虚假的true。未返回的历史记录保留，不能仅凭缺失静默删除或停用。
- 组织架构界面包含联动部门树与员工列表，展示主属/附属、来源、人员状态及账号待关联状态。企业信息及部门详细设置属于后续管理能力，当前不扩大到全部纷享功能。
- WP92统一验收整体同步及回读；WP53后置验收持续变更与恢复。SSO、登录、寄件、AI、下单及角色授权不进入本批，目录权威变化不得隐式开启身份权威或修改账号登录状态。
- 当前批准本地/隔离开发与迁移候选，尚未批准Production发布、迁移及数据写入。正式站真实整体同步与现有Chrome联动回读才是业务出口。
- 允许学习纷享组织架构设计，每次生产点击须明确事实、效果、必要性和替代路径；当前开发无需点击。

以下历史合同保留追溯；与本合同冲突的范围证明前置、账号匹配阻断和部门/人员拆批条款均不再生效。

## 2026-11-04 WP92 历史执行合同（由上述整体目录合同修订）

- 当前唯一 Active 为 `WP92`，目标是把外部单点登录与组织架构同步拆成可独立证明、独立启停、独立审计的能力链；目标状态仍是 `code_green`，不能把候选、迁移文件或测试通过表述为 Production 已接通。
- 架构判断按证据分级：当前核心主体、成员、部门、外部身份和邀请事实表仍可承载目标，差异主要在 Provider 协议、能力门禁和切换服务，因此本批采用局部演进；若分段/双权威、多登录档案、跨组织 `org_id` 泄漏、连续 Provider 迫使共享服务分支、现有原子切源合同不足或生产证据证明核心映射失效，则必须另行评估并执行带对账与回滚计划的迁移式重构。不得把“本批不重构”写成“永远不重构”。
- 系统内部只保留一份有效组织真相：部门、成员、角色、空间和业务关系以系统实体为准。`organization_sources` 是每个外部提供方唯一的一张运行时连接记录；提供方只在凭据 schema、连接验证协议、目录读取协议和登录协议上不同。
- 提供方差异由无状态能力适配器组成，不做按提供方分支的组织写入服务，也不用一个巨型 `ProviderAdapter` 把连接、目录、登录和授权绑成同一开关。连接数据面仍只有 `organization_sources`，通过不同能力注册表分别解析凭据、读取目录和执行企业登录：`OrganizationConnectionAdapter` 负责凭据 schema、加密前校验、企业连接验证和存储校验；`DirectoryAdapter` 负责分页、稳定外部主键、状态归一和目录范围结果；`EnterpriseLoginAdapter` 负责授权 URL、拒绝、code 交换、企业身份校验和稳定 subject 归一。提供方中立目录与身份服务只接收与连接记录一致的统一企业键，不直接比较提供方的原始字段。提供方中立目录服务负责范围证明后的快照、差异、原子应用与回滚。纷享实现三项能力，飞书当前只有连接和目录能力；WP94 仍需把纷享专用回调路由接入中性身份/会话服务并提供真实登录证据。
- 五项能力必须分别计算：连接凭据、目录可读范围、目录权威、企业登录协议、身份映射与业务授权。连接验证不代表全公司读取范围，目录主来源不代表身份权威，身份绑定不代表寄件许可。
- `ProviderCapability.capabilities` 分别声明 `credentialVerification`、`directoryPreview`、`directoryScopeProof`、`enterpriseLogin`，由连接、目录和登录三个注册表共同派生；UI、API 和调度只消费声明，不按提供方名称猜实现，未实现能力失败关闭。当前纷享和飞书的独立范围证明均为 false，不能因目录预览存在而放行切源；只有纷享存在登录适配器，飞书 `enterpriseLogin=false`。OAuth 回调只能从服务端连接记录和单次 state 解析系统组织，不接受浏览器自报 `org_id` 作为授权真相。
- 提供方线值（例如纷享状态 `0/1/2`）的语义归一必须留在提供方适配器；共享目录差异服务只消费 `active/inactive/deleted/unknown`，不得包含按 provider 名称分支的生命周期映射。
- 目录变更固定走 `范围证明 → 不可变快照 → 差异计划 → 显式确认 → 原子应用 → 回读验证 → 原子回滚`。快照必须带显式主属部门；纷享只从 `PersonnelObj.data_own_department` 的唯一值确定主属部门，`vice_departments` 只合并为附属关系，数组顺序不是主属关系证据。归属部门缺失、为空或出现多个值时整批阻断。范围证明缺失、结构不完整、映射冲突、计划过期、连接 revision 或来源状态变化时同样整批阻断。
- 企业 SSO 只验证提供方稳定 subject，并解析既有 `external_identities → users.id`；不得 JIT 创建成员、按姓名/手机号静默绑定、切换目录主来源或授予寄件权限。受限既有账号登录继续作为独立恢复入口。
- 外部身份映射锚定自然人 UUID，而不是可结束/重建的 `membership_id`；登录后再从服务端解析该自然人在目标组织的当前有效成员关系。邮箱、手机号、姓名只能作为候选匹配证据，邀请接受和管理员显式绑定是有审计的独立流程。
- 连接记录使用 `organization_sources.external_tenant_id` 作为统一企业键。提供方登录协议可能同时返回其他企业字段，适配器必须先在内部完成一致性校验，再返回该统一键；共享身份服务不得假定不同 Provider 的原始租户字段可以直接等值比较。
- 所有提供方的目录写入只能进入 `app/api/admin/organization-sources/directory` 的不可变计划、原子应用与回滚链路。历史 `/api/access/feishu/sync` 直写接口已停用并返回迁移提示，不得继续在失败时留下部分部门或成员写入。
- 当前正式数据只读证据为 73 个部门、405 位员工，结构关系自洽且无重复/悬空引用；该结果只证明当前员工的可读范围已分页完成，`scopeVerified=false`，因此目录切源仍被阻断，也没有形成组织同步或目录主来源切换。
- 纷享 SSO 必须命中 `status=active`、连接已验证且生效、`authority_scope.identity=authoritative` 的唯一身份权威来源；目录切源只建立目录与组织权威，不自动开启身份权威。当前身份映射、管理员/员工真实登录与寄件授权仍待独立证据。
- 管理界面分成两处语义：`组织架构`只展示有效的部门、成员、角色和空间；`外部系统接入`才配置连接、目录同步和企业 SSO。连接凭据、目录读取范围、目录主来源、企业 SSO、身份映射与寄件授权五种状态在同一面板中分行展示，禁止用“已接入”概括全部能力。
- 若后续要求首次目录同步即展示尚未绑定登录的人员，只能由 WP93 另行实现“目录待认领成员”：`login_enabled=false`、无角色、带来源与快照审计；不得让 WP92 差异预览或 WP94 OAuth 回调静默创建可登录账号。
- 本批只准备代码、迁移候选和本地证据。Production 迁移、来源启用/停用、目录写、切源、凭据搬运、人员/角色写入、发布、worker/白名单修改与顺丰调用均未授权。

## 2026-11-03 WP50 历史执行合同

- 当时唯一 Active 为 `WP50`，只完成共享组织连接配置的代码候选；该段保留历史边界，当前状态以上一节 WP92 合同为准。
- `organization_sources` 是唯一运行时连接真相。`organization_fxiaoke_connections` 只作为一次数据库迁移输入并转为只读；飞书、纷享、企微和钉钉的运行时配置都只能从统一连接页写入。应用不得从 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 等部署环境变量自动或经产品按钮导入凭据；旧部署变量如仍需处理，只能走单独的受控迁移脚本。
- 飞书、纷享、企微和钉钉共用连接归属、加密、版本、草稿/生效、验证、预览、状态、审计、晋升与回滚生命周期。当前只实现飞书和纷享的凭据 schema、验证和目录协议适配器；企微和钉钉显示未接入，不提供伪操作。
- 保存草稿和目录预览只更新草稿：不启用来源、不写组织骨架、不改主来源、不复活停用来源。新草稿验证失败时保留上一份生效配置；验证成功也必须经过 WP92 的差异预览和明确确认，才可晋升为生效连接并切换目录来源。
- 本批只准备代码和数据库迁移候选。Production 迁移、来源启用/停用、目录同步、主来源切换、凭据搬运、外部发布、人员/角色写入与顺丰调用均不在授权范围。WP92 继续作为 Next，必须等待 WP50 到达其定义出口后才能激活。

---
## 业务目标

建立自主可控的认证体系，支持多种身份源，并实现可配置的 RBAC 权限模型。

**关键原则**：
- `users.id` UUID 是唯一主体根；权限、审计和业务关系只引用 UUID
- 外部身份以 `external_identities` 稳定映射到 UUID；姓名和手机号只做展示与受限检索
- 纷享为主入口，企微/飞书辅入口统一服从同一主体映射，不建立权限孤岛
- IN-20261102-013 批准受限既有账号密码过渡入口，默认关闭且服从同一 UUID/成员/角色/会话；注册、改密、重置、环境变量 bootstrap 与管理员后门仍禁止。密码物理删除保持后置，本批不做。
- 部门树来源：纷享为主，飞书等旧来源保留过渡和停同步边界
- 权限可配置：当前组织根超管维护组织级权限覆盖；`roles.permissions` 保留为全局模板，不能由组织配置直接改写。

---
## 核心功能

### 1. 用户认证
- 纷享 OAuth 授权码登录，服务端校验一次性 state、企业 corpId 和稳定 subject
- 企微/飞书后续作为辅助 OIDC/授权码入口，不另建权限真相
- 企业 OAuth 只经 `external_identities → users.id`；受限既有账号只验证现有凭据解析到同一 `users.id`，不写入或绕过外部映射合同。
- Token 会话使用随机系统 token + PostgreSQL `auth_tokens`，可撤销、可过期
- 企业 OAuth 无稳定映射、映射冲突、停用、跨企业或零有效角色时拒绝；受限账号无唯一凭据候选、强制改密、无活动默认在职成员/有效组织或无角色时拒绝。

**登录方式优先级**：
| 方式 | 优先级 | 说明 |
|------|--------|------|
| 纷享 OAuth（PC 扫码/授权码） | P0 | 企业主入口，真实登录仍待验收 |
| 受限既有账号密码 | 过渡 | IN-20261102-013 已批准范围内实现；默认关闭，不注册/重置，不创建或合并主体 |
| 企微 OAuth | P1 | 后续辅助入口，共用主体和权限 |
| 飞书 OAuth | P1 | 后续辅助入口，共用主体和权限 |
| 一次性绑定码 | P1 | 仅用于受审计首次绑定，不产生长期密码 |

### 2. 角色权限 (RBAC)

**两层模型**：User → Role → Permission

**WP43 当前合同（2026-10-21，IN-20261021-013）**：

- 一个用户任务：组织根超管在配置中心编辑系统角色权限，保存后当前组织的授权检查使用新权限。
- 使用既有 `organizations.settings.role_permission_overrides[roleId] = string[]` 保存组织覆盖。覆盖存在时完整替换模板权限；空数组表示无权限，不能回退模板；其他组织继续使用各自覆盖或模板。
- 只有绑定当前组织的 `SUPER_ADMIN` 且仍有权限管理能力的用户可修改；普通管理员或只有 `config:write` 的用户不能修改角色授权。根账户身份保护与成员分配限制保持有效。
- 超管可收紧非核心业务权限，保留 `admin:access`、`config:read`、`config:write`、`role:manage` 四项核心权限，以便恢复配置。核心限制须在表单说明并由服务端校验。
- 取消细项时须消除覆盖该细项的 `*` 或资源通配符，并保留其他已授予能力；不得出现页面取消勾选后服务端仍放行的结果。
- 保存须保留其他组织设置，并以比较原 settings 的方式检测并发冲突；冲突返回 409，用户可刷新后继续编辑。
- Middleware、API 包装器、组织权限、合同/问答/寄件连接授权与工作台数据范围使用同一有效权限；覆盖后的角色名称不能重新补入已撤销能力。新请求须重新读取组织覆盖，不能由进程内缓存继续放行。
- 自定义角色创建、复制和命名留待后续批次。当前目标为 `code_green`，推送、PR、Production 发布和生产权限数据变更须另行授权；代码验证不能表达为线上已修复。

**内置角色**：
| 角色 | code | 默认权限 |
|------|------|----------|
| 超级管理员 | SUPER_ADMIN | *（所有权限） |
| 销售经理 | SALES_MANAGER | quote:*, contract:view, customer:* |
| 销售 | SALES | quote:create, quote:update_own, contract:view |
| 法务 | LEGAL | contract:*, quote:view, customer:view |
| 销售运营 | SALES_OPS | config:*, user:view, role:view, report:* |
| 财务 | FINANCE | quote:view, contract:view, payment:* |
| 只读用户 | READONLY | quote:view, contract:view, customer:view |

**权限 Key 清单（13个）**：
```
config:read / config:write
rule:write
contract:read / contract:write / contract:review
quote:read / quote:write
user:read / user:write
org:write
feishu:sync
admin:access
```

### 3. 飞书集成
- 飞书组织同步
- 用户映射与导入
- 仅限 SUPER_ADMIN 可操作

---
## 数据模型

```sql
-- 用户表（当前实现以迁移文件为准）
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  email VARCHAR(128),
  phone VARCHAR(32),
  employee_id VARCHAR(64),
  display_name VARCHAR(64) NOT NULL,
  status VARCHAR(16) DEFAULT 'active',
  login_enabled BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 认证 Token 表
CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(128) UNIQUE NOT NULL,
  user_id VARCHAR(8) REFERENCES users(uuid),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 稳定外部身份与手机号历史
CREATE TABLE external_identities (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL,
  system_org_id UUID NOT NULL,
  external_user_id TEXT NOT NULL,
  canonical_user_id UUID REFERENCES users(id),
  match_status TEXT NOT NULL,
  match_method TEXT NOT NULL
);

CREATE TABLE phone_history (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  phone TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  reason TEXT NOT NULL
);
```

---
## API 接口清单

### 认证接口
| 接口 | 方法 | 路径 | 权限 |
|------|------|------|------|
| 企业登录提供方读取 | GET | /api/auth/providers | - |
| 纷享 OAuth 开始 | GET | /api/auth/fxiaoke/start | - |
| 纷享 OAuth 回调 | GET | /api/auth/fxiaoke/callback | 一次性 state |
| 用户登出 | POST | /api/auth/logout | 需 token |
| 获取当前用户 | GET | /api/auth/me | 需 token |
| 成员激活 | POST | /api/auth/invitations/accept | 一次性激活码 |
| 受限既有账号登录 | POST | /api/auth/login | IN013 过渡入口，服务器开关默认关闭；已有唯一活跃成员/凭据/新鲜角色 |
| 注册、改密、重置与bootstrap | * | /api/auth/register 等退休入口 | 继续 404，不恢复 |

### 用户管理接口
| 接口 | 方法 | 路径 | 权限要求 |
|------|------|------|----------|
| 创建用户 | POST | /api/admin/users | user:create |
| 更新用户 | PUT | /api/admin/users/:id | user:update |
| 删除用户 | DELETE | /api/admin/users/:id | user:delete |
| 用户列表 | GET | /api/admin/users | user:list |

### 角色权限接口（WP43）
| 接口 | 方法 | 路径 | 权限要求 |
|------|------|------|----------|
| 获取角色列表 | GET | /api/roles | 当前组织配置读取或组织管理；返回组织有效权限和可编辑状态 |
| 更新角色权限 | PATCH | /api/roles/:id | 当前组织根超管和权限管理能力；只保存当前组织覆盖 |
| 分配用户角色 | POST | /api/admin/users/:id/roles | 既有成员管理和委派上限校验；根角色保护保持有效 |

---
## 当前实现证据与验收

以下内容以 2026-11-04 的 WP92 合同为准，旧注册、密码登录和飞书首次登录自动建号验收均已作废。

### 代码位置
- `lib/organization-connections/adapters/index.ts`：Provider 目录和能力注册表；未接入提供方也从同一目录派生，不在共享服务中写名称分支。
- `lib/organization-connections/adapters/feishu.ts`、`fxiaoke.ts`：各提供方的凭据 schema、连接验证、目录分页、状态和主属部门归一。
- `lib/organization-connections/adapters/enterprise-login/`：企业登录协议适配器；纷享已实现，其他提供方缺失时失败关闭。
- `lib/organization-connections/service.ts`：共享连接草稿、生效 revision、验证与生命周期；不实现提供方协议。
- `lib/organization-connections/directory-cutover.ts`：提供方中立的不可变差异、显式应用和回滚合同。
- `app/api/admin/organization-sources/directory/route.ts`：目录预览、应用与回滚的受信管理 API。
- `app/configs/tabs/OrganizationSourcePanel.tsx`：外部系统接入与五项能力状态界面。
- `lib/fxiaoke/identity.ts`、`app/api/auth/fxiaoke/callback/route.ts`：纷享稳定 subject 到既有系统成员的 fail-closed 映射。
- `app/api/access/feishu/sync/route.ts`：历史直写入口，现仅返回 `DIRECTORY_CUTOVER_REQUIRED`，不执行外部或数据库写入。

### 数据库事实
- `users`：自然主体根；`users.org_id` 只保留兼容默认组织，不再作为多租户身份真相。
- `user_organizations`：组织成员关系与雇佣状态。
- `departments`、`user_departments`：部门树与一个人的多部门关系。
- `organization_sources`：每个系统组织、每个提供方唯一的连接记录。
- `external_identities`：稳定外部 subject 到 `canonical_user_id` 的企业内映射。
- `personnel_employment_periods`、`personnel_invitations`：雇佣生命周期与既有成员邀请。
- `organization_directory_cutover_plans`、`organization_directory_cutover_runs`：不可变差异、原子应用和回滚证据。

### 当前验收
| # | 场景 | 通过条件 |
|---|------|----------|
| 1 | 连接验证 | 提供方凭据可认证到正确企业，保存后凭据不回传；目录权限失败不抹掉连接验证事实 |
| 2 | 目录范围 | 只有独立全公司范围证据才设置 `scopeVerified=true`；分页结束和树结构自洽不能代替范围证明 |
| 3 | 目录计划 | 快照不可变，差异绑定连接 revision、来源 revision、企业标识与过期时间 |
| 4 | 冲突熔断 | 任一身份冲突、范围不明、状态未知、父级缺失或重复映射都阻断整批应用 |
| 5 | 显式应用 | 管理员确认后单一事务更新目录、身份和成员部门；旧来源与手工数据保留 |
| 6 | 回滚 | 原子恢复本次操作前状态；后续目录或来源变化发生后拒绝旧回滚 |
| 7 | SSO 接线 | 只有 active、已验证、显式身份权威、稳定映射、有效成员和角色同时满足才登录 |
| 8 | 禁止 JIT | OAuth 回调不创建 `users`、成员、角色或寄件许可，不按姓名或未验证手机号静默绑定 |
| 9 | 登录恢复路径 | 受限既有账号登录独立受服务器开关、成员、角色、会话和限流约束 |
| 10 | 单一写入链 | 飞书与纷享目录写只能进入统一计划/应用/回滚服务，历史直写接口不再可用 |

当前没有 Production 目录切源、SSO 成功或成员授权完成证据；正式纷享数据 73 部门/405 员工只证明当前授权范围内分页读取。

---
## 交付状态

历史认证实现保留。WP43 角色配置修复正在执行，验证记录写入工作树独立的 `codex-runtime`；本合同不声称本次修复已发布或通过 Production 验收。


## 2026-10-27 统一组织来源与自助寄送（IN-20261027-007）

目标：在现有组织来源增加纷享自建应用 OAuth/OpenAPI 接入，以系统成员和权限作为自助寄送唯一授权依据；MCP/CLI 不是前置依赖。仅使用 cyanlog-sales-v3，临时验证在本地，不新增付费资源。正式顺丰下单仍由操作员确认。

| WP | 单一用户任务 | 状态 | 退出验收 |
|---|---|---|---|
| WP91 | 管理员配置纷享应用并预览通讯录 | production_released（限定范围） | 正式站保存加密凭据、刷新回读，真实应用读取权限范围内部门和员工；错误和空结果如实显示，不写入组织骨架 |
| WP92 | 确认同步并切换目录主来源 | executing | 先证明全公司读取范围，再预览差异并原子切换；唯一主来源，旧来源和手工数据保留；失败回滚，无按姓名合并 |
| WP93 | 在系统组织权限中管理寄件许可 | queued | 无独立寄件白名单；部门/成员/角色授权一致；撤权新请求立即拒绝；历史归属保留 |
| WP94 | 销售通过纷享登录并提报本人工单 | blocked_by_directory_scope | 目录范围和显式身份权威具备后，再做真实 A/B 登录、提交和查询隔离；工单待确认，不自动顺丰下单 |

WP91 用户填写字段：AppID、APPSecret、永久授权码、员工 ID，沿用纷享后台名称；企业账号 ea 和企业身份由服务端通过应用凭据获取、验证并保存，不要求管理员查找或填写。EncodingAESKey 不属于本批通讯录认证或员工 OAuth 登录必填项。服务端固定官方云地址，其他云经核验后扩展。配置不显示 MCP 或 CLI 字段。令牌、请求追踪由服务端处理。凭据必须按系统组织绑定，加密存储且不回传；预览不允许改变角色、部门、成员、历史工单或主来源。

WP76 暂缓，已发布候选与单聊证据保留，未完成的正式顺丰验收不关闭。代码、迁移候选和本地测试不能替代正式站验收。发布及生产迁移在具体候选可审查后另申请批准。当前治理 application profile 只用于 code_green 工程门禁；组织接入的发布验收合同需另准确配置，不冒用角色编辑验收声明。

## 2026-10-28 纷享接入与企业 SSO 统一调度（IN-20261028-003）

用户指令：把纷享销客接入与无法启用的企业 SSO 统一调度。该历史批次曾按旧顺序推进；截至 2026-11-04，当前以顶部 WP92 合同和 `active-task.json` 为准。WP 分批验收不等于整条接入链路已经可用；只有正式站真实员工完成登录、获授权提报和本人查询，且 A/B 与跨企业隔离通过，才能宣布纷享接入完成。

### 共用配置与身份合同

- 一个系统企业复用同一份纷享自建应用连接；目录读取和 SSO 从该连接读取 AppID、加密 APPSecret 与已验证企业身份，不新增要求用户重复录入的 SSO 密钥表单。
- 永久授权码和员工 ID 用于服务端目录读取；员工本人登录使用 OAuth 授权码回调取得身份。不得把用于读取通讯录的员工 ID 当作所有销售的登录身份。
- 服务端自动取得并核验企业账号 ea、企业标识。OAuth 返回的 corpId 必须与已验证企业一致，使用提供方、企业标识和员工稳定 ID 绑定系统成员；跨企业身份拒绝，禁止按姓名自动合并。稳定映射复用现有 `organization_sources` / `external_identities` 身份台账，不新建平行身份真相表。公开登录入口只解析唯一已配置组织，不接受浏览器传入的组织 ID。
- 回调地址由系统生成并提供复制及明确的纷享后台填写路径，不要求用户推导地址。授权跳转、随机 state、回调校验、一次性 code 和系统会话归属由后端负责。
- 组织来源、登录开通和寄件许可分别显示真实状态。应用已保存或通讯录已读取不能自动显示“SSO 已开通”；登录成功也不能自动授予寄件权限。
- 未实现或未配置的登录方式不显示可操作的占位按钮，不再提示用户联系管理员去寻找不存在的开通开关。启用后的“使用纷享销客登录”必须进入真实授权流程。

### 批次依赖与共同验收

| 顺序 | 批次 | 本批交付给用户的结果 | 进入下一批的证据 |
|---|---|---|---|
| 1 | WP91（前置已完成） | 管理员只填真实必要字段，系统自动识别企业，保存回读并预览通讯录 | 正式站配置保存、企业核验和真实目录读取成功；失败保留输入并给出可定位原因 |
| 1A | WP50（前置已完成 · code_green） | 飞书与纷享在同一组织来源页使用共享连接草稿、验证和状态模型；连接、目录范围、目录权威、企业登录与身份映射分别展示 | 本地代码与迁移候选通过门禁；不启用来源、不同步、不切主来源、不发布 |
| 2 | WP92 | 将已预览的纷享员工对应到系统组织，确认主来源切换 | 稳定 ID 对应、旧来源与手工数据保留、失败恢复；不凭姓名合并 |
| 3 | WP93 | 用现有系统成员、部门、角色控制寄件许可 | 撤权后下一次请求拒绝；历史工单归属保留；登录身份不能绕过许可 |
| 4 | WP94 | 管理员在同一纷享接入处开通登录，销售用真实 SSO 登录并提报本人寄件需求 | A/B 账号各自授权、登录、提报、查询；直链与 API 重放拒绝越权；跨企业身份拒绝 |

WP94 的 SSO 入口缺陷 IN-20261028-002 与登录能力一并交付；不是另一个孤立的认证项目。当前 WP92 只关闭提供方中立的目录差异、显式切源和回滚代码候选，不越界实现后续批次，也不因本表更新改变代码或 Production 的实际交付状态。预览登录服务故障不得转嫁成用户必须反复尝试；只使用 cyanlog-sales-v3，临时验证在本地，不能新增数据库来满足验收。正式顺丰下单仍由操作员确认。

协议依据：[纷享授权码模式](https://developer.fxiaoke.com/openapi_v2/start/auth/auth-code.html)、[客户端凭证模式](https://developer.fxiaoke.com/openapi_v2/start/auth/app-info.html)。应用身份授权与员工本人授权是不同流程；共用应用连接不表示共用用户令牌。


## 2026-10-28 业务结果合同与全队列顺序

IN-20261029-004：当前产品结果是员工以真实身份获得同一套组织/寄件许可，完成本人提报和查询，并被跨人/跨企业隔离保护。全仓执行顺序以 `main-chain-governance-charter.md` 为准；截至 2026-11-04，WP52 已按逐票时效范围关闭，WP50 已达到其 `code_green` 出口，当前 Active 为 WP92，Next 为 WP93；WP94 保留既有登录候选，但必须在目录范围证明、身份权威和稳定映射具备独立证据后再联合复验。代码、Preview、main 和部署状态均不得替代正式站真实登录验收。

WP91已部署范围的保存/回读/真实目录预览已有73部门405员工证据；该数字仅代表当前员工可读范围，不证明全公司权限、组织已同步或SSO已接通。发布27b53ea6已完成权威域名核验、现有Chrome重放及production_released门禁。目录读取员工ID不是销售本人身份，CRM审批申请员工也须以组织内稳定映射验证，不能按姓名授权。

WP92：切换前展示新增/保留/冲突/停同步清单；旧飞书组织保留且停同步，手工部门/人员不删除；失败原子回滚。WP93：禁用/离职/撤权后下一次寄件请求拒绝，历史工单归属不变。WP94：真实A/B账号各自登录/提报/查询，直链和重放拒绝越权。仅保存应用凭据不能关闭上述结果。

## 2026-10-29 身份安全与权限拓扑收口（IN-20261029-010/011）

- provider 返回手机号不宣称独立验证，也不允许触发静默 JIT 绑定。无 `external_identities` 稳定映射时，WP94 企业 OAuth 登录 fail-closed。
- 首次绑定后续采用管理员预绑定或一次性绑定码等强 step-up；短信验证码如需接入，单独评估供应商、费用和隐私，不作为默认依赖。
- `external_identities` 同时约束稳定 subject 和 canonical `users.id`；已有主体被另一个 subject 占用时拒绝并转人工。
- `phone_history` 使用 PostgreSQL 排他约束禁止同一组织内手机号时间区间重叠；历史业务只按当时 `user_id` 追溯。
- 超级管理员与其他成员共用 `external_identities → users.id` 链路，不按 `employee_number`、姓名或手机号做特殊匹配。
- 原本地密码物理删除目标由 IN-20261102-013 延后：保留批准的受限既有账号过渡入口，注册/改密/重置/bootstrap仍退休；退出过渡方案、真实替代登录、恢复证据和独立写入授权满足后才评估前进删除，本批不执行。
- 零租户系统 bootstrap、企业创建人 Owner、默认 `employee` 角色、平台/租户角色拆分、权限子集委托和拒绝审计归 WP82。
- 完整目标设计见 `governance/runtime-state/identity-authorization-blueprint.md`；当前 F003 只承载 WP94 可执行合同。
- 2026-10-29 生产只读历史快照：`cyanlog-sales-v3` 当时有 43 个用户、31 个活跃用户、5 个组织超管、1 条纷享连接，但 `organization_sources=0`、`external_identities=0`，`phone_history` 与 OAuth state 表尚不存在。删除密码迁移当前必须保持阻断。
- WP94 增加受审计的超级管理员预绑定：只允许当前组织 SUPER_ADMIN 选择现有活跃成员，输入纷享 `openUserId`；服务端自动读取并校验企业 `corpId`，原子写入 `organization_sources` 与 `external_identities`，记录 `bind_external_identity` 生命周期事件，不按手机号或姓名猜测。

## 2026-10-30 重复账号统一合并规则（IN-20261030-003/004）

所有后续重复账号沿用同一条主账号优先规则，不为单个账号写一次性例外：

- 主账号由系统配置的权威身份绑定源决定：`organization_sources.status='active'` 且 `authority_scope.identity='authoritative'`，权威来源的稳定 subject 已映射到哪个 `users.id`，哪个账号就是该自然人的主账号。`SUPER_ADMIN`、`ADMIN` 等权限角色只约束“谁可以执行合并”，不定义主账号；`系统超管` 一类展示名称也不能定义身份。
- 权威来源尚未形成一对一稳定映射、或同一自然人存在多个互相冲突的权威映射时必须失败关闭。业务引用数量、历史责任数量和当前角色数量只能用于评估合并影响，不能反向选择主账号。
- 合并时保留主账号 UUID、资料、会话和已存在的稳定外部映射，合并来源账号仍独立存在的部门、角色；来源账号的其他受外键保护业务引用迁移到主账号。
- 同一外部来源在主、来源账号均已有 `matched` 映射时拒绝合并转人工，不覆盖任一 `openUserId`。
- 来源账号的会话直接撤销，不迁移到主账号；来源账号手机号、员工号等可变标识清空，以防止新唯一约束和历史归属冲突。
- 来源用户行、来源组织关系、历史生命周期事件和停用原因永久保留，并记录 `merge_duplicate_identity_primary` 与 `merge_duplicate_identity_source` 审计事件。
- 当前 `系统超管` 与 `PANG 源` 的真主账号归属，以纷享权威绑定源的显式稳定映射为准；映射确认前不执行合并。E2E 测试管理员不在本规则本次执行范围内。
- RBAC/权限角色（`roles`、`user_roles`）回答“能否操作平台能力”。未来的“系统角色”若指业务对象“系统”上的责任人/参与者角色，则属于独立业务域对象，必须使用独立实体与授权合同，不得塞进 RBAC `roles.code`、`user_roles` 或权限点；该业务角色模型不在 WP94 实现。


## 2026-11-02 受限既有账号过渡入口（IN-20261102-013）

用户明确选择“恢复受限账号登录（推荐）”。该决定属于 WP94 登录候选范围，不扩展为注册、找回、重置或账号迁移项目；它在统一接入与双入口复验阶段关闭。长期统一主体、企业身份和组织权限方向不变。该段不再代表 2026-11-03 的 Active/Next，当前调度以本文顶部 WP50 合同和 `active-task.json` 为准。

- 账号入口只验证唯一既有邮箱或手机号候选及已有有效 bcrypt 凭据；歧义、空 hash、强制改密、非 active/login_enabled 均拒绝。当前 email 只在 org 内唯一且 phone 无唯一索引；不能用 OR/LIMIT 1 猜测命中者，不新增租户选择或自动关联。
- 要求唯一默认成员关系、成员和在职均 active、组织有效及当前组织有新鲜角色；主体、权限、审计和业务仍使用同一 `users.id`，复用 `issueSystemSession` 和可撤销 `auth_tokens`，不给默认角色或额外寄件权限。
- 服务器开关默认关闭，提供方读取与账号 API 使用同一开关；纷享配置故障不隐藏已启用的账号能力。表单只展示已有账号登录和原纷享入口，不增加注册、重置、改密或 bootstrap。
- 共享 `login_attempts` 先持久预留再检查账号/IP窗口，邮箱/手机别名按 UUID 共用限额；存储失败关闭。Origin、JSON、实际 body 字节、密码 UTF-8 截断、可信部署 IP 均有边界；不记录密码/hash。
- bcrypt 后及会话签发前后重新校验凭据/强制改密与活动成员/组织；变化、成功审计或签发失败时清理新会话，不交付 token/cookie。无跨请求原子事务的路径不得宣称数据库不可达时撤销已获机器证明。
- 唯一库只读元数据已确认所需 users、user_organizations、login_attempts、auth_tokens 列和索引存在，服务端权限可用；没有读取任何账号或 hash 值，没有调用登录 RPC，没有 DDL。现有 schema 足以实现，本批不新增迁移或恢复已删除凭据。
- 密码列、旧 RPC 和过渡入口的物理删除保持后置，须退出过渡入口、替代登录/恢复证据和独立写入授权满足；本批不执行删除。注册/改密/重置/bootstrap/影子管理员始终禁止。

本轮现状：旧固定出口发布 `e59c9b57fcb210a221a40e4abfb2139ce91a6b50` 的 Production deployment `dpl_Che3JojBLgyASD3A7WS6krFurPV9` 已 READY，sales 域名精确指向。用户现有 Chrome 到 `employee_profile` 阶段返回 `SSO_IDENTITY_REJECTED` 403；缺数组、零条、多条等具体原因仍待分类，active 来源/映射计数不能证明当前 OAuth 身份就是该映射，不归咎用户。沿 IN007 原胶囊定位，真实 SSO 未通过，不能宣称 `production_released`。证据见 `codex-runtime/wp94-queue-review-20261102/production-oauth-replay-e59.json` 及 `oauth-identity-rejected-dom.txt/.png`。

IN013 是产品方向与范围内实现批准。IN010 的最终发布批准只绑定旧 e5 产品树及其治理记录，不能授权本次受限入口、依赖锁或开关启用的新产品树；新候选发布保持 pending，候选可审查后再绑定相应批准。既有精确 SHA、部署/域名、现有 Chrome 与企业 OAuth/拒绝路径门禁保留；现有纷享 SSO verifier 不自动证明账号入口，账号登录/拒绝及同 UUID/组织/角色还需独立真实证据，不修改旧验证器来假通过。其他 API 的在职/组织停用即时授权收口仍属对应责任 WP。

门禁冲突明确保留：旧纷享 SSO verifier 仍把 `/api/auth/login` 返回 404 作为原密码入口退休断言，与 IN013 启用受限既有账号时该路径可登录的当前合同不一致。本轮不修改该验证器或伪造通过；本候选只承载受限入口与安全诊断的独立验收，不能代表 WP94 最终闭环。密码物理删除和长期门禁须在过渡退出决策后另行对齐。

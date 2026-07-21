# WP03 · R001–R015 业务确认候选表

> 状态：**仅供一次性业务确认，不是已发布产品真相，也不是法律意见。**
>
> 证据范围：2026-07-21 只读核对隔离 Supabase Preview `vsfropnfsmnonkotywsx` 的 `contract_rules_v2` 旧投影，并对照 F009 与当前 `rule_contract v1` 类型/运算符。未修改数据库。
>
> 关键边界：旧 Level A/B/C、`semantic_prompt`、`target_field`、关键词和旧消息模板只能帮助还原原意；它们未经过业务确认，不能自动转换或发布。下列“推荐”均是待确认方案。

## 1. 建议一次确认的公共口径

为避免逐字段反复确认，建议先一次性确认以下公共口径，再只处理每条规则列出的差异：

1. `missing_evidence_outcome` 默认采用 `manual_review`；只有缺失本身就是明确不可接受事实，且业务负责人书面确认时才使用 `block`。
2. 处理结果固定为四类：`pass`（无需动作）、`negotiate`（生成谈判建议与批注意图）、`block`（阻止无条件交付并升级审批）、`manual_review`（证据不足/冲突/规则未覆盖）。
3. 金额统一存数值与币种；比例统一用 `%`；时限必须区分自然日/工作日，当前 `duration/day` 本身不能表达二者，建议增加 `day_basis` 枚举属性。
4. “未提及”不等于布尔值 `false`。AI 运行时只能返回 `read / missing / ambiguous / unit_conflict` 及连续原文证据，服务端依据已确认条件确定结果。
5. 多个相互独立且可能产生不同结果的判断，应拆成多条具体规则；不能为了保留 R001–R015 的旧编号而制造一个不可解释的复合规则。

## 2. 候选汇总

| 编码 | 旧名称 | 推荐问题分类 | 建议形态 | 主要未决风险 |
|---|---|---|---|---|
| R001 | 付款节奏 | 付款与结算 | 多属性单规则 | 30/60/10、15% 与 30 工作日是否仍是正式口径 |
| R002 | 终止退款 | 终止与退出 | 枚举 + 布尔 | “全额退款”和“计息”是否分别即构成阻断 |
| R003 | 税率 | 税务与开票 | 多属性条件规则 | 税率受业务类型与法规变化影响，须财税确认 |
| R004 | 默示验收期 | 验收与交付 | 时限 + 布尔 | 16–30 工作日旧规则没有定义 |
| R005 | 验收不通过 | 验收与交付 | 多属性条件规则 | “直接解除+全额退款”是 AND 还是任一即阻断 |
| R006 | 违约金 | 违约与赔偿 | 建议拆 3 条 | 乙方上限、双方日比例、累加责任混在一条中 |
| R007 | 间接损失 | 责任限制 | 条款状态枚举 | “未提及”应谈判，而不是当作证据缺失直接结束 |
| R008 | 责任总额上限 Cap | 责任限制 | 比例 + 布尔 | 比例计算基数和例外事项尚未定义 |
| R009 | 保密期 | 保密 | 时限 + 布尔 | 旧字段把 `>10 年`当红线，旧文案只说“永久” |
| R010 | 主体·收款·金额 | 商务完整性 | **建议拆 5 条以上** | 多个事实源、不同责任人和不同阻断强度不可共用一个结果 |
| R011 | IP 归属 | 知识产权 | 多枚举/布尔 | 既有产品、定制成果、源代码和转授权边界未分别定义 |
| R012 | 数据安全 | 数据安全与隐私 | 多属性条件规则 | DPA、跨境和 AI 训练授权涉及法务与地域条件 |
| R013 | SLA | 服务等级 | 多属性条件规则 | 部署形态、可用性、支持时段和赔偿基数应分开判断 |
| R014 | 续约 | 合同期限与续约 | 枚举 + 时限 + 比例 | 永久锁价与单个续期周期固定价必须区分 |
| R015 | 争议解决 | 法律适用与争议 | 枚举 + 文本 | “一线城市”不是稳定枚举，且法律口径须法务确认 |

## 3. 逐条候选

### R001 · 付款节奏

- **旧数据（未确认）**：首期至少 30%、偏离区间 15%–29%；首期低于 15%、100% 验收后才付首款或尾款账期超过 30 个工作日为红线；偏好三段式 30/60/10。
- **可复用事实**：旧记录明确要求读取付款节点、首期比例、验收条件和账期；这些是可验证的合同事实，而不是配置期 Prompt。
- **推荐分类**：付款与结算。
- **建议属性**：
  - `first_payment_rate`: `percentage / percent / required=true`
  - `all_first_payment_after_acceptance`: `boolean / required=true`
  - `final_payment_term`: `duration / day / required=true`
  - `final_payment_day_basis`: `enum / {working_day, calendar_day} / required=true`
  - `payment_schedule_pattern`: `enum / {30_60_10, other} / required=false`
- **建议确定性判断**：优先 `block`：首期 `<15`，或全部首款在验收后，或工作日账期 `>30`；其次 `pass`：首期 `>=30`、非全部验收后、账期 `<=30`；其余 `negotiate`。30/60/10 只作为推荐模板，不应在未确认前成为唯一通过条件。
- **缺证据**：`manual_review`。
- **处理动作**：谈判时建议提高首期、前置至少一笔付款并缩短账期；阻断时升级商务负责人，不自动改写金额。
- **最少业务确认**：确认 15%、30%、30 工作日与“100% 验收后付首款”四个口径是否全部仍有效；确认 30/60/10 是偏好还是强制通过条件。
- **风险**：旧规则没有定义自然日换算、分币种/分产品例外，也没有覆盖多套付款方案并存时的取值口径。

### R002 · 终止退款

- **旧数据（未确认）**：不退款为可接受；仅退未消耗款且不计息为可谈判；全额退款或计息为红线。
- **可复用事实**：退款范围、已履行/未消耗金额、是否计息可从条款和计算附件读取。
- **推荐分类**：终止与退出。
- **建议属性**：
  - `refund_scope`: `enum / {none, unused_amount_only, full_amount, other} / required=true`
  - `refund_interest_required`: `boolean / required=true`
  - `performed_amount_deducted`: `boolean / required=true`
- **建议确定性判断**：`full_amount` 或 `refund_interest_required=true` → `block`；`none` → `pass`；`unused_amount_only + 不计息 + 已履行金额扣除` → `negotiate`；其他组合 → `manual_review`。
- **缺证据**：`manual_review`。
- **处理动作**：将退款限定为未消耗部分、不计息并保留已履行部分；阻断时要求财务/法务审批。
- **最少业务确认**：确认“全额退款”和“计息”是否任一单独出现即阻断；确认不退款是否对所有合同类型均适用。
- **风险**：退款权可能受违约主体、终止原因、法律强制规定影响，不能只看退款文字。

### R003 · 税率

- **旧数据（未确认）**：软件买断/私有部署授权 13%，SaaS/订阅/服务/维保 6%，混合业务分项开票；错套、统一或未写税率为红线。
- **可复用事实**：交付物类型、税率、含税/未税金额、发票类型和是否分项均可读取并交叉核对。
- **推荐分类**：税务与开票。
- **建议属性**：
  - `delivery_tax_category`: `enum / {software_license, private_deployment_license, saas_subscription, service, maintenance, mixed, other} / required=true`
  - `tax_rate`: `percentage / percent / required=true`
  - `itemization_state`: `enum / {itemized, not_itemized, not_applicable} / required=true`
  - `tax_inclusive_amount_consistent`: `boolean / required=true`
- **建议确定性判断**：财税确认映射后，业务类型与税率匹配且混合业务分项 → `pass`；明确错套/未写/混合不分项 → 推荐 `block`；无法确定交付性质 → `manual_review`。不建议用一个静态税率条件覆盖所有业务类型。
- **缺证据**：在财税确认前一律 `manual_review`；确认后可决定“未写税率”是否 `block`。
- **处理动作**：要求按交付性质分项列税率、金额和开票类型；触发阻断时交财税复核。
- **最少业务确认**：由财税确认 13%/6% 映射、适用地域/纳税主体和生效日期；确认“统一税率”是否无例外阻断。
- **风险**：税法和业务形态会变化；旧来源不是可持续的法规依据，规则必须有口径所有人和复核日期。

### R004 · 默示验收期

- **旧数据（未确认）**：5 工作日含默示为偏好，可至 7–10 日；15 工作日且保留默示可谈判；超过 30 工作日或取消默示为红线。
- **可复用事实**：验收起算点、期限、日历口径、逾期未反馈效果均能从原文读取。
- **推荐分类**：验收与交付。
- **建议属性**：
  - `acceptance_period`: `duration / day / required=true`
  - `acceptance_day_basis`: `enum / {working_day, calendar_day} / required=true`
  - `deemed_acceptance_enabled`: `boolean / required=true`
- **建议确定性判断**：取消默示或工作日 `>30` → `block`；保留默示且 `<=10` → `pass`；保留默示且 `>10 && <=15` → `negotiate`；16–30 日 → 暂定 `manual_review`，不能根据旧字段猜测。
- **缺证据**：`manual_review`。
- **处理动作**：建议缩短期限并写明逾期视为通过；阻断时要求业务负责人审批。
- **最少业务确认**：确认 16–30 工作日的结果；确认 5 日与 7–10 日只是偏好还是不同风险档；确认自然日如何换算。
- **风险**：旧 `duration/day` 未表达工作日，直接发布会产生确定但错误的计算。

### R005 · 验收不通过

- **旧数据（未确认）**：整改重交为可接受；两次整改后可解除、损失限直接损失为可谈判；直接解除并全额退款，或承担一切/间接损失为红线。
- **可复用事实**：整改机会、整改次数、解除前提、退款范围和损失类型可分别读取。
- **推荐分类**：验收与交付。
- **建议属性**：
  - `cure_opportunity_provided`: `boolean / required=true`
  - `cure_attempts`: `number / count / required=true`
  - `immediate_termination_on_failure`: `boolean / required=true`
  - `full_refund_on_failure`: `boolean / required=true`
  - `indirect_or_all_loss_liability`: `boolean / required=true`
- **建议确定性判断**：承担间接/一切损失 → `block`；“直接解除 + 全额退款”按用户确认的 AND/OR 逻辑判定；整改重交且不立即解除 → `pass`；至少两次整改后才解除且仅直接损失 → `negotiate`。
- **缺证据**：`manual_review`。
- **处理动作**：补充整改次数和期限，限制退款与赔偿范围；红线升级法务。
- **最少业务确认**：确认“直接解除+全额退款”必须同时出现才阻断，还是任一出现即阻断；确认一次或两次整改的最低要求。
- **风险**：旧自然语言把多个条件写在一个短语中，未经确认直接转 `any/all` 会改变业务结果。

### R006 · 违约金

- **旧数据（未确认）**：乙方责任上限优选 10%、原则上可谈至 50%、50%–100% 高风险、超过 100% 红线；乙方日违约金优选万分之五、最高千分之三；甲方日违约金旧口径为千分之三，低于万分之五视为红线；违约金与实损累加为红线。
- **可复用事实**：责任主体、计算基数、日比例、累计上限、是否与实损累加均是独立可读事实。
- **推荐分类**：违约与赔偿。
- **建议形态**：拆为 `R006A 乙方累计责任上限`、`R006B 双方日违约金`、`R006C 违约金与实损是否累加`，避免一条规则输出互相覆盖。
- **建议属性**：
  - A：`supplier_liability_cap_rate`: `percentage / percent / required=true`；`cap_basis`: `enum / required=true`
  - B：`supplier_daily_penalty_rate`、`customer_daily_penalty_rate`: `percentage / percent / required=true`
  - C：`penalty_and_actual_loss_cumulative`: `boolean / required=true`
- **建议确定性判断**：A：`<=10` pass，`>10 && <=50` negotiate，`>50 && <=100` negotiate + 高风险说明，`>100` block；B：乙方 `>0.3%/日` 或甲方 `<0.05%/日` 暂按 block，其余按旧区间 pass/negotiate；C：累加=true → block。
- **缺证据**：各子规则 `manual_review`。
- **处理动作**：分别调整上限、日比例和累加条款；阻断项需要责任审批，不用一个总消息覆盖全部原因。
- **最少业务确认**：确认拆分；确认 50%–100% 是 `negotiate` 还是 `block`；确认双方日比例阈值及计算基数；确认责任例外是否可突破 Cap。
- **风险**：不同主体、不同基数和责任例外可能使相同比例产生不同结果；当前单规则无法表达审批差异。

### R007 · 间接损失

- **旧数据（未确认）**：明确排除间接损失、可得利益、商誉和惩罚性赔偿为可接受；未提及则建议谈判；明确承担上述损失或“一切损失”为红线。
- **可复用事实**：条款是否明确排除、保持沉默或明确承担，可以作为一个受控枚举事实读取。
- **推荐分类**：责任限制。
- **建议属性**：
  - `indirect_loss_clause_state`: `enum / {explicitly_excluded, silent, explicitly_assumed, all_losses_assumed, ambiguous} / required=true`
  - 可选审计属性：`excluded_loss_types`: `enum[]` 当前 v1 不支持数组，建议暂拆四个 boolean 或保留为证据说明，不扩张协议。
- **建议确定性判断**：`explicitly_excluded` → `pass`；`silent` → `negotiate`；`explicitly_assumed/all_losses_assumed` → `block`；`ambiguous` → `manual_review`。
- **缺证据**：`manual_review`；注意“合同未提及”应读取为 `silent`，不是技术上的 missing。
- **处理动作**：补入对等的间接/可得利益/商誉/惩罚性损失排除条款。
- **最少业务确认**：确认只要明确承担任一类间接损失即阻断，还是只有“一切损失/惩罚性赔偿”阻断。
- **风险**：布尔关键词容易把“不得承担间接损失”误读成“承担”；必须依赖连续原文和受控状态，而不是命中词。

### R008 · 责任总额上限 Cap

- **旧数据（未确认）**：双方对等且上限不超过 50% 为可接受；50%–100% 可谈；超过 100%、无 Cap 或仅单向约束乙方为红线。
- **可复用事实**：是否有上限、上限比例、计算基数、是否双方对等、例外事项可分别读取。
- **推荐分类**：责任限制。
- **建议属性**：
  - `cap_present`: `boolean / required=true`
  - `liability_cap_rate`: `percentage / percent / required=false`（无 Cap 时没有合法数值；有 Cap 却未读到比例时应落入人工复核）
  - `cap_reciprocal`: `boolean / required=true`
  - `cap_basis`: `enum / {contract_total, fees_paid, annual_fees, affected_order, other} / required=true`
- **建议确定性判断**：无 Cap、非对等或 `>100` → `block`；对等且 `<=50` → `pass`；对等且 `>50 && <=100` → `negotiate`；未知基数/例外 → `manual_review`。
- **缺证据**：`manual_review`。
- **处理动作**：补充双方累计上限、明确基数和例外；红线升级审批。
- **最少业务确认**：确认 Cap 比例的分母；确认知识产权、保密、数据安全等例外是否允许突破总上限。
- **风险**：只读取百分比而不读取分母会得到不可审计的假精确结果。

### R009 · 保密期

- **旧数据（未确认）**：双方 5 年为偏好，3–7 年可接受，10 年双向可谈；单向或对非商业秘密永久保密为红线。旧结构化字段另把 `>10 年`映射为红线，与文案并不完全一致。
- **可复用事实**：义务是否双向、一般信息期限、商业秘密是否单独约定永久、法定例外均可读取。
- **推荐分类**：保密。
- **建议属性**：
  - `general_confidentiality_term`: `duration / year / required=true`
  - `confidentiality_reciprocal`: `boolean / required=true`
  - `general_information_perpetual`: `boolean / required=true`
  - `trade_secret_survives_while_secret`: `boolean / required=false`
- **建议确定性判断**：单向或一般信息永久 → `block`；双向且 3–7 年 → `pass`；双向 `>7 && <=10` → `negotiate`；`>10` 暂 `manual_review`，直到确认旧字段与文案冲突。
- **缺证据**：`manual_review`。
- **处理动作**：改为双方对等、一般信息明确期限、商业秘密依法存续。
- **最少业务确认**：确认 `>10 年但非永久`是否阻断；确认低于 3 年的结果；确认商业秘密永久义务的准确表达。
- **风险**：旧数值字段和旧业务文案冲突，自动迁移会制造错误红线。

### R010 · 主体·收款·金额

- **旧数据（未确认）**：合同主体、账户、签字、日期正确，且数字金额=大写金额=附件=报价单为可接受；旧模板可谈；主体错误、外部账户、金额/税额不一致或日期逻辑错误为红线。
- **可复用事实**：这些检查都可审计，但来源不同：正文、营业执照、账户证明、报价单、附件、签署记录。
- **推荐分类**：商务完整性。
- **建议形态**：至少拆为 `R010A 签约主体一致性`、`R010B 收款账户授权`、`R010C 金额及税额一致性`、`R010D 附件/报价单一致性`、`R010E 签署日期逻辑`；“旧模板”作为模板版本提示，不与五条红线共用规则。
- **建议属性**：
  - A `legal_entity_consistent`: `boolean / required=true`
  - B `payment_account_authorized`: `boolean / required=true`
  - C `numeric_and_uppercase_amount_match`、`tax_amount_consistent`: `boolean / required=true`
  - D `quotation_and_attachment_match`: `boolean / required=true`
  - E `signature_date_sequence_valid`: `boolean / required=true`
  - 模板 `template_version_state`: `enum / {current, legacy, unknown} / required=false`
- **建议确定性判断**：A–E 任一明确 false 按各自规则决定 block；全部 true 各自 pass；旧模板 → negotiate；外部证据未上传/无法核验 → manual_review，不得把“没有附件”当作“不一致”。
- **缺证据**：推荐全部 `manual_review`，除非业务确认某一必备附件缺失本身即 block。
- **处理动作**：精确指出不一致对象和来源，分别要求主体、财务、销售或签署负责人修正。
- **最少业务确认**：确认拆分；确认五项中哪些明确 false 必须 block、哪些仅 negotiate；定义“外部账户”和可信账户主数据来源。
- **风险**：若仍保留一条复合规则，任何一个小问题都会生成模糊总风险，无法定位责任、复审或关闭。

### R011 · IP 归属

- **旧数据（未确认）**：ONES 保留产品 IP、客户取得使用许可为可接受；定制/二次开发成果归属让步需调价；客户主张产品 IP、要求源代码或取得二次销售/转让权为红线。
- **可复用事实**：既有 IP、定制成果、许可范围、源代码交付、转授权/转售是不同事实。
- **推荐分类**：知识产权。
- **建议属性**：
  - `background_ip_owner`: `enum / {supplier, customer, respective_owner, shared, unclear} / required=true`
  - `customer_license_scope`: `enum / {contract_use_only, transferable, sublicensable, resale, ownership} / required=true`
  - `source_code_delivery_required`: `boolean / required=true`
  - `custom_development_ip_owner`: `enum / {supplier, customer, shared, separately_agreed, not_applicable} / required=true`
- **建议确定性判断**：产品/既有 IP 转给客户、要求源代码、允许转售 → `block`；客户仅合同范围使用且供应商保留既有 IP → `pass`；定制成果让步/共享 → `negotiate`；边界不清 → `manual_review`。
- **缺证据**：`manual_review`。
- **处理动作**：区分背景 IP 与定制成果，限制许可和转授权，定制成果让步绑定价格与范围审批。
- **最少业务确认**：确认源代码交付是否无例外阻断；确认二次开发成果可接受的四种归属及对应审批。
- **风险**：不区分背景 IP 与项目成果会把合理的定制成果安排误判为产品 IP 转让。

### R012 · 数据安全

- **旧数据（未确认）**：客户数据归客户、ONES 受限处理为可接受；加密、本地化、立即删除可谈；未经授权用于 AI 训练为红线；境外主体/跨境处理个人信息且无 DPA 为红线，境内客户不因缺 DPA 单列风险。
- **可复用事实**：数据所有者、处理目的、AI 训练授权、个人信息、存储/处理地点、跨境、DPA、删除要求可分别读取。
- **推荐分类**：数据安全与隐私。
- **建议属性**：
  - `customer_data_owner`: `enum / {customer, supplier, shared, unclear} / required=true`
  - `processing_scope_limited_to_contract`: `boolean / required=true`
  - `ai_training_use`: `boolean / required=true`
  - `ai_training_authorization_state`: `enum / {authorized, not_authorized, not_applicable, unclear} / required=true`
  - `personal_data_in_scope`: `boolean / required=true`
  - `cross_border_processing`: `boolean / required=true`
  - `counterparty_location`: `enum / {mainland_china, overseas, unknown} / required=true`
  - `dpa_state`: `enum / {present, absent, not_applicable, unclear} / required=true`
- **建议确定性判断**：AI 训练使用且无明确授权 → `block`；境外/跨境 + 个人信息 + 无 DPA → `block`；客户数据归属明确且处理受限、无上述红线 → `pass`；加密/本地化/删除强度偏离 → `negotiate` 或独立规则；地域/数据类型不明 → `manual_review`。
- **缺证据**：`manual_review`。
- **处理动作**：删除未授权训练权，补充处理目的/地点/期限/DPA；涉及跨境时法务升级。
- **最少业务确认**：由法务确认 DPA 触发条件、地域定义和个人信息范围；确认“客户数据归属不清”是 negotiate 还是 block。
- **风险**：这是高时效法律规则；必须记录适用地域、口径所有人和复核日期，不能永久沿用旧文本。

### R013 · SLA

- **旧数据（未确认）**：公有云 99.5% 且按服务费比例补偿为可接受；99.9% 需售后评估；按合同总额/营业损失赔偿、私有部署承诺可用性或 7×24 为红线。
- **可复用事实**：部署形态、可用率、统计口径、支持时段、补偿基数和上限可分别读取。
- **推荐分类**：服务等级。
- **建议属性**：
  - `deployment_mode`: `enum / {public_cloud, private_deployment, hybrid, unknown} / required=true`
  - `availability_commitment`: `percentage / percent / required=false`（非公有云可不适用；公有云缺值转人工复核）
  - `support_window`: `enum / {business_hours, seven_by_twenty_four, custom} / required=true`
  - `service_compensation_basis`: `enum / {service_fee, contract_total, business_loss, other} / required=true`
  - `private_deployment_availability_state`: `enum / {committed, not_committed, not_applicable, unclear} / required=true`
- **建议确定性判断**：合同总额/营业损失为赔偿基数，私有部署承诺供应商可用性，或未经能力确认的 7×24 → 推荐 `block`；公有云 99.5% + 服务费补偿 → `pass`；99.9% → `manual_review` 或 `negotiate` 并要求架构评估；其他组合 → `manual_review`。
- **缺证据**：`manual_review`。
- **处理动作**：按实际部署和服务能力重写可用性、统计排除项和补偿上限；高承诺转售前/售后评估。
- **最少业务确认**：确认 7×24 是否在购买对应服务包后可放行；确认 99.9% 评估通过后的结果；确认私有部署中供应商可承诺的边界。
- **风险**：旧规则把“服务时段”和“系统可用性”混成一个 SLA，容易错误阻断已购买的专项服务。

### R014 · 续约

- **旧数据（未确认）**：书面续约或到期自动终止为可接受；自动续期且至少提前 30 日通知、年涨幅不超过 5% 可谈；永久锁价或自动续期无退出权为红线。
- **可复用事实**：续约方式、通知期、退出权、续期周期、调价幅度、锁价期限可分别读取。
- **推荐分类**：合同期限与续约。
- **建议属性**：
  - `renewal_mode`: `enum / {written_renewal, expires_automatically, auto_renewal} / required=true`
  - `non_renewal_notice`: `duration / day / required=false`（非自动续期可不适用；自动续期缺值转人工复核）
  - `exit_right_state`: `enum / {available, unavailable, not_applicable, unclear} / required=true`
  - `annual_price_increase_cap`: `percentage / percent / required=false`
  - `perpetual_price_lock`: `boolean / required=true`
- **建议确定性判断**：永久锁价或自动续期无退出权 → `block`；书面续约/到期终止 → `pass`；自动续期 + 退出权 + 通知 `>=30` + 涨幅 `<=5` → `negotiate`；其他自动续期组合 → `manual_review` 或按确认口径 block。
- **缺证据**：`manual_review`。
- **处理动作**：改为书面续约，或补足通知、退出权和调价机制。
- **最少业务确认**：确认自动续期通知不足 30 日是否 block；确认年涨幅 0% 是单期固定价还是永久锁价；确认涨幅超过 5% 的结果。
- **风险**：只读“涨幅=0”无法判断永久锁价，必须同时读取锁价期限和续约机制。

### R015 · 争议解决

- **旧数据（未确认）**：中国法律 + 深圳国际仲裁院为偏好；北京/上海仲裁或一线城市法院可谈；境外法律、法院或仲裁为红线。
- **可复用事实**：适用法律、争议方式、机构、地点、语言和执行安排可分别读取。
- **推荐分类**：法律适用与争议。
- **建议属性**：
  - `governing_law`: `enum / {prc_mainland, foreign, mixed, unclear} / required=true`
  - `dispute_method`: `enum / {arbitration, litigation} / required=true`
  - `forum_location_scope`: `enum / {shenzhen, beijing, shanghai, other_mainland, overseas} / required=true`
  - `forum_institution`: `text / required=true`
- **建议确定性判断**：境外法律/机构/地点 → `block`；中国法 + 深圳国际仲裁院 → `pass`；北京/上海仲裁或经确认的一线城市法院 → `negotiate`；其他境内地点/机构 → `manual_review`。
- **缺证据**：`manual_review`。
- **处理动作**：建议改为中国法及确认过的境内机构；境外安排升级法务。
- **最少业务确认**：由法务确认允许的机构白名单；用明确城市替代“一线城市”；确认“其他境内法院/仲裁”是 negotiate 还是 block。
- **风险**：机构名称会变更且管辖有效性依赖交易和主体事实；不能只凭城市关键词放行。

## 4. 推荐确认方式与发布边界

建议业务负责人按以下方式一次回复，避免 15 次技术确认：

1. **公共口径**：接受 / 修改第 1 节五项。
2. **逐条决策**：对 R001–R015 写“接受推荐”或只列例外；R006、R010 必须明确是否同意拆分。
3. **责任人**：R003 由财税，R012/R015 由法务，R013 由售前/售后能力负责人确认；其余指定商务/法务规则所有人。
4. **生效范围**：确认适用组织、合同类型、币种/地域及生效日期。

在上述确认完成前：

- R001–R015 只能保持“待业务确认草稿”；
- 不得生成 canonical `rule_contract v1` 发布快照；
- 不得将旧 Skill/Prompt 自动转译结果标记为当前规则产品；
- 可用受控 canary 验证编译器、快照、测试矩阵和 ReviewRun 链路，但 canary 不能冒充这 15 条业务规则已经确认。

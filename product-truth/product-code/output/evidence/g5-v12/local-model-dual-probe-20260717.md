# G5 免费本地双模型真实调用证据（2026-07-17）

## 边界

- 本文件先记录本机直连协议证据，后续章节再记录同一批模型通过应用运行时写入隔离 Preview 的 `model_invocations` 与 ReviewRun；两类证据保持分开。
- 未注册账号、未购买服务、未下载新模型、未使用持续付费依赖。
- 两个模型顺序加载到 `127.0.0.1:12345`，不对外网监听，不并发占用内存，不需要 API Key。
- Preview 写入仅发生在隔离 Free 项目 `vsfropnfsmnonkotywsx`；Production 始终只读。模型与本机应用在验收后均已停止。

## 固定运行资产

| 资产 | 版本 / SHA-256 |
|---|---|
| LM Studio 内置 `llama-server` | build `0eca4d4`; `0e62a1c555649c4baed5b90eb47a44357044b3ed7dc09f0e0243d25ee3c00230` |
| Qwen3.5-9B Q4_K_M GGUF | `cd76ec205963b3b33350093e6904d9de16c4e666fd104e1f632d25c7f15f2a13` |
| Gemma-4-E4B-it Q4_K_M GGUF | `3f72a20a06f626c78e6c475ae07a64c88b2663149c0f6197b56bf7cf1f37585c` |

Qwen 必须以 `--reasoning off --reasoning-format deepseek --reasoning-budget 0` 启动。默认 reasoning 下，最小 probe 虽为 HTTP 200，但 8 个输出 token 全进入 `reasoning_content`、正文为空；10 条款审核也把 1024 token 消耗在思考/长输出并截断。这是“连接绿但应用不可用”的反例，不能计为通过。

## 相同合同输入

两个模型均使用同一份真实 G5 验收样本中的三条原文：

```text
付款节奏：首付款为6%，验收后支付尾款，账期90个工作日。
数据安全：客户数据可用于模型训练并可跨境长期留存。
违约责任：乙方每日承担合同金额5%的违约金且无上限。
```

输出协议与产品运行时一致：`risks[] + summary`，每项必须有 `level/title/description/suggestion/source_quote/rule_code`；`source_quote` 必须是输入逐字子串；没有已发布规则事实时 `rule_code=null`。

## 结果矩阵

| 模型 | 最小 provider probe | 三条款审核调用 | 结构 / 锚点结果 |
|---|---|---|---|
| `qwen3.5-9b-local` | HTTP 200；0.536s；prompt 29 / completion 2 / total 31；正文 `OK` | HTTP 200；14.031s；prompt 120 / completion 329 / total 449 | 闭合 JSON；3 个风险；3 个 `source_quote` 均为逐字原文子串；3 个 `rule_code` 均为 null |
| `gemma-4-e4b-local` | HTTP 200；0.491s；prompt 26 / completion 2 / total 28；正文 `OK` | HTTP 200；8.624s；prompt 134 / completion 331 / total 465 | 闭合 JSON；3 个风险；3 个 `source_quote` 均为逐字原文子串；3 个 `rule_code` 均为 null |

### Qwen 结构化输出

```json
{
  "risks": [
    {
      "level": "red",
      "title": "尾款支付条件不明确",
      "description": "验收标准未定义，可能导致尾款无法支付或产生争议。",
      "suggestion": "明确约定具体的验收标准、验收流程及验收期限。",
      "source_quote": "验收后支付尾款",
      "rule_code": null
    },
    {
      "level": "red",
      "title": "数据跨境与留存风险",
      "description": "允许数据跨境长期留存，可能违反数据出境安全评估规定。",
      "suggestion": "评估数据出境合规性，建议限制数据留存期限或禁止跨境。",
      "source_quote": "客户数据可用于模型训练并可跨境长期留存",
      "rule_code": null
    },
    {
      "level": "red",
      "title": "违约金比例过高",
      "description": "每日5%违约金过高，且无上限，显失公平，可能被认定无效。",
      "suggestion": "建议将违约金比例调整为每日万分之五，并设定赔偿上限。",
      "source_quote": "乙方每日承担合同金额5%的违约金且无上限",
      "rule_code": null
    }
  ],
  "summary": "合同存在尾款支付条件模糊、数据合规风险及违约金过高三大核心问题，建议重点修订。"
}
```

### Gemma 结构化输出

```json
{
  "risks": [
    {
      "level": "red",
      "title": "违约金过高且无上限",
      "description": "每日5%且无上限，风险极高。",
      "suggestion": "建议设定合理的违约金上限。",
      "source_quote": "乙方每日承担合同金额5%的违约金且无上限。",
      "rule_code": null
    },
    {
      "level": "yellow",
      "title": "数据使用范围过广",
      "description": "数据用于模型训练和跨境留存需明确范围。",
      "suggestion": "明确数据使用目的和跨境留存的范围。",
      "source_quote": "客户数据可用于模型训练并可跨境长期留存。",
      "rule_code": null
    },
    {
      "level": "yellow",
      "title": "付款节点不明确",
      "description": "验收后支付尾款，验收标准需明确。",
      "suggestion": "细化验收标准和流程，保障款项支付。",
      "source_quote": "首付款为6%，验收后支付尾款，账期90个工作日。",
      "rule_code": null
    }
  ],
  "summary": "合同存在违约金过高、数据使用范围不明确和付款节点描述模糊等风险点。"
}
```

## 隔离 Preview 运行时闭环

后续已在同一 Free Preview 建立稳定的 Qwen/Gemma `PUBLISHED` Provider 配置、current model policy 和一份明确 `not_release_eligible` 的 plumbing bundle。两个真实 `/api/configs/ai-probe` 均满足 `ok=true / evidence_saved=true / runtime_config_match=true / tokens>0`：Qwen 为 668ms、29/2/31 tokens，Gemma 为 410ms、28/2/30 tokens。

同一份带既有修订和批注的 DOCX、同一 `contract_id/source_hash/source_text_hash/skill_bundle_id` 形成两条直接 ReviewRun：

| 模型 | ReviewRun | job | 延迟 | tokens（输入/输出/总计） | 风险结果 |
|---|---|---|---:|---:|---|
| Qwen3.5-9B | `c29bd4e1-5979-41b7-8f89-cde001667fa6` | `e2806491-2a2b-4c18-a1a1-7cfab7bd8912` | 8,856ms | 328 / 201 / 529 | 1 条高影响 SLA 风险，逐字锚点 |
| Gemma-4-E4B | `bcfa78dd-6497-440e-8065-b0c3a3e657e9` | `390a5a81-89cb-40d3-9c1a-2ae73de8e546` | 34,710ms | 337 / 1,528 / 1,865 | 同一 SLA 风险 + 付款周期、质保范围两条合理黄灯，均逐字锚点 |

两条 `semantic_review` invocation 均为 completed、`degraded=false`，直接关联各自 `review_id/job_id`，源文件与源文本哈希一致。真实浏览器在桌面 `1440×900` 和 iPad `1180×820` 同时看到了源文件 2 处插入、2 处删除、1 条既有批注和 3 条 Gemma 风险，无横向溢出、alert 或 console error。完整 ID、源哈希、截图和并发 page-map fence 证据见 `preview-runtime-fixture-20260717.md`。

## 尚未关闭的发布门禁

多模型基础运行链已经关闭，但仍不能宣称“审核精确度或发布通过”：

1. 当前 plumbing bundle 没有规则、规则集、文档或模板快照，明确 `not_release_eligible=true`；
2. 仍需 50 页 / 10 类风险的代表性准确率、漏检率和输出完整性对照；
3. 真实 DOCM 与文本/扫描 PDF 仍需完成 SaaS 上传—预览—原生批注导出—阅读器矩阵；
4. Production 保持只读，未经批准不得 push 或部署。

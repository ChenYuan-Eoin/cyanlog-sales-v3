# Feature Packet: F012-AI运行时配置

**Created**: 2026-06-09  
**REQ ID**: F012  
**Status**: confirmed  
**Parent**: 配置中心  
**Depends On**: `F000-config-center-architecture`

---

## 1. 单元定义

**目标**：把 AI 调用从散落环境变量升级为配置中心拥有的运行时策略，统一管理本地模型、销售团队云端模型和规则降级链。

**这包拥有的内容**：
- 本地模型连接
- 销售团队云端模型连接（OpenAI 兼容）
- 路由阈值
- 调用参数
- 降级优先级

**这包不拥有的内容**：
- 合同审核规则本体（属于 `F009`）
- 合同审核执行（属于 `F005 / F006`）
- Prompt 工程细节的业务含义

---

## 2. 三层落位

| 层级 | 本功能对应物 |
|------|--------------|
| 第一层：能力域 | AI 运行时配置 |
| 第二层：具体配置 | Provider Profile、Routing Policy、Timeout、Fallback |
| 第三层：消费页面 | 合同审核、ASK、后续 AI 辅助能力 |

---

## 3. 配置对象

### 3.1 本地模型
- 支持用户自有推理服务
- 只要求 OpenAI 兼容接口
- 可配置 `base_url / model / timeout`

### 3.2 销售团队云端模型
- 优先支持销售团队自有 OpenAI 兼容网关
- 不绑定某个固定厂商
- 作为本地模型失败后的云端补位

### 3.3 路由策略
- 按页数、耗时、任务类型切换
- 支持本地优先 / 云端补位 / 规则兜底

### 3.4 调用参数
- `temperature`
- `max_tokens`
- `json_mode`
- 重试次数 / 超时

---

## 4. 安全与密钥约束

- API Key 读取时必须脱敏
- 更新配置时必须支持“保留已有密钥”
- 密钥不直接回显到普通业务页面
- 审核执行页只读取可运行配置，不暴露写入口

---

## 5. 与消费侧的边界

| 消费方 | 读取什么 | 不允许做什么 |
|--------|----------|--------------|
| `F005` 合同审核流程 | 当前生效 Provider Profile | 直接改模型配置 |
| `F006` 规则执行内核 | 路由阈值、超时、降级链 | 执行中写回 AI 配置 |
| 后续智能功能 | 模型选择策略 | 私自新增环境变量旁路 |

---

## 6. 数据建模原则

优先拆成强类型对象：
- `ai_provider_profiles`
- `ai_routing_policies`
- `ai_runtime_versions`

如果短期复用统一配置接口，也必须保证：
- 配置结构校验
- 版本可追溯
- 发布后消费
- 密钥单独处理

---

## 7. 当前实现判断

当前工程已有本地模型和降级链代码，但仍主要偏运行时拼装，配置中心控制面并未真正建成。

因此本 REQ 当前为 `confirmed`：
- 真相已经明确
- 下一步开发应围绕“配置生产面 + 运行时消费链”展开

---

## 8. 涉及文件

- `product-truth/product-code/app/configs/page.tsx`
- `product-truth/product-code/app/api/configs/route.ts`
- `product-truth/product-code/app/api/configs/[id]/route.ts`
- `product-truth/product-code/lib/configs/runtime.ts`
- `product-truth/product-code/lib/ai/failover.ts`

---

## 9. 验收标准

- [ ] 可配置本地模型与销售云端模型
- [ ] 可测试连接与健康状态
- [ ] 路由阈值与超时参数可配置
- [ ] 消费侧只读取已发布 AI 配置

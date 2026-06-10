# ADR-003: SSE流式传输选型

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

合同审核AI需要将分析结果实时推送给用户，关键需求：

1. **流式输出**：
   - AI分析耗时数秒到数十秒
   - 用户需要看到"正在分析"的实时反馈
   - 不能等到全部完成才显示结果

2. **单向通信**：
   - AI分析流程是"上传→分析→展示"
   - 服务器→客户端方向为主
   - 客户端→服务器仅是"触发分析"的一次性请求

3. **基础设施约束**：
   - Next.js部署在Vercel，Edge Functions对协议支持有限
   - 第三方CDN/代理可能拦截WebSocket
   - 公司防火墙策略可能封禁非标准端口

4. **断连处理**：
   - 移动网络切换（WiFi↔4G）导致连接中断
   - 用户切换标签页浏览器可能暂停后台请求
   - 需要自动重连机制

## 决策 (Decision)

采用**SSE (Server-Sent Events) + fetch + ReadableStream**自实现方案：

```
浏览器                              Next.js API
  │                                     │
  │  fetch(url, {method: 'POST'})       │
  │ ──────────────────────────────────► │
  │                                     │  启动AI分析
  │  ◄── data: {"risks":[...]}         │  流式推送JSON片段
  │  ◄── data: {"risks":[...],"s...}   │
  │  ◄── data: {"risks":[...],"sum...} │
  │  ◄── data: [DONE]                   │
  │                                     │
  ▼                                     ▼
```

### 关键实现
```typescript
// 服务端：返回ReadableStream
return new NextResponse(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  },
})

// 客户端：fetch+ReadableStream（非EventSource）
const reader = response.body!.getReader()
const decoder = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const chunk = decoder.decode(value)
  // 解析SSE格式 "data: {...}\n\n"
}
```

### 断连重试
| 配置 | 值 | 原因 |
|------|------|------|
| maxRetries | 5 | 给网络抖动留恢复空间 |
| baseDelayMs | 1000 | 1秒起步，避免雪崩 |
| maxDelayMs | 30000 | 封顶30秒 |
| heartbeatIntervalMs | 30000 | 30秒心跳保活 |

## 影响 (Consequences)

### 正面影响
- ✅ **HTTP兼容**：走标准HTTPS端口，无防火墙问题
- ✅ **CDN友好**：可被Vercel/CDN缓存层处理
- ✅ **断线重连**：自实现指数退避，可控制策略
- ✅ **自定义header**：可传Authorization（EventSource不支持）
- ✅ **POST支持**：可传大文本（EventSource仅GET）

### 负面影响
- ⚠️ **单向通信**：客户端→服务器需额外HTTP请求
- ⚠️ **SSE格式解析**：自实现"data: payload\n\n"解析
- ⚠️ **浏览器限制**：IE不支持（但已不重要）

## 备选方案 (Alternatives Considered)

### 备选A：浏览器原生EventSource
- 实现最简单
- 但**不支持自定义header**（无法传token）
- 仅支持GET（无法传长文本body）
- 不可控的重连策略
- **否决原因**：无法满足认证+大文本需求

### 备选B：WebSocket
- 全双工通信
- 但**AI场景不需要双向**（一次POST触发+流式SSE）
- 部署复杂：需要独立端口、协议升级
- 防火墙/代理可能拦截
- Vercel Edge Functions对WebSocket支持有限
- **否决原因**：成本与复杂度与需求不匹配

### 备选C：长轮询（Long Polling）
- 兼容性好
- 但延迟高（轮询间隔 vs 推送）
- 服务器连接数膨胀
- **否决原因**：流式体验差

### 备选D：第三方实时服务（Pusher/Ably）
- 即时上线
- 但增加SaaS依赖
- 成本随用户数增长
- 数据出境问题
- **否决原因**：与本地AI策略冲突

## 实施细节 (Implementation)

### SSE消息格式
```
event: risk
data: {"level":"red","title":"账期超标"}

event: summary
data: {"text":"合同整体风险中等"}

event: done
data: [DONE]
```

### 心跳机制
```typescript
// 每30秒发送注释行 ":heartbeat\n\n"
// 浏览器接收但忽略，保持连接活跃
controller.enqueue(encoder.encode(`:heartbeat\n\n`))
```

### 流式JSON解析
客户端使用状态机累积JSON片段（基于括号深度）：
```typescript
let depth = 0
for (const char of text) {
  if (char === '{') depth++
  if (char === '}') depth--
  if (depth === 0) {
    // 找到完整JSON对象
    return JSON.parse(text.slice(start, index + 1))
  }
}
```

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| 首字节延迟（TTFB） | <500ms |
| 平均流式吞吐 | >100 tokens/s |
| 断连重连成功率 | >95% |
| 30秒心跳保活率 | >99% |

## 参考 (References)

- 代码实现：`lib/sse/client.ts`
- 消费方：`app/components/AIReviewStream.tsx`
- 生产端：`app/api/contracts/[id]/ai-review/route.ts`

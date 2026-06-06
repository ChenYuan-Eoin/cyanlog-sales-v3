// lib/agent/telemetry.ts
// Agent级链路追踪 — trace_id贯穿所有日志

/**
 * 链路追踪上下文
 */
export interface TraceContext {
  /** 唯一追踪ID */
  traceId: string
  /** 父级Span ID */
  parentSpanId?: string
  /** 当前Span ID */
  spanId: string
  /** 开始时间 */
  startTime: number
  /** 用户ID */
  userId?: string
  /** 请求路由 */
  route?: string
  /** 自定义标签 */
  tags: Record<string, unknown>
}

/**
 * 创建新的Trace
 */
export function createTrace(options: {
  traceId?: string
  parentSpanId?: string
  userId?: string
  route?: string
  tags?: Record<string, unknown>
}): TraceContext {
  return {
    traceId: options.traceId || generateTraceId(),
    parentSpanId: options.parentSpanId,
    spanId: generateSpanId(),
    startTime: Date.now(),
    userId: options.userId,
    route: options.route,
    tags: options.tags || {},
  }
}

/**
 * 创建子Span
 */
export function createChildSpan(parent: TraceContext, name: string): TraceContext {
  return {
    traceId: parent.traceId,
    parentSpanId: parent.spanId,
    spanId: generateSpanId(),
    startTime: Date.now(),
    userId: parent.userId,
    route: parent.route,
    tags: { ...parent.tags, spanName: name },
  }
}

/**
 * 完成Span（记录日志）
 */
export function finishSpan(span: TraceContext, result?: { error?: Error; metadata?: Record<string, unknown> }): void {
  const duration = Date.now() - span.startTime
  const log = {
    level: result?.error ? 'error' : 'info',
    type: 'span_finished',
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    spanName: span.tags.spanName,
    userId: span.userId,
    route: span.route,
    duration,
    error: result?.error?.message,
    ...span.tags,
    ...result?.metadata,
  }

  console.log(JSON.stringify(log))
}

/**
 * Agent调用追踪器
 * Agent的所有调用（LLM/工具/Memory）都打点，形成完整调用链
 */
export class AgentTracer {
  private context: TraceContext
  private spans: TraceContext[] = []

  constructor(context: TraceContext) {
    this.context = context
  }

  /**
   * 记录Agent执行开始
   */
  startAgent(name: string): TraceContext {
    const span = createChildSpan(this.context, `agent:${name}`)
    this.spans.push(span)
    return span
  }

  /**
   * 记录LLM调用
   */
  startLLMCall(model: string, promptTokens: number): TraceContext {
    const span = createChildSpan(this.context, `llm:${model}`)
    span.tags.promptTokens = promptTokens
    this.spans.push(span)
    return span
  }

  /**
   * 记录工具调用
   */
  startToolCall(tool: string, params: Record<string, unknown>): TraceContext {
    const span = createChildSpan(this.context, `tool:${tool}`)
    span.tags.toolParams = params
    this.spans.push(span)
    return span
  }

  /**
   * 记录记忆访问
   */
  startMemoryAccess(memoryType: 'buffer' | 'session' | 'profile'): TraceContext {
    const span = createChildSpan(this.context, `memory:${memoryType}`)
    this.spans.push(span)
    return span
  }

  /**
   * 完成所有Span
   */
  finishAll(): void {
    for (const span of this.spans) {
      finishSpan(span)
    }
  }

  /**
   * 获取trace_id
   */
  getTraceId(): string {
    return this.context.traceId
  }
}

// ─── 工具函数 ──────────────────────────────────────────

function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

function generateSpanId(): string {
  return `span_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

import { describe, it, expect } from 'vitest'
import {
  createTrace,
  createChildSpan,
  AgentTracer,
} from './telemetry'

describe('TraceContext', () => {
  it('should create trace with auto-generated IDs', () => {
    const trace = createTrace({})
    expect(trace.traceId).toMatch(/^trace_/)
    expect(trace.spanId).toMatch(/^span_/)
  })

  it('should create child span with parent link', () => {
    const parent = createTrace({})
    const child = createChildSpan(parent, 'test-span')
    expect(child.traceId).toBe(parent.traceId)
    expect(child.parentSpanId).toBe(parent.spanId)
    expect(child.tags.spanName).toBe('test-span')
  })
})

describe('AgentTracer', () => {
  it('should create tracer and start agent', () => {
    const trace = createTrace({})
    const tracer = new AgentTracer(trace)
    const span = tracer.startAgent('contract-review')
    expect(span.tags.spanName).toBe('agent:contract-review')
  })

  it('should track LLM call', () => {
    const trace = createTrace({})
    const tracer = new AgentTracer(trace)
    const span = tracer.startLLMCall('claude-sonnet-4-6', 1500)
    expect(span.tags.promptTokens).toBe(1500)
  })

  it('should track tool call', () => {
    const trace = createTrace({})
    const tracer = new AgentTracer(trace)
    const span = tracer.startToolCall('search', { query: 'test' })
    expect(span.tags.toolParams).toEqual({ query: 'test' })
  })

  it('should share trace_id across spans', () => {
    const trace = createTrace({})
    const tracer = new AgentTracer(trace)
    const agentSpan = tracer.startAgent('test')
    const toolSpan = tracer.startToolCall('test', {})

    expect(agentSpan.traceId).toBe(trace.traceId)
    expect(toolSpan.traceId).toBe(trace.traceId)
    expect(agentSpan.spanId).not.toBe(toolSpan.spanId)
  })

  it('should finish all spans', () => {
    const trace = createTrace({})
    const tracer = new AgentTracer(trace)
    tracer.startAgent('test')
    tracer.startToolCall('test', {})
    // finishAll 不会抛错
    expect(() => tracer.finishAll()).not.toThrow()
  })
})

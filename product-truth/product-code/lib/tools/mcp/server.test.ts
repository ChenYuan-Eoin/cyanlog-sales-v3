import { describe, it, expect } from 'vitest'
import { MCPServer } from './server'

describe('MCPServer', () => {
  it('should handle initialize request', async () => {
    const server = new MCPServer({
      name: 'test-server',
      version: '1.0.0',
    })

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    })

    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(1)
    expect((response.result as Record<string, unknown>).serverInfo).toBeDefined()
  })

  it('should handle tools/list request', async () => {
    const server = new MCPServer({
      name: 'test-server',
      version: '1.0.0',
    })

    server.registerTool({
      name: 'test-tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: {} },
    })

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })

    const result = response.result as { tools: Array<{ name: string }> }
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('test-tool')
  })

  it('should handle unknown method', async () => {
    const server = new MCPServer({
      name: 'test-server',
      version: '1.0.0',
    })

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'unknown/method',
    })

    expect(response.error).toBeDefined()
    expect(response.error?.code).toBe(-32601)
  })
})

import { describe, it, expect } from 'vitest'
import { handleToolsList, handleToolsCall } from './handlers'
import type { MCPTool } from './types'

const mockTools = new Map<string, MCPTool>()
mockTools.set('echo', {
  name: 'echo',
  description: 'Echo back the input',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
})

describe('handleToolsList', () => {
  it('should return all tools', () => {
    const result = handleToolsList(mockTools)
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('echo')
  })

  it('should return empty array for empty registry', () => {
    const result = handleToolsList(new Map())
    expect(result.tools).toHaveLength(0)
  })
})

describe('handleToolsCall', () => {
  it('should throw on missing tool name', async () => {
    await expect(handleToolsCall({}, mockTools)).rejects.toThrow('Missing tool name')
  })

  it('should throw on unknown tool', async () => {
    await expect(handleToolsCall({ name: 'unknown' }, mockTools)).rejects.toThrow('Tool not found')
  })
})

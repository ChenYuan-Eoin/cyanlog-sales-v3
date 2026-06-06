import { describe, it, expect } from 'vitest'
import { ToolRegistry } from './registry'
import { createTool } from './base'
import { z } from 'zod'

describe('ToolRegistry', () => {
  it('should register and execute tool', async () => {
    const registry = new ToolRegistry()
    const tool = createTool({
      name: 'add',
      description: 'Add two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async (params) => params.a + params.b,
    })

    registry.register(tool)
    const result = await registry.execute('add', { a: 1, b: 2 })
    expect(result).toBe(3)
  })

  it('should throw on duplicate registration', () => {
    const registry = new ToolRegistry()
    const tool = createTool({
      name: 'test',
      description: 'test',
      parameters: z.object({}),
      execute: async () => 'ok',
    })

    registry.register(tool)
    expect(() => registry.register(tool)).toThrow('already registered')
  })

  it('should check permissions', async () => {
    const registry = new ToolRegistry()
    const tool = createTool({
      name: 'secret',
      description: 'secret tool',
      parameters: z.object({}),
      execute: async () => 'ok',
      requiredPermission: 'admin:access',
    })

    registry.register(tool)

    await expect(registry.execute('secret', {}, ['user:read'])).rejects.toThrow('Permission denied')
    expect(await registry.execute('secret', {}, ['admin:access'])).toBe('ok')
  })
})

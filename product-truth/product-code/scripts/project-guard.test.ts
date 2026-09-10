// REQ: WP10. Gate adapter must fail closed before the client operation.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { checkProjectTool } from '../../../.opencode/lib/project-guard-core.mjs'
type Runner = (command: string, args: string[], options: unknown) => { status: number; stderr?: string }
const root = path.resolve(process.cwd(), '../..')
describe('OpenCode project guard', () => {
  it('blocks a denied Harness decision', () => {
    const run = vi.fn<Runner>(() => ({ status: 2, stderr: 'INTERCEPTED: forbidden phase' }))
    expect(() => checkProjectTool(root, 'bash', { command: 'git status' }, run)).toThrow('forbidden phase')
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('also checks paths after a successful Harness decision', () => {
    const run = vi.fn<Runner>().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 2 })
    expect(() => checkProjectTool(root, 'write', { filePath: 'outside.txt' }, run)).toThrow('outside the current Active')
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('includes move destinations in scheduler checks', () => {
    const run = vi.fn<Runner>(() => ({ status: 0 }))
    checkProjectTool(root, 'apply_patch', { patchText: '*** Update File: a.ts\n*** Move to: b.ts\n' }, run)
    expect(run.mock.calls[1][1]).toEqual(expect.arrayContaining(['scheduler-check', 'a.ts', 'b.ts']))
  })
  it('blocks an edit with no identifiable target', () => {
    expect(() => checkProjectTool(root, 'write', {}, () => ({ status: 0 }))).toThrow('Cannot determine')
  })
})

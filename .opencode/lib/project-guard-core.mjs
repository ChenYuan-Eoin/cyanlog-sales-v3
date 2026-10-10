// Local control adapter. No prompt injection, agents or model calls.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
/**
 * @param {string} root
 * @param {string} tool
 * @param {Record<string, any>} args
 * @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => {status: number | null, stderr?: string, error?: Error}} [run]
 */
export function checkProjectTool(root, tool, args, run = spawnSync) {
  const names = { bash: 'Bash', edit: 'Edit', write: 'Write', apply_patch: 'apply_patch', patch: 'apply_patch' }
  const name = names[tool]
  if (!name) return
  const adapter = path.join(root, '.codex/hooks/harness-adapter.js')
  if (!fs.existsSync(adapter)) throw new Error('Project Harness adapter is missing')
  const result = run('node', [adapter, 'PreToolUse'], {
    cwd: root, input: JSON.stringify({ tool_name: name, tool_input: args }), encoding: 'utf8', timeout: 15000,
  })
  if (result.error || result.status !== 0) {
    const reason = String(result.stderr || '').match(/INTERCEPTED: (.+)/)?.[1]
    throw new Error(reason || 'Project Harness rejected this operation or did not finish')
  }
  const files = tool === 'edit' || tool === 'write' ? [args.filePath] :
    tool === 'apply_patch' || tool === 'patch' ? [...String(args.patchText || args.patch || '').matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(m => m[1]) : []
  if (tool !== 'bash' && (!files.length || files.some(f => !f))) throw new Error('Cannot determine all changed paths')
  if (files.length) {
    const registry = path.join(root, 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js')
    const check = run('node', [registry, 'scheduler-check', ...files], { cwd: root, encoding: 'utf8', timeout: 15000 })
    if (check.error || check.status !== 0) throw new Error('Changed paths are outside the current Active scope, or scheduler validation failed')
  }
}

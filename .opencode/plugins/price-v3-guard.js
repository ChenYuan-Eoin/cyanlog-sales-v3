// Only the plugin factory is exported from the auto-loaded plugin directory.
import { spawnSync } from 'node:child_process'
import { checkProjectTool } from '../lib/project-guard-core.mjs'
export default async ({ directory }) => {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: directory, encoding: 'utf8' })
  if (result.status !== 0) return {}
  const root = result.stdout.trim()
  return { 'tool.execute.before': async (input, output) => checkProjectTool(root, input.tool, output.args) }
}

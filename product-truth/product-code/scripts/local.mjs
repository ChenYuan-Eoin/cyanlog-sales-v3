// REQ: WP10 本机迁移恢复；保留环境文件，按优先级加载到子进程。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { spawn, execFileSync } from 'node:child_process'

if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('请通过 scripts/local.sh 使用 Node 24')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
// Credentials live in worktree-private runtime, not in tracked source files.
const repo = path.resolve(root, '../..')
const runtime = path.resolve(repo, execFileSync('git', ['rev-parse', '--git-path', 'codex-runtime'], { cwd: repo, encoding: 'utf8' }).trim())
const localEnv = process.env.PRICE_V3_LOCAL_ENV_FILE || path.join(runtime, 'local-development.env')
if (!fs.existsSync(localEnv)) throw new Error('缺少隔离环境配置：请设置 PRICE_V3_LOCAL_ENV_FILE，不能回退到生产环境文件')
for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(localEnv, 'utf8')))) {
  if (!env[key]) env[key] = value
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'vsfropnfsmnonkotywsx.supabase.co') {
  throw new Error('本地入口只允许已批准的隔离数据库，拒绝生产或未知项目')
}
delete env.VERCEL
delete env.VERCEL_ENV
env.NEXT_TELEMETRY_DISABLED ??= '1'

const [command = 'dev', ...args] = process.argv.slice(2)
const allowed = new Set(['dev', 'build', 'start', 'lint', 'test:run', 'env:check', 'typecheck'])
if (!allowed.has(command)) throw new Error(`不支持的本地命令：${command}`)
const pnpmArgs = command === 'typecheck'
  ? ['exec', 'tsc', '--noEmit', '--incremental', 'false', ...args]
  : [command, ...args]
// Corepack 读取 package.json 的 packageManager，固定使用 pnpm 9.15.9。
const child = spawn('corepack', ['pnpm', ...pnpmArgs], { cwd: root, env, stdio: 'inherit' })
child.on('error', (error) => {
  console.error(`无法启动本地命令：${error.message}`)
  process.exitCode = 1
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
})

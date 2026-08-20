#!/usr/bin/env node
// REQ: WP10 换机可迁移基座
// PURPOSE: 新机器/新环境一键还原：环境检查 → 删软链 → 锁文件重装 → Vercel 关联/拉 env → 校验 → 测试 → 构建
// 原则：
//  - 不写死密钥，不把 .env* 提交仓库；env 从 Vercel 拉取 + 密码管理器人工补 AI 网关三项
//  - node_modules 若是软链（历史 worktree 残留）必须先 unlink 再重装，防止跨机断链
//  - 使用项目锁定的 pnpm@9.15.9（packageManager 字段），避免 pnpm 10 悄悄改写 lock
// 用法：
//   node scripts/setup-new-machine.mjs [--skip-install] [--skip-build] [--skip-test]

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const codeRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(codeRoot, '..', '..')
const pkg = JSON.parse(fs.readFileSync(path.join(codeRoot, 'package.json'), 'utf8'))

const EXPECTED_PNPM = pkg.packageManager ? pkg.packageManager.replace(/^pnpm@/, '').split('+')[0] : null
const MIN_NODE = 20
const RECOMMEND_NODE_MAJOR = 24 // 与 Vercel nodeVersion 对齐

const args = new Set(process.argv.slice(2))
const SKIP_INSTALL = args.has('--skip-install')
const SKIP_BUILD = args.has('--skip-build')
const SKIP_TEST = args.has('--skip-test')

let failures = 0
const step = (name, fn) => {
  process.stdout.write(`\n=== ${name} ===\n`)
  try {
    fn()
  } catch (error) {
    failures += 1
    process.stdout.write(`✗ ${error.message}\n`)
  }
}
const ok = (msg) => process.stdout.write(`✓ ${msg}\n`)
const warn = (msg) => process.stdout.write(`⚠ ${msg}\n`)

function run(cmd, argsList, opts = {}) {
  const result = spawnSync(cmd, argsList, {
    cwd: codeRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...(opts.env || {}) },
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
  })
  if (result.status !== 0) {
    const err = (result.stderr || '').trim() || (result.stdout || '').trim()
    throw new Error(`${cmd} ${argsList.join(' ')} 失败: ${err.slice(0, 500)}`)
  }
  return result.stdout.trim()
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

function pnpmCommand() {
  // 优先 corepack（Node 官方包管理版本锁定），否则回退 npx
  const corepack = spawnSync('corepack', ['--version'], { encoding: 'utf8' })
  if (corepack.status === 0) {
    return ['corepack', 'pnpm']
  }
  return ['npx', `pnpm@${EXPECTED_PNPM || '9.15.9'}`]
}

function detectStoreDir() {
  // 关键教训：~/.npmrc 的 prefix 若指向非默认位置（如 Desktop），pnpm store 会落到错误目录，
  // 导致每次 install 都重新下载甚至卡死。这里探测候选 store 并优先用最大的完整 store。
  const candidates = [
    path.join(os.homedir(), 'Library/pnpm/store'),
    path.join(os.homedir(), '.local/share/pnpm/store'),
    path.join(os.homedir(), '.pnpm-store'),
  ]
  let best = null
  let bestSize = 0
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue
    const size = fs.statSync(dir).size
    if (size > bestSize) {
      bestSize = size
      best = dir
    }
  }
  // 也检查 npmrc prefix 是否异常
  const npmrc = path.join(os.homedir(), '.npmrc')
  if (fs.existsSync(npmrc)) {
    const rc = fs.readFileSync(npmrc, 'utf8')
    const prefixMatch = rc.match(/^prefix\s*=\s*(.+)$/m)
    if (prefixMatch) {
      const prefix = prefixMatch[1].trim().replace(/^~/, os.homedir())
      if (!prefix.startsWith(os.homedir()) || prefix.includes('Desktop')) {
        warn(`检测到 ~/.npmrc prefix=${prefix} 指向非默认位置，可能使 pnpm store 落错目录；建议清理该 prefix 行`)
      }
    }
  }
  return best
}

function pnpmArgs(extra = []) {
  const storeDir = detectStoreDir()
  return storeDir ? ['--store-dir', storeDir, ...extra] : extra
}

// ---------- 1. 环境检查 ----------
step('1/8 环境检查', () => {
  const nodeVersion = process.versions.node
  const nodeMajor = Number(nodeVersion.split('.')[0])
  if (nodeMajor < MIN_NODE) {
    throw new Error(`Node 版本过低：${nodeVersion}，需要 >= ${MIN_NODE}`)
  }
  ok(`Node ${nodeVersion}`)
  if (nodeMajor !== RECOMMEND_NODE_MAJOR) {
    warn(`Node 主版本 ${nodeMajor} ≠ Vercel 使用的 ${RECOMMEND_NODE_MAJOR}，建议安装 Node ${RECOMMEND_NODE_MAJOR}（brew install node@24）`)
  }

  const pnpmVer = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
  if (pnpmVer.status === 0 && EXPECTED_PNPM && pnpmVer.stdout.trim() !== EXPECTED_PNPM) {
    warn(`当前 pnpm ${pnpmVer.stdout.trim()} ≠ 项目锁定 ${EXPECTED_PNPM}；脚本将用 ${EXPECTED_PNPM} 执行 install，避免 lock 漂移`)
  }
  ok(`项目锁定 pnpm ${EXPECTED_PNPM || '(packageManager 缺失)'}`)

  const vercel = spawnSync('pnpm', ['exec', 'vercel', '--version'], { cwd: codeRoot, encoding: 'utf8' })
  if (vercel.status === 0) {
    ok(`Vercel CLI ${vercel.stdout.trim()}`)
  } else {
    warn('Vercel CLI 未在 devDependencies 中检测到，后续 vercel link/env pull 步骤将失败（可先 pnpm add -D vercel）')
  }
})

// ---------- 2. 软链检查与清理 ----------
step('2/8 清理 node_modules 软链', () => {
  const nm = path.join(codeRoot, 'node_modules')
  if (isSymlink(nm)) {
    const target = fs.readlinkSync(nm)
    fs.unlinkSync(nm)
    ok(`已删除软链 node_modules -> ${target}`)
  } else if (fs.existsSync(nm)) {
    warn('node_modules 为真实目录，未删除（--skip-install 时保留；如需全量重装请手动 rm -rf）')
  } else {
    warn('node_modules 不存在，跳过')
  }
})

// ---------- 3. 锁文件重装 ----------
step('3/8 依赖安装（--frozen-lockfile）', () => {
  if (SKIP_INSTALL) {
    warn('跳过安装（--skip-install）')
    return
  }
  const [bin, ...rest] = pnpmCommand()
  const argsList = [...rest, 'install', '--frozen-lockfile', ...pnpmArgs()]
  ok(`执行：${[bin, ...argsList].join(' ')}（预计 2-8 分钟）`)
  const result = spawnSync(bin, argsList, {
    cwd: codeRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, COREPACK_ENABLE_STRICT: '0' },
    timeoutMs: 15 * 60 * 1000,
  })
  if (result.status !== 0) {
    throw new Error(`pnpm install 失败（退出码 ${result.status}）`)
  }
  ok('依赖安装完成')
})

// ---------- 4. Vercel 关联 ----------
step('4/8 Vercel 项目关联', () => {
  const vercelDir = path.join(codeRoot, '.vercel')
  const projectJson = path.join(vercelDir, 'project.json')
  if (fs.existsSync(projectJson)) {
    const proj = JSON.parse(fs.readFileSync(projectJson, 'utf8'))
    ok(`已关联 Vercel 项目 ${proj.projectName || proj.projectId}`)
    return
  }
  warn('.vercel/project.json 缺失：请运行 `pnpm exec vercel link` 关联 cyanlog-sales-v3（rootDirectory=product-truth/product-code）后重试')
  failures += 1
})

// ---------- 5. 拉取环境变量 ----------
step('5/8 环境变量', () => {
  const vercelDir = path.join(codeRoot, '.vercel')
  if (fs.existsSync(path.join(vercelDir, '.env.development.local'))) {
    ok('.vercel/.env.development.local 已存在')
  } else {
    if (fs.existsSync(path.join(vercelDir, 'project.json'))) {
      run('pnpm', ['exec', 'vercel', 'env', 'pull', '.vercel/.env.development.local', '--environment=development', '--yes'])
      ok('已从 Vercel 拉取 .vercel/.env.development.local')
    } else {
      warn('缺少 .vercel/project.json，无法自动拉取 env')
      failures += 1
    }
  }

  const localEnv = path.join(codeRoot, '.env.local')
  if (fs.existsSync(localEnv)) {
    ok('.env.local 已存在')
  } else {
    const requiredLocal = ['AI_GATEWAY_URL', 'AI_GATEWAY_API_KEY', 'AI_MODEL']
    warn(`.env.local 缺失：请从密码管理器恢复以下密钥并创建 ${path.join('product-truth/product-code', '.env.local')}：\n  ${requiredLocal.join('\n  ')}`)
    failures += 1
  }
})

// ---------- 6. env:check ----------
step('6/8 环境变量校验', () => {
  run('pnpm', ['env:check'])
  ok('env:check 通过')
})

// ---------- 7. 测试 ----------
step('7/8 全量测试', () => {
  if (SKIP_TEST) {
    warn('跳过测试（--skip-test）')
    return
  }
  run('pnpm', ['test:run'], { timeoutMs: 20 * 60 * 1000 })
  ok('测试通过')
})

// ---------- 8. 构建 ----------
step('8/8 构建', () => {
  if (SKIP_BUILD) {
    warn('跳过构建（--skip-build）')
    return
  }
  run('pnpm', ['build'], { timeoutMs: 20 * 60 * 1000 })
  ok('构建通过')
})

process.stdout.write(`\n${'='.repeat(60)}\n`)
if (failures === 0) {
  process.stdout.write('✅ 换机还原完成。启动开发：pnpm dev -p 3100\n')
  process.exit(0)
} else {
  process.stdout.write(`❌ 完成但有 ${failures} 项失败，见上方 ⚠/✗。\n`)
  process.exit(1)
}

// REQ: F054 / WP97. One reviewed core, independently configurable workflow nodes.
// Run with Node 24+: node --experimental-transform-types .../build-apl.mjs config.json output.groovy
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { fxiaokeAplEndpointSchema, fxiaokeAplMappingSchema } from '../contracts.ts'

const placeholder = 'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS'
const start = '// BEGIN TENANT CONFIG'
const end = '// END TENANT CONFIG'

export function renderApl(config, template = readFileSync(new URL('./fxiaoke-approval-intake.groovy', import.meta.url), 'utf8')) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置必须是 JSON 对象')
  const { mode, environment, endpoint, ...mapping } = config
  if (!['preflight', 'create'].includes(mode)) throw new Error('mode 必须为 preflight 或 create')
  if (!['development', 'production'].includes(environment)) throw new Error('environment 必须为 development 或 production')
  // Secrets are provisioned in the platform, never accepted by the artifact generator.
  if (!endpoint || endpoint.clientSecret !== placeholder) throw new Error('生成配置仅允许密钥占位符；请在纷享服务端配置实际密钥')
  const { clientSecret: _secret, ...publicEndpoint } = endpoint
  const parsedEndpoint = fxiaokeAplEndpointSchema.safeParse(publicEndpoint)
  const parsedMapping = fxiaokeAplMappingSchema.safeParse(mapping)
  if (!parsedEndpoint.success || !parsedMapping.success) {
    const fields = [
      ...(parsedEndpoint.success ? [] : parsedEndpoint.error.issues.map(issue => `endpoint.${issue.path.join('.')}`)),
      ...(parsedMapping.success ? [] : parsedMapping.error.issues.map(issue => issue.path.join('.'))),
    ]
    throw new Error(`配置字段无效：${fields.join(', ')}`)
  }
  const normalized = { ...parsedMapping.data, mode, environment, endpoint: { ...parsedEndpoint.data, clientSecret: placeholder } }
  const { baseUrl } = normalized.endpoint
  if (environment === 'production' && baseUrl !== 'https://sales.cyanlog.icu') throw new Error('生产模式只能调用正式 ICU')
  if (environment === 'development' && !/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(baseUrl)) throw new Error('开发模式必须使用已核验的隔离 Preview 地址')
  if (normalized.workflow.stages.length !== 1) throw new Error('每个节点配置一个阶段；跨流程复用同一核心代码')
  if (normalized.shipmentDetailObject.shipment.recipient.kind !== 'fields') throw new Error('初态只支持结构化收件字段')
  if (normalized.shipmentDetailObject.parentRecordId.kind !== 'field') throw new Error('寄件明细的父记录必须来自真实字段')
  const pending = []
  function check(value, path = '') {
    if (typeof value === 'string' && /^(__CONFIGURE_|REPLACE_)/.test(value) && path !== 'endpoint.clientSecret') pending.push(path)
    if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => check(child, path ? `${path}.${key}` : key))
  }
  check(normalized)
  if (pending.length) throw new Error(`尚未填写：${pending.join(', ')}`)
  const a = template.indexOf(start)
  const b = template.indexOf(end)
  if (a < 0 || b <= a || template.indexOf(start, a + start.length) >= 0 || template.indexOf(end, b + end.length) >= 0) throw new Error('APL 模板配置边界无效')
  const core = template.slice(b + end.length)
  const coreSha256 = createHash('sha256').update(core).digest('hex')
  // A Groovy single-quoted literal has no dollar interpolation. Escape backslashes first.
  const literal = JSON.stringify(normalized).replaceAll('\\', '\\\\').replaceAll("'", "\\'")
  const source = template.slice(0, a) + `${start}\ndef CONFIG = Fx.json.parse('${literal}')\n${end}` + core
  return { source, coreSha256, mode, environment }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , input, output] = process.argv
    if (!input || !output) throw new Error('用法：node --experimental-transform-types build-apl.mjs config.json output.groovy')
    if (resolve(input) === resolve(output) || resolve(output) === fileURLToPath(new URL('./fxiaoke-approval-intake.groovy', import.meta.url))) throw new Error('输出不能覆盖配置或核心模板')
    const result = renderApl(JSON.parse(readFileSync(input, 'utf8')))
    writeFileSync(output, result.source, { flag: 'wx', mode: 0o600 })
    process.stdout.write(JSON.stringify({ output, coreSha256: result.coreSha256, mode: result.mode, environment: result.environment }) + '\n')
  } catch (error) {
    process.stderr.write((error instanceof SyntaxError ? '配置不是有效 JSON' : error.message) + '\n')
    process.exitCode = 1
  }
}

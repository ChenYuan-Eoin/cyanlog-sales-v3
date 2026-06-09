import fs from 'fs'
import path from 'path'

const rootDir = path.resolve(process.cwd())
const candidateFiles = [
  '.env.local',
  '.vercel/.env.development.local',
]

const requiredKeys = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

const optionalGroups = [
  {
    name: 'local-model',
    keys: ['LOCAL_MODEL_URL', 'LOCAL_MODEL_NAME'],
  },
  {
    name: 'cloud-fallback',
    keys: ['AI_GATEWAY_URL', 'AI_MODEL'],
  },
]

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const entries = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    entries[key] = value
  }

  return entries
}

const mergedEnv = { ...process.env }
const sources = {}

for (const relativePath of candidateFiles) {
  const absolutePath = path.join(rootDir, relativePath)
  const parsed = parseEnvFile(absolutePath)
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in mergedEnv) || !mergedEnv[key]) {
      mergedEnv[key] = value
    }
    if (value) {
      sources[key] = relativePath
    }
  }
}

for (const key of Object.keys(process.env)) {
  if (process.env[key]) {
    sources[key] = 'process.env'
  }
}

const missingRequired = requiredKeys.filter((key) => !mergedEnv[key])

console.log('Environment check')
console.log(`cwd: ${rootDir}`)
console.log(`files scanned: ${candidateFiles.join(', ')}`)
console.log('')

for (const key of requiredKeys) {
  const source = sources[key]
  console.log(`${missingRequired.includes(key) ? 'MISSING' : 'OK     '}  ${key}${source ? ` (${source})` : ''}`)
}

console.log('')

for (const group of optionalGroups) {
  const presentKeys = group.keys.filter((key) => Boolean(mergedEnv[key]))
  const missingKeys = group.keys.filter((key) => !mergedEnv[key])
  const status = missingKeys.length === 0 ? 'OK' : presentKeys.length === 0 ? 'WARN' : 'PARTIAL'
  console.log(`${status.padEnd(7)} ${group.name}: ${group.keys.join(', ')}`)
}

if (missingRequired.length > 0) {
  console.error('')
  console.error(`Missing required keys: ${missingRequired.join(', ')}`)
  process.exit(1)
}

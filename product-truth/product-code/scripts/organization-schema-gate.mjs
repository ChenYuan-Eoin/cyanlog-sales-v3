import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'

const root = resolve(process.cwd())
const directory = resolve(root, 'lib/organization-connections/schema-baseline')
const quote = value => `"${String(value).replaceAll('"', '""')}"`
const role = value => value === 'PUBLIC' ? 'PUBLIC' : quote(value)
const qualified = object => `${quote(object.schema)}.${quote(object.name)}`
const signature = object => `${qualified(object)}(${object.arguments})`
const grants = (items, target) => (items ?? []).map(g => `grant ${g.privilege} on ${target} to ${role(g.role)}${g.grantable ? ' with grant option' : ''};`)
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const migrationPaths = [
  'supabase/migrations/20261103090000_unified_organization_connections.sql',
  'supabase/migrations/20261103120000_organization_directory_cutover.sql',
]
export const migrationHashes = () => Object.fromEntries(migrationPaths.map(path => [path, sha256(readFileSync(resolve(root, path)))]))

// Columns are ordered. Catalog sets are not: ordering varies with database locale and role OIDs.
export function canonical(value, key = '') {
  if (Array.isArray(value)) {
    const array = value.map(item => canonical(item))
    return ['grants', 'roles', 'indexes', 'constraints', 'functions', 'schemas', 'tables', 'triggers', 'policies', 'defaultPrivileges'].includes(key)
      ? array.sort((a, b) => { const left = JSON.stringify(a); const right = JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0 })
      : array
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k], k)]))
  return value
}
export const catalogHash = catalog => sha256(JSON.stringify(canonical(catalog)))

export function renderBaseline(snapshot, { bootstrapRole = 'postgres' } = {}) {
  const c = snapshot.catalog
  const sql = ['set search_path = public;', 'set check_function_bodies = false;']
  for (const r of c.roles) {
    if (r.name.startsWith('pg_') || r.name === bootstrapRole) continue
    sql.push(`do $$ begin if not exists (select from pg_roles where rolname = '${r.name.replaceAll("'", "''")}') then create role ${quote(r.name)}; end if; end $$;`)
    sql.push(`alter role ${quote(r.name)} ${r.superuser ? '' : 'no'}superuser ${r.bypassRls ? '' : 'no'}bypassrls ${r.inherit ? '' : 'no'}inherit ${r.createDb ? '' : 'no'}createdb ${r.createRole ? '' : 'no'}createrole;`)
  }
  const allRoles = ['PUBLIC', ...c.roles.map(r => r.name)].map(role).join(', ')
  for (const s of c.schemas) {
    sql.push(`create schema if not exists ${quote(s.name)};`, `alter schema ${quote(s.name)} owner to ${quote(s.owner)};`)
    sql.push(`revoke all on schema ${quote(s.name)} from ${allRoles};`, ...grants(s.grants, `schema ${quote(s.name)}`))
  }
  for (const t of c.tables) {
    const columns = t.columns.map(a => {
      if (a.identity || a.generated || a.collation) throw new Error(`Unsupported captured column must be handled explicitly: ${t.name}.${a.name}`)
      return `${quote(a.name)} ${a.type}${a.default === null ? '' : ` default ${a.default}`}${a.notNull ? ' not null' : ''}`
    })
    sql.push(`create table ${qualified(t)} (${columns.join(',\n')});`)
  }
  for (const t of c.tables) {
    for (const con of t.constraints.filter(con => con.type !== 'f')) sql.push(`alter table ${qualified(t)} add constraint ${quote(con.name)} ${con.definition};`)
    sql.push(...t.indexes.map(index => `${index};`))
  }
  for (const t of c.tables) for (const con of t.constraints.filter(con => con.type === 'f')) sql.push(`alter table ${qualified(t)} add constraint ${quote(con.name)} ${con.definition};`)
  for (const f of c.functions) {
    sql.push(`${f.definition};`, `alter function ${signature(f)} owner to ${quote(f.owner)};`)
    sql.push(`revoke all on function ${signature(f)} from ${allRoles};`, ...grants(f.grants, `function ${signature(f)}`))
  }
  for (const t of c.tables) {
    for (const trigger of t.triggers) {
      sql.push(`${trigger.definition};`)
      const mode = { O: 'enable', D: 'disable', A: 'enable always', R: 'enable replica' }[trigger.enabled]
      if (!mode) throw new Error('Unsupported trigger mode')
      sql.push(`alter table ${qualified(t)} ${mode} trigger ${quote(trigger.name)};`)
    }
    for (const p of t.policies) {
      const command = { '*': 'all', r: 'select', a: 'insert', w: 'update', d: 'delete' }[p.command]
      sql.push(`create policy ${quote(p.name)} on ${qualified(t)} as ${p.permissive ? 'permissive' : 'restrictive'} for ${command} to ${p.roles.map(role).join(', ')}${p.using ? ` using (${p.using})` : ''}${p.check ? ` with check (${p.check})` : ''};`)
    }
    sql.push(`alter table ${qualified(t)} owner to ${quote(t.owner)};`, `alter table ${qualified(t)} ${t.rls ? 'enable' : 'disable'} row level security;`, `alter table ${qualified(t)} ${t.forceRls ? 'force' : 'no force'} row level security;`)
    sql.push(`revoke all on ${qualified(t)} from ${allRoles};`, ...grants(t.grants, qualified(t)))
  }
  for (const d of c.defaultPrivileges) {
    const target = { r: 'tables', f: 'functions', S: 'sequences' }[d.type]
    if (!target) throw new Error('Unsupported default privilege type')
    const prefix = `alter default privileges for role ${quote(d.owner)}${d.schema ? ` in schema ${quote(d.schema)}` : ''}`
    for (const g of d.grants) sql.push(`${prefix} grant ${g.privilege} on ${target} to ${role(g.role)}${g.grantable ? ' with grant option' : ''};`)
  }
  sql.push('set check_function_bodies = true;')
  return sql.join('\n')
}

/** @param {object} snapshot @param {{head: string, now?: number, baseline: {catalog: object}}} options */
export function verifySnapshot(snapshot, { head, now = Date.now(), baseline }) {
  if (snapshot.projectId !== 'wfawwhphfqqwfwrrkogy' || snapshot.format !== 1) throw new Error('Wrong production schema export')
  const age = now - Date.parse(snapshot.capturedAt)
  if (!Number.isFinite(age) || age < -60_000 || age > 3_600_000) throw new Error('Production schema export is missing or stale')
  if (snapshot.candidateSha !== head || !/^[a-f0-9]{40}$/.test(head ?? '')) throw new Error('Schema export is not bound to the candidate SHA')
  if (snapshot.captureQuerySha256 !== sha256(readFileSync(resolve(directory, 'capture.sql')))) throw new Error('Schema capture query changed')
  if (catalogHash(snapshot.catalog) !== catalogHash(baseline.catalog)) throw new Error('Production DDL drift: refresh and review the baseline before release')
  if (JSON.stringify(canonical(snapshot.migrations)) !== JSON.stringify(canonical(migrationHashes()))) throw new Error('Migration content changed after capture')
  return { status: 'passed', candidateSha: head, capturedAt: snapshot.capturedAt, catalogSha256: catalogHash(snapshot.catalog), migrations: snapshot.migrations }
}

export function reviewSql() {
  const review = JSON.parse(readFileSync(resolve(directory, 'sql-review.json'), 'utf8'))
  if (review.status !== 'approved' || !review.reviewer || !review.findings?.length) throw new Error('Explicit SQL review missing')
  const baseline = JSON.parse(readFileSync(resolve(directory, 'production.json'), 'utf8'))
  if (review.catalogSha256 !== catalogHash(baseline.catalog)) throw new Error('SQL review does not match the Production schema baseline')
  if (JSON.stringify(canonical(review.migrations)) !== JSON.stringify(canonical(migrationHashes()))) throw new Error('SQL review is stale for current migrations')
  const sql = readFileSync(resolve(root, migrationPaths[1]), 'utf8')
  if (!/insert into public\.user_organizations\(\s*membership_id,/.test(sql)) throw new Error('Membership ID must be explicit')
  if (!/select gen_random_uuid\(\), v_user_id/.test(sql)) throw new Error('Membership UUID must be generated explicitly by the application SQL')
  for (const name of ['update_department_path', 'update_dept_member_count']) {
    const body = sql.split(`create or replace function public.${name}()`)[1]?.split('$$;')[0]
    if (!body?.includes("set search_path = ''") || !body.includes('public.departments') || /(?:from|update)\s+departments\b/i.test(body)) throw new Error(`Unqualified trigger table: ${name}`)
  }
  return { status: 'passed', reviewer: review.reviewer, migrations: review.migrations, findings: review.findings }
}

if (import.meta.url.startsWith('file:') && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, input, output] = process.argv.slice(2)
  const baseline = JSON.parse(readFileSync(resolve(directory, 'production.json'), 'utf8'))
  if (command === 'render') process.stdout.write(renderBaseline(baseline))
  else if (command === 'pack') {
    // Input must be the fresh catalog returned by capture.sql; never use the baseline as a live read.
    const snapshot = JSON.parse(readFileSync(input, 'utf8'))
    snapshot.candidateSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    snapshot.captureQuerySha256 = sha256(readFileSync(resolve(directory, 'capture.sql')))
    snapshot.migrations = migrationHashes()
    verifySnapshot(snapshot, { baseline, head: snapshot.candidateSha })
    writeFileSync(output, gzipSync(JSON.stringify(snapshot)).toString('base64'))
  } else if (command === 'drift') {
    const snapshot = input === '--env'
      ? JSON.parse(gunzipSync(Buffer.from(process.env.PRODUCTION_SCHEMA_EXPORT ?? '', 'base64')).toString())
      : JSON.parse(readFileSync(input, 'utf8'))
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    process.stdout.write(JSON.stringify(verifySnapshot(snapshot, { baseline, head }), null, 2) + '\n')
  } else if (command === 'review') process.stdout.write(JSON.stringify(reviewSql(), null, 2) + '\n')
  else throw new Error('Expected render, pack <fresh-export.json> <payload.txt>, drift <snapshot.json|--env>, or review')
}

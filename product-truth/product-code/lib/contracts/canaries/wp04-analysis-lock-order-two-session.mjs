// Executable Preview-only two-session proof for the former 40P01 cycle.
//
// Usage (only after 20260721241000 is applied to the isolated Preview):
//   WP04_PREVIEW_DATABASE_URL='postgresql://...' \
//     node lib/contracts/canaries/wp04-analysis-lock-order-two-session.mjs
//
// The connection string must contain the isolated project ref. The script
// creates one fixture, commits it so both sessions can see it, and always
// deletes it before disconnecting.

import { randomUUID } from 'node:crypto'
import pg from 'pg'

const { Client } = pg
const connectionString = process.env.WP04_PREVIEW_DATABASE_URL
const previewProjectRef = process.env.WP04_PREVIEW_PROJECT_REF
  ?? 'vsfropnfsmnonkotywsx'

if (!connectionString) {
  throw new Error('WP04_PREVIEW_DATABASE_URL is required')
}
if (!connectionString.includes(previewProjectRef)) {
  throw new Error(
    `Refusing non-Preview database URL; expected project ref ${previewProjectRef}`,
  )
}

const ids = {
  org: randomUUID(),
  user: randomUUID(),
  contract: randomUUID(),
  version: randomUUID(),
  token: randomUUID(),
}
const sourceText = 'WP04 two-session lock order source'
const fileHash = '2'.repeat(64)
const slug = `wp04-lock-${ids.contract.slice(0, 8)}`

const clients = {
  setup: new Client({ connectionString, application_name: 'wp04-lock-setup' }),
  sessionA: new Client({ connectionString, application_name: 'wp04-lock-start' }),
  sessionB: new Client({ connectionString, application_name: 'wp04-lock-worker' }),
  monitor: new Client({ connectionString, application_name: 'wp04-lock-monitor' }),
}

let sessionATransaction = false
let sessionBTransaction = false
let fixtureCommitted = false

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds)
})

async function waitUntilBlocked(pid) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await clients.monitor.query(
      `select exists (
         select 1
           from pg_catalog.pg_locks
          where pid = $1
            and not granted
       ) as blocked`,
      [pid],
    )
    if (result.rows[0]?.blocked) return
    await wait(25)
  }
  throw new Error('worker session did not block on the contract row as expected')
}

async function createFixture() {
  await clients.setup.query('begin')
  await clients.setup.query("set local lock_timeout = '5s'")
  await clients.setup.query("set local statement_timeout = '30s'")

  const identity = await clients.setup.query(
    `select private.wp04_expected_source_upload_id($1::uuid, $2::text) as upload_id,
            pg_catalog.encode(
              extensions.digest(pg_catalog.convert_to($3::text, 'UTF8'), 'sha256'),
              'hex'
            ) as text_hash`,
    [ids.contract, fileHash, sourceText],
  )
  const uploadId = identity.rows[0].upload_id
  const textHash = identity.rows[0].text_hash
  const sourcePath = `${ids.contract}/${uploadId}/source`

  await clients.setup.query(
    'insert into public.organizations (id, name, slug) values ($1, $2, $3)',
    [ids.org, 'WP04 two-session lock canary', slug],
  )
  await clients.setup.query(
    'insert into public.users (id, org_id, display_name) values ($1, $2, $3)',
    [ids.user, ids.org, 'WP04 two-session lock user'],
  )
  await clients.setup.query(
    `insert into public.user_organizations (user_id, org_id, is_default)
     values ($1, $2, true)`,
    [ids.user, ids.org],
  )
  await clients.setup.query(
    `insert into public.contracts (
       id, filename, storage_path, size, mime_type, status, parsed_text,
       created_by, org_id
     ) values (
       $1, 'wp04-two-session.docx', $2, 241,
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'PENDING', $3, $4, $5
     )`,
    [ids.contract, sourcePath, sourceText, ids.user, ids.org],
  )
  await clients.setup.query(
    `insert into public.contract_versions (
       id, contract_id, version_number, source, storage_path, file_size,
       mime_type, uploaded_by, upload_id, file_sha256, text_sha256,
       parsed_text, ingest_status
     ) values (
       $1, $2, 1, 'original', $3, 241,
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       $4, $5, $6, $7, $8, 'SOURCE_READY'
     )`,
    [ids.version, ids.contract, sourcePath, ids.user, uploadId, fileHash, textHash, sourceText],
  )
  await clients.setup.query(
    'update public.contracts set current_version_id = $2 where id = $1',
    [ids.contract, ids.version],
  )
  await clients.setup.query(
    `insert into public.contract_source_page_maps (
       contract_id, contract_version_id, storage_path, source_hash,
       source_text_hash, render_mode, page_count, locator, page_map
     ) values (
       $1, $2, $3, $4, $5, 'browser-ooxml', 1, 'provisional', $6::jsonb
     )`,
    [
      ids.contract,
      ids.version,
      sourcePath,
      fileHash,
      textHash,
      JSON.stringify([{ page: 1, start: 0, end: sourceText.length, locator: 'provisional' }]),
    ],
  )

  const started = await clients.setup.query(
    `select *
       from public.start_initial_contract_review_fenced(
         $1, $2, $3, $4, 'PENDING', null, $5, $6
       )`,
    [ids.org, ids.contract, ids.version, ids.user, uploadId, fileHash],
  )
  if (started.rowCount !== 1 || !started.rows[0].should_process) {
    throw new Error('fixture ReviewRun/job was not created exactly once')
  }

  const reviewId = started.rows[0].review_id
  const jobId = started.rows[0].job_id
  const claimed = await clients.setup.query(
    'select * from public.claim_contract_analysis_job_by_id($1, $2, $3)',
    [jobId, 'wp04-lock-two-session', ids.token],
  )
  if (claimed.rowCount !== 1) {
    throw new Error('fixture analysis lease was not claimed')
  }

  await clients.setup.query('commit')
  fixtureCommitted = true
  return { reviewId, jobId }
}

async function proveLockOrder({ reviewId, jobId }) {
  const workerPid = Number((await clients.sessionB.query(
    'select pg_catalog.pg_backend_pid() as pid',
  )).rows[0].pid)

  await clients.sessionA.query('begin')
  sessionATransaction = true
  await clients.sessionA.query("set local lock_timeout = '8s'")
  await clients.sessionA.query("set local statement_timeout = '15s'")
  await clients.sessionA.query(
    'select id from public.contracts where id = $1 for update',
    [ids.contract],
  )

  await clients.sessionB.query('begin')
  sessionBTransaction = true
  await clients.sessionB.query("set local lock_timeout = '8s'")
  await clients.sessionB.query("set local statement_timeout = '15s'")

  // With the old implementation this statement first held job, then waited on
  // contract. Session A's start replay would then wait on job and PostgreSQL
  // would abort one side with 40P01. The repaired worker waits on contract
  // without retaining job/review locks.
  const workerOutcome = clients.sessionB.query(
    'select * from public.mark_contract_analysis_job_running($1, $2, $3)',
    [jobId, ids.token, 'wp04-lock-two-session'],
  ).then(
    (value) => ({ value }),
    (error) => ({ error }),
  )

  await waitUntilBlocked(workerPid)

  const replayed = await clients.sessionA.query(
    `select *
       from public.start_initial_contract_review(
         $1, $2, $3, $4, 'PARSING', null
       )`,
    [ids.org, ids.contract, ids.version, ids.user],
  )
  if (replayed.rowCount !== 1
      || replayed.rows[0].review_id !== reviewId
      || replayed.rows[0].job_id !== jobId
      || replayed.rows[0].should_process) {
    throw new Error('start replay changed the existing aggregate identity')
  }

  await clients.sessionA.query('commit')
  sessionATransaction = false

  const worker = await workerOutcome
  if (worker.error) throw worker.error
  if (worker.value.rowCount !== 1) {
    throw new Error('worker did not resume exactly once after contract release')
  }
  await clients.sessionB.query('commit')
  sessionBTransaction = false

  const final = await clients.setup.query(
    `select contract.status as contract_status,
            review.status as review_status,
            job.status as job_status,
            count(*) over ()::integer as joined_rows,
            (select count(*)::integer from public.contract_reviews
              where contract_id = $1) as review_count,
            (select count(*)::integer from public.contract_analysis_jobs
              where contract_id = $1) as job_count
       from public.contracts as contract
       join public.contract_reviews as review
         on review.id = $2 and review.contract_id = contract.id
       join public.contract_analysis_jobs as job
         on job.id = $3
        and job.contract_id = contract.id
        and job.review_id = review.id
      where contract.id = $1`,
    [ids.contract, reviewId, jobId],
  )
  const state = final.rows[0]
  if (final.rowCount !== 1
      || state.joined_rows !== 1
      || state.review_count !== 1
      || state.job_count !== 1
      || state.contract_status !== 'ANALYZING'
      || state.review_status !== 'ANALYZING'
      || state.job_status !== 'running') {
    throw new Error(`unexpected final aggregate state: ${JSON.stringify(state)}`)
  }

  return state
}

async function cleanupFixture() {
  if (!fixtureCommitted) return
  await clients.setup.query('begin')
  await clients.setup.query('delete from public.contracts where id = $1', [ids.contract])
  await clients.setup.query(
    'delete from public.user_organizations where user_id = $1 and org_id = $2',
    [ids.user, ids.org],
  )
  await clients.setup.query('delete from public.users where id = $1', [ids.user])
  await clients.setup.query('delete from public.organizations where id = $1', [ids.org])
  await clients.setup.query('commit')
  fixtureCommitted = false
}

async function main() {
  await Promise.all(Object.values(clients).map((client) => client.connect()))
  try {
    const aggregate = await createFixture()
    const finalState = await proveLockOrder(aggregate)
    console.log(JSON.stringify({
      status: 'passed',
      project: previewProjectRef,
      lockOrder: 'contract-version-review-job',
      deadlockSqlstate: null,
      reviewRuns: finalState.review_count,
      analysisJobs: finalState.job_count,
      finalState: {
        contract: finalState.contract_status,
        review: finalState.review_status,
        job: finalState.job_status,
      },
    }))
  } finally {
    if (sessionATransaction) {
      await clients.sessionA.query('rollback').catch(() => {})
      sessionATransaction = false
    }
    if (sessionBTransaction) {
      await clients.sessionB.query('rollback').catch(() => {})
      sessionBTransaction = false
    }
    await cleanupFixture().catch((error) => {
      console.error(`WP04 fixture cleanup failed: ${error.message}`)
      process.exitCode = 1
    })
    await Promise.allSettled(Object.values(clients).map((client) => client.end()))
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: 'failed',
    sqlstate: error.code ?? null,
    message: error.message,
  }))
  process.exitCode = 1
})

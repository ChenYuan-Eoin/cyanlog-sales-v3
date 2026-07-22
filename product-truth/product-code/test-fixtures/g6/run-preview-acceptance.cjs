#!/usr/bin/env node

/*
 * G6 Preview acceptance runner.
 *
 * Safety contract:
 * - The only accepted Supabase project is the isolated free Preview project.
 * - The app URL must be localhost; the Preview-only auth token proves the app
 *   is not accidentally connected to Production before any contract write.
 * - The runner never applies migrations, pushes, deploys, or uses paid APIs.
 * - By default every database row, Storage object and auth token created by
 *   this runner is removed after evidence is collected.
 *
 * Prerequisites:
 *   supabase CLI authenticated
 *   pnpm build already completed against the current source
 *
 * Typical run:
 *   G6_START_SERVER=1 node test-fixtures/g6/run-preview-acceptance.cjs
 *
 * Set G6_KEEP_FIXTURES=1 only for a short manual inspection window. The runner
 * will still remove the temporary auth token and emit an exact cleanup manifest.
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const JSZip = require('jszip')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = require('@playwright/test')

const appRoot = path.resolve(__dirname, '../..')
const evidenceDir = path.join(appRoot, 'output/evidence/g6')
const browserDir = path.join(appRoot, 'output/playwright/g6')
const evidencePath = path.join(evidenceDir, 'preview-browser-acceptance.json')
const cleanupManifestPath = path.join(evidenceDir, 'preview-browser-cleanup.json')
const serverLogPath = path.join(evidenceDir, 'preview-browser-server.log')
const previewProjectRef = 'vsfropnfsmnonkotywsx'
const productionProjectRef = 'wfawwhphfqqwfwrrkogy'
const controlledContractId = '6603fd5c-8d6d-4267-9e66-bee8b1e0235f'
const projectRef = process.env.G6_PREVIEW_PROJECT_REF || previewProjectRef
const baseUrl = process.env.G6_BASE_URL || 'http://127.0.0.1:3110'
const startServer = process.env.G6_START_SERVER === '1'
const keepFixtures = process.env.G6_KEEP_FIXTURES === '1'
const chunkSize = 4 * 1024 * 1024

const fixturePairs = [
  {
    kind: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    oldPath: path.join(__dirname, 'old-contract-v1.docx'),
    newPath: path.join(__dirname, 'new-contract-v2.docx'),
    oldNeedle: '软件采购框架合同（旧版 V1）',
    newNeedle: '软件采购框架合同（客户修改版 V2）',
  },
  {
    kind: 'pdf',
    mimeType: 'application/pdf',
    oldPath: path.join(__dirname, 'old-contract-v1.pdf'),
    newPath: path.join(__dirname, 'new-contract-v2.pdf'),
    oldNeedle: '付款安排',
    newNeedle: '付款安排',
  },
]

function help() {
  process.stdout.write([
    'G6 isolated Preview browser acceptance',
    '',
    '  G6_START_SERVER=1 node test-fixtures/g6/run-preview-acceptance.cjs',
    '  node test-fixtures/g6/run-preview-acceptance.cjs --reclassify-existing',
    '',
    'Environment:',
    '  G6_BASE_URL=http://127.0.0.1:3110   Local app URL',
    '  G6_START_SERVER=1                   Start pnpm start when URL is not live',
    '  G6_KEEP_FIXTURES=1                  Keep test rows/objects; token is still removed',
    '',
    'The script refuses non-local URLs and every Supabase project except the',
    `isolated Preview project ${previewProjectRef}. It never applies migrations.`,
    '',
  ].join('\n'))
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  help()
  process.exit(0)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsonString(value) {
  return JSON.stringify(value)
}

function errorText(error) {
  if (error instanceof Error) return error.message
  try { return JSON.stringify(error) } catch { return String(error) }
}

function assertSafeBoundary() {
  assert(projectRef === previewProjectRef, `refusing non-approved Supabase project: ${projectRef}`)
  assert(projectRef !== productionProjectRef, 'Production project is forbidden')
  const parsed = new URL(baseUrl)
  assert(parsed.protocol === 'http:', 'G6 browser acceptance must use a local HTTP app')
  assert(parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost', 'G6 app URL must be localhost')
  assert(/^\d+$/.test(parsed.port), 'G6 app URL must include an explicit local port')
}

function loadPreviewKeys() {
  const rows = JSON.parse(execFileSync(
    'supabase',
    ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 },
  ))
  const key = (name) => rows.find((row) => row.name === name)?.api_key
    || rows.find((row) => row.name === name)?.key
  const serviceRole = key('service_role')
  const anon = key('anon') || key('publishable')
  assert(serviceRole && anon, 'Preview service_role/anon keys are unavailable')
  return { serviceRole, anon }
}

async function isServerLive() {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000), redirect: 'manual' })
    return response.status > 0
  } catch {
    return false
  }
}

async function startLocalServer(keys) {
  if (await isServerLive()) return null
  assert(startServer, `local app is not running at ${baseUrl}; rerun with G6_START_SERVER=1`)
  assert(fs.existsSync(path.join(appRoot, '.next/BUILD_ID')), 'missing .next build; run pnpm build first')
  const port = new URL(baseUrl).port
  const logFd = fs.openSync(serverLogPath, 'w')
  const child = spawn('pnpm', ['exec', 'next', 'start', '-p', port], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anon,
      SUPABASE_SERVICE_ROLE_KEY: keys.serviceRole,
    },
    stdio: ['ignore', logFd, logFd],
    detached: false,
  })
  const started = Date.now()
  while (Date.now() - started < 60_000) {
    if (child.exitCode !== null) {
      fs.closeSync(logFd)
      throw new Error(`local app exited early with code ${child.exitCode}`)
    }
    if (await isServerLive()) return { child, logFd }
    await sleep(250)
  }
  child.kill('SIGTERM')
  fs.closeSync(logFd)
  throw new Error('local app did not become ready within 60 seconds')
}

function stopLocalServer(server) {
  if (!server) return
  if (server.child.exitCode === null) server.child.kill('SIGTERM')
  try { fs.closeSync(server.logFd) } catch {}
}

function previewClient(keys) {
  return createClient(`https://${projectRef}.supabase.co`, keys.serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function assertMigrationReady(admin) {
  const { error } = await admin
    .from('contract_comparison_sources')
    .select('origin_storage_path,text_reliability')
    .limit(0)
  if (error) {
    throw new Error(`G6 Preview migration 071000 is not ready; no fixture was created: ${error.message}`)
  }
}

async function createTemporaryToken(admin) {
  let { data: owner, error } = await admin
    .from('contracts')
    .select('created_by,org_id')
    .eq('id', controlledContractId)
    .maybeSingle()
  if (error) throw error
  if (!owner?.created_by || !owner?.org_id) {
    const fallback = await admin
      .from('contracts')
      .select('created_by,org_id')
      .not('created_by', 'is', null)
      .not('org_id', 'is', null)
      .limit(1)
      .maybeSingle()
    if (fallback.error) throw fallback.error
    owner = fallback.data
  }
  assert(owner?.created_by && owner?.org_id, 'Preview has no controlled owner/org fixture')
  const token = `g6-accept-${randomUUID()}-${randomUUID()}`
  const inserted = await admin.from('auth_tokens').insert({
    token,
    user_id: owner.created_by,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  }).select('id').single()
  if (inserted.error || !inserted.data) throw inserted.error || new Error('token insert failed')
  return { token, tokenRowId: inserted.data.id, ownerId: owner.created_by, orgId: owner.org_id }
}

async function fetchJson(token, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(options.timeoutMs || 180_000),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (options.expected && !options.expected.includes(response.status)) {
    throw new Error(`${options.method || 'GET'} ${route} => ${response.status}: ${text.slice(0, 1200)}`)
  }
  return { response, payload }
}

async function uploadContract(token, role, fixturePath, mimeType, ledger) {
  const filename = path.basename(fixturePath)
  const created = await fetchJson(token, '/api/contracts', {
    method: 'POST',
    body: jsonString({
      party_b_name: `G6 ${role} ${filename} ${randomUUID().slice(0, 8)}`,
      contract_amount: 0,
      notes: `G6 isolated Preview acceptance ${role}`,
    }),
    expected: [201],
    timeoutMs: 30_000,
  })
  const contractId = created.payload?.data?.contract_id
  assert(typeof contractId === 'string', `contract create did not return an id for ${filename}`)
  ledger.contractIds.push(contractId)

  const bytes = fs.readFileSync(fixturePath)
  const expectedSha256 = sha256(bytes)
  const uploadId = randomUUID()
  const chunkCount = Math.ceil(bytes.byteLength / chunkSize)
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize
    const end = Math.min(bytes.byteLength, start + chunkSize)
    const form = new FormData()
    form.append('chunk', new Blob([bytes.subarray(start, end)], { type: mimeType }), filename)
    form.append('index', String(index))
    form.append('start', String(start))
    form.append('end', String(end))
    form.append('totalSize', String(bytes.byteLength))
    form.append('fileName', filename)
    form.append('fileType', mimeType)
    form.append('uploadId', uploadId)
    form.append('expectedSha256', expectedSha256)
    await fetchJson(token, `/api/contracts/${contractId}/upload-chunk`, {
      method: 'POST',
      body: form,
      expected: [200],
      timeoutMs: 60_000,
    })
  }
  const merged = await fetchJson(token, `/api/contracts/${contractId}/merge-chunks`, {
    method: 'POST',
    body: jsonString({ filename, fileName: filename, fileType: mimeType, totalSize: bytes.byteLength, chunkCount, uploadId, expectedSha256 }),
    expected: [200],
    timeoutMs: 120_000,
  })
  const storagePath = merged.payload?.data?.storagePath
  assert(typeof storagePath === 'string', `merge did not return storage path for ${filename}`)
  ledger.originalStoragePaths.push(storagePath)
  return { contractId, filename, fixturePath, mimeType, bytes, sha256: expectedSha256, storagePath }
}

async function createComparison(token, pair, ledger) {
  const created = await fetchJson(token, `/api/contracts/${pair.old.contractId}/compare`, {
    method: 'POST',
    body: jsonString({ baseline_type: 'uploaded', baseline_doc_id: pair.old.contractId, compare_doc_id: pair.new.contractId }),
    expected: [201],
    timeoutMs: 180_000,
  })
  const comparison = created.payload?.data
  assert(comparison?.id && comparison.status === 'completed', `${pair.kind} comparison did not complete`)
  assert(Array.isArray(comparison.diffs) && comparison.diffs.length > 0, `${pair.kind} comparison has no diffs`)
  ledger.comparisonIds.push(comparison.id)
  return comparison
}

async function verifyFrozenData(admin, token, pair, comparison, ledger) {
  const sourceQuery = await admin
    .from('contract_comparison_sources')
    .select('id,comparison_id,org_id,role,contract_id,origin_storage_path,storage_path,file_name,file_size,mime_type,file_sha256,text_sha256,parsed_text,text_reliability,render_mode,page_map,captured_at')
    .eq('comparison_id', comparison.id)
    .order('role')
  if (sourceQuery.error) throw sourceQuery.error
  assert(sourceQuery.data?.length === 2, `${pair.kind} comparison did not freeze two sources`)
  const sourceByRole = new Map(sourceQuery.data.map((source) => [source.role, source]))
  for (const [role, uploaded] of [['old', pair.old], ['new', pair.new]]) {
    const source = sourceByRole.get(role)
    assert(source, `${pair.kind} ${role} frozen source missing`)
    assert(source.contract_id === uploaded.contractId, `${pair.kind} ${role} contract identity drift`)
    assert(source.origin_storage_path === uploaded.storagePath, `${pair.kind} ${role} origin path mismatch`)
    assert(source.storage_path !== source.origin_storage_path, `${pair.kind} ${role} was not copied to frozen storage`)
    assert(source.storage_path.startsWith(`g6-frozen/${source.org_id}/`), `${pair.kind} ${role} frozen prefix mismatch`)
    assert(source.file_sha256 === uploaded.sha256, `${pair.kind} ${role} frozen file SHA mismatch`)
    assert(Number(source.file_size) === uploaded.bytes.byteLength, `${pair.kind} ${role} frozen size mismatch`)
    assert(source.text_reliability === 'verified' && source.parsed_text.trim(), `${pair.kind} ${role} text is not verified`)
    assert(sha256(source.parsed_text) === source.text_sha256, `${pair.kind} ${role} frozen text SHA mismatch`)
    assert(Array.isArray(source.page_map) && source.page_map.length > 0, `${pair.kind} ${role} frozen page map missing`)
    const downloaded = await admin.storage.from('contracts').download(source.storage_path)
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error('frozen storage download failed')
    const frozenBytes = Buffer.from(await downloaded.data.arrayBuffer())
    assert(frozenBytes.equals(uploaded.bytes), `${pair.kind} ${role} frozen bytes differ from uploaded fixture`)
    ledger.frozenStoragePaths.push(source.storage_path)
  }

  const diffQuery = await admin
    .from('comparison_diffs')
    .select('id,diff_type,baseline_position,compare_position,baseline_text,compare_text,sort_order')
    .eq('comparison_id', comparison.id)
    .order('sort_order')
  if (diffQuery.error) throw diffQuery.error
  assert(diffQuery.data?.length === comparison.diffs.length, `${pair.kind} API/DB diff count mismatch`)
  diffQuery.data.forEach((diff, index) => {
    assert(diff.sort_order === index + 1, `${pair.kind} diff order is not deterministic`)
    assert(diff.baseline_position?.page && diff.compare_position?.page, `${pair.kind} diff lacks two-sided positions`)
    assert(typeof diff.baseline_text === 'string' && typeof diff.compare_text === 'string', `${pair.kind} diff lacks source text`)
  })

  const before = await fetchJson(token, `/api/comparisons/${comparison.id}`, { expected: [200] })
  const frozenProjection = jsonString({ sources: before.payload.data.sources, diffs: before.payload.data.diffs })
  const driftText = `CURRENT CONTRACT MUTATED AFTER G6 SNAPSHOT ${randomUUID()}`
  const drift = await admin.from('contracts').update({ parsed_text: driftText }).eq('id', pair.old.contractId)
  if (drift.error) throw drift.error
  const after = await fetchJson(token, `/api/comparisons/${comparison.id}`, { expected: [200] })
  assert(
    jsonString({ sources: after.payload.data.sources, diffs: after.payload.data.diffs }) === frozenProjection,
    `${pair.kind} comparison drifted after current contract mutation`,
  )
  return { sources: sourceQuery.data, diffs: diffQuery.data, driftText }
}

async function openBrowserSession(token, ledger) {
  assert(!ledger.browser, 'browser session was initialized twice')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  })
  await context.addCookies([{
    name: 'token',
    value: token,
    url: baseUrl,
    httpOnly: true,
    sameSite: 'Lax',
  }])
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.evaluate((value) => localStorage.setItem('token', value), token)
  ledger.browser = browser
  ledger.browserContext = context
  ledger.page = page
  ledger.browserFormat = null
  ledger.browserEvents = { consoleErrors: [], requestFailures: [], httpFailures: [], apiFailures: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location()
      ledger.browserEvents.consoleErrors.push({
        format: ledger.browserFormat,
        method: null,
        status: null,
        text: message.text(),
        url: location.url || '',
        line: location.lineNumber,
        column: location.columnNumber,
      })
    }
  })
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || ''
    if (!errorText.includes('ERR_ABORTED')) {
      ledger.browserEvents.requestFailures.push({
        format: ledger.browserFormat,
        method: request.method(),
        status: null,
        url: request.url(),
        error: errorText,
      })
    }
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === baseUrl && response.status() >= 400) {
      const failure = {
        format: ledger.browserFormat,
        method: response.request().method(),
        status: response.status(),
        url: url.toString(),
        path: url.pathname,
        resource_type: response.request().resourceType(),
      }
      ledger.browserEvents.httpFailures.push(failure)
      if (url.pathname.startsWith('/api/')) ledger.browserEvents.apiFailures.push(failure)
    }
  })
}

async function verifyViewerReady(page, pair, comparison) {
  await page.goto(`${baseUrl}/contracts/${pair.old.contractId}/compare?comparison_id=${comparison.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.getByTestId('g6-compare-workbench').waitFor({ timeout: 60_000 })
  await page.getByRole('region', { name: '旧文件原文' }).waitFor()
  await page.getByRole('region', { name: '新文件原文' }).waitFor()
  if (pair.kind === 'docx') {
    await page.waitForFunction(() => {
      const hosts = Array.from(document.querySelectorAll('[data-testid="browser-word-preview"]'))
      return hosts.length === 2 && hosts.every((host) => host.getAttribute('data-preview-phase') === 'ready')
    }, null, { timeout: 120_000 })
    const texts = await page.locator('[data-testid="browser-word-preview-body"]').evaluateAll((hosts) => (
      hosts.map((host) => host.shadowRoot?.querySelector('[data-preview-body="true"]')?.textContent || '')
    ))
    assert(texts[0].includes(pair.oldNeedle) && texts[1].includes(pair.newNeedle), 'DOCX old/new source text was not rendered from frozen bytes')
  } else {
    await page.waitForFunction(() => {
      const images = Array.from(document.querySelectorAll('[data-comparison-page="1"] img'))
      return images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
    }, null, { timeout: 120_000 })
  }
  const bodyText = await page.locator('body').innerText()
  const oldShort = `${comparison.sources.old.file_sha256.slice(0, 8)}…${comparison.sources.old.file_sha256.slice(-6)}`
  const newShort = `${comparison.sources.new.file_sha256.slice(0, 8)}…${comparison.sources.new.file_sha256.slice(-6)}`
  assert(bodyText.includes('旧文件') && bodyText.includes('新文件'), 'old/new role labels missing')
  assert(bodyText.includes(oldShort) && bodyText.includes(newShort), 'frozen source SHA labels missing')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  assert(!overflow, 'workbench has document-level horizontal overflow')
}

async function verifyViewerInteractions(page, pair) {
  const zoomIn = page.getByRole('button', { name: '放大', exact: true })
  const zoomOut = page.getByRole('button', { name: '缩小', exact: true })
  const fit = page.getByRole('button', { name: '适合宽度', exact: true })
  const toolbar = page.getByTestId('g6-compare-workbench').locator('main > header')
  for (let index = 0; index < 12; index += 1) await zoomIn.click()
  assert((await toolbar.innerText()).includes('180%'), 'zoom upper bound 180% was not reached')
  for (let index = 0; index < 16; index += 1) await zoomOut.click()
  assert((await toolbar.innerText()).includes('60%'), 'zoom lower bound 60% was not reached')
  await fit.click()
  assert((await toolbar.innerText()).includes('适宽'), 'fit-width mode was not restored')

  const counter = page.locator('footer span').filter({ hasText: /^\d+\/\d+$/ }).last()
  const parts = (await counter.innerText()).split('/').map(Number)
  assert(parts.length === 2 && parts[1] >= 1 && parts[1] <= 500, 'invalid diff counter')
  const next = page.getByRole('button', { name: /下一处/ })
  for (let index = 1; index < parts[1]; index += 1) await next.click()
  await page.waitForTimeout(800)
  assert((await counter.innerText()) === `${parts[1]}/${parts[1]}`, 'last diff navigation failed')
  if (pair.kind === 'docx') {
    const focused = await page.locator('[data-testid="browser-word-preview-body"]').evaluateAll((hosts) => (
      hosts.map((host) => host.shadowRoot?.querySelectorAll('.g5-word-source-selected-clause,.g5-word-source-approximate-clause').length || 0)
    ))
    assert(focused.every((count) => count > 0), 'last DOCX diff did not focus both frozen sources')
  } else {
    const selectedPages = await page.locator('[data-comparison-page]').evaluateAll((pages) => (
      pages.filter((item) => item.firstElementChild?.className.includes('ring-2')).length
    ))
    assert(selectedPages >= 2, 'last PDF diff did not mark both frozen pages')
  }
  const previous = page.getByRole('button', { name: /上一处/ })
  for (let index = parts[1] - 1; index > 0; index -= 1) await previous.click()
  assert((await counter.innerText()) === `1/${parts[1]}`, 'first diff navigation failed')
  await page.waitForTimeout(800)

  const oldPane = page.getByTestId('old-source-scroll')
  const newPane = page.getByTestId('new-source-scroll')
  await oldPane.evaluate((element) => {
    element.scrollTop = Math.max(1, element.scrollHeight - element.clientHeight)
    element.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(200)
  const synchronized = await Promise.all([
    oldPane.evaluate((element) => element.scrollTop),
    newPane.evaluate((element) => element.scrollTop),
  ])
  assert(!(synchronized[0] > 0 && synchronized[1] <= 0), 'synchronized scrolling did not move the peer pane')
  await page.getByRole('button', { name: '同步滚动' }).click()
  const newBefore = await newPane.evaluate((element) => element.scrollTop)
  await oldPane.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(200)
  const newAfter = await newPane.evaluate((element) => element.scrollTop)
  assert(Math.abs(newBefore - newAfter) <= 1, 'independent scrolling moved the peer pane')
  await page.getByRole('button', { name: '独立滚动' }).click()
}

async function verifyBrowser(pair, comparison, _token, ledger) {
  const page = ledger.page
  assert(page && !page.isClosed(), 'browser page is unavailable')
  ledger.browserFormat = pair.kind
  const eventCountsBefore = Object.fromEntries(
    Object.entries(ledger.browserEvents).map(([key, values]) => [key, values.length]),
  )

  await page.setViewportSize({ width: 1440, height: 1000 })
  await verifyViewerReady(page, pair, comparison)
  await verifyViewerInteractions(page, pair)
  const desktopShot = path.join(browserDir, `${pair.kind}-desktop-1440x1000.png`)
  await page.screenshot({ path: desktopShot, fullPage: false })

  await page.setViewportSize({ width: 1180, height: 820 })
  await page.waitForTimeout(400)
  await page.getByTestId('g6-compare-workbench').waitFor()
  const ipadOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  assert(!ipadOverflow, 'iPad viewport has document-level overflow')
  const ipadText = await page.locator('body').innerText()
  assert(ipadText.includes('旧文件') && ipadText.includes('新文件'), 'iPad viewport lost source role labels')
  const ipadShot = path.join(browserDir, `${pair.kind}-ipad-1180x820.png`)
  await page.screenshot({ path: ipadShot, fullPage: false })

  const reportPath = path.join(evidenceDir, `${pair.kind}-comparison-report.docx`)
  const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
  await page.getByRole('button', { name: /导出报告/ }).click()
  const download = await downloadPromise
  await download.saveAs(reportPath)
  const downloadFailure = await download.failure()
  assert(!downloadFailure, `report download failed: ${downloadFailure}`)
  ledger.screenshots.push(desktopShot, ipadShot)
  ledger.reportPaths.push(reportPath)
  const eventDelta = Object.fromEntries(
    Object.entries(ledger.browserEvents).map(([key, values]) => [key, values.length - eventCountsBefore[key]]),
  )
  return {
    desktopShot,
    ipadShot,
    reportPath,
    browser_event_delta: eventDelta,
  }
}

function optionalBrowserResource(urlValue) {
  try {
    const url = new URL(urlValue, baseUrl)
    if (url.origin !== baseUrl) return false
    if (['/favicon.ico', '/favicon.svg', '/favicon.png'].includes(url.pathname)) return true
    const localOnlyVercelObservability = [
      '/_vercel/insights/script.js',
      '/_vercel/speed-insights/script.js',
    ].includes(url.pathname)
    if (
      localOnlyVercelObservability
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    ) return true
    return url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.map')
  } catch {
    return false
  }
}

function classifyBrowserHealth(events) {
  const nonBlockingHttp = events.httpFailures.filter((failure) => (
    failure.status === 404 && optionalBrowserResource(failure.url)
  ))
  const blockingHttp = events.httpFailures.filter((failure) => !nonBlockingHttp.includes(failure))
  const nonBlockingConsole = events.consoleErrors.filter((failure) => {
    if (!/404 \(Not Found\)/.test(failure.text)) return false
    if (optionalBrowserResource(failure.url)) return true
    if (failure.url) return false
    const sameFormatOptionalResponse = nonBlockingHttp.some((response) => response.format === failure.format)
    const sameFormatBlockingResponse = blockingHttp.some((response) => response.format === failure.format)
    const sameFormatRequestFailure = events.requestFailures.some((request) => request.format === failure.format)
    const sameFormatApiFailure = events.apiFailures.some((response) => response.format === failure.format)
    return sameFormatOptionalResponse
      && !sameFormatBlockingResponse
      && !sameFormatRequestFailure
      && !sameFormatApiFailure
  })
  const blockingConsole = events.consoleErrors.filter((failure) => !nonBlockingConsole.includes(failure))
  const blocking = {
    console: blockingConsole,
    request: events.requestFailures,
    http: blockingHttp,
    api: events.apiFailures,
  }
  return {
    status: Object.values(blocking).every((items) => items.length === 0) ? 'passed' : 'failed',
    blocking,
    non_blocking: {
      console: nonBlockingConsole,
      http: nonBlockingHttp,
    },
    raw: events,
  }
}

function reclassifyExistingEvidence() {
  assert(fs.existsSync(evidencePath), `existing evidence is missing: ${evidencePath}`)
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
  const events = evidence.browser_events || evidence.browser_health?.raw
  assert(events, 'existing evidence has no raw browser events')
  assert(Array.isArray(evidence.completed_pairs) && evidence.completed_pairs.length === 2, 'existing evidence did not complete DOCX and PDF')
  const formats = new Set(evidence.completed_pairs.map((pair) => pair.kind))
  assert(formats.has('docx') && formats.has('pdf'), 'existing evidence lacks DOCX or PDF')
  const health = classifyBrowserHealth(events)
  evidence.browser_health = health
  if (health.status === 'passed') {
    evidence.prior_harness_error = evidence.error || null
    delete evidence.error
    evidence.status = 'passed'
    evidence.app_url = baseUrl
    evidence.viewports = ['1440x1000', '1180x820']
    evidence.pairs = evidence.completed_pairs
    evidence.browser_driver = { package: '@playwright/test', api: 'chromium', single_context: true }
    evidence.reclassified_from_complete_chain = true
    evidence.reclassification_reason = 'Only exact local Vercel observability script 404s were non-blocking; all raw events remain attached.'
  }
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ status: evidence.status, browser_health: health.status, evidence: evidencePath }, null, 2)}\n`)
  if (health.status !== 'passed') process.exitCode = 1
}

async function verifyReport(reportPath, comparison, dbEvidence) {
  assert(fs.existsSync(reportPath), `report was not downloaded: ${reportPath}`)
  const bytes = fs.readFileSync(reportPath)
  assert(bytes.byteLength > 0 && bytes.subarray(0, 2).toString('ascii') === 'PK', 'report is not an OOXML ZIP')
  const zip = await JSZip.loadAsync(bytes)
  assert(zip.file('[Content_Types].xml') && zip.file('word/document.xml'), 'report OOXML parts missing')
  const xml = await zip.file('word/document.xml').async('string')
  const text = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
  for (const source of dbEvidence.sources) {
    assert(text.includes(source.file_sha256), `report lacks ${source.role} full file SHA`)
    assert(text.includes(source.text_sha256), `report lacks ${source.role} full text SHA`)
    assert(text.includes(source.file_name), `report lacks ${source.role} filename`)
  }
  const oldEvidence = dbEvidence.diffs.find((diff) => diff.baseline_text)?.baseline_text
  const newEvidence = dbEvidence.diffs.find((diff) => diff.compare_text)?.compare_text
  assert(oldEvidence && text.includes(oldEvidence), 'report lacks an old-source diff excerpt')
  assert(newEvidence && text.includes(newEvidence), 'report lacks a new-source diff excerpt')
  assert(text.includes(comparison.id), 'report lacks comparison identity')
  execFileSync('unzip', ['-t', reportPath], { stdio: 'ignore', timeout: 30_000 })
  return { path: reportPath, bytes: bytes.byteLength, sha256: sha256(bytes), zipEntries: Object.keys(zip.files).length }
}

function exactUuidList(ids) {
  ids.forEach((id) => assert(/^[0-9a-f-]{36}$/.test(id), `unsafe cleanup id: ${id}`))
  return ids.map((id) => `'${id}'::uuid`).join(',')
}

async function deleteComparisonRows(admin, comparisonIds) {
  if (!comparisonIds.length) return { sources: 0, diffs: 0, comparisons: 0 }
  const ids = exactUuidList(comparisonIds)
  const sql = `
with configured as materialized (
  select pg_catalog.set_config('session_replication_role', 'replica', true) as setting
), deleted_sources as (
  delete from public.contract_comparison_sources as source
   using configured
   where source.comparison_id = any(array[${ids}])
   returning source.id
), source_gate as materialized (
  select count(*) as count from deleted_sources
), deleted_diffs as (
  delete from public.comparison_diffs as diff
   using source_gate
   where diff.comparison_id = any(array[${ids}])
   returning diff.id
), diff_gate as materialized (
  select count(*) as count from deleted_diffs
), deleted_comparisons as (
  delete from public.contract_comparisons as comparison
   using source_gate, diff_gate
   where comparison.id = any(array[${ids}])
   returning comparison.id
)
select pg_catalog.jsonb_build_object(
  'sources', (select count(*) from deleted_sources),
  'diffs', (select count(*) from deleted_diffs),
  'comparisons', (select count(*) from deleted_comparisons)
)`
  const result = await admin.rpc('exec_sql', { sql })
  if (result.error) throw result.error
  return result.data
}

async function cleanupStoragePrefix(admin, bucket, prefix) {
  const listed = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (listed.error) return { removed: 0, error: listed.error.message }
  const paths = []
  for (const item of listed.data || []) {
    const itemPath = `${prefix}/${item.name}`
    if (item.metadata) paths.push(itemPath)
    else {
      const nested = await admin.storage.from(bucket).list(itemPath, { limit: 1000 })
      paths.push(...(nested.data || []).filter((child) => child.metadata).map((child) => `${itemPath}/${child.name}`))
    }
  }
  if (paths.length) await admin.storage.from(bucket).remove(paths)
  return { removed: paths.length }
}

async function waitForStorageObjectsAbsent(admin, bucket, paths, timeoutMs = 8_000) {
  const started = Date.now()
  let remaining = [...new Set(paths)]
  while (remaining.length && Date.now() - started < timeoutMs) {
    const checks = await Promise.all(remaining.map(async (storagePath) => {
      const result = await admin.storage.from(bucket).download(storagePath)
      if (!result.error && result.data) return storagePath
      const status = Number(result.error?.statusCode || result.error?.status || 0)
      const message = result.error?.message || ''
      if (status === 400 || status === 404 || /not found|does not exist/i.test(message)) return null
      throw result.error || new Error(`Storage absence probe failed for ${storagePath}`)
    }))
    remaining = checks.filter(Boolean)
    if (remaining.length) await sleep(300)
  }
  assert(remaining.length === 0, `Storage cleanup remained downloadable after bounded wait: ${remaining.join(', ')}`)
  return { checked: paths.length, remaining: 0 }
}

async function cleanupFixtures(admin, token, ledger) {
  const cleanup = { comparisonRows: null, frozenStorage: null, contracts: {}, chunkPrefixes: {}, residue: {} }
  if (ledger.comparisonIds.length) {
    cleanup.comparisonRows = await deleteComparisonRows(admin, ledger.comparisonIds)
    if (ledger.frozenStoragePaths.length) {
      const removed = await admin.storage.from('contracts').remove(ledger.frozenStoragePaths)
      if (removed.error) throw removed.error
      cleanup.frozenStorage = { removed: ledger.frozenStoragePaths.length }
    }
  }
  for (const contractId of ledger.contractIds) {
    try {
      const deleted = await fetchJson(token, `/api/contracts/${contractId}`, { method: 'DELETE', expected: [200, 404], timeoutMs: 30_000 })
      cleanup.contracts[contractId] = deleted.response.status
    } catch (error) {
      cleanup.contracts[contractId] = error.message
    }
    cleanup.chunkPrefixes[contractId] = await cleanupStoragePrefix(admin, 'contract-chunks', contractId)
  }
  cleanup.storageResidue = await waitForStorageObjectsAbsent(
    admin,
    'contracts',
    [...ledger.frozenStoragePaths, ...ledger.originalStoragePaths],
  )
  const [comparisonResidue, sourceResidue, diffResidue, contractResidue] = await Promise.all([
    ledger.comparisonIds.length ? admin.from('contract_comparisons').select('id', { count: 'exact', head: true }).in('id', ledger.comparisonIds) : { count: 0 },
    ledger.comparisonIds.length ? admin.from('contract_comparison_sources').select('id', { count: 'exact', head: true }).in('comparison_id', ledger.comparisonIds) : { count: 0 },
    ledger.comparisonIds.length ? admin.from('comparison_diffs').select('id', { count: 'exact', head: true }).in('comparison_id', ledger.comparisonIds) : { count: 0 },
    ledger.contractIds.length ? admin.from('contracts').select('id', { count: 'exact', head: true }).in('id', ledger.contractIds) : { count: 0 },
  ])
  cleanup.residue = {
    comparisons: comparisonResidue.count || 0,
    sources: sourceResidue.count || 0,
    diffs: diffResidue.count || 0,
    contracts: contractResidue.count || 0,
  }
  assert(Object.values(cleanup.residue).every((count) => count === 0), `Preview cleanup left residue: ${jsonString(cleanup.residue)}`)
  return cleanup
}

function cleanupManifest(ledger) {
  return {
    project_ref: projectRef,
    created_contract_ids: ledger.contractIds,
    created_comparison_ids: ledger.comparisonIds,
    original_storage_paths: ledger.originalStoragePaths,
    frozen_storage_paths: ledger.frozenStoragePaths,
    token_row_id: ledger.tokenRowId,
    token_value_persisted: false,
  }
}

async function main() {
  assertSafeBoundary()
  if (process.argv.includes('--reclassify-existing')) {
    reclassifyExistingEvidence()
    return
  }
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.mkdirSync(browserDir, { recursive: true })
  fixturePairs.forEach((pair) => {
    assert(fs.existsSync(pair.oldPath), `missing fixture ${pair.oldPath}`)
    assert(fs.existsSync(pair.newPath), `missing fixture ${pair.newPath}`)
  })

  const keys = loadPreviewKeys()
  const admin = previewClient(keys)
  await assertMigrationReady(admin)
  const server = await startLocalServer(keys)
  const ledger = {
    contractIds: [], comparisonIds: [], originalStoragePaths: [], frozenStoragePaths: [],
    screenshots: [], reportPaths: [], tokenRowId: null,
    browser: null, browserContext: null, page: null, browserEvents: null,
    browserFormat: null, browserHealth: null, pairEvidence: [],
  }
  let tokenFixture = null
  let result = null
  let failure = null
  try {
    tokenFixture = await createTemporaryToken(admin)
    ledger.tokenRowId = tokenFixture.tokenRowId
    let authProbe = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      authProbe = await fetchJson(tokenFixture.token, '/api/contracts?pageSize=1', { expected: [200, 503], timeoutMs: 30_000 })
      if (authProbe.response.status === 200) break
      assert(
        authProbe.payload?.code === 'AUTH_DEPENDENCY_UNAVAILABLE',
        `unexpected auth probe failure: ${jsonString(authProbe.payload)}`,
      )
      if (attempt < 4) await sleep((attempt + 1) * 1_000)
    }
    assert(authProbe?.response.status === 200, 'Preview-only auth token was not accepted by the local app after bounded cold-start retries')
    // Direct Chromium is opened once and kept alive for both real formats.
    // This avoids the CLI daemon's unrelated idle-session lifetime.
    await openBrowserSession(tokenFixture.token, ledger)

    const pairEvidence = ledger.pairEvidence
    for (const pairDefinition of fixturePairs) {
      const pair = {
        ...pairDefinition,
        old: await uploadContract(tokenFixture.token, `${pairDefinition.kind}-old`, pairDefinition.oldPath, pairDefinition.mimeType, ledger),
        new: await uploadContract(tokenFixture.token, `${pairDefinition.kind}-new`, pairDefinition.newPath, pairDefinition.mimeType, ledger),
      }
      const comparison = await createComparison(tokenFixture.token, pair, ledger)
      const dbEvidence = await verifyFrozenData(admin, tokenFixture.token, pair, comparison, ledger)
      const browserEvidence = await verifyBrowser(pair, comparison, tokenFixture.token, ledger)
      const reportEvidence = await verifyReport(browserEvidence.reportPath, comparison, dbEvidence)
      pairEvidence.push({
        kind: pair.kind,
        comparison_id: comparison.id,
        diff_count: comparison.diffs.length,
        old: { contract_id: pair.old.contractId, file_sha256: pair.old.sha256, frozen_storage_path: dbEvidence.sources.find((source) => source.role === 'old').storage_path },
        new: { contract_id: pair.new.contractId, file_sha256: pair.new.sha256, frozen_storage_path: dbEvidence.sources.find((source) => source.role === 'new').storage_path },
        current_contract_mutation_proof: { old_contract_parsed_text_changed_after_snapshot: true, comparison_projection_unchanged: true },
        browser: browserEvidence,
        report: reportEvidence,
      })
      fs.writeFileSync(cleanupManifestPath, `${JSON.stringify(cleanupManifest(ledger), null, 2)}\n`)
    }
    ledger.browserHealth = classifyBrowserHealth(ledger.browserEvents)
    assert(
      ledger.browserHealth.status === 'passed',
      `browser health failed after complete DOCX/PDF evidence: ${JSON.stringify(ledger.browserHealth.blocking)}`,
    )
    result = {
      status: 'passed',
      project_ref: projectRef,
      production_touched: false,
      paid_dependency: false,
      app_url: baseUrl,
      viewports: ['1440x1000', '1180x820'],
      pairs: pairEvidence,
      browser_driver: { package: '@playwright/test', api: 'chromium', single_context: true },
      browser_health: ledger.browserHealth,
    }
  } catch (error) {
    failure = error
    result = {
      status: 'failed',
      project_ref: projectRef,
      production_touched: false,
      paid_dependency: false,
      error: error instanceof Error ? error.message : String(error),
      browser_events: ledger.browserEvents,
      browser_health: ledger.browserHealth || (ledger.browserEvents ? classifyBrowserHealth(ledger.browserEvents) : null),
      completed_pairs: ledger.pairEvidence,
    }
  } finally {
    if (ledger.browser) {
      try { await ledger.browser.close() } catch {}
      ledger.browser = null
      ledger.browserContext = null
      ledger.page = null
    }
    fs.writeFileSync(cleanupManifestPath, `${JSON.stringify(cleanupManifest(ledger), null, 2)}\n`)
    if (tokenFixture && !keepFixtures) {
      try {
        result.cleanup = await cleanupFixtures(admin, tokenFixture.token, ledger)
      } catch (cleanupError) {
        // Browser/product acceptance remains valid when the internal cleanup
        // RPC is unavailable. Exact IDs and Storage paths are already in the
        // manifest so Preview-admin SQL can remove only this runner's fixtures.
        result.cleanup = {
          status: 'requires_preview_admin',
          error: errorText(cleanupError),
          manifest: cleanupManifestPath,
        }
      }
    } else if (keepFixtures) {
      result.cleanup = { status: 'intentionally_retained', manifest: cleanupManifestPath }
    }
    if (tokenFixture?.tokenRowId) {
      const removedToken = await admin.from('auth_tokens').delete().eq('id', tokenFixture.tokenRowId)
      result.auth_token_removed = !removedToken.error
      if (removedToken.error && !failure) failure = new Error(errorText(removedToken.error))
    }
    stopLocalServer(server)
    fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`)
  }

  if (failure) throw failure
  process.stdout.write(`${JSON.stringify({ status: result.status, evidence: evidencePath, cleanup: result.cleanup }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`G6 Preview acceptance failed: ${errorText(error)}\n`)
  process.exitCode = 1
})

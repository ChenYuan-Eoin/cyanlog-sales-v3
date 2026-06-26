import { supabaseAdmin } from '@/lib/supabase'

const DEFAULT_PREWARM_TASK_TIMEOUT_MS = 1500

export type LoginPrewarmTaskStatus = 'fulfilled' | 'rejected' | 'timed_out'

export type LoginPrewarmTaskResult = {
  name: string
  status: LoginPrewarmTaskStatus
  durationMs: number
}

export type LoginPrewarmResult = {
  timeoutMs: number
  tasks: LoginPrewarmTaskResult[]
}

function getPrewarmTaskTimeoutMs() {
  const configured = Number(process.env.LOGIN_PREWARM_TASK_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_PREWARM_TASK_TIMEOUT_MS
}

function formatDuration(durationMs: number) {
  return Math.max(0, durationMs).toFixed(1)
}

export function formatLoginPrewarmTiming(result: LoginPrewarmResult) {
  return result.tasks
    .map((task) => `${task.name};dur=${formatDuration(task.durationMs)};status=${task.status}`)
    .join(', ')
}

async function settlePrewarmTask(
  name: string,
  timeoutMs: number,
  task: () => PromiseLike<unknown> | unknown
): Promise<LoginPrewarmTaskResult> {
  const startedAt = performance.now()
  const taskPromise = Promise.resolve()
    .then(task)
    .then((): LoginPrewarmTaskStatus => 'fulfilled')
    .catch((): LoginPrewarmTaskStatus => 'rejected')

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<LoginPrewarmTaskStatus>((resolve) => {
    timeoutId = setTimeout(() => resolve('timed_out'), timeoutMs)
  })

  const status = await Promise.race([taskPromise, timeoutPromise])
  if (timeoutId) {
    clearTimeout(timeoutId)
  }

  return {
    name,
    status,
    durationMs: performance.now() - startedAt,
  }
}

export async function warmLoginRuntime() {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const timeoutMs = getPrewarmTaskTimeoutMs()
  const tasks = await Promise.all([
    settlePrewarmTask('users_query', timeoutMs, () => (
      supabaseAdmin.from('users').select('id').limit(1).maybeSingle()
    )),
    settlePrewarmTask('candidate_rpc', timeoutMs, () => (
      supabaseAdmin.rpc('get_login_candidate_v1', {
        p_email: '__prewarm__@invalid.local',
        p_phone: null,
        p_ip_address: 'prewarm',
        p_since: since,
        p_account_limit: 5,
        p_ip_limit: 15,
      })
    )),
    settlePrewarmTask('login_rpc', timeoutMs, () => (
      supabaseAdmin.rpc('login_with_password_v1', {
        p_email: null,
        p_phone: null,
        p_password: null,
        p_ip_address: 'prewarm',
        p_token_id: null,
        p_token: null,
        p_expires_at: null,
        p_since: since,
        p_account_limit: 5,
        p_ip_limit: 15,
      })
    )),
  ])

  const timedOutTasks = tasks.filter((task) => task.status === 'timed_out')
  if (timedOutTasks.length > 0) {
    console.warn('[auth/login] prewarm timeout', {
      timeoutMs,
      tasks: timedOutTasks.map((task) => ({
        name: task.name,
        durationMs: Number(formatDuration(task.durationMs)),
      })),
    })
  }

  return { timeoutMs, tasks }
}

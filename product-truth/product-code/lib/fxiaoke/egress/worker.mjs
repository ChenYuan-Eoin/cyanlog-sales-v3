import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { executeRequest, validRequest } from './protocol.mjs';

const RUNTIME_URL = 'https://sales.cyanlog.icu/api/admin/organization-sources/fxiaoke/egress';
const PROJECT_URL = 'https://wfawwhphfqqwfwrrkogy.supabase.co';
export function readWorkerConfig(env) {
  const token = env.FXIAOKE_EGRESS_TOKEN || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || '';
  if (!/^[a-f0-9]{64,128}$/.test(token) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw new Error('INVALID_WORKER_CONFIGURATION');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, publishableKey, topic: `fxiaoke-egress-${createHash('sha256').update(`wake:${tokenHash}`).digest('hex')}` };
}
export async function readEgressIp(request = fetch) {
  try {
    const response = await request('https://myip.ipip.net', { redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!response.ok) return null;
    const text = await response.text();
    const ip = text.length <= 4096 ? text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] : null;
    return ip && isIP(ip) === 4 ? ip : null;
  } catch { return null; }
}
export function createWorker({ config, request = fetch, now = () => Date.now(), report = console.log }) {
  let lastIpAt = 0; let observedIp = null; let stopped = false;
  async function post(payload) {
    const response = await request(RUNTIME_URL, { method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
    if ([401,403].includes(response.status)) { stopped = true; throw new Error('WORKER_AUTH_REJECTED'); }
    if (!response.ok) throw new Error(response.status === 409 ? 'JOB_EXPIRED' : 'BRIDGE_UNAVAILABLE');
    const data = await response.json();
    if (!data || typeof data.data !== 'object' || !data.data) throw new Error('INVALID_BRIDGE_RESPONSE');
    return data.data;
  }
  async function tick() {
    if (stopped) return false;
    if (!lastIpAt || now() - lastIpAt > 45000) {
      observedIp = await readEgressIp(request); lastIpAt = now();
    }
    const claim = await post({ action: 'claim', egressIp: observedIp });
    if (claim.status !== 'ready') {
      report(JSON.stringify({ event: 'egress_not_ready', status: claim.status === 'ip_changed' ? 'ip_changed' : 'unreachable', ip: observedIp }));
      return false;
    }
    const job = claim.job;
    if (!job) return false;
    if (typeof job.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(job.id) || typeof job.lease !== 'string'
      || !/^[0-9a-f-]{36}$/i.test(job.lease) || !validRequest(job.request)) throw new Error('INVALID_BRIDGE_JOB');
    const remaining = Date.parse(job.expiresAt) - now() - 1000;
    if (!Number.isFinite(remaining) || remaining <= 0) return false;
    const result = await executeRequest(job.request, request, Math.min(12000, remaining));
    await post({ action: 'complete', id: job.id, lease: job.lease, result });
    report(JSON.stringify({ event: 'request_finished', success: !('error' in result), http_status: result.status || null }));
    return true;
  }
  return { tick, stop() { stopped = true; }, isStopped() { return stopped; } };
}
export function startWorker(config, dependencies = {}) {
  const report = dependencies.report || console.log;
  const supabase = (dependencies.clientFactory || createClient)(PROJECT_URL, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const worker = createWorker({ config, ...dependencies, report });
  let running = false; let pending = false; let wakeTimer; let lastRun = 0;
  async function drain() {
    if (worker.isStopped()) return;
    pending = true;
    if (running || wakeTimer) return;
    const wait = Math.max(0, 250 - (Date.now() - lastRun));
    if (wait) { wakeTimer = setTimeout(() => { wakeTimer = undefined; void drain(); }, wait); return; }
    running = true; pending = false; lastRun = Date.now();
    try { pending = await worker.tick() || pending; }
    catch (error) { report(JSON.stringify({ event: 'worker_error', code: ['WORKER_AUTH_REJECTED','JOB_EXPIRED','INVALID_BRIDGE_JOB'].includes(error?.message) ? error.message : 'CONNECTION_FAILED' })); }
    finally { running = false; if (pending) void drain(); }
  }
  const channel = supabase.channel(config.topic).on('broadcast', { event: 'wake' }, () => void drain()).subscribe(status => {
    report(JSON.stringify({ event: 'wake_channel', status }));
    if (status === 'SUBSCRIBED') void drain();
  });
  // One health/cleanup request per minute while idle; no rapid idle polling.
  const heartbeat = setInterval(() => void drain(), 60000);
  void drain();
  return async () => { worker.stop(); clearInterval(heartbeat); clearTimeout(wakeTimer); await supabase.removeChannel(channel); };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.FXIAOKE_RUNTIME_ENV) process.loadEnvFile(process.env.FXIAOKE_RUNTIME_ENV);
    const config = readWorkerConfig(process.env);
    delete process.env.FXIAOKE_EGRESS_TOKEN;
    const stop = startWorker(config);
    process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
  } catch {
    console.error(JSON.stringify({ event: 'worker_configuration_invalid' })); process.exitCode = 2;
  }
}

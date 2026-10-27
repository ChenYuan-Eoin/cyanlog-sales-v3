import { chmod, writeFile } from 'node:fs/promises';

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('WECOM_RUNTIME_URL must use HTTPS');
  }
  return url.toString().replace(/\/$/, '');
}

export async function enrollRuntime({ baseUrl, botId, token, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(botId || '')) throw new Error('WECOM_BOT_ID is missing or invalid');
  if (!token) throw new Error('WECOM_ENROLLMENT_TOKEN is missing');
  const origin = normalizeBaseUrl(baseUrl);
  const response = await fetchImpl(`${origin}/api/shipping/public/wecom/bot/${encodeURIComponent(botId)}/long-connection/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !/^[A-Za-z0-9_-]{4,128}$/.test(data?.remoteBotId || '') || !data?.secret) throw new Error(`Runtime enrollment failed (${response.status})`);
  return { remoteBotId: String(data.remoteBotId || ''), secret: String(data.secret) };
}

export async function writeRuntimeEnvironment(path, values) {
  for (const value of [values.botId, values.connectionId, values.secret, values.runtimeUrl]) {
    if (typeof value !== 'string' || !value || /[\r\n\s]/.test(value)) throw new Error('Invalid runtime environment value');
  }
  const content = [
    `WECOM_BOT_ID=${values.botId}`,
    `WECOM_BOT_CONNECTION_ID=${values.connectionId}`,
    `WECOM_BOT_SECRET=${values.secret}`,
    `WECOM_RUNTIME_URL=${values.runtimeUrl}`,
    '',
  ].join('\n');
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeUrl = process.env.WECOM_RUNTIME_URL?.trim() || 'https://sales.cyanlog.icu';
  const output = process.env.WECOM_RUNTIME_ENV_FILE || new URL('./runtime.env', import.meta.url).pathname;
  try {
    const enrolled = await enrollRuntime({
      baseUrl: runtimeUrl,
      botId: process.env.WECOM_BOT_CONNECTION_ID || '',
      token: process.env.WECOM_ENROLLMENT_TOKEN || '',
    });
    await writeRuntimeEnvironment(output, {
      botId: enrolled.remoteBotId,
      connectionId: process.env.WECOM_BOT_CONNECTION_ID,
      secret: enrolled.secret,
      runtimeUrl,
    });
    delete process.env.WECOM_ENROLLMENT_TOKEN;
    console.log('Runtime enrollment completed; credentials were written to the private environment file.');
  } catch {
    console.error('Runtime enrollment failed; no credential was written.');
    process.exitCode = 1;
  }
}

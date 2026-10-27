import { createHmac } from 'node:crypto';

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('WECOM_RUNTIME_URL must use HTTPS');
  }
  return url.toString().replace(/\/$/, '');
}

export function signBridgeRequest(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('base64url');
}

export function createBridgeClient({
  baseUrl,
  botId,
  secret,
  fetchImpl = fetch,
  clock = () => Date.now(),
  timeoutMs = 45000,
}) {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(botId || '')) throw new Error('WECOM_BOT_ID is missing or invalid');
  if (!secret || secret.length > 512 || /\s/.test(secret)) throw new Error('WECOM_BOT_SECRET is missing or invalid');
  const origin = normalizeBaseUrl(baseUrl);
  const endpoint = `${origin}/api/shipping/public/wecom/bot/${encodeURIComponent(botId)}/long-connection`;

  async function post(payload) {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(clock() / 1000));
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wecom-Runtime-Timestamp': timestamp,
        'X-Wecom-Runtime-Signature': signBridgeRequest(secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(`Robot bridge rejected the request (${response.status}).`);
      error.status = response.status;
      error.providerMessage = typeof data?.error === 'string' ? data.error.slice(0, 160) : '';
      throw error;
    }
    return data;
  }

  return {
    heartbeat(runtime) {
      return post({ action: 'heartbeat', runtime });
    },
    message(frame) {
      return post({ action: 'message', frame });
    },
  };
}

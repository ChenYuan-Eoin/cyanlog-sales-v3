import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeClient, signBridgeRequest } from './bridge.mjs';

const botId = 'test-bot';
const secret = 'example-secret';

test('signs the exact timestamp and body with HMAC-SHA256', () => {
  assert.equal(signBridgeRequest(secret, '100', '{"a":1}'), signBridgeRequest(secret, '100', '{"a":1}'));
  assert.notEqual(signBridgeRequest(secret, '100', '{"a":1}'), signBridgeRequest(secret, '101', '{"a":1}'));
  assert.equal(signBridgeRequest(secret, '100', '{"a":1}').length, 43);
});

test('sends heartbeat and message requests to the signed bridge endpoint', async () => {
  const calls = [];
  const client = createBridgeClient({
    baseUrl: 'https://sales.example.test',
    botId,
    secret,
    clock: () => 123000,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true, content: 'reply' });
    },
  });
  await client.heartbeat({ version: 'v1', phase: 'connected', authenticated: true, business_ready: true });
  const frame = { msgid: 'm1', aibotid: botId, from: { userid: 'u1' }, chattype: 'single', msgtype: 'text', text: { content: '寄件' } };
  await client.message(frame);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://sales.example.test/api/shipping/public/wecom/bot/${botId}/long-connection`);
  assert.equal(calls[0].init.headers['X-Wecom-Runtime-Timestamp'], '123');
  assert.equal(calls[0].init.headers['X-Wecom-Runtime-Signature'], signBridgeRequest(secret, '123', calls[0].init.body));
  assert.equal(calls[1].init.headers['X-Wecom-Runtime-Signature'], signBridgeRequest(secret, '123', calls[1].init.body));
});

test('does not expose the secret when the bridge rejects a request', async () => {
  const client = createBridgeClient({
    baseUrl: 'https://sales.example.test',
    botId,
    secret,
    fetchImpl: async () => Response.json({ error: 'request rejected' }, { status: 401 }),
  });
  await assert.rejects(
    () => client.heartbeat({ version: 'v1', phase: 'connected', authenticated: true, business_ready: true }),
    error => !String(error.message).includes(secret) && !String(error.providerMessage).includes(secret),
  );
});

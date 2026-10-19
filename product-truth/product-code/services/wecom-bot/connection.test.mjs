import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createConnection, readConfig } from './connection.mjs';

let client;
class FakeClient extends EventEmitter {
  constructor(options) { super(); this.options = options; client = this; }
  connect() {}
  disconnect() { this.disconnected = true; this.emit('disconnected', 'ignored'); }
}
const config = { botId: 'test-bot', secret: 'test-secret-not-real' };
test('rejects incomplete credentials without revealing their value', () => {
  assert.throws(() => readConfig({ WECOM_BOT_ID: 'test-bot', WECOM_BOT_SECRET: 'private value' }), /missing or invalid/);
  assert.deepEqual(readConfig({ WECOM_BOT_ID: config.botId, WECOM_BOT_SECRET: config.secret }), config);
});
test('socket connection alone never claims authentication or business readiness', async () => {
  const reports = [];
  const c = createConnection({ Client: FakeClient, config, report: s => reports.push(s) });
  const ready = c.start();
  client.emit('connected');
  assert.equal(c.snapshot().authenticated, false);
  client.emit('authenticated');
  await ready;
  assert.equal(c.snapshot().authenticated, true);
  assert.equal(c.snapshot().business_ready, false);
  client.emit('message', { text: config.secret });
  client.emit('error', new Error(config.secret));
  assert.equal(c.snapshot().authenticated, false);
  assert.equal(c.snapshot().received_messages, 1);
  assert.equal(JSON.stringify(reports).includes(config.secret), false);
  client.emit('reconnecting', 2);
  assert.equal(c.snapshot().reconnect_attempts, 2);
  client.emit('authenticated');
  assert.equal(c.snapshot().authenticated, true);
  c.stop();
  client.emit('authenticated');
  assert.equal(c.snapshot().phase, 'stopped');
  assert.equal(c.snapshot().authenticated, false);
});
test('authentication deadline disconnects instead of leaving a false online service', async () => {
  const c = createConnection({ Client: FakeClient, config, timeoutMs: 10 });
  await assert.rejects(c.start(), /deadline/);
  assert.equal(client.disconnected, true);
  assert.equal(c.snapshot().authenticated, false);
});
test('authentication rejection stops retries and exposes only the numeric error code', async () => {
  const reports = [];
  const c = createConnection({ Client: FakeClient, config, report: s => reports.push(s) });
  const ready = c.start();
  client.emit('error', new Error(`Authentication failed: ${config.secret} (code: 40014)`));
  await assert.rejects(ready, /rejected/);
  assert.equal(client.disconnected, true);
  assert.equal(c.snapshot().error_code, 40014);
  assert.equal(JSON.stringify(reports).includes(config.secret), false);
});

test('classifies provider signature rejection without printing provider text or secrets', async () => {
  const reports = [];
  const c = createConnection({ Client: FakeClient, config, report: s => reports.push(s) });
  const ready = c.start();
  client.emit('error', new Error(`Authentication failed: signature incorrect ${config.secret} (code: 853000)`));
  await assert.rejects(ready, /rejected/);
  assert.equal(c.snapshot().authentication_reason, 'signature_rejected');
  assert.equal(c.snapshot().error_code, 853000);
  assert.equal(JSON.stringify(reports).includes(config.secret), false);
});

test('dispatches only authenticated messages and prevents replies on a replacement socket', async () => {
  const seen = [], sent = [];
  let reply;
  const c = createConnection({ Client: FakeClient, config, onMessage: async (frame, send) => { seen.push(frame); reply = send; } });
  const ready = c.start();
  client.replyStream = async (...args) => { sent.push(args); };
  const frame = { headers: { req_id: 'private-request' }, body: { msgid: 'm1', from: { userid: 'member' } } };
  client.emit('message', frame);
  await Promise.resolve();
  assert.equal(seen.length, 0);
  client.emit('authenticated'); await ready;
  client.emit('message', frame); await Promise.resolve();
  assert.equal(seen.length, 1);
  await reply('stream1', 'test reply');
  assert.equal(sent[0][0], frame);
  client.emit('disconnected'); client.emit('connected'); client.emit('authenticated');
  await assert.rejects(reply('stream1', 'late reply'), /no longer authenticated/);
  assert.equal(sent.length, 1);
  c.stop();
  client.emit('message', frame); await Promise.resolve();
  assert.equal(seen.length, 1);
});

test('handler failures do not leak message data or become unhandled rejections', async () => {
  const reports = [];
  const c = createConnection({ Client: FakeClient, config, report: s => reports.push(s), onMessage: () => { throw new Error('private customer address'); } });
  const ready = c.start(); client.emit('authenticated'); await ready;
  client.emit('message', { headers: { req_id: 'r' }, body: { text: 'private customer address' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.snapshot().message_errors, 1);
  assert.equal(JSON.stringify(reports).includes('private customer address'), false);
  c.stop();
});

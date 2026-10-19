import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import AiBot from '@wecom/aibot-node-sdk';
import { createConnection } from './connection.mjs';

// Resolve the same WebSocket implementation used by the pinned SDK.
const sdkRequire = createRequire(import.meta.resolve('@wecom/aibot-node-sdk'));
const { WebSocketServer } = sdkRequire('ws');
const config = { botId: 'offline-test-bot', secret: 'offline-test-secret' };

test('official SDK authenticates again after network loss and stops without reconnecting', { timeout: 5000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  let connection, sockets = 0, authentications = 0;
  const frames = [], reports = [];
  t.after(async () => {
    connection?.stop();
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  server.on('connection', socket => {
    sockets += 1;
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString());
      frames.push(frame);
      socket.send(JSON.stringify({ headers: frame.headers, errcode: 0, errmsg: 'ok' }));
    });
  });
  class LocalClient extends AiBot.WSClient {
    constructor(options) {
      super({ ...options, wsUrl: `ws://127.0.0.1:${server.address().port}`, reconnectInterval: 20 });
    }
  }
  let resolveReconnected;
  const reconnected = new Promise(resolve => { resolveReconnected = resolve; });
  connection = createConnection({ Client: LocalClient, config, report: state => {
    reports.push(state);
    if (state.authenticated && ++authentications === 2) resolveReconnected();
  } });
  await connection.start();
  assert.equal(frames[0].cmd, 'aibot_subscribe');
  assert.equal(frames[0].body.bot_id, config.botId);
  assert.equal(frames[0].body.secret, config.secret);
  for (const socket of server.clients) socket.terminate();
  await reconnected;
  assert.equal(sockets, 2);
  assert.equal(frames.filter(frame => frame.cmd === 'aibot_subscribe').length, 2);
  assert.ok(reports.some(state => state.phase === 'reconnecting' && !state.authenticated));
  assert.equal(connection.snapshot().business_ready, false);
  connection.stop();
  await delay(100);
  assert.equal(sockets, 2);
  assert.equal(connection.snapshot().phase, 'stopped');
  assert.equal(JSON.stringify(reports).includes(config.secret), false);
  assert.ok(frames.every(frame => frame.cmd === 'aibot_subscribe'));
});

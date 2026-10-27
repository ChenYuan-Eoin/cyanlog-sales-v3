import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrollRuntime, writeRuntimeEnvironment } from './enroll.mjs';

test('redeems a short-lived enrollment token and writes a private environment file', async () => {
  const calls = [];
  const enrolled = await enrollRuntime({
    baseUrl: 'https://sales.example.test',
    botId: 'bot-1',
    token: 'example-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ remoteBotId: 'aibot-1', secret: 'example-secret' });
    },
  });
  assert.equal(enrolled.remoteBotId, 'aibot-1');
  assert.equal(calls[0].url, 'https://sales.example.test/api/shipping/public/wecom/bot/bot-1/long-connection/enroll');
  assert.deepEqual(JSON.parse(calls[0].init.body), { token: 'example-token' });

  const dir = await mkdtemp(join(tmpdir(), 'wecom-enroll-'));
  try {
    const file = join(dir, 'runtime.env');
    await writeRuntimeEnvironment(file, { botId: enrolled.remoteBotId, connectionId: 'bot-1', secret: enrolled.secret, runtimeUrl: 'https://sales.example.test' });
    assert.match(await readFile(file, 'utf8'), /WECOM_BOT_SECRET=example-secret/);
    assert.match(await readFile(file, 'utf8'), /WECOM_BOT_ID=aibot-1/);
    assert.match(await readFile(file, 'utf8'), /WECOM_BOT_CONNECTION_ID=bot-1/);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fails closed when enrollment is rejected', async () => {
  await assert.rejects(() => enrollRuntime({
    baseUrl: 'https://sales.example.test',
    botId: 'bot-1',
    token: 'expired',
    fetchImpl: async () => Response.json({ error: 'expired' }, { status: 401 }),
  }), /failed/);
});

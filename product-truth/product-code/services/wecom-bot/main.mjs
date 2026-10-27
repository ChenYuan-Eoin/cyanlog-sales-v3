import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const envFile = fileURLToPath(new URL('./runtime.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
import AiBot from '@wecom/aibot-node-sdk';
import { createConnection, readConfig } from './connection.mjs';
import { createBridgeClient } from './bridge.mjs';

const mode = process.argv[2];
const runtimeVersion = 'wecom-cloud-runtime-v1';
if (!['--probe', '--listen'].includes(mode)) {
  console.error('Choose --probe (authenticate and disconnect) or --listen (run the business listener).');
  process.exitCode = 2;
} else {
  let connection;
  let bridge;
  let bridgeErrors = 0;
  let lastHeartbeatAt = 0;
  try {
    const config = readConfig(process.env);
    if (mode === '--listen') {
      bridge = createBridgeClient({
        baseUrl: process.env.WECOM_RUNTIME_URL?.trim() || 'https://sales.cyanlog.icu',
        botId: process.env.WECOM_BOT_CONNECTION_ID?.trim(),
        secret: config.secret,
      });
    }
    // The SDK keeps its credential copy in memory; child processes must not inherit it.
    delete process.env.WECOM_BOT_SECRET;

    async function heartbeat(state, force = false) {
      if (!bridge || !state.authenticated) return;
      if (!force && Date.now() - lastHeartbeatAt < 55000) return;
      lastHeartbeatAt = Date.now();
      try {
        await bridge.heartbeat({
          version: runtimeVersion,
          host: process.env.HOSTNAME || 'lightvela-cloud-desktop',
          phase: state.phase,
          authenticated: state.authenticated,
          business_ready: state.business_ready,
          received_messages: state.received_messages,
          replied_messages: state.replied_messages,
          message_errors: state.message_errors,
          reconnect_attempts: state.reconnect_attempts,
        });
      } catch (error) {
        bridgeErrors += 1;
        if ([401,403,404,409].includes(error?.status)) connection?.stop();
        console.error(JSON.stringify({ phase: 'bridge_heartbeat_error', status: Number(error?.status) || null, bridge_errors: bridgeErrors }));
      }
    }

    async function onMessage(frame, reply) {
      if (!bridge) throw new Error('Bridge is not configured');
      const body = frame?.body;
      const streamId = randomUUID();
      if (body?.msgtype !== 'text' || !body?.text?.content) {
        await reply(streamId, '请发送“寄件”开始提报，或发送“查询我的工单”。', true);
        return;
      }
      await reply(streamId, '正在核对，请稍候。', false);
      try {
        const result = await bridge.message(body);
        const content = result?.stream?.finish !== true
          ? '本次处理暂未完成，尚未确认提报成功。请发送“查询我的工单”核对，避免重复提报。'
          : typeof result?.stream?.content === 'string' && result.stream.content.trim()
          ? result.stream.content
          : '业务服务未返回可读结果，请稍后重试。';
        await reply(streamId, content, true);
      } catch (error) {
        bridgeErrors += 1;
        if ([401,403,404,409].includes(error?.status)) { connection?.stop(); return; }
        console.error(JSON.stringify({ phase: 'bridge_message_error', status: Number(error?.status) || null, bridge_errors: bridgeErrors }));
        await reply(streamId, '业务服务暂时不可用，请稍后重试；如已提报请勿重复发送，可先查询我的工单。', true);
      }
    }

    connection = createConnection({
      Client: AiBot.WSClient,
      config,
      onMessage: mode === '--listen' ? onMessage : undefined,
      report: state => {
        console.log(JSON.stringify({ ...state, runtime_version: runtimeVersion, bridge_errors: bridgeErrors }));
        void heartbeat(state);
      },
    });
    const stop = () => connection.stop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await connection.start();
    if (mode === '--probe') {
      connection.stop();
    } else {
      const timer = setInterval(() => void heartbeat(connection.snapshot()), 60000);
      timer.unref();
    }
  } catch (error) {
    connection?.stop();
    console.error(JSON.stringify({ phase: 'runtime_failed', runtime_version: runtimeVersion, bridge_errors: bridgeErrors }));
    process.exitCode = error?.message === 'Robot authentication rejected' ? 0 : 1;
  }
}

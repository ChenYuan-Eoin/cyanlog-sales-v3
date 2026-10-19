import AiBot from '@wecom/aibot-node-sdk';
import { createConnection, readConfig } from './connection.mjs';

const mode = process.argv[2];
if (!['--probe', '--listen'].includes(mode)) {
  console.error('Choose --probe (authenticate and disconnect) or --listen (transport diagnostics only).');
  process.exitCode = 2;
} else {
  let connection;
  try {
    const config = readConfig(process.env);
    // The SDK keeps its credential copy in memory; child processes must not inherit it.
    delete process.env.WECOM_BOT_SECRET;
    connection = createConnection({ Client: AiBot.WSClient, config, report: state => console.log(JSON.stringify(state)) });
    const stop = () => connection.stop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await connection.start();
    if (mode === '--probe') connection.stop();
  } catch {
    connection?.stop();
    console.error('Robot connection failed; no business operation was performed.');
    process.exitCode = 1;
  }
}
